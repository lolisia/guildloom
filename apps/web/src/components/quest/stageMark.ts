/**
 * Stage accent colours for the quest drawer.
 *
 * The board marks each column with a 2px underline in its stage colour and the
 * drawer repeats that mark next to the 64px stage icon, so a quest keeps the
 * same visual identity wherever it is shown. The mapping mirrors the board:
 * board=ink, dungeon=teal, boss=brick, cleared=gold, archived=gold. `rumor`
 * never appears as a board column, so it takes the neutral muted tone.
 */
import type { Stage } from "@guildloom/shared";

/** Tailwind background utility for each stage's 2px mark. */
export const STAGE_MARK_CLASSES: Record<Stage, string> = {
  rumor: "bg-muted",
  board: "bg-ink",
  dungeon: "bg-teal",
  boss: "bg-brick",
  cleared: "bg-gold",
  archived: "bg-gold",
};
