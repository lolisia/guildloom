/**
 * SPA static asset serving.
 *
 * In production the built web client (`apps/web/dist`) is served by the same
 * Fastify instance as the API. Built files are served with `@fastify/static`;
 * every other non-API `GET`/`HEAD` request falls back to `index.html` so the
 * client-side router owns the URL (SPA fallback). `/api` and `/api/*` never
 * receive HTML: they keep the JSON `NOT_FOUND` envelope from `app.ts`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const INDEX_FILE = "index.html";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Absolute path of the built web client when SPA static serving is active.
     * Undefined when no dist (or no `index.html`) was found at startup.
     */
    webDistPath?: string;
  }
}

/**
 * Register static serving for the built web client.
 *
 * Does nothing when `<webDistPath>/index.html` does not exist, which keeps the
 * server usable in development (Vite serves the client) and in tests. When the
 * dist is present, `@fastify/static` serves known files and delegates unknown
 * GET/HEAD paths to the app not-found handler via `reply.callNotFound()`.
 */
export async function registerSpaStatic(
  app: FastifyInstance,
  webDistPath: string,
): Promise<void> {
  if (!existsSync(join(webDistPath, INDEX_FILE))) {
    return;
  }

  await app.register(fastifyStatic, { root: webDistPath });
  app.decorate("webDistPath", webDistPath);
}

/**
 * Serve `index.html` for SPA routes on not-found.
 *
 * Returns `false` (so the caller can send the JSON API error) when:
 * - no web dist was registered,
 * - the request is not a GET/HEAD,
 * - the request targets `/api` or `/api/*`, or
 * - the index file disappeared since startup.
 */
export async function maybeServeSpaIndex(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const webDistPath = request.server.webDistPath;
  if (webDistPath === undefined) {
    return false;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  if (isApiPath(request.url)) {
    return false;
  }

  if (!existsSync(join(webDistPath, INDEX_FILE))) {
    return false;
  }

  // `reply.sendFile` streams `index.html` with the right content type. The
  // status is explicitly reset because the not-found handler may be invoked
  // after a 404 route attempt and the fallback itself is a success. The reply
  // is thenable and resolves once the body has been flushed, so the not-found
  // handler does not finish before the index is sent.
  reply.code(200);
  reply.sendFile(INDEX_FILE);
  await reply;
  return true;
}

/** Pathname part of the raw request URL, without the query string. */
function requestPathname(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

/** True for `/api` and everything below it. */
function isApiPath(url: string): boolean {
  const pathname = requestPathname(url);
  return pathname === "/api" || pathname.startsWith("/api/");
}
