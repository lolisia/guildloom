/**
 * Password hashing using Node's built-in scrypt.
 *
 * Stored format: `scrypt$<salt base64url>$<hash base64url>`. Hashing stays
 * synchronous because better-sqlite3 transactions and Fastify handlers are
 * synchronous anyway; scrypt's default cost is acceptable at this team size.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCHEME = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Hash a plaintext password into a self-describing storable string. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, KEY_BYTES);
  return `${SCHEME}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Constant-time verification of a password against a stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3) {
    return false;
  }

  const [scheme, saltPart, hashPart] = parts;
  if (scheme !== SCHEME || !saltPart || !hashPart) {
    return false;
  }

  const salt = Buffer.from(saltPart, "base64url");
  const expected = Buffer.from(hashPart, "base64url");
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  const actual = scryptSync(password, salt, expected.length);
  return (
    actual.length === expected.length && timingSafeEqual(actual, expected)
  );
}
