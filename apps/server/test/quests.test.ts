/**
 * Quest route tests: creation (single and bulk), listing/filtering, detail,
 * editing, moving, archiving and membership guards.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Quest, QuestSummary } from "@guildloom/shared";

import {
  projects,
  questEvents,
  questTags,
  quests,
  tags,
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
let project: ProjectRow;
let cookie: string;

beforeEach(async () => {
  test = await createTestApp();
  owner = createUser(test.db, { loginId: "quest.owner", displayName: "김철수" });
  project = createProject(test.db, { ownerId: owner.id, name: "테스트 길드" });
  cookie = createSessionCookie(test.db, owner.id);
});

afterEach(async () => {
  await test.close();
});

/** POST a quest as `actorCookie` (defaults to the project owner). */
async function postQuest(
  payload: Record<string, unknown>,
  actorCookie: string = cookie,
  projectId: number = project.id,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/quests`,
    headers: { cookie: actorCookie },
    payload,
  });
}

/** Create a quest through the API and return the parsed response. */
async function createQuest(payload: Record<string, unknown>): Promise<Quest> {
  const response = await postQuest(payload);
  expect(response.statusCode).toBe(201);
  return response.json() as Quest;
}

/** GET the project quest list as `actorCookie`. */
async function listQuests(
  query: Record<string, string> = {},
  actorCookie: string = cookie,
  projectId: number = project.id,
) {
  return test.app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/quests`,
    headers: { cookie: actorCookie },
    query,
  });
}

/** PATCH a quest as `actorCookie`. */
async function patchQuest(
  questId: number,
  payload: Record<string, unknown>,
  actorCookie: string = cookie,
) {
  return test.app.inject({
    method: "PATCH",
    url: `/api/quests/${questId}`,
    headers: { cookie: actorCookie },
    payload,
  });
}

/** POST a move command as `actorCookie`. */
async function moveQuest(
  questId: number,
  payload: Record<string, unknown>,
  actorCookie: string = cookie,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/move`,
    headers: { cookie: actorCookie },
    payload,
  });
}

/** POST an archive command as `actorCookie`. */
async function archiveQuest(
  questId: number,
  payload?: Record<string, unknown>,
  actorCookie: string = cookie,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/archive`,
    headers: { cookie: actorCookie },
    payload: payload ?? {},
  });
}

function eventRows(questId: number) {
  return test.db
    .select()
    .from(questEvents)
    .where(eq(questEvents.questId, questId))
    .all();
}

describe("POST /api/projects/:pid/quests", () => {
  it("creates a board quest with defaults, deduped tags and an event", async () => {
    const response = await postQuest({
      title: "  로그인 버그  ",
      tags: [" 버그", "버그", "UI", "UI "],
      rank: "B",
    });

    expect(response.statusCode).toBe(201);

    const quest = response.json() as Quest;
    expect(quest).toMatchObject({
      projectId: project.id,
      number: 1,
      title: "로그인 버그",
      stage: "board",
      rank: "B",
      situation: "",
      direction: "",
      archiveReason: null,
      tags: ["UI", "버그"],
      createdBy: { id: owner.id, displayName: "김철수" },
    });
    expect(typeof quest.orderKey).toBe("string");
    expect(quest.orderKey.length).toBeGreaterThan(0);
    expect(quest.createdAt).toBe(quest.updatedAt);

    // Tags are created once per project even when supplied twice.
    const tagRows = test.db
      .select()
      .from(tags)
      .where(eq(tags.projectId, project.id))
      .all();
    expect(tagRows.map((tag) => tag.name).sort()).toEqual(["UI", "버그"]);
    expect(
      test.db
        .select()
        .from(questTags)
        .where(eq(questTags.questId, quest.id))
        .all(),
    ).toHaveLength(2);

    // next_quest_number advanced transactionally.
    const storedProject = test.db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id))
      .get();
    expect(storedProject?.nextQuestNumber).toBe(2);

    const events = eventRows(quest.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "quest_posted",
      projectId: project.id,
      actorUserId: owner.id,
      familiarId: null,
    });
    expect(JSON.parse(events[0]?.payload ?? "{}")).toEqual({
      number: 1,
      title: "로그인 버그",
    });
  });

  it("numbers quests sequentially per project", async () => {
    const otherProject = createProject(test.db, {
      ownerId: owner.id,
      name: "두 번째 길드",
    });

    const first = await createQuest({ title: "첫 번째" });
    const second = await createQuest({ title: "두 번째" });
    const response = await postQuest(
      { title: "다른 길드 첫 번째" },
      cookie,
      otherProject.id,
    );

    expect(response.statusCode).toBe(201);
    const other = response.json() as Quest;

    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
    expect(other.number).toBe(1);
    expect(other.projectId).toBe(otherProject.id);

    const storedProjects = test.db.select().from(projects).all();
    expect(
      storedProjects.find((row) => row.id === project.id)?.nextQuestNumber,
    ).toBe(3);
    expect(
      storedProjects.find((row) => row.id === otherProject.id)
        ?.nextQuestNumber,
    ).toBe(2);
  });

  it("appends order keys at the bottom of the board column", async () => {
    const first = await createQuest({ title: "첫 번째" });
    const second = await createQuest({ title: "두 번째" });
    const third = await createQuest({ title: "세 번째" });

    expect(first.orderKey < second.orderKey).toBe(true);
    expect(second.orderKey < third.orderKey).toBe(true);
  });

  it("rejects non-members and unauthenticated callers", async () => {
    const outsider = createUser(test.db, {
      loginId: "quest.outsider",
      displayName: "외부인",
    });
    const outsiderCookie = createSessionCookie(test.db, outsider.id);

    const forbidden = await postQuest({ title: "침입" }, outsiderCookie);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });

    const unauthorized = await test.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/quests`,
      payload: { title: "비로그인" },
    });
    expect(unauthorized.statusCode).toBe(401);

    expect(test.db.select().from(quests).all()).toHaveLength(0);
  });

  it("validates the title and rank", async () => {
    const emptyTitle = await postQuest({ title: "   " });
    expect(emptyTitle.statusCode).toBe(400);
    expect(emptyTitle.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    const badRank = await postQuest({ title: "등급", rank: "Z" });
    expect(badRank.statusCode).toBe(400);
  });
});

describe("POST /api/projects/:pid/quests/bulk", () => {
  it("creates all quests and events in one transaction", async () => {
    const existing = await createQuest({ title: "기존 의뢰" });

    const response = await test.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/quests/bulk`,
      headers: { cookie },
      payload: { titles: [" 첫째 ", "", "   ", "둘째", "셋째"] },
    });

    expect(response.statusCode).toBe(201);
    const created = response.json() as Quest[];
    expect(created).toHaveLength(3);
    expect(created.map((quest) => quest.title)).toEqual([
      "첫째",
      "둘째",
      "셋째",
    ]);
    expect(created.map((quest) => quest.number)).toEqual([2, 3, 4]);
    expect(created.every((quest) => quest.stage === "board")).toBe(true);
    expect(created.every((quest) => quest.tags.length === 0)).toBe(true);

    // Keys continue below the existing card, in insertion order.
    expect(existing.orderKey < (created[0]?.orderKey ?? "")).toBe(true);
    expect((created[0]?.orderKey ?? "") < (created[1]?.orderKey ?? "")).toBe(
      true,
    );
    expect((created[1]?.orderKey ?? "") < (created[2]?.orderKey ?? "")).toBe(
      true,
    );

    // One quest_posted event per created quest, plus the existing quest's.
    const events = test.db.select().from(questEvents).all();
    expect(events).toHaveLength(4);
    expect(events.filter((event) => event.type === "quest_posted")).toHaveLength(
      4,
    );

    const storedProject = test.db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id))
      .get();
    expect(storedProject?.nextQuestNumber).toBe(5);
  });

  it("rejects a bulk request with only blank titles", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/quests/bulk`,
      headers: { cookie },
      payload: { titles: ["", "   ", "\t"] },
    });

    expect(response.statusCode).toBe(400);
    expect(test.db.select().from(quests).all()).toHaveLength(0);
    expect(test.db.select().from(questEvents).all()).toHaveLength(0);

    const storedProject = test.db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id))
      .get();
    expect(storedProject?.nextQuestNumber).toBe(1);
  });

  it("rejects more than 100 titles via schema validation", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/quests/bulk`,
      headers: { cookie },
      payload: { titles: Array.from({ length: 101 }, (_, index) => `의뢰 ${index}`) },
    });

    expect(response.statusCode).toBe(400);
    expect(test.db.select().from(quests).all()).toHaveLength(0);
  });

  it("rolls back every insert when one row fails", async () => {
    test.sqlite.exec(`
      CREATE TRIGGER quests_fail_bulk
      BEFORE INSERT ON quests
      WHEN NEW.title = '폭발'
      BEGIN
        SELECT RAISE(ABORT, 'bulk failure');
      END;
    `);

    const response = await test.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/quests/bulk`,
      headers: { cookie },
      payload: { titles: ["첫째", "폭발", "셋째"] },
    });

    expect(response.statusCode).toBe(500);
    // Nothing before the failing row survives, so it really is one transaction.
    expect(test.db.select().from(quests).all()).toHaveLength(0);
    expect(test.db.select().from(questEvents).all()).toHaveLength(0);

    const storedProject = test.db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id))
      .get();
    expect(storedProject?.nextQuestNumber).toBe(1);
  });

  it("rejects non-members", async () => {
    const outsider = createUser(test.db, {
      loginId: "bulk.outsider",
      displayName: "외부인",
    });
    const outsiderCookie = createSessionCookie(test.db, outsider.id);

    const response = await test.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/quests/bulk`,
      headers: { cookie: outsiderCookie },
      payload: { titles: ["침입"] },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("GET /api/projects/:pid/quests", () => {
  it("returns ordered summaries without archived quests", async () => {
    const first = await createQuest({ title: "첫 번째", tags: ["UI"] });
    const second = await createQuest({ title: "두 번째" });
    const third = await createQuest({ title: "세 번째" });

    await archiveQuest(third.id);

    const response = await listQuests();

    expect(response.statusCode).toBe(200);
    const listed = response.json() as QuestSummary[];
    expect(listed.map((quest) => quest.id)).toEqual([first.id, second.id]);
    expect(listed[0]).toMatchObject({
      number: 1,
      title: "첫 번째",
      stage: "board",
      rank: null,
      tags: ["UI"],
      createdBy: { id: owner.id, displayName: "김철수" },
    });
    expect(listed[0]?.orderKey).toBe(first.orderKey);
    expect((listed[0]?.orderKey ?? "") < (listed[1]?.orderKey ?? "")).toBe(
      true,
    );
    // Summaries never expose the detail-only fields.
    expect(listed[0]).not.toHaveProperty("situation");
    expect(listed[0]).not.toHaveProperty("projectId");
  });

  it("filters by comma separated stages", async () => {
    const boardQuest = await createQuest({ title: "게시판" });
    const dungeonQuest = await createQuest({ title: "던전" });
    await moveQuest(dungeonQuest.id, { stage: "dungeon" });

    const all = (await listQuests()).json() as QuestSummary[];
    expect(all.map((quest) => quest.id)).toEqual([boardQuest.id, dungeonQuest.id]);

    const boardOnly = (
      await listQuests({ stage: "board" })
    ).json() as QuestSummary[];
    expect(boardOnly.map((quest) => quest.id)).toEqual([boardQuest.id]);

    const both = (
      await listQuests({ stage: "board, dungeon" })
    ).json() as QuestSummary[];
    expect(both).toHaveLength(2);

    const archivedOnly = await listQuests({ stage: "archived" });
    expect(archivedOnly.statusCode).toBe(200);
    expect(archivedOnly.json()).toEqual([]);

    const invalid = await listQuests({ stage: "board,nope" });
    expect(invalid.statusCode).toBe(400);
  });

  it("filters by a single tag name", async () => {
    const tagged = await createQuest({ title: "태그 있음", tags: ["버그", "UI"] });
    await createQuest({ title: "태그 없음" });

    const response = await listQuests({ tag: "버그" });

    expect(response.statusCode).toBe(200);
    const listed = response.json() as QuestSummary[];
    expect(listed.map((quest) => quest.id)).toEqual([tagged.id]);

    const noMatch = await listQuests({ tag: "없는태그" });
    expect(noMatch.json()).toEqual([]);
  });

  it("searches title, situation and direction with LIKE", async () => {
    const titleMatch = await createQuest({ title: "로그인 버그" });
    const situationMatch = await createQuest({
      title: "회원가입 폼",
      situation: "로그인 후 흰 화면",
    });
    const directionMatch = await createQuest({
      title: "결제",
      direction: "로그인 세션을 갱신한다",
    });
    await createQuest({ title: "무관한 의뢰" });
    const percent = await createQuest({ title: "진행률 100% 달성" });

    const response = await listQuests({ q: "로그인" });
    const listed = (response.json() as QuestSummary[]).map((quest) => quest.id);
    expect(listed.sort()).toEqual(
      [titleMatch.id, situationMatch.id, directionMatch.id].sort(),
    );

    // LIKE wildcards in the user input are matched literally.
    const literalPercent = await listQuests({ q: "100%" });
    expect((literalPercent.json() as QuestSummary[]).map((quest) => quest.id)).toEqual([
      percent.id,
    ]);

    const wildcard = await listQuests({ q: "%" });
    expect(
      (wildcard.json() as QuestSummary[]).map((quest) => quest.id),
    ).toEqual([percent.id]);
  });

  it("rejects non-members and unknown projects", async () => {
    const outsider = createUser(test.db, {
      loginId: "list.outsider",
      displayName: "외부인",
    });
    const outsiderCookie = createSessionCookie(test.db, outsider.id);

    expect((await listQuests({}, outsiderCookie)).statusCode).toBe(403);

    const missing = await listQuests({}, cookie, 9999);
    expect(missing.statusCode).toBe(404);
  });
});

describe("GET /api/quests/:id", () => {
  it("returns the full quest detail", async () => {
    const created = await createQuest({
      title: "상세 조회",
      situation: "현재 상황",
      direction: "수정 방향",
      tags: ["버그"],
    });

    const response = await test.app.inject({
      method: "GET",
      url: `/api/quests/${created.id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(created);
  });

  it("returns 404 for an unknown quest and 403 for non-members", async () => {
    const created = await createQuest({ title: "비공개" });

    const missing = await test.app.inject({
      method: "GET",
      url: "/api/quests/9999",
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);

    const outsider = createUser(test.db, {
      loginId: "detail.outsider",
      displayName: "외부인",
    });
    const outsiderCookie = createSessionCookie(test.db, outsider.id);
    const forbidden = await test.app.inject({
      method: "GET",
      url: `/api/quests/${created.id}`,
      headers: { cookie: outsiderCookie },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("PATCH /api/quests/:id", () => {
  it("updates fields and records the changed fields in canonical order", async () => {
    const created = await createQuest({ title: "원래 제목" });

    const response = await patchQuest(created.id, {
      rank: "A",
      direction: "방향",
      title: "  바뀐 제목  ",
      situation: "상황",
    });

    expect(response.statusCode).toBe(200);
    const updated = response.json() as Quest;
    expect(updated).toMatchObject({
      title: "바뀐 제목",
      situation: "상황",
      direction: "방향",
      rank: "A",
    });
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);

    const events = eventRows(created.id);
    expect(events).toHaveLength(2);
    const edited = events.find((event) => event.type === "quest_edited");
    expect(JSON.parse(edited?.payload ?? "{}")).toEqual({
      fields: ["title", "situation", "direction", "rank"],
    });
  });

  it("replaces tags and records tags only when changed", async () => {
    const created = await createQuest({ title: "태그", tags: ["버그"] });

    const response = await patchQuest(created.id, {
      tags: ["UI", "새태그", "UI"],
    });

    expect(response.statusCode).toBe(200);
    const updated = response.json() as Quest;
    expect(updated.tags).toEqual(["UI", "새태그"]);

    const storedTags = test.db
      .select()
      .from(tags)
      .where(eq(tags.projectId, project.id))
      .all()
      .map((tag) => tag.name)
      .sort();
    expect(storedTags).toEqual(["UI", "버그", "새태그"]);

    // Re-supplying the same set in a different order is not a change.
    const sameAgain = await patchQuest(created.id, {
      tags: ["새태그", "UI"],
    });
    expect(sameAgain.statusCode).toBe(200);
    expect(
      eventRows(created.id).filter((event) => event.type === "quest_edited"),
    ).toHaveLength(1);
  });

  it("clears the rank with null", async () => {
    const created = await createQuest({ title: "등급", rank: "S" });

    const response = await patchQuest(created.id, { rank: null });

    expect(response.statusCode).toBe(200);
    expect((response.json() as Quest).rank).toBeNull();
    const edited = eventRows(created.id).find(
      (event) => event.type === "quest_edited",
    );
    expect(JSON.parse(edited?.payload ?? "{}")).toEqual({ fields: ["rank"] });
  });

  it("does not record an event when nothing actually changes", async () => {
    const created = await createQuest({
      title: "그대로",
      situation: "같은 상황",
      tags: ["버그"],
      rank: "C",
    });

    const empty = await patchQuest(created.id, {});
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as Quest).updatedAt).toBe(created.updatedAt);

    const same = await patchQuest(created.id, {
      title: "그대로",
      situation: "같은 상황",
      direction: "",
      tags: ["버그"],
      rank: "C",
    });
    expect(same.statusCode).toBe(200);
    expect((same.json() as Quest).updatedAt).toBe(created.updatedAt);

    expect(eventRows(created.id)).toHaveLength(1);
    expect(eventRows(created.id)[0]?.type).toBe("quest_posted");
  });

  it("rejects non-members", async () => {
    const created = await createQuest({ title: "권한" });
    const outsider = createUser(test.db, {
      loginId: "patch.outsider",
      displayName: "외부인",
    });
    const outsiderCookie = createSessionCookie(test.db, outsider.id);

    const response = await patchQuest(
      created.id,
      { title: "변경 시도" },
      outsiderCookie,
    );
    expect(response.statusCode).toBe(403);
  });
});

describe("POST /api/quests/:id/move", () => {
  it("places the moved quest strictly between the requested neighbors", async () => {
    const first = await createQuest({ title: "첫 번째" });
    const second = await createQuest({ title: "두 번째" });
    const third = await createQuest({ title: "세 번째" });

    const response = await moveQuest(third.id, {
      stage: "board",
      beforeId: first.id,
      afterId: second.id,
    });

    expect(response.statusCode).toBe(200);
    const moved = response.json() as Quest;
    expect(moved.stage).toBe("board");
    expect(moved.orderKey > first.orderKey).toBe(true);
    expect(moved.orderKey < second.orderKey).toBe(true);

    // Same-column reorder writes no quest_moved event.
    expect(
      eventRows(third.id).filter((event) => event.type === "quest_moved"),
    ).toHaveLength(0);
  });

  it("records quest_moved with from/to only when the stage changes", async () => {
    const neighbor = await createQuest({ title: "던전 이웃" });
    await moveQuest(neighbor.id, { stage: "dungeon" });
    const moved = await createQuest({ title: "옮길 의뢰" });

    const response = await moveQuest(moved.id, {
      stage: "dungeon",
      afterId: neighbor.id,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Quest;
    expect(body.stage).toBe("dungeon");
    expect(body.orderKey < neighbor.orderKey).toBe(true);

    const events = eventRows(moved.id);
    const moveEvents = events.filter((event) => event.type === "quest_moved");
    expect(moveEvents).toHaveLength(1);
    expect(JSON.parse(moveEvents[0]?.payload ?? "{}")).toEqual({
      from: "board",
      to: "dungeon",
    });

    // Moving inside the target stage again stays event-free.
    const second = await createQuest({ title: "던전 이웃" });
    await moveQuest(second.id, { stage: "dungeon" });
    await moveQuest(moved.id, { stage: "dungeon", beforeId: second.id });
    expect(
      eventRows(moved.id).filter((event) => event.type === "quest_moved"),
    ).toHaveLength(1);
  });

  it("appends at the bottom when no neighbors are given", async () => {
    const first = await createQuest({ title: "던전 1" });
    const second = await createQuest({ title: "던전 2" });
    await moveQuest(first.id, { stage: "dungeon" });
    await moveQuest(second.id, { stage: "dungeon" });

    const bottom = await createQuest({ title: "맨 아래" });
    const response = await moveQuest(bottom.id, { stage: "dungeon" });

    expect(response.statusCode).toBe(200);
    const moved = response.json() as Quest;
    const dungeonKeys = test.db
      .select()
      .from(quests)
      .where(eq(quests.stage, "dungeon"))
      .all()
      .map((quest) => quest.orderKey)
      .sort();
    expect(dungeonKeys.at(-1)).toBe(moved.orderKey);
  });

  it("rejects neighbors from another stage or project", async () => {
    const boardQuest = await createQuest({ title: "게시판" });
    const dungeonQuest = await createQuest({ title: "던전" });
    await moveQuest(dungeonQuest.id, { stage: "dungeon" });

    const otherProject = createProject(test.db, {
      ownerId: owner.id,
      name: "다른 길드",
    });
    const otherResponse = await postQuest(
      { title: "다른 길드 의뢰" },
      cookie,
      otherProject.id,
    );
    const otherQuest = otherResponse.json() as Quest;

    const wrongStage = await moveQuest(boardQuest.id, {
      stage: "boss",
      beforeId: dungeonQuest.id,
    });
    expect(wrongStage.statusCode).toBe(400);

    const wrongProject = await moveQuest(boardQuest.id, {
      stage: "board",
      beforeId: otherQuest.id,
    });
    expect(wrongProject.statusCode).toBe(400);

    const unknown = await moveQuest(boardQuest.id, {
      stage: "board",
      afterId: 999_999,
    });
    expect(unknown.statusCode).toBe(400);

    // The failed moves never wrote events.
    expect(eventRows(boardQuest.id)).toHaveLength(1);
  });

  it("rejects non-members", async () => {
    const created = await createQuest({ title: "권한" });
    const outsider = createUser(test.db, {
      loginId: "move.outsider",
      displayName: "외부인",
    });
    const outsiderCookie = createSessionCookie(test.db, outsider.id);

    const response = await moveQuest(
      created.id,
      { stage: "dungeon" },
      outsiderCookie,
    );
    expect(response.statusCode).toBe(403);
  });
});

describe("POST /api/quests/:id/archive", () => {
  it("archives with a reason and records quest_archived", async () => {
    const created = await createQuest({ title: "내릴 의뢰" });

    const response = await archiveQuest(created.id, { reason: "dropped" });

    expect(response.statusCode).toBe(200);
    const archived = response.json() as Quest;
    expect(archived.stage).toBe("archived");
    expect(archived.archiveReason).toBe("dropped");
    expect(archived.updatedAt).toBeGreaterThan(created.updatedAt);

    const archiveEvents = eventRows(created.id).filter(
      (event) => event.type === "quest_archived",
    );
    expect(archiveEvents).toHaveLength(1);
    expect(JSON.parse(archiveEvents[0]?.payload ?? "{}")).toEqual({
      reason: "dropped",
    });
  });

  it("archives without a reason", async () => {
    const created = await createQuest({ title: "이유 없음" });

    const response = await archiveQuest(created.id);

    expect(response.statusCode).toBe(200);
    expect((response.json() as Quest).archiveReason).toBeNull();
    const archiveEvents = eventRows(created.id).filter(
      (event) => event.type === "quest_archived",
    );
    expect(JSON.parse(archiveEvents[0]?.payload ?? "{}")).toEqual({});
  });

  it("records quest_archived only once", async () => {
    const created = await createQuest({ title: "두 번 내리기" });

    await archiveQuest(created.id);
    const again = await archiveQuest(created.id);

    expect(again.statusCode).toBe(200);
    expect((again.json() as Quest).stage).toBe("archived");
    expect(
      eventRows(created.id).filter(
        (event) => event.type === "quest_archived",
      ),
    ).toHaveLength(1);
  });

  it("rejects non-members", async () => {
    const created = await createQuest({ title: "권한" });
    const outsider = createUser(test.db, {
      loginId: "archive.outsider",
      displayName: "외부인",
    });
    const outsiderCookie = createSessionCookie(test.db, outsider.id);

    const response = await archiveQuest(created.id, {}, outsiderCookie);
    expect(response.statusCode).toBe(403);
  });
});

describe("quest membership", () => {
  it("lets any project member act on quests", async () => {
    const member = createUser(test.db, {
      loginId: "quest.member",
      displayName: "이영희",
    });
    addMember(test.db, project.id, member.id);
    const memberCookie = createSessionCookie(test.db, member.id);

    const response = await postQuest({ title: "멤버 등록" }, memberCookie);
    expect(response.statusCode).toBe(201);

    const created = response.json() as Quest;
    expect(created.createdBy).toEqual({
      id: member.id,
      displayName: "이영희",
    });

    const patched = await patchQuest(
      created.id,
      { title: "멤버 수정" },
      memberCookie,
    );
    expect(patched.statusCode).toBe(200);
  });
});
