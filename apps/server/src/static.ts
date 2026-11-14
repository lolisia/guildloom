/**
 * SPA static asset serving.
 *
 * Stub: T09 implements `@fastify/static` registration and the index.html
 * fallback used by the not-found handler.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/**
 * Register static serving for the built web client when `webDistPath` exists.
 * Currently a no-op; T09 replaces the body.
 */
export async function registerSpaStatic(
  _app: FastifyInstance,
  _webDistPath: string,
): Promise<void> {
  // Intentionally empty until the production static task lands.
}

/**
 * Serve `index.html` for SPA routes on not-found.
 * Currently always declines so the JSON 404 handler responds.
 */
export async function maybeServeSpaIndex(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<boolean> {
  return false;
}
