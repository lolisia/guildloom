/**
 * Shared helpers for server tests.
 *
 * Each `createTestApp()` call builds an isolated in-memory SQLite database with
 * all migrations applied and a `buildApp()` Fastify instance that can be used
 * through `app.inject()`.
 */
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type { ProjectRole } from "@guildloom/shared";

import { buildApp } from "../src/app.js";
import { openDb, type AppDb } from "../src/db/index.js";
import {
  projectMembers,
  projects,
  users,
  type ProjectMemberRow,
  type ProjectRow,
  type UserRow,
} from "../src/db/schema.js";
import { SESSION_COOKIE, createSession } from "../src/lib/auth.js";
import { hashPassword } from "../src/lib/password.js";

/** Password used by {@link createUser} when none is given. */
export const DEFAULT_TEST_PASSWORD = "password123";

/** A running test app plus its database handles. */
export interface TestApp {
  app: FastifyInstance;
  db: AppDb;
  sqlite: Database.Database;
  close(): Promise<void>;
}

/** Options for {@link createTestApp}. */
export interface CreateTestAppOptions {
  /**
   * Attach the Socket.IO realtime server (default: false).
   *
   * Most tests only use `app.inject()` and do not need websockets; the
   * realtime tests opt in explicitly.
   */
  realtime?: boolean;
}

/**
 * Build an app backed by a fresh `:memory:` database.
 *
 * `close()` shuts down Fastify first so in-flight handlers finish before the
 * SQLite connection is closed.
 */
export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<TestApp> {
  const { db, sqlite, close: closeDb } = openDb(":memory:");
  const app = await buildApp({ db, realtime: options.realtime ?? false });

  return {
    app,
    db,
    sqlite,
    async close() {
      await app.close();
      closeDb();
    },
  };
}

let userSequence = 0;

/** Insert an adventurer row with sensible unique defaults. */
export function createUser(
  db: AppDb,
  options: {
    loginId?: string;
    displayName?: string;
    password?: string;
    xp?: number;
  } = {},
): UserRow {
  userSequence += 1;
  const password = options.password ?? DEFAULT_TEST_PASSWORD;

  return db
    .insert(users)
    .values({
      loginId: options.loginId ?? `user${userSequence}`,
      displayName: options.displayName ?? `Adventurer ${userSequence}`,
      passwordHash: hashPassword(password),
      xp: options.xp ?? 0,
      createdAt: Date.now(),
    })
    .returning()
    .get();
}

let projectSequence = 0;

/** Insert a project and make `ownerId` its owner. */
export function createProject(
  db: AppDb,
  options: { name?: string; ownerId: number },
): ProjectRow {
  projectSequence += 1;
  const now = Date.now();

  const project = db
    .insert(projects)
    .values({
      name: options.name ?? `Guild ${projectSequence}`,
      nextQuestNumber: 1,
      createdAt: now,
    })
    .returning()
    .get();

  db.insert(projectMembers)
    .values({
      projectId: project.id,
      userId: options.ownerId,
      role: "owner",
      joinedAt: now,
    })
    .run();

  return project;
}

/** Add a user to a project (default role: member). */
export function addMember(
  db: AppDb,
  projectId: number,
  userId: number,
  role: ProjectRole = "member",
): ProjectMemberRow {
  return db
    .insert(projectMembers)
    .values({ projectId, userId, role, joinedAt: Date.now() })
    .returning()
    .get();
}

/** Create a session and return the `Cookie` header value for it. */
export function createSessionCookie(db: AppDb, userId: number): string {
  return `${SESSION_COOKIE}=${createSession(db, userId)}`;
}
