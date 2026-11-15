/**
 * M2a schema tests.
 *
 * Migration `0001` must add the party, nomination, floor, XP ledger and
 * notification tables plus `quests.first_claimed_at`, with the indexes and the
 * unique idempotency key the party/settlement tasks rely on.
 */
import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { openDb, type AppDb } from "../src/db/index.js";
import {
  notifications,
  partyMembers,
  projects,
  questFloors,
  questNominations,
  quests,
  users,
  xpLedger,
} from "../src/db/schema.js";

const NEW_TABLES = [
  "notifications",
  "party_members",
  "quest_floors",
  "quest_nominations",
  "xp_ledger",
] as const;

function tableNames(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  )
    .map((row) => row.name)
    .sort();
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (
    sqlite.prepare(`PRAGMA table_info('${table}')`).all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

function indexNames(sqlite: Database.Database, table: string): string[] {
  return (
    sqlite.prepare(`PRAGMA index_list('${table}')`).all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

/** Column names of `indexName` in index order. */
function indexColumns(sqlite: Database.Database, indexName: string): string[] {
  return (
    sqlite.prepare(`PRAGMA index_info('${indexName}')`).all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

/** Insert the minimum rows (user, project, quest) the new tables reference. */
function seed(db: AppDb) {
  const now = Date.now();
  const owner = db
    .insert(users)
    .values({
      loginId: "schema.owner",
      displayName: "김철수",
      passwordHash: "scrypt$stub$stub",
      xp: 0,
      createdAt: now,
    })
    .returning()
    .get();
  const member = db
    .insert(users)
    .values({
      loginId: "schema.member",
      displayName: "이영희",
      passwordHash: "scrypt$stub$stub",
      xp: 0,
      createdAt: now,
    })
    .returning()
    .get();
  const project = db
    .insert(projects)
    .values({ name: "스키마 길드", nextQuestNumber: 2, createdAt: now })
    .returning()
    .get();
  const quest = db
    .insert(quests)
    .values({
      projectId: project.id,
      number: 1,
      title: "파티 스키마",
      orderKey: "a0",
      createdBy: owner.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return { owner, member, project, quest, now };
}

describe("migration 0001", () => {
  it("creates the M2a tables", () => {
    const { sqlite, close } = openDb(":memory:");
    try {
      const names = tableNames(sqlite);
      for (const table of NEW_TABLES) {
        expect(names).toContain(table);
      }
    } finally {
      close();
    }
  });

  it("adds quests.first_claimed_at as a nullable integer", () => {
    const { sqlite, close } = openDb(":memory:");
    try {
      const column = (
        sqlite.prepare("PRAGMA table_info('quests')").all() as Array<{
          name: string;
          type: string;
          notnull: number;
        }>
      ).find((entry) => entry.name === "first_claimed_at");

      expect(column).toBeDefined();
      expect(column?.type.toLowerCase()).toBe("integer");
      expect(column?.notnull).toBe(0);
    } finally {
      close();
    }
  });

  it("defines every documented column", () => {
    const { sqlite, close } = openDb(":memory:");
    try {
      expect(columnNames(sqlite, "party_members")).toEqual([
        "quest_id",
        "user_id",
        "role",
        "status",
        "retreat_reason",
        "joined_at",
        "updated_at",
      ]);
      expect(columnNames(sqlite, "quest_nominations")).toEqual([
        "id",
        "quest_id",
        "project_id",
        "nominee_id",
        "nominated_by",
        "kind",
        "state",
        "pass_reason",
        "relay_from_nomination_id",
        "created_at",
        "resolved_at",
      ]);
      expect(columnNames(sqlite, "quest_floors")).toEqual([
        "id",
        "quest_id",
        "title",
        "order_key",
        "done_at",
        "done_by",
        "created_by",
        "created_at",
      ]);
      expect(columnNames(sqlite, "xp_ledger")).toEqual([
        "id",
        "user_id",
        "project_id",
        "quest_id",
        "reason",
        "amount",
        "idem_key",
        "created_at",
      ]);
      expect(columnNames(sqlite, "notifications")).toEqual([
        "id",
        "user_id",
        "project_id",
        "quest_id",
        "type",
        "actor_user_id",
        "payload",
        "created_at",
        "read_at",
      ]);
    } finally {
      close();
    }
  });

  it("creates the nomination and notification lookup indexes", () => {
    const { sqlite, close } = openDb(":memory:");
    try {
      const nominationIndexes = indexNames(sqlite, "quest_nominations");
      expect(nominationIndexes).toContain(
        "quest_nominations_nominee_state_idx",
      );
      expect(nominationIndexes).toContain("quest_nominations_quest_state_idx");
      expect(
        indexColumns(sqlite, "quest_nominations_nominee_state_idx"),
      ).toEqual(["nominee_id", "state"]);
      expect(
        indexColumns(sqlite, "quest_nominations_quest_state_idx"),
      ).toEqual(["quest_id", "state"]);

      expect(indexNames(sqlite, "notifications")).toContain(
        "notifications_user_read_idx",
      );
      expect(indexColumns(sqlite, "notifications_user_read_idx")).toEqual([
        "user_id",
        "read_at",
      ]);
    } finally {
      close();
    }
  });

  it("enforces a unique xp_ledger.idem_key", () => {
    const { db, close } = openDb(":memory:");
    try {
      const { owner, project } = seed(db);
      const award = {
        userId: owner.id,
        projectId: project.id,
        questId: null,
        reason: "clear" as const,
        amount: 40,
        idemKey: "clear:1:1",
        createdAt: Date.now(),
      };

      db.insert(xpLedger).values(award).run();

      expect(() => db.insert(xpLedger).values(award).run()).toThrow(
        /UNIQUE constraint failed/,
      );

      // A different idempotency key is fine.
      expect(() =>
        db
          .insert(xpLedger)
          .values({ ...award, idemKey: "clear:1:2", amount: 20 })
          .run(),
      ).not.toThrow();
    } finally {
      close();
    }
  });

  it("keeps one party row per quest and user", () => {
    const { db, close } = openDb(":memory:");
    try {
      const { owner, quest, now } = seed(db);
      const row = {
        questId: quest.id,
        userId: owner.id,
        role: "leader" as const,
        status: "joined" as const,
        retreatReason: null,
        joinedAt: now,
        updatedAt: now,
      };

      db.insert(partyMembers).values(row).run();

      expect(() => db.insert(partyMembers).values(row).run()).toThrow(
        /UNIQUE constraint failed/,
      );

      // The same user may join a different quest.
      const otherQuest = db
        .insert(quests)
        .values({
          projectId: quest.projectId,
          number: 2,
          title: "다른 의뢰",
          orderKey: "a1",
          createdBy: owner.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      expect(() =>
        db
          .insert(partyMembers)
          .values({ ...row, questId: otherQuest.id })
          .run(),
      ).not.toThrow();
    } finally {
      close();
    }
  });

  it("cascades party, nomination and floor rows when a quest is deleted", () => {
    const { db, close } = openDb(":memory:");
    try {
      const { owner, member, project, quest, now } = seed(db);

      db.insert(partyMembers)
        .values({
          questId: quest.id,
          userId: owner.id,
          role: "leader",
          status: "fighting",
          retreatReason: null,
          joinedAt: now,
          updatedAt: now,
        })
        .run();
      db.insert(questNominations)
        .values({
          questId: quest.id,
          projectId: project.id,
          nomineeId: member.id,
          nominatedBy: owner.id,
          kind: "nominate",
          state: "pending",
          passReason: null,
          relayFromNominationId: null,
          createdAt: now,
          resolvedAt: null,
        })
        .run();
      db.insert(questFloors)
        .values({
          questId: quest.id,
          title: "1층: 스키마",
          orderKey: "a0",
          doneAt: null,
          doneBy: null,
          createdBy: owner.id,
          createdAt: now,
        })
        .run();

      db.delete(quests).where(eq(quests.id, quest.id)).run();

      expect(db.select().from(partyMembers).all()).toHaveLength(0);
      expect(db.select().from(questNominations).all()).toHaveLength(0);
      expect(db.select().from(questFloors).all()).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("stores notification payloads as JSON text and defaults to unread", () => {
    const { db, close } = openDb(":memory:");
    try {
      const { owner, member, project, quest, now } = seed(db);
      const row = db
        .insert(notifications)
        .values({
          userId: member.id,
          projectId: project.id,
          questId: quest.id,
          type: "nominated",
          actorUserId: owner.id,
          payload: JSON.stringify({ userIds: [member.id] }),
          createdAt: now,
        })
        .returning()
        .get();

      expect(row.readAt).toBeNull();
      expect(JSON.parse(row.payload)).toEqual({ userIds: [member.id] });
    } finally {
      close();
    }
  });
});
