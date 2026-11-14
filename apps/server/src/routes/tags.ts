/**
 * Tag routes (`/api/projects/:pid/tags`).
 *
 * Autocomplete lists project tags with their usage count. Tags are created
 * implicitly by the quest routes; this module only reads them.
 *
 * Keep the export name `tagRoutes`: `app.ts` registers this plugin.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  tagAutocompleteQuerySchema,
  tagListResponseSchema,
  type TagSummary,
} from "@guildloom/shared";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";

import type { AppDb } from "../db/index.js";
import { projects, questTags, tags } from "../db/schema.js";
import { authenticate, requireMembership } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";

/** Numeric route parameters (`:pid`). */
const projectParamsSchema = z.object({
  pid: z.coerce.number().int().positive(),
});

/** Escape `%`, `_` and `\` so user input is matched literally inside LIKE. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Resolve `:pid` to a project the user is a member of. */
function requireProjectMember(
  db: AppDb,
  projectId: number,
  userId: number,
): void {
  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    throw new HttpError(404, "NOT_FOUND", "Project not found");
  }
  requireMembership(db, userId, projectId);
}

/** Tags of a project matching `q`, most used first, then alphabetically. */
function listTags(db: AppDb, projectId: number, query: string): TagSummary[] {
  const usage = sql<number>`count(${questTags.tagId})`;
  const conditions: SQL[] = [eq(tags.projectId, projectId)];

  const search = query.trim();
  if (search.length > 0) {
    conditions.push(
      sql`${tags.name} LIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'`,
    );
  }

  return db
    .select({ id: tags.id, name: tags.name, count: usage })
    .from(tags)
    .leftJoin(questTags, eq(questTags.tagId, tags.id))
    .where(and(...conditions))
    .groupBy(tags.id)
    .orderBy(desc(usage), asc(tags.name))
    .limit(20)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      count: Number(row.count),
    }));
}

export const tagRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/projects/:pid/tags",
    {
      schema: {
        params: projectParamsSchema,
        querystring: tagAutocompleteQuerySchema,
        response: { 200: tagListResponseSchema },
      },
      preHandler: authenticate,
    },
    async (request) => {
      const user = request.user;
      if (!user) {
        throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
      }

      const db = request.server.db;
      const { pid } = request.params;
      requireProjectMember(db, pid, user.id);
      return listTags(db, pid, request.query.q ?? "");
    },
  );
};
