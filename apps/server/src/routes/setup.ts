/**
 * First-run setup routes (`/api/setup*`).
 *
 * Setup is possible only while the `users` table is empty: it creates the first
 * adventurer, their guild (`next_quest_number` starts at 1) and the owner
 * membership in a single transaction and signs the new adventurer in.
 *
 * Keep the export name `setupRoutes`: `app.ts` registers this plugin.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import {
  setupRequestSchema,
  setupResponseSchema,
  setupStatusResponseSchema,
  type Project,
} from "@guildloom/shared";

import {
  projectMembers,
  projects,
  users,
  type ProjectRow,
} from "../db/schema.js";
import { createSession, setSessionCookie } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { toUserProfile } from "../lib/serialize.js";

/** Reduce a project row to the shared `Project` response shape. */
function toProject(project: ProjectRow): Project {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
  };
}

export const setupRoutes: FastifyPluginAsyncZod = async (app) => {
  const db = app.db;

  app.get(
    "/api/setup/status",
    { schema: { response: { 200: setupStatusResponseSchema } } },
    async () => {
      const existing = db
        .select({ id: users.id })
        .from(users)
        .limit(1)
        .get();

      return { needsSetup: !existing };
    },
  );

  app.post(
    "/api/setup",
    {
      schema: {
        body: setupRequestSchema,
        response: { 201: setupResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const loginId = body.loginId.toLowerCase();
      const passwordHash = hashPassword(body.password);

      // The emptiness check runs inside the transaction so a concurrent setup
      // can never slip between the check and the inserts.
      const created = db.transaction((tx) => {
        const existing = tx
          .select({ id: users.id })
          .from(users)
          .limit(1)
          .get();
        if (existing) {
          throw new HttpError(
            409,
            "SETUP_ALREADY_DONE",
            "Setup has already been completed",
          );
        }

        const now = Date.now();
        const user = tx
          .insert(users)
          .values({
            loginId,
            displayName: body.displayName,
            passwordHash,
            xp: 0,
            createdAt: now,
          })
          .returning()
          .get();

        const project = tx
          .insert(projects)
          .values({
            name: body.guildName,
            nextQuestNumber: 1,
            createdAt: now,
          })
          .returning()
          .get();

        tx.insert(projectMembers)
          .values({
            projectId: project.id,
            userId: user.id,
            role: "owner",
            joinedAt: now,
          })
          .run();

        return { user, project };
      });

      setSessionCookie(request, reply, createSession(db, created.user.id));
      reply.code(201);

      return {
        user: toUserProfile(created.user),
        project: toProject(created.project),
      };
    },
  );
};
