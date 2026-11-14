/**
 * Authentication routes (`/api/auth/*`).
 *
 * Login issues an opaque `gl_session` cookie, logout revokes the session it
 * names, and `/me` returns the profile of the cookie's adventurer.
 *
 * Keep the export name `authRoutes`: `app.ts` registers this plugin.
 */
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import {
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
} from "@guildloom/shared";

import { users } from "../db/schema.js";
import {
  SESSION_COOKIE,
  authenticate,
  clearSessionCookie,
  createSession,
  deleteSession,
  setSessionCookie,
} from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { verifyPassword } from "../lib/password.js";
import { toUserProfile } from "../lib/serialize.js";

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const db = app.db;

  app.post(
    "/api/auth/login",
    {
      schema: {
        body: loginRequestSchema,
        response: { 200: loginResponseSchema },
      },
    },
    async (request, reply) => {
      const loginId = request.body.loginId.toLowerCase();
      const user = db
        .select()
        .from(users)
        .where(eq(users.loginId, loginId))
        .get();

      // Identical response for unknown users and wrong passwords so the
      // endpoint does not reveal which login ids exist.
      if (!user || !verifyPassword(request.body.password, user.passwordHash)) {
        throw new HttpError(
          401,
          "INVALID_CREDENTIALS",
          "Invalid login id or password",
        );
      }

      setSessionCookie(request, reply, createSession(db, user.id));

      return { user: toUserProfile(user) };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    if (sessionId) {
      deleteSession(db, sessionId);
    }

    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get(
    "/api/auth/me",
    {
      preHandler: authenticate,
      schema: { response: { 200: meResponseSchema } },
    },
    async (request) => {
      // `authenticate` rejects requests without a valid session.
      return { user: toUserProfile(request.user!) };
    },
  );
};
