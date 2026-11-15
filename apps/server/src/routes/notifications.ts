/**
 * In-app notification routes.
 *
 * The inbox is private to the authenticated adventurer: every query filters on
 * the session user's id, so one user can never list or mark another user's
 * notifications. Listing returns the newest items together with the total
 * number of unread rows, which the top-bar bell renders as a badge.
 *
 * Keep the export name `notificationRoutes`: `app.ts` registers this plugin.
 */
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import {
  notificationListQuerySchema,
  notificationListResponseSchema,
  readNotificationsRequestSchema,
  type Notification,
  type NotificationListQuery,
  type NotificationListResponse,
  type ReadNotificationsRequest,
} from "@guildloom/shared";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AppDb } from "../db/index.js";
import {
  notifications,
  quests,
  users,
  type UserRow,
} from "../db/schema.js";
import { authenticate } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";

/** The authenticated user of a request (the `authenticate` preHandler ran). */
function currentUser(request: FastifyRequest): UserRow {
  if (!request.user) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  }
  return request.user;
}

/** Parse a stored notification payload; malformed JSON degrades to `{}`. */
function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return {};
  }
}

/** Number of unread notifications in `userId`'s inbox. */
function unreadCount(db: AppDb, userId: number): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(eq(notifications.userId, userId), isNull(notifications.readAt)),
    )
    .get();
  return Number(row?.count ?? 0);
}

/**
 * List the current user's notifications, newest first.
 *
 * `unread=1` narrows the page to unread rows; `unreadCount` always counts every
 * unread row in the inbox, independent of the page filter and limit.
 */
function listNotifications(
  db: AppDb,
  userId: number,
  query: NotificationListQuery,
): NotificationListResponse {
  const conditions = [eq(notifications.userId, userId)];
  if (query.unread === "1") {
    conditions.push(isNull(notifications.readAt));
  }

  const rows = db
    .select({
      notification: notifications,
      actor: users,
      quest: quests,
    })
    .from(notifications)
    .leftJoin(users, eq(notifications.actorUserId, users.id))
    .leftJoin(quests, eq(notifications.questId, quests.id))
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(query.limit)
    .all();

  const items: Notification[] = rows.map(({ notification, actor, quest }) => ({
    id: notification.id,
    projectId: notification.projectId,
    questId: notification.questId,
    questNumber: quest?.number ?? null,
    questTitle: quest?.title ?? null,
    type: notification.type,
    actor: actor ? { id: actor.id, displayName: actor.displayName } : null,
    payload: parsePayload(notification.payload),
    createdAt: notification.createdAt,
    readAt: notification.readAt,
  }));

  return { items, unreadCount: unreadCount(db, userId) };
}

/**
 * Mark notifications as read.
 *
 * `all: true` marks every unread row of the user; otherwise only the listed
 * ids are touched. Rows belonging to other users are silently ignored, as are
 * ids that are already read.
 */
function markNotificationsRead(
  db: AppDb,
  userId: number,
  body: ReadNotificationsRequest,
  now: number,
): void {
  if (body.all === true) {
    db.update(notifications)
      .set({ readAt: now })
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      )
      .run();
    return;
  }

  const ids = body.ids ?? [];
  if (ids.length === 0) {
    return;
  }

  db.update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.userId, userId),
        inArray(notifications.id, ids),
        isNull(notifications.readAt),
      ),
    )
    .run();
}

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/notifications",
    {
      schema: {
        querystring: notificationListQuerySchema,
        response: { 200: notificationListResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      return listNotifications(request.server.db, user.id, request.query);
    },
  );

  app.post(
    "/api/notifications/read",
    {
      schema: {
        body: readNotificationsRequestSchema.nullable().optional(),
      },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      markNotificationsRead(
        request.server.db,
        user.id,
        request.body ?? {},
        Date.now(),
      );
      reply.code(204);
      return reply.send();
    },
  );
};
