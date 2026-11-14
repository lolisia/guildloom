/**
 * Setup and authentication endpoint tests.
 *
 * These pin the first-run bootstrap (exactly once, transactional guild owner),
 * the `gl_session` cookie contract and the login/logout/me behaviour the web
 * client depends on.
 */
import { describe, expect, it } from "vitest";

import type { LightMyRequestResponse } from "fastify";

import type {
  LoginResponse,
  MeResponse,
  SetupResponse,
  SetupStatusResponse,
} from "@guildloom/shared";

import { buildApp } from "../src/app.js";
import { openDb } from "../src/db/index.js";
import { projectMembers, projects, users } from "../src/db/schema.js";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../src/lib/auth.js";
import { verifyPassword } from "../src/lib/password.js";
import {
  DEFAULT_TEST_PASSWORD,
  createTestApp,
  createUser,
} from "./helpers.js";

const SETUP_BODY = {
  guildName: "달빛 길드",
  displayName: "앨리스",
  loginId: "alice",
  password: "password123",
};

/** The `gl_session` cookie of a response, including its attributes. */
function findSessionCookie(response: LightMyRequestResponse) {
  const cookie = response.cookies.find((entry) => entry.name === SESSION_COOKIE);
  expect(cookie).toBeDefined();
  return cookie!;
}

/** `Cookie` request header carrying the session cookie of `response`. */
function sessionCookieHeader(response: LightMyRequestResponse): string {
  const cookie = findSessionCookie(response);
  return `${SESSION_COOKIE}=${cookie.value}`;
}

describe("setup", () => {
  it("reports needsSetup until the first adventurer exists", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const before = await app.inject({
        method: "GET",
        url: "/api/setup/status",
      });
      expect(before.statusCode).toBe(200);
      expect(before.json<SetupStatusResponse>()).toEqual({ needsSetup: true });

      const response = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: SETUP_BODY,
      });
      expect(response.statusCode).toBe(201);

      const body = response.json<SetupResponse>();
      expect(body.user).toEqual({
        id: expect.any(Number),
        loginId: "alice",
        displayName: "앨리스",
        xp: 0,
        level: 1,
      });
      expect(body.project).toEqual({
        id: expect.any(Number),
        name: "달빛 길드",
        createdAt: expect.any(Number),
      });

      const cookie = findSessionCookie(response);
      expect(cookie.value.length).toBeGreaterThan(0);
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.path).toBe("/");
      expect(cookie.maxAge).toBe(SESSION_TTL_MS / 1000);
      expect(cookie.sameSite?.toLowerCase()).toBe("lax");
      expect(cookie.secure).toBeFalsy();
      expect(String(response.headers["set-cookie"])).toContain("SameSite=Lax");

      const after = await app.inject({
        method: "GET",
        url: "/api/setup/status",
      });
      expect(after.json<SetupStatusResponse>()).toEqual({ needsSetup: false });

      // The setup session is usable straight away.
      const me = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: sessionCookieHeader(response) },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json<MeResponse>().user).toEqual(body.user);

      // Rows landed with the documented defaults.
      const userRows = db.select().from(users).all();
      expect(userRows).toHaveLength(1);
      const storedUser = userRows[0]!;
      expect(storedUser.loginId).toBe("alice");
      expect(storedUser.passwordHash).not.toBe(SETUP_BODY.password);
      expect(
        verifyPassword(SETUP_BODY.password, storedUser.passwordHash),
      ).toBe(true);

      const projectRows = db.select().from(projects).all();
      expect(projectRows).toHaveLength(1);
      expect(projectRows[0]?.nextQuestNumber).toBe(1);

      const memberRows = db.select().from(projectMembers).all();
      expect(memberRows).toHaveLength(1);
      expect(memberRows[0]).toMatchObject({
        projectId: body.project.id,
        userId: body.user.id,
        role: "owner",
      });
    } finally {
      await close();
    }
  });

  it("rejects a second setup with 409 SETUP_ALREADY_DONE", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const first = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: SETUP_BODY,
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          guildName: "두 번째 길드",
          displayName: "밥",
          loginId: "bob",
          password: "password456",
        },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toEqual({
        error: {
          code: "SETUP_ALREADY_DONE",
          message: expect.any(String),
        },
      });

      // Nothing from the rejected attempt was written.
      expect(db.select().from(users).all()).toHaveLength(1);
      expect(db.select().from(projects).all()).toHaveLength(1);
      expect(db.select().from(projectMembers).all()).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("is closed once any adventurer exists", async () => {
    const { app, db, close } = await createTestApp();
    try {
      createUser(db, { loginId: "existing" });

      const status = await app.inject({
        method: "GET",
        url: "/api/setup/status",
      });
      expect(status.json<SetupStatusResponse>()).toEqual({ needsSetup: false });

      const response = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: SETUP_BODY,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SETUP_ALREADY_DONE");
    } finally {
      await close();
    }
  });
});

describe("auth", () => {
  it("logs in with valid credentials and sets the session cookie", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const user = createUser(db, {
        loginId: "alice",
        displayName: "앨리스",
        xp: 300,
      });

      const wrongPassword = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { loginId: "alice", password: "wrong-password" },
      });
      expect(wrongPassword.statusCode).toBe(401);
      expect(wrongPassword.json()).toEqual({
        error: {
          code: "INVALID_CREDENTIALS",
          message: expect.any(String),
        },
      });

      const unknownUser = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { loginId: "nobody", password: DEFAULT_TEST_PASSWORD },
      });
      expect(unknownUser.statusCode).toBe(401);
      expect(unknownUser.json().error.code).toBe("INVALID_CREDENTIALS");

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { loginId: "alice", password: DEFAULT_TEST_PASSWORD },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<LoginResponse>().user).toEqual({
        id: user.id,
        loginId: "alice",
        displayName: "앨리스",
        xp: 300,
        level: 3,
      });

      const cookie = findSessionCookie(response);
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.path).toBe("/");
      expect(cookie.maxAge).toBe(SESSION_TTL_MS / 1000);
      expect(cookie.sameSite?.toLowerCase()).toBe("lax");

      const me = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: `${SESSION_COOKIE}=${cookie.value}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json<MeResponse>().user.id).toBe(user.id);
    } finally {
      await close();
    }
  });

  it("/me returns 401 without a valid session", async () => {
    const { app, db, close } = await createTestApp();
    try {
      createUser(db, { loginId: "alice" });

      const missing = await app.inject({
        method: "GET",
        url: "/api/auth/me",
      });
      expect(missing.statusCode).toBe(401);
      expect(missing.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: expect.any(String) },
      });

      const bogus = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: `${SESSION_COOKIE}=not-a-real-session` },
      });
      expect(bogus.statusCode).toBe(401);
      expect(bogus.json().error.code).toBe("UNAUTHORIZED");
    } finally {
      await close();
    }
  });

  it("logout deletes the session and clears the cookie", async () => {
    const { app, db, close } = await createTestApp();
    try {
      createUser(db, { loginId: "alice" });

      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { loginId: "alice", password: DEFAULT_TEST_PASSWORD },
      });
      const cookieHeader = sessionCookieHeader(login);

      const logout = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie: cookieHeader },
      });
      expect(logout.statusCode).toBe(204);
      expect(logout.body).toBe("");

      const cleared = findSessionCookie(logout);
      expect(cleared.value).toBe("");
      expect(cleared.expires?.getTime() ?? 0).toBeLessThan(Date.now());

      const me = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: cookieHeader },
      });
      expect(me.statusCode).toBe(401);

      // Logging out without a session is still a successful no-op.
      const anonymousLogout = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
      });
      expect(anonymousLogout.statusCode).toBe(204);
    } finally {
      await close();
    }
  });

  it("marks the session cookie Secure behind HTTPS", async () => {
    const { db, close: closeDb } = openDb(":memory:");
    const app = await buildApp({ db, trustProxy: true });
    try {
      createUser(db, { loginId: "alice" });

      const secure = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "x-forwarded-proto": "https" },
        payload: { loginId: "alice", password: DEFAULT_TEST_PASSWORD },
      });
      expect(secure.statusCode).toBe(200);
      expect(findSessionCookie(secure).secure).toBe(true);
      expect(String(secure.headers["set-cookie"])).toContain("Secure");

      const plain = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { loginId: "alice", password: DEFAULT_TEST_PASSWORD },
      });
      expect(plain.statusCode).toBe(200);
      expect(findSessionCookie(plain).secure).toBeFalsy();
      expect(String(plain.headers["set-cookie"])).not.toContain("Secure");
    } finally {
      await app.close();
      closeDb();
    }
  });
});
