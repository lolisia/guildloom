/**
 * Adventurer level curve.
 *
 * `xpForLevel(n) = 50 * n * (n - 1)` — level 1 starts at 0 XP, level 2 at 100,
 * level 3 at 300, and so on.
 */

/** Progress of an adventurer within their current level. */
export interface LevelProgress {
  /** Current level (minimum 1). */
  level: number;
  /** XP accumulated since reaching the current level. */
  current: number;
  /** XP span of the current level (XP needed to reach the next level). */
  next: number;
}

/** Total XP required to reach `level`. */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

/** Highest level whose entry threshold is at or below `xp` (minimum 1). */
export function levelFromXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= xpForLevel(1)) {
    return 1;
  }

  // Closed-form estimate of the quadratic, then correct for rounding.
  let level = Math.max(
    1,
    Math.floor((1 + Math.sqrt(1 + (8 * xp) / 50)) / 2),
  );
  while (xpForLevel(level + 1) <= xp) {
    level += 1;
  }
  while (level > 1 && xpForLevel(level) > xp) {
    level -= 1;
  }
  return level;
}

/** Current level plus progress toward the next one. */
export function levelProgress(xp: number): LevelProgress {
  const level = levelFromXp(xp);
  const levelStart = xpForLevel(level);
  return {
    level,
    current: Math.max(0, xp - levelStart),
    next: xpForLevel(level + 1) - levelStart,
  };
}
