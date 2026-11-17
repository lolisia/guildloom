/**
 * Checklist route tests.
 *
 * `POST /api/quests/:id/checklist/:index` toggles one Markdown task line
 * without touching the rest of `direction`, while
 * `POST /api/quests/:id/checklist` appends unchecked lines. Both endpoints are
 * guild-member only and record a quest event.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Notification, Quest } from "@guildloom/shared";

import {
  questEvents,
  quests,
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

/** Quest detail as the checklist routes return it. */
type QuestDetail = Quest;

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
  owner = createUser(test.db, {
    loginId: "check.owner",
    displayName: "의뢰인",
  });
  member = createUser(test.db, {
    loginId: "check.member",
    displayName: "파티원",
  });
  outsider = createUser(test.db, {
    loginId: "check.outsider",
    displayName: "외부인",
  });
  project = createProject(test.db, { ownerId: owner.id, name: "체크 길드" });
  addMember(test.db, project.id, member.id);

  ownerCookie = createSessionCookie(test.db, owner.id);
  memberCookie = createSessionCookie(test.db, member.id);
  outsiderCookie = createSessionCookie(test.db, outsider.id);
});

afterEach(async () => {
  await test.close();
});

/** Create a quest with an initial direction document. */
async function createQuest(direction = ""): Promise<QuestDetail> {
  const response = await test.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/quests`,
    headers: { cookie: ownerCookie },
    payload: { title: "체크리스트 의뢰", direction },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as QuestDetail;
}

function toggleChecklist(
  questId: number,
  index: number | string,
  payload: Record<string, unknown>,
  cookie: string = ownerCookie,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/checklist/${index}`,
    headers: { cookie },
    payload,
  });
}

function appendChecklist(
  questId: number,
  titles: string[],
  cookie: string = ownerCookie,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/quests/${questId}/checklist`,
    headers: { cookie },
    payload: { titles },
  });
}

function eventRows(questId: number) {
  return test.db
    .select()
    .from(questEvents)
    .where(eq(questEvents.questId, questId))
    .all();
}

function storedQuest(questId: number) {
  return test.db.select().from(quests).where(eq(quests.id, questId)).get();
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

describe("POST /api/quests/:id/checklist/:index", () => {
  it("toggles only the target line and records floor_checked", async () => {
    const direction =
      "# 계획\r\n- [ ] 첫 줄\r\n메모는 그대로\r\n  - [ ] 둘째 줄\r\n";
    const quest = await createQuest(direction);
    const recorded = recordRealtime();

    const response = await toggleChecklist(quest.id, 1, {
      done: true,
      text: "둘째 줄",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as QuestDetail;
    expect(body.direction).toBe(
      "# 계획\r\n- [ ] 첫 줄\r\n메모는 그대로\r\n  - [x] 둘째 줄\r\n",
    );
    expect(body.floors).toEqual({ done: 1, total: 2 });
    expect(body.updatedAt).toBeGreaterThan(quest.updatedAt);
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);
    expect(recorded.xp).toEqual([]);
    expect(recorded.notifications).toEqual([]);

    const events = eventRows(quest.id).filter(
      (event) => event.type === "floor_checked",
    );
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]?.payload ?? "{}")).toEqual({
      text: "둘째 줄",
      done: true,
    });
    expect(events[0]?.actorUserId).toBe(owner.id);

    // Toggling back restores the original bytes exactly.
    const back = await toggleChecklist(quest.id, 1, {
      done: false,
      text: "둘째 줄",
    });
    expect(back.statusCode).toBe(200);
    expect((back.json() as QuestDetail).direction).toBe(direction);
    expect((back.json() as QuestDetail).floors).toEqual({
      done: 0,
      total: 2,
    });
  });

  it("rejects a missing or stale checklist item with CHECKLIST_CONFLICT", async () => {
    const direction = "- [ ] 하나\n- [ ] 둘";
    const quest = await createQuest(direction);
    const recorded = recordRealtime();

    const missing = await toggleChecklist(quest.id, 9, {
      done: true,
      text: "하나",
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe("CHECKLIST_CONFLICT");

    const staleText = await toggleChecklist(quest.id, 0, {
      done: true,
      text: "다른 항목",
    });
    expect(staleText.statusCode).toBe(409);
    expect(staleText.json().error.code).toBe("CHECKLIST_CONFLICT");

    // A negative index never reaches the handler.
    const negative = await toggleChecklist(quest.id, -1, {
      done: true,
      text: "하나",
    });
    expect(negative.statusCode).toBe(400);

    expect(storedQuest(quest.id)?.direction).toBe(direction);
    expect(
      eventRows(quest.id).filter((event) => event.type === "floor_checked"),
    ).toHaveLength(0);
    expect(recorded).toEqual({
      quests: [],
      notifications: [],
      xp: [],
      members: [],
    });
  });

  it("guards membership and unknown quests", async () => {
    const quest = await createQuest("- [ ] 하나");

    const foreign = await toggleChecklist(
      quest.id,
      0,
      { done: true, text: "하나" },
      outsiderCookie,
    );
    expect(foreign.statusCode).toBe(403);

    const missing = await toggleChecklist(999_999, 0, {
      done: true,
      text: "하나",
    });
    expect(missing.statusCode).toBe(404);

    // Any guild member may toggle, not only the creator.
    const allowed = await toggleChecklist(
      quest.id,
      0,
      { done: true, text: "하나" },
      memberCookie,
    );
    expect(allowed.statusCode).toBe(200);
    expect((allowed.json() as QuestDetail).floors).toEqual({
      done: 1,
      total: 1,
    });
  });
});

describe("POST /api/quests/:id/checklist", () => {
  it("appends trimmed titles and records a direction edit", async () => {
    const quest = await createQuest("설명\n- [ ] 하나");
    const recorded = recordRealtime();

    const response = await appendChecklist(quest.id, [
      "  둘  ",
      "   ",
      "셋",
    ]);

    expect(response.statusCode).toBe(200);
    const body = response.json() as QuestDetail;
    expect(body.direction).toBe(
      "설명\n- [ ] 하나\n- [ ] 둘\n- [ ] 셋",
    );
    expect(body.floors).toEqual({ done: 0, total: 3 });
    expect(body.updatedAt).toBeGreaterThan(quest.updatedAt);
    expect(recorded.quests).toEqual([
      { projectId: project.id, questId: quest.id },
    ]);

    const edited = eventRows(quest.id).filter(
      (event) => event.type === "quest_edited",
    );
    expect(edited).toHaveLength(1);
    expect(JSON.parse(edited[0]?.payload ?? "{}")).toEqual({
      fields: ["direction"],
    });
    expect(edited[0]?.actorUserId).toBe(owner.id);
  });

  it("appends to an empty direction and preserves an existing trailing newline", async () => {
    const empty = await createQuest("");
    const appended = await appendChecklist(empty.id, ["첫 항목", "둘째"]);
    expect(appended.statusCode).toBe(200);
    expect((appended.json() as QuestDetail).direction).toBe(
      "- [ ] 첫 항목\n- [ ] 둘째",
    );

    const withNewline = await createQuest("- [ ] 하나\n");
    const extended = await appendChecklist(withNewline.id, ["둘"]);
    expect(extended.statusCode).toBe(200);
    expect((extended.json() as QuestDetail).direction).toBe(
      "- [ ] 하나\n- [ ] 둘",
    );
  });

  it("rejects an append with no non-blank title", async () => {
    const quest = await createQuest("- [ ] 하나");
    const recorded = recordRealtime();

    const response = await appendChecklist(quest.id, ["   ", "\t "]);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");

    expect(storedQuest(quest.id)?.direction).toBe("- [ ] 하나");
    expect(
      eventRows(quest.id).filter((event) => event.type === "quest_edited"),
    ).toHaveLength(0);
    expect(recorded.quests).toEqual([]);

    const tooMany = await appendChecklist(
      quest.id,
      Array.from({ length: 51 }, (_, index) => `${index}번`),
    );
    expect(tooMany.statusCode).toBe(400);
  });

  it("requires guild membership", async () => {
    const quest = await createQuest("");
    const response = await appendChecklist(
      quest.id,
      ["몰래 추가"],
      outsiderCookie,
    );
    expect(response.statusCode).toBe(403);
    expect(storedQuest(quest.id)?.direction).toBe("");
  });
});
