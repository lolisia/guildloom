/**
 * Pure drag-and-drop bookkeeping for the four-column board.
 *
 * `dnd-kit` reports the card (or column) a drag finished over; turning that
 * into the `beforeId`/`afterId` neighbours expected by
 * `POST /api/quests/:id/move` is fiddly, so it lives here as a pure function
 * that can be unit tested without a browser.
 */
import {
  BOARD_COLUMNS,
  type QuestSummary,
  type Stage,
} from "@guildloom/shared";

/** A stage rendered as a board column. */
export type BoardStage = (typeof BOARD_COLUMNS)[number];

/** Droppable id prefix for an empty (or partially filled) column. */
export const COLUMN_DROP_PREFIX = "column:";

/** Request payload for `POST /api/quests/:id/move`. */
export interface QuestMovePlan {
  questId: number;
  stage: BoardStage;
  beforeId?: number;
  afterId?: number;
}

/** Result of planning a drop: the request plus the optimistic list order. */
export interface QuestMoveResult {
  plan: QuestMovePlan;
  quests: QuestSummary[];
}

/** The four columns, keyed by stage. */
export type QuestColumns = Record<BoardStage, QuestSummary[]>;

/** Whether `value` is one of the four board stages. */
export function isBoardStage(value: string): value is BoardStage {
  return (BOARD_COLUMNS as readonly string[]).includes(value);
}

/** Droppable id of a board column. */
export function columnDropId(stage: BoardStage): string {
  return `${COLUMN_DROP_PREFIX}${stage}`;
}

/** Stage encoded in a column droppable id, or `null` for any other id. */
export function stageFromDropId(id: string | number): BoardStage | null {
  if (typeof id !== "string" || !id.startsWith(COLUMN_DROP_PREFIX)) {
    return null;
  }
  const stage = id.slice(COLUMN_DROP_PREFIX.length);
  return isBoardStage(stage) ? stage : null;
}

/** Group quests into the four board columns, preserving server order. */
export function groupQuestsByStage(quests: QuestSummary[]): QuestColumns {
  const columns: QuestColumns = {
    board: [],
    dungeon: [],
    boss: [],
    cleared: [],
  };
  for (const quest of quests) {
    if (isBoardStage(quest.stage)) {
      columns[quest.stage].push(quest);
    }
  }
  return columns;
}

/** Flatten columns back into one list ordered board → dungeon → boss → cleared. */
export function flattenColumns(columns: QuestColumns): QuestSummary[] {
  return BOARD_COLUMNS.flatMap((stage) => columns[stage]);
}

function isStage(stage: Stage): stage is BoardStage {
  return isBoardStage(stage);
}

/**
 * Plan the move produced by dropping `activeId` over `overId`.
 *
 * - Dropping on a column appends the card to that column.
 * - Dropping on a card inserts the dragged card at that card's position, using
 *   the same "move down shifts forward" semantics as `arrayMove` so the live
 *   sortable preview matches the final order.
 *
 * Returns `null` when the drop is a no-op or references an unknown target.
 */
export function planQuestMove(
  quests: QuestSummary[],
  activeId: number,
  overId: string | number,
): QuestMoveResult | null {
  const dragged = quests.find((quest) => quest.id === activeId);
  if (!dragged || !isStage(dragged.stage)) {
    return null;
  }

  const draggedStage = dragged.stage;
  const columns = groupQuestsByStage(quests);
  const source = columns[draggedStage];
  const sourceIndex = source.findIndex((quest) => quest.id === dragged.id);
  if (sourceIndex < 0) {
    return null;
  }

  const previousNeighbor = source[sourceIndex - 1]?.id;
  const nextNeighbor = source[sourceIndex + 1]?.id;

  const overColumnStage = stageFromDropId(overId);
  let targetStage: BoardStage;

  if (overColumnStage !== null) {
    targetStage = overColumnStage;
  } else if (typeof overId === "number" && overId !== dragged.id) {
    const overQuest = quests.find((quest) => quest.id === overId);
    if (!overQuest || !isStage(overQuest.stage)) {
      return null;
    }
    targetStage = overQuest.stage;
  } else {
    return null;
  }

  source.splice(sourceIndex, 1);
  const target = columns[targetStage];

  let insertIndex: number;
  if (overColumnStage !== null) {
    insertIndex = target.length;
  } else {
    const overIndex = target.findIndex((quest) => quest.id === overId);
    if (overIndex < 0) {
      return null;
    }
    // `arrayMove` semantics: when dragging down inside a column the dragged
    // card lands after the card it was dropped on.
    insertIndex =
      targetStage === draggedStage && sourceIndex <= overIndex
        ? overIndex + 1
        : overIndex;
  }
  insertIndex = Math.max(0, Math.min(insertIndex, target.length));

  const nextPreviousNeighbor = target[insertIndex - 1]?.id;
  const nextNextNeighbor = target[insertIndex]?.id;
  if (
    targetStage === draggedStage &&
    previousNeighbor === nextPreviousNeighbor &&
    nextNeighbor === nextNextNeighbor
  ) {
    return null;
  }

  target.splice(insertIndex, 0, { ...dragged, stage: targetStage });

  const plan: QuestMovePlan = {
    questId: dragged.id,
    stage: targetStage,
  };
  const beforeId = target[insertIndex - 1]?.id;
  const afterId = target[insertIndex + 1]?.id;
  if (beforeId !== undefined) {
    plan.beforeId = beforeId;
  }
  if (afterId !== undefined) {
    plan.afterId = afterId;
  }

  const ordered = flattenColumns(columns);
  const orderedIds = new Set(ordered.map((quest) => quest.id));
  const leftovers = quests.filter((quest) => !orderedIds.has(quest.id));

  return { plan, quests: [...ordered, ...leftovers] };
}
