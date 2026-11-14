/**
 * Static transcription of the `jrpg-v1` icon pack manifest
 * (`public/assets/icons/jrpg-v1/manifest.json`).
 *
 * The manifest is the source of truth and is read-only; this module mirrors it
 * at build time so the client never fetches JSON at runtime (a fetch would both
 * cost a round trip and flash empty icons on first paint). `test/icons-manifest.test.ts`
 * asserts that every id, mapping and alias here still matches the manifest.
 *
 * Icons are referenced by id only. The `Icon` component builds the actual
 * `32/<id>.png` / `64/<id>.png` paths.
 */
import type { Rank, Stage } from "@guildloom/shared";

/** Every icon id in the pack, in manifest order. */
export const ICON_NAMES = [
  "guild",
  "quest",
  "party",
  "adventurer",
  "familiar",
  "board",
  "dungeon",
  "boss",
  "cleared",
  "ledger",
  "settings",
  "invite",
  "xp",
  "level-up",
  "bounty",
  "guardian",
  "rumor",
  "archive",
  "joined",
  "fighting",
  "done",
  "retreated",
  "nominate",
  "accept",
  "pass",
  "relay",
  "reinforce",
  "witness",
  "investigate",
  "recheck",
  "milestone",
  "scout",
  "add",
  "remove",
  "close",
  "edit",
  "save",
  "delete",
  "search",
  "filter",
  "sort-ascending",
  "sort-descending",
  "copy",
  "download",
  "upload",
  "refresh",
  "link",
  "external-link",
  "login",
  "logout",
  "lock",
  "key",
  "notification",
  "chat",
  "mention",
  "attachment",
  "image",
  "video",
  "screen-record",
  "floor",
  "realm",
  "help",
  "warning",
  "info",
  "rank-f",
  "rank-e",
  "rank-d",
  "rank-c",
  "rank-b",
  "rank-a",
  "rank-s",
  "rank-none",
  "intended",
  "mirage",
  "merged",
  "vanished",
  "faded",
  "dropped",
  "pending",
  "success",
  "home",
  "arrow-left",
  "arrow-right",
  "arrow-up",
  "arrow-down",
  "chevron-left",
  "chevron-right",
  "chevron-up",
  "chevron-down",
  "expand",
  "collapse",
  "more",
  "drag",
  "calendar",
  "clock",
  "empty",
] as const;

/** A valid icon id from the `jrpg-v1` pack. */
export type IconName = (typeof ICON_NAMES)[number];

/** Quest stage → icon id (`manifest.mappings.stages`). */
export const STAGE_ICON: Record<Stage, IconName> = {
  rumor: "rumor",
  board: "board",
  dungeon: "dungeon",
  boss: "boss",
  cleared: "cleared",
  archived: "archive",
};

/** Quest rank → icon id (`manifest.mappings.ranks`). */
export const RANK_ICON: Record<Rank, IconName> = {
  F: "rank-f",
  E: "rank-e",
  D: "rank-d",
  C: "rank-c",
  B: "rank-b",
  A: "rank-a",
  S: "rank-s",
};

/** Icon used when a quest has no rank (`manifest.mappings.rankFallback`). */
export const RANK_ICON_FALLBACK: IconName = "rank-none";

/** Party member status → icon id (`manifest.mappings.partyStatus`). */
export const PARTY_STATUS_ICON: Record<
  "joined" | "fighting" | "done" | "retreated",
  IconName
> = {
  joined: "joined",
  fighting: "fighting",
  done: "done",
  retreated: "retreated",
};

/**
 * Short, intent-revealing aliases (`manifest.aliases`).
 *
 * Call sites can ask for `"cancel"` or `"exportCsv"` and get the canonical icon
 * without knowing the pack.
 */
export const ICON_ALIASES: Record<string, IconName> = {
  cancel: "close",
  confirm: "accept",
  create: "add",
  loading: "pending",
  retry: "refresh",
  back: "arrow-left",
  tag: "nominate",
  tagRemove: "close",
  clearFilters: "remove",
  bulkPaste: "copy",
  exportCsv: "download",
  history: "clock",
  owner: "boss",
  member: "adventurer",
  active: "success",
  revoked: "dropped",
  password: "lock",
  loginId: "adventurer",
  signup: "add",
  joinGuild: "login",
  leaveGuild: "logout",
  createGuild: "add",
  createInvite: "invite",
  revokeInvite: "dropped",
  copyInvite: "copy",
  inviteCopied: "success",
  emptyColumn: "empty",
  noProjects: "guild",
  noTags: "empty",
  notFound: "warning",
  networkError: "warning",
  mentionUnread: "notification",
  reignite: "refresh",
  promoteRumor: "quest",
  recordMilestone: "milestone",
  dustyQuest: "faded",
};

/**
 * Resolve a name to an icon id: aliases map to their target, canonical ids pass
 * through unchanged.
 */
export function resolveIcon(name: string): IconName {
  const alias = ICON_ALIASES[name];
  if (alias) {
    return alias;
  }

  return name as IconName;
}
