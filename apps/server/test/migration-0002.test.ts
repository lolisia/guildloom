/**
 * Migration `0002` tests.
 *
 * The migration adds `quests.kind`/`quests.clear_round` and the `quest_refs`
 * table, migrates every dungeon floor into a Markdown checklist line on
 * `quests.direction` (in `order_key` order) and only then drops `quest_floors`.
 *
 * The test applies the raw SQL to a better-sqlite3 database instead of using
 * the migrator so it can seed `quest_floors` rows between `0001` and `0002`.
 */
import { readFileSync, readdirSync } from "node:fs";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const drizzleDir = new URL("../drizzle/", import.meta.url);

/** Read a migration SQL file by its numeric prefix (`0000`, `0001`, ...). */
function migrationSql(prefix: string): string {
  const file = readdirSync(drizzleDir).find(
    (name) => name.startsWith(`${prefix}_`) && name.endsWith(".sql"),
  );
  if (!file) {
    throw new Error(`missing migration ${prefix}`);
  }
  return readFileSync(new URL(file, drizzleDir), "utf8");
}

/** Apply a drizzle migration file, splitting on its statement breakpoints. */
function applyMigration(db: Database.Database, sql: string): void {
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      db.exec(trimmed);
    }
  }
}

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function columnNames(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

function indexNames(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA index_list('${table}')`).all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

/** Seed a user, a project and the quests/floors the migration must migrate. */
function seed(db: Database.Database): void {
  const now = 1_700_000_000_000;

  db.prepare(
    "INSERT INTO users (login_id, display_name, password_hash, xp, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run("mig.owner", "의뢰인", "scrypt$stub$stub", 0, now);
  db.prepare(
    "INSERT INTO projects (name, next_quest_number, created_at) VALUES (?, ?, ?)",
  ).run("이관 길드", 3, now);

  const insertQuest = db.prepare(
    `INSERT INTO quests
       (project_id, number, title, situation, direction, stage, rank, order_key, created_by, created_at, updated_at)
     VALUES (1, ?, ?, '', ?, 'board', NULL, ?, 1, ?, ?)`,
  );
  insertQuest.run(1, "빈 방향", "", "a0", now, now);
  insertQuest.run(2, "기존 방향", "기존 방향", "a1", now, now);
  insertQuest.run(3, "층 없음", "", "a2", now, now);

  const insertFloor = db.prepare(
    `INSERT INTO quest_floors
       (quest_id, title, order_key, done_at, done_by, created_by, created_at)
     VALUES (?, ?, ?, ?, NULL, 1, ?)`,
  );
  // Inserted out of order on purpose: the migration must sort by order_key.
  insertFloor.run(1, "2층", "a1", now, now);
  insertFloor.run(1, "1층", "a0", null, now);
  insertFloor.run(2, "3층", "a0", now, now);
}

let sqlite: Database.Database | null = null;

afterEach(() => {
  sqlite?.close();
  sqlite = null;
});

describe("migration 0002", () => {
  it("migrates floors into direction checklists, then drops quest_floors", () => {
    sqlite = new Database(":memory:");
    const db = sqlite;

    applyMigration(db, migrationSql("0000"));
    applyMigration(db, migrationSql("0001"));
    seed(db);

    applyMigration(db, migrationSql("0002"));

    const directions = db
      .prepare("SELECT id, direction FROM quests ORDER BY id")
      .all() as Array<{ id: number; direction: string }>;

    // Empty direction: the checklist starts at the very beginning.
    expect(directions.find((row) => row.id === 1)?.direction).toBe(
      "- [ ] 1층\n- [x] 2층",
    );
    // Existing text is preserved and separated by exactly one newline.
    expect(directions.find((row) => row.id === 2)?.direction).toBe(
      "기존 방향\n- [x] 3층",
    );
    // A quest without floors keeps its direction.
    expect(directions.find((row) => row.id === 3)?.direction).toBe("");

    // The old table and its index are gone.
    const tables = tableNames(db);
    expect(tables).not.toContain("quest_floors");
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'quest_floors_quest_order_idx'",
        )
        .get(),
    ).toBeUndefined();

    // The new table, its columns, index and defaults exist.
    expect(tables).toContain("quest_refs");
    expect(columnNames(db, "quest_refs")).toEqual([
      "id",
      "quest_id",
      "label",
      "target",
      "created_by",
      "created_at",
    ]);
    expect(indexNames(db, "quest_refs")).toContain(
      "quest_refs_quest_id_id_idx",
    );

    const quests = db
      .prepare("SELECT kind, clear_round FROM quests ORDER BY id")
      .all() as Array<{ kind: string; clear_round: number }>;
    expect(quests).toEqual([
      { kind: "fix", clear_round: 0 },
      { kind: "fix", clear_round: 0 },
      { kind: "fix", clear_round: 0 },
    ]);
  });
});
