/**
 * Guild (project) routes (`/api/projects*`).
 *
 * Listing is scoped to the current adventurer's memberships; detail and rename
 * additionally check membership so non-members learn nothing about a guild.
 *
 * Keep the export name `projectRoutes`: `app.ts` registers this plugin.
 */
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  createProjectRequestSchema,
  levelFromXp,
  projectDetailResponseSchema,
  projectListResponseSchema,
  projectSchema,
  updateProjectRequestSchema,
  type Project,
  type ProjectMember,
  type ProjectSummary,
} from "@guildloom/shared";

import {
  projectMembers,
  projects,
  users,
  type ProjectRow,
} from "../db/schema.js";
import { authenticate, requireMembership } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";

/** Route params for routes scoped to one project. */
const projectParamsSchema = z.object({
  pid: z.coerce.number().int().positive(),
});

/** Reduce a project row to the shared `Project` response shape. */
function toProject(project: ProjectRow): Project {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
  };
}

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  const db = app.db;

  app.get(
    "/api/projects",
    {
      preHandler: authenticate,
      schema: { response: { 200: projectListResponseSchema } },
    },
    async (request) => {
      const rows = db
        .select({
          id: projects.id,
          name: projects.name,
          role: projectMembers.role,
        })
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(eq(projectMembers.userId, request.user!.id))
        .orderBy(projects.id)
        .all();

      return rows.map(
        (row): ProjectSummary => ({
          id: row.id,
          name: row.name,
          role: row.role,
        }),
      );
    },
  );

  app.post(
    "/api/projects",
    {
      preHandler: authenticate,
      schema: {
        body: createProjectRequestSchema,
        response: { 201: projectSchema },
      },
    },
    async (request, reply) => {
      const user = request.user!;

      const project = db.transaction((tx) => {
        const now = Date.now();
        const created = tx
          .insert(projects)
          .values({
            name: request.body.name,
            nextQuestNumber: 1,
            createdAt: now,
          })
          .returning()
          .get();

        tx.insert(projectMembers)
          .values({
            projectId: created.id,
            userId: user.id,
            role: "owner",
            joinedAt: now,
          })
          .run();

        return created;
      });

      reply.code(201);
      return toProject(project);
    },
  );

  app.get(
    "/api/projects/:pid",
    {
      preHandler: authenticate,
      schema: {
        params: projectParamsSchema,
        response: { 200: projectDetailResponseSchema },
      },
    },
    async (request) => {
      const { pid } = request.params;
      requireMembership(db, request.user!.id, pid);

      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, pid))
        .get();
      if (!project) {
        throw new HttpError(404, "NOT_FOUND", "Project not found");
      }

      const memberRows = db
        .select({
          userId: users.id,
          displayName: users.displayName,
          role: projectMembers.role,
          xp: users.xp,
        })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(eq(projectMembers.projectId, pid))
        .orderBy(projectMembers.joinedAt, projectMembers.userId)
        .all();

      const members = memberRows.map(
        (row): ProjectMember => ({
          ...row,
          level: levelFromXp(row.xp),
        }),
      );

      return { project: toProject(project), members };
    },
  );

  app.patch(
    "/api/projects/:pid",
    {
      preHandler: authenticate,
      schema: {
        params: projectParamsSchema,
        body: updateProjectRequestSchema,
        response: { 200: projectSchema },
      },
    },
    async (request) => {
      const { pid } = request.params;

      // Unknown projects are reported as 404; existing projects still hide
      // their membership from non-members (403).
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, pid))
        .get();
      if (!project) {
        throw new HttpError(404, "NOT_FOUND", "Project not found");
      }

      const membership = requireMembership(db, request.user!.id, pid);
      if (membership.role !== "owner") {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Only the guild owner can update this project",
        );
      }

      const updated = db
        .update(projects)
        .set({ name: request.body.name })
        .where(eq(projects.id, pid))
        .returning()
        .get();

      return toProject(updated);
    },
  );
};
