/**
 * Party, nomination and auto-transition tests.
 *
 * They exercise the complete HTTP surface: nominations/reinforcements, accept,
 * pass/relay, cancel, join, leave and status, plus the read model fields the
 * board (party, floors, pending nominations, bounty) and the drawer (retreated
 * members, floors, pending nominations) rely on.
 */
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  MyNomination,
  Nomination,
  Notification,
  NotificationType,
  Quest,
  QuestSummary,
} from "@guildloom/shared";

import {
  notifications,
  partyMembers,
  questEvents,
  questNominations,
  quests,
  users,
  xpLedger,
  type ProjectRow,
  type UserRow,
} from "../src/db/schema.js";
import type { Realtime, XpChangedInput } from "../src/lib/realtime.js";
import { awardXp } from "../src/lib/xp.js";
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
    loginId: "party.owner",
    displayName: "의뢰인",
  });
  alice = createUser(test.db, { loginId: "party.alice", displayName: "앨리스" });
  bob = createUser(test.db, { loginId: "party.bob", displayName: "밥" });
  carol = createUser(test.db, { loginId: "party.carol", displayName: "캐럴" });
  outsider = createUser(test.db, {
    loginId: "party.outsider",
    displayName: "외부인",
  });
  project = createProject(test.db, { ownerId: owner.id, name: "파티 길드" });
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

/** POST a quest and return its detail. */
async function createQuest(title = "파티 의뢰"): Promise<Quest> {
  const response = await test.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/quests`,
    headers: { cookie: ownerCookie },
    payload: { title },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Quest;
}

/** POST a nomination batch (`kind` selects the endpoint). */
async function nominate(
  questId: number,
  userIds: number[],
  cookie: string = aliceCookie,
  kind: "nominations" | "reinforcements" = "nominations",
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/${kind}`,
    headers: { cookie },
    payload: { userIds },
  });
}

async function reinforce(
  questId: number,
  userIds: number[],
  cookie: string,
) {
  return nominate(questId, userIds, cookie, "reinforcements");
}

async function acceptNomination(nominationId: number, cookie: string) {
  return test.app.inject({
    method: "POST",
    url: `/api/nominations/${nominationId}/accept`,
    headers: { cookie },
  });
}

async function passNomination(
  nominationId: number,
  payload: Record<string, unknown>,
  cookie: string,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/nominations/${nominationId}/pass`,
    headers: { cookie },
    payload,
  });
}

async function cancelNomination(nominationId: number, cookie: string) {
  return test.app.inject({
    method: "DELETE",
    url: `/api/nominations/${nominationId}`,
    headers: { cookie },
  });
}

async function joinQuest(questId: number, cookie: string) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/join`,
    headers: { cookie },
  });
}

async function leaveQuest(
  questId: number,
  payload: Record<string, unknown>,
  cookie: string,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/leave`,
    headers: { cookie },
    payload,
  });
}

async function setStatus(
  questId: number,
  status: string,
  cookie: string,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/status`,
    headers: { cookie },
    payload: { status },
  });
}

async function getQuest(questId: number, cookie: string = ownerCookie) {
  return test.app.inject({
    method: "GET",
    url: `/api/quests/${questId}`,
    headers: { cookie },
  });
}

async function listQuests(cookie: string = ownerCookie) {
  return test.app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/quests`,
    headers: { cookie },
  });
}

async function moveQuest(questId: number, stage: string) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/move`,
    headers: { cookie: ownerCookie },
    payload: { stage },
  });
}

async function myNominations(cookie: string = ownerCookie) {
  return test.app.inject({
    method: "GET",
    url: "/api/me/nominations",
    headers: { cookie },
  });
}

function eventRows(questId: number) {
  return test.db
    .select()
    .from(questEvents)
    .where(eq(questEvents.questId, questId))
    .orderBy(asc(questEvents.id))
    .all();
}

function eventTypes(questId: number): string[] {
  return eventRows(questId).map((event) => event.type);
}

function eventPayloads(questId: number, type: string): unknown[] {
  return eventRows(questId)
    .filter((event) => event.type === type)
    .map((event) => JSON.parse(event.payload) as unknown);
}

function nominationRows(questId: number) {
  return test.db
    .select()
    .from(questNominations)
    .where(eq(questNominations.questId, questId))
    .orderBy(asc(questNominations.id))
    .all();
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
}

function recordRealtime(): RecordedRealtime {
  const recorded: RecordedRealtime = {
    quests: [],
    notifications: [],
    xp: [],
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
    emitMembersChanged() {},
  };
  test.app.realtime = realtime;
  return recorded;
}

describe("nominations", () => {
  it("nominates guild members, skipping active and already-nominated users", async () => {
    const quest = await createQuest();
    expect((await joinQuest(quest.id, aliceCookie)).statusCode).toBe(200);

    // Alice is active, so only the owner is actually nominated.
    const response = await nominate(quest.id, [alice.id, owner.id], bobCookie);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { nominations: Nomination[] };
    expect(body.nominations).toHaveLength(1);
    expect(body.nominations[0]).toMatchObject({
      questId: quest.id,
      nominee: { id: owner.id, displayName: "의뢰인" },
      nominatedBy: { id: bob.id, displayName: "밥" },
      kind: "nominate",
      state: "pending",
      passReason: null,
    });

    // The target got a notification with the quest references filled in.
    const ownerNotifications = notificationRows(owner.id, "nominated");
    expect(ownerNotifications).toHaveLength(1);
    expect(ownerNotifications[0]).toMatchObject({
      projectId: project.id,
      questId: quest.id,
      actorUserId: bob.id,
      readAt: null,
    });
    expect(JSON.parse(ownerNotifications[0]?.payload ?? "{}")).toEqual({
      nominationId: body.nominations[0]?.id,
    });

    // One event records all accepted targets.
    expect(eventTypes(quest.id)).toContain("nominated");
    expect(eventPayloads(quest.id, "nominated")).toEqual([
      { userIds: [owner.id], names: ["의뢰인"] },
    ]);

    // GET /api/me/nominations returns the pending nomination with quest refs.
    const mine = await myNominations();
    expect(mine.statusCode).toBe(200);
    const items = mine.json() as MyNomination[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      questId: quest.id,
      questNumber: quest.number,
      questTitle: quest.title,
      kind: "nominate",
      state: "pending",
      nominee: { id: owner.id },
      nominatedBy: { id: bob.id },
    });

    // Re-nominating a pending target skips it: nothing is left -> 400.
    const repeated = await nominate(quest.id, [owner.id], aliceCookie);
    expect(repeated.statusCode).toBe(400);
    expect(nominationRows(quest.id)).toHaveLength(1);

    // Nominating an active member alone is also all-skipped.
    const activeOnly = await nominate(quest.id, [alice.id], bobCookie);
    expect(activeOnly.statusCode).toBe(400);

    // A non-member cannot see or nominate into the guild.
    const outside = await nominate(quest.id, [alice.id], outsiderCookie);
    expect(outside.statusCode).toBe(403);
  });

  it("rejects targets that are not guild members with 400", async () => {
    const quest = await createQuest();

    const outsiderTarget = await nominate(quest.id, [outsider.id]);
    expect(outsiderTarget.statusCode).toBe(400);
    expect(outsiderTarget.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    const missingTarget = await nominate(quest.id, [999_999]);
    expect(missingTarget.statusCode).toBe(400);

    expect(nominationRows(quest.id)).toHaveLength(0);
    expect(eventTypes(quest.id)).not.toContain("nominated");
  });

  it("requires an active party member to request reinforcements", async () => {
    const quest = await createQuest();

    // Bob is a guild member but not in the party.
    const notActive = await reinforce(quest.id, [alice.id], bobCookie);
    expect(notActive.statusCode).toBe(403);

    expect((await joinQuest(quest.id, bobCookie)).statusCode).toBe(200);

    const response = await reinforce(quest.id, [alice.id, owner.id], bobCookie);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { nominations: Nomination[] };
    expect(body.nominations.map((nomination) => nomination.nominee.id)).toEqual([
      alice.id,
      owner.id,
    ]);
    expect(body.nominations.every((entry) => entry.kind === "reinforce")).toBe(
      true,
    );

    expect(
      notificationRows(alice.id, "reinforce").map((row) => row.questId),
    ).toEqual([quest.id]);
    expect(notificationRows(owner.id, "reinforce")).toHaveLength(1);
    expect(eventPayloads(quest.id, "reinforcement_requested")).toEqual([
      { userIds: [alice.id, owner.id], names: ["앨리스", "의뢰인"] },
    ]);

    // Reinforcing an already active member is all-skipped.
    const activeOnly = await reinforce(quest.id, [bob.id], bobCookie);
    expect(activeOnly.statusCode).toBe(400);
  });

  it("cancels pending nominations for the nominee or nominator only", async () => {
    const quest = await createQuest();
    const nominated = await nominate(quest.id, [bob.id], aliceCookie);
    const nominationId = (nominated.json() as { nominations: Nomination[] })
      .nominations[0]?.id;
    expect(nominationId).toBeDefined();

    // A third guild member may not cancel it.
    const forbidden = await cancelNomination(nominationId as number, carolCookie);
    expect(forbidden.statusCode).toBe(403);

    const cancelled = await cancelNomination(nominationId as number, bobCookie);
    expect(cancelled.statusCode).toBe(204);
    expect(cancelled.body).toBe("");

    expect(nominationRows(quest.id)[0]).toMatchObject({
      state: "cancelled",
    });
    expect(eventTypes(quest.id)).not.toContain("passed");

    // Cancelling twice conflicts.
    const again = await cancelNomination(nominationId as number, bobCookie);
    expect(again.statusCode).toBe(409);

    const mine = await myNominations(bobCookie);
    expect(mine.json()).toEqual([]);
  });
});

describe("accept", () => {
  it("joins the nominee as leader and claims the quest exactly once", async () => {
    const quest = await createQuest();
    const nominated = await nominate(quest.id, [bob.id], aliceCookie);
    const nominationId = (nominated.json() as { nominations: Nomination[] })
      .nominations[0]?.id as number;

    const forbidden = await acceptNomination(nominationId, aliceCookie);
    expect(forbidden.statusCode).toBe(403);

    const response = await acceptNomination(nominationId, bobCookie);
    expect(response.statusCode).toBe(200);
    const detail = response.json() as Quest;
    expect(detail.firstClaimedAt).not.toBeNull();
    const firstClaimedAt = detail.firstClaimedAt;
    expect(detail.party).toEqual([
      {
        user: { id: bob.id, displayName: "밥" },
        role: "leader",
        status: "joined",
        retreatReason: null,
        joinedAt: expect.any(Number),
      },
    ]);
    expect(detail.party.map((member) => member.user.id)).not.toContain(
      alice.id,
    );
    expect(detail.nominations).toEqual([]);
    expect(detail.bounty.multiplier).toBe(1);

    expect(nominationRows(quest.id)[0]).toMatchObject({
      state: "accepted",
      resolvedAt: expect.any(Number),
    });
    expect(eventTypes(quest.id)).toContain("claimed");
    expect(eventTypes(quest.id)).not.toContain("member_joined");
    expect(eventPayloads(quest.id, "claimed")).toEqual([{}]);

    // Accepting again conflicts and leaves the single party row intact.
    const again = await acceptNomination(nominationId, bobCookie);
    expect(again.statusCode).toBe(409);
    expect(
      test.db
        .select()
        .from(partyMembers)
        .where(eq(partyMembers.questId, quest.id))
        .all(),
    ).toHaveLength(1);

    // A later join keeps the existing leader and does not re-claim the quest.
    expect((await joinQuest(quest.id, aliceCookie)).statusCode).toBe(200);
    const after = (await getQuest(quest.id)).json() as Quest;
    expect(after.firstClaimedAt).toBe(firstClaimedAt);
    expect(after.party.map((member) => [member.user.id, member.role])).toEqual([
      [bob.id, "leader"],
      [alice.id, "member"],
    ]);
  });

  it("resolves pending nominations on a cleared quest with 409", async () => {
    const quest = await createQuest();
    const nominated = await nominate(quest.id, [bob.id], aliceCookie);
    const nominationId = (nominated.json() as { nominations: Nomination[] })
      .nominations[0]?.id as number;

    expect((await moveQuest(quest.id, "cleared")).statusCode).toBe(200);

    const response = await acceptNomination(nominationId, bobCookie);
    expect(response.statusCode).toBe(409);
    expect(nominationRows(quest.id)[0]?.state).toBe("pending");
  });
});

describe("pass and relay", () => {
  it("records a plain pass without touching the party", async () => {
    const quest = await createQuest();
    const nominated = await nominate(quest.id, [bob.id], aliceCookie);
    const nominationId = (nominated.json() as { nominations: Nomination[] })
      .nominations[0]?.id as number;

    const forbidden = await passNomination(
      nominationId,
      { reason: "내 영역 아님" },
      aliceCookie,
    );
    expect(forbidden.statusCode).toBe(403);

    const response = await passNomination(
      nominationId,
      { reason: "내 영역 아님" },
      bobCookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json<Quest>().party).toEqual([]);

    expect(nominationRows(quest.id)[0]).toMatchObject({
      state: "passed",
      passReason: "내 영역 아님",
      resolvedAt: expect.any(Number),
    });
    expect(eventPayloads(quest.id, "passed")).toEqual([
      { reason: "내 영역 아님" },
    ]);
    expect(eventTypes(quest.id)).not.toContain("relayed");
    expect(nominationRows(quest.id)).toHaveLength(1);

    const again = await passNomination(nominationId, {}, bobCookie);
    expect(again.statusCode).toBe(409);
  });

  it("relays to a guild member, notifies them and pays the guide bonus once", async () => {
    const quest = await createQuest();
    const nominated = await nominate(quest.id, [bob.id], aliceCookie);
    const originalId = (nominated.json() as { nominations: Nomination[] })
      .nominations[0]?.id as number;

    const response = await passNomination(
      originalId,
      { reason: "지금 여유 없음", relayToUserId: owner.id },
      bobCookie,
    );
    expect(response.statusCode).toBe(200);
    const detail = response.json() as Quest;
    expect(detail.nominations).toHaveLength(1);
    const relay = detail.nominations[0];
    expect(relay).toMatchObject({
      nominee: { id: owner.id, displayName: "의뢰인" },
      nominatedBy: { id: bob.id, displayName: "밥" },
      kind: "relay",
      state: "pending",
    });

    const original = nominationRows(quest.id)[0];
    expect(original).toMatchObject({
      state: "passed",
      passReason: "지금 여유 없음",
    });

    const relayRow = nominationRows(quest.id).find(
      (row) => row.id === relay?.id,
    );
    expect(relayRow).toMatchObject({
      kind: "relay",
      nomineeId: owner.id,
      nominatedBy: bob.id,
      relayFromNominationId: originalId,
    });

    expect(eventPayloads(quest.id, "relayed")).toEqual([
      { toUserId: owner.id, toName: "의뢰인", reason: "지금 여유 없음" },
    ]);
    expect(eventTypes(quest.id)).not.toContain("passed");

    const relayNotifications = notificationRows(owner.id, "relayed");
    expect(relayNotifications).toHaveLength(1);
    expect(JSON.parse(relayNotifications[0]?.payload ?? "{}")).toEqual({
      nominationId: relay?.id,
      reason: "지금 여유 없음",
    });

    // Nothing is paid until the relay is actually accepted.
    expect(storedUser(bob.id).xp).toBe(0);
    expect(
      test.db.select().from(xpLedger).where(eq(xpLedger.userId, bob.id)).all(),
    ).toHaveLength(0);

    // Joining accepts the pending relay nomination and pays the guide once.
    const joined = await joinQuest(quest.id, ownerCookie);
    expect(joined.statusCode).toBe(200);
    const joinedDetail = joined.json() as Quest;
    expect(joinedDetail.party).toEqual([
      {
        user: { id: owner.id, displayName: "의뢰인" },
        role: "leader",
        status: "joined",
        retreatReason: null,
        joinedAt: expect.any(Number),
      },
    ]);
    expect(eventTypes(quest.id)).toContain("claimed");
    expect(eventTypes(quest.id)).not.toContain("member_joined");
    expect(nominationRows(quest.id)[1]?.state).toBe("accepted");

    expect(storedUser(bob.id).xp).toBe(10);
    const ledger = test.db
      .select()
      .from(xpLedger)
      .where(eq(xpLedger.userId, bob.id))
      .all();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      projectId: project.id,
      questId: quest.id,
      reason: "guide",
      amount: 10,
      idemKey: `guide:${relay?.id}`,
    });

    // Replaying the same idempotency key never pays twice.
    const replay = awardXp(test.db, {
      userId: bob.id,
      projectId: project.id,
      questId: quest.id,
      reason: "guide",
      amount: 10,
      idemKey: `guide:${relay?.id}`,
      now: Date.now(),
    });
    expect(replay.awarded).toBe(false);
    expect(replay.xp).toBe(10);
    expect(storedUser(bob.id).xp).toBe(10);
  });

  it("treats a relay to an already active member as a plain pass", async () => {
    const quest = await createQuest();
    expect((await joinQuest(quest.id, aliceCookie)).statusCode).toBe(200);

    const nominated = await nominate(quest.id, [bob.id], aliceCookie);
    const nominationId = (nominated.json() as { nominations: Nomination[] })
      .nominations[0]?.id as number;

    const response = await passNomination(
      nominationId,
      { relayToUserId: alice.id },
      bobCookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json<Quest>().nominations).toEqual([]);

    expect(nominationRows(quest.id)).toHaveLength(1);
    expect(nominationRows(quest.id)[0]?.state).toBe("passed");
    expect(eventTypes(quest.id)).toContain("passed");
    expect(eventTypes(quest.id)).not.toContain("relayed");
    expect(notificationRows(alice.id, "relayed")).toHaveLength(0);
  });

  it("rejects a relay to someone outside the guild", async () => {
    const quest = await createQuest();
    const nominated = await nominate(quest.id, [bob.id], aliceCookie);
    const nominationId = (nominated.json() as { nominations: Nomination[] })
      .nominations[0]?.id as number;

    const response = await passNomination(
      nominationId,
      { relayToUserId: outsider.id },
      bobCookie,
    );
    expect(response.statusCode).toBe(400);
    expect(nominationRows(quest.id)[0]?.state).toBe("pending");
  });
});

describe("join and leave", () => {
  it("records member_joined on a plain join and is idempotent", async () => {
    const quest = await createQuest();

    const first = await joinQuest(quest.id, bobCookie);
    expect(first.statusCode).toBe(200);
    const joined = first.json() as Quest;
    expect(joined.party).toEqual([
      {
        user: { id: bob.id, displayName: "밥" },
        role: "leader",
        status: "joined",
        retreatReason: null,
        joinedAt: expect.any(Number),
      },
    ]);
    expect(joined.firstClaimedAt).not.toBeNull();
    expect(eventTypes(quest.id)).toContain("member_joined");
    expect(eventTypes(quest.id)).not.toContain("claimed");

    const eventsAfterFirstJoin = eventRows(quest.id).length;
    const recorded = recordRealtime();
    const second = await joinQuest(quest.id, bobCookie);
    expect(second.statusCode).toBe(200);
    expect(eventRows(quest.id)).toHaveLength(eventsAfterFirstJoin);
    expect(partyRow(quest.id, bob.id)?.status).toBe("joined");
    // Re-joining is an idempotent no-op: no realtime churn either.
    expect(recorded).toEqual({ quests: [], notifications: [], xp: [] });
  });

  it("promotes the earliest-joined remaining member when the leader leaves", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    await joinQuest(quest.id, bobCookie);
    await joinQuest(quest.id, carolCookie);

    // Carole joined last but is made the oldest active member, so succession
    // must follow joined_at rather than row id.
    test.db
      .update(partyMembers)
      .set({ joinedAt: 2_000 })
      .where(
        and(
          eq(partyMembers.questId, quest.id),
          eq(partyMembers.userId, bob.id),
        ),
      )
      .run();
    test.db
      .update(partyMembers)
      .set({ joinedAt: 1_000 })
      .where(
        and(
          eq(partyMembers.questId, quest.id),
          eq(partyMembers.userId, carol.id),
        ),
      )
      .run();

    const response = await leaveQuest(
      quest.id,
      { reason: "다른 일이 생김" },
      aliceCookie,
    );
    expect(response.statusCode).toBe(200);
    const detail = response.json() as Quest;
    expect(
      detail.party.map((member) => [
        member.user.id,
        member.role,
        member.status,
      ]),
    ).toEqual([
      [carol.id, "leader", "joined"],
      [bob.id, "member", "joined"],
      [alice.id, "member", "retreated"],
    ]);
    expect(
      detail.party.find((member) => member.user.id === alice.id)?.retreatReason,
    ).toBe("다른 일이 생김");
    expect(detail.party.map((member) => member.user.id)).not.toContain(
      outsider.id,
    );

    expect(eventPayloads(quest.id, "member_left")).toEqual([
      { reason: "다른 일이 생김" },
    ]);
    expect(eventPayloads(quest.id, "leader_changed")).toEqual([
      { userId: carol.id, name: "캐럴" },
    ]);

    // A retreated member cannot leave again.
    const again = await leaveQuest(quest.id, {}, aliceCookie);
    expect(again.statusCode).toBe(403);
  });

  it("returns an empty dungeon to the board", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);

    const fighting = await setStatus(quest.id, "fighting", aliceCookie);
    expect(fighting.statusCode).toBe(200);
    expect(fighting.json<Quest>().stage).toBe("dungeon");

    const response = await leaveQuest(
      quest.id,
      { reason: "후퇴" },
      aliceCookie,
    );
    expect(response.statusCode).toBe(200);
    const detail = response.json() as Quest;
    expect(detail.stage).toBe("board");
    expect(detail.party[0]).toMatchObject({
      user: { id: alice.id },
      status: "retreated",
      retreatReason: "후퇴",
    });
    expect(eventPayloads(quest.id, "quest_moved")).toEqual([
      { from: "board", to: "dungeon", auto: true },
      { from: "dungeon", to: "board", auto: true },
    ]);
    // No one was left to promote.
    expect(eventTypes(quest.id)).not.toContain("leader_changed");
  });

  it("only an active member may set their own status", async () => {
    const quest = await createQuest();

    const notInParty = await setStatus(quest.id, "done", bobCookie);
    expect(notInParty.statusCode).toBe(403);

    await joinQuest(quest.id, aliceCookie);
    const outsiderStatus = await setStatus(quest.id, "done", outsiderCookie);
    expect(outsiderStatus.statusCode).toBe(403);

    const valueError = await setStatus(quest.id, "retreated", aliceCookie);
    expect(valueError.statusCode).toBe(400);
  });
});

describe("auto transitions", () => {
  it("moves a quest to the dungeon when someone starts fighting", async () => {
    const manual = await createQuest("먼저 던전에 있는 의뢰");
    await moveQuest(manual.id, "dungeon");

    const quest = await createQuest("자동 이동 의뢰");
    await joinQuest(quest.id, aliceCookie);

    const response = await setStatus(quest.id, "fighting", aliceCookie);
    expect(response.statusCode).toBe(200);
    const detail = response.json() as Quest;
    expect(detail.stage).toBe("dungeon");

    // Auto moves append to the bottom of the target column.
    const previousBottom = (await getQuest(manual.id)).json<Quest>().orderKey;
    expect(detail.orderKey > previousBottom).toBe(true);

    expect(eventPayloads(quest.id, "quest_moved")).toEqual([
      { from: "board", to: "dungeon", auto: true },
    ]);
    expect(eventPayloads(quest.id, "member_status_changed")).toEqual([
      { from: "joined", to: "fighting" },
    ]);
  });

  it("engages the boss when every active member is done", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);

    const response = await setStatus(quest.id, "done", aliceCookie);
    expect(response.statusCode).toBe(200);
    const detail = response.json() as Quest;
    expect(detail.stage).toBe("boss");

    expect(eventPayloads(quest.id, "quest_moved")).toEqual([
      { from: "board", to: "boss", auto: true },
    ]);
    expect(eventTypes(quest.id)).toContain("boss_engaged");

    const bossNotifications = notificationRows(owner.id, "boss_engaged");
    expect(bossNotifications).toHaveLength(1);
    expect(bossNotifications[0]).toMatchObject({
      projectId: project.id,
      questId: quest.id,
      actorUserId: alice.id,
    });

    // When the requester is the actor, no self-notification is created.
    const ownQuest = await createQuest("의뢰인 직접 공략");
    await joinQuest(ownQuest.id, ownerCookie);
    const ownStatus = await setStatus(ownQuest.id, "done", ownerCookie);
    expect(ownStatus.json<Quest>().stage).toBe("boss");
    expect(notificationRows(owner.id, "boss_engaged")).toHaveLength(1);
  });

  it("pushes a boss quest back to the dungeon when a new member joins", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    expect(
      (await setStatus(quest.id, "done", aliceCookie)).json<Quest>().stage,
    ).toBe("boss");

    const response = await joinQuest(quest.id, bobCookie);
    expect(response.statusCode).toBe(200);
    const detail = response.json() as Quest;
    expect(detail.stage).toBe("dungeon");
    expect(
      detail.party.map((member) => [member.user.id, member.status]),
    ).toEqual([
      [alice.id, "done"],
      [bob.id, "joined"],
    ]);

    expect(eventPayloads(quest.id, "quest_moved")).toEqual([
      { from: "board", to: "boss", auto: true },
      { from: "boss", to: "dungeon", auto: true },
    ]);
  });

  it("never runs the stage machine for a manual move", async () => {
    const quest = await createQuest();

    // An empty dungeon would auto-return to the board; a manual move must not.
    const moved = await moveQuest(quest.id, "dungeon");
    expect(moved.statusCode).toBe(200);
    expect(moved.json<Quest>().stage).toBe("dungeon");
    // Only the manual move is logged: no `auto` follow-up to the board.
    expect(eventPayloads(quest.id, "quest_moved")).toEqual([
      { from: "board", to: "dungeon" },
    ]);
  });

  it("rejects party actions on closed quests and unknown quests", async () => {
    const archived = await createQuest("보관될 의뢰");
    await test.app.inject({
      method: "POST",
      url: `/api/quests/${archived.id}/archive`,
      headers: { cookie: ownerCookie },
      payload: {},
    });
    expect((await joinQuest(archived.id, bobCookie)).statusCode).toBe(409);
    expect((await nominate(archived.id, [bob.id], aliceCookie)).statusCode).toBe(
      409,
    );

    const rumor = await createQuest("소문만 도는 의뢰");
    await moveQuest(rumor.id, "rumor");
    expect((await nominate(rumor.id, [bob.id], aliceCookie)).statusCode).toBe(
      409,
    );

    const cleared = await createQuest("이미 클리어한 의뢰");
    await moveQuest(cleared.id, "cleared");
    expect((await joinQuest(cleared.id, bobCookie)).statusCode).toBe(409);
    expect(
      (await setStatus(cleared.id, "done", bobCookie)).statusCode,
    ).toBe(409);

    expect((await joinQuest(999_999, bobCookie)).statusCode).toBe(404);
    expect((await acceptNomination(999_999, bobCookie)).statusCode).toBe(404);
    expect((await cancelNomination(999_999, bobCookie)).statusCode).toBe(404);
    expect((await myNominations(outsiderCookie)).json()).toEqual([]);
  });
});

describe("quest read model", () => {
  it("lists party, checklist progress and pending nominations in one response", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    await joinQuest(quest.id, bobCookie);
    test.db
      .update(quests)
      .set({ direction: "- [ ] 3층\n- [x] 1층\n- [ ] 2층" })
      .where(eq(quests.id, quest.id))
      .run();

    await nominate(quest.id, [owner.id], aliceCookie);

    // A second, untouched quest proves the batch defaults.
    const empty = await createQuest("빈 의뢰");

    const response = await listQuests();
    expect(response.statusCode).toBe(200);
    const summaries = response.json() as QuestSummary[];
    expect(summaries).toHaveLength(2);

    const summary = summaries.find((entry) => entry.id === quest.id);
    expect(summary).toBeDefined();
    expect(summary?.party).toEqual([
      {
        userId: alice.id,
        displayName: "앨리스",
        role: "leader",
        status: "joined",
      },
      {
        userId: bob.id,
        displayName: "밥",
        role: "member",
        status: "joined",
      },
    ]);
    expect(summary?.floors).toEqual({ done: 1, total: 3 });
    expect(summary?.pendingNominations).toBe(1);
    expect(summary?.bounty).toMatchObject({
      base: 40,
      multiplier: 1,
      total: 40,
      days: 0,
      dusty: false,
    });

    const emptySummary = summaries.find((entry) => entry.id === empty.id);
    expect(emptySummary?.party).toEqual([]);
    expect(emptySummary?.floors).toEqual({ done: 0, total: 0 });
    expect(emptySummary?.pendingNominations).toBe(0);
  });

  it("returns retreated members, pending nominations and checklist progress in detail", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);
    await joinQuest(quest.id, bobCookie);
    await leaveQuest(quest.id, { reason: "후퇴" }, bobCookie);
    test.db
      .update(quests)
      .set({ direction: "- [ ] 1층\n- [x] 2층" })
      .where(eq(quests.id, quest.id))
      .run();

    await nominate(quest.id, [owner.id], aliceCookie);

    const response = await getQuest(quest.id);
    expect(response.statusCode).toBe(200);
    const detail = response.json() as Quest;

    expect(detail.firstClaimedAt).toEqual(expect.any(Number));
    expect(detail.bounty.base).toBe(40);
    expect(detail.party.map((member) => [member.user.id, member.status])).toEqual(
      [
        [alice.id, "joined"],
        [bob.id, "retreated"],
      ],
    );

    expect(detail.nominations).toHaveLength(1);
    expect(detail.nominations[0]).toMatchObject({
      questId: quest.id,
      nominee: { id: owner.id, displayName: "의뢰인" },
      nominatedBy: { id: alice.id, displayName: "앨리스" },
      kind: "nominate",
      state: "pending",
      passReason: null,
    });

    // The detail reports the checklist counts parsed from `direction`; the
    // deprecated floor rows are gone.
    expect(detail.floors).toEqual({ done: 1, total: 2 });
    expect(detail.direction).toBe("- [ ] 1층\n- [x] 2층");
    expect(detail.kind).toBe("fix");
    expect(detail.refs).toEqual([]);
  });
});

describe("awardXp", () => {
  it("pays once, levels up and reports the crossing", async () => {
    const user = createUser(test.db, {
      loginId: "party.xp",
      displayName: "경험치",
      xp: 90,
    });
    const input = {
      userId: user.id,
      projectId: project.id,
      questId: null,
      reason: "clear" as const,
      amount: 20,
      idemKey: "clear:test:1",
      now: Date.now(),
    };

    expect(awardXp(test.db, input)).toEqual({
      awarded: true,
      xp: 110,
      level: 2,
      levelUp: { userId: user.id, from: 1, to: 2 },
    });
    expect(storedUser(user.id).xp).toBe(110);

    // Same idempotency key: nothing is paid and no ledger row is added.
    expect(awardXp(test.db, input)).toEqual({
      awarded: false,
      xp: 110,
      level: 2,
    });
    expect(storedUser(user.id).xp).toBe(110);
    expect(
      test.db
        .select()
        .from(xpLedger)
        .where(eq(xpLedger.userId, user.id))
        .all(),
    ).toHaveLength(1);
  });
});

describe("realtime signals", () => {
  it("emits quest:changed, notification:new and xp:changed after commit", async () => {
    const quest = await createQuest();
    const recorded = recordRealtime();

    const nominated = await nominate(quest.id, [bob.id], aliceCookie);
    expect(nominated.statusCode).toBe(200);
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(recorded.notifications).toHaveLength(1);
    expect(recorded.notifications[0]).toMatchObject({
      userId: bob.id,
      notification: {
        type: "nominated",
        questNumber: quest.number,
        questTitle: quest.title,
        actor: { id: alice.id, displayName: "앨리스" },
      },
    });
    expect(recorded.xp).toEqual([]);

    const nominationId = (nominated.json() as { nominations: Nomination[] })
      .nominations[0]?.id as number;

    const relayRecord = recordRealtime();
    const relayed = await passNomination(
      nominationId,
      { relayToUserId: owner.id },
      bobCookie,
    );
    expect(relayed.statusCode).toBe(200);
    expect(relayRecord.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(relayRecord.notifications.map((entry) => entry.userId)).toEqual([
      owner.id,
    ]);
    expect(relayRecord.notifications[0]?.notification.type).toBe("relayed");
    expect(relayRecord.xp).toEqual([]);

    const joinRecord = recordRealtime();
    const joined = await joinQuest(quest.id, ownerCookie);
    expect(joined.statusCode).toBe(200);
    expect(joinRecord.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(joinRecord.xp).toEqual([
      {
        userId: bob.id,
        projectId: project.id,
        xp: 10,
        level: 1,
      },
    ]);
    expect(joinRecord.notifications).toEqual([]);

    // A rejected action never reaches the broadcaster.
    const rejectedRecord = recordRealtime();
    const rejected = await joinQuest(quest.id, outsiderCookie);
    expect(rejected.statusCode).toBe(403);
    expect(rejectedRecord).toEqual({ quests: [], notifications: [], xp: [] });
  });

  it("emits a notification when the boss is engaged", async () => {
    const quest = await createQuest();
    await joinQuest(quest.id, aliceCookie);

    const recorded = recordRealtime();
    expect((await setStatus(quest.id, "done", aliceCookie)).statusCode).toBe(
      200,
    );

    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(recorded.notifications).toHaveLength(1);
    expect(recorded.notifications[0]).toMatchObject({
      userId: owner.id,
      notification: {
        type: "boss_engaged",
        questNumber: quest.number,
        questTitle: quest.title,
        actor: { id: alice.id },
      },
    });
    expect(recorded.xp).toEqual([]);
  });

  it("does not emit anything when a nomination is cancelled", async () => {
    const quest = await createQuest();
    const nominated = await nominate(quest.id, [bob.id], aliceCookie);
    const nominationId = (nominated.json() as { nominations: Nomination[] })
      .nominations[0]?.id as number;

    const recorded = recordRealtime();
    expect((await cancelNomination(nominationId, bobCookie)).statusCode).toBe(
      204,
    );
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(recorded.notifications).toEqual([]);
    expect(recorded.xp).toEqual([]);
  });
});
