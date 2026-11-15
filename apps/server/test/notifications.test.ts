/**
 * In-app notification API tests.
 *
 * Notifications are private: the list endpoint only ever returns the session
 * user's rows, and both read-all and read-by-ids must ignore other users' ids.
 * The tests also pin the response shape (quest number/title, actor, payload)
 * and the unread badge count.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  NotificationListResponse,
  NotificationType,
  Quest,
} from "@guildloom/shared";

import {
  notifications,
  type NotificationRow,
  type ProjectRow,
  type UserRow,
} from "../src/db/schema.js";
import {
  addMember,
  createProject,
  createSessionCookie,
  createTestApp,
  createUser,
  type TestApp,
} from "./helpers.js";

let test: TestApp;
let owner: UserRow;
let alice: UserRow;
let project: ProjectRow;
let quest: Quest;
let ownerCookie: string;
let aliceCookie: string;
let sequence: number;

beforeEach(async () => {
  test = await createTestApp();
  owner = createUser(test.db, {
    loginId: "notify.owner",
    displayName: "의뢰인",
  });
  alice = createUser(test.db, {
    loginId: "notify.alice",
    displayName: "앨리스",
  });
  project = createProject(test.db, { ownerId: owner.id, name: "알림 길드" });
  addMember(test.db, project.id, alice.id);
  ownerCookie = createSessionCookie(test.db, owner.id);
  aliceCookie = createSessionCookie(test.db, alice.id);
  sequence = 0;

  const created = await test.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/quests`,
    headers: { cookie: ownerCookie },
    payload: { title: "로그인 버그" },
  });
  expect(created.statusCode).toBe(201);
  quest = created.json() as Quest;
});

afterEach(async () => {
  await test.close();
});

/** Options for {@link insertNotification}. */
interface InsertNotificationOptions {
  userId?: number;
  projectId?: number;
  questId?: number | null;
  type?: NotificationType;
  actorUserId?: number | null;
  payload?: unknown;
  createdAt?: number;
  readAt?: number | null;
}

/** Insert a notification row and return it. */
function insertNotification(
  options: InsertNotificationOptions = {},
): NotificationRow {
  sequence += 1;
  return test.db
    .insert(notifications)
    .values({
      userId: options.userId ?? owner.id,
      projectId: options.projectId ?? project.id,
      questId:
        options.questId === undefined ? quest.id : options.questId,
      type: options.type ?? "nominated",
      actorUserId:
        options.actorUserId === undefined ? alice.id : options.actorUserId,
      payload: JSON.stringify(options.payload ?? {}),
      createdAt: options.createdAt ?? 1_700_000_000_000 + sequence,
      readAt: options.readAt === undefined ? null : options.readAt,
    })
    .returning()
    .get();
}

/** Stored notification row by id. */
function storedNotification(id: number): NotificationRow {
  const row = test.db
    .select()
    .from(notifications)
    .where(eq(notifications.id, id))
    .get();
  if (!row) {
    throw new Error(`missing notification ${id}`);
  }
  return row;
}

/** GET the notification inbox. */
async function listNotifications(
  query: { unread?: string; limit?: number } = {},
  cookie: string = ownerCookie,
) {
  const params = new URLSearchParams();
  if (query.unread !== undefined) {
    params.set("unread", query.unread);
  }
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  const suffix = params.toString();
  return test.app.inject({
    method: "GET",
    url: `/api/notifications${suffix.length > 0 ? `?${suffix}` : ""}`,
    headers: { cookie },
  });
}

/** POST a read request (`undefined` sends no body at all). */
async function readNotifications(
  payload?: Record<string, unknown>,
  cookie: string = ownerCookie,
) {
  return test.app.inject({
    method: "POST",
    url: "/api/notifications/read",
    headers: { cookie },
    ...(payload === undefined ? {} : { payload }),
  });
}

describe("GET /api/notifications", () => {
  it("returns only my notifications newest first with quest, actor and unread count", async () => {
    const oldest = insertNotification({
      createdAt: 1_000,
      payload: { nominationId: 7 },
    });
    const read = insertNotification({
      createdAt: 2_000,
      type: "relayed",
      readAt: 2_500,
    });
    const newest = insertNotification({
      createdAt: 3_000,
      type: "boss_engaged",
      actorUserId: null,
    });
    const theirs = insertNotification({
      userId: alice.id,
      createdAt: 4_000,
      type: "retry_requested",
    });

    const response = await listNotifications();

    expect(response.statusCode).toBe(200);
    const body = response.json() as NotificationListResponse;
    expect(body.unreadCount).toBe(2);
    expect(body.items.map((item) => item.id)).toEqual([
      newest.id,
      read.id,
      oldest.id,
    ]);
    expect(body.items[0]).toMatchObject({
      id: newest.id,
      projectId: project.id,
      questId: quest.id,
      questNumber: quest.number,
      questTitle: quest.title,
      type: "boss_engaged",
      actor: null,
      payload: {},
      createdAt: 3_000,
      readAt: null,
    });
    expect(body.items[1]).toMatchObject({
      actor: { id: alice.id, displayName: "앨리스" },
      payload: {},
      readAt: 2_500,
    });
    expect(body.items[2]?.payload).toEqual({ nominationId: 7 });
    expect(body.items.map((item) => item.id)).not.toContain(theirs.id);

    // The other user's inbox is disjoint and has its own unread count.
    const theirsResponse = await listNotifications({}, aliceCookie);
    const theirsBody = theirsResponse.json() as NotificationListResponse;
    expect(theirsBody.items.map((item) => item.id)).toEqual([theirs.id]);
    expect(theirsBody.unreadCount).toBe(1);
  });

  it("orders tied timestamps by newest id", async () => {
    const first = insertNotification({ createdAt: 5_000 });
    const second = insertNotification({ createdAt: 5_000 });

    const body = (
      await listNotifications()
    ).json() as NotificationListResponse;

    expect(body.items.map((item) => item.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("filters unread pages but counts every unread row", async () => {
    const unreadOld = insertNotification({ createdAt: 1_000 });
    insertNotification({ createdAt: 2_000, readAt: 2_500 });
    const unreadNew = insertNotification({ createdAt: 3_000 });

    const unreadResponse = await listNotifications({ unread: "1" });
    expect(unreadResponse.statusCode).toBe(200);
    const unreadBody = unreadResponse.json() as NotificationListResponse;
    expect(unreadBody.items.map((item) => item.id)).toEqual([
      unreadNew.id,
      unreadOld.id,
    ]);
    expect(unreadBody.items.every((item) => item.readAt === null)).toBe(true);
    expect(unreadBody.unreadCount).toBe(2);

    const allResponse = await listNotifications({ unread: "0" });
    const allBody = allResponse.json() as NotificationListResponse;
    expect(allBody.items).toHaveLength(3);
    expect(allBody.unreadCount).toBe(2);
  });

  it("defaults to 50 items, caps at 100 and rejects out-of-range limits", async () => {
    const created = Array.from({ length: 105 }, (_, index) =>
      insertNotification({ createdAt: 10_000 + index }),
    );

    const defaults = (await listNotifications()).json() as NotificationListResponse;
    expect(defaults.items).toHaveLength(50);
    expect(defaults.items[0]?.id).toBe(created[104]?.id);
    expect(defaults.items[49]?.id).toBe(created[55]?.id);
    expect(defaults.unreadCount).toBe(105);

    const hundred = (
      await listNotifications({ limit: 100 })
    ).json() as NotificationListResponse;
    expect(hundred.items).toHaveLength(100);
    expect(hundred.items[0]?.id).toBe(created[104]?.id);
    expect(hundred.items[99]?.id).toBe(created[5]?.id);

    const one = (
      await listNotifications({ limit: 1 })
    ).json() as NotificationListResponse;
    expect(one.items.map((item) => item.id)).toEqual([created[104]?.id]);

    expect((await listNotifications({ limit: 101 })).statusCode).toBe(400);
    expect((await listNotifications({ limit: 0 })).statusCode).toBe(400);
  });

  it("returns null references for guild-level or malformed rows", async () => {
    const row = insertNotification({
      questId: null,
      actorUserId: null,
    });
    test.db
      .update(notifications)
      .set({ payload: "{not json" })
      .where(eq(notifications.id, row.id))
      .run();

    const body = (
      await listNotifications()
    ).json() as NotificationListResponse;

    expect(body.items[0]).toMatchObject({
      id: row.id,
      questId: null,
      questNumber: null,
      questTitle: null,
      actor: null,
      payload: {},
    });
  });

  it("lists notifications created by real party actions", async () => {
    const nominated = await test.app.inject({
      method: "POST",
      url: `/api/quests/${quest.id}/nominations`,
      headers: { cookie: aliceCookie },
      payload: { userIds: [owner.id] },
    });
    expect(nominated.statusCode).toBe(200);

    const body = (
      await listNotifications()
    ).json() as NotificationListResponse;

    expect(body.unreadCount).toBe(1);
    expect(body.items[0]).toMatchObject({
      projectId: project.id,
      questId: quest.id,
      questNumber: quest.number,
      questTitle: quest.title,
      type: "nominated",
      actor: { id: alice.id, displayName: "앨리스" },
      readAt: null,
    });

    const aliceBody = (
      await listNotifications({}, aliceCookie)
    ).json() as NotificationListResponse;
    expect(aliceBody.items).toEqual([]);
    expect(aliceBody.unreadCount).toBe(0);
  });

  it("requires authentication", async () => {
    expect(
      (await test.app.inject({ method: "GET", url: "/api/notifications" }))
        .statusCode,
    ).toBe(401);
  });
});

describe("POST /api/notifications/read", () => {
  it("marks every unread row when all is true, never touching other users", async () => {
    const unreadFirst = insertNotification({ createdAt: 1_000 });
    const unreadSecond = insertNotification({ createdAt: 2_000 });
    const alreadyRead = insertNotification({ createdAt: 3_000, readAt: 900 });
    const theirs = insertNotification({
      userId: alice.id,
      createdAt: 4_000,
    });

    const response = await readNotifications({ all: true });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(storedNotification(unreadFirst.id).readAt).not.toBeNull();
    expect(storedNotification(unreadSecond.id).readAt).not.toBeNull();
    expect(storedNotification(alreadyRead.id).readAt).toBe(900);
    expect(storedNotification(theirs.id).readAt).toBeNull();

    const mine = (await listNotifications()).json() as NotificationListResponse;
    expect(mine.unreadCount).toBe(0);

    const other = (
      await listNotifications({}, aliceCookie)
    ).json() as NotificationListResponse;
    expect(other.unreadCount).toBe(1);
  });

  it("marks only the listed ids that belong to me", async () => {
    const first = insertNotification({ createdAt: 1_000 });
    const second = insertNotification({ createdAt: 2_000 });
    const third = insertNotification({ createdAt: 3_000 });
    const theirs = insertNotification({
      userId: alice.id,
      createdAt: 4_000,
    });

    const response = await readNotifications({
      ids: [first.id, third.id, theirs.id, 999_999],
    });

    expect(response.statusCode).toBe(204);
    expect(storedNotification(first.id).readAt).not.toBeNull();
    expect(storedNotification(second.id).readAt).toBeNull();
    expect(storedNotification(third.id).readAt).not.toBeNull();
    expect(storedNotification(theirs.id).readAt).toBeNull();

    // Passing another user's id alone is ignored.
    expect(
      (await readNotifications({ ids: [theirs.id] })).statusCode,
    ).toBe(204);
    expect(storedNotification(theirs.id).readAt).toBeNull();

    const mine = (await listNotifications()).json() as NotificationListResponse;
    expect(mine.unreadCount).toBe(1);
    expect(mine.items.filter((item) => item.readAt === null)).toHaveLength(1);

    const other = (
      await listNotifications({}, aliceCookie)
    ).json() as NotificationListResponse;
    expect(other.unreadCount).toBe(1);
  });

  it("lets read-all win over explicit ids", async () => {
    const first = insertNotification({ createdAt: 1_000 });
    const second = insertNotification({ createdAt: 2_000 });

    expect(
      (await readNotifications({ all: true, ids: [first.id] })).statusCode,
    ).toBe(204);

    expect(storedNotification(first.id).readAt).not.toBeNull();
    expect(storedNotification(second.id).readAt).not.toBeNull();
  });

  it("accepts an empty body or empty id list without changing anything", async () => {
    const row = insertNotification();

    expect((await readNotifications()).statusCode).toBe(204);
    expect(storedNotification(row.id).readAt).toBeNull();

    expect((await readNotifications({})).statusCode).toBe(204);
    expect(storedNotification(row.id).readAt).toBeNull();

    expect((await readNotifications({ ids: [] })).statusCode).toBe(204);
    expect(storedNotification(row.id).readAt).toBeNull();
  });

  it("requires authentication", async () => {
    expect(
      (
        await test.app.inject({
          method: "POST",
          url: "/api/notifications/read",
          payload: { all: true },
        })
      ).statusCode,
    ).toBe(401);
  });
});
