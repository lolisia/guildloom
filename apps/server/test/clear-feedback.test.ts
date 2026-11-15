/**
 * F1 clear feedback tests.
 *
 * Covers `GET /api/quests/:id/clear-preview`, `POST /api/quests/:id/unclear`,
 * the per-clear-round ledger keys and the revocation performed when a cleared
 * card is dragged back out of the cleared column.
 */
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ClearPreviewResponse,
  ClearQuestResponse,
  Notification,
  NotificationListResponse,
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
    loginId: "feedback.owner",
    displayName: "의뢰인",
  });
  alice = createUser(test.db, {
    loginId: "feedback.alice",
    displayName: "앨리스",
  });
  bob = createUser(test.db, { loginId: "feedback.bob", displayName: "밥" });
  carol = createUser(test.db, {
    loginId: "feedback.carol",
    displayName: "캐럴",
  });
  outsider = createUser(test.db, {
    loginId: "feedback.outsider",
    displayName: "외부인",
  });

  project = createProject(test.db, { ownerId: owner.id, name: "피드백 길드" });
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

/** Create a quest owned by `owner` (the requester). */
async function createQuest(title = "피드백 의뢰"): Promise<Quest> {
  const response = await test.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/quests`,
    headers: { cookie: ownerCookie },
    payload: { title },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Quest;
}

function joinQuest(questId: number, cookie: string) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/join`,
    headers: { cookie },
  });
}

function clearQuest(questId: number, cookie: string = ownerCookie) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/clear`,
    headers: { cookie },
  });
}

function unclearQuest(questId: number, cookie: string = ownerCookie) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/unclear`,
    headers: { cookie },
  });
}

function moveQuest(
  questId: number,
  stage: string,
  cookie: string = ownerCookie,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/move`,
    headers: { cookie },
    payload: { stage },
  });
}

function getPreview(questId: number, cookie: string = ownerCookie) {
  return test.app.inject({
    method: "GET",
    url: `/api/quests/${questId}/clear-preview`,
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

function notificationRows(userId: number, type?: string) {
  return test.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(asc(notifications.id))
    .all()
    // `clear_revoked` is accepted at runtime by the shared enum but is not in
    // the pre-F1 TypeScript union yet, so filter by value in memory.
    .filter((row) => type === undefined || row.type === type);
}

function storedUser(userId: number): UserRow {
  const row = test.db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) {
    throw new Error(`missing user ${userId}`);
  }
  return row;
}

function storedQuest(questId: number) {
  const row = test.db.select().from(quests).where(eq(quests.id, questId)).get();
  if (!row) {
    throw new Error(`missing quest ${questId}`);
  }
  return row;
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

describe("GET /api/quests/:id/clear-preview", () => {
  it("matches the real settlement and writes nothing", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    await joinQuest(quest.id, bobCookie);

    const eventsBefore = eventRows(quest.id).length;
    const before = storedQuest(quest.id);
    const preview = await getPreview(quest.id, carolCookie);

    expect(preview.statusCode).toBe(200);
    const body = preview.json() as ClearPreviewResponse;
    expect(body).toEqual({
      total: 40,
      rewards: [
        { user: { id: alice.id, displayName: "앨리스" }, amount: 20 },
        { user: { id: bob.id, displayName: "밥" }, amount: 20 },
      ],
      requesterBonus: {
        user: { id: owner.id, displayName: "의뢰인" },
        amount: 5,
      },
      // Carol is a guild member, but neither the requester nor in the party.
      actorIsInvolved: false,
    });

    // Read-only: no ledger, event, inbox or quest row changed.
    expect(ledgerRows(quest.id)).toEqual([]);
    expect(eventRows(quest.id)).toHaveLength(eventsBefore);
    expect(notificationRows(owner.id)).toEqual([]);
    expect(notificationRows(alice.id)).toEqual([]);
    expect(storedQuest(quest.id)).toEqual(before);

    // The actual clear pays exactly the previewed amounts.
    const clear = await clearQuest(quest.id);
    expect(clear.statusCode).toBe(200);
    const cleared = clear.json() as ClearQuestResponse;
    expect(
      cleared.rewards
        .filter((reward) => reward.userId !== owner.id)
        .map((reward) => ({ userId: reward.userId, amount: reward.amount })),
    ).toEqual(
      body.rewards.map((reward) => ({
        userId: reward.user.id,
        amount: reward.amount,
      })),
    );
    expect(cleared.rewards.find((reward) => reward.userId === owner.id)).toEqual(
      { userId: owner.id, amount: body.requesterBonus?.amount },
    );
  });

  it("reports the requester bonus only when the creator is not in the party", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, ownerCookie);
    await joinQuest(quest.id, aliceCookie);

    const preview = await getPreview(quest.id, ownerCookie);
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as ClearPreviewResponse;
    expect(body.total).toBe(40);
    expect(body.rewards).toEqual([
      { user: { id: owner.id, displayName: "의뢰인" }, amount: 20 },
      { user: { id: alice.id, displayName: "앨리스" }, amount: 20 },
    ]);
    expect(body.requesterBonus).toBeNull();
    expect(body.actorIsInvolved).toBe(true);

    const partyView = await getPreview(quest.id, aliceCookie);
    expect((partyView.json() as ClearPreviewResponse).actorIsInvolved).toBe(
      true,
    );
  });

  it("only previews a quest that can still be cleared", async () => {
    const cleared = await createQuest("이미 클리어");
    expect((await clearQuest(cleared.id)).statusCode).toBe(200);
    expect((await getPreview(cleared.id)).statusCode).toBe(409);

    const archived = await createQuest("보관 의뢰");
    await test.app.inject({
      method: "POST",
      url: `/api/quests/${archived.id}/archive`,
      headers: { cookie: ownerCookie },
      payload: {},
    });
    expect((await getPreview(archived.id)).statusCode).toBe(409);

    // Board, dungeon and boss are all previewable.
    const board = await createQuest("게시판 의뢰");
    expect((await getPreview(board.id)).statusCode).toBe(200);
    expect((await moveQuest(board.id, "dungeon")).statusCode).toBe(200);
    expect((await getPreview(board.id)).statusCode).toBe(200);
    expect((await moveQuest(board.id, "boss")).statusCode).toBe(200);
    expect((await getPreview(board.id)).statusCode).toBe(200);

    expect((await getPreview(board.id, outsiderCookie)).statusCode).toBe(403);
    expect((await getPreview(999_999)).statusCode).toBe(404);
  });
});

describe("POST /api/quests/:id/unclear", () => {
  it("returns to the boss column, revokes the round and notifies the party", async () => {
    const filler = await createQuest("기존 보스");
    expect((await moveQuest(filler.id, "boss")).statusCode).toBe(200);
    const fillerOrderKey = storedQuest(filler.id).orderKey;

    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    await joinQuest(quest.id, bobCookie);
    const clear = await clearQuest(quest.id);
    expect(clear.statusCode).toBe(200);
    expect(storedUser(alice.id).xp).toBe(20);
    expect(storedUser(bob.id).xp).toBe(20);
    expect(storedUser(owner.id).xp).toBe(5);
    expect(storedQuest(quest.id).clearRound).toBe(1);

    const recorded = recordRealtime();
    const response = await unclearQuest(quest.id, carolCookie);

    expect(response.statusCode).toBe(200);
    const detail = response.json() as Quest;
    expect(detail.stage).toBe("boss");
    // Appended to the bottom of the boss column.
    expect(detail.orderKey > fillerOrderKey).toBe(true);
    // Party statuses are untouched by an unclear.
    expect(partyRow(quest.id, alice.id)?.status).toBe("joined");
    expect(partyRow(quest.id, bob.id)?.status).toBe("joined");
    expect(storedQuest(quest.id).clearRound).toBe(1);

    // XP is back to the pre-clear totals.
    expect(storedUser(alice.id).xp).toBe(0);
    expect(storedUser(bob.id).xp).toBe(0);
    expect(storedUser(owner.id).xp).toBe(0);
    expect(storedUser(carol.id).xp).toBe(0);

    // Every award of this round has a matching negative offset.
    expect(
      ledgerRows(quest.id).map((row) => [
        row.reason,
        row.amount,
        row.idemKey,
      ]),
    ).toEqual([
      ["clear", 20, `clear:${quest.id}:${alice.id}`],
      ["clear", 20, `clear:${quest.id}:${bob.id}`],
      ["requester", 5, `requester:${quest.id}`],
      ["revoke", -20, `revoke:clear:${quest.id}:${alice.id}`],
      ["revoke", -20, `revoke:clear:${quest.id}:${bob.id}`],
      ["revoke", -5, `revoke:requester:${quest.id}`],
    ]);

    expect(eventPayloads(quest.id, "clear_revoked")).toEqual([
      { xpRevoked: 45 },
    ]);
    expect(
      eventRows(quest.id).filter((event) => event.type === "clear_revoked"),
    ).toHaveLength(1);

    // The requester and the active party hear about it; the actor does not.
    for (const member of [owner, alice, bob]) {
      const rows = notificationRows(member.id, "clear_revoked");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        projectId: project.id,
        questId: quest.id,
        actorUserId: carol.id,
      });
      expect(JSON.parse(rows[0]?.payload ?? "{}")).toEqual({
        xpRevoked: 45,
      });
    }
    expect(notificationRows(carol.id, "clear_revoked")).toEqual([]);

    // The new notification type survives the REST serializer too.
    const inbox = await test.app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { cookie: aliceCookie },
    });
    expect(inbox.statusCode).toBe(200);
    expect(
      (inbox.json() as NotificationListResponse).items.some(
        (item) => String(item.type) === "clear_revoked",
      ),
    ).toBe(true);

    // Realtime: quest refresh, XP for every affected user, inbox, members.
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(recorded.xp).toEqual([
      { userId: alice.id, projectId: project.id, xp: 0, level: 1 },
      { userId: bob.id, projectId: project.id, xp: 0, level: 1 },
      { userId: owner.id, projectId: project.id, xp: 0, level: 1 },
    ]);
    expect(
      recorded.notifications.map((entry) => entry.userId),
    ).toEqual([owner.id, alice.id, bob.id]);
    expect(recorded.members).toEqual([project.id]);

    // A quest that is not cleared cannot be unclear-ed twice.
    const again = await unclearQuest(quest.id, carolCookie);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("NOT_CLEARED");
    expect(eventPayloads(quest.id, "clear_revoked")).toHaveLength(1);
  });

  it("floors XP at zero and lowers the derived level without a level-up effect", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    expect((await clearQuest(quest.id)).statusCode).toBe(200);

    // The adventurer already spent XP since the clear (and is level 2); the
    // requester has nothing left at all. A full revocation would take more
    // than either balance holds, so the new XP is floored at zero.
    test.db.update(users).set({ xp: 130 }).where(eq(users.id, alice.id)).run();
    test.db.update(users).set({ xp: 0 }).where(eq(users.id, owner.id)).run();

    const recorded = recordRealtime();
    const response = await unclearQuest(quest.id, carolCookie);
    expect(response.statusCode).toBe(200);

    expect(storedUser(alice.id).xp).toBe(90);
    expect(storedUser(owner.id).xp).toBe(0);

    // The ledger offsets always mirror the original amounts in full.
    expect(
      ledgerRows(quest.id)
        .filter((row) => row.reason === "revoke")
        .map((row) => row.amount),
    ).toEqual([-40, -5]);
    // `xpRevoked` reports what was actually recovered (the requester had none
    // left to take back).
    expect(eventPayloads(quest.id, "clear_revoked")).toEqual([
      { xpRevoked: 40 },
    ]);

    // No level-down animation: the payload carries the new level only.
    expect(recorded.xp).toEqual([
      { userId: alice.id, projectId: project.id, xp: 90, level: 1 },
      { userId: owner.id, projectId: project.id, xp: 0, level: 1 },
    ]);
    expect(recorded.xp.every((change) => change.levelUp === undefined)).toBe(
      true,
    );
  });

  it("guards membership and the cleared stage", async () => {
    const quest = await createQuest();
    expect((await unclearQuest(quest.id)).statusCode).toBe(409);
    expect((await unclearQuest(quest.id)).json().error.code).toBe(
      "NOT_CLEARED",
    );

    expect((await clearQuest(quest.id)).statusCode).toBe(200);
    expect((await unclearQuest(quest.id, outsiderCookie)).statusCode).toBe(
      403,
    );
    expect((await unclearQuest(999_999)).statusCode).toBe(404);
  });
});

describe("clear rounds", () => {
  it("re-clears after an unclear in round 2 with the same net XP", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    await joinQuest(quest.id, bobCookie);

    const first = await clearQuest(quest.id);
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as ClearQuestResponse;
    expect(firstBody.rewards).toEqual([
      { userId: alice.id, amount: 20 },
      { userId: bob.id, amount: 20 },
      { userId: owner.id, amount: 5 },
    ]);
    const xpAfterOneClear = new Map(
      [alice, bob, owner].map(
        (user) => [user.id, storedUser(user.id).xp] as const,
      ),
    );

    expect((await unclearQuest(quest.id, carolCookie)).statusCode).toBe(200);
    expect([alice, bob, owner].map((user) => storedUser(user.id).xp)).toEqual([
      0, 0, 0,
    ]);

    const second = await clearQuest(quest.id);
    expect(second.statusCode).toBe(200);
    expect((second.json() as ClearQuestResponse).rewards).toEqual(
      firstBody.rewards,
    );
    for (const user of [alice, bob, owner]) {
      expect(storedUser(user.id).xp).toBe(xpAfterOneClear.get(user.id));
    }
    expect(storedQuest(quest.id).clearRound).toBe(2);

    // Round 2 uses the `:r2` suffix while round 1 keeps the legacy keys.
    const awardKeys = ledgerRows(quest.id)
      .filter((row) => row.reason !== "revoke")
      .map((row) => row.idemKey);
    expect(awardKeys).toEqual([
      `clear:${quest.id}:${alice.id}`,
      `clear:${quest.id}:${bob.id}`,
      `requester:${quest.id}`,
      `clear:${quest.id}:${alice.id}:r2`,
      `clear:${quest.id}:${bob.id}:r2`,
      `requester:${quest.id}:r2`,
    ]);

    // Net ledger per user equals exactly one clear.
    for (const user of [alice, bob, owner]) {
      const net = ledgerRows(quest.id)
        .filter((row) => row.userId === user.id)
        .reduce((sum, row) => sum + row.amount, 0);
      expect(net).toBe(xpAfterOneClear.get(user.id));
    }
  });

  it("revokes a pre-migration round with legacy keys and starts the next clear at r2", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    expect((await clearQuest(quest.id)).statusCode).toBe(200);

    // Quests cleared before migration 0002 have clear_round = 0 and r1 keys.
    test.db
      .update(quests)
      .set({ clearRound: 0 })
      .where(eq(quests.id, quest.id))
      .run();

    expect((await unclearQuest(quest.id, carolCookie)).statusCode).toBe(200);
    expect(storedQuest(quest.id).clearRound).toBe(1);
    expect(storedUser(alice.id).xp).toBe(0);
    expect(storedUser(owner.id).xp).toBe(0);
    expect(
      ledgerRows(quest.id)
        .filter((row) => row.reason === "revoke")
        .map((row) => row.idemKey),
    ).toEqual([
      `revoke:clear:${quest.id}:${alice.id}`,
      `revoke:requester:${quest.id}`,
    ]);

    const reclear = await clearQuest(quest.id);
    expect(reclear.statusCode).toBe(200);
    expect((reclear.json() as ClearQuestResponse).rewards).toEqual([
      { userId: alice.id, amount: 40 },
      { userId: owner.id, amount: 5 },
    ]);
    expect(storedQuest(quest.id).clearRound).toBe(2);
    expect(
      ledgerRows(quest.id)
        .filter((row) => row.reason === "clear")
        .map((row) => row.idemKey),
    ).toEqual([
      `clear:${quest.id}:${alice.id}`,
      `clear:${quest.id}:${alice.id}:r2`,
    ]);
  });

  it("revokes when a cleared card is dragged out and does not revoke a reorder", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    expect((await clearQuest(quest.id)).statusCode).toBe(200);

    // Reordering inside `cleared` keeps the round and the awards.
    expect((await moveQuest(quest.id, "cleared")).statusCode).toBe(200);
    expect(storedUser(alice.id).xp).toBe(40);
    expect(storedQuest(quest.id).clearRound).toBe(1);
    expect(eventPayloads(quest.id, "clear_revoked")).toEqual([]);

    const recorded = recordRealtime();
    const moved = await moveQuest(quest.id, "dungeon");
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as Quest).stage).toBe("dungeon");

    expect(storedUser(alice.id).xp).toBe(0);
    expect(storedUser(owner.id).xp).toBe(0);
    expect(eventPayloads(quest.id, "clear_revoked")).toEqual([
      { xpRevoked: 45 },
    ]);
    // The move event comes first, then the revocation event.
    expect(eventPayloads(quest.id, "quest_moved").at(-1)).toEqual({
      from: "cleared",
      to: "dungeon",
    });
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(recorded.xp).toEqual([
      { userId: alice.id, projectId: project.id, xp: 0, level: 1 },
      { userId: owner.id, projectId: project.id, xp: 0, level: 1 },
    ]);
    // The requester is the actor here, so only the party member is notified.
    expect(recorded.notifications.map((entry) => entry.userId)).toEqual([
      alice.id,
    ]);
    expect(recorded.members).toEqual([project.id]);

    // The next clear after the drag uses round 2.
    expect((await clearQuest(quest.id)).statusCode).toBe(200);
    expect(storedQuest(quest.id).clearRound).toBe(2);
    expect(storedUser(alice.id).xp).toBe(40);
    expect(storedUser(owner.id).xp).toBe(5);
  });
});
