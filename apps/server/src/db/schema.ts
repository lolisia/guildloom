/**
 * guildloom M1 database schema (SQLite via Drizzle ORM).
 *
 * Conventions:
 * - ids are integer autoincrement primary keys unless the table needs an
 *   opaque identifier (`sessions.id`);
 * - timestamps are integer epoch milliseconds (`mode: "number"`);
 * - database column names are snake_case, TypeScript property names camelCase;
 * - JSON payloads are stored as text and serialized by the caller so the
 *   stored representation stays explicit.
 *
 * This file and `apps/server/drizzle/` are owned by a single task. Other
 * modules never issue DDL or raw SQL; they go through the Drizzle schema.
 */
import { RANKS, STAGES } from "@guildloom/shared";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Adventurer accounts. `login_id` is stored lowercase. */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loginId: text("login_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  xp: integer("xp").notNull().default(0),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

/** Server-side login sessions. `id` is 32 random bytes base64url encoded. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
  },
  (table) => [index("sessions_expires_at_idx").on(table.expiresAt)],
);

/** Guilds (projects). */
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  nextQuestNumber: integer("next_quest_number").notNull().default(1),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

/** Membership of an adventurer in a guild. */
export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    joinedAt: integer("joined_at", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_members_user_id_idx").on(table.userId),
  ],
);

/** Reusable guild invite links. `code` is 16 random bytes base64url encoded. */
export const invites = sqliteTable(
  "invites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("invites_code_idx").on(table.code),
    index("invites_project_id_idx").on(table.projectId),
  ],
);

/** Quests (issues) belonging to a guild. */
export const quests = sqliteTable(
  "quests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    situation: text("situation").notNull().default(""),
    direction: text("direction").notNull().default(""),
    stage: text("stage", { enum: STAGES }).notNull().default("board"),
    rank: text("rank", { enum: RANKS }),
    orderKey: text("order_key").notNull(),
    archiveReason: text("archive_reason"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    unique("quests_project_id_number_unique").on(table.projectId, table.number),
    index("quests_project_stage_order_idx").on(
      table.projectId,
      table.stage,
      table.orderKey,
    ),
  ],
);

/** Per-guild free-form tags attached to quests. */
export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (table) => [unique("tags_project_id_name_unique").on(table.projectId, table.name)],
);

/** Quest <-> tag join table. */
export const questTags = sqliteTable(
  "quest_tags",
  {
    questId: integer("quest_id")
      .notNull()
      .references(() => quests.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.questId, table.tagId] }),
    index("quest_tags_tag_id_idx").on(table.tagId),
  ],
);

/** Append-only quest event log. `payload` is a JSON string. */
export const questEvents = sqliteTable(
  "quest_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    questId: integer("quest_id")
      .notNull()
      .references(() => quests.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
    actorUserId: integer("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Reserved for M4 familiars; intentionally no foreign key.
    familiarId: integer("familiar_id"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [index("quest_events_quest_id_idx").on(table.questId)],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type QuestRow = typeof quests.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type QuestTagRow = typeof questTags.$inferSelect;
export type QuestEventRow = typeof questEvents.$inferSelect;
