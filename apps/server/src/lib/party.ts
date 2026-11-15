/**
 * Party, nomination and quest-event helpers.
 *
 * Routes keep their HTTP concerns in `routes/*.ts`; this module owns the
 * domain primitives they share with later milestones (party reads, event log
 * appends, inbox notifications, order keys and the automatic stage machine).
 *
 * Every function takes an `AppDb`, which may be a transaction handle: callers
 * wrap a mutation and these helpers together so the rows, the event log and
 * the notifications commit or roll back as one unit.
 */
import type {
  Notification,
  NotificationType,
  QuestEventType,
  Stage,
} from "@guildloom/shared";
import { and, desc, eq, ne } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";

import type { AppDb } from "../db/index.js";
import {
  notifications,
  partyMembers,
  questEvents,
  questNominations,
  quests,
  users,
  type NotificationRow,
  type PartyMemberRow,
  type QuestNominationRow,
  type QuestRow,
} from "../db/schema.js";

/** Insert payload for a quest event. */
export interface QuestEventInput {
  questId: number;
  projectId: number;
  type: QuestEventType;
  payload: unknown;
  actorUserId: number | null;
  familiarId?: number | null;
  createdAt: number;
}

/** Input for {@link createNotification}. */
export interface CreateNotificationInput {
  /** Recipient. */
  userId: number;
  projectId: number;
  /** Quest the notification refers to, or `null` for a guild-level message. */
  questId: number | null;
  type: NotificationType;
  /** Who triggered the notification; `null`/omitted for system messages. */
  actorUserId?: number | null;
  /** JSON payload stored on the row (defaults to `{}`). */
  payload?: unknown;
  createdAt: number;
}

/** A created notification plus its recipient. */
export interface CreatedNotification {
  userId: number;
  notification: Notification;
}

/** Result of {@link applyAutoTransition}. */
export interface AutoTransitionResult {
  /** Last stage the quest was automatically moved to, or `null`. */
  movedTo: Stage | null;
  /** Notifications produced by the moves (currently `boss_engaged`). */
  notifications: CreatedNotification[];
}

/** Ordering of party rows: leader first, then oldest membership. */
function comparePartyRows(left: PartyMemberRow, right: PartyMemberRow): number {
  if (left.role !== right.role) {
    return left.role === "leader" ? -1 : 1;
  }
  if (left.joinedAt !== right.joinedAt) {
    return left.joinedAt - right.joinedAt;
  }
  return left.userId - right.userId;
}

/** Every party row of a quest, retreated members included (leader first). */
export function getPartyMembers(
  db: AppDb,
  questId: number,
): PartyMemberRow[] {
  return db
    .select()
    .from(partyMembers)
    .where(eq(partyMembers.questId, questId))
    .all()
    .sort(comparePartyRows);
}

/** Active party rows (`retreated` excluded), leader first then joined_at. */
export function getActivePartyMembers(
  db: AppDb,
  questId: number,
): PartyMemberRow[] {
  return getPartyMembers(db, questId).filter(
    (member) => member.status !== "retreated",
  );
}

/** A party row by its composite key, or `null`. */
export function findPartyMember(
  db: AppDb,
  questId: number,
  userId: number,
): PartyMemberRow | null {
  return (
    db
      .select()
      .from(partyMembers)
      .where(
        and(
          eq(partyMembers.questId, questId),
          eq(partyMembers.userId, userId),
        ),
      )
      .get() ?? null
  );
}

/** A party row when the user has an active (non-retreated) membership. */
export function findActivePartyMember(
  db: AppDb,
  questId: number,
  userId: number,
): PartyMemberRow | null {
  const member = findPartyMember(db, questId, userId);
  if (!member || member.status === "retreated") {
    return null;
  }
  return member;
}

/**
 * Join a quest: insert a `joined` row or reactivate a retreated one.
 *
 * An already active member is returned untouched, so calling this twice can
 * never demote a `fighting`/`done` member back to `joined`.
 */
export function upsertActivePartyMember(
  db: AppDb,
  questId: number,
  userId: number,
  now: number,
): PartyMemberRow {
  const existing = findPartyMember(db, questId, userId);
  if (!existing) {
    return db
      .insert(partyMembers)
      .values({
        questId,
        userId,
        role: "member",
        status: "joined",
        retreatReason: null,
        joinedAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }

  if (existing.status !== "retreated") {
    return existing;
  }

  return db
    .update(partyMembers)
    .set({
      status: "joined",
      retreatReason: null,
      joinedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(partyMembers.questId, questId),
        eq(partyMembers.userId, userId),
      ),
    )
    .returning()
    .get();
}

/** Promote the earliest-joined active member when the party has no leader. */
export function ensurePartyLeader(
  db: AppDb,
  questId: number,
  now: number,
): PartyMemberRow | null {
  const active = getActivePartyMembers(db, questId);
  if (active.length === 0 || active.some((member) => member.role === "leader")) {
    return null;
  }

  const first = active[0];
  if (!first) {
    return null;
  }

  return db
    .update(partyMembers)
    .set({ role: "leader", updatedAt: now })
    .where(
      and(
        eq(partyMembers.questId, questId),
        eq(partyMembers.userId, first.userId),
      ),
    )
    .returning()
    .get();
}

/** Freeze the bounty by recording when the first member claimed the quest. */
export function markQuestClaimed(
  db: AppDb,
  quest: QuestRow,
  now: number,
): boolean {
  if (quest.firstClaimedAt !== null) {
    return false;
  }

  db.update(quests)
    .set({
      firstClaimedAt: now,
      updatedAt: Math.max(now, quest.updatedAt + 1),
    })
    .where(eq(quests.id, quest.id))
    .run();
  return true;
}

/** Append a quest event row; the caller serializes the payload. */
export function insertQuestEvent(db: AppDb, input: QuestEventInput): void {
  db.insert(questEvents)
    .values({
      questId: input.questId,
      projectId: input.projectId,
      type: input.type,
      payload: JSON.stringify(input.payload ?? {}),
      actorUserId: input.actorUserId,
      familiarId: input.familiarId ?? null,
      createdAt: input.createdAt,
    })
    .run();
}

/**
 * Store an inbox notification and return the shared API shape.
 *
 * `questNumber`, `questTitle` and the actor reference are resolved here so
 * every caller produces an identical `Notification`.
 */
export function createNotification(
  db: AppDb,
  input: CreateNotificationInput,
): CreatedNotification {
  const actorUserId = input.actorUserId ?? null;
  const payload = input.payload ?? {};

  const actor =
    actorUserId === null
      ? null
      : (db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(eq(users.id, actorUserId))
          .get() ?? null);

  const quest =
    input.questId === null
      ? null
      : (db
          .select({ number: quests.number, title: quests.title })
          .from(quests)
          .where(eq(quests.id, input.questId))
          .get() ?? null);

  const row: NotificationRow = db
    .insert(notifications)
    .values({
      userId: input.userId,
      projectId: input.projectId,
      questId: input.questId,
      type: input.type,
      actorUserId,
      payload: JSON.stringify(payload),
      createdAt: input.createdAt,
    })
    .returning()
    .get();

  return {
    userId: input.userId,
    notification: {
      id: row.id,
      projectId: row.projectId,
      questId: row.questId,
      questNumber: quest?.number ?? null,
      questTitle: quest?.title ?? null,
      type: row.type,
      actor,
      payload,
      createdAt: row.createdAt,
      readAt: row.readAt,
    },
  };
}

/** Last order key in a stage, or `null` when the column is empty. */
function lastOrderKey(
  db: AppDb,
  projectId: number,
  stage: Stage,
): string | null {
  const row = db
    .select({ orderKey: quests.orderKey })
    .from(quests)
    .where(and(eq(quests.projectId, projectId), eq(quests.stage, stage)))
    .orderBy(desc(quests.orderKey))
    .limit(1)
    .get();
  return row?.orderKey ?? null;
}

/** Order key that appends a card at the bottom of `stage`. */
export function bottomOrderKey(
  db: AppDb,
  projectId: number,
  stage: Stage,
): string {
  return generateKeyBetween(lastOrderKey(db, projectId, stage), null);
}

/** How many automatic stage changes one call may cascade through. */
const MAX_AUTO_TRANSITIONS = 8;

/** The next stage the stage machine demands, or `null` when it is stable. */
function nextAutoStage(
  stage: Stage,
  memberStatuses: readonly PartyMemberRow["status"][],
): Stage | null {
  const hasMember = memberStatuses.length > 0;

  // (1) Someone started fighting on the board.
  if (stage === "board" && memberStatuses.includes("fighting")) {
    return "dungeon";
  }
  // (2) Every active member finished: the boss appears.
  if (
    (stage === "board" || stage === "dungeon") &&
    hasMember &&
    memberStatuses.every((status) => status === "done")
  ) {
    return "boss";
  }
  // (3) A new member joined a boss fight: back to the dungeon.
  if (stage === "boss" && memberStatuses.some((status) => status !== "done")) {
    return "dungeon";
  }
  // (4) The dungeon emptied out: the quest returns to the board.
  if (stage === "dungeon" && !hasMember) {
    return "board";
  }
  return null;
}

/** Move a quest to `to` at the bottom of the target column, logging the move. */
function autoMoveQuest(
  db: AppDb,
  quest: QuestRow,
  to: Stage,
  actorUserId: number | null,
  now: number,
): void {
  db.update(quests)
    .set({
      stage: to,
      orderKey: bottomOrderKey(db, quest.projectId, to),
      updatedAt: Math.max(now, quest.updatedAt + 1),
    })
    .where(eq(quests.id, quest.id))
    .run();

  insertQuestEvent(db, {
    questId: quest.id,
    projectId: quest.projectId,
    type: "quest_moved",
    payload: { from: quest.stage, to, auto: true },
    actorUserId,
    createdAt: now,
  });
}

/**
 * Run the automatic stage machine until it is stable.
 *
 * Rules, in order:
 * 1. `board` with a fighting member moves to `dungeon`;
 * 2. `board`/`dungeon` where every active member is `done` moves to `boss`
 *    (logging `boss_engaged` and notifying the requester);
 * 3. `boss` with an active member that is not `done` moves back to `dungeon`;
 * 4. an empty `dungeon` moves back to `board`.
 *
 * The rules cascade in one call (e.g. a join can push `boss` to `dungeon`),
 * and every move appends to the bottom of its column and records
 * `quest_moved {from,to,auto:true}`. Manual `/move` never calls this.
 */
export function applyAutoTransition(
  db: AppDb,
  questId: number,
  actorUserId: number | null,
  now: number,
): AutoTransitionResult {
  const created: CreatedNotification[] = [];
  let movedTo: Stage | null = null;

  for (let step = 0; step < MAX_AUTO_TRANSITIONS; step += 1) {
    const quest = db
      .select()
      .from(quests)
      .where(eq(quests.id, questId))
      .get();
    if (!quest) {
      break;
    }

    const statuses = getActivePartyMembers(db, questId).map(
      (member) => member.status,
    );
    const target = nextAutoStage(quest.stage, statuses);
    if (target === null) {
      break;
    }

    autoMoveQuest(db, quest, target, actorUserId, now);
    movedTo = target;

    if (target === "boss") {
      insertQuestEvent(db, {
        questId,
        projectId: quest.projectId,
        type: "boss_engaged",
        payload: {},
        actorUserId,
        createdAt: now,
      });
      if (quest.createdBy !== actorUserId) {
        created.push(
          createNotification(db, {
            userId: quest.createdBy,
            projectId: quest.projectId,
            questId,
            type: "boss_engaged",
            actorUserId,
            payload: {},
            createdAt: now,
          }),
        );
      }
    }
  }

  return { movedTo, notifications: created };
}

/** Pending nominations for a quest, oldest first. */
export function getPendingNominations(
  db: AppDb,
  questId: number,
): QuestNominationRow[] {
  return db
    .select()
    .from(questNominations)
    .where(
      and(
        eq(questNominations.questId, questId),
        eq(questNominations.state, "pending"),
      ),
    )
    .orderBy(questNominations.createdAt, questNominations.id)
    .all();
}

/** Active member ids of a quest (used for nomination skip rules). */
export function getActivePartyUserIds(
  db: AppDb,
  questId: number,
): Set<number> {
  return new Set(
    db
      .select({ userId: partyMembers.userId })
      .from(partyMembers)
      .where(
        and(
          eq(partyMembers.questId, questId),
          ne(partyMembers.status, "retreated"),
        ),
      )
      .all()
      .map((row) => row.userId),
  );
}
