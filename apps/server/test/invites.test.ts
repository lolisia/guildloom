/**
 * Invite endpoint tests.
 *
 * Invites are reusable guild links: members mint and revoke them, anyone can
 * inspect their validity, and either signup or join consumes them without
 * burning the code.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { describe, expect, it } from "vitest";

import type {
  CreateInviteResponse,
  InviteInfoResponse,
  InviteSignupResponse,
  ProjectDetailResponse,
} from "@guildloom/shared";

import type { AppDb } from "../src/db/index.js";
import { invites, projectMembers, users } from "../src/db/schema.js";
import { SESSION_COOKIE } from "../src/lib/auth.js";
import { verifyPassword } from "../src/lib/password.js";
import {
  addMember,
  createProject,
  createSessionCookie,
  createTestApp,
  createUser,
} from "./helpers.js";

/** The `gl_session` cookie carried by `response` as a request header. */
function sessionCookieHeader(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((entry) => entry.name === SESSION_COOKIE);
  expect(cookie).toBeDefined();
  return `${SESSION_COOKIE}=${cookie?.value ?? ""}`;
}

/** Insert the three actors used by the invite tests. */
function seedGuild(db: AppDb) {
  const owner = createUser(db, { loginId: "owner", displayName: "길드장" });
  const member = createUser(db, { loginId: "member", displayName: "길드원" });
  const outsider = createUser(db, { loginId: "outsider", displayName: "외부인" });
  const project = createProject(db, { name: "달빛 길드", ownerId: owner.id });
  addMember(db, project.id, member.id);

  return { owner, member, outsider, project };
}

/** Create an invite through the API and return its code. */
async function createInvite(
  app: FastifyInstance,
  projectId: number,
  cookie: string,
): Promise<CreateInviteResponse> {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/invites`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(201);
  return response.json<CreateInviteResponse>();
}

describe("invite management", () => {
  it("lets members create unique invite links", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const { member, project } = seedGuild(db);
      const cookie = createSessionCookie(db, member.id);

      const first = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/invites`,
        headers: { cookie },
      });
      expect(first.statusCode).toBe(201);

      const created = first.json<CreateInviteResponse>();
      expect(created.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(created.url).toBe(`/invite/${created.code}`);

      const second = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/invites`,
        headers: { cookie },
      });
      expect(second.statusCode).toBe(201);
      expect(second.json<CreateInviteResponse>().code).not.toBe(created.code);

      const rows = db.select().from(invites).all();
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.projectId).toBe(project.id);
        expect(row.createdBy).toBe(member.id);
        expect(row.revokedAt).toBeNull();
      }
    } finally {
      await close();
    }
  });

  it("rejects invite management by non-members", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const { owner, project, outsider } = seedGuild(db);
      const ownerCookie = createSessionCookie(db, owner.id);
      const outsiderCookie = createSessionCookie(db, outsider.id);
      const invite = await createInvite(app, project.id, ownerCookie);
      const inviteRow = db
        .select()
        .from(invites)
        .where(eq(invites.code, invite.code))
        .get();

      const create = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/invites`,
        headers: { cookie: outsiderCookie },
      });
      expect(create.statusCode).toBe(403);
      expect(create.json().error.code).toBe("FORBIDDEN");

      const list = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}/invites`,
        headers: { cookie: outsiderCookie },
      });
      expect(list.statusCode).toBe(403);
      expect(list.json().error.code).toBe("FORBIDDEN");

      const revoke = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.id}/invites/${inviteRow?.id}`,
        headers: { cookie: outsiderCookie },
      });
      expect(revoke.statusCode).toBe(403);
      expect(revoke.json().error.code).toBe("FORBIDDEN");

      const anonymous = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/invites`,
      });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json().error.code).toBe("UNAUTHORIZED");
    } finally {
      await close();
    }
  });

  it("lists invites newest first, including revoked entries", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const { owner, project } = seedGuild(db);
      const cookie = createSessionCookie(db, owner.id);

      const first = await createInvite(app, project.id, cookie);
      const second = await createInvite(app, project.id, cookie);

      const before = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}/invites`,
        headers: { cookie },
      });
      expect(before.statusCode).toBe(200);

      const listed = before.json<
        Array<{
          id: number;
          code: string;
          url: string;
          createdBy: { id: number; displayName: string };
          createdAt: number;
          revokedAt: number | null;
        }>
      >();
      expect(listed.map((invite) => invite.code)).toEqual([
        second.code,
        first.code,
      ]);
      expect(listed[0]).toMatchObject({
        url: `/invite/${second.code}`,
        createdBy: { id: owner.id, displayName: owner.displayName },
        revokedAt: null,
      });

      const revoked = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.id}/invites/${listed[1]?.id}`,
        headers: { cookie },
      });
      expect(revoked.statusCode).toBe(204);

      const after = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}/invites`,
        headers: { cookie },
      });
      const afterList = after.json<typeof listed>();
      expect(afterList).toHaveLength(2);
      expect(afterList.map((invite) => invite.code)).toEqual([
        second.code,
        first.code,
      ]);
      expect(afterList[1]?.revokedAt).toEqual(expect.any(Number));
    } finally {
      await close();
    }
  });

  it("revokes idempotently and scopes invites to their project", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const { owner, project } = seedGuild(db);
      const otherProject = createProject(db, {
        name: "다른 길드",
        ownerId: owner.id,
      });
      const cookie = createSessionCookie(db, owner.id);

      const invite = await createInvite(app, project.id, cookie);
      const otherInvite = await createInvite(app, otherProject.id, cookie);
      const rows = db.select().from(invites).all();
      const inviteRow = rows.find((row) => row.code === invite.code);
      const otherRow = rows.find((row) => row.code === otherInvite.code);
      expect(inviteRow).toBeDefined();
      expect(otherRow).toBeDefined();

      const wrongProject = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.id}/invites/${otherRow?.id}`,
        headers: { cookie },
      });
      expect(wrongProject.statusCode).toBe(404);
      expect(wrongProject.json().error.code).toBe("INVITE_NOT_FOUND");

      const unknown = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.id}/invites/99999`,
        headers: { cookie },
      });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().error.code).toBe("INVITE_NOT_FOUND");

      const revoke = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.id}/invites/${inviteRow?.id}`,
        headers: { cookie },
      });
      expect(revoke.statusCode).toBe(204);

      const revokedAt = db
        .select()
        .from(invites)
        .where(eq(invites.id, inviteRow?.id ?? 0))
        .get()?.revokedAt;
      expect(revokedAt).toEqual(expect.any(Number));

      const again = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.id}/invites/${inviteRow?.id}`,
        headers: { cookie },
      });
      expect(again.statusCode).toBe(204);
      const afterSecond = db
        .select()
        .from(invites)
        .where(eq(invites.id, inviteRow?.id ?? 0))
        .get()?.revokedAt;
      expect(afterSecond).toBe(revokedAt);
    } finally {
      await close();
    }
  });
});

describe("public invite info", () => {
  it("reports validity without requiring authentication", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const { owner, project } = seedGuild(db);
      const invite = await createInvite(
        app,
        project.id,
        createSessionCookie(db, owner.id),
      );

      const active = await app.inject({
        method: "GET",
        url: `/api/invites/${invite.code}`,
      });
      expect(active.statusCode).toBe(200);
      expect(active.json<InviteInfoResponse>()).toEqual({
        projectName: "달빛 길드",
        valid: true,
      });

      const row = db
        .select()
        .from(invites)
        .where(eq(invites.code, invite.code))
        .get();
      await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.id}/invites/${row?.id}`,
        headers: { cookie: createSessionCookie(db, owner.id) },
      });

      const revoked = await app.inject({
        method: "GET",
        url: `/api/invites/${invite.code}`,
      });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json<InviteInfoResponse>()).toEqual({
        projectName: "달빛 길드",
        valid: false,
      });

      const unknown = await app.inject({
        method: "GET",
        url: "/api/invites/does-not-exist",
      });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().error.code).toBe("INVITE_NOT_FOUND");
    } finally {
      await close();
    }
  });
});

describe("invite signup", () => {
  it("creates an adventurer, joins the guild and starts a session", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const { owner, project } = seedGuild(db);
      const invite = await createInvite(
        app,
        project.id,
        createSessionCookie(db, owner.id),
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.code}/signup`,
        payload: {
          displayName: "신입",
          loginId: "newbie",
          password: "password123",
        },
      });
      expect(response.statusCode).toBe(201);

      const body = response.json<InviteSignupResponse>();
      expect(body.projectId).toBe(project.id);
      expect(body.user).toEqual({
        id: expect.any(Number),
        loginId: "newbie",
        displayName: "신입",
        xp: 0,
        level: 1,
      });

      const stored = db
        .select()
        .from(users)
        .where(eq(users.id, body.user.id))
        .get();
      expect(stored?.loginId).toBe("newbie");
      expect(verifyPassword("password123", stored?.passwordHash ?? "")).toBe(
        true,
      );

      const membership = db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.userId, body.user.id))
        .get();
      expect(membership).toMatchObject({
        projectId: project.id,
        role: "member",
      });

      const cookie = sessionCookieHeader(response);
      const me = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.id).toBe(body.user.id);

      const detail = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(
        detail
          .json<ProjectDetailResponse>()
          .members.map((member) => member.userId),
      ).toContain(body.user.id);

      // The same active code can sign up another adventurer.
      const second = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.code}/signup`,
        payload: {
          displayName: "두 번째 신입",
          loginId: "newbie2",
          password: "password123",
        },
      });
      expect(second.statusCode).toBe(201);
      expect(
        second.json<InviteSignupResponse>().user.loginId,
      ).toBe("newbie2");
    } finally {
      await close();
    }
  });

  it("rejects revoked and unknown invite codes", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const { owner, project } = seedGuild(db);
      const cookie = createSessionCookie(db, owner.id);
      const invite = await createInvite(app, project.id, cookie);
      const row = db
        .select()
        .from(invites)
        .where(eq(invites.code, invite.code))
        .get();

      await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.id}/invites/${row?.id}`,
        headers: { cookie },
      });

      const revoked = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.code}/signup`,
        payload: {
          displayName: "신입",
          loginId: "newbie",
          password: "password123",
        },
      });
      expect(revoked.statusCode).toBe(404);
      expect(revoked.json().error.code).toBe("INVITE_INVALID");
      expect(db.select().from(users).all()).toHaveLength(3);

      const unknown = await app.inject({
        method: "POST",
        url: "/api/invites/missing-code/signup",
        payload: {
          displayName: "신입",
          loginId: "newbie",
          password: "password123",
        },
      });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().error.code).toBe("INVITE_INVALID");
    } finally {
      await close();
    }
  });

  it("rejects duplicate login ids with 409 LOGIN_ID_TAKEN", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const { owner, project } = seedGuild(db);
      const invite = await createInvite(
        app,
        project.id,
        createSessionCookie(db, owner.id),
      );

      const taken = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.code}/signup`,
        payload: {
          displayName: "중복",
          loginId: "owner",
          password: "password123",
        },
      });
      expect(taken.statusCode).toBe(409);
      expect(taken.json().error.code).toBe("LOGIN_ID_TAKEN");
      expect(db.select().from(users).all()).toHaveLength(3);
    } finally {
      await close();
    }
  });

  it("validates the signup body", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const { owner, project } = seedGuild(db);
      const invite = await createInvite(
        app,
        project.id,
        createSessionCookie(db, owner.id),
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.code}/signup`,
        payload: {
          displayName: "신입",
          loginId: "newbie",
          password: "short",
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    } finally {
      await close();
    }
  });
});

describe("invite join", () => {
  it("joins authenticated adventurers idempotently", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const { owner, outsider, project } = seedGuild(db);
      const invite = await createInvite(
        app,
        project.id,
        createSessionCookie(db, owner.id),
      );
      const cookie = createSessionCookie(db, outsider.id);

      const first = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.code}/join`,
        headers: { cookie },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ projectId: project.id });

      const membership = db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.userId, outsider.id))
        .get();
      expect(membership).toMatchObject({
        projectId: project.id,
        role: "member",
      });

      const second = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.code}/join`,
        headers: { cookie },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ projectId: project.id });

      const memberships = db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.userId, outsider.id))
        .all();
      expect(memberships).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("rejects anonymous, unknown and revoked invite joins", async () => {
    const { app, db, close } = await createTestApp();
    try {
      const { owner, outsider, project } = seedGuild(db);
      const cookie = createSessionCookie(db, owner.id);
      const invite = await createInvite(app, project.id, cookie);
      const row = db
        .select()
        .from(invites)
        .where(eq(invites.code, invite.code))
        .get();
      const outsiderCookie = createSessionCookie(db, outsider.id);

      const anonymous = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.code}/join`,
      });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json().error.code).toBe("UNAUTHORIZED");

      const unknown = await app.inject({
        method: "POST",
        url: "/api/invites/missing-code/join",
        headers: { cookie: outsiderCookie },
      });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().error.code).toBe("INVITE_INVALID");

      await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.id}/invites/${row?.id}`,
        headers: { cookie },
      });

      const revoked = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.code}/join`,
        headers: { cookie: outsiderCookie },
      });
      expect(revoked.statusCode).toBe(404);
      expect(revoked.json().error.code).toBe("INVITE_INVALID");
    } finally {
      await close();
    }
  });
});
