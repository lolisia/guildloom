/**
 * Invite routes (`/api/projects/:pid/invites`, `/api/invites/*`).
 *
 * Invites are reusable links: any active code can sign up a new adventurer or
 * add an already logged in one to the guild. Only revoking the code stops new
 * joins; project members manage the codes and every project subresource
 * requires membership.
 *
 * Keep the export name `inviteRoutes`: `app.ts` registers this plugin.
 */
import { randomBytes } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  createInviteResponseSchema,
  inviteInfoResponseSchema,
  inviteJoinResponseSchema,
  inviteListResponseSchema,
  inviteSignupRequestSchema,
  inviteSignupResponseSchema,
  type Invite,
} from "@guildloom/shared";

import type { AppDb } from "../db/index.js";
import {
  invites,
  projectMembers,
  projects,
  users,
  type InviteRow,
} from "../db/schema.js";
import {
  authenticate,
  createSession,
  getMembership,
  requireMembership,
  setSessionCookie,
} from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { toUserProfile } from "../lib/serialize.js";

/** Route params for routes scoped to one project. */
const projectParamsSchema = z.object({
  pid: z.coerce.number().int().positive(),
});

/** Route params for invite management below a project. */
const projectInviteParamsSchema = projectParamsSchema.extend({
  id: z.coerce.number().int().positive(),
});

/** Route params for the public invite lookup. */
const inviteCodeParamsSchema = z.object({
  code: z.string().min(1),
});

/** Relative client route for an invite code. */
function inviteUrl(code: string): string {
  return `/invite/${code}`;
}

/** An invite row together with the name of the guild it belongs to. */
interface FoundInvite {
  invite: InviteRow;
  projectName: string;
}

/** Resolve an invite code, including revoked invites, or `null`. */
function findInviteByCode(db: AppDb, code: string): FoundInvite | null {
  const row = db
    .select({ invite: invites, projectName: projects.name })
    .from(invites)
    .innerJoin(projects, eq(invites.projectId, projects.id))
    .where(eq(invites.code, code))
    .get();

  return row ?? null;
}

/**
 * Generate an unused invite code.
 *
 * Codes are 16 random bytes base64url encoded (22 characters), which is far
 * beyond guessable. The loop keeps the result unique even after the unlikely
 * event of a collision.
 */
function generateInviteCode(db: AppDb): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomBytes(16).toString("base64url");
    const existing = db
      .select({ id: invites.id })
      .from(invites)
      .where(eq(invites.code, code))
      .get();
    if (!existing) {
      return code;
    }
  }

  throw new HttpError(
    500,
    "INTERNAL_ERROR",
    "Could not generate a unique invite code",
  );
}

export const inviteRoutes: FastifyPluginAsyncZod = async (app) => {
  const db = app.db;

  app.post(
    "/api/projects/:pid/invites",
    {
      preHandler: authenticate,
      schema: {
        params: projectParamsSchema,
        response: { 201: createInviteResponseSchema },
      },
    },
    async (request, reply) => {
      const { pid } = request.params;
      const user = request.user!;
      requireMembership(db, user.id, pid);

      const code = generateInviteCode(db);
      db.insert(invites)
        .values({
          projectId: pid,
          code,
          createdBy: user.id,
          createdAt: Date.now(),
        })
        .run();

      reply.code(201);
      return { code, url: inviteUrl(code) };
    },
  );

  app.get(
    "/api/projects/:pid/invites",
    {
      preHandler: authenticate,
      schema: {
        params: projectParamsSchema,
        response: { 200: inviteListResponseSchema },
      },
    },
    async (request) => {
      const { pid } = request.params;
      requireMembership(db, request.user!.id, pid);

      const rows = db
        .select({ invite: invites, creatorName: users.displayName })
        .from(invites)
        .innerJoin(users, eq(invites.createdBy, users.id))
        .where(eq(invites.projectId, pid))
        .orderBy(desc(invites.createdAt), desc(invites.id))
        .all();

      return rows.map(
        ({ invite, creatorName }): Invite => ({
          id: invite.id,
          code: invite.code,
          url: inviteUrl(invite.code),
          createdBy: { id: invite.createdBy, displayName: creatorName },
          createdAt: invite.createdAt,
          revokedAt: invite.revokedAt,
        }),
      );
    },
  );

  app.delete(
    "/api/projects/:pid/invites/:id",
    {
      preHandler: authenticate,
      schema: { params: projectInviteParamsSchema },
    },
    async (request, reply) => {
      const { pid, id } = request.params;
      requireMembership(db, request.user!.id, pid);

      const invite = db
        .select()
        .from(invites)
        .where(and(eq(invites.id, id), eq(invites.projectId, pid)))
        .get();
      if (!invite) {
        throw new HttpError(404, "INVITE_NOT_FOUND", "Invite not found");
      }

      // Revoking an already revoked invite is a no-op; the original timestamp
      // is kept so repeated calls stay idempotent.
      if (invite.revokedAt === null) {
        db.update(invites)
          .set({ revokedAt: Date.now() })
          .where(eq(invites.id, id))
          .run();
      }

      return reply.code(204).send();
    },
  );

  app.get(
    "/api/invites/:code",
    {
      schema: {
        params: inviteCodeParamsSchema,
        response: { 200: inviteInfoResponseSchema },
      },
    },
    async (request) => {
      const found = findInviteByCode(db, request.params.code);
      if (!found) {
        throw new HttpError(404, "INVITE_NOT_FOUND", "Invite not found");
      }

      return {
        projectName: found.projectName,
        valid: found.invite.revokedAt === null,
      };
    },
  );

  app.post(
    "/api/invites/:code/signup",
    {
      schema: {
        params: inviteCodeParamsSchema,
        body: inviteSignupRequestSchema,
        response: { 201: inviteSignupResponseSchema },
      },
    },
    async (request, reply) => {
      const found = findInviteByCode(db, request.params.code);
      if (!found || found.invite.revokedAt !== null) {
        throw new HttpError(
          404,
          "INVITE_INVALID",
          "This invite link is invalid or has been revoked",
        );
      }

      const { projectId } = found.invite;
      const loginId = request.body.loginId.toLowerCase();

      // Fail before paying for scrypt when the login id is obviously taken;
      // the transaction re-checks so a race cannot create duplicates either.
      const taken = db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.loginId, loginId))
        .get();
      if (taken) {
        throw new HttpError(
          409,
          "LOGIN_ID_TAKEN",
          "That login id is already taken",
        );
      }

      const passwordHash = hashPassword(request.body.password);

      const user = db.transaction((tx) => {
        const existing = tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.loginId, loginId))
          .get();
        if (existing) {
          throw new HttpError(
            409,
            "LOGIN_ID_TAKEN",
            "That login id is already taken",
          );
        }

        const now = Date.now();
        const created = tx
          .insert(users)
          .values({
            loginId,
            displayName: request.body.displayName,
            passwordHash,
            xp: 0,
            createdAt: now,
          })
          .returning()
          .get();

        tx.insert(projectMembers)
          .values({
            projectId,
            userId: created.id,
            role: "member",
            joinedAt: now,
          })
          .run();

        return created;
      });

      setSessionCookie(request, reply, createSession(db, user.id));
      reply.code(201);

      return { user: toUserProfile(user), projectId };
    },
  );

  app.post(
    "/api/invites/:code/join",
    {
      preHandler: authenticate,
      schema: {
        params: inviteCodeParamsSchema,
        response: { 200: inviteJoinResponseSchema },
      },
    },
    async (request) => {
      const found = findInviteByCode(db, request.params.code);
      if (!found || found.invite.revokedAt !== null) {
        throw new HttpError(
          404,
          "INVITE_INVALID",
          "This invite link is invalid or has been revoked",
        );
      }

      const { projectId } = found.invite;
      const userId = request.user!.id;
      if (!getMembership(db, userId, projectId)) {
        db.insert(projectMembers)
          .values({
            projectId,
            userId,
            role: "member",
            joinedAt: Date.now(),
          })
          .onConflictDoNothing()
          .run();
      }

      return { projectId };
    },
  );
};
