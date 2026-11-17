/**
 * Party (파티) and nomination (지목) routes.
 *
 * Every route runs its checks and mutations in one SQLite transaction. The
 * realtime signals the mutation produced (quest change, notifications, guide
 * XP) are collected while the transaction is open and emitted by the handler
 * only after it commits.
 *
 * Keep the export name `partyRoutes`: `app.ts` registers this plugin.
 */
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  GUIDE_XP,
  leavePartyRequestSchema,
  memberStatusRequestSchema,
  myNominationsResponseSchema,
  nominateRequestSchema,
  nominationListResponseSchema,
  passNominationRequestSchema,
  type ActiveMemberStatus,
  type MyNomination,
  type Nomination,
  type UserRef,
} from "@guildloom/shared";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../db/index.js";
import {
  partyMembers,
  projectMembers,
  questNominations,
  quests,
  users,
  type QuestNominationRow,
  type QuestRow,
  type UserRow,
} from "../db/schema.js";
import { authenticate, requireMembership } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import {
  applyAutoTransition,
  createNotification,
  ensurePartyLeader,
  findActivePartyMember,
  findPartyMember,
  getActivePartyMembers,
  getActivePartyUserIds,
  getPendingNominations,
  insertQuestEvent,
  markQuestClaimed,
  upsertActivePartyMember,
  type CreatedNotification,
} from "../lib/party.js";
import type { Realtime, XpChangedInput } from "../lib/realtime.js";
import { awardXp } from "../lib/xp.js";
import {
  loadQuestDetail,
  questDetailResponseSchema,
  type QuestDetail,
} from "./quests.js";

/** Numeric route parameters (`:id`). */
const questParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});
const nominationParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Realtime work produced by a party mutation, emitted after commit. */
interface PartySignals {
  projectId: number;
  /** The mutated quest, or `null` when the action was an idempotent no-op. */
  questId: number | null;
  notifications: CreatedNotification[];
  xp: XpChangedInput[];
}

/** The result of a party mutation: its signals and (optionally) nominations. */
interface PartyMutationResult {
  signals: PartySignals;
}

/** Signals for a mutation that only changes the quest row / event log. */
function questSignals(quest: QuestRow): PartySignals {
  return {
    projectId: quest.projectId,
    questId: quest.id,
    notifications: [],
    xp: [],
  };
}

/** Signals for an action that changed nothing (already joined / same status). */
function noopSignals(quest: QuestRow): PartySignals {
  return {
    projectId: quest.projectId,
    questId: null,
    notifications: [],
    xp: [],
  };
}

/** Emit collected realtime work after the transaction has committed. */
function emitSignals(realtime: Realtime, signals: PartySignals): void {
  if (signals.questId !== null) {
    realtime.emitQuestChanged(signals.projectId, signals.questId);
  }
  for (const created of signals.notifications) {
    realtime.emitNotification(created.userId, created.notification);
  }
  for (const xp of signals.xp) {
    realtime.emitXpChanged(xp);
  }
}

/** The authenticated user of a request (the `authenticate` preHandler ran). */
function currentUser(request: FastifyRequest): UserRow {
  if (!request.user) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  }
  return request.user;
}

/** Load a quest row the user may access (404 missing, 403 not a member). */
function requireQuest(db: AppDb, questId: number, userId: number): QuestRow {
  const quest = db.select().from(quests).where(eq(quests.id, questId)).get();
  if (!quest) {
    throw new HttpError(404, "NOT_FOUND", "Quest not found");
  }
  requireMembership(db, userId, quest.projectId);
  return quest;
}

/** Load a nomination plus its quest (404 missing, 403 not a guild member). */
function requireNomination(
  db: AppDb,
  nominationId: number,
  userId: number,
): { nomination: QuestNominationRow; quest: QuestRow } {
  const nomination = db
    .select()
    .from(questNominations)
    .where(eq(questNominations.id, nominationId))
    .get();
  if (!nomination) {
    throw new HttpError(404, "NOT_FOUND", "Nomination not found");
  }
  requireMembership(db, userId, nomination.projectId);

  const quest = db
    .select()
    .from(quests)
    .where(eq(quests.id, nomination.questId))
    .get();
  if (!quest) {
    throw new HttpError(404, "NOT_FOUND", "Quest not found");
  }
  return { nomination, quest };
}

/**
 * Reject party actions on closed quests.
 *
 * `archived` and `rumor` block every party action; `cleared` blocks the
 * join/nominate/reinforce/status/accept/pass/leave set (cancelling a pending
 * nomination is still allowed on a cleared quest).
 */
function requirePartyStage(quest: QuestRow, blocksCleared: boolean): void {
  const blocked =
    quest.stage === "archived" ||
    quest.stage === "rumor" ||
    (blocksCleared && quest.stage === "cleared");
  if (blocked) {
    throw new HttpError(
      409,
      "CONFLICT",
      `Quest in stage '${quest.stage}' does not accept party actions`,
    );
  }
}

function userRef(userId: number, displayName: string): UserRef {
  return { id: userId, displayName };
}

/** Award a relay's guide bonus to its nominator, exactly once. */
function awardGuideXp(
  db: AppDb,
  nomination: QuestNominationRow,
  now: number,
): XpChangedInput | null {
  if (nomination.kind !== "relay") {
    return null;
  }

  const result = awardXp(db, {
    userId: nomination.nominatedBy,
    projectId: nomination.projectId,
    questId: nomination.questId,
    reason: "guide",
    amount: GUIDE_XP,
    idemKey: `guide:${nomination.id}`,
    now,
  });
  if (!result.awarded) {
    return null;
  }

  const signal: XpChangedInput = {
    userId: nomination.nominatedBy,
    projectId: nomination.projectId,
    xp: result.xp,
    level: result.level,
  };
  if (result.levelUp) {
    signal.levelUp = result.levelUp;
  }
  return signal;
}

/**
 * Create a nomination or reinforcement batch.
 *
 * Targets must be guild members; active members and users that already have a
 * pending nomination are skipped silently. Each accepted target gets an inbox
 * notification and the batch appends one `nominated` /
 * `reinforcement_requested` event.
 */
function createNominationBatch(
  db: AppDb,
  quest: QuestRow,
  actor: UserRow,
  userIds: number[],
  kind: "nominate" | "reinforce",
  now: number,
): { nominations: Nomination[] } & PartyMutationResult {
  if (kind === "reinforce" && !findActivePartyMember(db, quest.id, actor.id)) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only active party members can request reinforcements",
    );
  }

  const unique = [...new Set(userIds)];
  const guildRows = db
    .select({
      userId: projectMembers.userId,
      displayName: users.displayName,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(
      and(
        eq(projectMembers.projectId, quest.projectId),
        inArray(projectMembers.userId, unique),
      ),
    )
    .all();
  const guildUsers = new Map(guildRows.map((row) => [row.userId, row]));

  for (const userId of unique) {
    if (!guildUsers.has(userId)) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "Nomination targets must be members of this guild",
      );
    }
  }

  const activeIds = getActivePartyUserIds(db, quest.id);
  const pendingIds = new Set(
    getPendingNominations(db, quest.id).map((row) => row.nomineeId),
  );
  const targets = unique.filter(
    (userId) => !activeIds.has(userId) && !pendingIds.has(userId),
  );
  if (targets.length === 0) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      "Every target is already in the party or already nominated",
    );
  }

  const actorRef = userRef(actor.id, actor.displayName);
  const notifications: CreatedNotification[] = [];
  const nominations: Nomination[] = [];

  for (const targetId of targets) {
    const row = db
      .insert(questNominations)
      .values({
        questId: quest.id,
        projectId: quest.projectId,
        nomineeId: targetId,
        nominatedBy: actor.id,
        kind,
        state: "pending",
        passReason: null,
        relayFromNominationId: null,
        createdAt: now,
        resolvedAt: null,
      })
      .returning()
      .get();

    const target = guildUsers.get(targetId);
    if (!target) {
      continue;
    }

    notifications.push(
      createNotification(db, {
        userId: targetId,
        projectId: quest.projectId,
        questId: quest.id,
        type: kind === "nominate" ? "nominated" : "reinforce",
        actorUserId: actor.id,
        payload: { nominationId: row.id },
        createdAt: now,
      }),
    );
    nominations.push({
      id: row.id,
      questId: row.questId,
      nominee: userRef(targetId, target.displayName),
      nominatedBy: actorRef,
      kind: row.kind,
      state: row.state,
      passReason: row.passReason,
      createdAt: row.createdAt,
    });
  }

  insertQuestEvent(db, {
    questId: quest.id,
    projectId: quest.projectId,
    type: kind === "nominate" ? "nominated" : "reinforcement_requested",
    payload: {
      userIds: targets,
      names: targets.map(
        (userId) => guildUsers.get(userId)?.displayName ?? "",
      ),
    },
    actorUserId: actor.id,
    createdAt: now,
  });

  return {
    nominations,
    signals: {
      projectId: quest.projectId,
      questId: quest.id,
      notifications,
      xp: [],
    },
  };
}

/** Accept a pending nomination: the nominee joins and may earn guide XP. */
function acceptNomination(
  db: AppDb,
  quest: QuestRow,
  nomination: QuestNominationRow,
  actor: UserRow,
  now: number,
): PartyMutationResult {
  if (nomination.nomineeId !== actor.id) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only the nominee can accept this nomination",
    );
  }
  if (nomination.state !== "pending") {
    throw new HttpError(409, "CONFLICT", "Nomination is no longer pending");
  }

  db.update(questNominations)
    .set({ state: "accepted", resolvedAt: now })
    .where(eq(questNominations.id, nomination.id))
    .run();

  upsertActivePartyMember(db, quest.id, actor.id, now);
  markQuestClaimed(db, quest, now);
  ensurePartyLeader(db, quest.id, now);

  insertQuestEvent(db, {
    questId: quest.id,
    projectId: quest.projectId,
    type: "claimed",
    payload: {},
    actorUserId: actor.id,
    createdAt: now,
  });

  const xp = awardGuideXp(db, nomination, now);
  const auto = applyAutoTransition(db, quest.id, actor.id, now);

  return {
    signals: {
      projectId: quest.projectId,
      questId: quest.id,
      notifications: auto.notifications,
      xp: xp ? [xp] : [],
    },
  };
}

/**
 * Pass a nomination, optionally relaying (토스) it to another guild member.
 *
 * A relay to an already active member degrades to a plain pass.
 */
function passNomination(
  db: AppDb,
  quest: QuestRow,
  nomination: QuestNominationRow,
  actor: UserRow,
  body: { reason?: string; relayToUserId?: number },
  now: number,
): PartyMutationResult {
  if (nomination.nomineeId !== actor.id) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only the nominee can pass this nomination",
    );
  }
  if (nomination.state !== "pending") {
    throw new HttpError(409, "CONFLICT", "Nomination is no longer pending");
  }

  const reason = body.reason ?? null;
  const relayToUserId = body.relayToUserId;
  let relayNomination: QuestNominationRow | null = null;
  let relayTarget: { userId: number; displayName: string } | null = null;

  if (relayToUserId !== undefined) {
    const target = db
      .select({
        userId: projectMembers.userId,
        displayName: users.displayName,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(
        and(
          eq(projectMembers.projectId, quest.projectId),
          eq(projectMembers.userId, relayToUserId),
        ),
      )
      .get();
    if (!target) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "Relay target must be a member of this guild",
      );
    }

    // A relay to a member who already fights is meaningless: pass plainly.
    if (!findActivePartyMember(db, quest.id, relayToUserId)) {
      relayTarget = target;
      relayNomination = db
        .insert(questNominations)
        .values({
          questId: quest.id,
          projectId: quest.projectId,
          nomineeId: target.userId,
          nominatedBy: actor.id,
          kind: "relay",
          state: "pending",
          passReason: null,
          relayFromNominationId: nomination.id,
          createdAt: now,
          resolvedAt: null,
        })
        .returning()
        .get();
    }
  }

  db.update(questNominations)
    .set({ state: "passed", passReason: reason, resolvedAt: now })
    .where(eq(questNominations.id, nomination.id))
    .run();

  const notifications: CreatedNotification[] = [];
  if (relayNomination && relayTarget) {
    insertQuestEvent(db, {
      questId: quest.id,
      projectId: quest.projectId,
      type: "relayed",
      payload: {
        toUserId: relayTarget.userId,
        toName: relayTarget.displayName,
        reason,
      },
      actorUserId: actor.id,
      createdAt: now,
    });
    notifications.push(
      createNotification(db, {
        userId: relayTarget.userId,
        projectId: quest.projectId,
        questId: quest.id,
        type: "relayed",
        actorUserId: actor.id,
        payload: { nominationId: relayNomination.id, reason },
        createdAt: now,
      }),
    );
  } else {
    insertQuestEvent(db, {
      questId: quest.id,
      projectId: quest.projectId,
      type: "passed",
      payload: { reason },
      actorUserId: actor.id,
      createdAt: now,
    });
  }

  return {
    signals: {
      projectId: quest.projectId,
      questId: quest.id,
      notifications,
      xp: [],
    },
  };
}

/** Cancel a pending nomination (nominator or nominee); no event is recorded. */
function cancelNomination(
  db: AppDb,
  quest: QuestRow,
  nomination: QuestNominationRow,
  actor: UserRow,
  now: number,
): PartyMutationResult {
  if (
    nomination.nomineeId !== actor.id &&
    nomination.nominatedBy !== actor.id
  ) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only the nominee or nominator can cancel this nomination",
    );
  }
  if (nomination.state !== "pending") {
    throw new HttpError(409, "CONFLICT", "Nomination is no longer pending");
  }

  db.update(questNominations)
    .set({ state: "cancelled", resolvedAt: now })
    .where(eq(questNominations.id, nomination.id))
    .run();

  return { signals: questSignals(quest) };
}

/**
 * Join a quest.
 *
 * An active member is a no-op. Otherwise the row is upserted to `joined`; if
 * the user has a pending nomination it is accepted (recording `claimed` and
 * paying guide XP for relays), else `member_joined` is recorded. Joining
 * claims the quest and assigns a leader when there is none.
 */
function joinQuest(
  db: AppDb,
  quest: QuestRow,
  actor: UserRow,
  now: number,
): PartyMutationResult {
  const existing = findPartyMember(db, quest.id, actor.id);
  if (existing && existing.status !== "retreated") {
    return { signals: noopSignals(quest) };
  }

  upsertActivePartyMember(db, quest.id, actor.id, now);

  const pending = getPendingNominations(db, quest.id).filter(
    (nomination) => nomination.nomineeId === actor.id,
  );
  const xp: XpChangedInput[] = [];

  if (pending.length > 0) {
    for (const nomination of pending) {
      db.update(questNominations)
        .set({ state: "accepted", resolvedAt: now })
        .where(eq(questNominations.id, nomination.id))
        .run();
      const award = awardGuideXp(db, nomination, now);
      if (award) {
        xp.push(award);
      }
    }
    insertQuestEvent(db, {
      questId: quest.id,
      projectId: quest.projectId,
      type: "claimed",
      payload: {},
      actorUserId: actor.id,
      createdAt: now,
    });
  } else {
    insertQuestEvent(db, {
      questId: quest.id,
      projectId: quest.projectId,
      type: "member_joined",
      payload: {},
      actorUserId: actor.id,
      createdAt: now,
    });
  }

  markQuestClaimed(db, quest, now);
  ensurePartyLeader(db, quest.id, now);
  const auto = applyAutoTransition(db, quest.id, actor.id, now);

  return {
    signals: {
      projectId: quest.projectId,
      questId: quest.id,
      notifications: auto.notifications,
      xp,
    },
  };
}

/**
 * Leave a quest (후퇴): the row stays with `retreated`. A departing leader
 * hands the party to the earliest-joined remaining member.
 */
function leaveQuest(
  db: AppDb,
  quest: QuestRow,
  actor: UserRow,
  reason: string | undefined,
  now: number,
): PartyMutationResult {
  const member = findActivePartyMember(db, quest.id, actor.id);
  if (!member) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only an active party member can leave",
    );
  }

  const wasLeader = member.role === "leader";
  db.update(partyMembers)
    .set({
      status: "retreated",
      retreatReason: reason ?? null,
      role: wasLeader ? "member" : member.role,
      updatedAt: now,
    })
    .where(
      and(
        eq(partyMembers.questId, quest.id),
        eq(partyMembers.userId, actor.id),
      ),
    )
    .run();

  insertQuestEvent(db, {
    questId: quest.id,
    projectId: quest.projectId,
    type: "member_left",
    payload: { reason: reason ?? null },
    actorUserId: actor.id,
    createdAt: now,
  });

  if (wasLeader) {
    const next = getActivePartyMembers(db, quest.id)[0];
    if (next) {
      db.update(partyMembers)
        .set({ role: "leader", updatedAt: now })
        .where(
          and(
            eq(partyMembers.questId, quest.id),
            eq(partyMembers.userId, next.userId),
          ),
        )
        .run();
      const nextUser = db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, next.userId))
        .get();
      insertQuestEvent(db, {
        questId: quest.id,
        projectId: quest.projectId,
        type: "leader_changed",
        payload: {
          userId: next.userId,
          name: nextUser?.displayName ?? "알 수 없는 모험가",
        },
        actorUserId: actor.id,
        createdAt: now,
      });
    }
  }

  const auto = applyAutoTransition(db, quest.id, actor.id, now);
  return {
    signals: {
      projectId: quest.projectId,
      questId: quest.id,
      notifications: auto.notifications,
      xp: [],
    },
  };
}

/** Change the actor's own clear status, then let the stage machine react. */
function changeMemberStatus(
  db: AppDb,
  quest: QuestRow,
  actor: UserRow,
  status: ActiveMemberStatus,
  now: number,
): PartyMutationResult {
  const member = findActivePartyMember(db, quest.id, actor.id);
  if (!member) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only an active party member can change their status",
    );
  }
  if (member.status === status) {
    return { signals: noopSignals(quest) };
  }

  db.update(partyMembers)
    .set({ status, updatedAt: now })
    .where(
      and(
        eq(partyMembers.questId, quest.id),
        eq(partyMembers.userId, actor.id),
      ),
    )
    .run();

  insertQuestEvent(db, {
    questId: quest.id,
    projectId: quest.projectId,
    type: "member_status_changed",
    payload: { from: member.status, to: status },
    actorUserId: actor.id,
    createdAt: now,
  });

  const auto = applyAutoTransition(db, quest.id, actor.id, now);
  return {
    signals: {
      projectId: quest.projectId,
      questId: quest.id,
      notifications: auto.notifications,
      xp: [],
    },
  };
}

/** Pending nominations addressed to `userId`, with their quest references. */
function listMyNominations(db: AppDb, actor: UserRow): MyNomination[] {
  const rows = db
    .select({
      nomination: questNominations,
      questNumber: quests.number,
      questTitle: quests.title,
    })
    .from(questNominations)
    .innerJoin(quests, eq(questNominations.questId, quests.id))
    .where(
      and(
        eq(questNominations.nomineeId, actor.id),
        eq(questNominations.state, "pending"),
      ),
    )
    .orderBy(desc(questNominations.createdAt), desc(questNominations.id))
    .all();
  if (rows.length === 0) {
    return [];
  }

  const nominatorIds = [
    ...new Set(rows.map((row) => row.nomination.nominatedBy)),
  ];
  const nominators = new Map(
    db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, nominatorIds))
      .all()
      .map((user) => [user.id, user] as const),
  );

  return rows.map(({ nomination, questNumber, questTitle }) => ({
    id: nomination.id,
    questId: nomination.questId,
    nominee: userRef(actor.id, actor.displayName),
    nominatedBy: {
      id: nomination.nominatedBy,
      displayName:
        nominators.get(nomination.nominatedBy)?.displayName ??
        "알 수 없는 모험가",
    },
    kind: nomination.kind,
    state: nomination.state,
    passReason: nomination.passReason,
    createdAt: nomination.createdAt,
    questNumber,
    questTitle,
  }));
}

/** Load a quest's detail view after a committed mutation. */
function detail(db: AppDb, questId: number): QuestDetail {
  return loadQuestDetail(db, questId);
}

export const partyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/api/quests/:id/nominations",
    {
      schema: {
        params: questParamsSchema,
        body: nominateRequestSchema,
        response: { 200: nominationListResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const db = request.server.db;
      const now = Date.now();

      const result = db.transaction((tx) => {
        const quest = requireQuest(tx, request.params.id, user.id);
        requirePartyStage(quest, true);
        return createNominationBatch(
          tx,
          quest,
          user,
          request.body.userIds,
          "nominate",
          now,
        );
      });

      emitSignals(request.server.realtime, result.signals);
      return { nominations: result.nominations };
    },
  );

  app.post(
    "/api/quests/:id/reinforcements",
    {
      schema: {
        params: questParamsSchema,
        body: nominateRequestSchema,
        response: { 200: nominationListResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const db = request.server.db;
      const now = Date.now();

      const result = db.transaction((tx) => {
        const quest = requireQuest(tx, request.params.id, user.id);
        requirePartyStage(quest, true);
        return createNominationBatch(
          tx,
          quest,
          user,
          request.body.userIds,
          "reinforce",
          now,
        );
      });

      emitSignals(request.server.realtime, result.signals);
      return { nominations: result.nominations };
    },
  );

  app.post(
    "/api/nominations/:id/accept",
    {
      schema: {
        params: nominationParamsSchema,
        response: { 200: questDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const db = request.server.db;
      const now = Date.now();

      const result = db.transaction((tx) => {
        const { nomination, quest } = requireNomination(
          tx,
          request.params.id,
          user.id,
        );
        requirePartyStage(quest, true);
        return {
          questId: quest.id,
          mutation: acceptNomination(tx, quest, nomination, user, now),
        };
      });

      emitSignals(request.server.realtime, result.mutation.signals);
      return detail(db, result.questId);
    },
  );

  app.post(
    "/api/nominations/:id/pass",
    {
      schema: {
        params: nominationParamsSchema,
        body: passNominationRequestSchema.optional(),
        response: { 200: questDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const db = request.server.db;
      const now = Date.now();

      const result = db.transaction((tx) => {
        const { nomination, quest } = requireNomination(
          tx,
          request.params.id,
          user.id,
        );
        requirePartyStage(quest, true);
        return {
          questId: quest.id,
          mutation: passNomination(
            tx,
            quest,
            nomination,
            user,
            request.body ?? {},
            now,
          ),
        };
      });

      emitSignals(request.server.realtime, result.mutation.signals);
      return detail(db, result.questId);
    },
  );

  app.delete(
    "/api/nominations/:id",
    {
      schema: {
        params: nominationParamsSchema,
      },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      const db = request.server.db;
      const now = Date.now();

      const signals = db.transaction((tx) => {
        const { nomination, quest } = requireNomination(
          tx,
          request.params.id,
          user.id,
        );
        requirePartyStage(quest, false);
        return cancelNomination(tx, quest, nomination, user, now).signals;
      });

      emitSignals(request.server.realtime, signals);
      reply.code(204);
      return reply.send();
    },
  );

  app.post(
    "/api/quests/:id/join",
    {
      schema: {
        params: questParamsSchema,
        response: { 200: questDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const db = request.server.db;
      const now = Date.now();

      const result = db.transaction((tx) => {
        const quest = requireQuest(tx, request.params.id, user.id);
        requirePartyStage(quest, true);
        return { questId: quest.id, mutation: joinQuest(tx, quest, user, now) };
      });

      emitSignals(request.server.realtime, result.mutation.signals);
      return detail(db, result.questId);
    },
  );

  app.post(
    "/api/quests/:id/leave",
    {
      schema: {
        params: questParamsSchema,
        body: leavePartyRequestSchema.optional(),
        response: { 200: questDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const db = request.server.db;
      const now = Date.now();

      const result = db.transaction((tx) => {
        const quest = requireQuest(tx, request.params.id, user.id);
        requirePartyStage(quest, true);
        return {
          questId: quest.id,
          mutation: leaveQuest(
            tx,
            quest,
            user,
            (request.body ?? {}).reason,
            now,
          ),
        };
      });

      emitSignals(request.server.realtime, result.mutation.signals);
      return detail(db, result.questId);
    },
  );

  app.post(
    "/api/quests/:id/status",
    {
      schema: {
        params: questParamsSchema,
        body: memberStatusRequestSchema,
        response: { 200: questDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const db = request.server.db;
      const now = Date.now();

      const result = db.transaction((tx) => {
        const quest = requireQuest(tx, request.params.id, user.id);
        requirePartyStage(quest, true);
        return {
          questId: quest.id,
          mutation: changeMemberStatus(
            tx,
            quest,
            user,
            request.body.status,
            now,
          ),
        };
      });

      emitSignals(request.server.realtime, result.mutation.signals);
      return detail(db, result.questId);
    },
  );

  app.get(
    "/api/me/nominations",
    {
      schema: {
        response: { 200: myNominationsResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      return listMyNominations(request.server.db, user);
    },
  );
};
