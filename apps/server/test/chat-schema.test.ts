/**
 * M2b chat schema tests.
 *
 * Migration `0003` adds the guild chat tables: `messages` (the tavern and quest
 * party rooms) and `read_cursors` (per user/thread read markers). Every test
 * opens a brand new in-memory database, so the assertions run against the real
 * migration output rather than the TypeScript table definitions.
 */
import { readdirSync } from "node:fs";

import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { openDb, type AppDb } from "../src/db/index.js";
import {
  messages,
  projects,
  quests,
  readCursors,
  users,
} from "../src/db/schema.js";

/** `PRAGMA table_info` row. */
interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/** `PRAGMA foreign_key_list` row. */
interface ForeignKeyInfo {
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
}

/** `PRAGMA index_list` row. */
interface IndexInfo {
  name: string;
  unique: number;
}

function tableNames(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function columns(sqlite: Database.Database, table: string): ColumnInfo[] {
  return sqlite.prepare(`PRAGMA table_info('${table}')`).all() as ColumnInfo[];
}

function column(
  sqlite: Database.Database,
  table: string,
  name: string,
): ColumnInfo {
  const found = columns(sqlite, table).find((entry) => entry.name === name);
  if (!found) {
    throw new Error(`missing column ${table}.${name}`);
  }
  return found;
}

/** Declared type of one column, lowercased (`sqlite` reports it uppercase). */
function columnType(
  sqlite: Database.Database,
  table: string,
  name: string,
): string {
  return column(sqlite, table, name).type.toLowerCase();
}

function foreignKeys(
  sqlite: Database.Database,
  table: string,
): ForeignKeyInfo[] {
  return sqlite
    .prepare(`PRAGMA foreign_key_list('${table}')`)
    .all() as ForeignKeyInfo[];
}

/** The declared foreign key of one column, normalized to lowercase actions. */
function foreignKey(
  sqlite: Database.Database,
  table: string,
  from: string,
): (ForeignKeyInfo & { on_update: string; on_delete: string }) | null {
  const found = foreignKeys(sqlite, table).find((entry) => entry.from === from);
  if (!found) {
    return null;
  }
  return {
    ...found,
    on_update: found.on_update.toLowerCase(),
    on_delete: found.on_delete.toLowerCase(),
  };
}

function indexes(sqlite: Database.Database, table: string): IndexInfo[] {
  return sqlite
    .prepare(`PRAGMA index_list('${table}')`)
    .all() as IndexInfo[];
}

/** Column names of `indexName` in index order. */
function indexColumns(sqlite: Database.Database, indexName: string): string[] {
  return (
    sqlite.prepare(`PRAGMA index_info('${indexName}')`).all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

/** Insert the minimum rows (user, project, quests) the chat tables reference. */
function seed(db: AppDb) {
  const now = 1_700_000_000_000;
  const author = db
    .insert(users)
    .values({
      loginId: "chat.author",
      displayName: "김철수",
      passwordHash: "scrypt$stub$stub",
      xp: 0,
      createdAt: now,
    })
    .returning()
    .get();
  const reader = db
    .insert(users)
    .values({
      loginId: "chat.reader",
      displayName: "이영희",
      passwordHash: "scrypt$stub$stub",
      xp: 0,
      createdAt: now,
    })
    .returning()
    .get();
  const project = db
    .insert(projects)
    .values({ name: "채팅 길드", nextQuestNumber: 3, createdAt: now })
    .returning()
    .get();
  const quest = db
    .insert(quests)
    .values({
      projectId: project.id,
      number: 1,
      title: "파티 채팅",
      orderKey: "a0",
      createdBy: author.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const otherQuest = db
    .insert(quests)
    .values({
      projectId: project.id,
      number: 2,
      title: "의뢰로 승격",
      orderKey: "a1",
      createdBy: author.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return { author, reader, project, quest, otherQuest, now };
}

describe("chat schema (migration 0003)", () => {
  it("migrates a fresh database and creates both chat tables", () => {
    const { sqlite, close } = openDb(":memory:");
    try {
      const names = tableNames(sqlite);
      expect(names).toContain("messages");
      expect(names).toContain("read_cursors");
    } finally {
      close();
    }
  });

  it("ships the generated 0003 migration file", () => {
    const files = readdirSync(new URL("../drizzle/", import.meta.url));
    expect(
      files.filter((name) => name.startsWith("0003_") && name.endsWith(".sql")),
    ).toHaveLength(1);
  });

  it("defines every messages column with the documented nullability", () => {
    const { sqlite, close } = openDb(":memory:");
    try {
      expect(columns(sqlite, "messages").map((entry) => entry.name)).toEqual([
        "id",
        "project_id",
        "quest_id",
        "kind",
        "author_user_id",
        "familiar_id",
        "body",
        "payload",
        "promoted_quest_id",
        "created_at",
        "deleted_at",
      ]);

      expect(column(sqlite, "messages", "id")).toMatchObject({
        notnull: 1,
        pk: 1,
      });
      expect(columnType(sqlite, "messages", "id")).toBe("integer");

      // Required message text and timestamps.
      for (const name of ["project_id", "kind", "body", "created_at"]) {
        expect(column(sqlite, "messages", name).notnull).toBe(1);
      }

      // The tavern (quest_id NULL), the reserved familiar, the optional payload,
      // the promotion link and the soft delete are all nullable.
      for (const name of [
        "quest_id",
        "author_user_id",
        "familiar_id",
        "payload",
        "promoted_quest_id",
        "deleted_at",
      ]) {
        expect(column(sqlite, "messages", name).notnull).toBe(0);
      }

      expect(columnType(sqlite, "messages", "created_at")).toBe("integer");
      expect(columnType(sqlite, "messages", "deleted_at")).toBe("integer");
      expect(columnType(sqlite, "messages", "body")).toBe("text");
      expect(columnType(sqlite, "messages", "payload")).toBe("text");
      expect(columnType(sqlite, "messages", "kind")).toBe("text");
    } finally {
      close();
    }
  });

  it("indexes messages by (project_id, quest_id, id)", () => {
    const { sqlite, close } = openDb(":memory:");
    try {
      const entry = indexes(sqlite, "messages").find(
        (info) => info.name === "messages_project_quest_id_idx",
      );
      expect(entry).toBeDefined();
      expect(entry?.unique).toBe(0);
      expect(indexColumns(sqlite, "messages_project_quest_id_idx")).toEqual([
        "project_id",
        "quest_id",
        "id",
      ]);
    } finally {
      close();
    }
  });

  it("defines the read_cursors columns and composite primary key order", () => {
    const { sqlite, close } = openDb(":memory:");
    try {
      expect(
        columns(sqlite, "read_cursors").map((entry) => entry.name),
      ).toEqual([
        "user_id",
        "project_id",
        "thread_quest_id",
        "last_read_message_id",
        "updated_at",
      ]);

      const primaryKey = columns(sqlite, "read_cursors")
        .filter((entry) => entry.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((entry) => entry.name);
      expect(primaryKey).toEqual([
        "user_id",
        "project_id",
        "thread_quest_id",
      ]);

      for (const name of [
        "user_id",
        "project_id",
        "thread_quest_id",
        "last_read_message_id",
        "updated_at",
      ]) {
        expect(column(sqlite, "read_cursors", name).notnull).toBe(1);
      }
      expect(columnType(sqlite, "read_cursors", "updated_at")).toBe("integer");
    } finally {
      close();
    }
  });

  it("defaults the tavern thread and the read position to 0", () => {
    const { db, sqlite, close } = openDb(":memory:");
    try {
      expect(column(sqlite, "read_cursors", "thread_quest_id").dflt_value).toBe(
        "0",
      );
      expect(
        column(sqlite, "read_cursors", "last_read_message_id").dflt_value,
      ).toBe("0");

      const { author, project, now } = seed(db);
      const rows = db
        .insert(readCursors)
        .values({
          userId: author.id,
          projectId: project.id,
          updatedAt: now,
        })
        .returning()
        .get();

      expect(rows.threadQuestId).toBe(0);
      expect(rows.lastReadMessageId).toBe(0);
    } finally {
      close();
    }
  });

  it("declares the messages foreign keys", () => {
    const { sqlite, close } = openDb(":memory:");
    try {
      const keys = foreignKeys(sqlite, "messages");
      expect(keys.map((key) => key.from).sort()).toEqual([
        "author_user_id",
        "project_id",
        "promoted_quest_id",
        "quest_id",
      ]);

      expect(foreignKey(sqlite, "messages", "project_id")).toMatchObject({
        table: "projects",
        to: "id",
        on_delete: "cascade",
      });
      expect(foreignKey(sqlite, "messages", "quest_id")).toMatchObject({
        table: "quests",
        to: "id",
        on_delete: "cascade",
      });
      expect(foreignKey(sqlite, "messages", "author_user_id")).toMatchObject({
        table: "users",
        to: "id",
        on_delete: "set null",
      });
      expect(foreignKey(sqlite, "messages", "promoted_quest_id")).toMatchObject(
        {
          table: "quests",
          to: "id",
          on_delete: "set null",
        },
      );

      // Reserved for M4 familiars: intentionally no foreign key.
      expect(foreignKey(sqlite, "messages", "familiar_id")).toBeNull();
    } finally {
      close();
    }
  });

  it("declares the read_cursors foreign keys", () => {
    const { sqlite, close } = openDb(":memory:");
    try {
      expect(
        foreignKeys(sqlite, "read_cursors").map((key) => key.from).sort(),
      ).toEqual(["project_id", "user_id"]);
      expect(foreignKey(sqlite, "read_cursors", "user_id")).toMatchObject({
        table: "users",
        to: "id",
        on_delete: "cascade",
      });
      expect(foreignKey(sqlite, "read_cursors", "project_id")).toMatchObject({
        table: "projects",
        to: "id",
        on_delete: "cascade",
      });
      // thread_quest_id is 0 for the tavern, so it has no foreign key.
      expect(foreignKey(sqlite, "read_cursors", "thread_quest_id")).toBeNull();
    } finally {
      close();
    }
  });

  it("stores a tavern message and a quest room message", () => {
    const { db, close } = openDb(":memory:");
    try {
      const { author, project, quest, otherQuest, now } = seed(db);

      const tavern = db
        .insert(messages)
        .values({
          projectId: project.id,
          questId: null,
          kind: "user",
          authorUserId: author.id,
          body: `안녕 <@${author.id}>`,
          createdAt: now,
        })
        .returning()
        .get();
      expect(tavern.id).toBeGreaterThan(0);
      expect(tavern.questId).toBeNull();
      expect(tavern.familiarId).toBeNull();
      expect(tavern.payload).toBeNull();
      expect(tavern.promotedQuestId).toBeNull();
      expect(tavern.deletedAt).toBeNull();
      expect(tavern.kind).toBe("user");

      const system = db
        .insert(messages)
        .values({
          projectId: project.id,
          questId: quest.id,
          kind: "system",
          authorUserId: author.id,
          body: "",
          payload: JSON.stringify({ type: "promoted", questId: otherQuest.id }),
          promotedQuestId: otherQuest.id,
          createdAt: now,
        })
        .returning()
        .get();
      expect(system.questId).toBe(quest.id);
      expect(JSON.parse(system.payload ?? "")).toEqual({
        type: "promoted",
        questId: otherQuest.id,
      });
      expect(system.promotedQuestId).toBe(otherQuest.id);
    } finally {
      close();
    }
  });

  it("cascades messages when their project or quest is deleted", () => {
    const { db, close } = openDb(":memory:");
    try {
      const { author, project, quest, now } = seed(db);
      db.insert(messages)
        .values({
          projectId: project.id,
          questId: quest.id,
          kind: "user",
          authorUserId: author.id,
          body: "의뢰방 메시지",
          createdAt: now,
        })
        .run();

      db.delete(quests).where(eq(quests.id, quest.id)).run();
      expect(db.select().from(messages).all()).toHaveLength(0);

      db.insert(messages)
        .values({
          projectId: project.id,
          questId: null,
          kind: "user",
          authorUserId: author.id,
          body: "여관 메시지",
          createdAt: now,
        })
        .run();

      db.delete(projects).where(eq(projects.id, project.id)).run();
      expect(db.select().from(messages).all()).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("keeps messages when an author leaves and nulls the promotion link", () => {
    const { db, close } = openDb(":memory:");
    try {
      const { reader, project, otherQuest, now } = seed(db);
      const row = db
        .insert(messages)
        .values({
          projectId: project.id,
          questId: null,
          kind: "system",
          authorUserId: reader.id,
          body: "",
          promotedQuestId: otherQuest.id,
          createdAt: now,
        })
        .returning()
        .get();

      db.delete(users).where(eq(users.id, reader.id)).run();
      const afterAuthorDelete = db.select().from(messages).all();
      expect(afterAuthorDelete).toHaveLength(1);
      expect(afterAuthorDelete[0]?.id).toBe(row.id);
      expect(afterAuthorDelete[0]?.authorUserId).toBeNull();

      db.delete(quests).where(eq(quests.id, otherQuest.id)).run();
      const afterQuestDelete = db.select().from(messages).all();
      expect(afterQuestDelete).toHaveLength(1);
      expect(afterQuestDelete[0]?.promotedQuestId).toBeNull();
    } finally {
      close();
    }
  });

  it("keeps one read cursor per user, project and thread", () => {
    const { db, close } = openDb(":memory:");
    try {
      const { reader, project, quest, now } = seed(db);
      const cursor = {
        userId: reader.id,
        projectId: project.id,
        threadQuestId: 0,
        lastReadMessageId: 7,
        updatedAt: now,
      };

      db.insert(readCursors).values(cursor).run();
      expect(() => db.insert(readCursors).values(cursor).run()).toThrow(
        /UNIQUE constraint failed/,
      );

      // The same user keeps a separate cursor per quest room.
      expect(() =>
        db
          .insert(readCursors)
          .values({ ...cursor, threadQuestId: quest.id, lastReadMessageId: 3 })
          .run(),
      ).not.toThrow();
      expect(db.select().from(readCursors).all()).toHaveLength(2);
    } finally {
      close();
    }
  });

  it("cascades read cursors when their user or project is deleted", () => {
    const { db, close } = openDb(":memory:");
    try {
      const { author, reader, project, now } = seed(db);

      db.insert(readCursors)
        .values([
          { userId: author.id, projectId: project.id, updatedAt: now },
          { userId: reader.id, projectId: project.id, updatedAt: now },
        ])
        .run();

      // The reader owns no quests, so the user cascade can be observed alone.
      db.delete(users).where(eq(users.id, reader.id)).run();
      expect(db.select().from(readCursors).all()).toHaveLength(1);

      db.delete(projects).where(eq(projects.id, project.id)).run();
      expect(db.select().from(readCursors).all()).toHaveLength(0);
    } finally {
      close();
    }
  });
});
