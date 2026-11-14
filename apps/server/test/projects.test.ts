/**
 * Project (guild) endpoint tests.
 *
 * Project access is membership-scoped: listing only shows the current
 * adventurer's guilds, detail is 403 for outsiders, and only owners may rename.
 */
import type { LightMyRequestResponse } from "fastify";
import { describe, expect, it } from "vitest";

import type {
  Project,
  ProjectDetailResponse,
  ProjectSummary,
} from "@guildloom/shared";

import { projectMembers } from "../src/db/schema.js";
import {
  addMember,
  createProject,
  createSessionCookie,
  createTestApp,
  createUser,
} from "./helpers.js";

/** The `gl_session` cookie of `response` as a request header. */
function sessionCookieHeader(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((entry) => entry.name === "gl_session");
  expect(cookie).toBeDefined();
  return `gl_session=${cookie?.value ?? ""}`;
}

describe("GET /api/projects", () => {
  it("lists only the current adventurer's memberships", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const alice = createUser(db, { loginId: "alice", displayName: "앨리스" });
      const bob = createUser(db, { loginId: "bob", displayName: "밥" });
      const carol = createUser(db, { loginId: "carol", displayName: "캐럴" });

      const alpha = createProject(db, { name: "알파 길드", ownerId: alice.id });
      const beta = createProject(db, { name: "베타 길드", ownerId: bob.id });
      addMember(db, beta.id, alice.id);

      const aliceList = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { cookie: createSessionCookie(db, alice.id) },
      });
      expect(aliceList.statusCode).toBe(200);
      expect(aliceList.json<ProjectSummary[]>()).toEqual([
        { id: alpha.id, name: "알파 길드", role: "owner" },
        { id: beta.id, name: "베타 길드", role: "member" },
      ]);

      const bobList = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { cookie: createSessionCookie(db, bob.id) },
      });
      expect(bobList.json<ProjectSummary[]>()).toEqual([
        { id: beta.id, name: "베타 길드", role: "owner" },
      ]);

      const carolList = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { cookie: createSessionCookie(db, carol.id) },
      });
      expect(carolList.statusCode).toBe(200);
      expect(carolList.json<ProjectSummary[]>()).toEqual([]);

      const anonymous = await app.inject({
        method: "GET",
        url: "/api/projects",
      });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json().error.code).toBe("UNAUTHORIZED");
    } finally {
      await close();
    }
  });
});

describe("POST /api/projects", () => {
  it("creates a project with the creator as owner", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const alice = createUser(db, { loginId: "alice" });
      const cookie = createSessionCookie(db, alice.id);

      const response = await app.inject({
        method: "POST",
        url: "/api/projects",
        headers: { cookie },
        payload: { name: "새 길드" },
      });
      expect(response.statusCode).toBe(201);

      const project = response.json<Project>();
      expect(project).toEqual({
        id: expect.any(Number),
        name: "새 길드",
        createdAt: expect.any(Number),
      });

      const stored = db.select().from(projectMembers).all();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        projectId: project.id,
        userId: alice.id,
        role: "owner",
      });

      const list = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { cookie },
      });
      expect(list.json<ProjectSummary[]>()).toEqual([
        { id: project.id, name: "새 길드", role: "owner" },
      ]);

      const invalid = await app.inject({
        method: "POST",
        url: "/api/projects",
        headers: { cookie },
        payload: { name: "   " },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.code).toBe("VALIDATION_ERROR");

      const anonymous = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "새 길드" },
      });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      await close();
    }
  });
});

describe("GET /api/projects/:pid", () => {
  it("returns the project and its members to members only", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const alice = createUser(db, {
        loginId: "alice",
        displayName: "앨리스",
        xp: 0,
      });
      const bob = createUser(db, {
        loginId: "bob",
        displayName: "밥",
        xp: 300,
      });
      const carol = createUser(db, { loginId: "carol", displayName: "캐럴" });

      const project = createProject(db, {
        name: "달빛 길드",
        ownerId: alice.id,
      });
      addMember(db, project.id, bob.id);

      const member = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}`,
        headers: { cookie: createSessionCookie(db, bob.id) },
      });
      expect(member.statusCode).toBe(200);

      const detail = member.json<ProjectDetailResponse>();
      expect(detail.project).toEqual({
        id: project.id,
        name: "달빛 길드",
        createdAt: project.createdAt,
      });
      expect(detail.members).toHaveLength(2);
      expect(detail.members[0]).toMatchObject({
        userId: alice.id,
        displayName: "앨리스",
        role: "owner",
        xp: 0,
        level: 1,
      });
      expect(detail.members[1]).toMatchObject({
        userId: bob.id,
        displayName: "밥",
        role: "member",
        xp: 300,
        level: 3,
      });

      const outsider = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}`,
        headers: { cookie: createSessionCookie(db, carol.id) },
      });
      expect(outsider.statusCode).toBe(403);
      expect(outsider.json()).toEqual({
        error: { code: "FORBIDDEN", message: expect.any(String) },
      });

      // Unknown projects must not reveal more than non-membership.
      const unknown = await app.inject({
        method: "GET",
        url: "/api/projects/99999",
        headers: { cookie: createSessionCookie(db, carol.id) },
      });
      expect(unknown.statusCode).toBe(403);

      const anonymous = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}`,
      });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json().error.code).toBe("UNAUTHORIZED");
    } finally {
      await close();
    }
  });
});

describe("PATCH /api/projects/:pid", () => {
  it("renames the project for owners only", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const alice = createUser(db, { loginId: "alice" });
      const bob = createUser(db, { loginId: "bob" });
      const carol = createUser(db, { loginId: "carol" });
      const project = createProject(db, {
        name: "달빛 길드",
        ownerId: alice.id,
      });
      addMember(db, project.id, bob.id);

      const renamed = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.id}`,
        headers: { cookie: createSessionCookie(db, alice.id) },
        payload: { name: "별빛 길드" },
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json<Project>().name).toBe("별빛 길드");

      const detail = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}`,
        headers: { cookie: createSessionCookie(db, alice.id) },
      });
      expect(detail.json<ProjectDetailResponse>().project.name).toBe(
        "별빛 길드",
      );

      const member = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.id}`,
        headers: { cookie: createSessionCookie(db, bob.id) },
        payload: { name: "탈취한 길드" },
      });
      expect(member.statusCode).toBe(403);
      expect(member.json().error.code).toBe("FORBIDDEN");

      const outsider = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.id}`,
        headers: { cookie: createSessionCookie(db, carol.id) },
        payload: { name: "탈취한 길드" },
      });
      expect(outsider.statusCode).toBe(403);

      const unknown = await app.inject({
        method: "PATCH",
        url: "/api/projects/99999",
        headers: { cookie: createSessionCookie(db, alice.id) },
        payload: { name: "없는 길드" },
      });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().error.code).toBe("NOT_FOUND");

      const invalid = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.id}`,
        headers: { cookie: createSessionCookie(db, alice.id) },
        payload: { name: "" },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.code).toBe("VALIDATION_ERROR");

      const anonymous = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.id}`,
        payload: { name: "익명 길드" },
      });
      expect(anonymous.statusCode).toBe(401);

      // The rejected attempts left the name untouched.
      const finalDetail = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}`,
        headers: { cookie: createSessionCookie(db, alice.id) },
      });
      expect(finalDetail.json<ProjectDetailResponse>().project.name).toBe(
        "별빛 길드",
      );
    } finally {
      await close();
    }
  });
});

describe("session cookie propagation", () => {
  it("lets the login cookie access project detail", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const alice = createUser(db, {
        loginId: "alice",
        displayName: "앨리스",
      });
      const project = createProject(db, {
        name: "달빛 길드",
        ownerId: alice.id,
      });

      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { loginId: "alice", password: "password123" },
      });
      expect(login.statusCode).toBe(200);

      const detail = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}`,
        headers: { cookie: sessionCookieHeader(login) },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json<ProjectDetailResponse>().members).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
