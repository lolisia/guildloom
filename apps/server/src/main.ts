/**
 * guildloom server entry point.
 *
 * Placeholder: the real bootstrap (config, SQLite, migrations, Fastify app)
 * lands in a later task and lives in `app.ts` so tests can build the app
 * without starting a listener.
 */
const DEFAULT_PORT = 8080;

const port = Number.parseInt(process.env.GUILDLOOM_PORT ?? "", 10);
const resolvedPort = Number.isNaN(port) ? DEFAULT_PORT : port;

console.log(`guildloom server placeholder (port ${resolvedPort})`);

export {};
