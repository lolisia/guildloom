/**
 * Conversion from database rows to the shared API response shapes.
 */
import { levelFromXp, type UserProfile } from "@guildloom/shared";

import type { UserRow } from "../db/schema.js";

/** Public adventurer profile (never exposes the password hash). */
export function toUserProfile(user: UserRow): UserProfile {
  return {
    id: user.id,
    loginId: user.loginId,
    displayName: user.displayName,
    xp: user.xp,
    level: levelFromXp(user.xp),
  };
}
