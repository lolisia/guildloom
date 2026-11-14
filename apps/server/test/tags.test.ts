/**
 * Tag autocomplete tests: implicit tag creation, per-project scoping, usage
 * counting, name filtering, ordering and the member guard.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Quest, TagSummary } from "@guildloom/shared";

import { tags, type ProjectRow, type UserRow } from "../src/db/schema.js";
import {
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
  owner = createUser(test.db, { loginId: "tag.owner", displayName: "김철수" });
  project = createProject(test.db, { ownerId: owner.id, name: "태그 길드" });
  cookie = createSessionCookie(test.db, owner.id);
});

afterEach(async () => {
  await test.close();
});

/** Create a quest through the API. */
async function createQuest(
  payload: Record<string, unknown>,
  projectId: number = project.id,
): Promise<Quest> {
  const response = await test.app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/quests`,
    headers: { cookie },
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Quest;
}

/** GET the tag autocomplete list. */
async function autocomplete(
  q?: string,
  actorCookie: string = cookie,
  projectId: number = project.id,
) {
  return test.app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/tags`,
    headers: { cookie: actorCookie },
    query: q === undefined ? {} : { q },
  });
}

describe("GET /api/projects/:pid/tags", () => {
  it("counts tag usage and orders by count then name", async () => {
    await createQuest({ title: "하나", tags: ["버그", "UI"] });
    await createQuest({ title: "둘", tags: ["버그"] });
    await createQuest({ title: "셋", tags: ["버그", "UI"] });
    await createQuest({ title: "넷", tags: ["문서"] });

    const response = await autocomplete();

    expect(response.statusCode).toBe(200);
    const listed = response.json() as TagSummary[];
    expect(listed.map((tag) => [tag.name, tag.count])).toEqual([
      ["버그", 3],
      ["UI", 2],
      ["문서", 1],
    ]);
    expect(listed.every((tag) => typeof tag.id === "number")).toBe(true);
  });

  it("filters by a case-insensitive LIKE substring", async () => {
    await createQuest({ title: "하나", tags: ["버그", "버그는아님", "UI"] });
    await createQuest({ title: "둘", tags: ["버그는아님"] });

    const response = await autocomplete("버그");

    expect(response.statusCode).toBe(200);
    const listed = response.json() as TagSummary[];
    expect(listed.map((tag) => [tag.name, tag.count])).toEqual([
      ["버그는아님", 2],
      ["버그", 1],
    ]);

    const ascii = (await autocomplete("ui")).json() as TagSummary[];
    expect(ascii.map((tag) => tag.name)).toEqual(["UI"]);
  });

  it("matches LIKE wildcards literally", async () => {
    await createQuest({ title: "진행률", tags: ["100%", "100점"] });

    const percent = (await autocomplete("0%")).json() as TagSummary[];
    expect(percent.map((tag) => tag.name)).toEqual(["100%"]);
  });

  it("auto-creates tags once per project after trimming and deduping", async () => {
    await createQuest({ title: "태그", tags: [" 버그 ", "버그", "UI"] });
    await createQuest({ title: "태그2", tags: ["버그"] });

    const stored = test.db
      .select()
      .from(tags)
      .where(eq(tags.projectId, project.id))
      .all();
    expect(stored.map((tag) => tag.name).sort()).toEqual(["UI", "버그"]);

    const listed = (await autocomplete()).json() as TagSummary[];
    expect(listed.find((tag) => tag.name === "버그")?.count).toBe(2);
  });

  it("scopes tags and counts to the requested project", async () => {
    const otherProject = createProject(test.db, {
      ownerId: owner.id,
      name: "다른 길드",
    });

    await createQuest({ title: "A1", tags: ["버그"] });
    await createQuest({ title: "A2", tags: ["버그"] });
    await createQuest({ title: "A3", tags: ["버그"] });
    await createQuest({ title: "B1", tags: ["버그"] }, otherProject.id);
    await createQuest({ title: "B2", tags: ["버그"] }, otherProject.id);

    const first = (await autocomplete()).json() as TagSummary[];
    expect(first.map((tag) => [tag.name, tag.count])).toEqual([["버그", 3]]);

    const second = (await autocomplete(
      undefined,
      cookie,
      otherProject.id,
    )).json() as TagSummary[];
    expect(second.map((tag) => [tag.name, tag.count])).toEqual([["버그", 2]]);
    expect(second[0]?.id).not.toBe(first[0]?.id);
  });

  it("limits the result to 20 tags", async () => {
    const first = Array.from({ length: 20 }, (_, index) =>
      `tag${String(index + 1).padStart(2, "0")}`,
    );
    await createQuest({ title: "스무 개", tags: first });
    await createQuest({ title: "두 개 더", tags: ["tag21", "tag22"] });

    const response = await autocomplete();

    expect(response.statusCode).toBe(200);
    const listed = response.json() as TagSummary[];
    expect(listed).toHaveLength(20);
    expect(listed.map((tag) => tag.name)).toEqual(first);
  });

  it("rejects non-members, unknown projects and unauthenticated callers", async () => {
    const outsider = createUser(test.db, {
      loginId: "tag.outsider",
      displayName: "외부인",
    });
    const outsiderCookie = createSessionCookie(test.db, outsider.id);

    expect((await autocomplete(undefined, outsiderCookie)).statusCode).toBe(403);
    expect((await autocomplete(undefined, cookie, 9999)).statusCode).toBe(404);

    const anonymous = await test.app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/tags`,
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
