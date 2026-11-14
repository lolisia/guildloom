/**
 * Placeholder adventurer avatar.
 *
 * M1 has no sprite sheet yet, so this renders a rounded square with the first
 * character of the display name over a deterministic, per-user colour. The
 * props interface is fixed: later tasks can swap the internals for a real
 * sprite sheet without touching call sites. Animation state is exposed only
 * through `data-state` so styling/tests do not depend on the render shape.
 */
import type { AdventurerState } from "@guildloom/shared";

/** Fixed avatar sizes. */
export type AdventurerSpriteSize = "sm" | "md" | "lg";

/** Props for {@link AdventurerSprite}. This interface is stable for M1. */
export interface AdventurerSpriteProps {
  userId: number;
  displayName: string;
  /** Animation state; defaults to `"idle"`. */
  state?: AdventurerState;
  /** Rendered size; defaults to `"sm"`. */
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASSES: Record<AdventurerSpriteSize, string> = {
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-14 w-14 text-xl",
};

/** Palette intentionally readable against the dark guild UI. */
const AVATAR_COLORS = [
  "#b45309",
  "#a16207",
  "#4d7c0f",
  "#15803d",
  "#0f766e",
  "#0e7490",
  "#1d4ed8",
  "#6d28d9",
  "#a21caf",
  "#be123c",
  "#b91c1c",
  "#475569",
] as const;

/** FNV-1a hash; deterministic across browsers and Node. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Stable placeholder background for a user id. */
export function avatarColorForUserId(userId: number): string {
  const normalized = Number.isFinite(userId) ? Math.trunc(userId) : 0;
  const index = hashString(`guildloom:user:${normalized}`) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index] ?? AVATAR_COLORS[0];
}

/** First Unicode code point of a display name, or `"?"` when empty. */
export function avatarInitial(displayName: string): string {
  const [first] = Array.from(displayName.trim());
  return first ?? "?";
}

/** Rounded-square avatar placeholder for an adventurer. */
export function AdventurerSprite({
  userId,
  displayName,
  state = "idle",
  size = "sm",
}: AdventurerSpriteProps) {
  const initial = avatarInitial(displayName);

  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-md font-bold leading-none text-white shadow-inner ${SIZE_CLASSES[size]}`}
      style={{ backgroundColor: avatarColorForUserId(userId) }}
      data-user-id={userId}
      data-state={state}
      role="img"
      aria-label={displayName}
      title={displayName}
    >
      {initial}
    </span>
  );
}

export default AdventurerSprite;
