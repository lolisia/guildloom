/**
 * Clear settlement: the one place that pays out a dungeon clear.
 *
 * A clear freezes the current bounty, splits it across the active party
 * (leader first, then by `joined_at`), pays the requester bonus when the
 * quest's creator is not in the party, records the `quest_cleared` event and
 * drops a `quest_cleared` notification into every other member's inbox.
 * Re-settling a card that is already cleared only replays the idempotent
 * awards: no second event or notification is produced.
 *
 * Every award goes through {@link awardXp}, so the idempotency keys
 * `clear:<questId>:<userId>` / `requester:<questId>` make repeated settlements
 * (a second clear after moving the card out, or dragging it back in) free of
 * double payments. The caller owns the transaction and the realtime fan-out:
 * this module only mutates rows, so a rolled back route never pays XP.
 */
import {
  REQUESTER_XP,
  computeBounty,
  splitClearXp,
  type LevelUp,
  type QuestClearedPayload,
} from "@guildloom/shared";
import { eq, inArray } from "drizzle-orm";

import type { AppDb } from "../db/index.js";
import { quests, users, type QuestRow, type UserRow } from "../db/schema.js";
import {
  createNotification,
  getActivePartyMembers,
  insertQuestEvent,
  type CreatedNotification,
} from "./party.js";
import { awardXp } from "./xp.js";

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

/** Display names for a set of user ids, resolved in one query. */
function loadDisplayNames(
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
 * Settle a quest clear.
 *
 * The quest row moves to `cleared` at `orderKey`, the bounty is computed from
 * the frozen `firstClaimedAt` (or `now` while unclaimed), the active party is
 * paid leader first, the requester bonus is paid when the creator is not an
 * active member, and the event/notifications are written.
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
  const activeIds = new Set(memberIds);

  db.update(quests)
    .set({
      stage: "cleared",
      orderKey,
      updatedAt: Math.max(now, quest.updatedAt + 1),
    })
    .where(eq(quests.id, quest.id))
    .run();

  const bounty = computeBounty({
    rank: quest.rank,
    createdAt: quest.createdAt,
    firstClaimedAt: quest.firstClaimedAt,
    now,
  });
  const shares = splitClearXp(bounty.total, memberIds);

  const rewards: ClearReward[] = [];
  const levelUps: LevelUp[] = [];
  const xpChanges: ClearXpChange[] = [];

  // `splitClearXp` keeps the caller's order, so the leader receives the first
  // leftover unit. A zero share still claims its idempotency key so a later
  // settlement can never pay that member for this clear.
  for (const userId of memberIds) {
    const amount = shares[userId] ?? 0;
    const result = awardXp(db, {
      userId,
      projectId: quest.projectId,
      questId: quest.id,
      reason: "clear",
      amount,
      idemKey: `clear:${quest.id}:${userId}`,
      now,
    });
    if (!result.awarded || amount <= 0) {
      continue;
    }

    rewards.push({ userId, amount });
    if (result.levelUp) {
      levelUps.push(result.levelUp);
    }
    const change: ClearXpChange = {
      userId,
      xp: result.xp,
      level: result.level,
    };
    if (result.levelUp) {
      change.levelUp = result.levelUp;
    }
    xpChanges.push(change);
  }

  // The requester (의뢰인) earns a small bonus only when they are not fighting
  // in the party themselves.
  if (!activeIds.has(quest.createdBy)) {
    const result = awardXp(db, {
      userId: quest.createdBy,
      projectId: quest.projectId,
      questId: quest.id,
      reason: "requester",
      amount: REQUESTER_XP,
      idemKey: `requester:${quest.id}`,
      now,
    });
    if (result.awarded) {
      rewards.push({ userId: quest.createdBy, amount: REQUESTER_XP });
      if (result.levelUp) {
        levelUps.push(result.levelUp);
      }
      const change: ClearXpChange = {
        userId: quest.createdBy,
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
  if (quest.stage !== "cleared") {
    const payload: QuestClearedPayload = {
      rewards: rewards.map((reward) => ({
        userId: reward.userId,
        name: names.get(reward.userId) ?? "알 수 없는 모험가",
        amount: reward.amount,
      })),
      bounty,
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
          payload: { bounty },
          createdAt: now,
        }),
      );
    }
  }

  return { rewards, levelUps, notifications, xpChanges };
}
