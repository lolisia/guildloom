/**
 * Quest event log tests: ordering, payload parsing, actor display names,
 * familiar ids and the membership guard.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Quest, QuestEvent } from "@guildloom/shared";

import {
  questEvents,
  users,
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
  owner = createUser(test.db, {
    loginId: "event.owner",
    displayName: "김철수",
  });
  project = createProject(test.db, { ownerId: owner.id, name: "기록 길드" });
  cookie = createSessionCookie(test.db, owner.id);
});

afterEach(async () => {
  await test.close();
});

/** Create a quest through the API. */
async function createQuest(payload: Record<string, unknown>): Promise<Quest> {
  const response = await test.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/quests`,
    headers: { cookie },
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Quest;
}

/** GET the event timeline of a quest. */
async function getEvents(questId: number, actorCookie: string = cookie) {
  return test.app.inject({
    method: "GET",
    url: `/api/quests/${questId}/events`,
    headers: { cookie: actorCookie },
  });
}

describe("GET /api/quests/:id/events", () => {
  it("returns the full lifecycle in ascending order with parsed payloads", async () => {
    const created = await createQuest({ title: "원래 제목" });

    await test.app.inject({
      method: "PATCH",
      url: `/api/quests/${created.id}`,
      headers: { cookie },
      payload: { title: "수정된 제목", situation: "상황" },
    });
    await test.app.inject({
      method: "POST",
      url: `/api/quests/${created.id}/move`,
      headers: { cookie },
      payload: { stage: "dungeon" },
    });
    await test.app.inject({
      method: "POST",
      url: `/api/quests/${created.id}/archive`,
      headers: { cookie },
      payload: { reason: "dropped" },
    });

    const response = await getEvents(created.id);

    expect(response.statusCode).toBe(200);
    const events = response.json() as QuestEvent[];
    expect(events.map((event) => event.type)).toEqual([
      "quest_posted",
      "quest_edited",
      "quest_moved",
      "quest_archived",
    ]);

    // Ascending by created_at and then id.
    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1];
      const current = events[index];
      const ordered =
        (previous?.createdAt ?? 0) < (current?.createdAt ?? 0) ||
        ((previous?.createdAt ?? 0) === (current?.createdAt ?? 0) &&
          (previous?.id ?? 0) < (current?.id ?? 0));
      expect(ordered).toBe(true);
    }

    expect(events[0]).toMatchObject({
      questId: created.id,
      projectId: project.id,
      actor: { id: owner.id, displayName: "김철수" },
      familiarId: null,
    });
    expect(Object.keys(events[0] ?? {}).sort()).toEqual(
      [
        "actor",
        "createdAt",
        "familiarId",
        "id",
        "payload",
        "projectId",
        "questId",
        "type",
      ].sort(),
    );

    expect(events[0]?.payload).toEqual({
      number: 1,
      title: "원래 제목",
    });
    expect(events[1]?.payload).toEqual({
      fields: ["title", "situation"],
    });
    expect(events[2]?.payload).toEqual({ from: "board", to: "dungeon" });
    expect(events[3]?.payload).toEqual({ reason: "dropped" });
  });

  it("orders by created_at first and id as the tie-breaker", async () => {
    const created = await createQuest({ title: "정렬" });
    const base = created.createdAt;

    const insert = (
      type: string,
      payload: unknown,
      createdAt: number,
    ): void => {
      test.db
        .insert(questEvents)
        .values({
          questId: created.id,
          projectId: project.id,
          type,
          payload: JSON.stringify(payload),
          actorUserId: owner.id,
          familiarId: null,
          createdAt,
        })
        .run();
    };

    insert("quest_edited", { fields: ["title"] }, base - 10_000);
    insert("quest_moved", { from: "board", to: "boss" }, base + 20_000);
    insert("quest_archived", {}, base + 20_000);

    const events = (await getEvents(created.id)).json() as QuestEvent[];

    expect(events.map((event) => event.type)).toEqual([
      "quest_edited",
      "quest_posted",
      "quest_moved",
      "quest_archived",
    ]);
    expect(events.map((event) => event.payload)).toEqual([
      { fields: ["title"] },
      { number: 1, title: "정렬" },
      { from: "board", to: "boss" },
      {},
    ]);
  });

  it("joins actor display names and exposes familiar ids", async () => {
    const created = await createQuest({ title: "기록" });
    const member = createUser(test.db, {
      loginId: "event.member",
      displayName: "이영희",
    });
    addMember(test.db, project.id, member.id);
    const memberCookie = createSessionCookie(test.db, member.id);

    await test.app.inject({
      method: "PATCH",
      url: `/api/quests/${created.id}`,
      headers: { cookie: memberCookie },
      payload: { situation: "멤버가 수정" },
    });

    // A familiar-authored event (M4) keeps its numeric familiar id.
    test.db
      .insert(questEvents)
      .values({
        questId: created.id,
        projectId: project.id,
        type: "quest_edited",
        payload: JSON.stringify({ fields: ["tags"] }),
        actorUserId: member.id,
        familiarId: 7,
        createdAt: Date.now() + 1_000,
      })
      .run();

    const events = (await getEvents(created.id)).json() as QuestEvent[];
    expect(events.map((event) => event.actor)).toEqual([
      { id: owner.id, displayName: "김철수" },
      { id: member.id, displayName: "이영희" },
      { id: member.id, displayName: "이영희" },
    ]);
    expect(events.map((event) => event.familiarId)).toEqual([null, null, 7]);
  });

  it("returns a null actor after the user is deleted", async () => {
    const created = await createQuest({ title: "탈퇴자" });
    const member = createUser(test.db, {
      loginId: "event.leaver",
      displayName: "떠난 모험가",
    });
    addMember(test.db, project.id, member.id);
    const memberCookie = createSessionCookie(test.db, member.id);

    await test.app.inject({
      method: "PATCH",
      url: `/api/quests/${created.id}`,
      headers: { cookie: memberCookie },
      payload: { title: "떠나기 전 수정" },
    });

    test.db.delete(users).where(eq(users.id, member.id)).run();

    const events = (await getEvents(created.id)).json() as QuestEvent[];
    const edited = events.find((event) => event.type === "quest_edited");
    expect(edited?.actor).toBeNull();
    // The quest itself (and its creator) is untouched.
    expect(events[0]?.actor).toEqual({
      id: owner.id,
      displayName: "김철수",
    });
  });

  it("requires membership and an existing quest", async () => {
    const created = await createQuest({ title: "비공개" });
    const outsider = createUser(test.db, {
      loginId: "event.outsider",
      displayName: "외부인",
    });
    const outsiderCookie = createSessionCookie(test.db, outsider.id);

    expect((await getEvents(created.id, outsiderCookie)).statusCode).toBe(403);
    expect((await getEvents(999_999)).statusCode).toBe(404);

    const anonymous = await test.app.inject({
      method: "GET",
      url: `/api/quests/${created.id}/events`,
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
