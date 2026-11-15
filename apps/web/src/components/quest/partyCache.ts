/**
 * Cache bookkeeping shared by every party mutation in the quest drawer.
 *
 * A party mutation can change the board card (party, floors, stage, bounty),
 * the quest detail, the adventure log, the adventurer's pending nominations
 * and the bell, so all of them are refreshed together. Mutations whose
 * response is a full quest also seed the detail cache immediately, so the
 * drawer never flickers back to the previous party while the invalidation
 * refetch is in flight.
 */
import type { Quest } from "@guildloom/shared";
import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../lib/queryKeys";

/**
 * Invalidate every query a party mutation can make stale.
 *
 * `["quests", projectId]` is a prefix, so it covers every filtered board and
 * ledger query for the guild.
 */
export function invalidatePartyQueries(
  queryClient: QueryClient,
  projectId: number,
  questId: number,
): void {
  void queryClient.invalidateQueries({ queryKey: ["quests", projectId] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.quest(questId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.events(questId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.myNominations });
  void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
}

/**
 * Seed the detail cache with a mutation response, then invalidate the rest.
 *
 * The server answers accept/join/pass/leave/status with the updated quest, so
 * copying it into `queryKeys.quest(quest.id)` keeps the drawer in sync before
 * the invalidation refetch resolves.
 */
export function applyQuestUpdate(
  queryClient: QueryClient,
  projectId: number,
  updated: Quest,
): void {
  queryClient.setQueryData(queryKeys.quest(updated.id), updated);
  invalidatePartyQueries(queryClient, projectId, updated.id);
}
