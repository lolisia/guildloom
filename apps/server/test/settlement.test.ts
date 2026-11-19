/**
 * Clear settlement and retry tests.
 *
 * They cover the whole HTTP surface of `POST /api/quests/:id/clear`,
 * `POST /api/quests/:id/retry` and the `cleared` branch of
 * `POST /api/quests/:id/move`: bounty splitting, requester XP, per-round
 * idempotent ledger keys, level ups, member resets, notifications, the
 * revocation of a round when the card leaves `cleared`, and realtime signals.
 */
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ClearQuestResponse,
  MeResponse,
  Notification,
  NotificationType,
  ProjectDetailResponse,
  Quest,
} from "@guildloom/shared";

import {
  notifications,
  partyMembers,
  questEvents,
  quests,
  users,
  xpLedger,
  type ProjectRow,
  type UserRow,
} from "../src/db/schema.js";
import type { Realtime, XpChangedInput } from "../src/lib/realtime.js";
import {
  addMember,
  createProject,
  createSessionCookie,
  createTestApp,
  createUser,
  type TestApp,
} from "./helpers.js";

/** One day in milliseconds, matching the bounty calculation. */
const DAY = 86_400_000;

let test: TestApp;
let owner: UserRow;
let alice: UserRow;
let bob: UserRow;
let carol: UserRow;
let outsider: UserRow;
let project: ProjectRow;
let ownerCookie: string;
let aliceCookie: string;
let bobCookie: string;
let carolCookie: string;
let outsiderCookie: string;

beforeEach(async () => {
  test = await createTestApp();
  owner = createUser(test.db, {
    loginId: "settle.owner",
    displayName: "의뢰인",
  });
  alice = createUser(test.db, { loginId: "settle.alice", displayName: "앨리스" });
  bob = createUser(test.db, { loginId: "settle.bob", displayName: "밥" });
  carol = createUser(test.db, { loginId: "settle.carol", displayName: "캐럴" });
  outsider = createUser(test.db, {
    loginId: "settle.outsider",
    displayName: "외부인",
  });
  project = createProject(test.db, { ownerId: owner.id, name: "정산 길드" });
  addMember(test.db, project.id, alice.id);
  addMember(test.db, project.id, bob.id);
  addMember(test.db, project.id, carol.id);

  ownerCookie = createSessionCookie(test.db, owner.id);
  aliceCookie = createSessionCookie(test.db, alice.id);
  bobCookie = createSessionCookie(test.db, bob.id);
  carolCookie = createSessionCookie(test.db, carol.id);
  outsiderCookie = createSessionCookie(test.db, outsider.id);
});

afterEach(async () => {
  await test.close();
});

/**
 * POST a quest and return its detail.
 *
 * Ranks no longer change the bounty: every clear is worth BASE_CLEAR_XP (40).
 */
async function createQuest(title = "정산 의뢰"): Promise<Quest> {
  const response = await test.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/quests`,
    headers: { cookie: ownerCookie },
    payload: { title },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Quest;
}

function clearQuest(questId: number, cookie: string = ownerCookie) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/clear`,
    headers: { cookie },
  });
}

function retryQuest(
  questId: number,
  comment: string,
  cookie: string = aliceCookie,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/retry`,
    headers: { cookie },
    payload: { comment },
  });
}

function joinQuest(questId: number, cookie: string) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/join`,
    headers: { cookie },
  });
}

function setStatus(questId: number, status: string, cookie: string) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/status`,
    headers: { cookie },
    payload: { status },
  });
}

function moveQuest(
  questId: number,
  stage: string,
  cookie: string = ownerCookie,
  neighbors: { beforeId?: number; afterId?: number } = {},
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/move`,
    headers: { cookie },
    payload: { stage, ...neighbors },
  });
}

function getQuest(questId: number, cookie: string = ownerCookie) {
  return test.app.inject({
    method: "GET",
    url: `/api/quests/${questId}`,
    headers: { cookie },
  });
}

function ledgerRows(questId: number) {
  return test.db
    .select()
    .from(xpLedger)
    .where(eq(xpLedger.questId, questId))
    .orderBy(asc(xpLedger.id))
    .all();
}

function eventRows(questId: number) {
  return test.db
    .select()
    .from(questEvents)
    .where(eq(questEvents.questId, questId))
    .orderBy(asc(questEvents.id))
    .all();
}

function eventPayloads(questId: number, type: string): unknown[] {
  return eventRows(questId)
    .filter((event) => event.type === type)
    .map((event) => JSON.parse(event.payload) as unknown);
}

function notificationRows(userId: number, type?: NotificationType) {
  const conditions = [eq(notifications.userId, userId)];
  if (type !== undefined) {
    conditions.push(eq(notifications.type, type));
  }
  return test.db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(asc(notifications.id))
    .all();
}

function partyRow(questId: number, userId: number) {
  return test.db
    .select()
    .from(partyMembers)
    .where(
      and(eq(partyMembers.questId, questId), eq(partyMembers.userId, userId)),
    )
    .get();
}

function storedUser(userId: number): UserRow {
  const row = test.db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) {
    throw new Error(`missing user ${userId}`);
  }
  return row;
}

/** Replace the app's broadcaster with one that records emitted payloads. */
interface RecordedRealtime {
  quests: Array<{ projectId: number; questId: number }>;
  notifications: Array<{ userId: number; notification: Notification }>;
  xp: XpChangedInput[];
  members: number[];
}

function recordRealtime(): RecordedRealtime {
  const recorded: RecordedRealtime = {
    quests: [],
    notifications: [],
    xp: [],
    members: [],
  };
  const realtime: Realtime = {
    emitQuestChanged(projectId, questId) {
      recorded.quests.push({ projectId, questId });
    },
    emitChatChanged() {},
    emitNotification(userId, notification) {
      recorded.notifications.push({ userId, notification });
    },
    emitXpChanged(input) {
      recorded.xp.push(input);
    },
    emitMembersChanged(projectId) {
      recorded.members.push(projectId);
    },
  };
  test.app.realtime = realtime;
  return recorded;
}

describe("clear settlement", () => {
  it("splits the bounty evenly, gives the leader the remainder and pays the requester", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    await joinQuest(quest.id, bobCookie);
    await joinQuest(quest.id, carolCookie);

    const response = await clearQuest(quest.id);
    expect(response.statusCode).toBe(200);
    const body = response.json() as ClearQuestResponse;

    expect(body.quest.stage).toBe("cleared");
    expect(body.quest.party.map((member) => member.user.id)).toEqual([
      alice.id,
      bob.id,
      carol.id,
    ]);
    // 40 XP across three members: the leader takes the single remainder.
    expect(body.rewards).toEqual([
      { userId: alice.id, amount: 14 },
      { userId: bob.id, amount: 13 },
      { userId: carol.id, amount: 13 },
      { userId: owner.id, amount: 5 },
    ]);
    expect(body.levelUps).toEqual([]);
    expect(body.quest.bounty).toMatchObject({
      base: 40,
      multiplier: 1,
      total: 40,
      days: 0,
      dusty: false,
    });

    // Exactly the contract idempotency keys are written.
    expect(
      ledgerRows(quest.id).map((row) => [
        row.userId,
        row.reason,
        row.amount,
        row.idemKey,
      ]),
    ).toEqual([
      [alice.id, "clear", 14, `clear:${quest.id}:${alice.id}`],
      [bob.id, "clear", 13, `clear:${quest.id}:${bob.id}`],
      [carol.id, "clear", 13, `clear:${quest.id}:${carol.id}`],
      [owner.id, "requester", 5, `requester:${quest.id}`],
    ]);
    expect(storedUser(alice.id).xp).toBe(14);
    expect(storedUser(bob.id).xp).toBe(13);
    expect(storedUser(carol.id).xp).toBe(13);
    expect(storedUser(owner.id).xp).toBe(5);

    expect(eventPayloads(quest.id, "quest_cleared")).toEqual([
      {
        rewards: [
          { userId: alice.id, name: "앨리스", amount: 14 },
          { userId: bob.id, name: "밥", amount: 13 },
          { userId: carol.id, name: "캐럴", amount: 13 },
          { userId: owner.id, name: "의뢰인", amount: 5 },
        ],
        bounty: {
          base: 40,
          multiplier: 1,
          total: 40,
          days: 0,
          dusty: false,
        },
      },
    ]);

    // Every active member except the actor (the requester) is notified.
    for (const member of [alice, bob, carol]) {
      const rows = notificationRows(member.id, "quest_cleared");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        projectId: project.id,
        questId: quest.id,
        actorUserId: owner.id,
      });
      expect(JSON.parse(rows[0]?.payload ?? "{}")).toMatchObject({
        bounty: { total: 40 },
      });
    }
    expect(notificationRows(owner.id, "quest_cleared")).toHaveLength(0);
  });

  it("reports level ups, broadcasts xp with the crossing and updates the read models", async () => {
    const hero = createUser(test.db, {
      loginId: "settle.hero",
      displayName: "영웅",
      xp: 90,
    });
    addMember(test.db, project.id, hero.id);
    const heroCookie = createSessionCookie(test.db, hero.id);

    const quest = await createQuest();
    await joinQuest(quest.id, heroCookie);

    const recorded = recordRealtime();
    const response = await clearQuest(quest.id);
    expect(response.statusCode).toBe(200);
    const body = response.json() as ClearQuestResponse;

    expect(body.rewards).toEqual([
      { userId: hero.id, amount: 40 },
      { userId: owner.id, amount: 5 },
    ]);
    expect(body.levelUps).toEqual([
      { userId: hero.id, from: 1, to: 2 },
    ]);
    expect(storedUser(hero.id).xp).toBe(130);

    // Broadcast carries the level crossing.
    expect(recorded.xp).toContainEqual({
      userId: hero.id,
      projectId: project.id,
      xp: 130,
      level: 2,
      levelUp: { userId: hero.id, from: 1, to: 2 },
    });

    // GET /api/auth/me reads users.xp, so it must see the award.
    const me = await test.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: heroCookie },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as MeResponse).user).toMatchObject({
      id: hero.id,
      xp: 130,
      level: 2,
    });

    const ownerMe = await test.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: ownerCookie },
    });
    expect((ownerMe.json() as MeResponse).user).toMatchObject({
      xp: 5,
      level: 1,
    });

    // GET /api/projects/:pid reads users.xp too.
    const detail = await test.app.inject({
      method: "GET",
      url: `/api/projects/${project.id}`,
      headers: { cookie: heroCookie },
    });
    expect(detail.statusCode).toBe(200);
    const members = (detail.json() as ProjectDetailResponse).members;
    expect(members.find((member) => member.userId === hero.id)).toMatchObject({
      xp: 130,
      level: 2,
    });
    expect(members.find((member) => member.userId === owner.id)).toMatchObject({
      xp: 5,
      level: 1,
    });
  });

  it("skips the requester bonus when the creator is an active member", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, ownerCookie);

    const response = await clearQuest(quest.id);
    expect(response.statusCode).toBe(200);
    expect((response.json() as ClearQuestResponse).rewards).toEqual([
      { userId: owner.id, amount: 40 },
    ]);

    expect(
      ledgerRows(quest.id).map((row) => [row.reason, row.idemKey]),
    ).toEqual([["clear", `clear:${quest.id}:${owner.id}`]]);
    expect(storedUser(owner.id).xp).toBe(40);
  });

  it("uses first_claimed_at (or now when unclaimed) and applies the multiplier", async () => {
    const claimed = await createQuest();
    test.db
      .update(quests)
      .set({ createdAt: Date.now() - 2 * DAY - 1_000 })
      .where(eq(quests.id, claimed.id))
      .run();
    await joinQuest(claimed.id, aliceCookie);

    const response = await clearQuest(claimed.id);
    expect(response.statusCode).toBe(200);
    const body = response.json() as ClearQuestResponse;
    // 40 * 1.4 = 56 XP, frozen at first_claimed_at.
    expect(body.quest.bounty).toMatchObject({
      base: 40,
      multiplier: 1.4,
      total: 56,
      days: 2,
    });
    expect(body.rewards).toEqual([
      { userId: alice.id, amount: 56 },
      { userId: owner.id, amount: 5 },
    ]);
    expect(storedUser(alice.id).xp).toBe(56);
    expect(eventPayloads(claimed.id, "quest_cleared")).toMatchObject([
      { bounty: { multiplier: 1.4, total: 56, days: 2 } },
    ]);

    // With no party the bounty still freezes at `now` for the event.
    const unclaimed = await createQuest("미클레임 의뢰");
    test.db
      .update(quests)
      .set({ createdAt: Date.now() - 2 * DAY - 1_000 })
      .where(eq(quests.id, unclaimed.id))
      .run();

    const unclaimedResponse = await clearQuest(unclaimed.id);
    expect(unclaimedResponse.statusCode).toBe(200);
    expect(
      (unclaimedResponse.json() as ClearQuestResponse).rewards,
    ).toEqual([{ userId: owner.id, amount: 5 }]);
    expect(eventPayloads(unclaimed.id, "quest_cleared")).toMatchObject([
      { bounty: { multiplier: 1.4, total: 56, days: 2 } },
    ]);
  });

  it("replays a cleared reorder, then revokes and pays a new round after leaving cleared", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);

    const first = await clearQuest(quest.id);
    expect(first.statusCode).toBe(200);
    expect((first.json() as ClearQuestResponse).rewards).toEqual([
      { userId: alice.id, amount: 40 },
      { userId: owner.id, amount: 5 },
    ]);
    const ledgerAfterFirst = ledgerRows(quest.id);
    expect(ledgerAfterFirst).toHaveLength(2);
    expect(storedUser(alice.id).xp).toBe(40);

    // The stage guard rejects a second clear while already cleared.
    expect((await clearQuest(quest.id)).statusCode).toBe(409);

    // Reordering inside the cleared column is not a new clear: it replays the
    // idempotent settlement without another award, event or notification.
    const eventsAfterClear = eventRows(quest.id).length;
    const notificationsAfterClear = notificationRows(
      alice.id,
      "quest_cleared",
    ).length;
    expect((await moveQuest(quest.id, "cleared")).statusCode).toBe(200);
    expect(ledgerRows(quest.id)).toHaveLength(ledgerAfterFirst.length);
    expect(eventRows(quest.id)).toHaveLength(eventsAfterClear);
    expect(notificationRows(alice.id, "quest_cleared")).toHaveLength(
      notificationsAfterClear,
    );
    expect(storedUser(alice.id).xp).toBe(40);

    // Dragging the card out revokes the round instead of keeping the award.
    const out = await moveQuest(quest.id, "dungeon");
    expect(out.statusCode).toBe(200);
    expect(out.json<Quest>().stage).toBe("dungeon");
    expect(storedUser(alice.id).xp).toBe(0);
    expect(storedUser(owner.id).xp).toBe(0);
    expect(
      ledgerRows(quest.id).map((row) => [
        row.reason,
        row.amount,
        row.idemKey,
      ]),
    ).toEqual([
      ["clear", 40, `clear:${quest.id}:${alice.id}`],
      ["requester", 5, `requester:${quest.id}`],
      ["revoke", -40, `revoke:clear:${quest.id}:${alice.id}`],
      ["revoke", -5, `revoke:requester:${quest.id}`],
    ]);
    expect(eventPayloads(quest.id, "clear_revoked")).toEqual([
      { xpRevoked: 45 },
    ]);
    expect(
      eventRows(quest.id).filter((event) => event.type === "clear_revoked"),
    ).toHaveLength(1);

    // Clearing again starts round 2: the awards are paid again under `:r2`.
    const second = await clearQuest(quest.id);
    expect(second.statusCode).toBe(200);
    expect((second.json() as ClearQuestResponse).rewards).toEqual([
      { userId: alice.id, amount: 40 },
      { userId: owner.id, amount: 5 },
    ]);
    expect(storedUser(alice.id).xp).toBe(40);
    expect(storedUser(owner.id).xp).toBe(5);
    expect(
      ledgerRows(quest.id)
        .filter((row) => row.reason !== "revoke")
        .map((row) => row.idemKey),
    ).toEqual([
      `clear:${quest.id}:${alice.id}`,
      `requester:${quest.id}`,
      `clear:${quest.id}:${alice.id}:r2`,
      `requester:${quest.id}:r2`,
    ]);

    // A reorder in round 2 still pays nothing and revokes nothing.
    expect((await moveQuest(quest.id, "cleared")).statusCode).toBe(200);
    expect(storedUser(alice.id).xp).toBe(40);
    expect(eventPayloads(quest.id, "clear_revoked")).toHaveLength(1);
  });

  it("settles when a card is dragged into cleared at a neighbor order key", async () => {
    const first = await createQuest("먼저 클리어");
    await joinQuest(first.id, aliceCookie);
    const firstMove = await moveQuest(first.id, "cleared");
    expect(firstMove.statusCode).toBe(200);
    const firstDetail = firstMove.json<Quest>();
    expect(firstDetail.stage).toBe("cleared");
    expect(
      ledgerRows(first.id).map((row) => [row.userId, row.idemKey]),
    ).toEqual([
      [alice.id, `clear:${first.id}:${alice.id}`],
      [owner.id, `requester:${first.id}`],
    ]);

    const second = await createQuest("나중 클리어");
    await joinQuest(second.id, bobCookie);
    const moved = await moveQuest(second.id, "cleared", ownerCookie, {
      afterId: first.id,
    });
    expect(moved.statusCode).toBe(200);
    const secondDetail = moved.json<Quest>();
    expect(secondDetail.stage).toBe("cleared");
    // The settlement uses the computed neighbor key: above the first card.
    expect(secondDetail.orderKey < firstDetail.orderKey).toBe(true);
    expect(
      ledgerRows(second.id).map((row) => [row.userId, row.amount]),
    ).toEqual([
      [bob.id, 40],
      [owner.id, 5],
    ]);
  });

  it("keeps manual moves out of the automatic stage machine", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    // All members done would engage the boss; the manual move must not.
    expect((await setStatus(quest.id, "done", aliceCookie)).statusCode).toBe(
      200,
    );
    expect((await getQuest(quest.id)).json<Quest>().stage).toBe("boss");

    const moved = await moveQuest(quest.id, "board");
    expect(moved.statusCode).toBe(200);
    expect(moved.json<Quest>().stage).toBe("board");
    expect(eventPayloads(quest.id, "quest_moved")).toEqual([
      { from: "board", to: "boss", auto: true },
      { from: "boss", to: "board" },
    ]);
  });

  it("guards missing, foreign and closed quests", async () => {
    expect((await clearQuest(999_999)).statusCode).toBe(404);

    const quest = await createQuest();
    expect((await clearQuest(quest.id, outsiderCookie)).statusCode).toBe(403);

    expect((await moveQuest(quest.id, "rumor")).statusCode).toBe(200);
    expect((await clearQuest(quest.id)).statusCode).toBe(409);

    const archived = await createQuest("보관 의뢰");
    await test.app.inject({
      method: "POST",
      url: `/api/quests/${archived.id}/archive`,
      headers: { cookie: ownerCookie },
      payload: {},
    });
    expect((await clearQuest(archived.id)).statusCode).toBe(409);

    expect(ledgerRows(quest.id)).toHaveLength(0);
    expect(ledgerRows(archived.id)).toHaveLength(0);
  });
});

describe("retry", () => {
  it("moves a boss quest to the dungeon, resets done members and notifies the party", async () => {
    const filler = await createQuest("던전 선두");
    expect((await moveQuest(filler.id, "dungeon")).statusCode).toBe(200);
    const fillerOrderKey = (await getQuest(filler.id)).json<Quest>().orderKey;

    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    await joinQuest(quest.id, bobCookie);
    expect((await setStatus(quest.id, "done", aliceCookie)).statusCode).toBe(
      200,
    );
    expect((await setStatus(quest.id, "done", bobCookie)).statusCode).toBe(200);
    expect((await getQuest(quest.id)).json<Quest>().stage).toBe("boss");

    const response = await retryQuest(quest.id, "보스 패턴을 다시 확인해 주세요");
    expect(response.statusCode).toBe(200);
    const detail = response.json<Quest>();
    expect(detail.stage).toBe("dungeon");
    // Appended to the bottom of the dungeon column.
    expect(detail.orderKey > fillerOrderKey).toBe(true);
    expect(
      detail.party.map((member) => [member.user.id, member.status]),
    ).toEqual([
      [alice.id, "fighting"],
      [bob.id, "fighting"],
    ]);
    expect(partyRow(quest.id, alice.id)?.status).toBe("fighting");
    expect(partyRow(quest.id, bob.id)?.status).toBe("fighting");

    expect(eventPayloads(quest.id, "quest_moved")).toEqual([
      { from: "board", to: "boss", auto: true },
      { from: "boss", to: "dungeon" },
    ]);
    expect(eventPayloads(quest.id, "retry_requested")).toEqual([
      { comment: "보스 패턴을 다시 확인해 주세요" },
    ]);
    // The done -> fighting reset is not logged as a manual status change.
    expect(eventPayloads(quest.id, "member_status_changed")).toEqual([
      { from: "joined", to: "done" },
      { from: "joined", to: "done" },
    ]);

    const bobNotifications = notificationRows(bob.id, "retry_requested");
    expect(bobNotifications).toHaveLength(1);
    expect(bobNotifications[0]).toMatchObject({
      projectId: project.id,
      questId: quest.id,
      actorUserId: alice.id,
    });
    expect(JSON.parse(bobNotifications[0]?.payload ?? "{}")).toEqual({
      comment: "보스 패턴을 다시 확인해 주세요",
    });
    // The requester is never notified about their own retry.
    expect(notificationRows(alice.id, "retry_requested")).toHaveLength(0);

    // A second retry is no longer a boss quest.
    expect(
      (await retryQuest(quest.id, "다시 한 번")).statusCode,
    ).toBe(409);
  });

  it("only accepts a retry from the boss stage", async () => {
    const board = await createQuest("게시판 의뢰");
    expect((await retryQuest(board.id, "재도전")).statusCode).toBe(409);
    expect(eventPayloads(board.id, "retry_requested")).toEqual([]);

    const dungeon = await createQuest("던전 의뢰");
    await moveQuest(dungeon.id, "dungeon");
    expect((await retryQuest(dungeon.id, "재도전")).statusCode).toBe(409);

    const cleared = await createQuest("클리어 의뢰");
    expect((await clearQuest(cleared.id)).statusCode).toBe(200);
    expect((await retryQuest(cleared.id, "재도전")).statusCode).toBe(409);

    expect((await retryQuest(999_999, "재도전")).statusCode).toBe(404);

    const boss = await createQuest("보스 의뢰");
    await joinQuest(boss.id, aliceCookie);
    await setStatus(boss.id, "done", aliceCookie);
    expect((await getQuest(boss.id)).json<Quest>().stage).toBe("boss");
    expect(
      (await retryQuest(boss.id, "재도전", outsiderCookie)).statusCode,
    ).toBe(403);

    const emptyComment = await test.app.inject({
      method: "POST",
      url: `/api/quests/${boss.id}/retry`,
      headers: { cookie: aliceCookie },
      payload: { comment: "   " },
    });
    expect(emptyComment.statusCode).toBe(400);
    // The rejected attempts changed nothing.
    expect((await getQuest(boss.id)).json<Quest>().stage).toBe("boss");
  });

  it("broadcasts the quest, member and notification changes after commit", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    await joinQuest(quest.id, bobCookie);
    await setStatus(quest.id, "done", aliceCookie);
    await setStatus(quest.id, "done", bobCookie);

    const recorded = recordRealtime();
    const response = await retryQuest(quest.id, "한 번 더");
    expect(response.statusCode).toBe(200);

    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(recorded.members).toContain(project.id);
    expect(recorded.xp).toEqual([]);
    expect(recorded.notifications).toHaveLength(1);
    expect(recorded.notifications[0]).toMatchObject({
      userId: bob.id,
      notification: {
        type: "retry_requested",
        questId: quest.id,
        questNumber: quest.number,
        questTitle: quest.title,
        actor: { id: alice.id, displayName: "앨리스" },
      },
    });
  });
});

describe("clear realtime signals", () => {
  it("emits quest:changed, xp:changed and members:changed after commit", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);

    const recorded = recordRealtime();
    const response = await clearQuest(quest.id);
    expect(response.statusCode).toBe(200);

    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(recorded.xp).toEqual([
      { userId: alice.id, projectId: project.id, xp: 40, level: 1 },
      { userId: owner.id, projectId: project.id, xp: 5, level: 1 },
    ]);
    expect(recorded.notifications).toHaveLength(1);
    expect(recorded.notifications[0]).toMatchObject({
      userId: alice.id,
      notification: {
        type: "quest_cleared",
        questId: quest.id,
        questNumber: quest.number,
        questTitle: quest.title,
        actor: { id: owner.id, displayName: "의뢰인" },
      },
    });
    expect(recorded.members).toContain(project.id);
  });

  it("does not emit when a clear is rejected", async () => {
    const quest = await createQuest();
    expect((await clearQuest(quest.id)).statusCode).toBe(200);

    const recorded = recordRealtime();
    expect((await clearQuest(quest.id)).statusCode).toBe(409);
    expect(recorded).toEqual({
      quests: [],
      notifications: [],
      xp: [],
      members: [],
    });
  });
});
