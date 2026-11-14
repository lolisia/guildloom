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
  createQuestRequestSchema,
  listQuestsQuerySchema,
  moveQuestRequestSchema,
  questEventsResponseSchema,
  questListResponseSchema,
  questSchema,
  updateQuestRequestSchema,
  type ArchiveQuestRequest,
  type BulkCreateQuestsRequest,
  type CreateQuestRequest,
  type ListQuestsQuery,
  type MoveQuestRequest,
  type Quest,
  type QuestEditableField,
  type QuestEvent,
  type QuestEventType,
  type QuestSummary,
  type Stage,
  type UpdateQuestRequest,
} from "@guildloom/shared";
import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";

import type { AppDb } from "../db/index.js";
import {
  projects,
  questEvents,
  questTags,
  quests,
  tags,
  users,
  type ProjectRow,
  type QuestRow,
  type TagRow,
  type UserRow,
} from "../db/schema.js";
import { authenticate, requireMembership } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";

/** Numeric route parameters (`:pid`, `:id`). */
const projectParamsSchema = z.object({
  pid: z.coerce.number().int().positive(),
});
const questParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** A quest row together with its creator. */
interface QuestWithCreator {
  quest: QuestRow;
  creator: UserRow;
}

/** Insert payload for a quest event. */
interface QuestEventInput {
  questId: number;
  projectId: number;
  type: QuestEventType;
  payload: unknown;
  actorUserId: number | null;
  familiarId?: number | null;
  createdAt: number;
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

/** Serialize a quest row plus its tag names into a board card. */
function toQuestSummary(
  entry: QuestWithCreator,
  tagNames: string[],
): QuestSummary {
  return {
    id: entry.quest.id,
    number: entry.quest.number,
    title: entry.quest.title,
    stage: entry.quest.stage,
    rank: entry.quest.rank,
    orderKey: entry.quest.orderKey,
    tags: sortNames(tagNames),
    createdBy: {
      id: entry.creator.id,
      displayName: entry.creator.displayName,
    },
    createdAt: entry.quest.createdAt,
    updatedAt: entry.quest.updatedAt,
  };
}

/** Serialize a quest row plus tags/creator into the full detail shape. */
function toQuest(entry: QuestWithCreator, tagNames: string[]): Quest {
  return {
    ...toQuestSummary(entry, tagNames),
    projectId: entry.quest.projectId,
    situation: entry.quest.situation,
    direction: entry.quest.direction,
    archiveReason: entry.quest.archiveReason,
  };
}

/** Load the full `Quest` representation of `questId`. */
function loadQuestView(db: AppDb, questId: number): Quest {
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
  return toQuest(entry, tagNames);
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

/** Order key that appends a card at the bottom of `stage`. */
function bottomOrderKey(db: AppDb, projectId: number, stage: Stage): string {
  return generateKeyBetween(lastOrderKey(db, projectId, stage), null);
}

/** Append a quest event row. */
function insertQuestEvent(db: AppDb, input: QuestEventInput): void {
  db.insert(questEvents)
    .values({
      questId: input.questId,
      projectId: input.projectId,
      type: input.type,
      payload: JSON.stringify(input.payload),
      actorUserId: input.actorUserId,
      familiarId: input.familiarId ?? null,
      createdAt: input.createdAt,
    })
    .run();
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
  return rows.map((row) =>
    toQuestSummary(row, tagNames.get(row.quest.id) ?? []),
  );
}

/** Create one quest plus its `quest_posted` event inside a transaction. */
function createQuest(
  db: AppDb,
  projectId: number,
  actor: UserRow,
  body: CreateQuestRequest,
): Quest {
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

    return toQuest({ quest: row, creator: actor }, tagNames);
  });
}

/** Create many quests (and their events) in a single transaction. */
function bulkCreateQuests(
  db: AppDb,
  projectId: number,
  actor: UserRow,
  body: BulkCreateQuestsRequest,
): Quest[] {
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
    const created: Quest[] = [];

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

      created.push(toQuest({ quest: row, creator: actor }, []));
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
): Quest {
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

  return loadQuestView(db, questId);
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

/** Apply `POST /api/quests/:id/move`. */
function moveQuest(
  db: AppDb,
  questId: number,
  actor: UserRow,
  body: MoveQuestRequest,
): Quest {
  db.transaction((tx) => {
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

    tx.update(quests)
      .set({
        stage: targetStage,
        orderKey,
        updatedAt: nextUpdatedAt(quest.updatedAt),
      })
      .where(eq(quests.id, quest.id))
      .run();

    if (quest.stage !== targetStage) {
      insertQuestEvent(tx, {
        questId: quest.id,
        projectId: quest.projectId,
        type: "quest_moved",
        payload: { from: quest.stage, to: targetStage },
        actorUserId: actor.id,
        createdAt: Date.now(),
      });
    }
  });

  return loadQuestView(db, questId);
}

/** Apply `POST /api/quests/:id/archive`. */
function archiveQuest(
  db: AppDb,
  questId: number,
  actor: UserRow,
  body: ArchiveQuestRequest,
): Quest {
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

  return loadQuestView(db, questId);
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
        response: { 201: questSchema },
      },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { pid } = request.params;
      requireProject(request.server.db, pid, user.id);
      const quest = createQuest(request.server.db, pid, user, request.body);
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
        response: { 201: z.array(questSchema) },
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
      reply.code(201);
      return created;
    },
  );

  app.get(
    "/api/quests/:id",
    {
      schema: {
        params: questParamsSchema,
        response: { 200: questSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const quest = requireQuest(request.server.db, request.params.id, user.id);
      return loadQuestView(request.server.db, quest.id);
    },
  );

  app.patch(
    "/api/quests/:id",
    {
      schema: {
        params: questParamsSchema,
        body: updateQuestRequestSchema,
        response: { 200: questSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      return updateQuestDetails(
        request.server.db,
        request.params.id,
        user,
        request.body,
      );
    },
  );

  app.post(
    "/api/quests/:id/move",
    {
      schema: {
        params: questParamsSchema,
        body: moveQuestRequestSchema,
        response: { 200: questSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      return moveQuest(
        request.server.db,
        request.params.id,
        user,
        request.body,
      );
    },
  );

  app.post(
    "/api/quests/:id/archive",
    {
      schema: {
        params: questParamsSchema,
        body: archiveQuestRequestSchema.optional(),
        response: { 200: questSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      return archiveQuest(
        request.server.db,
        request.params.id,
        user,
        request.body ?? {},
      );
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
