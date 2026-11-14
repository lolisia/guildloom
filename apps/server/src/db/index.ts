/**
 * SQLite connection helpers.
 *
 * `openDb` is the single place that opens better-sqlite3, applies the pragmas
 * the whole server relies on (WAL journaling and foreign key enforcement) and
 * runs the drizzle-kit generated migrations.
 */
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema.js";

/** Drizzle database handle bound to the guildloom schema. */
export type AppDb = BetterSQLite3Database<typeof schema>;

/** Options for {@link openDb}. */
export interface OpenDbOptions {
  /** Apply pending migrations (default: true). */
  migrate?: boolean;
  /** Folder containing the drizzle-kit migration SQL (default: `apps/server/drizzle`). */
  migrationsFolder?: string;
}

/** Open database handle plus the underlying better-sqlite3 connection. */
export interface OpenDbResult {
  db: AppDb;
  sqlite: Database.Database;
  close(): void;
}

/** Default migrations folder, resolved from both `src/db` and `dist/db`. */
export const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

/**
 * Open a SQLite database and (by default) migrate it to the latest schema.
 *
 * Pass `:memory:` for throwaway databases in tests.
 */
export function openDb(
  filePath: string,
  options: OpenDbOptions = {},
): OpenDbResult {
  const sqlite = new Database(filePath);

  // WAL is the documented deployment mode; in-memory databases ignore it and
  // keep their built-in journal, which is fine for tests.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  if (options.migrate !== false) {
    migrate(db, {
      migrationsFolder: options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER,
    });
  }

  return {
    db,
    sqlite,
    close() {
      sqlite.close();
    },
  };
}

declare module "fastify" {
  interface FastifyInstance {
    /** Drizzle handle decorated onto the Fastify instance by `buildApp`. */
    db: AppDb;
  }
}
