/**
 * Quest stages and rank constants shared by the server, the web client and
 * agents. These are the canonical orderings used throughout guildloom.
 */

/** All quest stages, in board/progression order. */
export const STAGES = [
  "rumor",
  "board",
  "dungeon",
  "boss",
  "cleared",
  "archived",
] as const;

/** A quest stage. */
export type Stage = (typeof STAGES)[number];

/** Stages rendered as columns on the main board. */
export const BOARD_COLUMNS = ["board", "dungeon", "boss", "cleared"] as const;

/** Quest ranks, easiest (F) to hardest (S). */
export const RANKS = ["F", "E", "D", "C", "B", "A", "S"] as const;

/** A quest rank. */
export type Rank = (typeof RANKS)[number];

/** Base XP awarded for clearing a quest of each rank. */
export const RANK_XP = {
  F: 10,
  E: 20,
  D: 40,
  C: 80,
  B: 150,
  A: 250,
  S: 400,
} as const satisfies Record<Rank, number>;

/** Rank used when a quest has none (bounty and XP are always computed). */
export const DEFAULT_RANK = "D" as const satisfies Rank;

/** Party roles within a quest. The first active member becomes the leader. */
export const PARTY_ROLES = ["leader", "member"] as const;

/** A party role. */
export type PartyRole = (typeof PARTY_ROLES)[number];

/** Party member clear statuses, in progression order. */
export const MEMBER_STATUSES = [
  "joined",
  "fighting",
  "done",
  "retreated",
] as const;

/** A party member status. */
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Statuses that count as part of the active party (`retreated` does not). */
export const ACTIVE_MEMBER_STATUSES = [
  "joined",
  "fighting",
  "done",
] as const satisfies readonly MemberStatus[];

/** A status an active member may set for themselves. */
export type ActiveMemberStatus = (typeof ACTIVE_MEMBER_STATUSES)[number];

/** How a nomination (지목) came about. */
export const NOMINATION_KINDS = ["nominate", "reinforce", "relay"] as const;

/** A nomination kind. */
export type NominationKind = (typeof NOMINATION_KINDS)[number];

/** Lifecycle of a nomination. */
export const NOMINATION_STATES = [
  "pending",
  "accepted",
  "passed",
  "cancelled",
] as const;

/** A nomination state. */
export type NominationState = (typeof NOMINATION_STATES)[number];

/** In-app notification types. */
export const NOTIFICATION_TYPES = [
  "nominated",
  "relayed",
  "reinforce",
  "boss_engaged",
  "retry_requested",
  "quest_cleared",
] as const;

/** A notification type. */
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Reasons recorded in the XP ledger. */
export const XP_REASONS = ["clear", "requester", "guide"] as const;

/** An XP ledger reason. */
export type XpReason = (typeof XP_REASONS)[number];

/** Bounty growth per full day on the board (+20%). */
export const BOUNTY_STEP = 0.2;

/** Bounty multiplier cap (2×). */
export const BOUNTY_CAP = 2;

/** Days after reaching the bounty cap before an unclaimed quest looks dusty. */
export const DUSTY_DAYS_AFTER_CAP = 7;

/** XP for the requester (의뢰인) when they are not in the party at clear. */
export const REQUESTER_XP = 5;

/** Guide bonus XP for the member who tossed a relay nomination. */
export const GUIDE_XP = 10;

/** Preset reasons offered when passing a nomination. */
export const PASS_REASON_PRESETS = [
  "내 영역 아님",
  "지금 여유 없음",
  "정보가 부족함",
] as const;
