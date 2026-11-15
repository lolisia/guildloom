/**
 * Pure drag-and-drop bookkeeping for the quest dungeon checklist.
 *
 * `dnd-kit` reports the row a drag finished over; turning that into the
 * `beforeId`/`afterId` neighbours expected by `POST /api/floors/:id/move` is
 * fiddly, so it lives here as a pure function that can be unit tested without a
 * browser.
 */
import type { Floor } from "@guildloom/shared";

/** Request payload for `POST /api/floors/:id/move`, plus the optimistic list. */
export interface FloorMovePlan {
  floorId: number;
  beforeId?: number;
  afterId?: number;
  /** The floor list after the drop, in the order the server will store it. */
  floors: Floor[];
}

/**
 * Plan the move produced by dropping the `activeId` floor over `overId`.
 *
 * Uses the same "arrayMove" semantics as the board: dragging down places the
 * row after the row it was dropped on, dragging up places it before. Returns
 * `null` for a no-op or an unknown target.
 */
export function planFloorMove(
  floors: readonly Floor[],
  activeId: number,
  overId: number,
): FloorMovePlan | null {
  if (activeId === overId) {
    return null;
  }

  const oldIndex = floors.findIndex((floor) => floor.id === activeId);
  const newIndex = floors.findIndex((floor) => floor.id === overId);
  if (oldIndex < 0 || newIndex < 0) {
    return null;
  }

  const next = [...floors];
  const [moved] = next.splice(oldIndex, 1);
  if (!moved) {
    return null;
  }
  next.splice(newIndex, 0, moved);

  const plan: FloorMovePlan = { floorId: moved.id, floors: next };
  const beforeId = next[newIndex - 1]?.id;
  const afterId = next[newIndex + 1]?.id;
  if (beforeId !== undefined) {
    plan.beforeId = beforeId;
  }
  if (afterId !== undefined) {
    plan.afterId = afterId;
  }
  return plan;
}
