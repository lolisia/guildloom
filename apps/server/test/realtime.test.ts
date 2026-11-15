/**
 * Socket.IO realtime tests.
 *
 * They start a real listener on an ephemeral port (socket.io-client cannot talk
 * to `app.inject()`) and pin the handshake auth, room subscription rules and
 * the quest broadcast the board relies on.
 */
import type { AddressInfo } from "node:net";

import { io as createClient, type Socket } from "socket.io-client";
import { describe, expect, it } from "vitest";

import type { LevelUp, Notification } from "@guildloom/shared";

import type {
  MembersChangedEvent,
  QuestChangedEvent,
  XpChangedEvent,
} from "../src/lib/realtime.js";
import {
  addMember,
  createProject,
  createSessionCookie,
  createTestApp,
  createUser,
  type TestApp,
} from "./helpers.js";

/** Milliseconds before an awaited socket event times out. */
const EVENT_TIMEOUT_MS = 5_000;

/** Milliseconds the app may take to close while a client stays connected. */
const CLOSE_TIMEOUT_MS = 3_000;

/** A test app that is actually listening on `url`. */
interface RunningApp extends TestApp {
  url: string;
}

/** Build an app with realtime enabled and start it on an ephemeral port. */
async function startRealtimeApp(): Promise<RunningApp> {
  const testApp = await createTestApp({ realtime: true });
  await testApp.app.listen({ port: 0, host: "127.0.0.1" });
  const address = testApp.app.server.address() as AddressInfo;

  return { ...testApp, url: `http://127.0.0.1:${address.port}` };
}

/** Handshake headers for a client connection. */
interface ClientOptions {
  /** `Cookie` header carrying the `gl_session` cookie. */
  cookie?: string;
  /** `Origin` header; browsers always send one, non-browser clients may not. */
  origin?: string;
}

/** Open a Socket.IO client with the given handshake headers. */
function connectClient(url: string, options: ClientOptions = {}): Socket {
  const headers: Record<string, string> = {};
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  if (options.origin) {
    headers.origin = options.origin;
  }

  return createClient(url, {
    path: "/socket.io",
    transports: ["websocket"],
    reconnection: false,
    timeout: EVENT_TIMEOUT_MS,
    ...(Object.keys(headers).length > 0 ? { extraHeaders: headers } : {}),
  });
}

/** Resolve once the socket is connected; reject on `connect_error`. */
function waitForConnect(socket: Socket): Promise<void> {
  if (socket.connected) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for connect")),
      EVENT_TIMEOUT_MS,
    );

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Resolve with the handshake error of a rejected connection. */
function waitForConnectError(socket: Socket): Promise<Error> {
  return new Promise<Error>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("expected the connection to be rejected")),
      EVENT_TIMEOUT_MS,
    );

    socket.once("connect_error", (error: Error) => {
      clearTimeout(timer);
      resolve(error);
    });
    socket.once("connect", () => {
      clearTimeout(timer);
      reject(new Error("connection unexpectedly succeeded"));
    });
  });
}

/** Resolve with the next payload of `event`. */
function waitForEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${event}`)),
      EVENT_TIMEOUT_MS,
    );

    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Subscribe to a project room and return the server ack. */
function subscribe(
  socket: Socket,
  projectId: number,
): Promise<{ ok: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for subscribe ack")),
      EVENT_TIMEOUT_MS,
    );

    socket.emit(
      "subscribe:project",
      { projectId },
      (response: { ok: boolean }) => {
        clearTimeout(timer);
        resolve(response);
      },
    );
  });
}

/** Reject when `promise` does not settle within `timeoutMs`. */
function withTimeout<T>(
  promise: Promise<T>,
  message: string,
  timeoutMs = EVENT_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Poll `predicate` until it is true (or fail the test on timeout). */
function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + EVENT_TIMEOUT_MS;

  return new Promise<void>((resolve, reject) => {
    const poll = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(message));
        return;
      }
      setTimeout(poll, 10);
    };

    poll();
  });
}

/** A notification fixture for the `user:<id>` room test. */
function notificationFixture(projectId: number, id = 1): Notification {
  return {
    id,
    projectId,
    questId: null,
    questNumber: null,
    questTitle: null,
    type: "nominated",
    actor: null,
    payload: {},
    createdAt: Date.now(),
    readAt: null,
  };
}

describe("realtime", () => {
  it("attaches no Socket.IO server when realtime is disabled", async () => {
    const { app, close } = await createTestApp();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/socket.io/?EIO=4&transport=polling",
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Not found" },
      });
    } finally {
      await close();
    }
  });

  it("rejects handshakes without a valid gl_session cookie", async () => {
    const running = await startRealtimeApp();
    const missingCookie = connectClient(running.url);
    const unknownSession = connectClient(running.url, {
      cookie: "gl_session=not-a-real-session",
    });

    try {
      const missingError = await waitForConnectError(missingCookie);
      expect(missingError.message).toContain("UNAUTHORIZED");

      const unknownError = await waitForConnectError(unknownSession);
      expect(unknownError.message).toContain("UNAUTHORIZED");

      expect(missingCookie.connected).toBe(false);
      expect(unknownSession.connected).toBe(false);
    } finally {
      missingCookie.close();
      unknownSession.close();
      await running.close();
    }
  });

  it("rejects cross-origin handshakes and accepts same-origin ones", async () => {
    const running = await startRealtimeApp();
    const user = createUser(running.db, { loginId: "browser" });
    const cookie = createSessionCookie(running.db, user.id);

    const foreign = connectClient(running.url, {
      cookie,
      origin: "https://evil.example",
    });
    const sameOrigin = connectClient(running.url, {
      cookie,
      origin: running.url,
    });

    try {
      const error = await waitForConnectError(foreign);
      expect(error.message).toContain("ORIGIN_NOT_ALLOWED");
      expect(foreign.connected).toBe(false);

      await waitForConnect(sameOrigin);
      expect(sameOrigin.connected).toBe(true);
    } finally {
      foreign.close();
      sameOrigin.close();
      await running.close();
    }
  });

  it("delivers quest:changed to subscribed members only", async () => {
    const running = await startRealtimeApp();
    const { app, db } = running;
    const owner = createUser(db, { loginId: "owner" });
    const member = createUser(db, { loginId: "member" });
    const outsider = createUser(db, { loginId: "outsider" });
    const project = createProject(db, { ownerId: owner.id });
    addMember(db, project.id, member.id);

    const memberSocket = connectClient(running.url, {
      cookie: createSessionCookie(db, member.id),
    });
    const outsiderSocket = connectClient(running.url, {
      cookie: createSessionCookie(db, outsider.id),
    });

    try {
      await waitForConnect(memberSocket);
      await waitForConnect(outsiderSocket);

      await expect(subscribe(memberSocket, project.id)).resolves.toEqual({
        ok: true,
      });
      await expect(subscribe(outsiderSocket, project.id)).resolves.toEqual({
        ok: false,
      });

      const outsiderEvents: unknown[] = [];
      outsiderSocket.on("quest:changed", (payload: unknown) => {
        outsiderEvents.push(payload);
      });

      const memberEvent = waitForEvent<QuestChangedEvent>(
        memberSocket,
        "quest:changed",
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/quests`,
        headers: { cookie: createSessionCookie(db, owner.id) },
        payload: { title: "첫 번째 퀘스트" },
      });
      expect(response.statusCode).toBe(201);
      const created = response.json<{ id: number }>();

      await expect(memberEvent).resolves.toEqual({
        projectId: project.id,
        questId: created.id,
      });

      // The non-member never joined `project:<id>`, so it must stay silent.
      // Deliver a notification to it afterwards as positive proof that the
      // socket pipeline is live; Socket.IO keeps per-socket packet order, so
      // the forbidden broadcast cannot merely arrive later than the assertion.
      const fixture = notificationFixture(project.id);
      const outsiderNotification = waitForEvent<{ notification: Notification }>(
        outsiderSocket,
        "notification:new",
      );
      app.realtime.emitNotification(outsider.id, fixture);
      await expect(outsiderNotification).resolves.toEqual({
        notification: fixture,
      });

      expect(outsiderEvents).toEqual([]);
    } finally {
      memberSocket.close();
      outsiderSocket.close();
      await running.close();
    }
  });

  it("broadcasts quest:changed after patch, stage moves and archive", async () => {
    const running = await startRealtimeApp();
    const { app, db } = running;
    const owner = createUser(db, { loginId: "owner" });
    const member = createUser(db, { loginId: "member" });
    const project = createProject(db, { ownerId: owner.id });
    addMember(db, project.id, member.id);
    const ownerCookie = createSessionCookie(db, owner.id);

    const socket = connectClient(running.url, {
      cookie: createSessionCookie(db, member.id),
    });

    try {
      await waitForConnect(socket);
      await expect(subscribe(socket, project.id)).resolves.toEqual({
        ok: true,
      });

      const createdEvent = waitForEvent<QuestChangedEvent>(
        socket,
        "quest:changed",
      );
      const createdResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/quests`,
        headers: { cookie: ownerCookie },
        payload: { title: "방송 테스트" },
      });
      expect(createdResponse.statusCode).toBe(201);
      const questId = createdResponse.json<{ id: number }>().id;
      await expect(createdEvent).resolves.toEqual({
        projectId: project.id,
        questId,
      });

      const patched = waitForEvent<QuestChangedEvent>(socket, "quest:changed");
      const patchResponse = await app.inject({
        method: "PATCH",
        url: `/api/quests/${questId}`,
        headers: { cookie: ownerCookie },
        payload: { title: "수정된 방송 테스트" },
      });
      expect(patchResponse.statusCode).toBe(200);
      await expect(patched).resolves.toEqual({
        projectId: project.id,
        questId,
      });

      const moved = waitForEvent<QuestChangedEvent>(socket, "quest:changed");
      const moveResponse = await app.inject({
        method: "POST",
        url: `/api/quests/${questId}/move`,
        headers: { cookie: ownerCookie },
        payload: { stage: "dungeon" },
      });
      expect(moveResponse.statusCode).toBe(200);
      await expect(moved).resolves.toEqual({
        projectId: project.id,
        questId,
      });

      // Reordering inside the same stage is not a stage change: no broadcast.
      const sameStageEvents: QuestChangedEvent[] = [];
      const collect = (payload: QuestChangedEvent) => {
        sameStageEvents.push(payload);
      };
      socket.on("quest:changed", collect);

      const sameStageResponse = await app.inject({
        method: "POST",
        url: `/api/quests/${questId}/move`,
        headers: { cookie: ownerCookie },
        payload: { stage: "dungeon" },
      });
      expect(sameStageResponse.statusCode).toBe(200);

      // Keep collecting across the archive below: its broadcast proves the
      // socket pipeline is live, and Socket.IO preserves packet order, so the
      // reorder has either broadcast before the archive (two events) or not at
      // all. That is stronger than sleeping and asserting an empty array.
      const archived = waitForEvent<QuestChangedEvent>(socket, "quest:changed");
      const archiveResponse = await app.inject({
        method: "POST",
        url: `/api/quests/${questId}/archive`,
        headers: { cookie: ownerCookie },
        payload: {},
      });
      expect(archiveResponse.statusCode).toBe(200);
      await expect(archived).resolves.toEqual({
        projectId: project.id,
        questId,
      });

      socket.off("quest:changed", collect);
      expect(sameStageEvents).toEqual([{ projectId: project.id, questId }]);

      // Bulk creation broadcasts once per created quest.
      const bulkEvents: QuestChangedEvent[] = [];
      const collectBulk = (payload: QuestChangedEvent) => {
        bulkEvents.push(payload);
      };
      socket.on("quest:changed", collectBulk);

      const bulkResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/quests/bulk`,
        headers: { cookie: ownerCookie },
        payload: { titles: ["대량 퀘스트 하나", "대량 퀘스트 둘"] },
      });
      expect(bulkResponse.statusCode).toBe(201);
      const bulkCreated = bulkResponse.json<Array<{ id: number }>>();

      await waitUntil(
        () => bulkEvents.length === 2,
        "timed out waiting for the bulk quest broadcasts",
      );
      socket.off("quest:changed", collectBulk);

      expect(bulkEvents.every((event) => event.projectId === project.id)).toBe(
        true,
      );
      expect(bulkEvents.map((event) => event.questId).sort((a, b) => a - b))
        .toEqual(bulkCreated.map((quest) => quest.id).sort((a, b) => a - b));
    } finally {
      socket.close();
      await running.close();
    }
  });

  it("delivers notifications to the authenticated user's room", async () => {
    const running = await startRealtimeApp();
    const { app, db } = running;
    const alice = createUser(db, { loginId: "alice" });
    const bob = createUser(db, { loginId: "bob" });
    const project = createProject(db, { ownerId: alice.id });

    const aliceSocket = connectClient(running.url, {
      cookie: createSessionCookie(db, alice.id),
    });
    const bobSocket = connectClient(running.url, {
      cookie: createSessionCookie(db, bob.id),
    });

    try {
      await waitForConnect(aliceSocket);
      await waitForConnect(bobSocket);

      const bobEvents: unknown[] = [];
      bobSocket.on("notification:new", (payload: unknown) => {
        bobEvents.push(payload);
      });

      const notification = notificationFixture(project.id);
      const aliceEvent = waitForEvent<{ notification: Notification }>(
        aliceSocket,
        "notification:new",
      );
      app.realtime.emitNotification(alice.id, notification);

      await expect(aliceEvent).resolves.toEqual({ notification });

      // Bob only receives what is addressed to his own room: a second
      // notification for Bob arrives and Alice's is not among his events.
      const bobNotification = notificationFixture(project.id, 2);
      const bobEvent = waitForEvent<{ notification: Notification }>(
        bobSocket,
        "notification:new",
      );
      app.realtime.emitNotification(bob.id, bobNotification);

      await expect(bobEvent).resolves.toEqual({
        notification: bobNotification,
      });
      expect(bobEvents).toEqual([{ notification: bobNotification }]);
    } finally {
      aliceSocket.close();
      bobSocket.close();
      await running.close();
    }
  });

  it("delivers xp:changed to the user room and members:changed to the project room", async () => {
    const running = await startRealtimeApp();
    const { app, db } = running;
    const alice = createUser(db, { loginId: "alice" });
    const bob = createUser(db, { loginId: "bob" });
    const project = createProject(db, { ownerId: alice.id });
    addMember(db, project.id, bob.id);

    const aliceSocket = connectClient(running.url, {
      cookie: createSessionCookie(db, alice.id),
    });
    const bobSocket = connectClient(running.url, {
      cookie: createSessionCookie(db, bob.id),
    });

    try {
      await waitForConnect(aliceSocket);
      await waitForConnect(bobSocket);

      // Only Alice subscribes to the project room; Bob only has `user:<id>`.
      await expect(subscribe(aliceSocket, project.id)).resolves.toEqual({
        ok: true,
      });

      const bobXpEvents: unknown[] = [];
      const bobMembersEvents: unknown[] = [];
      bobSocket.on("xp:changed", (payload: unknown) => {
        bobXpEvents.push(payload);
      });
      bobSocket.on("members:changed", (payload: unknown) => {
        bobMembersEvents.push(payload);
      });

      const levelUp: LevelUp = { userId: alice.id, from: 2, to: 3 };
      const xpEvent = waitForEvent<XpChangedEvent>(aliceSocket, "xp:changed");
      const membersEvent = waitForEvent<MembersChangedEvent>(
        aliceSocket,
        "members:changed",
      );

      app.realtime.emitXpChanged({
        userId: alice.id,
        projectId: project.id,
        xp: 250,
        level: 3,
        levelUp,
      });

      await expect(xpEvent).resolves.toEqual({
        userId: alice.id,
        xp: 250,
        level: 3,
        levelUp,
      });
      // The project room learns that level badges changed.
      await expect(membersEvent).resolves.toEqual({ projectId: project.id });

      // A direct member-list broadcast uses the same event.
      const directMembers = waitForEvent<MembersChangedEvent>(
        aliceSocket,
        "members:changed",
      );
      app.realtime.emitMembersChanged(project.id);
      await expect(directMembers).resolves.toEqual({
        projectId: project.id,
      });

      // Bob is authenticated but in neither room for these payloads; a
      // notification for Bob afterwards proves his socket is live, so the
      // absence assertions are not just timing luck.
      const bobNotification = notificationFixture(project.id);
      const bobEvent = waitForEvent<{ notification: Notification }>(
        bobSocket,
        "notification:new",
      );
      app.realtime.emitNotification(bob.id, bobNotification);
      await expect(bobEvent).resolves.toEqual({
        notification: bobNotification,
      });

      expect(bobXpEvents).toEqual([]);
      expect(bobMembersEvents).toEqual([]);
    } finally {
      aliceSocket.close();
      bobSocket.close();
      await running.close();
    }
  });

  it("closes the app while a client is still connected", async () => {
    const running = await startRealtimeApp();
    const user = createUser(running.db, { loginId: "closer" });
    const socket = connectClient(running.url, {
      cookie: createSessionCookie(running.db, user.id),
    });

    await waitForConnect(socket);
    expect(socket.connected).toBe(true);

    try {
      // An open websocket keeps the HTTP server alive. The io server must be
      // torn down before Fastify's own `server.close()` (preClose), otherwise
      // the close promise never resolves.
      await expect(
        withTimeout(
          running.close(),
          "app.close() did not resolve while a socket was connected",
          CLOSE_TIMEOUT_MS,
        ),
      ).resolves.toBeUndefined();

      await waitUntil(
        () => !socket.connected,
        "the socket stayed connected after the app closed",
      );
    } finally {
      socket.close();
    }
  }, 15_000);
});
