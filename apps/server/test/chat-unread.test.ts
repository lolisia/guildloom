/**
 * Chat unread/read-cursor tests.
 *
 * They pin the thread selection rules (tavern, requested/fighting/authored
 * quests), the excluded rows (own, deleted, archived), the join-time rule for
 * the tavern and the monotonic read cursor.
 */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { ChatUnreadResponse, MemberStatus, Stage } from "@guildloom/shared";

import type { AppDb } from "../src/db/index.js";
import {
  messages,
  partyMembers,
  projectMembers,
  quests,
  readCursors,
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

/** A guild with a reader, an unrelated member and an outsider. */
interface UnreadFixture {
  test: TestApp;
  owner: UserRow;
  reader: UserRow;
  other: UserRow;
  outsider: UserRow;
  project: ProjectRow;
  readerCookie: string;
  outsiderCookie: string;
  /** Membership start of the reader, pinned in the past for the tavern rule. */
  joinedAt: number;
}

/** Build the unread fixture and pin the reader's joined-at time. */
async function createUnreadFixture(): Promise<UnreadFixture> {
  const test = await createTestApp();
  const owner = createUser(test.db, { loginId: "unread.owner" });
  const reader = createUser(test.db, {
    loginId: "unread.reader",
    displayName: "읽는이",
  });
  const other = createUser(test.db, {
    loginId: "unread.other",
    displayName: "다른이",
  });
  const outsider = createUser(test.db, { loginId: "unread.outsider" });
  const project = createProject(test.db, { ownerId: owner.id });
  addMember(test.db, project.id, reader.id);
  addMember(test.db, project.id, other.id);

  const joinedAt = Date.now() - 60_000;
  test.db
    .update(projectMembers)
    .set({ joinedAt })
    .where(
      and(
        eq(projectMembers.projectId, project.id),
        eq(projectMembers.userId, reader.id),
      ),
    )
    .run();

  return {
    test,
    owner,
    reader,
    other,
    outsider,
    project,
    readerCookie: createSessionCookie(test.db, reader.id),
    outsiderCookie: createSessionCookie(test.db, outsider.id),
    joinedAt,
  };
}

/** Insert one message row directly and return it. */
function insertMessage(
  db: AppDb,
  input: {
    projectId: number;
    questId: number | null;
    authorUserId: number | null;
    createdAt: number;
    body?: string;
    deletedAt?: number | null;
  },
): MessageRow {
  return db
    .insert(messages)
    .values({
      projectId: input.projectId,
      questId: input.questId,
      kind: "user",
      authorUserId: input.authorUserId,
      familiarId: null,
      body: input.body ?? "메시지",
      payload: null,
      promotedQuestId: null,
      createdAt: input.createdAt,
      deletedAt: input.deletedAt ?? null,
    })
    .returning()
    .get();
}

/** Insert a quest directly with the next free number in its project. */
function insertQuest(
  db: AppDb,
  input: {
    projectId: number;
    createdBy: number;
    stage?: Stage;
  },
): QuestRow {
  const existing = db
    .select({ id: quests.id })
    .from(quests)
    .where(eq(quests.projectId, input.projectId))
    .all().length;
  const number = existing + 1;
  const now = Date.now();

  return db
    .insert(quests)
    .values({
      projectId: input.projectId,
      number,
      title: `퀘스트 ${number}`,
      orderKey: `a${number}`,
      stage: input.stage ?? "board",
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

/** Add a party row with the given (active or retreated) status. */
function addPartyMember(
  db: AppDb,
  questId: number,
  userId: number,
  status: MemberStatus,
): void {
  db.insert(partyMembers)
    .values({
      questId,
      userId,
      role: "member",
      status,
      retreatReason: null,
      joinedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

/** `GET /api/projects/:pid/chat/unread` as the reader. */
async function fetchUnread(
  fixture: UnreadFixture,
): Promise<ChatUnreadResponse> {
  const response = await fixture.test.app.inject({
    method: "GET",
    url: `/api/projects/${fixture.project.id}/chat/unread`,
    headers: { cookie: fixture.readerCookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json<ChatUnreadResponse>();
}

/** `POST /api/projects/:pid/chat/read`. */
function markRead(
  fixture: UnreadFixture,
  payload: { questId: number | null; messageId: number },
  cookie = fixture.readerCookie,
) {
  return fixture.test.app.inject({
    method: "POST",
    url: `/api/projects/${fixture.project.id}/chat/read`,
    headers: { cookie },
    payload,
  });
}

describe("chat unread and read cursors", () => {
  it("counts tavern messages after joining, excluding own and deleted rows", async () => {
    const fixture = await createUnreadFixture();
    try {
      // History before the reader joined the guild.
      insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.other.id,
        createdAt: fixture.joinedAt - 2_000,
      });
      insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.other.id,
        createdAt: fixture.joinedAt - 1_000,
      });

      const unread = [
        insertMessage(fixture.test.db, {
          projectId: fixture.project.id,
          questId: null,
          authorUserId: fixture.other.id,
          createdAt: fixture.joinedAt + 1_000,
        }),
        insertMessage(fixture.test.db, {
          projectId: fixture.project.id,
          questId: null,
          authorUserId: fixture.other.id,
          createdAt: fixture.joinedAt + 2_000,
        }),
        insertMessage(fixture.test.db, {
          projectId: fixture.project.id,
          questId: null,
          authorUserId: fixture.other.id,
          createdAt: fixture.joinedAt + 3_000,
        }),
      ];
      expect(unread).toHaveLength(3);
      // Own messages and deleted rows never count as unread.
      insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.reader.id,
        createdAt: fixture.joinedAt + 4_000,
      });
      insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.other.id,
        createdAt: fixture.joinedAt + 5_000,
        deletedAt: fixture.joinedAt + 6_000,
      });

      await expect(fetchUnread(fixture)).resolves.toEqual({
        tavern: 3,
        quests: [],
      });
    } finally {
      await fixture.test.close();
    }
  });

  it("clears the tavern with a read cursor that never moves backwards", async () => {
    const fixture = await createUnreadFixture();
    try {
      const first = insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.other.id,
        createdAt: fixture.joinedAt + 1_000,
      });
      insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.other.id,
        createdAt: fixture.joinedAt + 2_000,
      });
      const last = insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.other.id,
        createdAt: fixture.joinedAt + 3_000,
      });

      await expect(fetchUnread(fixture)).resolves.toEqual({
        tavern: 3,
        quests: [],
      });

      const cleared = await markRead(fixture, {
        questId: null,
        messageId: last.id,
      });
      expect(cleared.statusCode).toBe(204);
      expect(cleared.body).toBe("");
      await expect(fetchUnread(fixture)).resolves.toEqual({
        tavern: 0,
        quests: [],
      });

      const newer = insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.other.id,
        createdAt: fixture.joinedAt + 4_000,
      });
      await expect(fetchUnread(fixture)).resolves.toEqual({
        tavern: 1,
        quests: [],
      });

      // A stale cursor never rewinds the read position.
      const stale = await markRead(fixture, {
        questId: null,
        messageId: first.id,
      });
      expect(stale.statusCode).toBe(204);

      const cursor = fixture.test.db
        .select()
        .from(readCursors)
        .where(
          and(
            eq(readCursors.userId, fixture.reader.id),
            eq(readCursors.projectId, fixture.project.id),
            eq(readCursors.threadQuestId, 0),
          ),
        )
        .get();
      expect(cursor?.lastReadMessageId).toBe(last.id);
      await expect(fetchUnread(fixture)).resolves.toEqual({
        tavern: 1,
        quests: [],
      });

      await markRead(fixture, { questId: null, messageId: newer.id });
      await expect(fetchUnread(fixture)).resolves.toEqual({
        tavern: 0,
        quests: [],
      });
    } finally {
      await fixture.test.close();
    }
  });

  it("lists requested, fought-in and authored party rooms", async () => {
    const fixture = await createUnreadFixture();
    try {
      const now = fixture.joinedAt + 10_000;

      const requested = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.reader.id,
      });
      const joinedQuest = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.owner.id,
      });
      addPartyMember(fixture.test.db, joinedQuest.id, fixture.reader.id, "joined");
      const doneQuest = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.owner.id,
      });
      addPartyMember(fixture.test.db, doneQuest.id, fixture.reader.id, "done");
      const retreatedQuest = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.owner.id,
      });
      addPartyMember(
        fixture.test.db,
        retreatedQuest.id,
        fixture.reader.id,
        "retreated",
      );
      const authored = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.owner.id,
      });
      const archived = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.reader.id,
        stage: "archived",
      });
      insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.owner.id,
      });
      const empty = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.reader.id,
      });

      const message = (
        questId: number,
        authorUserId: number,
        sequence: number,
      ): MessageRow =>
        insertMessage(fixture.test.db, {
          projectId: fixture.project.id,
          questId,
          authorUserId,
          createdAt: now + sequence,
        });

      // Requested: own messages and deleted rows are not unread.
      message(requested.id, fixture.other.id, 1);
      message(requested.id, fixture.other.id, 2);
      message(requested.id, fixture.reader.id, 3);
      insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: requested.id,
        authorUserId: fixture.other.id,
        createdAt: now + 4,
        deletedAt: now + 5,
      });

      message(joinedQuest.id, fixture.other.id, 6);
      message(doneQuest.id, fixture.other.id, 7);
      message(retreatedQuest.id, fixture.other.id, 8);
      message(retreatedQuest.id, fixture.other.id, 9);

      // Authored: the reader once wrote here; other messages count.
      message(authored.id, fixture.reader.id, 10);
      message(authored.id, fixture.other.id, 11);
      message(authored.id, fixture.other.id, 12);

      message(archived.id, fixture.other.id, 13);
      message(archived.id, fixture.other.id, 14);

      await expect(fetchUnread(fixture)).resolves.toEqual({
        tavern: 0,
        quests: [
          { questId: requested.id, count: 2 },
          { questId: joinedQuest.id, count: 1 },
          { questId: doneQuest.id, count: 1 },
          { questId: authored.id, count: 2 },
        ],
      });

      // The empty requested quest has no unread row, so it is omitted.
      expect(empty.id).toBeGreaterThan(0);
    } finally {
      await fixture.test.close();
    }
  });

  it("rejects a message id that belongs to another thread", async () => {
    const fixture = await createUnreadFixture();
    try {
      const firstQuest = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.owner.id,
      });
      const secondQuest = insertQuest(fixture.test.db, {
        projectId: fixture.project.id,
        createdBy: fixture.owner.id,
      });

      const tavernMessage = insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: null,
        authorUserId: fixture.other.id,
        createdAt: fixture.joinedAt + 1_000,
      });
      const firstMessage = insertMessage(fixture.test.db, {
        projectId: fixture.project.id,
        questId: firstQuest.id,
        authorUserId: fixture.other.id,
        createdAt: fixture.joinedAt + 2_000,
      });

      const cases = [
        { questId: firstQuest.id, messageId: tavernMessage.id },
        { questId: null, messageId: firstMessage.id },
        { questId: secondQuest.id, messageId: firstMessage.id },
        { questId: null, messageId: 999_999 },
      ];
      for (const payload of cases) {
        const response = await markRead(fixture, payload);
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("VALIDATION_ERROR");
      }

      // A quest of another guild is not visible here at all.
      const foreignOwner = createUser(fixture.test.db, {
        loginId: "unread.foreign",
      });
      const foreignProject = createProject(fixture.test.db, {
        ownerId: foreignOwner.id,
      });
      const foreignQuest = insertQuest(fixture.test.db, {
        projectId: foreignProject.id,
        createdBy: foreignOwner.id,
      });
      const foreign = await markRead(fixture, {
        questId: foreignQuest.id,
        messageId: tavernMessage.id,
      });
      expect(foreign.statusCode).toBe(404);
      expect(foreign.json().error.code).toBe("NOT_FOUND");

      // A message from another guild never matches this thread.
      const foreignMessage = insertMessage(fixture.test.db, {
        projectId: foreignProject.id,
        questId: null,
        authorUserId: foreignOwner.id,
        createdAt: fixture.joinedAt + 3_000,
      });
      const foreignMessageResponse = await markRead(fixture, {
        questId: null,
        messageId: foreignMessage.id,
      });
      expect(foreignMessageResponse.statusCode).toBe(400);
      expect(foreignMessageResponse.json().error.code).toBe("VALIDATION_ERROR");

      // Non-members cannot read or mark the guild either.
      const outsiderRead = await markRead(
        fixture,
        { questId: null, messageId: tavernMessage.id },
        fixture.outsiderCookie,
      );
      expect(outsiderRead.statusCode).toBe(404);
      expect(outsiderRead.json().error.code).toBe("NOT_FOUND");

      const outsiderUnread = await fixture.test.app.inject({
        method: "GET",
        url: `/api/projects/${fixture.project.id}/chat/unread`,
        headers: { cookie: fixture.outsiderCookie },
      });
      expect(outsiderUnread.statusCode).toBe(404);
    } finally {
      await fixture.test.close();
    }
  });

  it("only counts quest rooms in the requested project", async () => {
    const fixture = await createUnreadFixture();
    try {
      const foreignOwner = createUser(fixture.test.db, {
        loginId: "unread.owner2",
      });
      const foreignProject = createProject(fixture.test.db, {
        ownerId: foreignOwner.id,
      });
      addMember(fixture.test.db, foreignProject.id, fixture.reader.id);

      const foreignQuest = insertQuest(fixture.test.db, {
        projectId: foreignProject.id,
        createdBy: fixture.reader.id,
      });
      insertMessage(fixture.test.db, {
        projectId: foreignProject.id,
        questId: foreignQuest.id,
        authorUserId: foreignOwner.id,
        createdAt: fixture.joinedAt + 1_000,
      });

      await expect(fetchUnread(fixture)).resolves.toEqual({
        tavern: 0,
        quests: [],
      });
    } finally {
      await fixture.test.close();
    }
  });
});
