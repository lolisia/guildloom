/**
 * Quest floor (층) routes.
 *
 * Floors are a display-only checklist on a quest: they never move the quest
 * through the automatic stage machine. Every mutation runs in a single SQLite
 * transaction with its event-log entry, and the `quest:changed` broadcast is
 * emitted by the handler only after the transaction committed.
 *
 * Keep the export name `floorsRoutes`: `app.ts` registers this plugin.
 */
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  addFloorsRequestSchema,
  floorListResponseSchema,
  floorSchema,
  moveFloorRequestSchema,
  updateFloorRequestSchema,
  type Floor,
  type MoveFloorRequest,
  type UpdateFloorRequest,
  type UserRef,
} from "@guildloom/shared";
import { asc, desc, eq } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";

import type { AppDb } from "../db/index.js";
import {
  questFloors,
  quests,
  users,
  type QuestFloorRow,
  type QuestRow,
  type UserRow,
} from "../db/schema.js";
import { authenticate, requireMembership } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { insertQuestEvent } from "../lib/party.js";

/** Numeric route parameters (`:id`). */
const questParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});
const floorParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** A floor row plus the user who completed it, when it is done. */
interface FloorWithDoneBy {
  floor: QuestFloorRow;
  doneBy: UserRow | null;
}

/** Realtime work produced by a floor mutation, emitted after commit. */
interface FloorMutationSignals {
  projectId: number;
  questId: number;
}

/** The authenticated user of a request (the `authenticate` preHandler ran). */
function currentUser(request: FastifyRequest): UserRow {
  if (!request.user) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  }
  return request.user;
}

/** Load a quest row or throw the standard 404. */
function loadQuestRow(db: AppDb, questId: number): QuestRow {
  const quest = db.select().from(quests).where(eq(quests.id, questId)).get();
  if (!quest) {
    throw new HttpError(404, "NOT_FOUND", "Quest not found");
  }
  return quest;
}

/** Load a quest the user may access (404 missing, 403 not a guild member). */
function requireQuest(db: AppDb, questId: number, userId: number): QuestRow {
  const quest = loadQuestRow(db, questId);
  requireMembership(db, userId, quest.projectId);
  return quest;
}

/** Load a floor and its quest; missing floors are a 404. */
function loadFloorWithQuest(
  db: AppDb,
  floorId: number,
): { floor: QuestFloorRow; quest: QuestRow } {
  const floor = db
    .select()
    .from(questFloors)
    .where(eq(questFloors.id, floorId))
    .get();
  if (!floor) {
    throw new HttpError(404, "NOT_FOUND", "Floor not found");
  }
  return { floor, quest: loadQuestRow(db, floor.questId) };
}

/** Load a floor the user may access (404 missing, 403 not a guild member). */
function requireFloor(
  db: AppDb,
  floorId: number,
  userId: number,
): { floor: QuestFloorRow; quest: QuestRow } {
  const result = loadFloorWithQuest(db, floorId);
  requireMembership(db, userId, result.quest.projectId);
  return result;
}

/** Resolve a user id into a `{ id, displayName }` reference. */
function userRef(user: UserRow): UserRef {
  return { id: user.id, displayName: user.displayName };
}

/** Serialize a floor row into the shared API shape. */
function toFloor(entry: FloorWithDoneBy): Floor {
  return {
    id: entry.floor.id,
    title: entry.floor.title,
    orderKey: entry.floor.orderKey,
    doneAt: entry.floor.doneAt,
    doneBy: entry.doneBy ? userRef(entry.doneBy) : null,
  };
}

/** A quest's floors ordered by `order_key` (and id as the tie-breaker). */
function loadQuestFloors(db: AppDb, questId: number): Floor[] {
  return db
    .select({ floor: questFloors, doneBy: users })
    .from(questFloors)
    .leftJoin(users, eq(questFloors.doneBy, users.id))
    .where(eq(questFloors.questId, questId))
    .orderBy(asc(questFloors.orderKey), asc(questFloors.id))
    .all()
    .map(toFloor);
}

/** Load a single floor in the API shape. */
function loadFloor(db: AppDb, floorId: number): Floor {
  const entry = db
    .select({ floor: questFloors, doneBy: users })
    .from(questFloors)
    .leftJoin(users, eq(questFloors.doneBy, users.id))
    .where(eq(questFloors.id, floorId))
    .get();
  if (!entry) {
    throw new HttpError(404, "NOT_FOUND", "Floor not found");
  }
  return toFloor(entry);
}

/** Last order key of a quest's floors, or `null` when it has none. */
function lastFloorOrderKey(db: AppDb, questId: number): string | null {
  const row = db
    .select({ orderKey: questFloors.orderKey })
    .from(questFloors)
    .where(eq(questFloors.questId, questId))
    .orderBy(desc(questFloors.orderKey))
    .limit(1)
    .get();
  return row?.orderKey ?? null;
}

/** Order key that appends a floor at the bottom of the dungeon. */
function bottomFloorOrderKey(db: AppDb, questId: number): string {
  return generateKeyBetween(lastFloorOrderKey(db, questId), null);
}

/** Trim titles and drop blank lines; all-blank batches are rejected. */
function normalizeFloorTitles(titles: string[]): string[] {
  const normalized = titles
    .map((title) => title.trim())
    .filter((title) => title.length > 0);
  if (normalized.length === 0) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "At least one non-empty floor title is required",
    );
  }
  return normalized;
}

/**
 * Append one floor per (normalized) title at the bottom of the quest's
 * dungeon, recording a `floor_added` event for each.
 */
function addFloors(
  db: AppDb,
  questId: number,
  actor: UserRow,
  titles: string[],
  now: number,
): { floors: Floor[]; signals: FloorMutationSignals } {
  return db.transaction((tx) => {
    const quest = requireQuest(tx, questId, actor.id);
    const normalized = normalizeFloorTitles(titles);
    let previousKey = lastFloorOrderKey(tx, quest.id);

    for (const title of normalized) {
      const orderKey = generateKeyBetween(previousKey, null);
      previousKey = orderKey;

      const row = tx
        .insert(questFloors)
        .values({
          questId: quest.id,
          title,
          orderKey,
          doneAt: null,
          doneBy: null,
          createdBy: actor.id,
          createdAt: now,
        })
        .returning()
        .get();

      insertQuestEvent(tx, {
        questId: quest.id,
        projectId: quest.projectId,
        type: "floor_added",
        payload: { floorId: row.id, title },
        actorUserId: actor.id,
        createdAt: now,
      });
    }

    return {
      floors: loadQuestFloors(tx, quest.id),
      signals: { projectId: quest.projectId, questId: quest.id },
    };
  });
}

/**
 * Apply `PATCH /api/floors/:id`.
 *
 * A title edit never writes an event. Toggling `done` sets/clears
 * `done_at`/`done_by` and records `floor_checked` only when the state changed.
 */
function updateFloor(
  db: AppDb,
  floorId: number,
  actor: UserRow,
  body: UpdateFloorRequest,
  now: number,
): { floor: Floor; signals: FloorMutationSignals } {
  const result = db.transaction((tx) => {
    const { floor, quest } = requireFloor(tx, floorId, actor.id);
    const changes: Partial<typeof questFloors.$inferInsert> = {};
    let title = floor.title;
    let checked: boolean | null = null;

    if (body.title !== undefined && body.title !== floor.title) {
      title = body.title;
      changes.title = title;
    }

    if (body.done !== undefined) {
      const wasDone = floor.doneAt !== null;
      if (body.done !== wasDone) {
        checked = body.done;
        changes.doneAt = body.done ? now : null;
        changes.doneBy = body.done ? actor.id : null;
      }
    }

    if (Object.keys(changes).length > 0) {
      tx.update(questFloors)
        .set(changes)
        .where(eq(questFloors.id, floor.id))
        .run();
    }

    if (checked !== null) {
      insertQuestEvent(tx, {
        questId: quest.id,
        projectId: quest.projectId,
        type: "floor_checked",
        payload: { floorId: floor.id, title, done: checked },
        actorUserId: actor.id,
        createdAt: now,
      });
    }

    return {
      floorId: floor.id,
      signals: { projectId: quest.projectId, questId: quest.id },
    };
  });

  return { floor: loadFloor(db, result.floorId), signals: result.signals };
}

/** Resolve a move neighbor that must belong to the same quest's dungeon. */
function neighborOrderKey(
  db: AppDb,
  floor: QuestFloorRow,
  neighborId: number,
): string {
  if (neighborId === floor.id) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      "A floor cannot be its own move neighbor",
    );
  }

  const neighbor = db
    .select()
    .from(questFloors)
    .where(eq(questFloors.id, neighborId))
    .get();
  if (!neighbor || neighbor.questId !== floor.questId) {
    throw new HttpError(404, "NOT_FOUND", "Floor neighbor not found");
  }
  return neighbor.orderKey;
}

/** Compute a fractional order key between the supplied neighbors. */
function orderKeyBetween(
  beforeKey: string | null,
  afterKey: string | null,
): string {
  try {
    return generateKeyBetween(beforeKey, afterKey);
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "Invalid floor move order");
  }
}

/**
 * Apply `POST /api/floors/:id/move`.
 *
 * Without neighbors the floor moves to the bottom. Reordering never records a
 * quest event; the realtime `quest:changed` signal is emitted by the handler.
 */
function moveFloor(
  db: AppDb,
  floorId: number,
  actor: UserRow,
  body: MoveFloorRequest,
): { floor: Floor; signals: FloorMutationSignals } {
  const result = db.transaction((tx) => {
    const { floor, quest } = requireFloor(tx, floorId, actor.id);

    if (
      body.beforeId !== undefined &&
      body.afterId !== undefined &&
      body.beforeId === body.afterId
    ) {
      throw new HttpError(
        400,
        "BAD_REQUEST",
        "beforeId and afterId must be different floors",
      );
    }

    const beforeKey =
      body.beforeId === undefined
        ? null
        : neighborOrderKey(tx, floor, body.beforeId);
    const afterKey =
      body.afterId === undefined
        ? null
        : neighborOrderKey(tx, floor, body.afterId);

    const orderKey =
      beforeKey === null && afterKey === null
        ? bottomFloorOrderKey(tx, quest.id)
        : orderKeyBetween(beforeKey, afterKey);

    tx.update(questFloors)
      .set({ orderKey })
      .where(eq(questFloors.id, floor.id))
      .run();

    return {
      floorId: floor.id,
      signals: { projectId: quest.projectId, questId: quest.id },
    };
  });

  return { floor: loadFloor(db, result.floorId), signals: result.signals };
}

/** Delete a floor; deletion never records a quest event. */
function deleteFloor(
  db: AppDb,
  floorId: number,
  actor: UserRow,
): FloorMutationSignals {
  return db.transaction((tx) => {
    const { floor, quest } = requireFloor(tx, floorId, actor.id);
    tx.delete(questFloors).where(eq(questFloors.id, floor.id)).run();
    return { projectId: quest.projectId, questId: quest.id };
  });
}

export const floorsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/api/quests/:id/floors",
    {
      schema: {
        params: questParamsSchema,
        body: addFloorsRequestSchema,
        response: { 200: floorListResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const { floors, signals } = addFloors(
        request.server.db,
        request.params.id,
        user,
        request.body.titles,
        Date.now(),
      );
      request.server.realtime.emitQuestChanged(
        signals.projectId,
        signals.questId,
      );
      return floors;
    },
  );

  app.patch(
    "/api/floors/:id",
    {
      schema: {
        params: floorParamsSchema,
        body: updateFloorRequestSchema,
        response: { 200: floorSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const { floor, signals } = updateFloor(
        request.server.db,
        request.params.id,
        user,
        request.body,
        Date.now(),
      );
      request.server.realtime.emitQuestChanged(
        signals.projectId,
        signals.questId,
      );
      return floor;
    },
  );

  app.post(
    "/api/floors/:id/move",
    {
      schema: {
        params: floorParamsSchema,
        body: moveFloorRequestSchema,
        response: { 200: floorSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const { floor, signals } = moveFloor(
        request.server.db,
        request.params.id,
        user,
        request.body,
      );
      request.server.realtime.emitQuestChanged(
        signals.projectId,
        signals.questId,
      );
      return floor;
    },
  );

  app.delete(
    "/api/floors/:id",
    {
      schema: {
        params: floorParamsSchema,
      },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      const signals = deleteFloor(
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
};
