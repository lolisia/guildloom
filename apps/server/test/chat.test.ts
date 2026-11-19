/**
 * Chat route tests.
 *
 * They cover the tavern and quest party pages, message posting and its mention
 * alerts, soft deletes, read-signal emissions and turning a tavern message into
 * a quest. Every test builds its own in-memory app, so notifications and
 * message ids never leak between cases.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Stage } from "@guildloom/shared";
import type {
  ChatMessage,
  CreateQuestFromChatResponse,
  MessagePageResponse,
  Quest,
} from "@guildloom/shared";

import type { AppDb } from "../src/db/index.js";
import {
  messages,
  notifications,
  questEvents,
  quests,
  type MessageRow,
  type ProjectRow,
  type QuestRow,
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

/** A guild with an owner, two members and an outsider. */
interface ChatFixture {
  test: TestApp;
  owner: UserRow;
  member: UserRow;
  second: UserRow;
  outsider: UserRow;
  project: ProjectRow;
  ownerCookie: string;
  memberCookie: string;
  secondCookie: string;
  outsiderCookie: string;
}

/** Build the shared chat fixture. */
async function createChatFixture(): Promise<ChatFixture> {
  const test = await createTestApp();
  const owner = createUser(test.db, {
    loginId: "chat.owner",
    displayName: "길드장",
  });
  const member = createUser(test.db, {
    loginId: "chat.member",
    displayName: "김철수",
  });
  const second = createUser(test.db, {
    loginId: "chat.second",
    displayName: "이영희",
  });
  const outsider = createUser(test.db, {
    loginId: "chat.outsider",
    displayName: "외부인",
  });
  const project = createProject(test.db, { ownerId: owner.id });
  addMember(test.db, project.id, member.id);
  addMember(test.db, project.id, second.id);

  return {
    test,
    owner,
    member,
    second,
    outsider,
    project,
    ownerCookie: createSessionCookie(test.db, owner.id),
    memberCookie: createSessionCookie(test.db, member.id),
    secondCookie: createSessionCookie(test.db, second.id),
    outsiderCookie: createSessionCookie(test.db, outsider.id),
  };
}

/** Insert one message row directly and return it. */
function insertMessage(
  db: AppDb,
  input: {
    projectId: number;
    questId: number | null;
    authorUserId: number | null;
    body?: string;
    kind?: "user" | "system";
    payload?: string | null;
    promotedQuestId?: number | null;
    createdAt?: number;
    deletedAt?: number | null;
  },
): MessageRow {
  return db
    .insert(messages)
    .values({
      projectId: input.projectId,
      questId: input.questId,
      kind: input.kind ?? "user",
      authorUserId: input.authorUserId,
      familiarId: null,
      body: input.body ?? "메시지",
      payload: input.payload ?? null,
      promotedQuestId: input.promotedQuestId ?? null,
      createdAt: input.createdAt ?? Date.now(),
      deletedAt: input.deletedAt ?? null,
    })
    .returning()
    .get();
}

/** Insert a quest directly (no event log). */
function insertQuest(
  db: AppDb,
  input: {
    projectId: number;
    createdBy: number;
    number?: number;
    title?: string;
    stage?: Stage;
  },
): QuestRow {
  const number = input.number ?? 1;
  return db
    .insert(quests)
    .values({
      projectId: input.projectId,
      number,
      title: input.title ?? `퀘스트 ${number}`,
      orderKey: `a${number}`,
      stage: input.stage ?? "board",
      createdBy: input.createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .returning()
    .get();
}

/** `POST /api/projects/:pid/quests` and return the created quest. */
async function createQuestViaApi(
  fixture: ChatFixture,
  title = "새 퀘스트",
): Promise<Quest> {
  const response = await fixture.test.app.inject({
    method: "POST",
    url: `/api/projects/${fixture.project.id}/quests`,
    headers: { cookie: fixture.ownerCookie },
    payload: { title },
  });
  expect(response.statusCode).toBe(201);
  return response.json<Quest>();
}

describe("chat routes", () => {
  it("pages a thread newest-first by id and returns each page oldest-first", async () => {
    const fixture = await createChatFixture();
    try {
      const ids: number[] = [];
      for (let index = 1; index <= 120; index += 1) {
        ids.push(
          insertMessage(fixture.test.db, {
            projectId: fixture.project.id,
            questId: null,
            authorUserId: fixture.owner.id,
            body: `메시지 ${index}`,
          }).id,
        );
      }

      const first = await fixture.test.app.inject({
        method: "GET",
        url: `/api/projects/${fixture.project.id}/tavern/messages?limit=50`,
        headers: { cookie: fixture.ownerCookie },
      });
      expect(first.statusCode).toBe(200);
      const firstPage = first.json<MessagePageResponse>();
      expect(firstPage.messages.map((message) => message.id)).toEqual(
        ids.slice(70),
      );
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.messages[0]?.author).toEqual({
        id: fixture.owner.id,
        displayName: "길드장",
      });
      expect(firstPage.messages[0]?.payload).toBeNull();
      expect(firstPage.messages[0]?.promotedQuest).toBeNull();

      const second = await fixture.test.app.inject({
        method: "GET",
        url:
          `/api/projects/${fixture.project.id}/tavern/messages` +
          `?limit=50&before=${ids[70]}`,
        headers: { cookie: fixture.ownerCookie },
      });
      expect(second.statusCode).toBe(200);
      const secondPage = second.json<MessagePageResponse>();
      expect(secondPage.messages.map((message) => message.id)).toEqual(
        ids.slice(20, 70),
      );
      expect(secondPage.hasMore).toBe(true);
      const firstIds = new Set(firstPage.messages.map((message) => message.id));
      expect(
        secondPage.messages.some((message) => firstIds.has(message.id)),
      ).toBe(false);

      const oldest = await fixture.test.app.inject({
        method: "GET",
        url:
          `/api/projects/${fixture.project.id}/tavern/messages` +
          `?limit=50&before=${ids[20]}`,
        headers: { cookie: fixture.ownerCookie },
      });
      expect(oldest.statusCode).toBe(200);
      const oldestPage = oldest.json<MessagePageResponse>();
      expect(oldestPage.messages.map((message) => message.id)).toEqual(
        ids.slice(0, 20),
      );
      expect(oldestPage.hasMore).toBe(false);
    } finally {
      await fixture.test.close();
    }
  });

  it("requires a session and reports missing targets or non-members as 404", async () => {
    const fixture = await createChatFixture();
    try {
      const { app } = fixture.test;
      const tavernUrl = `/api/projects/${fixture.project.id}/tavern/messages`;
      const quest = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.owner.id,
      });

      // Every endpoint runs `authenticate` first.
      const unauthenticated = [
        { method: "GET" as const, url: tavernUrl },
        { method: "POST" as const, url: tavernUrl, payload: { body: "안녕" } },
        {
          method: "GET" as const,
          url: `/api/quests/${quest.id}/messages`,
        },
        {
          method: "POST" as const,
          url: `/api/quests/${quest.id}/messages`,
          payload: { body: "안녕" },
        },
        { method: "DELETE" as const, url: "/api/messages/1" },
        {
          method: "GET" as const,
          url: `/api/projects/${fixture.project.id}/chat/unread`,
        },
        {
          method: "POST" as const,
          url: `/api/projects/${fixture.project.id}/chat/read`,
          payload: { questId: null, messageId: 1 },
        },
        {
          method: "POST" as const,
          url: `/api/projects/${fixture.project.id}/tavern/quests`,
          payload: { title: "의뢰" },
        },
      ];
      for (const request of unauthenticated) {
        const response = await app.inject(request);
        expect(response.statusCode).toBe(401);
        expect(response.json().error.code).toBe("UNAUTHORIZED");
      }

      // Missing project / quest.
      const missingProject = await app.inject({
        method: "GET",
        url: "/api/projects/999999/tavern/messages",
        headers: { cookie: fixture.ownerCookie },
      });
      expect(missingProject.statusCode).toBe(404);
      expect(missingProject.json().error.code).toBe("NOT_FOUND");

      const missingQuest = await app.inject({
        method: "GET",
        url: "/api/quests/999999/messages",
        headers: { cookie: fixture.ownerCookie },
      });
      expect(missingQuest.statusCode).toBe(404);
      expect(missingQuest.json().error.code).toBe("NOT_FOUND");

      // Non-members see the same 404 as a missing target.
      const nonMemberReads = [
        { method: "GET" as const, url: tavernUrl },
        { method: "POST" as const, url: tavernUrl, payload: { body: "안녕" } },
        {
          method: "GET" as const,
          url: `/api/quests/${quest.id}/messages`,
        },
        {
          method: "POST" as const,
          url: `/api/quests/${quest.id}/messages`,
          payload: { body: "안녕" },
        },
        {
          method: "GET" as const,
          url: `/api/projects/${fixture.project.id}/chat/unread`,
        },
        {
          method: "POST" as const,
          url: `/api/projects/${fixture.project.id}/chat/read`,
          payload: { questId: null, messageId: 1 },
        },
        {
          method: "POST" as const,
          url: `/api/projects/${fixture.project.id}/tavern/quests`,
          payload: { title: "의뢰" },
        },
      ];
      for (const request of nonMemberReads) {
        const response = await app.inject({
          ...request,
          headers: { cookie: fixture.outsiderCookie },
        });
        expect(response.statusCode).toBe(404);
        expect(response.json().error.code).toBe("NOT_FOUND");
      }

      const message = insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.owner.id,
      });
      const outsiderDelete = await app.inject({
        method: "DELETE",
        url: `/api/messages/${message.id}`,
        headers: { cookie: fixture.outsiderCookie },
      });
      expect(outsiderDelete.statusCode).toBe(404);
      expect(outsiderDelete.json().error.code).toBe("NOT_FOUND");

      const missingMessage = await app.inject({
        method: "DELETE",
        url: "/api/messages/999999",
        headers: { cookie: fixture.ownerCookie },
      });
      expect(missingMessage.statusCode).toBe(404);
      expect(missingMessage.json().error.code).toBe("NOT_FOUND");
    } finally {
      await fixture.test.close();
    }
  });

  it("rejects blank and overlong message bodies", async () => {
    const fixture = await createChatFixture();
    try {
      const url = `/api/projects/${fixture.project.id}/tavern/messages`;

      const blank = await fixture.test.app.inject({
        method: "POST",
        url,
        headers: { cookie: fixture.ownerCookie },
        payload: { body: "   " },
      });
      expect(blank.statusCode).toBe(400);
      expect(blank.json().error.code).toBe("VALIDATION_ERROR");

      const tooLong = await fixture.test.app.inject({
        method: "POST",
        url,
        headers: { cookie: fixture.ownerCookie },
        payload: { body: "a".repeat(4001) },
      });
      expect(tooLong.statusCode).toBe(400);
      expect(tooLong.json().error.code).toBe("VALIDATION_ERROR");

      const atLimit = await fixture.test.app.inject({
        method: "POST",
        url,
        headers: { cookie: fixture.ownerCookie },
        payload: { body: "a".repeat(4000) },
      });
      expect(atLimit.statusCode).toBe(201);
      expect(atLimit.json<ChatMessage>().body).toHaveLength(4000);
    } finally {
      await fixture.test.close();
    }
  });

  it("stores party messages verbatim and never touches the quest or its events", async () => {
    const fixture = await createChatFixture();
    try {
      const quest = await createQuestViaApi(fixture);
      const before = fixture.test.db
        .select()
        .from(quests)
        .where(eq(quests.id, quest.id))
        .get();
      const eventsBefore = fixture.test.db
        .select()
        .from(questEvents)
        .where(eq(questEvents.questId, quest.id))
        .all().length;

      const body = `@길드장 <@${fixture.member.id}> 그대로 보낸다`;
      const posted = await fixture.test.app.inject({
        method: "POST",
        url: `/api/quests/${quest.id}/messages`,
        headers: { cookie: fixture.ownerCookie },
        payload: { body },
      });
      expect(posted.statusCode).toBe(201);
      const message = posted.json<ChatMessage>();
      expect(message).toMatchObject({
        questId: quest.id,
        kind: "user",
        body,
        payload: null,
        promotedQuest: null,
        author: { id: fixture.owner.id, displayName: "길드장" },
      });

      const after = fixture.test.db
        .select()
        .from(quests)
        .where(eq(quests.id, quest.id))
        .get();
      expect(after?.updatedAt).toBe(before?.updatedAt);
      const eventsAfter = fixture.test.db
        .select()
        .from(questEvents)
        .where(eq(questEvents.questId, quest.id))
        .all().length;
      expect(eventsAfter).toBe(eventsBefore);

      // Party chat also accepts archived quests.
      const archived = await fixture.test.app.inject({
        method: "POST",
        url: `/api/quests/${quest.id}/archive`,
        headers: { cookie: fixture.ownerCookie },
        payload: {},
      });
      expect(archived.statusCode).toBe(200);

      const afterArchive = await fixture.test.app.inject({
        method: "POST",
        url: `/api/quests/${quest.id}/messages`,
        headers: { cookie: fixture.memberCookie },
        payload: { body: "보관된 방에도 쓴다" },
      });
      expect(afterArchive.statusCode).toBe(201);

      const page = await fixture.test.app.inject({
        method: "GET",
        url: `/api/quests/${quest.id}/messages`,
        headers: { cookie: fixture.secondCookie },
      });
      expect(page.statusCode).toBe(200);
      expect(
        page
          .json<MessagePageResponse>()
          .messages.map((entry) => entry.body),
      ).toEqual([body, "보관된 방에도 쓴다"]);
    } finally {
      await fixture.test.close();
    }
  });

  it("notifies distinct same-guild mentioned members only", async () => {
    const fixture = await createChatFixture();
    try {
      const body =
        `안녕 <@${fixture.member.id}> <@${fixture.second.id}> ` +
        `<@${fixture.owner.id}> <@${fixture.outsider.id}> ` +
        `<@${fixture.member.id}> 다시`;

      const posted = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/messages`,
        headers: { cookie: fixture.ownerCookie },
        payload: { body },
      });
      expect(posted.statusCode).toBe(201);
      const message = posted.json<ChatMessage>();

      const rows = fixture.test.db
        .select()
        .from(notifications)
        .where(eq(notifications.projectId, fixture.project.id))
        .all();
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.userId).sort((a, b) => a - b)).toEqual(
        [fixture.member.id, fixture.second.id].sort((a, b) => a - b),
      );

      for (const row of rows) {
        expect(row.type).toBe("mentioned");
        expect(row.questId).toBeNull();
        expect(row.actorUserId).toBe(fixture.owner.id);
        expect(JSON.parse(row.payload)).toEqual({
          messageId: message.id,
          excerpt:
            "안녕 @김철수 @이영희 @길드장 @알 수 없음 @김철수 다시",
        });
      }
    } finally {
      await fixture.test.close();
    }
  });

  it("caps mention alerts at 20 recipients in mention order", async () => {
    const fixture = await createChatFixture();
    try {
      const extra: UserRow[] = [];
      for (let index = 0; index < 25; index += 1) {
        const user = createUser(fixture.test.db, {
          loginId: `chat.extra.${index}`,
          displayName: `멤버${index}`,
        });
        addMember(fixture.test.db, fixture.project.id, user.id);
        extra.push(user);
      }

      const posted = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/messages`,
        headers: { cookie: fixture.ownerCookie },
        payload: { body: extra.map((user) => `<@${user.id}>`).join(" ") },
      });
      expect(posted.statusCode).toBe(201);

      const rows = fixture.test.db
        .select()
        .from(notifications)
        .where(eq(notifications.projectId, fixture.project.id))
        .all();
      expect(rows).toHaveLength(20);
      expect(rows.map((row) => row.userId)).toEqual(
        extra.slice(0, 20).map((user) => user.id),
      );
    } finally {
      await fixture.test.close();
    }
  });

  it("truncates mention excerpts to 80 characters plus an ellipsis", async () => {
    const fixture = await createChatFixture();
    try {
      const posted = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/messages`,
        headers: { cookie: fixture.ownerCookie },
        payload: {
          body: `${"x".repeat(100)} <@${fixture.member.id}>`,
        },
      });
      expect(posted.statusCode).toBe(201);

      const row = fixture.test.db
        .select()
        .from(notifications)
        .where(eq(notifications.projectId, fixture.project.id))
        .get();
      const payload = JSON.parse(row?.payload ?? "{}") as { excerpt: string };
      expect(payload.excerpt).toBe(`${"x".repeat(80)}…`);
      expect(payload.excerpt).toHaveLength(81);
    } finally {
      await fixture.test.close();
    }
  });

  it("sets the quest id on party mention alerts", async () => {
    const fixture = await createChatFixture();
    try {
      const quest = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.owner.id,
      });

      const posted = await fixture.test.app.inject({
        method: "POST",
        url: `/api/quests/${quest.id}/messages`,
        headers: { cookie: fixture.ownerCookie },
        payload: { body: `<@${fixture.member.id}> 확인 부탁` },
      });
      expect(posted.statusCode).toBe(201);
      const message = posted.json<ChatMessage>();
      expect(message.questId).toBe(quest.id);

      const row = fixture.test.db
        .select()
        .from(notifications)
        .where(eq(notifications.projectId, fixture.project.id))
        .get();
      expect(row?.userId).toBe(fixture.member.id);
      expect(row?.questId).toBe(quest.id);
      expect(row?.type).toBe("mentioned");
      expect(JSON.parse(row?.payload ?? "{}")).toEqual({
        messageId: message.id,
        excerpt: "@김철수 확인 부탁",
      });
    } finally {
      await fixture.test.close();
    }
  });

  it("soft deletes messages for their author idempotently", async () => {
    const fixture = await createChatFixture();
    try {
      const posted = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/messages`,
        headers: { cookie: fixture.ownerCookie },
        payload: { body: "지울 메시지" },
      });
      expect(posted.statusCode).toBe(201);
      const message = posted.json<ChatMessage>();

      const deleted = await fixture.test.app.inject({
        method: "DELETE",
        url: `/api/messages/${message.id}`,
        headers: { cookie: fixture.ownerCookie },
      });
      expect(deleted.statusCode).toBe(204);
      expect(deleted.body).toBe("");

      const row = fixture.test.db
        .select()
        .from(messages)
        .where(eq(messages.id, message.id))
        .get();
      expect(row?.body).toBe("");
      expect(row?.deletedAt).not.toBeNull();

      const page = await fixture.test.app.inject({
        method: "GET",
        url: `/api/projects/${fixture.project.id}/tavern/messages`,
        headers: { cookie: fixture.memberCookie },
      });
      const pageMessage = page
        .json<MessagePageResponse>()
        .messages.find((entry) => entry.id === message.id);
      expect(pageMessage).toMatchObject({
        body: "",
        deletedAt: row?.deletedAt,
      });

      const repeated = await fixture.test.app.inject({
        method: "DELETE",
        url: `/api/messages/${message.id}`,
        headers: { cookie: fixture.ownerCookie },
      });
      expect(repeated.statusCode).toBe(204);
      expect(repeated.body).toBe("");
    } finally {
      await fixture.test.close();
    }
  });

  it("restricts deletes to the author and never allows system messages", async () => {
    const fixture = await createChatFixture();
    try {
      const posted = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/messages`,
        headers: { cookie: fixture.ownerCookie },
        payload: { body: "작성자만 지울 수 있다" },
      });
      expect(posted.statusCode).toBe(201);
      const message = posted.json<ChatMessage>();

      const otherMember = await fixture.test.app.inject({
        method: "DELETE",
        url: `/api/messages/${message.id}`,
        headers: { cookie: fixture.memberCookie },
      });
      expect(otherMember.statusCode).toBe(403);
      expect(otherMember.json().error.code).toBe("FORBIDDEN");

      const promoted = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/quests`,
        headers: { cookie: fixture.ownerCookie },
        payload: { title: "시스템 메시지" },
      });
      expect(promoted.statusCode).toBe(201);
      const systemMessage = promoted.json<CreateQuestFromChatResponse>().message;
      expect(systemMessage.kind).toBe("system");

      const deleteSystem = await fixture.test.app.inject({
        method: "DELETE",
        url: `/api/messages/${systemMessage.id}`,
        headers: { cookie: fixture.ownerCookie },
      });
      expect(deleteSystem.statusCode).toBe(403);
      expect(deleteSystem.json().error.code).toBe("FORBIDDEN");
    } finally {
      await fixture.test.close();
    }
  });

  it("emits chat:changed for every create and delete", async () => {
    const fixture = await createChatFixture();
    try {
      const recorded: Array<{ projectId: number; questId: number | null }> = [];
      fixture.test.app.realtime = {
        ...fixture.test.app.realtime,
        emitChatChanged(projectId, questId) {
          recorded.push({ projectId, questId });
        },
      };

      const tavern = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/messages`,
        headers: { cookie: fixture.ownerCookie },
        payload: { body: "여관 메시지" },
      });
      expect(tavern.statusCode).toBe(201);
      const tavernMessage = tavern.json<ChatMessage>();

      const quest = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.owner.id,
      });
      const party = await fixture.test.app.inject({
        method: "POST",
        url: `/api/quests/${quest.id}/messages`,
        headers: { cookie: fixture.ownerCookie },
        payload: { body: "파티 메시지" },
      });
      expect(party.statusCode).toBe(201);

      const deleted = await fixture.test.app.inject({
        method: "DELETE",
        url: `/api/messages/${tavernMessage.id}`,
        headers: { cookie: fixture.ownerCookie },
      });
      expect(deleted.statusCode).toBe(204);

      // Reading is a private cursor move; it never broadcasts.
      await fixture.test.app.inject({
        method: "GET",
        url: `/api/projects/${fixture.project.id}/chat/unread`,
        headers: { cookie: fixture.memberCookie },
      });
      await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/chat/read`,
        headers: { cookie: fixture.memberCookie },
        payload: { questId: quest.id, messageId: 2 },
      });

      expect(recorded).toEqual([
        { projectId: fixture.project.id, questId: null },
        { projectId: fixture.project.id, questId: quest.id },
        { projectId: fixture.project.id, questId: null },
      ]);
    } finally {
      await fixture.test.close();
    }
  });

  it("promotes a tavern message into a quest exactly once", async () => {
    const fixture = await createChatFixture();
    try {
      const posted = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/messages`,
        headers: { cookie: fixture.ownerCookie },
        payload: { body: "로그인이 자꾸 풀린다" },
      });
      expect(posted.statusCode).toBe(201);
      const source = posted.json<ChatMessage>();

      const promoted = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/quests`,
        headers: { cookie: fixture.ownerCookie },
        payload: {
          title: "로그인 세션 버그",
          situation: "10분마다 세션이 만료된다",
          sourceMessageId: source.id,
        },
      });
      expect(promoted.statusCode).toBe(201);
      const result = promoted.json<CreateQuestFromChatResponse>();

      expect(result.quest).toMatchObject({
        title: "로그인 세션 버그",
        situation: "10분마다 세션이 만료된다",
        kind: "fix",
        stage: "board",
        number: 1,
      });
      expect(result.message).toMatchObject({
        kind: "system",
        questId: null,
        author: { id: fixture.owner.id, displayName: "길드장" },
        body: "",
        payload: {
          type: "quest_created",
          questId: result.quest.id,
          questNumber: result.quest.number,
          questTitle: result.quest.title,
          sourceMessageId: source.id,
        },
      });
      expect(result.message.promotedQuest).toEqual({
        id: result.quest.id,
        number: result.quest.number,
        title: result.quest.title,
      });

      const sourceRow = fixture.test.db
        .select()
        .from(messages)
        .where(eq(messages.id, source.id))
        .get();
      expect(sourceRow?.promotedQuestId).toBe(result.quest.id);

      const page = await fixture.test.app.inject({
        method: "GET",
        url: `/api/projects/${fixture.project.id}/tavern/messages`,
        headers: { cookie: fixture.memberCookie },
      });
      const entries = page.json<MessagePageResponse>().messages;
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        id: source.id,
        promotedQuest: {
          id: result.quest.id,
          number: result.quest.number,
          title: result.quest.title,
        },
      });
      expect(entries[1]).toMatchObject({
        id: result.message.id,
        kind: "system",
        author: { id: fixture.owner.id, displayName: "길드장" },
        body: "",
        payload: result.message.payload,
        promotedQuest: {
          id: result.quest.id,
          number: result.quest.number,
          title: result.quest.title,
        },
      });

      const repeated = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/quests`,
        headers: { cookie: fixture.ownerCookie },
        payload: { title: "중복 의뢰", sourceMessageId: source.id },
      });
      expect(repeated.statusCode).toBe(409);
      expect(repeated.json().error.code).toBe("ALREADY_PROMOTED");
      expect(fixture.test.db.select().from(quests).all()).toHaveLength(1);
    } finally {
      await fixture.test.close();
    }
  });

  it("rejects a source message that is not a live tavern message of the guild", async () => {
    const fixture = await createChatFixture();
    try {
      const foreignOwner = createUser(fixture.test.db, {
        loginId: "chat.foreign",
      });
      const foreignProject = createProject(fixture.test.db, {
        ownerId: foreignOwner.id,
      });
      const foreignMessage = insertMessage(fixture.test.db, {
        projectId: foreignProject.id,
        questId: null,
        authorUserId: foreignOwner.id,
      });

      const foreign = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/quests`,
        headers: { cookie: fixture.ownerCookie },
        payload: { title: "외부 메시지", sourceMessageId: foreignMessage.id },
      });
      expect(foreign.statusCode).toBe(400);
      expect(foreign.json().error.code).toBe("VALIDATION_ERROR");

      // A party message is not a tavern message.
      const quest = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.owner.id,
      });
      const partyMessage = insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: quest.id,
        authorUserId: fixture.owner.id,
      });
      const partySource = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/quests`,
        headers: { cookie: fixture.ownerCookie },
        payload: { title: "파티 메시지", sourceMessageId: partyMessage.id },
      });
      expect(partySource.statusCode).toBe(400);
      expect(partySource.json().error.code).toBe("VALIDATION_ERROR");

      // Deleted and system messages cannot be promoted either.
      const deletedMessage = insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.owner.id,
        deletedAt: Date.now(),
      });
      const deletedSource = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/quests`,
        headers: { cookie: fixture.ownerCookie },
        payload: { title: "삭제된 메시지", sourceMessageId: deletedMessage.id },
      });
      expect(deletedSource.statusCode).toBe(400);

      const systemMessage = insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.owner.id,
        kind: "system",
        body: "",
        payload: JSON.stringify({ type: "quest_created" }),
      });
      const systemSource = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/quests`,
        headers: { cookie: fixture.ownerCookie },
        payload: { title: "시스템 메시지", sourceMessageId: systemMessage.id },
      });
      expect(systemSource.statusCode).toBe(400);
    } finally {
      await fixture.test.close();
    }
  });

  it("creates a quest from the tavern without a source message", async () => {
    const fixture = await createChatFixture();
    try {
      const created = await fixture.test.app.inject({
        method: "POST",
        url: `/api/projects/${fixture.project.id}/tavern/quests`,
        headers: { cookie: fixture.memberCookie },
        payload: { title: "새 의뢰", situation: "상황 설명" },
      });
      expect(created.statusCode).toBe(201);
      const result = created.json<CreateQuestFromChatResponse>();
      expect(result.quest).toMatchObject({
        title: "새 의뢰",
        situation: "상황 설명",
        kind: "fix",
        createdBy: { id: fixture.member.id },
      });
      expect(result.message).toMatchObject({
        kind: "system",
        questId: null,
        author: { id: fixture.member.id, displayName: "김철수" },
        body: "",
      });
      expect(result.message.payload).toEqual({
        type: "quest_created",
        questId: result.quest.id,
        questNumber: result.quest.number,
        questTitle: result.quest.title,
        sourceMessageId: null,
      });

      const systemRow = fixture.test.db
        .select()
        .from(messages)
        .where(eq(messages.id, result.message.id))
        .get();
      expect(systemRow).toMatchObject({
        projectId: fixture.project.id,
        questId: null,
        kind: "system",
        authorUserId: fixture.member.id,
        body: "",
      });
    } finally {
      await fixture.test.close();
    }
  });
});
