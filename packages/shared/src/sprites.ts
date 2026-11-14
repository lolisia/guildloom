/**
 * Adventure sprite sheet manifest types.
 *
 * The web client renders placeholder avatars in M1 but keeps this interface
 * stable so that real sprite sheets can be dropped in later.
 */

/** States an adventurer sprite can be in. */
export const ADVENTURER_STATES = [
  "idle",
  "walk",
  "attack",
  "hurt",
  "victory",
] as const;

/** An adventurer sprite state. */
export type AdventurerState = (typeof ADVENTURER_STATES)[number];

/** One animation range within a sprite sheet. */
export interface SpriteAnimation {
  /** Inclusive `[start, end]` frame range. */
  frames: [number, number];
  /** Frames per second. */
  fps: number;
}

/** Layout of a sprite sheet and its per-state animations. */
export interface SpriteManifest {
  sheet: string;
  frameWidth: number;
  frameHeight: number;
  animations: Record<AdventurerState, SpriteAnimation>;
}
