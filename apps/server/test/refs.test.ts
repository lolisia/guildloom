/**
 * Quest reference document (참고 문서) API tests.
 *
 * `POST /api/quests/:id/refs` appends a reference for any guild member and
 * records `ref_added`; `DELETE /api/refs/:id` removes it and records
 * `ref_removed`. Both broadcast `quest:changed` only after the transaction
 * committed.
 */
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Notification, Quest, QuestRef } from "@guildloom/shared";

import {
  questEvents,
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
let member: UserRow;
let outsider: UserRow;
let project: ProjectRow;
let ownerCookie: string;
let memberCookie: string;
let outsiderCookie: string;

beforeEach(async () => {
  test = await createTestApp();
  owner = createUser(test.db, { loginId: "refs.owner", displayName: "의뢰인" });
  member = createUser(test.db, { loginId: "refs.member", displayName: "앨리스" });
  outsider = createUser(test.db, {
    loginId: "refs.outsider",
    displayName: "외부인",
  });
  project = createProject(test.db, { ownerId: owner.id, name: "참고 문서 길드" });
  addMember(test.db, project.id, member.id);

  ownerCookie = createSessionCookie(test.db, owner.id);
  memberCookie = createSessionCookie(test.db, member.id);
  outsiderCookie = createSessionCookie(test.db, outsider.id);
});

afterEach(async () => {
  await test.close();
});

async function createQuest(title = "참고 문서 의뢰"): Promise<Quest> {
  const response = await test.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/quests`,
    headers: { cookie: ownerCookie },
    payload: { title },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Quest;
}

function postRef(
  questId: number,
  payload: Record<string, unknown>,
  cookie: string = ownerCookie,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/refs`,
    headers: { cookie },
    payload,
  });
}

function deleteRef(refId: number, cookie: string = ownerCookie) {
  return test.app.inject({
    method: "DELETE",
    url: `/api/refs/${refId}`,
    headers: { cookie },
  });
}

function getQuest(questId: number, cookie: string = ownerCookie) {
  return test.app.inject({
    method: "GET",
    url: `/api/quests/${questId}`,
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

function eventPayloads(questId: number, type: string): unknown[] {
  return eventRows(questId)
    .filter((event) => event.type === type)
    .map((event) => JSON.parse(event.payload) as unknown);
}

/** Replace the broadcaster with one that records quest:changed signals. */
function recordRealtime(): Array<{ projectId: number; questId: number }> {
  const quests: Array<{ projectId: number; questId: number }> = [];
  const realtime: Realtime = {
    emitQuestChanged(projectId, questId) {
      quests.push({ projectId, questId });
    },
    emitNotification(_userId: number, _notification: Notification) {},
    emitXpChanged(_input: XpChangedInput) {},
    emitMembersChanged() {},
  };
  test.app.realtime = realtime;
  return quests;
}

describe("POST /api/quests/:id/refs", () => {
  it("adds references and exposes them in insertion order with computed kinds", async () => {
    const quest = await createQuest();
    const recorded = recordRealtime();

    const urlResponse = await postRef(
      quest.id,
      { label: "  설계 문서  ", target: "  https://example.com/spec  " },
      memberCookie,
    );
    expect(urlResponse.statusCode).toBe(201);
    const urlRef = urlResponse.json() as QuestRef;
    expect(urlRef).toMatchObject({
      label: "설계 문서",
      target: "https://example.com/spec",
      kind: "url",
      createdBy: { id: member.id, displayName: "앨리스" },
    });
    expect(urlRef.id).toEqual(expect.any(Number));
    expect(urlRef.createdAt).toEqual(expect.any(Number));

    const pathResponse = await postRef(quest.id, {
      label: "   ",
      target: "src/routes/quests.ts",
    });
    expect(pathResponse.statusCode).toBe(201);
    const pathRef = pathResponse.json() as QuestRef;
    expect(pathRef).toMatchObject({
      label: null,
      target: "src/routes/quests.ts",
      kind: "path",
      createdBy: { id: owner.id, displayName: "의뢰인" },
    });
    expect(pathRef.id).toBeGreaterThan(urlRef.id);

    const detail = (await getQuest(quest.id)).json() as Quest;
    expect(detail.refs).toEqual([urlRef, pathRef]);

    expect(eventPayloads(quest.id, "ref_added")).toEqual([
      {
        refId: urlRef.id,
        target: "https://example.com/spec",
        label: "설계 문서",
      },
      {
        refId: pathRef.id,
        target: "src/routes/quests.ts",
        label: null,
      },
    ]);

    expect(recorded).toEqual([
      { projectId: project.id, questId: quest.id },
      { projectId: project.id, questId: quest.id },
    ]);
  });

  it("rejects outsiders, unknown quests and blank targets", async () => {
    const quest = await createQuest();

    const forbidden = await postRef(
      quest.id,
      { target: "https://example.com" },
      outsiderCookie,
    );
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });

    const missing = await postRef(999_999, { target: "https://example.com" });
    expect(missing.statusCode).toBe(404);

    const blank = await postRef(quest.id, { target: "   " });
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    expect(eventPayloads(quest.id, "ref_added")).toEqual([]);
  });
});

describe("DELETE /api/refs/:id", () => {
  it("removes a reference, records ref_removed and broadcasts", async () => {
    const quest = await createQuest();
    const created = (
      await postRef(quest.id, {
        label: "런북",
        target: "https://example.com/runbook",
      })
    ).json() as QuestRef;

    const recorded = recordRealtime();
    const response = await deleteRef(created.id, memberCookie);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");

    expect((await getQuest(quest.id)).json<Quest>().refs).toEqual([]);
    expect(eventPayloads(quest.id, "ref_removed")).toEqual([
      { target: "https://example.com/runbook", label: "런북" },
    ]);
    expect(recorded).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);

    // The row is gone: a second delete is a 404.
    expect((await deleteRef(created.id)).statusCode).toBe(404);
    expect((await deleteRef(999_999)).statusCode).toBe(404);
  });

  it("only lets guild members delete a reference", async () => {
    const quest = await createQuest();
    const created = (
      await postRef(quest.id, { target: "docs/f1.md" })
    ).json() as QuestRef;

    const forbidden = await deleteRef(created.id, outsiderCookie);
    expect(forbidden.statusCode).toBe(403);
    expect((await getQuest(quest.id)).json<Quest>().refs).toHaveLength(1);

    expect(eventPayloads(quest.id, "ref_removed")).toEqual([]);
  });
});
