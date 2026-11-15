/**
 * XP ledger and level bookkeeping.
 *
 * Every award carries an idempotency key; replaying the same key (a retried
 * clear, a re-accepted relay nomination) can never pay twice. The ledger row
 * and the `users.xp` bump happen in the same transaction as the caller's work,
 * so XP can never be paid for a rolled back action.
 */
import { levelFromXp, type LevelUp, type XpReason } from "@guildloom/shared";
import { eq } from "drizzle-orm";

import type { AppDb } from "../db/index.js";
import { users, xpLedger } from "../db/schema.js";
import { HttpError } from "./errors.js";

/** Input for {@link awardXp}. */
export interface AwardXpInput {
  /** Adventurer receiving the XP. */
  userId: number;
  /** Guild the award belongs to (kept for history and member broadcasts). */
  projectId: number;
  /** Quest that caused the award, or `null` for a non-quest award. */
  questId: number | null;
  /** Why the XP is paid (`clear`, `requester` or `guide`). */
  reason: XpReason;
  /** XP amount; may be zero for a no-op award. */
  amount: number;
  /** Idempotency key; unique across the whole ledger. */
  idemKey: string;
  /** Timestamp stored on the ledger row (epoch ms). */
  now: number;
}

/** Result of {@link awardXp}. */
export interface AwardXpResult {
  /** `false` when `idemKey` was already paid and nothing changed. */
  awarded: boolean;
  /** The adventurer's total XP after the call. */
  xp: number;
  /** Level implied by {@link xp}. */
  level: number;
  /** Present only when the award crossed a level boundary. */
  levelUp?: LevelUp;
}

/**
 * Pay XP to an adventurer exactly once per `idemKey`.
 *
 * The ledger insert is the source of truth: a duplicate key skips the
 * `users.xp` update entirely. A missing user is a programming error surfaced
 * as the standard 404 so a route can never silently lose an award.
 */
export function awardXp(db: AppDb, input: AwardXpInput): AwardXpResult {
  const user = db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .get();
  if (!user) {
    throw new HttpError(404, "NOT_FOUND", "User not found");
  }

  const inserted = db
    .insert(xpLedger)
    .values({
      userId: input.userId,
      projectId: input.projectId,
      questId: input.questId,
      reason: input.reason,
      amount: input.amount,
      idemKey: input.idemKey,
      createdAt: input.now,
    })
    .onConflictDoNothing({ target: xpLedger.idemKey })
    .run();

  if (inserted.changes === 0) {
    // Already paid: report the current totals without touching them again.
    return {
      awarded: false,
      xp: user.xp,
      level: levelFromXp(user.xp),
    };
  }

  const previousLevel = levelFromXp(user.xp);
  const xp = user.xp + input.amount;
  db.update(users).set({ xp }).where(eq(users.id, input.userId)).run();

  const level = levelFromXp(xp);
  const result: AwardXpResult = { awarded: true, xp, level };
  if (level > previousLevel) {
    result.levelUp = { userId: input.userId, from: previousLevel, to: level };
  }
  return result;
}
