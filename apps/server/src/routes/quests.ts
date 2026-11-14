/**
 * Quest routes (`/api/projects/:pid/quests`, `/api/quests/*`). Implemented in
 * T05.
 *
 * Keep the export name `questRoutes`: `app.ts` registers this plugin.
 */
import type { FastifyPluginAsync } from "fastify";

export const questRoutes: FastifyPluginAsync = async () => {
  // Routes land with the quest feature task.
};
