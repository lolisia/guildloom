/**
 * Bounty (현상금) calculation for unclaimed quests.
 *
 * The bounty is never stored: every read computes it from the quest's rank,
 * creation time and the moment the party first formed. The multiplier grows by
 * {@link BOUNTY_STEP} per full day on the board (starting at 1×) and caps at
 * {@link BOUNTY_CAP}. Once the cap is reached, an unclaimed quest turns
 * "dusty" after {@link DUSTY_DAYS_AFTER_CAP} more days.
 */
import type { Bounty } from "./api.js";
import {
  BOUNTY_CAP,
  BOUNTY_STEP,
  DEFAULT_RANK,
  DUSTY_DAYS_AFTER_CAP,
  RANK_XP,
  type Rank,
} from "./constants.js";

/** Milliseconds in one day. */
const MS_PER_DAY = 86_400_000;

/**
 * Days on the board after which the bounty is capped and an unclaimed quest
 * becomes dusty: `(BOUNTY_CAP - 1) / BOUNTY_STEP + DUSTY_DAYS_AFTER_CAP` (12).
 */
export const DUSTY_AFTER_DAYS =
  (BOUNTY_CAP - 1) / BOUNTY_STEP + DUSTY_DAYS_AFTER_CAP;

/** Inputs for {@link computeBounty}. */
export interface BountyInput {
  /** Quest rank; a missing rank falls back to {@link DEFAULT_RANK}. */
  rank: Rank | null | undefined;
  /** When the quest was posted (epoch ms). */
  createdAt: number;
  /** When the first party member joined; `null`/`undefined` while unclaimed. */
  firstClaimedAt: number | null | undefined;
  /** The moment to evaluate at (epoch ms), normally `Date.now()`. */
  now: number;
}

/**
 * Compute the current bounty of a quest.
 *
 * `end` is `firstClaimedAt ?? now`, so the multiplier freezes as soon as the
 * first party member joins. `dusty` only applies while the quest is still
 * unclaimed.
 */
export function computeBounty({
  rank,
  createdAt,
  firstClaimedAt,
  now,
}: BountyInput): Bounty {
  const base = RANK_XP[rank ?? DEFAULT_RANK];
  const claimedAt = firstClaimedAt ?? null;
  const end = claimedAt ?? now;
  const days = Math.max(0, Math.floor((end - createdAt) / MS_PER_DAY));

  // The step is a decimal constant, so round away binary float noise (1.6
  // instead of 1.6000000000000001) before exposing the multiplier.
  const multiplier =
    Math.round(Math.min(1 + BOUNTY_STEP * days, BOUNTY_CAP) * 100) / 100;

  return {
    base,
    multiplier,
    total: Math.round(base * multiplier),
    days,
    dusty: claimedAt === null && days >= DUSTY_AFTER_DAYS,
  };
}
