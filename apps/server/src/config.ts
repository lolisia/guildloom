/**
 * Server runtime configuration.
 *
 * All settings are optional and come from `GUILDLOOM_*` environment variables.
 * `loadConfig` validates them eagerly so a bad deployment fails at startup with
 * a message naming the offending variable instead of a cryptic connect error.
 */

/** Resolved server configuration. */
export interface Config {
  /** TCP port to listen on (1-65535). */
  port: number;
  /** Host/interface to bind (`0.0.0.0` binds every interface). */
  host: string;
  /** Directory that stores `guildloom.db` (created on startup when missing). */
  dataDir: string;
  /** Trust `X-Forwarded-*` headers from a reverse proxy. */
  trustProxy: boolean;
}

export const DEFAULT_PORT = 8080;
export const DEFAULT_HOST = "0.0.0.0";
export const DEFAULT_DATA_DIR = "./data";
export const DEFAULT_TRUST_PROXY = false;

const TRUST_PROXY_TRUE_VALUES = new Set(["true", "1"]);
const TRUST_PROXY_FALSE_VALUES = new Set(["false", "0"]);

/**
 * Read and validate the server configuration.
 *
 * Unset variables fall back to the documented defaults. Set but invalid values
 * throw an {@link Error} whose message names the environment variable.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: parsePort(env.GUILDLOOM_PORT),
    host: parseHost(env.GUILDLOOM_HOST),
    dataDir: parseDataDir(env.GUILDLOOM_DATA_DIR),
    trustProxy: parseTrustProxy(env.GUILDLOOM_TRUST_PROXY),
  };
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_PORT;
  }

  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `Invalid GUILDLOOM_PORT "${raw}": expected an integer between 1 and 65535`,
    );
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid GUILDLOOM_PORT "${raw}": expected an integer between 1 and 65535`,
    );
  }

  return port;
}

function parseHost(raw: string | undefined): string {
  if (raw === undefined) {
    return DEFAULT_HOST;
  }

  const host = raw.trim();
  if (host.length === 0) {
    throw new Error(
      "Invalid GUILDLOOM_HOST: expected a non-empty host name or IP address",
    );
  }

  return host;
}

function parseDataDir(raw: string | undefined): string {
  if (raw === undefined) {
    return DEFAULT_DATA_DIR;
  }

  const dataDir = raw.trim();
  if (dataDir.length === 0) {
    throw new Error(
      "Invalid GUILDLOOM_DATA_DIR: expected a non-empty directory path",
    );
  }

  return dataDir;
}

function parseTrustProxy(raw: string | undefined): boolean {
  if (raw === undefined) {
    return DEFAULT_TRUST_PROXY;
  }

  const value = raw.trim();
  if (TRUST_PROXY_TRUE_VALUES.has(value)) {
    return true;
  }
  if (TRUST_PROXY_FALSE_VALUES.has(value)) {
    return false;
  }

  throw new Error(
    `Invalid GUILDLOOM_TRUST_PROXY "${raw}": expected "true", "1", "false" or "0"`,
  );
}
