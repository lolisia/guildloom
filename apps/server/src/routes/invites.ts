/**
 * Invite routes (`/api/invites/*`, `/api/projects/:pid/invites`). Implemented
 * in T04.
 *
 * Keep the export name `inviteRoutes`: `app.ts` registers this plugin.
 */
import type { FastifyPluginAsync } from "fastify";

export const inviteRoutes: FastifyPluginAsync = async () => {
  // Routes land with the invite feature task.
};
