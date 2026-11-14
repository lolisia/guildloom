/**
 * First-run setup routes (`/api/setup*`). Implemented in T04.
 *
 * Keep the export name `setupRoutes`: `app.ts` registers this plugin.
 */
import type { FastifyPluginAsync } from "fastify";

export const setupRoutes: FastifyPluginAsync = async () => {
  // Routes land with the setup/auth feature task.
};
