/**
 * Shared bookkeeping for clear and unclear mutations.
 *
 * A clear changes the quest, the board/ledger lists, the adventure log, the
 * bell, the adventurer's XP (and possibly level) and the guild members, so all
 * of those queries are invalidated together. The success feedback is the 10s
 * `던전 클리어!` toast with a 되돌리기 action rather than an inline banner: the
 * toast outlives the drawer (and also covers a board drop that never opened
 * one), so its action talks to the API and the query client directly.
 */
import { questClearedPayloadSchema } from "@guildloom/shared";
import type { ClearPreviewResponse, QuestEvent } from "@guildloom/shared";
import type { QueryClient } from "@tanstack/react-query";

import { unclearQuest } from "../../api/quests";
import { ko } from "../../i18n/ko";
import { queryKeys } from "../../lib/queryKeys";
import { pushToast } from "../../lib/toast";

/** How long the clear celebration toast (with its undo action) stays. */
export const CLEAR_TOAST_DURATION_MS = 10_000;

/** One XP payout row, independent of whether it names the recipient. */
export interface RewardShare {
  userId: number;
  amount: number;
}

/** Sum the XP a clear paid to `userId` (0 when the caller is unknown). */
export function sumMyReward(
  rewards: readonly RewardShare[],
  userId: number | null,
): number {
  if (userId === null) {
    return 0;
  }
  return rewards
    .filter((reward) => reward.userId === userId)
    .reduce((total, reward) => total + reward.amount, 0);
}

/**
 * The caller's total from a clear preview.
 *
 * The preview keeps party shares (`rewards`) and the requester bonus in two
 * fields, unlike the clear response where both end up in `rewards`; adding the
 * bonus back when it belongs to the caller makes the drag-drop toast report the
 * same +N as a clear request.
 */
export function sumMyPreviewReward(
  preview: ClearPreviewResponse,
  userId: number | null,
): number {
  if (userId === null) {
    return 0;
  }
  const partyShare = sumMyReward(
    preview.rewards.map((reward) => ({
      userId: reward.user.id,
      amount: reward.amount,
    })),
    userId,
  );
  const requesterShare =
    preview.requesterBonus?.user.id === userId
      ? preview.requesterBonus.amount
      : 0;
  return partyShare + requesterShare;
}

/**
 * Total XP paid by the latest `quest_cleared` event, or 0 when there is none.
 *
 * `GET /api/quests/:id/events` returns oldest first, so the last matching event
 * is the clear being revoked. The payload lists every clear/requester award,
 * which is exactly what `POST /unclear` takes back.
 */
export function latestClearedXp(
  events: readonly QuestEvent[] | undefined,
): number {
  if (!events) {
    return 0;
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.type !== "quest_cleared") {
      continue;
    }
    const parsed = questClearedPayloadSchema.safeParse(event.payload);
    if (parsed.success) {
      return parsed.data.rewards.reduce(
        (total, reward) => total + reward.amount,
        0,
      );
    }
  }
  return 0;
}

/** Invalidate every cache a clear or unclear makes stale. */
export function invalidateClearQueries(
  queryClient: QueryClient,
  projectId: number,
  questId: number,
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.quest(questId) });
  void queryClient.invalidateQueries({ queryKey: ["quests", projectId] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.events(questId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
  void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.project(projectId),
  });
}

/**
 * Queue the 10s `던전 클리어! +N XP` toast with a 되돌리기 action.
 *
 * The action closes over the query client and the quest id only, so it keeps
 * working after the drawer closes. Clicking it calls `POST /unclear`, seeds the
 * restored boss quest into the detail cache and invalidates every clear
 * dependent query.
 */
export function pushClearToast(
  queryClient: QueryClient,
  projectId: number,
  questId: number,
  amount: number,
): number {
  return pushToast(ko.board.drawer.clear.success(amount), {
    durationMs: CLEAR_TOAST_DURATION_MS,
    action: {
      label: ko.board.drawer.clear.undo,
      onClick: () => {
        void unclearQuest(questId)
          .then((quest) => {
            queryClient.setQueryData(queryKeys.quest(questId), quest);
            invalidateClearQueries(queryClient, projectId, questId);
          })
          .catch(() => {
            pushToast(ko.board.drawer.unclear.failed);
          });
      },
    },
  });
}
