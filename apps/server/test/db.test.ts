/**
 * Database foundation tests: migrations, pragmas, constraints and session
 * storage. These pin the behaviour every later server task relies on.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildApp } from "../src/app.js";
import { openDb, type AppDb } from "../src/db/index.js";
import {
  projectMembers,
  projects,
  quests,
  sessions,
  tags,
  users,
  type ProjectRow,
  type UserRow,
} from "../src/db/schema.js";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  authenticate,
  createSession,
  getSessionUser,
  requireMembership,
  setSessionCookie,
} from "../src/lib/auth.js";
import { HttpError } from "../src/lib/errors.js";
import { hashPassword, verifyPassword } from "../src/lib/password.js";
import { toUserProfile } from "../src/lib/serialize.js";
import {
  createProject,
  createSessionCookie,
  createTestApp,
  createUser,
} from "./helpers.js";

const EXPECTED_TABLES = [
  "__drizzle_migrations",
  "invites",
  "project_members",
  "projects",
  "quest_events",
  "quest_tags",
  "quests",
  "sessions",
  "tags",
  "users",
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

function insertUser(db: AppDb, loginId = "tester"): UserRow {
  const now = Date.now();
  return db
    .insert(users)
    .values({
      loginId,
      displayName: "테스터",
      passwordHash: hashPassword("password123"),
      xp: 0,
      createdAt: now,
    })
    .returning()
    .get();
}

function insertProject(db: AppDb, name = "테스트 길드"): ProjectRow {
  return db
    .insert(projects)
    .values({ name, nextQuestNumber: 1, createdAt: Date.now() })
    .returning()
    .get();
}

describe("openDb", () => {
  it("applies migrations and returns db, sqlite and close", () => {
    const opened = openDb(":memory:");
    try {
      expect(opened.db).toBeDefined();
      expect(opened.sqlite.open).toBe(true);
      expect(typeof opened.close).toBe("function");

      const names = tableNames(opened.sqlite);
      for (const table of EXPECTED_TABLES) {
        expect(names).toContain(table);
      }
    } finally {
      opened.close();
      expect(opened.sqlite.open).toBe(false);
    }
  });

  it("enables foreign key enforcement", () => {
    const { sqlite, close } = openDb(":memory:");
    try {
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      close();
    }
  });

  it("uses WAL journaling for file-backed databases", () => {
    const dir = mkdtempSync(join(tmpdir(), "guildloom-db-"));
    const file = join(dir, "guildloom.db");
    const { sqlite, close } = openDb(file);

    try {
      expect(
        String(sqlite.pragma("journal_mode", { simple: true })).toLowerCase(),
      ).toBe("wal");
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("skips migrations when migrate is false", () => {
    const { sqlite, close } = openDb(":memory:", { migrate: false });
    try {
      expect(tableNames(sqlite)).not.toContain("users");
    } finally {
      close();
    }
  });
});

describe("schema constraints", () => {
  it("enforces unique quest numbers per project", () => {
    const { db, close } = openDb(":memory:");
    try {
      const user = insertUser(db);
      const project = insertProject(db);
      const now = Date.now();
      const quest = {
        projectId: project.id,
        number: 1,
        title: "첫 번째 의뢰",
        orderKey: "a0",
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      };

      db.insert(quests).values(quest).run();

      expect(() =>
        db
          .insert(quests)
          .values({ ...quest, title: "중복 번호", orderKey: "a1" })
          .run(),
      ).toThrow(/UNIQUE constraint failed/);

      // The same number is fine in another project.
      const otherProject = insertProject(db, "다른 길드");
      expect(() =>
        db
          .insert(quests)
          .values({ ...quest, projectId: otherProject.id })
          .run(),
      ).not.toThrow();
    } finally {
      close();
    }
  });

  it("enforces unique tag names per project", () => {
    const { db, close } = openDb(":memory:");
    try {
      const project = insertProject(db);
      const otherProject = insertProject(db, "다른 길드");

      db.insert(tags).values({ projectId: project.id, name: "버그" }).run();

      expect(() =>
        db.insert(tags).values({ projectId: project.id, name: "버그" }).run(),
      ).toThrow(/UNIQUE constraint failed/);

      expect(() =>
        db
          .insert(tags)
          .values({ projectId: otherProject.id, name: "버그" })
          .run(),
      ).not.toThrow();
    } finally {
      close();
    }
  });

  it("rejects rows that reference missing foreign keys", () => {
    const { db, close } = openDb(":memory:");
    try {
      const user = insertUser(db);
      const project = insertProject(db);

      expect(() =>
        db
          .insert(projectMembers)
          .values({
            projectId: project.id,
            userId: user.id + 999,
            role: "member",
            joinedAt: Date.now(),
          })
          .run(),
      ).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      close();
    }
  });

  it("stores session expiry timestamps", () => {
    const { db, close } = openDb(":memory:");
    try {
      const user = insertUser(db);
      const sessionId = createSession(db, user.id);

      // 32 random bytes encoded as base64url.
      expect(sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const session = db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .get();

      expect(session).toBeDefined();
      expect(session?.userId).toBe(user.id);
      expect(session?.expiresAt).toBe((session?.createdAt ?? 0) + SESSION_TTL_MS);
      expect(getSessionUser(db, sessionId)?.id).toBe(user.id);

      // An expired session is treated as missing.
      db.update(sessions)
        .set({ expiresAt: Date.now() - 1 })
        .where(eq(sessions.id, sessionId))
        .run();
      expect(getSessionUser(db, sessionId)).toBeNull();
    } finally {
      close();
    }
  });
});

describe("buildApp", () => {
  it("decorates the db and returns the JSON 404 envelope", async () => {
    const { app, db, close } = await createTestApp();
    try {
      expect(app.db).toBe(db);

      const response = await app.inject({ method: "GET", url: "/api/missing" });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Not found" },
      });
    } finally {
      await close();
    }
  });

  it("maps HttpError and Zod validation failures to the API error body", async () => {
    const { app, close } = await createTestApp();
    try {
      app.get("/test-forbidden", async () => {
        throw new HttpError(403, "FORBIDDEN", "Not your guild");
      });
      app.get("/test-boom", async () => {
        throw new Error("boom");
      });
      app.post(
        "/test-validate",
        { schema: { body: z.object({ name: z.string().min(1) }) } },
        async () => ({ ok: true }),
      );

      const forbidden = await app.inject({
        method: "GET",
        url: "/test-forbidden",
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json()).toEqual({
        error: { code: "FORBIDDEN", message: "Not your guild" },
      });

      const invalid = await app.inject({
        method: "POST",
        url: "/test-validate",
        payload: { name: "" },
      });
      expect(invalid.statusCode).toBe(400);
      const body = invalid.json() as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("name");

      const failure = await app.inject({
        method: "GET",
        url: "/test-boom",
      });
      expect(failure.statusCode).toBe(500);
      expect(failure.json()).toEqual({
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      });
    } finally {
      await close();
    }
  });

  it("authenticates sessions through the gl_session cookie", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const user = createUser(db, { loginId: "alice", displayName: "앨리스" });
      app.get(
        "/test-me",
        { preHandler: authenticate },
        async (request) => ({ userId: request.user?.id ?? null }),
      );

      const unauthorized = await app.inject({
        method: "GET",
        url: "/test-me",
      });
      expect(unauthorized.statusCode).toBe(401);
      expect(unauthorized.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: expect.any(String) },
      });

      const authorized = await app.inject({
        method: "GET",
        url: "/test-me",
        headers: { cookie: createSessionCookie(db, user.id) },
      });
      expect(authorized.statusCode).toBe(200);
      expect(authorized.json()).toEqual({ userId: user.id });
    } finally {
      await close();
    }
  });

  it("sets a 30-day httpOnly cookie and adds Secure behind HTTPS", async () => {
    const { db, close } = openDb(":memory:");
    const app = await buildApp({ db, trustProxy: true });
    try {
      const user = createUser(db);
      app.get("/test-login/:userId", async (request, reply) => {
        const { userId } = request.params as { userId: string };
        setSessionCookie(request, reply, createSession(db, Number(userId)));
        return { ok: true };
      });

      const plain = await app.inject({
        method: "GET",
        url: `/test-login/${user.id}`,
      });
      const cookie = String(plain.headers["set-cookie"]);
      expect(cookie).toContain(`${SESSION_COOKIE}=`);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=2592000");
      expect(cookie).not.toContain("Secure");

      const secure = await app.inject({
        method: "GET",
        url: `/test-login/${user.id}`,
        headers: { "x-forwarded-proto": "https" },
      });
      expect(String(secure.headers["set-cookie"])).toContain("Secure");
    } finally {
      await app.close();
      close();
    }
  });
});

describe("auth helpers", () => {
  it("hashes and verifies passwords with scrypt", () => {
    const stored = hashPassword("password123");

    expect(stored).toMatch(/^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(verifyPassword("password123", stored)).toBe(true);
    expect(verifyPassword("wrong-password", stored)).toBe(false);
    expect(verifyPassword("password123", "not-a-hash")).toBe(false);
    expect(verifyPassword("password123", "scrypt$$")).toBe(false);
  });

  it("returns 403 for non-members and serializes user profiles", () => {
    const { db, close } = openDb(":memory:");
    try {
      const owner = createUser(db, { loginId: "owner", xp: 300 });
      const outsider = createUser(db, { loginId: "outsider" });
      const project = createProject(db, { ownerId: owner.id });

      expect(requireMembership(db, owner.id, project.id).role).toBe("owner");

      let caught: unknown;
      try {
        requireMembership(db, outsider.id, project.id);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HttpError);
      expect(caught).toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

      expect(toUserProfile(owner)).toEqual({
        id: owner.id,
        loginId: "owner",
        displayName: owner.displayName,
        xp: 300,
        level: 3,
      });
    } finally {
      close();
    }
  });
});
