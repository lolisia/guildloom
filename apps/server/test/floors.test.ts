/**
 * Floor (층) API tests.
 *
 * They cover the dungeon checklist surface: batch add (trimming, blank-line
 * handling, fractional append), title edits, done/uncheck events, reordering,
 * deletion, guild membership guards and the `quest:changed` broadcast.
 *
 * Floors are display-only, so every test also relies on the quest stage never
 * moving because of a floor action.
 */
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Floor, Quest, QuestSummary } from "@guildloom/shared";

import {
  questEvents,
  questFloors,
  type ProjectRow,
  type UserRow,
} from "../src/db/schema.js";
import type { Realtime } from "../src/lib/realtime.js";
import {
  createProject,
  createSessionCookie,
  createTestApp,
  createUser,
  type TestApp,
} from "./helpers.js";

let test: TestApp;
let owner: UserRow;
let outsider: UserRow;
let project: ProjectRow;
let ownerCookie: string;
let outsiderCookie: string;

beforeEach(async () => {
  test = await createTestApp();
  owner = createUser(test.db, {
    loginId: "floor.owner",
    displayName: "층주인",
  });
  outsider = createUser(test.db, {
    loginId: "floor.outsider",
    displayName: "외부인",
  });
  project = createProject(test.db, { ownerId: owner.id, name: "층 길드" });

  ownerCookie = createSessionCookie(test.db, owner.id);
  outsiderCookie = createSessionCookie(test.db, outsider.id);
});

afterEach(async () => {
  await test.close();
});

/** POST a quest and return its detail. */
async function createQuest(title = "층 의뢰"): Promise<Quest> {
  const response = await test.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/quests`,
    headers: { cookie: ownerCookie },
    payload: { title },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Quest;
}

/** POST a floor batch. */
async function addFloors(
  questId: number,
  titles: string[],
  cookie: string = ownerCookie,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/floors`,
    headers: { cookie },
    payload: { titles },
  });
}

/** PATCH one floor. */
async function patchFloor(
  floorId: number,
  payload: Record<string, unknown>,
  cookie: string = ownerCookie,
) {
  return test.app.inject({
    method: "PATCH",
    url: `/api/floors/${floorId}`,
    headers: { cookie },
    payload,
  });
}

/** POST a floor move. */
async function moveFloor(
  floorId: number,
  payload: Record<string, unknown>,
  cookie: string = ownerCookie,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/floors/${floorId}/move`,
    headers: { cookie },
    payload,
  });
}

/** DELETE one floor. */
async function deleteFloor(floorId: number, cookie: string = ownerCookie) {
  return test.app.inject({
    method: "DELETE",
    url: `/api/floors/${floorId}`,
    headers: { cookie },
  });
}

/** GET a quest's detail. */
async function getQuest(questId: number, cookie: string = ownerCookie) {
  return test.app.inject({
    method: "GET",
    url: `/api/quests/${questId}`,
    headers: { cookie },
  });
}

/** GET the guild's board cards. */
async function listQuests(cookie: string = ownerCookie) {
  return test.app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/quests`,
    headers: { cookie },
  });
}

/** Quest event rows in log order. */
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

/** Stored floor rows in dungeon order. */
function floorRows(questId: number) {
  return test.db
    .select()
    .from(questFloors)
    .where(eq(questFloors.questId, questId))
    .orderBy(asc(questFloors.orderKey), asc(questFloors.id))
    .all();
}

/** Replace the app's broadcaster with one that records quest signals. */
interface RecordedRealtime {
  quests: Array<{ projectId: number; questId: number }>;
}

function recordRealtime(): RecordedRealtime {
  const recorded: RecordedRealtime = { quests: [] };
  const realtime: Realtime = {
    emitQuestChanged(projectId, questId) {
      recorded.quests.push({ projectId, questId });
    },
    emitNotification() {},
    emitXpChanged() {},
    emitMembersChanged() {},
  };
  test.app.realtime = realtime;
  return recorded;
}

describe("POST /api/quests/:id/floors", () => {
  it("appends trimmed floors with fractional keys and one floor_added event each", async () => {
    const quest = await createQuest();
    const recorded = recordRealtime();

    const firstResponse = await addFloors(quest.id, ["  1층  "]);
    expect(firstResponse.statusCode).toBe(200);
    const first = firstResponse.json() as Floor[];
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      title: "1층",
      doneAt: null,
      doneBy: null,
    });
    expect(typeof first[0]?.orderKey).toBe("string");
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);

    const secondResponse = await addFloors(quest.id, ["2층", " ", "  3층 "]);
    expect(secondResponse.statusCode).toBe(200);
    const floors = secondResponse.json() as Floor[];
    expect(floors.map((floor) => floor.title)).toEqual(["1층", "2층", "3층"]);

    const keys = floors.map((floor) => floor.orderKey);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(3);
    expect(recorded.quests).toHaveLength(2);

    const stored = floorRows(quest.id);
    expect(stored.map((row) => row.title)).toEqual(["1층", "2층", "3층"]);
    expect(stored.every((row) => row.createdBy === owner.id)).toBe(true);
    expect(stored.every((row) => row.doneAt === null)).toBe(true);
    expect(stored.every((row) => row.doneBy === null)).toBe(true);

    expect(eventTypes(quest.id)).toEqual([
      "quest_posted",
      "floor_added",
      "floor_added",
      "floor_added",
    ]);
    expect(eventPayloads(quest.id, "floor_added")).toEqual([
      { floorId: floors[0]?.id, title: "1층" },
      { floorId: floors[1]?.id, title: "2층" },
      { floorId: floors[2]?.id, title: "3층" },
    ]);

    const detail = (await getQuest(quest.id)).json() as Quest;
    expect(detail.floors).toEqual(floors);
    expect(detail.stage).toBe("board");

    const board = (await listQuests()).json() as QuestSummary[];
    expect(board[0]?.floors).toEqual({ done: 0, total: 3 });
  });

  it("rejects an all-blank batch without creating floors or events", async () => {
    const quest = await createQuest();

    const response = await addFloors(quest.id, ["", "   ", "\t"]);

    expect(response.statusCode).toBe(400);
    expect(
      (response.json() as { error: { code: string } }).error.code,
    ).toBe("VALIDATION_ERROR");
    expect(eventTypes(quest.id)).toEqual(["quest_posted"]);
    expect(floorRows(quest.id)).toEqual([]);
  });

  it("rejects an empty batch and more than 50 titles", async () => {
    const quest = await createQuest();

    expect((await addFloors(quest.id, [])).statusCode).toBe(400);
    expect(
      (
        await addFloors(
          quest.id,
          Array.from({ length: 51 }, (_, index) => `${index + 1}층`),
        )
      ).statusCode,
    ).toBe(400);

    expect(eventTypes(quest.id)).toEqual(["quest_posted"]);
    expect(floorRows(quest.id)).toEqual([]);
  });

  it("requires an existing quest and guild membership", async () => {
    const quest = await createQuest();

    expect((await addFloors(quest.id, ["1층"], outsiderCookie)).statusCode).toBe(
      403,
    );
    expect((await addFloors(999_999, ["1층"])).statusCode).toBe(404);

    const anonymous = await test.app.inject({
      method: "POST",
      url: `/api/quests/${quest.id}/floors`,
      payload: { titles: ["1층"] },
    });
    expect(anonymous.statusCode).toBe(401);

    expect(eventTypes(quest.id)).toEqual(["quest_posted"]);
    expect(floorRows(quest.id)).toEqual([]);
  });
});

describe("PATCH /api/floors/:id", () => {
  it("edits the title without recording an event", async () => {
    const quest = await createQuest();
    const floor = (
      (await addFloors(quest.id, ["1층"])).json() as Floor[]
    )[0] as Floor;
    const recorded = recordRealtime();

    const response = await patchFloor(floor.id, { title: "  1층 수정  " });

    expect(response.statusCode).toBe(200);
    const updated = response.json() as Floor;
    expect(updated.title).toBe("1층 수정");
    expect(updated.doneAt).toBeNull();
    expect(updated.doneBy).toBeNull();
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(eventTypes(quest.id)).toEqual(["quest_posted", "floor_added"]);

    const stored = floorRows(quest.id)[0];
    expect(stored?.title).toBe("1층 수정");
  });

  it("checks and unchecks with floor_checked events only when done changes", async () => {
    const quest = await createQuest();
    const floor = (
      (await addFloors(quest.id, ["1층"])).json() as Floor[]
    )[0] as Floor;

    const checkedAt = Date.now();
    const recorded = recordRealtime();
    const checkedResponse = await patchFloor(floor.id, { done: true });

    expect(checkedResponse.statusCode).toBe(200);
    const checked = checkedResponse.json() as Floor;
    expect(checked.doneAt).toBeGreaterThanOrEqual(checkedAt);
    expect(checked.doneBy).toEqual({
      id: owner.id,
      displayName: owner.displayName,
    });
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(eventPayloads(quest.id, "floor_checked")).toEqual([
      { floorId: floor.id, title: "1층", done: true },
    ]);

    let board = (await listQuests()).json() as QuestSummary[];
    expect(board[0]?.floors).toEqual({ done: 1, total: 1 });

    // Repeating the same value changes nothing in the log.
    const sameRecord = recordRealtime();
    const sameResponse = await patchFloor(floor.id, { done: true });
    expect(sameResponse.statusCode).toBe(200);
    expect((sameResponse.json() as Floor).doneAt).toBe(checked.doneAt);
    expect(sameRecord.quests).toHaveLength(1);
    expect(eventPayloads(quest.id, "floor_checked")).toHaveLength(1);

    // A title edit keeps the completion data and records no event.
    const renameRecord = recordRealtime();
    const renameResponse = await patchFloor(floor.id, {
      title: "1층 - 수정",
    });
    expect(renameResponse.statusCode).toBe(200);
    const renamed = renameResponse.json() as Floor;
    expect(renamed.title).toBe("1층 - 수정");
    expect(renamed.doneAt).toBe(checked.doneAt);
    expect(renamed.doneBy).toEqual(checked.doneBy);
    expect(renameRecord.quests).toHaveLength(1);
    expect(eventPayloads(quest.id, "floor_checked")).toHaveLength(1);

    // Unchecking clears done_at/done_by and records the reopening.
    const uncheckRecord = recordRealtime();
    const uncheckedResponse = await patchFloor(floor.id, { done: false });
    expect(uncheckedResponse.statusCode).toBe(200);
    const unchecked = uncheckedResponse.json() as Floor;
    expect(unchecked.doneAt).toBeNull();
    expect(unchecked.doneBy).toBeNull();
    expect(uncheckRecord.quests).toHaveLength(1);
    expect(eventPayloads(quest.id, "floor_checked")).toEqual([
      { floorId: floor.id, title: "1층", done: true },
      { floorId: floor.id, title: "1층 - 수정", done: false },
    ]);

    board = (await listQuests()).json() as QuestSummary[];
    expect(board[0]?.floors).toEqual({ done: 0, total: 1 });

    // An empty patch is a no-op for the event log.
    const noopRecord = recordRealtime();
    const noopResponse = await patchFloor(floor.id, {});
    expect(noopResponse.statusCode).toBe(200);
    expect(noopRecord.quests).toHaveLength(1);
    expect(eventPayloads(quest.id, "floor_checked")).toHaveLength(2);

    // Floors never move the quest stage.
    const detail = (await getQuest(quest.id)).json() as Quest;
    expect(detail.stage).toBe("board");
    expect(detail.floors[0]).toMatchObject({
      id: floor.id,
      title: "1층 - 수정",
      doneAt: null,
      doneBy: null,
    });
  });

  it("requires membership and returns 404 for unknown floors", async () => {
    const quest = await createQuest();
    const floor = (
      (await addFloors(quest.id, ["1층"])).json() as Floor[]
    )[0] as Floor;

    expect(
      (await patchFloor(floor.id, { title: "외부 수정" }, outsiderCookie))
        .statusCode,
    ).toBe(403);
    expect((await patchFloor(999_999, { title: "없음" })).statusCode).toBe(404);

    const anonymous = await test.app.inject({
      method: "PATCH",
      url: `/api/floors/${floor.id}`,
      payload: { title: "익명" },
    });
    expect(anonymous.statusCode).toBe(401);

    expect(floorRows(quest.id)[0]?.title).toBe("1층");
  });
});

describe("POST /api/floors/:id/move", () => {
  it("reorders between neighbors with fractional keys and records no event", async () => {
    const quest = await createQuest();
    const [first, second, third] = (
      await addFloors(quest.id, ["1층", "2층", "3층"])
    ).json() as Floor[];
    const before = eventTypes(quest.id);
    const recorded = recordRealtime();

    const movedResponse = await moveFloor(third?.id as number, {
      beforeId: first?.id,
      afterId: second?.id,
    });
    expect(movedResponse.statusCode).toBe(200);
    const moved = movedResponse.json() as Floor;
    expect(moved.id).toBe(third?.id);
    expect(moved.orderKey > (first?.orderKey ?? "")).toBe(true);
    expect(moved.orderKey < (second?.orderKey ?? "")).toBe(true);
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(eventTypes(quest.id)).toEqual(before);

    let detail = (await getQuest(quest.id)).json() as Quest;
    expect(detail.floors.map((floor) => floor.id)).toEqual([
      first?.id,
      third?.id,
      second?.id,
    ]);

    // Reorder again: the first floor moves between the third and second.
    const secondMove = await moveFloor(first?.id as number, {
      beforeId: third?.id,
      afterId: second?.id,
    });
    expect(secondMove.statusCode).toBe(200);
    detail = (await getQuest(quest.id)).json() as Quest;
    expect(detail.floors.map((floor) => floor.id)).toEqual([
      third?.id,
      first?.id,
      second?.id,
    ]);

    // Omitting both neighbors appends the floor to the bottom.
    const bottomMove = await moveFloor(third?.id as number, {});
    expect(bottomMove.statusCode).toBe(200);
    detail = (await getQuest(quest.id)).json() as Quest;
    expect(detail.floors.map((floor) => floor.id)).toEqual([
      first?.id,
      second?.id,
      third?.id,
    ]);
    expect((detail.floors[2]?.orderKey ?? "") > (detail.floors[1]?.orderKey ?? "")).toBe(
      true,
    );

    // None of the moves logged an event.
    expect(eventTypes(quest.id)).toEqual(before);
  });

  it("returns 404 for missing floors or neighbors and 403 for non-members", async () => {
    const quest = await createQuest();
    const [floor] = (
      await addFloors(quest.id, ["1층"])
    ).json() as Floor[];
    const otherQuest = await createQuest("다른 의뢰");
    const otherFloor = (
      (await addFloors(otherQuest.id, ["남의 층"])).json() as Floor[]
    )[0] as Floor;
    const recorded = recordRealtime();

    expect((await moveFloor(floor?.id as number, {})).statusCode).toBe(200);

    expect(
      (await moveFloor(floor?.id as number, { afterId: 999_999 })).statusCode,
    ).toBe(404);
    expect(
      (await moveFloor(floor?.id as number, { afterId: otherFloor.id }))
        .statusCode,
    ).toBe(404);
    expect((await moveFloor(999_999, {})).statusCode).toBe(404);
    expect(
      (await moveFloor(floor?.id as number, {}, outsiderCookie)).statusCode,
    ).toBe(403);
    expect(
      (
        await moveFloor(floor?.id as number, {
          beforeId: floor?.id,
          afterId: floor?.id,
        })
      ).statusCode,
    ).toBe(400);

    // Only the successful append broadcast a change.
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
  });
});

describe("DELETE /api/floors/:id", () => {
  it("deletes a floor and records no event", async () => {
    const quest = await createQuest();
    const [first, second] = (
      await addFloors(quest.id, ["1층", "2층"])
    ).json() as Floor[];
    const before = eventTypes(quest.id);
    const recorded = recordRealtime();

    const response = await deleteFloor(first?.id as number);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(eventTypes(quest.id)).toEqual(before);

    const detail = (await getQuest(quest.id)).json() as Quest;
    expect(detail.floors.map((floor) => floor.id)).toEqual([second?.id]);

    expect((await deleteFloor(first?.id as number)).statusCode).toBe(404);
  });

  it("requires guild membership", async () => {
    const quest = await createQuest();
    const [floor] = (
      await addFloors(quest.id, ["1층"])
    ).json() as Floor[];
    const recorded = recordRealtime();

    expect((await deleteFloor(floor?.id as number, outsiderCookie)).statusCode).toBe(
      403,
    );
    expect(recorded.quests).toEqual([]);
    expect(floorRows(quest.id)).toHaveLength(1);
  });
});
