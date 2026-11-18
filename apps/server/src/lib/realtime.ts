/**
 * Real-time fan-out for the guildloom server.
 *
 * Socket.IO shares the Fastify HTTP server and answers on `/socket.io`. A
 * connection is authenticated from the same `gl_session` cookie the REST API
 * uses; unauthenticated handshakes are rejected with `connect_error`. Every
 * authenticated socket joins its private `user:<id>` room, and guild members
 * may additionally subscribe to `project:<id>` rooms.
 *
 * Route handlers talk to the broadcaster through the small {@link Realtime}
 * interface, so tests (and deployments without websockets) can swap in the
 * no-op implementation without knowing about Socket.IO.
 */
import type { IncomingHttpHeaders, Server as HttpServer } from "node:http";

import type { LevelUp, Notification } from "@guildloom/shared";
import { Server, type Socket } from "socket.io";

import type { AppDb } from "../db/index.js";
import type { UserRow } from "../db/schema.js";
import { SESSION_COOKIE, getMembership, getSessionUser } from "./auth.js";

/** Payload of the `quest:changed` server event. */
export interface QuestChangedEvent {
  projectId: number;
  questId: number;
}

/** Payload of the `chat:changed` server event. */
export interface ChatChangedEvent {
  projectId: number;
  /** Thread that changed: a quest id, or `null` for the guild tavern. */
  questId: number | null;
}

/** Payload of the `notification:new` server event. */
export interface NotificationNewEvent {
  notification: Notification;
}

/** Payload of the `xp:changed` server event. */
export interface XpChangedEvent {
  userId: number;
  xp: number;
  level: number;
  levelUp?: LevelUp;
}

/** Payload of the `members:changed` server event. */
export interface MembersChangedEvent {
  projectId: number;
}

/** Input for {@link Realtime.emitXpChanged}. */
export interface XpChangedInput {
  userId: number;
  projectId: number;
  xp: number;
  level: number;
  levelUp?: LevelUp;
}

/**
 * Broadcast facade decorated onto the Fastify instance as `app.realtime`.
 *
 * Route handlers emit through this interface; when realtime is disabled the
 * no-op implementation keeps them free of Socket.IO concerns.
 */
export interface Realtime {
  /** Tell `project:<projectId>` that a quest row changed. */
  emitQuestChanged(projectId: number, questId: number): void;
  /**
   * Tell `project:<projectId>` that a chat thread changed.
   *
   * Only an invalidation signal: clients refetch the thread themselves, so no
   * message data ever travels over the socket.
   */
  emitChatChanged(projectId: number, questId: number | null): void;
  /** Deliver a notification to `user:<userId>`. */
  emitNotification(userId: number, notification: Notification): void;
  /**
   * Report the new XP/level of `userId` and nudge the project's member lists,
   * which show the level badge.
   */
  emitXpChanged(input: XpChangedInput): void;
  /** Tell `project:<projectId>` that its member list changed. */
  emitMembersChanged(projectId: number): void;
}

/** A no-op {@link Realtime}; used when `buildApp({ realtime: false })`. */
export function createNoopRealtime(): Realtime {
  return {
    emitQuestChanged() {},
    emitChatChanged() {},
    emitNotification() {},
    emitXpChanged() {},
    emitMembersChanged() {},
  };
}

/** Shared no-op broadcaster instance. */
export const noopRealtime: Realtime = createNoopRealtime();

/** Events the server sends to clients. */
export interface ServerToClientEvents {
  "quest:changed": (payload: QuestChangedEvent) => void;
  "chat:changed": (payload: ChatChangedEvent) => void;
  "notification:new": (payload: NotificationNewEvent) => void;
  "xp:changed": (payload: XpChangedEvent) => void;
  "members:changed": (payload: MembersChangedEvent) => void;
}

/** Events clients send to the server. */
export interface ClientToServerEvents {
  "subscribe:project": (
    payload: { projectId: number },
    ack?: (response: { ok: boolean }) => void,
  ) => void;
  "unsubscribe:project": (payload: { projectId: number }) => void;
}

/** Reserved for multi-node Socket.IO adapters; unused today. */
export type InterServerEvents = Record<string, never>;

/** Data attached to every authenticated socket. */
export interface SocketData {
  user: UserRow;
}

/** Fully typed Socket.IO server used by guildloom. */
export type RealtimeSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Fully typed Socket.IO socket used by guildloom. */
export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** A Socket.IO broadcaster plus the {@link Realtime} facade over it. */
export interface AttachedRealtime {
  io: RealtimeSocketServer;
  realtime: Realtime;
  /** Disconnect every client and detach Socket.IO from the HTTP server. */
  close(): Promise<void>;
}

/** Name of the room that receives a user's private events. */
function userRoom(userId: number): string {
  return `user:${userId}`;
}

/** Name of the room that receives a guild's board events. */
function projectRoom(projectId: number): string {
  return `project:${projectId}`;
}

/** Read a cookie value from a raw `Cookie` header, or `null`. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() !== name) {
      continue;
    }

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

/** Validate a `{ projectId }` client payload; `null` when malformed. */
function readProjectId(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const projectId = (payload as { projectId?: unknown }).projectId;
  if (
    typeof projectId !== "number" ||
    !Number.isInteger(projectId) ||
    projectId <= 0
  ) {
    return null;
  }

  return projectId;
}

/**
 * Reject cross-site websocket hijacking attempts.
 *
 * Browsers always send `Origin` on a websocket handshake and cannot forge it,
 * so a browser handshake is only accepted when it targets the same host the
 * request was sent to. Non-browser clients (tests, agents, native apps) do not
 * send `Origin` at all; those are allowed because they are not subject to the
 * ambient-cookie threat this check defends against (the session cookie itself
 * is `httpOnly` + `SameSite=Lax`).
 */
function isOriginAllowed(headers: IncomingHttpHeaders): boolean {
  const origin = headers.origin;
  if (origin === undefined) {
    return true;
  }

  const host = headers.host;
  if (typeof origin !== "string" || typeof host !== "string") {
    return false;
  }

  try {
    // Host names are case-insensitive; the URL parser lowercases `origin`,
    // while a raw `Host` header may not be normalized.
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Attach a Socket.IO server to `httpServer` and return its broadcaster.
 *
 * The caller owns the Fastify lifecycle; call {@link AttachedRealtime.close}
 * from a `preClose` hook so sockets are disconnected before Fastify closes the
 * HTTP server (an `onClose` hook runs after `server.close()` and would wait
 * forever on open websockets).
 */
export function attachRealtime(
  httpServer: HttpServer,
  db: AppDb,
): AttachedRealtime {
  const io: RealtimeSocketServer = new Server(httpServer, {
    path: "/socket.io",
  });

  // Authenticate the handshake from the same session cookie as the REST API.
  io.use((socket, next) => {
    if (!isOriginAllowed(socket.handshake.headers)) {
      next(new Error("ORIGIN_NOT_ALLOWED"));
      return;
    }

    const sessionId = readCookie(
      socket.handshake.headers.cookie,
      SESSION_COOKIE,
    );
    if (!sessionId) {
      next(new Error("UNAUTHORIZED"));
      return;
    }

    const user = getSessionUser(db, sessionId);
    if (!user) {
      next(new Error("UNAUTHORIZED"));
      return;
    }

    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.user.id;
    void socket.join(userRoom(userId));

    socket.on("subscribe:project", (payload, ack) => {
      const projectId = readProjectId(payload);
      if (projectId === null || !getMembership(db, userId, projectId)) {
        ack?.({ ok: false });
        return;
      }

      void socket.join(projectRoom(projectId));
      ack?.({ ok: true });
    });

    socket.on("unsubscribe:project", (payload) => {
      const projectId = readProjectId(payload);
      if (projectId === null) {
        return;
      }
      void socket.leave(projectRoom(projectId));
    });
  });

  const realtime: Realtime = {
    emitQuestChanged(projectId, questId) {
      io.to(projectRoom(projectId)).emit("quest:changed", {
        projectId,
        questId,
      });
    },

    emitChatChanged(projectId, questId) {
      io.to(projectRoom(projectId)).emit("chat:changed", {
        projectId,
        questId,
      });
    },

    emitNotification(userId, notification) {
      io.to(userRoom(userId)).emit("notification:new", { notification });
    },

    emitXpChanged(input) {
      const payload: XpChangedEvent = {
        userId: input.userId,
        xp: input.xp,
        level: input.level,
      };
      if (input.levelUp !== undefined) {
        payload.levelUp = input.levelUp;
      }

      io.to(userRoom(input.userId)).emit("xp:changed", payload);
      io.to(projectRoom(input.projectId)).emit("members:changed", {
        projectId: input.projectId,
      });
    },

    emitMembersChanged(projectId) {
      io.to(projectRoom(projectId)).emit("members:changed", { projectId });
    },
  };

  return {
    io,
    realtime,
    async close() {
      await io.close();
    },
  };
}

declare module "fastify" {
  interface FastifyInstance {
    /** Realtime broadcaster installed by `buildApp`. */
    realtime: Realtime;
  }
}
