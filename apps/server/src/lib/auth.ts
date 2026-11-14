/**
 * Session cookie authentication and project membership guards.
 *
 * Sessions live in SQLite (`sessions`), the browser only carries the opaque
 * `gl_session` cookie. Expired sessions are treated as missing.
 */
import { randomBytes } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { AppDb } from "../db/index.js";
import {
  projectMembers,
  sessions,
  users,
  type ProjectMemberRow,
  type UserRow,
} from "../db/schema.js";
import { HttpError } from "./errors.js";

/** Name of the session cookie. */
export const SESSION_COOKIE = "gl_session";

/** Session lifetime: 30 days in milliseconds. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

declare module "fastify" {
  interface FastifyRequest {
    /** Authenticated user, set by the {@link authenticate} preHandler. */
    user?: UserRow;
    /** Id of the session backing `user`, set by {@link authenticate}. */
    sessionId?: string;
  }
}

/** Create a session for `userId` and return its opaque id. */
export function createSession(db: AppDb, userId: number): string {
  const id = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.insert(sessions)
    .values({ id, userId, createdAt: now, expiresAt: now + SESSION_TTL_MS })
    .run();
  return id;
}

/** Delete a session; unknown ids are ignored. */
export function deleteSession(db: AppDb, sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

/** Resolve a session id to its user, or `null` when missing/expired. */
export function getSessionUser(
  db: AppDb,
  sessionId: string,
): UserRow | null {
  if (sessionId.length === 0) {
    return null;
  }

  const row = db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(eq(sessions.id, sessionId), gt(sessions.expiresAt, Date.now())),
    )
    .get();

  return row?.user ?? null;
}

/** Attach the session cookie to the response. */
export function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  sessionId: string,
): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    secure: request.protocol === "https",
  });
}

/** Expire the session cookie on the response. */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/**
 * Fastify preHandler: require a valid session and populate `request.user`.
 *
 * @throws {HttpError} 401 UNAUTHORIZED when the cookie is missing or expired.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessionId = request.cookies[SESSION_COOKIE];
  if (!sessionId) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  }

  const user = getSessionUser(request.server.db, sessionId);
  if (!user) {
    clearSessionCookie(reply);
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  }

  request.user = user;
  request.sessionId = sessionId;
}

/** Membership row for `userId` in `projectId`, or `null` when not a member. */
export function getMembership(
  db: AppDb,
  userId: number,
  projectId: number,
): ProjectMemberRow | null {
  return (
    db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      )
      .get() ?? null
  );
}

/**
 * Require `userId` to be a member of `projectId`.
 *
 * @throws {HttpError} 403 FORBIDDEN when the user is not a member.
 */
export function requireMembership(
  db: AppDb,
  userId: number,
  projectId: number,
): ProjectMemberRow {
  const membership = getMembership(db, userId, projectId);
  if (!membership) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "You are not a member of this project",
    );
  }
  return membership;
}
