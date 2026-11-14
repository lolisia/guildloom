/**
 * Fastify application factory.
 *
 * `buildApp` wires the database handle, cookies, Zod validation/serialization,
 * all route plugins and the JSON error envelope. It never listens; `main.ts`
 * and tests decide whether to call `listen` or `inject`.
 */
import cookie from "@fastify/cookie";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ZodError } from "zod";

import type { AppDb } from "./db/index.js";
import { HttpError, sendApiError } from "./lib/errors.js";
import { authRoutes } from "./routes/auth.js";
import { inviteRoutes } from "./routes/invites.js";
import { projectRoutes } from "./routes/projects.js";
import { questRoutes } from "./routes/quests.js";
import { setupRoutes } from "./routes/setup.js";
import { tagRoutes } from "./routes/tags.js";
import { maybeServeSpaIndex, registerSpaStatic } from "./static.js";

/** Options accepted by {@link buildApp}. */
export interface BuildAppOptions {
  /** Open database handle (decorated onto the Fastify instance as `db`). */
  db: AppDb;
  /** Trust `X-Forwarded-*` headers (default: false). */
  trustProxy?: boolean;
  /** Path to the built web client; enables SPA static serving when set. */
  webDistPath?: string;
  /** Enable Fastify's logger (default: false). */
  logger?: boolean;
}

/** Render a request-validation failure into a single human readable message. */
function formatValidationMessage(error: FastifyError | ZodError): string {
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    return details.join("; ") || "Invalid request";
  }

  if (Array.isArray(error.validation) && error.validation.length > 0) {
    const details = error.validation.map((entry) => {
      const path = entry.instancePath.replace(/^\//, "").replace(/\//g, ".");
      const message = entry.message ?? "Invalid value";
      return path ? `${path}: ${message}` : message;
    });
    return details.join("; ");
  }

  return error.message || "Invalid request";
}

/**
 * Build the Fastify instance used by the server entry point and the tests.
 *
 * The returned app is ready to `listen` or `inject`, but not started.
 */
export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.trustProxy ?? false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  app.decorate("db", options.db);

  if (options.webDistPath) {
    await registerSpaStatic(app, options.webDistPath);
  }

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof HttpError) {
      return sendApiError(reply, error.statusCode, error.code, error.message);
    }

    if (
      hasZodFastifySchemaValidationErrors(error) ||
      error instanceof ZodError ||
      Array.isArray(error.validation)
    ) {
      return sendApiError(
        reply,
        400,
        "VALIDATION_ERROR",
        formatValidationMessage(error),
      );
    }

    // Fastify's own client errors (malformed JSON, body too large, ...) keep
    // their status instead of being masked as server failures.
    if (
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return sendApiError(
        reply,
        error.statusCode,
        error.code || "BAD_REQUEST",
        error.message,
      );
    }

    request.log.error({ err: error }, "unhandled request error");
    return sendApiError(reply, 500, "INTERNAL_ERROR", "Internal server error");
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (await maybeServeSpaIndex(request, reply)) {
      return;
    }
    await sendApiError(reply, 404, "NOT_FOUND", "Not found");
  });

  await app.register(setupRoutes);
  await app.register(authRoutes);
  await app.register(inviteRoutes);
  await app.register(projectRoutes);
  await app.register(tagRoutes);
  await app.register(questRoutes);

  return app;
}
