/**
 * Cache bookkeeping shared by every floor mutation in the quest drawer.
 *
 * The detail cache stores the ordered `Floor[]`, while the board and ledger
 * cards only keep a `{ done, total }` counter. Mutations therefore seed the
 * detail cache with the server's floor list and invalidate the quest detail,
 * the adventure log and the `["quests", projectId]` prefix so the board cards
 * follow without a reload.
 */
import type { Floor, Quest } from "@guildloom/shared";
import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../lib/queryKeys";

/** Replace the detail cache's floor list without touching other fields. */
export function setQuestFloors(
  queryClient: QueryClient,
  questId: number,
  floors: readonly Floor[],
): void {
  const key = queryKeys.quest(questId);
  const cached = queryClient.getQueryData<Quest>(key);
  if (!cached) {
    return;
  }
  queryClient.setQueryData<Quest>(key, { ...cached, floors: [...floors] });
}

/**
 * Invalidate every query a floor mutation can make stale.
 *
 * `["quests", projectId]` is a prefix, so it covers every filtered board and
 * ledger query for the guild.
 */
export function invalidateFloorQueries(
  queryClient: QueryClient,
  projectId: number,
  questId: number,
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.quest(questId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.events(questId) });
  void queryClient.invalidateQueries({ queryKey: ["quests", projectId] });
}

/** Replace one floor in the detail cache (a check, uncheck or rename). */
export function applyFloorUpdate(
  queryClient: QueryClient,
  projectId: number,
  questId: number,
  updated: Floor,
): void {
  const cached = queryClient.getQueryData<Quest>(queryKeys.quest(questId));
  if (cached) {
    setQuestFloors(
      queryClient,
      questId,
      cached.floors.map((floor) =>
        floor.id === updated.id ? updated : floor,
      ),
    );
  }
  invalidateFloorQueries(queryClient, projectId, questId);
}

/** Remove one floor from the detail cache after a successful delete. */
export function applyFloorDelete(
  queryClient: QueryClient,
  projectId: number,
  questId: number,
  floorId: number,
): void {
  const cached = queryClient.getQueryData<Quest>(queryKeys.quest(questId));
  if (cached) {
    setQuestFloors(
      queryClient,
      questId,
      cached.floors.filter((floor) => floor.id !== floorId),
    );
  }
  invalidateFloorQueries(queryClient, projectId, questId);
}
