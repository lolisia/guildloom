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
