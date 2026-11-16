/**
 * Clear settlement and clear revocation: the one place that pays out (or takes
 * back) a dungeon clear.
 *
 * A clear freezes the current bounty, splits it across the active party
 * (leader first, then by `joined_at`), pays the requester bonus when the
 * quest's creator is not in the party, records the `quest_cleared` event and
 * drops a `quest_cleared` notification into every other member's inbox.
 *
 * Every new clear uses its own round (`quests.clear_round`). The first round
 * keeps the historical keys `clear:<questId>:<userId>` / `requester:<questId>`;
 * later rounds suffix `:r<round>`, so a quest that is cleared, revoked and
 * cleared again pays each round exactly once without colliding with the
 * cancelled round.
 *
 * Revoking a clear writes `revoke:<original key>` ledger rows and a
 * `clear_revoked` event, then takes the XP back (floored at zero, with the
 * level derived again). The caller owns the transaction and the realtime
 * fan-out: this module only mutates rows, so a rolled back route never pays or
 * revokes XP.
 */
import {
  REQUESTER_XP,
  computeBounty,
  splitClearXp,
  type Bounty,
  type ClearRevokedPayload,
  type LevelUp,
  type QuestClearedPayload,
} from "@guildloom/shared";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../db/index.js";
import {
  quests,
  users,
  xpLedger,
  type QuestRow,
  type UserRow,
} from "../db/schema.js";
import {
  createNotification,
  getActivePartyMembers,
  insertQuestEvent,
  type CreatedNotification,
} from "./party.js";
import { awardXp, revokeXp } from "./xp.js";

/** One adventurer's newly paid clear reward. */
export interface ClearReward {
  /** Adventurer that received XP. */
  userId: number;
  /** XP paid by this settlement. */
  amount: number;
}

/** An adventurer's total XP/level after this settlement awarded them XP. */
export interface ClearXpChange {
  userId: number;
  xp: number;
  level: number;
  /** Present only when the award crossed a level boundary. */
  levelUp?: LevelUp;
}

/** Everything a committed clear produced. */
export interface ClearSettlement {
  /** Rewards actually paid now (an idempotent replay pays nothing). */
  rewards: ClearReward[];
  /** Level crossings of the awards paid now. */
  levelUps: LevelUp[];
  /** `quest_cleared` notifications for active members except the actor. */
  notifications: CreatedNotification[];
  /** XP totals to broadcast to every user whose XP changed. */
  xpChanges: ClearXpChange[];
}

/** The quest columns the pure clear calculation reads. */
export type ClearPlanQuest = Pick<
  QuestRow,
  "createdAt" | "firstClaimedAt" | "createdBy"
>;

/** Everything a clear pays, computed without touching the database. */
export interface ClearRewardPlan {
  /** Bounty frozen for this clear. */
  bounty: Bounty;
  /** Active party shares in payout order (`leader` first); zero shares stay. */
  shares: ClearReward[];
  /** Requester bonus, or `null` when the creator is in the active party. */
  requester: ClearReward | null;
}

/** Everything a committed clear revocation produced. */
export interface ClearRevocation {
  /** XP actually taken back (the sum of user balances removed). */
  xpRevoked: number;
  /** XP totals to broadcast to every user the revocation touched. */
  xpChanges: ClearXpChange[];
  /** `clear_revoked` notifications for the requester and active members. */
  notifications: CreatedNotification[];
}

/** Display names for a set of user ids, resolved in one query. */
export function loadDisplayNames(
  db: AppDb,
  userIds: readonly number[],
): Map<number, string> {
  if (userIds.length === 0) {
    return new Map();
  }

  return new Map(
    db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, [...userIds]))
      .all()
      .map((row) => [row.id, row.displayName] as const),
  );
}

/**
 * Idempotency key of a party member's clear award in `round`.
 *
 * Round 1 deliberately keeps the legacy key: quests cleared before the round
 * column existed must still resolve to their original ledger rows.
 */
export function clearAwardKey(
  questId: number,
  userId: number,
  round: number,
): string {
  return round >= 2
    ? `clear:${questId}:${userId}:r${round}`
    : `clear:${questId}:${userId}`;
}

/** Idempotency key of the requester bonus in `round` (round 1 is legacy). */
export function requesterAwardKey(questId: number, round: number): string {
  return round >= 2 ? `requester:${questId}:r${round}` : `requester:${questId}`;
}

/** The round whose ledger keys describe the current clear (`r1` minimum). */
export function currentClearRound(
  quest: Pick<QuestRow, "clearRound">,
): number {
  return Math.max(quest.clearRound, 1);
}

/**
 * Compute the bounty, the active party shares and the requester bonus.
 *
 * Pure: the caller passes the frozen quest timestamps and the active member
 * ids in payout order. Both `settleClear` and the clear preview use this one
 * function, so the preview can never drift from the real settlement.
 */
export function planClearRewards(
  quest: ClearPlanQuest,
  memberIds: readonly number[],
  now: number,
): ClearRewardPlan {
  const ids = [...new Set(memberIds)];
  const bounty = computeBounty({
    createdAt: quest.createdAt,
    firstClaimedAt: quest.firstClaimedAt,
    now,
  });
  const split = splitClearXp(bounty.total, ids);

  const shares = ids.map((userId) => ({
    userId,
    amount: split[userId] ?? 0,
  }));

  // `splitClearXp` keeps the caller's order, so the leader receives the first
  // leftover unit. The requester earns a bonus only when they are not
  // fighting in the party themselves.
  const requester = ids.includes(quest.createdBy)
    ? null
    : { userId: quest.createdBy, amount: REQUESTER_XP };

  return { bounty, shares, requester };
}

/**
 * Settle a quest clear.
 *
 * The quest row moves to `cleared` at `orderKey`. A new clear increments
 * `clear_round`; re-settling a card that already sits in `cleared` (a reorder)
 * keeps its round and only replays the idempotent awards, so it writes no
 * event, notification or additional XP.
 *
 * Must be called inside the caller's transaction; a missing member or a
 * rolled back route leaves no ledger row behind.
 */
export function settleClear(
  db: AppDb,
  quest: QuestRow,
  actor: UserRow,
  now: number,
  orderKey: string,
): ClearSettlement {
  const activeMembers = getActivePartyMembers(db, quest.id);
  const memberIds = activeMembers.map((member) => member.userId);
  const reorder = quest.stage === "cleared";
  const round = reorder ? currentClearRound(quest) : quest.clearRound + 1;
  const plan = planClearRewards(quest, memberIds, now);

  db.update(quests)
    .set({
      stage: "cleared",
      orderKey,
      // Only a new clear advances the round; a reorder keeps whatever the row
      // already says (including a legacy 0).
      ...(reorder ? {} : { clearRound: round }),
      updatedAt: Math.max(now, quest.updatedAt + 1),
    })
    .where(eq(quests.id, quest.id))
    .run();

  const rewards: ClearReward[] = [];
  const levelUps: LevelUp[] = [];
  const xpChanges: ClearXpChange[] = [];

  // A zero share still claims its idempotency key so a later settlement can
  // never pay that member for this round.
  for (const share of plan.shares) {
    const result = awardXp(db, {
      userId: share.userId,
      projectId: quest.projectId,
      questId: quest.id,
      reason: "clear",
      amount: share.amount,
      idemKey: clearAwardKey(quest.id, share.userId, round),
      now,
    });
    if (!result.awarded || share.amount <= 0) {
      continue;
    }

    rewards.push({ userId: share.userId, amount: share.amount });
    if (result.levelUp) {
      levelUps.push(result.levelUp);
    }
    const change: ClearXpChange = {
      userId: share.userId,
      xp: result.xp,
      level: result.level,
    };
    if (result.levelUp) {
      change.levelUp = result.levelUp;
    }
    xpChanges.push(change);
  }

  if (plan.requester) {
    const result = awardXp(db, {
      userId: plan.requester.userId,
      projectId: quest.projectId,
      questId: quest.id,
      reason: "requester",
      amount: plan.requester.amount,
      idemKey: requesterAwardKey(quest.id, round),
      now,
    });
    if (result.awarded) {
      rewards.push({
        userId: plan.requester.userId,
        amount: plan.requester.amount,
      });
      if (result.levelUp) {
        levelUps.push(result.levelUp);
      }
      const change: ClearXpChange = {
        userId: plan.requester.userId,
        xp: result.xp,
        level: result.level,
      };
      if (result.levelUp) {
        change.levelUp = result.levelUp;
      }
      xpChanges.push(change);
    }
  }

  const names = loadDisplayNames(
    db,
    rewards.map((reward) => reward.userId),
  );

  const notifications: CreatedNotification[] = [];

  // Reordering a card that already sits in `cleared` is not a new clear: the
  // idempotent awards above pay nothing and the event/inbox stay untouched.
  if (!reorder) {
    const payload: QuestClearedPayload = {
      rewards: rewards.map((reward) => ({
        userId: reward.userId,
        name: names.get(reward.userId) ?? "알 수 없는 모험가",
        amount: reward.amount,
      })),
      bounty: plan.bounty,
    };

    insertQuestEvent(db, {
      questId: quest.id,
      projectId: quest.projectId,
      type: "quest_cleared",
      payload,
      actorUserId: actor.id,
      createdAt: now,
    });

    for (const member of activeMembers) {
      if (member.userId === actor.id) {
        continue;
      }
      notifications.push(
        createNotification(db, {
          userId: member.userId,
          projectId: quest.projectId,
          questId: quest.id,
          type: "quest_cleared",
          actorUserId: actor.id,
          payload: { bounty: plan.bounty },
          createdAt: now,
        }),
      );
    }
  }

  return { rewards, levelUps, notifications, xpChanges };
}

/**
 * Revoke the current clear round of a quest.
 *
 * Every `clear`/`requester` ledger award of the current round gets a
 * `revoke:<original key>` offset; `users.xp` is floored at zero and the level
 * is derived again (no level-down effect is reported). A `clear_revoked` event
 * and notifications for the requester plus the active party (except the actor)
 * are written. A legacy clear (`clear_round = 0`) is moved to round 1 so the
 * next clear uses the `:r2` keys.
 *
 * The caller owns the quest's stage/order change. Must run inside a
 * transaction together with that change.
 */
export function revokeClear(
  db: AppDb,
  quest: QuestRow,
  actor: UserRow,
  now: number,
): ClearRevocation {
  const round = currentClearRound(quest);
  const awards = db
    .select()
    .from(xpLedger)
    .where(
      and(
        eq(xpLedger.questId, quest.id),
        inArray(xpLedger.reason, ["clear", "requester"]),
      ),
    )
    .orderBy(asc(xpLedger.id))
    .all()
    .filter((row) =>
      row.reason === "clear"
        ? row.idemKey === clearAwardKey(quest.id, row.userId, round)
        : row.idemKey === requesterAwardKey(quest.id, round),
    );

  let xpRevoked = 0;
  const xpChanges: ClearXpChange[] = [];

  for (const award of awards) {
    const result = revokeXp(db, {
      userId: award.userId,
      projectId: quest.projectId,
      questId: quest.id,
      amount: award.amount,
      originalIdemKey: award.idemKey,
      now,
    });
    if (!result.revoked) {
      continue;
    }

    xpRevoked += result.amount;
    // A clamped user still loses their award (their balance just cannot go
    // below zero), so they receive the resulting totals as well. Zero-amount
    // ledger rows are bookkeeping only and produce no XP signal.
    if (award.amount > 0) {
      xpChanges.push({
        userId: award.userId,
        xp: result.xp,
        level: result.level,
      });
    }
  }

  // Canonicalise the pre-migration state: the clear used the legacy r1 keys,
  // so the next clear must start at r2. Later rounds already carry their
  // number and stay put.
  if (quest.clearRound === 0) {
    db.update(quests)
      .set({ clearRound: 1 })
      .where(eq(quests.id, quest.id))
      .run();
  }

  const payload: ClearRevokedPayload = { xpRevoked };
  insertQuestEvent(db, {
    questId: quest.id,
    projectId: quest.projectId,
    type: "clear_revoked",
    payload,
    actorUserId: actor.id,
    createdAt: now,
  });

  const recipientIds = new Set<number>([quest.createdBy]);
  for (const member of getActivePartyMembers(db, quest.id)) {
    recipientIds.add(member.userId);
  }

  const notifications: CreatedNotification[] = [];
  for (const userId of recipientIds) {
    if (userId === actor.id) {
      continue;
    }
    notifications.push(
      createNotification(db, {
        userId,
        projectId: quest.projectId,
        questId: quest.id,
        type: "clear_revoked",
        actorUserId: actor.id,
        payload,
        createdAt: now,
      }),
    );
  }

  return { xpRevoked, xpChanges, notifications };
}
