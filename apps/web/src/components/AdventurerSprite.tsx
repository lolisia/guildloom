/**
 * Placeholder adventurer avatar.
 *
 * M1 has no sprite sheet yet, so this renders a square with the first character
 * of the display name over a deterministic, per-user colour. The props
 * interface is fixed: later tasks can swap the internals for a real sprite
 * sheet without touching call sites. Animation state is exposed only through
 * `data-state` so styling/tests do not depend on the render shape.
 *
 * Shape follows DESIGN.md: 2px corners (never a circle), a 1.5px `line-strong`
 * outline, a light initial and no shadow. Backgrounds come from the mid-tones
 * of the JRPG icon palette so avatars sit in the same world as the quest icons;
 * each one is checked against the initial colour for WCAG AA (4.5:1) in both
 * themes by `test/sprite.test.tsx`.
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

/**
 * Initial colour for every avatar, independent of the active theme.
 *
 * This is the light-theme paper value, mirrored as `--color-avatar-ink` in
 * `index.css` (never overridden under `[data-theme="dark"]`). Reusing
 * `--color-paper` would render the initial `#23232F` in dark mode, which drops
 * most palette mid-tones to 1.2–3.5:1. Keeping the light value in both themes
 * lets every palette entry clear WCAG AA (4.5:1).
 */
export const AVATAR_INITIAL_COLOR = "#FAFAF6";

/**
 * Mid-tones from the `jrpg-v1` palette. Every entry is dark enough for the
 * theme-independent {@link AVATAR_INITIAL_COLOR} initial (≥ 4.5:1); `test/
 * sprite.test.tsx` fails if a colour is added or lightened below that bar.
 */
export const AVATAR_COLORS = [
  "#20585b",
  "#793d35",
  "#614a28",
  "#35516b",
  "#654365",
  "#482d2b",
  "#287b79",
  "#806046",
  "#a65343",
  "#8a6426",
  "#56768e",
  "#2d786e",
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

/** Square avatar placeholder for an adventurer. */
export function AdventurerSprite({
  userId,
  displayName,
  state = "idle",
  size = "sm",
}: AdventurerSpriteProps) {
  const initial = avatarInitial(displayName);

  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-sm border-[1.5px] border-line-strong font-bold leading-none text-avatar-ink ${SIZE_CLASSES[size]}`}
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
