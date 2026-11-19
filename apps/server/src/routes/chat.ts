/**
 * Guild chat routes: the tavern, quest party rooms, read cursors and turning a
 * tavern message into a quest.
 *
 * A thread is either the guild tavern (`messages.quest_id IS NULL`) or a quest
 * party room (`messages.quest_id = :id`). Every endpoint requires an
 * authenticated session and membership of the owning guild; a missing target
 * and a non-member are both reported as 404 NOT_FOUND so guild existence never
 * leaks to outsiders.
 *
 * Posting a message never touches the quest row or the quest event log: chat is
 * its own stream. The realtime broadcasts are invalidations only; message data
 * is always read back through these routes.
 *
 * Keep the export name `chatRoutes`: `app.ts` registers this plugin.
 */
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  ACTIVE_MEMBER_STATUSES,
  MENTION_NOTIFY_MAX,
  chatMessageSchema,
  chatUnreadResponseSchema,
  createQuestFromChatRequestSchema,
  createQuestFromChatResponseSchema,
  extractMentionIds,
  markReadRequestSchema,
  messagePageQuerySchema,
  messagePageResponseSchema,
  messagePlainText,
  postMessageRequestSchema,
  type ChatMessage,
  type ChatUnreadResponse,
  type CreateQuestFromChatRequest,
  type MarkReadRequest,
  type MessagePageQuery,
  type MessagePageResponse,
} from "@guildloom/shared";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { AppDb } from "../db/index.js";
import {
  messages,
  partyMembers,
  projectMembers,
  projects,
  quests,
  readCursors,
  users,
  type MessageRow,
  type ProjectMemberRow,
  type ProjectRow,
  type QuestRow,
  type UserRow,
} from "../db/schema.js";
import { authenticate, getMembership } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import {
  createNotification,
  type CreatedNotification,
} from "../lib/party.js";
import type { Realtime } from "../lib/realtime.js";
import { createQuest, type QuestDetail } from "./quests.js";

/** Numeric route parameters (`:pid`, `:id`). */
const projectParamsSchema = z.object({
  pid: z.coerce.number().int().positive(),
});
const questParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});
const messageParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Longest excerpt stored on a `mentioned` notification, before the ellipsis. */
const MENTION_EXCERPT_MAX = 80;

/** A `WHERE` clause piece; `and()` accepts `undefined` pieces. */
type Condition = SQL | undefined;

/** The promoted quest joined onto a message row. */
const promotedQuest = alias(quests, "promoted_quest");

/** A message row plus its joined author and promoted quest columns. */
interface MessageJoinRow {
  message: MessageRow;
  authorId: number | null;
  authorDisplayName: string | null;
  promotedId: number | null;
  promotedNumber: number | null;
  promotedTitle: string | null;
}

/** The authenticated user of a request (the `authenticate` preHandler ran). */
function currentUser(request: FastifyRequest): UserRow {
  if (!request.user) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  }
  return request.user;
}

/**
 * Resolve `:pid` for a member of the guild.
 *
 * Missing projects and non-members are indistinguishable 404s: the chat
 * endpoints must not confirm that an invisible guild exists.
 */
function requireProjectMember(
  db: AppDb,
  projectId: number,
  userId: number,
): { project: ProjectRow; membership: ProjectMemberRow } {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    throw new HttpError(404, "NOT_FOUND", "Project not found");
  }

  const membership = getMembership(db, userId, projectId);
  if (!membership) {
    throw new HttpError(404, "NOT_FOUND", "Project not found");
  }
  return { project, membership };
}

/** Resolve a quest the user may see (missing target and non-member are 404). */
function requireQuestMember(
  db: AppDb,
  questId: number,
  userId: number,
): QuestRow {
  const quest = db.select().from(quests).where(eq(quests.id, questId)).get();
  if (!quest || !getMembership(db, userId, quest.projectId)) {
    throw new HttpError(404, "NOT_FOUND", "Quest not found");
  }
  return quest;
}

/** Select messages together with their author and promoted quest. */
function selectMessages(db: AppDb) {
  return db
    .select({
      message: messages,
      authorId: users.id,
      authorDisplayName: users.displayName,
      promotedId: promotedQuest.id,
      promotedNumber: promotedQuest.number,
      promotedTitle: promotedQuest.title,
    })
    .from(messages)
    .leftJoin(users, eq(messages.authorUserId, users.id))
    .leftJoin(promotedQuest, eq(messages.promotedQuestId, promotedQuest.id));
}

/** Parse a stored system-message payload; malformed JSON degrades to `null`. */
function parseMessagePayload(payload: string | null): unknown {
  if (payload === null) {
    return null;
  }
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

/** Map a joined message row to the shared API shape. */
function toChatMessage(row: MessageJoinRow): ChatMessage {
  const { message } = row;

  // A system message exposes the member whose action produced it as `author`
  // (the requester of a `quest_created` line), so clients can name the actor.
  const author =
    row.authorId !== null && row.authorDisplayName !== null
      ? { id: row.authorId, displayName: row.authorDisplayName }
      : null;

  const promoted =
    row.promotedId !== null &&
    row.promotedNumber !== null &&
    row.promotedTitle !== null
      ? {
          id: row.promotedId,
          number: row.promotedNumber,
          title: row.promotedTitle,
        }
      : null;

  return {
    id: message.id,
    projectId: message.projectId,
    questId: message.questId,
    kind: message.kind,
    author,
    familiarId: message.familiarId,
    body: message.deletedAt === null ? message.body : "",
    payload:
      message.kind === "system"
        ? parseMessagePayload(message.payload)
        : null,
    promotedQuest: promoted,
    createdAt: message.createdAt,
    deletedAt: message.deletedAt,
  };
}

/** Thread a page of messages is read from. */
interface ChatThread {
  projectId: number;
  /** `null` selects the tavern; a number selects that quest's party room. */
  questId: number | null;
}

/** One page of a thread: newest `limit` rows, returned oldest first. */
function loadMessagePage(
  db: AppDb,
  thread: ChatThread,
  query: MessagePageQuery,
): MessagePageResponse {
  const conditions: Condition[] = [
    eq(messages.projectId, thread.projectId),
    thread.questId === null
      ? isNull(messages.questId)
      : eq(messages.questId, thread.questId),
  ];
  if (query.before !== undefined) {
    conditions.push(lt(messages.id, query.before));
  }

  // Fetch one row beyond the page: its presence is exactly "an older row
  // exists", so `hasMore` never needs a second count query.
  const rows = selectMessages(db)
    .where(and(...conditions))
    .orderBy(desc(messages.id))
    .limit(query.limit + 1)
    .all();

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  page.reverse();

  return { messages: page.map(toChatMessage), hasMore };
}

/** Realtime work produced by a new chat message, emitted after commit. */
interface CreateMessageResult {
  message: ChatMessage;
  projectId: number;
  questId: number | null;
  notifications: CreatedNotification[];
}

/**
 * Build the excerpt stored on `mentioned` notifications.
 *
 * The body is rendered as plain text (mention tokens become `@이름`) and cut at
 * {@link MENTION_EXCERPT_MAX} characters; the ellipsis is appended only when
 * something was cut.
 */
function mentionExcerpt(
  body: string,
  names: ReadonlyMap<number, string>,
): string {
  const plain = messagePlainText(body, (userId) => names.get(userId) ?? null);
  return plain.length > MENTION_EXCERPT_MAX
    ? `${plain.slice(0, MENTION_EXCERPT_MAX)}…`
    : plain;
}

/**
 * Insert a user message and its mention notifications in one transaction.
 *
 * The body is stored exactly as validated (no mention encoding, no
 * escaping) and neither the quest row nor the quest event log is touched.
 * Notifications go to distinct same-guild members, never the author, capped at
 * {@link MENTION_NOTIFY_MAX} in mention order.
 */
function createUserMessage(
  db: AppDb,
  thread: ChatThread,
  author: UserRow,
  body: string,
): CreateMessageResult {
  return db.transaction((tx) => {
    const now = Date.now();
    const row = tx
      .insert(messages)
      .values({
        projectId: thread.projectId,
        questId: thread.questId,
        kind: "user",
        authorUserId: author.id,
        familiarId: null,
        body,
        payload: null,
        promotedQuestId: null,
        createdAt: now,
        deletedAt: null,
      })
      .returning()
      .get();

    const members = tx
      .select({
        userId: projectMembers.userId,
        displayName: users.displayName,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, thread.projectId))
      .all();
    const names = new Map(
      members.map((member) => [member.userId, member.displayName] as const),
    );

    const recipients = extractMentionIds(body)
      .filter((userId) => userId !== author.id && names.has(userId))
      .slice(0, MENTION_NOTIFY_MAX);
    const excerpt = mentionExcerpt(body, names);

    const notifications = recipients.map((userId) =>
      createNotification(tx, {
        userId,
        projectId: thread.projectId,
        questId: thread.questId,
        type: "mentioned",
        actorUserId: author.id,
        payload: { messageId: row.id, excerpt },
        createdAt: now,
      }),
    );

    const joined = selectMessages(tx)
      .where(eq(messages.id, row.id))
      .get();
    if (!joined) {
      throw new HttpError(500, "INTERNAL_ERROR", "Message disappeared");
    }

    return {
      message: toChatMessage(joined),
      projectId: thread.projectId,
      questId: thread.questId,
      notifications,
    };
  });
}

/** Realtime work produced by a message deletion. */
interface DeleteMessageResult {
  projectId: number;
  questId: number | null;
  /** `false` for an idempotent repeat DELETE of an already-deleted row. */
  changed: boolean;
}

/**
 * Soft delete a user message.
 *
 * A message is only removable by its author, and system messages are never
 * removable. Repeating the DELETE is a successful no-op so a retrying client
 * always converges.
 */
function deleteUserMessage(
  db: AppDb,
  messageId: number,
  actor: UserRow,
): DeleteMessageResult {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .get();
    if (!row || !getMembership(tx, actor.id, row.projectId)) {
      throw new HttpError(404, "NOT_FOUND", "Message not found");
    }
    if (row.kind === "system") {
      throw new HttpError(403, "FORBIDDEN", "System messages cannot be deleted");
    }
    if (row.authorUserId !== actor.id) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Only the author can delete this message",
      );
    }
    if (row.deletedAt !== null) {
      return { projectId: row.projectId, questId: row.questId, changed: false };
    }

    tx.update(messages)
      .set({ deletedAt: Date.now(), body: "" })
      .where(eq(messages.id, row.id))
      .run();

    return { projectId: row.projectId, questId: row.questId, changed: true };
  });
}

/** Count messages matching `conditions`. */
function countMessages(db: AppDb, conditions: Condition[]): number {
  const row = db
    .select({ total: sql<number>`count(*)` })
    .from(messages)
    .where(and(...conditions))
    .get();
  return Number(row?.total ?? 0);
}

/** Query pieces shared by every unread count in one thread. */
function visibleUnreadConditions(
  userId: number,
  projectId: number,
  questId: number | null,
): Condition[] {
  return [
    eq(messages.projectId, projectId),
    questId === null
      ? isNull(messages.questId)
      : eq(messages.questId, questId),
    isNull(messages.deletedAt),
    // System messages (no author) and everyone else count; only the reader's
    // own messages are already "read".
    or(isNull(messages.authorUserId), ne(messages.authorUserId, userId)),
  ];
}

/**
 * Unread counts for every thread the user takes part in.
 *
 * Threads are the tavern, quests the user requested or actively fights in, and
 * quests the user has ever written in; archived quests never count. The tavern
 * starts at the membership's `joined_at` until a cursor exists, so a new
 * adventurer is not greeted with the whole guild history.
 */
function loadUnread(
  db: AppDb,
  projectId: number,
  userId: number,
  joinedAt: number,
): ChatUnreadResponse {
  const cursorRows = db
    .select()
    .from(readCursors)
    .where(
      and(
        eq(readCursors.userId, userId),
        eq(readCursors.projectId, projectId),
      ),
    )
    .all();
  const cursors = new Map(
    cursorRows.map((row) => [row.threadQuestId, row.lastReadMessageId]),
  );

  const tavernCursor = cursors.get(0);
  const tavernConditions = visibleUnreadConditions(userId, projectId, null);
  if (tavernCursor === undefined) {
    tavernConditions.push(gt(messages.createdAt, joinedAt));
  } else {
    tavernConditions.push(gt(messages.id, tavernCursor));
  }
  const tavern = countMessages(db, tavernConditions);

  // (b) quests the user requested or actively fights in.
  const requested = db
    .select({ id: quests.id })
    .from(quests)
    .where(
      and(
        eq(quests.projectId, projectId),
        eq(quests.createdBy, userId),
        ne(quests.stage, "archived"),
      ),
    )
    .all();
  const party = db
    .select({ id: quests.id })
    .from(partyMembers)
    .innerJoin(quests, eq(partyMembers.questId, quests.id))
    .where(
      and(
        eq(quests.projectId, projectId),
        eq(partyMembers.userId, userId),
        inArray(partyMembers.status, [...ACTIVE_MEMBER_STATUSES]),
        ne(quests.stage, "archived"),
      ),
    )
    .all();

  // (c) quests the user has ever written in.
  const authored = db
    .select({ id: quests.id })
    .from(messages)
    .innerJoin(quests, eq(messages.questId, quests.id))
    .where(
      and(
        eq(quests.projectId, projectId),
        eq(messages.authorUserId, userId),
        ne(quests.stage, "archived"),
      ),
    )
    .all();

  const questIds = [
    ...new Set([
      ...requested.map((quest) => quest.id),
      ...party.map((quest) => quest.id),
      ...authored.map((quest) => quest.id),
    ]),
  ].sort((left, right) => left - right);

  const questsWithUnread: ChatUnreadResponse["quests"] = [];
  for (const questId of questIds) {
    const conditions = visibleUnreadConditions(userId, projectId, questId);
    conditions.push(gt(messages.id, cursors.get(questId) ?? 0));
    const count = countMessages(db, conditions);
    if (count > 0) {
      questsWithUnread.push({ questId, count });
    }
  }

  return { tavern, quests: questsWithUnread };
}

/**
 * Move (never lower) the read cursor of one thread.
 *
 * The message must belong to the requested thread; a quest id must name a
 * quest of this guild. Cross-thread ids are a validation error, not a silent
 * no-op, so a client bug cannot desynchronise the badge.
 */
function markThreadRead(
  db: AppDb,
  projectId: number,
  userId: number,
  body: MarkReadRequest,
): void {
  if (body.questId !== null) {
    const quest = db
      .select()
      .from(quests)
      .where(eq(quests.id, body.questId))
      .get();
    if (!quest || quest.projectId !== projectId) {
      throw new HttpError(404, "NOT_FOUND", "Quest not found");
    }
  }

  const message = db
    .select()
    .from(messages)
    .where(eq(messages.id, body.messageId))
    .get();
  const belongsToThread =
    message !== undefined &&
    message.projectId === projectId &&
    (body.questId === null
      ? message.questId === null
      : message.questId === body.questId);
  if (!belongsToThread) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Message does not belong to this thread",
    );
  }

  const now = Date.now();
  db.insert(readCursors)
    .values({
      userId,
      projectId,
      threadQuestId: body.questId ?? 0,
      lastReadMessageId: body.messageId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        readCursors.userId,
        readCursors.projectId,
        readCursors.threadQuestId,
      ],
      set: {
        lastReadMessageId: sql`max(${readCursors.lastReadMessageId}, ${body.messageId})`,
        updatedAt: now,
      },
    })
    .run();
}

/** Result of promoting a tavern message: the new quest and its system message. */
interface TavernQuestResult {
  quest: QuestDetail;
  message: ChatMessage;
}

/**
 * Create a quest from the tavern in one transaction.
 *
 * With a `sourceMessageId` the source must be a live user message of this
 * guild's tavern and must not have been promoted before. The new quest id is
 * recorded on the source row (so a repeat is a 409), and a `system` message
 * with the `quest_created` payload announces the promotion in the tavern.
 */
function createQuestFromTavern(
  db: AppDb,
  projectId: number,
  actor: UserRow,
  body: CreateQuestFromChatRequest,
): TavernQuestResult {
  const outcome = db.transaction((tx) => {
    let source: MessageRow | null = null;
    if (body.sourceMessageId !== undefined) {
      source =
        tx
          .select()
          .from(messages)
          .where(eq(messages.id, body.sourceMessageId))
          .get() ?? null;
      if (
        !source ||
        source.projectId !== projectId ||
        source.questId !== null ||
        source.kind !== "user" ||
        source.deletedAt !== null
      ) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Source message must be a live user message of this tavern",
        );
      }
      if (source.promotedQuestId !== null) {
        throw new HttpError(
          409,
          "ALREADY_PROMOTED",
          "This message was already turned into a quest",
        );
      }
    }

    // The nested `createQuest` transaction is a savepoint of this one, so a
    // later failure rolls the quest, the source update and the system message
    // back together.
    const quest = createQuest(tx, projectId, actor, {
      title: body.title,
      situation: body.situation,
      kind: "fix",
    });

    if (source !== null) {
      tx.update(messages)
        .set({ promotedQuestId: quest.id })
        .where(eq(messages.id, source.id))
        .run();
    }

    const payload = {
      type: "quest_created",
      questId: quest.id,
      questNumber: quest.number,
      questTitle: quest.title,
      sourceMessageId: body.sourceMessageId ?? null,
    };
    const row = tx
      .insert(messages)
      .values({
        projectId,
        questId: null,
        kind: "system",
        authorUserId: actor.id,
        familiarId: null,
        body: "",
        payload: JSON.stringify(payload),
        // Same link as the source row: clients can open the announced quest
        // straight from the system message.
        promotedQuestId: quest.id,
        createdAt: Date.now(),
        deletedAt: null,
      })
      .returning()
      .get();

    const joined = selectMessages(tx)
      .where(eq(messages.id, row.id))
      .get();
    if (!joined) {
      throw new HttpError(500, "INTERNAL_ERROR", "Message disappeared");
    }

    return { quest, message: toChatMessage(joined) };
  });

  return outcome;
}

/** Emit queued notification deliveries after their transaction committed. */
function emitNotifications(
  realtime: Realtime,
  notifications: readonly CreatedNotification[],
): void {
  for (const created of notifications) {
    realtime.emitNotification(created.userId, created.notification);
  }
}

export const chatRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/projects/:pid/tavern/messages",
    {
      schema: {
        params: projectParamsSchema,
        querystring: messagePageQuerySchema,
        response: { 200: messagePageResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const { pid } = request.params;
      requireProjectMember(request.server.db, pid, user.id);
      return loadMessagePage(
        request.server.db,
        { projectId: pid, questId: null },
        request.query,
      );
    },
  );

  app.get(
    "/api/quests/:id/messages",
    {
      schema: {
        params: questParamsSchema,
        querystring: messagePageQuerySchema,
        response: { 200: messagePageResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const quest = requireQuestMember(
        request.server.db,
        request.params.id,
        user.id,
      );
      return loadMessagePage(
        request.server.db,
        { projectId: quest.projectId, questId: quest.id },
        request.query,
      );
    },
  );

  app.post(
    "/api/projects/:pid/tavern/messages",
    {
      schema: {
        params: projectParamsSchema,
        body: postMessageRequestSchema,
        response: { 201: chatMessageSchema },
      },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { pid } = request.params;
      requireProjectMember(request.server.db, pid, user.id);

      const result = createUserMessage(
        request.server.db,
        { projectId: pid, questId: null },
        user,
        request.body.body,
      );
      emitNotifications(request.server.realtime, result.notifications);
      request.server.realtime.emitChatChanged(result.projectId, null);

      reply.code(201);
      return result.message;
    },
  );

  app.post(
    "/api/quests/:id/messages",
    {
      schema: {
        params: questParamsSchema,
        body: postMessageRequestSchema,
        response: { 201: chatMessageSchema },
      },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      // Party chat stays open on archived quests: the conversation is the
      // record of what happened, not a board action.
      const quest = requireQuestMember(
        request.server.db,
        request.params.id,
        user.id,
      );

      const result = createUserMessage(
        request.server.db,
        { projectId: quest.projectId, questId: quest.id },
        user,
        request.body.body,
      );
      emitNotifications(request.server.realtime, result.notifications);
      request.server.realtime.emitChatChanged(result.projectId, result.questId);

      reply.code(201);
      return result.message;
    },
  );

  app.delete(
    "/api/messages/:id",
    {
      schema: { params: messageParamsSchema },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      const result = deleteUserMessage(
        request.server.db,
        request.params.id,
        user,
      );
      if (result.changed) {
        request.server.realtime.emitChatChanged(
          result.projectId,
          result.questId,
        );
      }
      reply.code(204);
      return reply.send();
    },
  );

  app.get(
    "/api/projects/:pid/chat/unread",
    {
      schema: {
        params: projectParamsSchema,
        response: { 200: chatUnreadResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = currentUser(request);
      const { pid } = request.params;
      const { membership } = requireProjectMember(
        request.server.db,
        pid,
        user.id,
      );
      return loadUnread(
        request.server.db,
        pid,
        user.id,
        membership.joinedAt,
      );
    },
  );

  app.post(
    "/api/projects/:pid/chat/read",
    {
      schema: {
        params: projectParamsSchema,
        body: markReadRequestSchema,
      },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { pid } = request.params;
      requireProjectMember(request.server.db, pid, user.id);
      markThreadRead(request.server.db, pid, user.id, request.body);
      reply.code(204);
      return reply.send();
    },
  );

  app.post(
    "/api/projects/:pid/tavern/quests",
    {
      schema: {
        params: projectParamsSchema,
        body: createQuestFromChatRequestSchema,
        response: { 201: createQuestFromChatResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { pid } = request.params;
      requireProjectMember(request.server.db, pid, user.id);

      const result = createQuestFromTavern(
        request.server.db,
        pid,
        user,
        request.body,
      );
      request.server.realtime.emitQuestChanged(pid, result.quest.id);
      request.server.realtime.emitChatChanged(pid, null);

      reply.code(201);
      return result;
    },
  );
};
