/**
 * Quest routes (`/api/projects/:pid/quests`, `/api/quests/*`).
 *
 * All endpoints require an authenticated session and membership of the quest's
 * project. Mutations run in a single SQLite transaction and append the matching
 * quest event in that same transaction, so the event log can never drift from
 * the quest rows.
 *
 * Keep the export name `questRoutes`: `app.ts` registers this plugin.
 */
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  QUEST_EDITABLE_FIELDS,
  STAGES,
  archiveQuestRequestSchema,
  bulkCreateQuestsRequestSchema,
  clearQuestResponseSchema,
  computeBounty,
  createQuestRefRequestSchema,
  createQuestRequestSchema,
  listQuestsQuerySchema,
  moveQuestRequestSchema,
  parseChecklist,
  questEventsResponseSchema,
  questListResponseSchema,
  questRefSchema,
  questSchema,
  questSummarySchema,
  refKind,
  retryQuestRequestSchema,
  updateQuestRequestSchema,
  type ArchiveQuestRequest,
  type BulkCreateQuestsRequest,
  type CreateQuestRefRequest,
  type CreateQuestRequest,
  type ListQuestsQuery,
  type MoveQuestRequest,
  type Nomination,
  type PartyMember,
  type PartySummary,
  type Quest,
  type QuestEditableField,
  type QuestEvent,
  type QuestEventType,
  type QuestRef,
  type QuestSummary,
  type RetryQuestRequest,
  type Stage,
  type UpdateQuestRequest,
  type UserRef,
} from "@guildloom/shared";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";

import type { AppDb } from "../db/index.js";
import {
  partyMembers,
  projects,
  questEvents,
  questNominations,
  questRefs,
  questTags,
  quests,
  tags,
  users,
  type ProjectRow,
  type QuestNominationRow,
  type QuestRow,
  type TagRow,
  type UserRow,
} from "../db/schema.js";
import { authenticate, requireMembership } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import {
  bottomOrderKey,
  createNotification,
  getActivePartyMembers,
  insertQuestEvent,
  type CreatedNotification,
} from "../lib/party.js";
import type { Realtime, XpChangedInput } from "../lib/realtime.js";
import { settleClear, type ClearSettlement } from "../lib/settlement.js";

/** Numeric route parameters (`:pid`, `:id`). */
const projectParamsSchema = z.object({
  pid: z.coerce.number().int().positive(),
});
const questParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});
const refParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** A quest row together with its creator. */
interface QuestWithCreator {
  quest: QuestRow;
  creator: UserRow;
}

/** The authenticated user of a request (the `authenticate` preHandler ran). */
function currentUser(request: FastifyRequest): UserRow {
  if (!request.user) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  }
  return request.user;
}

/** Resolve `:pid` to a project the user is a member of. */
function requireProject(
  db: AppDb,
  projectId: number,
  userId: number,
): ProjectRow {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    throw new HttpError(404, "NOT_FOUND", "Project not found");
  }
  requireMembership(db, userId, projectId);
  return project;
}

/** Load a quest row or throw the standard 404. */
function loadQuestRow(db: AppDb, questId: number): QuestRow {
  const quest = db.select().from(quests).where(eq(quests.id, questId)).get();
  if (!quest) {
    throw new HttpError(404, "NOT_FOUND", "Quest not found");
  }
  return quest;
}

/** Load a quest row the user may access (404 when missing, 403 when not a member). */
function requireQuest(db: AppDb, questId: number, userId: number): QuestRow {
  const quest = loadQuestRow(db, questId);
  requireMembership(db, userId, quest.projectId);
  return quest;
}

/** Escape `%`, `_` and `\` so user input is matched literally inside LIKE. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Build an escaped `%value%` LIKE pattern. */
function likeContains(value: string): string {
  return `%${escapeLike(value)}%`;
}

/** Deterministic code-unit ordering used for tag names. */
function sortNames(names: string[]): string[] {
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Trim and de-duplicate tag names, dropping empty entries. */
function normalizeTagNames(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const name = value.trim();
    if (name.length === 0 || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** Compare two tag-name collections ignoring order and duplicates. */
function sameNameSet(left: string[], right: string[]): boolean {
  const a = sortNames([...new Set(left)]);
  const b = sortNames([...new Set(right)]);
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

/** Next `updated_at` value, guaranteed to move forward even in the same ms. */
function nextUpdatedAt(previous: number): number {
  return Math.max(Date.now(), previous + 1);
}

/** Stages a clear may start from; every other stage conflicts. */
const CLEARABLE_STAGES: readonly Stage[] = ["board", "dungeon", "boss"];

/** Emit the realtime work a committed clear settlement produced. */
function emitSettlement(
  realtime: Realtime,
  projectId: number,
  questId: number,
  settlement: ClearSettlement,
): void {
  realtime.emitQuestChanged(projectId, questId);

  for (const change of settlement.xpChanges) {
    const input: XpChangedInput = {
      userId: change.userId,
      projectId,
      xp: change.xp,
      level: change.level,
    };
    if (change.levelUp) {
      input.levelUp = change.levelUp;
    }
    realtime.emitXpChanged(input);
  }

  for (const created of settlement.notifications) {
    realtime.emitNotification(created.userId, created.notification);
  }

  // The member list shows XP/level badges; refresh it even when every award
  // was an idempotent no-op.
  realtime.emitMembersChanged(projectId);
}

/** Emit collected notifications after their transaction committed. */
function emitNotifications(
  realtime: Realtime,
  notifications: readonly CreatedNotification[],
): void {
  for (const created of notifications) {
    realtime.emitNotification(created.userId, created.notification);
  }
}

/** All tag names attached to each of `questIds`, sorted by name. */
function loadTagNamesByQuest(
  db: AppDb,
  questIds: number[],
): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (questIds.length === 0) {
    return result;
  }

  const rows = db
    .select({ questId: questTags.questId, name: tags.name })
    .from(questTags)
    .innerJoin(tags, eq(questTags.tagId, tags.id))
    .where(inArray(questTags.questId, questIds))
    .all();

  const names: number[] = [...new Set(rows.map((row) => row.questId))];
  for (const questId of names) {
    result.set(
      questId,
      sortNames(
        rows
          .filter((row) => row.questId === questId)
          .map((row) => row.name),
      ),
    );
  }
  return result;
}

/** Active party summaries of every quest, keyed by quest id (no N+1). */
function loadActivePartySummaries(
  db: AppDb,
  questIds: number[],
): Map<number, PartySummary[]> {
  const result = new Map<number, PartySummary[]>();
  if (questIds.length === 0) {
    return result;
  }

  const rows = db
    .select({
      questId: partyMembers.questId,
      userId: partyMembers.userId,
      displayName: users.displayName,
      role: partyMembers.role,
      status: partyMembers.status,
      joinedAt: partyMembers.joinedAt,
    })
    .from(partyMembers)
    .innerJoin(users, eq(partyMembers.userId, users.id))
    .where(
      and(
        inArray(partyMembers.questId, questIds),
        ne(partyMembers.status, "retreated"),
      ),
    )
    .all();

  // Leader first, then by join order, matching the detail read model.
  rows.sort((left, right) => {
    if (left.questId !== right.questId) {
      return left.questId - right.questId;
    }
    if (left.role !== right.role) {
      return left.role === "leader" ? -1 : 1;
    }
    if (left.joinedAt !== right.joinedAt) {
      return left.joinedAt - right.joinedAt;
    }
    return left.userId - right.userId;
  });

  for (const row of rows) {
    const party = result.get(row.questId) ?? [];
    party.push({
      userId: row.userId,
      displayName: row.displayName,
      role: row.role,
      status: row.status,
    });
    result.set(row.questId, party);
  }
  return result;
}

/** Reference documents of a quest, ordered by id (oldest first). */
function loadQuestRefs(db: AppDb, questId: number): QuestRef[] {
  return db
    .select({ ref: questRefs, creator: users })
    .from(questRefs)
    .innerJoin(users, eq(questRefs.createdBy, users.id))
    .where(eq(questRefs.questId, questId))
    .orderBy(asc(questRefs.id))
    .all()
    .map(({ ref, creator }) => ({
      id: ref.id,
      label: ref.label,
      target: ref.target,
      kind: refKind(ref.target),
      createdBy: { id: creator.id, displayName: creator.displayName },
      createdAt: ref.createdAt,
    }));
}

/** Number of pending nominations per quest, keyed by quest id. */
function loadPendingNominationCounts(
  db: AppDb,
  questIds: number[],
): Map<number, number> {
  const result = new Map<number, number>();
  if (questIds.length === 0) {
    return result;
  }

  const rows = db
    .select({
      questId: questNominations.questId,
      total: sql<number>`count(*)`,
    })
    .from(questNominations)
    .where(
      and(
        inArray(questNominations.questId, questIds),
        eq(questNominations.state, "pending"),
      ),
    )
    .groupBy(questNominations.questId)
    .all();

  for (const row of rows) {
    result.set(row.questId, Number(row.total));
  }
  return result;
}

/** Summary-only extras: the data a board card needs beyond the quest row. */
interface QuestSummaryExtras {
  party: PartySummary[];
  floors: { done: number; total: number };
  pendingNominations: number;
}

/** Detail-only extras: the full party, pending nominations and references. */
interface QuestDetailExtras {
  party: PartyMember[];
  nominations: Nomination[];
  refs: QuestRef[];
}

/**
 * The quest detail exposed by the quest routes.
 *
 * The checklist progress replaces the deprecated floor rows: both the board
 * summary and the detail report `{ done, total }` parsed from `direction`.
 */
export type QuestDetail = Omit<Quest, "floors"> & {
  floors: { done: number; total: number };
};

/**
 * Detail response schema of the quest routes.
 *
 * The shared `questSchema` still serializes the deprecated floor rows for the
 * not-yet-migrated web client (T04 removes them together with the floor
 * exports). This local override keeps the server contract on the checklist
 * progress without editing the shared package.
 */
const questDetailResponseSchema = questSchema.extend({
  floors: questSummarySchema.shape.floors,
});
const questDetailListResponseSchema = z.array(questDetailResponseSchema);
const clearQuestDetailResponseSchema = clearQuestResponseSchema.extend({
  quest: questDetailResponseSchema,
});

/** Serialize a quest row plus its tag names and live board data. */
function toQuestSummary(
  entry: QuestWithCreator,
  tagNames: string[],
  extras: QuestSummaryExtras,
  now: number,
): QuestSummary {
  return {
    id: entry.quest.id,
    number: entry.quest.number,
    title: entry.quest.title,
    stage: entry.quest.stage,
    kind: entry.quest.kind,
    rank: entry.quest.rank,
    orderKey: entry.quest.orderKey,
    tags: sortNames(tagNames),
    createdBy: {
      id: entry.creator.id,
      displayName: entry.creator.displayName,
    },
    createdAt: entry.quest.createdAt,
    updatedAt: entry.quest.updatedAt,
    party: extras.party,
    floors: extras.floors,
    pendingNominations: extras.pendingNominations,
    bounty: computeBounty({
      createdAt: entry.quest.createdAt,
      firstClaimedAt: entry.quest.firstClaimedAt,
      now,
    }),
  };
}

/** Serialize a quest row plus its full detail collections. */
function toQuest(
  entry: QuestWithCreator,
  tagNames: string[],
  detail: QuestDetailExtras,
  now: number,
): QuestDetail {
  const activeParty: PartySummary[] = detail.party
    .filter((member) => member.status !== "retreated")
    .map((member) => ({
      userId: member.user.id,
      displayName: member.user.displayName,
      role: member.role,
      status: member.status,
    }));
  const checklist = parseChecklist(entry.quest.direction);

  const summary = toQuestSummary(
    entry,
    tagNames,
    {
      party: activeParty,
      floors: { done: checklist.done, total: checklist.total },
      pendingNominations: detail.nominations.length,
    },
    now,
  );

  return {
    ...summary,
    projectId: entry.quest.projectId,
    situation: entry.quest.situation,
    direction: entry.quest.direction,
    archiveReason: entry.quest.archiveReason,
    party: detail.party,
    nominations: detail.nominations,
    refs: detail.refs,
    firstClaimedAt: entry.quest.firstClaimedAt,
  };
}

/** A `{id, displayName}` reference for a user id present in `byId`. */
function userRef(byId: Map<number, UserRow>, userId: number): UserRef {
  const user = byId.get(userId);
  return {
    id: userId,
    displayName: user?.displayName ?? "알 수 없는 모험가",
  };
}

/** All party rows of a quest (retreated included), leader first. */
function loadQuestParty(db: AppDb, questId: number): PartyMember[] {
  return db
    .select({ member: partyMembers, user: users })
    .from(partyMembers)
    .innerJoin(users, eq(partyMembers.userId, users.id))
    .where(eq(partyMembers.questId, questId))
    .all()
    .sort((left, right) => {
      if (left.member.role !== right.member.role) {
        return left.member.role === "leader" ? -1 : 1;
      }
      if (left.member.joinedAt !== right.member.joinedAt) {
        return left.member.joinedAt - right.member.joinedAt;
      }
      return left.member.userId - right.member.userId;
    })
    .map(({ member, user }) => ({
      user: { id: user.id, displayName: user.displayName },
      role: member.role,
      status: member.status,
      retreatReason: member.retreatReason,
      joinedAt: member.joinedAt,
    }));
}

/** The quest's pending nominations with both user references resolved. */
function loadPendingNominations(db: AppDb, questId: number): Nomination[] {
  const rows = db
    .select()
    .from(questNominations)
    .where(
      and(
        eq(questNominations.questId, questId),
        eq(questNominations.state, "pending"),
      ),
    )
    .orderBy(asc(questNominations.createdAt), asc(questNominations.id))
    .all();
  if (rows.length === 0) {
    return [];
  }

  return toNominations(db, rows, new Map<number, UserRow>());
}

/**
 * Map nomination rows to the API shape, resolving nominee/nominator names in
 * one batch. `knownUsers` may pre-seed names the caller already loaded.
 */
function toNominations(
  db: AppDb,
  rows: QuestNominationRow[],
  knownUsers: Map<number, UserRow>,
): Nomination[] {
  const userIds = new Set<number>();
  for (const row of rows) {
    if (!knownUsers.has(row.nomineeId)) {
      userIds.add(row.nomineeId);
    }
    if (!knownUsers.has(row.nominatedBy)) {
      userIds.add(row.nominatedBy);
    }
  }

  const byId = new Map(knownUsers);
  if (userIds.size > 0) {
    const loaded = db
      .select()
      .from(users)
      .where(inArray(users.id, [...userIds]))
      .all();
    for (const user of loaded) {
      byId.set(user.id, user);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    questId: row.questId,
    nominee: userRef(byId, row.nomineeId),
    nominatedBy: userRef(byId, row.nominatedBy),
    kind: row.kind,
    state: row.state,
    passReason: row.passReason,
    createdAt: row.createdAt,
  }));
}

/** Load the full `QuestDetail` representation of `questId`. */
export function loadQuestDetail(db: AppDb, questId: number): QuestDetail {
  const entry = db
    .select({ quest: quests, creator: users })
    .from(quests)
    .innerJoin(users, eq(quests.createdBy, users.id))
    .where(eq(quests.id, questId))
    .get();
  if (!entry) {
    throw new HttpError(404, "NOT_FOUND", "Quest not found");
  }
  const tagNames = loadTagNamesByQuest(db, [questId]).get(questId) ?? [];
  return toQuest(
    entry,
    tagNames,
    {
      party: loadQuestParty(db, questId),
      nominations: loadPendingNominations(db, questId),
      refs: loadQuestRefs(db, questId),
    },
    Date.now(),
  );
}

/**
 * Compatibility detail view for routes that still serialize the shared
 * `questSchema` with its deprecated floor array (`routes/party.ts`). The floor
 * rows no longer exist, so the field is always empty; T04 removes it and this
 * wrapper together.
 */
export function loadQuestView(db: AppDb, questId: number): Quest {
  const detail = loadQuestDetail(db, questId);
  return { ...detail, floors: [] };
}

/** Fetch an existing project tag or create it in the project. */
function ensureTag(db: AppDb, projectId: number, name: string): TagRow {
  const existing = db
    .select()
    .from(tags)
    .where(and(eq(tags.projectId, projectId), eq(tags.name, name)))
    .get();
  if (existing) {
    return existing;
  }
  return db
    .insert(tags)
    .values({ projectId, name })
    .returning()
    .get();
}

/** Attach (already normalized) tag names to a quest, creating missing tags. */
function attachTags(
  db: AppDb,
  projectId: number,
  questId: number,
  names: string[],
): void {
  for (const name of names) {
    const tag = ensureTag(db, projectId, name);
    db.insert(questTags).values({ questId, tagId: tag.id }).run();
  }
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

/** Parse the stage query parameter into a validated stage list. */
function parseStageFilter(raw: string | undefined): Stage[] {
  const fallback = STAGES.filter((stage) => stage !== "archived");
  if (raw === undefined) {
    return fallback;
  }

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return fallback;
  }

  const stages: Stage[] = [];
  for (const part of parts) {
    if (!(STAGES as readonly string[]).includes(part)) {
      throw new HttpError(400, "VALIDATION_ERROR", `Invalid stage: ${part}`);
    }
    const stage = part as Stage;
    if (!stages.includes(stage)) {
      stages.push(stage);
    }
  }
  return stages;
}

/** List board cards for a project with the optional stage/tag/text filters. */
function listProjectQuests(
  db: AppDb,
  projectId: number,
  query: ListQuestsQuery,
): QuestSummary[] {
  const conditions: SQL[] = [eq(quests.projectId, projectId)];
  conditions.push(inArray(quests.stage, parseStageFilter(query.stage)));

  const tagFilter = query.tag?.trim() ?? "";
  if (tagFilter.length > 0) {
    const taggedQuestIds = db
      .select({ questId: questTags.questId })
      .from(questTags)
      .innerJoin(tags, eq(questTags.tagId, tags.id))
      .where(and(eq(tags.projectId, projectId), eq(tags.name, tagFilter)))
      .all()
      .map((row) => row.questId);
    if (taggedQuestIds.length === 0) {
      return [];
    }
    conditions.push(inArray(quests.id, taggedQuestIds));
  }

  const search = query.q?.trim() ?? "";
  if (search.length > 0) {
    const pattern = likeContains(search);
    const matches = or(
      sql`${quests.title} LIKE ${pattern} ESCAPE '\\'`,
      sql`${quests.situation} LIKE ${pattern} ESCAPE '\\'`,
      sql`${quests.direction} LIKE ${pattern} ESCAPE '\\'`,
    );
    if (matches) {
      conditions.push(matches);
    }
  }

  const rows = db
    .select({ quest: quests, creator: users })
    .from(quests)
    .innerJoin(users, eq(quests.createdBy, users.id))
    .where(and(...conditions))
    .orderBy(asc(quests.orderKey), asc(quests.id))
    .all();

  const tagNames = loadTagNamesByQuest(
    db,
    rows.map((row) => row.quest.id),
  );
  // Live board data is batch-loaded once for the whole page: party and pending
  // nomination counts never issue per-quest queries. Checklist progress is
  // parsed from each row's direction.
  const questIds = rows.map((row) => row.quest.id);
  const partyByQuest = loadActivePartySummaries(db, questIds);
  const pendingByQuest = loadPendingNominationCounts(db, questIds);
  const now = Date.now();

  return rows.map((row) => {
    const checklist = parseChecklist(row.quest.direction);
    return toQuestSummary(
      row,
      tagNames.get(row.quest.id) ?? [],
      {
        party: partyByQuest.get(row.quest.id) ?? [],
        floors: { done: checklist.done, total: checklist.total },
        pendingNominations: pendingByQuest.get(row.quest.id) ?? 0,
      },
      now,
    );
  });
}

/** Create one quest plus its `quest_posted` event inside a transaction. */
function createQuest(
  db: AppDb,
  projectId: number,
  actor: UserRow,
  body: CreateQuestRequest,
): QuestDetail {
  return db.transaction((tx) => {
    const project = tx
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    if (!project) {
      throw new HttpError(404, "NOT_FOUND", "Project not found");
    }

    const number = project.nextQuestNumber;
    const now = Date.now();
    const orderKey = bottomOrderKey(tx, projectId, "board");
    const tagNames = normalizeTagNames(body.tags);
    const title = body.title.trim();

    tx.update(projects)
      .set({ nextQuestNumber: number + 1 })
      .where(eq(projects.id, projectId))
      .run();

    const row = tx
      .insert(quests)
      .values({
        projectId,
        number,
        title,
        situation: body.situation ?? "",
        direction: body.direction ?? "",
        stage: "board",
        kind: body.kind ?? "fix",
        rank: body.rank ?? null,
        orderKey,
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    attachTags(tx, projectId, row.id, tagNames);
    insertQuestEvent(tx, {
      questId: row.id,
      projectId,
      type: "quest_posted",
      payload: { number, title },
      actorUserId: actor.id,
      createdAt: now,
    });

    return toQuest(
      { quest: row, creator: actor },
      tagNames,
      { party: [], nominations: [], refs: [] },
      now,
    );
  });
}

/** Create many quests (and their events) in a single transaction. */
function bulkCreateQuests(
  db: AppDb,
  projectId: number,
  actor: UserRow,
  body: BulkCreateQuestsRequest,
): QuestDetail[] {
  const titles = body.titles
    .map((title) => title.trim())
    .filter((title) => title.length > 0);
  if (titles.length === 0) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "At least one non-empty title is required",
    );
  }
  if (titles.length > 100) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "At most 100 quests can be created at once",
    );
  }

  return db.transaction((tx) => {
    const project = tx
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    if (!project) {
      throw new HttpError(404, "NOT_FOUND", "Project not found");
    }

    const now = Date.now();
    let number = project.nextQuestNumber;
    let previousKey = lastOrderKey(tx, projectId, "board");
    const created: QuestDetail[] = [];

    for (const title of titles) {
      const orderKey = generateKeyBetween(previousKey, null);
      previousKey = orderKey;

      const row = tx
        .insert(quests)
        .values({
          projectId,
          number,
          title,
          situation: "",
          direction: "",
          stage: "board",
          kind: "fix",
          rank: null,
          orderKey,
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      insertQuestEvent(tx, {
        questId: row.id,
        projectId,
        type: "quest_posted",
        payload: { number, title },
        actorUserId: actor.id,
        createdAt: now,
      });

      created.push(
        toQuest(
          { quest: row, creator: actor },
          [],
          { party: [], nominations: [], refs: [] },
          now,
        ),
      );
      number += 1;
    }

    tx.update(projects)
      .set({ nextQuestNumber: number })
      .where(eq(projects.id, projectId))
      .run();

    return created;
  });
}

/** Apply `PATCH /api/quests/:id` and record the changed field names. */
function updateQuestDetails(
  db: AppDb,
  questId: number,
  actor: UserRow,
  body: UpdateQuestRequest,
): QuestDetail {
  db.transaction((tx) => {
    const quest = requireQuest(tx, questId, actor.id);
    const changes: Partial<typeof quests.$inferInsert> = {};
    const changed: QuestEditableField[] = [];
    let replacementTags: string[] | null = null;

    if (body.title !== undefined) {
      const title = body.title.trim();
      if (title !== quest.title) {
        changes.title = title;
        changed.push("title");
      }
    }
    if (body.situation !== undefined && body.situation !== quest.situation) {
      changes.situation = body.situation;
      changed.push("situation");
    }
    if (body.direction !== undefined && body.direction !== quest.direction) {
      changes.direction = body.direction;
      changed.push("direction");
    }
    if (body.tags !== undefined) {
      const names = normalizeTagNames(body.tags);
      const current =
        loadTagNamesByQuest(tx, [quest.id]).get(quest.id) ?? [];
      if (!sameNameSet(names, current)) {
        replacementTags = names;
        changed.push("tags");
      }
    }
    if (body.rank !== undefined && body.rank !== quest.rank) {
      changes.rank = body.rank;
      changed.push("rank");
    }
    if (body.kind !== undefined && body.kind !== quest.kind) {
      changes.kind = body.kind;
      changed.push("kind");
    }

    const fields = QUEST_EDITABLE_FIELDS.filter((field) =>
      changed.includes(field),
    );
    if (fields.length === 0) {
      return;
    }

    tx.update(quests)
      .set({ ...changes, updatedAt: nextUpdatedAt(quest.updatedAt) })
      .where(eq(quests.id, quest.id))
      .run();

    if (replacementTags !== null) {
      tx.delete(questTags).where(eq(questTags.questId, quest.id)).run();
      attachTags(tx, quest.projectId, quest.id, replacementTags);
    }

    insertQuestEvent(tx, {
      questId: quest.id,
      projectId: quest.projectId,
      type: "quest_edited",
      payload: { fields },
      actorUserId: actor.id,
      createdAt: Date.now(),
    });
  });

  return loadQuestDetail(db, questId);
}

/** Load the order key of a move target neighbor, validating project and stage. */
function neighborOrderKey(
  db: AppDb,
  quest: QuestRow,
  stage: Stage,
  neighborId: number,
): string {
  if (neighborId === quest.id) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      "A quest cannot be its own move neighbor",
    );
  }

  const neighbor = db
    .select()
    .from(quests)
    .where(eq(quests.id, neighborId))
    .get();
  if (
    !neighbor ||
    neighbor.projectId !== quest.projectId ||
    neighbor.stage !== stage
  ) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      "Move neighbors must belong to the same project and target stage",
    );
  }
  return neighbor.orderKey;
}

/** Result of a move: the reloaded quest and any settlement it produced. */
interface MoveQuestResult {
  quest: QuestDetail;
  /** Set when the move targeted `cleared` and ran the clear settlement. */
  settlement: ClearSettlement | null;
}

/**
 * Apply `POST /api/quests/:id/move`.
 *
 * A manual move never runs the automatic stage machine. Dragging a card into
 * `cleared` settles the clear (idempotently) at the computed neighbor order
 * key; moving it back out keeps every award already paid.
 */
function moveQuest(
  db: AppDb,
  questId: number,
  actor: UserRow,
  body: MoveQuestRequest,
): MoveQuestResult {
  const outcome = db.transaction((tx) => {
    const quest = requireQuest(tx, questId, actor.id);
    const targetStage = body.stage;

    if (
      body.beforeId !== undefined &&
      body.afterId !== undefined &&
      body.beforeId === body.afterId
    ) {
      throw new HttpError(
        400,
        "BAD_REQUEST",
        "beforeId and afterId must be different quests",
      );
    }

    const beforeKey =
      body.beforeId === undefined
        ? null
        : neighborOrderKey(tx, quest, targetStage, body.beforeId);
    const afterKey =
      body.afterId === undefined
        ? null
        : neighborOrderKey(tx, quest, targetStage, body.afterId);

    const orderKey =
      beforeKey === null && afterKey === null
        ? bottomOrderKey(tx, quest.projectId, targetStage)
        : generateKeyBetween(beforeKey, afterKey);

    const now = Date.now();
    const stageChanged = quest.stage !== targetStage;

    if (stageChanged) {
      insertQuestEvent(tx, {
        questId: quest.id,
        projectId: quest.projectId,
        type: "quest_moved",
        payload: { from: quest.stage, to: targetStage },
        actorUserId: actor.id,
        createdAt: now,
      });
    }

    if (targetStage === "cleared") {
      // `settleClear` writes the stage/order key together with the ledger,
      // event and inbox rows, all inside this transaction.
      return { settlement: settleClear(tx, quest, actor, now, orderKey) };
    }

    tx.update(quests)
      .set({
        stage: targetStage,
        orderKey,
        updatedAt: nextUpdatedAt(quest.updatedAt),
      })
      .where(eq(quests.id, quest.id))
      .run();

    return { settlement: null };
  });

  return { quest: loadQuestDetail(db, questId), ...outcome };
}

/** Realtime work produced by a retry after its transaction committed. */
interface RetryQuestResult {
  projectId: number;
  questId: number;
  notifications: CreatedNotification[];
}

/**
 * Apply `POST /api/quests/:id/clear`.
 *
 * Any guild member may declare a clear of a quest that is still on the board,
 * in the dungeon or at the boss. The card is appended to the cleared column
 * and the settlement pays the party exactly once.
 */
function clearQuest(
  db: AppDb,
  questId: number,
  actor: UserRow,
  now: number,
): { questId: number; projectId: number; settlement: ClearSettlement } {
  return db.transaction((tx) => {
    const quest = requireQuest(tx, questId, actor.id);
    if (!CLEARABLE_STAGES.includes(quest.stage)) {
      throw new HttpError(
        409,
        "CONFLICT",
        `Quest in stage '${quest.stage}' cannot be cleared`,
      );
    }

    const orderKey = bottomOrderKey(tx, quest.projectId, "cleared");
    return {
      questId: quest.id,
      projectId: quest.projectId,
      settlement: settleClear(tx, quest, actor, now, orderKey),
    };
  });
}

/**
 * Apply `POST /api/quests/:id/retry` (재도전).
 *
 * Only a boss quest may be retried: it drops to the bottom of the dungeon and
 * every member that had finished goes back to fighting. The status reset is a
 * side effect of the retry, so it deliberately writes no
 * `member_status_changed` events; the requester comment is the event instead.
 */
function retryQuest(
  db: AppDb,
  questId: number,
  actor: UserRow,
  body: RetryQuestRequest,
  now: number,
): RetryQuestResult {
  return db.transaction((tx) => {
    const quest = requireQuest(tx, questId, actor.id);
    if (quest.stage !== "boss") {
      throw new HttpError(
        409,
        "CONFLICT",
        `Only a quest in stage 'boss' can be retried (current: '${quest.stage}')`,
      );
    }

    const activeMembers = getActivePartyMembers(tx, quest.id);

    tx.update(partyMembers)
      .set({ status: "fighting", updatedAt: now })
      .where(
        and(
          eq(partyMembers.questId, quest.id),
          eq(partyMembers.status, "done"),
        ),
      )
      .run();

    tx.update(quests)
      .set({
        stage: "dungeon",
        orderKey: bottomOrderKey(tx, quest.projectId, "dungeon"),
        updatedAt: nextUpdatedAt(quest.updatedAt),
      })
      .where(eq(quests.id, quest.id))
      .run();

    insertQuestEvent(tx, {
      questId: quest.id,
      projectId: quest.projectId,
      type: "quest_moved",
      payload: { from: "boss", to: "dungeon" },
      actorUserId: actor.id,
      createdAt: now,
    });
    insertQuestEvent(tx, {
      questId: quest.id,
      projectId: quest.projectId,
      type: "retry_requested",
      payload: { comment: body.comment },
      actorUserId: actor.id,
      createdAt: now,
    });

    const notifications = activeMembers
      .filter((member) => member.userId !== actor.id)
      .map((member) =>
        createNotification(tx, {
          userId: member.userId,
          projectId: quest.projectId,
          questId: quest.id,
          type: "retry_requested",
          actorUserId: actor.id,
          payload: { comment: body.comment },
          createdAt: now,
        }),
      );

    return { projectId: quest.projectId, questId: quest.id, notifications };
  });
}

/** Apply `POST /api/quests/:id/archive`. */
function archiveQuest(
  db: AppDb,
  questId: number,
  actor: UserRow,
  body: ArchiveQuestRequest,
): QuestDetail {
  db.transaction((tx) => {
    const quest = requireQuest(tx, questId, actor.id);
    const now = Date.now();

    tx.update(quests)
      .set({
        stage: "archived",
        archiveReason: body.reason ?? null,
        updatedAt: nextUpdatedAt(quest.updatedAt),
      })
      .where(eq(quests.id, quest.id))
      .run();

    if (quest.stage !== "archived") {
      insertQuestEvent(tx, {
        questId: quest.id,
        projectId: quest.projectId,
        type: "quest_archived",
        payload: body.reason === undefined ? {} : { reason: body.reason },
        actorUserId: actor.id,
        createdAt: now,
      });
    }
  });

  return loadQuestDetail(db, questId);
}

/** Normalize an optional reference label: trimmed, blank becomes `null`. */
function normalizeRefLabel(label: string | undefined): string | null {
  if (label === undefined) {
    return null;
  }
  const trimmed = label.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Realtime work produced by a reference mutation. */
interface QuestRefSignals {
  projectId: number;
  questId: number;
}

/**
 * Add a reference document and its `ref_added` event in one transaction.
 *
 * Only guild members reach this function (`requireQuest`); the caller emits
 * `quest:changed` after the transaction committed.
 */
function createQuestRef(
  db: AppDb,
  questId: number,
  actor: UserRow,
  body: CreateQuestRefRequest,
): { ref: QuestRef; signals: QuestRefSignals } {
  return db.transaction((tx) => {
    const quest = requireQuest(tx, questId, actor.id);
    const now = Date.now();
    const target = body.target.trim();
    const label = normalizeRefLabel(body.label);

    const row = tx
      .insert(questRefs)
      .values({
        questId: quest.id,
        label,
        target,
        createdBy: actor.id,
        createdAt: now,
      })
      .returning()
      .get();

    insertQuestEvent(tx, {
      questId: quest.id,
      projectId: quest.projectId,
      type: "ref_added",
      payload: { refId: row.id, target, label },
      actorUserId: actor.id,
      createdAt: now,
    });

    return {
      ref: {
        id: row.id,
        label: row.label,
        target: row.target,
        kind: refKind(row.target),
        createdBy: { id: actor.id, displayName: actor.displayName },
        createdAt: row.createdAt,
      } satisfies QuestRef,
      signals: { projectId: quest.projectId, questId: quest.id },
    };
  });
}

/**
 * Remove a reference document and record `ref_removed`.
 *
 * Missing references are a 404; non-members of the owning guild are a 403.
 */
function deleteQuestRef(
  db: AppDb,
  refId: number,
  actor: UserRow,
): QuestRefSignals {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(questRefs)
      .where(eq(questRefs.id, refId))
      .get();
    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "Reference not found");
    }

    const quest = requireQuest(tx, row.questId, actor.id);
    tx.delete(questRefs).where(eq(questRefs.id, row.id)).run();
    insertQuestEvent(tx, {
      questId: quest.id,
      projectId: quest.projectId,
      type: "ref_removed",
      payload: { target: row.target, label: row.label },
      actorUserId: actor.id,
      createdAt: Date.now(),
    });

    return { projectId: quest.projectId, questId: quest.id };
  });
}

/** Map `quest_events` rows (with their actor) to the API shape. */
function listQuestEvents(db: AppDb, questId: number): QuestEvent[] {
  const rows = db
    .select({ event: questEvents, actor: users })
    .from(questEvents)
    .leftJoin(users, eq(questEvents.actorUserId, users.id))
    .where(eq(questEvents.questId, questId))
    .orderBy(asc(questEvents.createdAt), asc(questEvents.id))
    .all();

  return rows.map(({ event, actor }) => ({
    id: event.id,
    questId: event.questId,
    projectId: event.projectId,
    type: event.type as QuestEventType,
    payload: parseEventPayload(event.payload),
    actor: actor
      ? { id: actor.id, displayName: actor.displayName }
      : null,
    familiarId: event.familiarId ?? null,
    createdAt: event.createdAt,
  }));
}

/** Parse a stored event payload; malformed JSON degrades to an empty object. */
function parseEventPayload(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return {};
  }
}

export const questRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/projects/:pid/quests",
    {
      schema: {
        params: projectParamsSchema,
        querystring: listQuestsQuerySchema,
        response: { 200: questListResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const { pid } = request.params;
      requireProject(request.server.db, pid, user.id);
      return listProjectQuests(request.server.db, pid, request.query);
    },
  );

  app.post(
    "/api/projects/:pid/quests",
    {
      schema: {
        params: projectParamsSchema,
        body: createQuestRequestSchema,
        response: { 201: questDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { pid } = request.params;
      requireProject(request.server.db, pid, user.id);
      const quest = createQuest(request.server.db, pid, user, request.body);
      request.server.realtime.emitQuestChanged(pid, quest.id);
      reply.code(201);
      return quest;
    },
  );

  app.post(
    "/api/projects/:pid/quests/bulk",
    {
      schema: {
        params: projectParamsSchema,
        body: bulkCreateQuestsRequestSchema,
        response: { 201: questDetailListResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { pid } = request.params;
      requireProject(request.server.db, pid, user.id);
      const created = bulkCreateQuests(
        request.server.db,
        pid,
        user,
        request.body,
      );
      for (const quest of created) {
        request.server.realtime.emitQuestChanged(pid, quest.id);
      }
      reply.code(201);
      return created;
    },
  );

  app.get(
    "/api/quests/:id",
    {
      schema: {
        params: questParamsSchema,
        response: { 200: questDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const quest = requireQuest(request.server.db, request.params.id, user.id);
      return loadQuestDetail(request.server.db, quest.id);
    },
  );

  app.patch(
    "/api/quests/:id",
    {
      schema: {
        params: questParamsSchema,
        body: updateQuestRequestSchema,
        response: { 200: questDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const quest = updateQuestDetails(
        request.server.db,
        request.params.id,
        user,
        request.body,
      );
      request.server.realtime.emitQuestChanged(quest.projectId, quest.id);
      return quest;
    },
  );

  app.post(
    "/api/quests/:id/move",
    {
      schema: {
        params: questParamsSchema,
        body: moveQuestRequestSchema,
        response: { 200: questDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const { quest, settlement } = moveQuest(
        request.server.db,
        request.params.id,
        user,
        request.body,
      );
      if (settlement) {
        // The settlement path emits its own single `quest:changed`; emitting
        // here as well would double-broadcast a move into `cleared`.
        emitSettlement(
          request.server.realtime,
          quest.projectId,
          quest.id,
          settlement,
        );
      } else {
        // Every other move rewrites the card's stage and/or order key (a
        // same-stage reorder included), so the room always has to refresh.
        request.server.realtime.emitQuestChanged(quest.projectId, quest.id);
      }
      return quest;
    },
  );

  app.post(
    "/api/quests/:id/clear",
    {
      schema: {
        params: questParamsSchema,
        response: { 200: clearQuestDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const db = request.server.db;
      const result = clearQuest(db, request.params.id, user, Date.now());

      emitSettlement(
        request.server.realtime,
        result.projectId,
        result.questId,
        result.settlement,
      );

      return {
        quest: loadQuestDetail(db, result.questId),
        rewards: result.settlement.rewards,
        levelUps: result.settlement.levelUps,
      };
    },
  );

  app.post(
    "/api/quests/:id/retry",
    {
      schema: {
        params: questParamsSchema,
        body: retryQuestRequestSchema,
        response: { 200: questDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const db = request.server.db;
      const result = retryQuest(
        db,
        request.params.id,
        user,
        request.body,
        Date.now(),
      );

      request.server.realtime.emitQuestChanged(
        result.projectId,
        result.questId,
      );
      emitNotifications(request.server.realtime, result.notifications);
      request.server.realtime.emitMembersChanged(result.projectId);

      return loadQuestDetail(db, result.questId);
    },
  );

  app.post(
    "/api/quests/:id/archive",
    {
      schema: {
        params: questParamsSchema,
        body: archiveQuestRequestSchema.optional(),
        response: { 200: questDetailResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const quest = archiveQuest(
        request.server.db,
        request.params.id,
        user,
        request.body ?? {},
      );
      request.server.realtime.emitQuestChanged(quest.projectId, quest.id);
      return quest;
    },
  );

  app.post(
    "/api/quests/:id/refs",
    {
      schema: {
        params: questParamsSchema,
        body: createQuestRefRequestSchema,
        response: { 201: questRefSchema },
      },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { ref, signals } = createQuestRef(
        request.server.db,
        request.params.id,
        user,
        request.body,
      );
      request.server.realtime.emitQuestChanged(
        signals.projectId,
        signals.questId,
      );
      reply.code(201);
      return ref;
    },
  );

  app.delete(
    "/api/refs/:id",
    {
      schema: { params: refParamsSchema },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      const signals = deleteQuestRef(
        request.server.db,
        request.params.id,
        user,
      );
      request.server.realtime.emitQuestChanged(
        signals.projectId,
        signals.questId,
      );
      reply.code(204);
      return reply.send();
    },
  );

  app.get(
    "/api/quests/:id/events",
    {
      schema: {
        params: questParamsSchema,
        response: { 200: questEventsResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const quest = requireQuest(
        request.server.db,
        request.params.id,
        user.id,
      );
      return listQuestEvents(request.server.db, quest.id);
    },
  );
};
