/**
 * guildloom server entry point.
 *
 * Production bootstrap: read the environment, create the data directory, open
 * (and migrate) SQLite, build the Fastify app, then listen. The startup only
 * runs when this file is the process entry point, so importing it from tests
 * has no side effects.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { openDb } from "./db/index.js";

/**
 * Built web client, resolved from both `src/main.ts` and `dist/main.js`:
 * `apps/server/(src|dist)/..` → `apps/server`, `..` → `apps`, then `web/dist`.
 */
export const WEB_DIST_PATH = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);

/** A server that has finished booting. */
export interface RunningServer {
  config: Config;
  app: FastifyInstance;
  /** Close Fastify and the SQLite connection (idempotent). */
  close(): Promise<void>;
}

/**
 * Start the production server.
 *
 * Registers SIGINT/SIGTERM handlers so the SQLite connection is closed
 * cleanly (WAL checkpoint) when the process is asked to stop.
 */
export async function startServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunningServer> {
  const config = loadConfig(env);

  mkdirSync(config.dataDir, { recursive: true });
  const { db, close: closeDb } = openDb(join(config.dataDir, "guildloom.db"));

  const app = await buildApp({
    db,
    trustProxy: config.trustProxy,
    webDistPath: WEB_DIST_PATH,
    logger: true,
  });

  let closing: Promise<void> | undefined;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      try {
        await app.close();
      } finally {
        closeDb();
      }
    })();
    return closing;
  };

  const shutdown = (signal: NodeJS.Signals): void => {
    app.log.info({ signal }, "shutting down guildloom server");
    void close().catch((error: unknown) => {
      app.log.error({ err: error }, "failed to shut down cleanly");
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error({ err: error }, "failed to start guildloom server");
    await close();
    process.exitCode = 1;
    throw error;
  }

  return { config, app, close };
}

/** True when this module was launched directly (`node dist/main.js`). */
function isEntryPoint(): boolean {
  const scriptPath = process.argv[1];
  if (scriptPath === undefined) {
    return false;
  }

  const currentPath = fileURLToPath(import.meta.url);
  const entryPath = resolve(scriptPath);

  return process.platform === "win32"
    ? currentPath.toLowerCase() === entryPath.toLowerCase()
    : currentPath === entryPath;
}

if (isEntryPoint()) {
  void startServer().catch((error: unknown) => {
    // `startServer` logs listener failures through Fastify already; this also
    // surfaces early failures (config, data dir, migrations) that happen before
    // the app exists. The error itself makes the process exit non-zero.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`guildloom server failed to start: ${message}`);
    process.exitCode = 1;
  });
}
