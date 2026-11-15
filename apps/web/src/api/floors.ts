/**
 * Quest floor (층) endpoints.
 *
 * Floors are the dungeon checklist of one quest. They are display-only: adding,
 * checking, renaming or reordering a floor never moves the quest through the
 * stage machine. The server answers `POST /api/quests/:id/floors` with the whole
 * (re-ordered) floor list and every other mutation with the changed floor, while
 * `DELETE /api/floors/:id` is a `204 No Content` response.
 */
import type {
  AddFloorsRequest,
  Floor,
  FloorListResponse,
  MoveFloorRequest,
  UpdateFloorRequest,
} from "@guildloom/shared";

import { apiFetch } from "./client";

/** `POST /api/quests/:questId/floors` — append one floor per title. */
export function addFloors(
  questId: number,
  body: AddFloorsRequest,
  signal?: AbortSignal,
): Promise<FloorListResponse> {
  return apiFetch<FloorListResponse>(`/quests/${questId}/floors`, {
    method: "POST",
    body,
    signal,
  });
}

/** `PATCH /api/floors/:floorId` — rename a floor or check/uncheck it. */
export function updateFloor(
  floorId: number,
  body: UpdateFloorRequest,
  signal?: AbortSignal,
): Promise<Floor> {
  return apiFetch<Floor>(`/floors/${floorId}`, {
    method: "PATCH",
    body,
    signal,
  });
}

/** `POST /api/floors/:floorId/move` — reorder a floor between its neighbours. */
export function moveFloor(
  floorId: number,
  body: MoveFloorRequest,
  signal?: AbortSignal,
): Promise<Floor> {
  return apiFetch<Floor>(`/floors/${floorId}/move`, {
    method: "POST",
    body,
    signal,
  });
}

/** `DELETE /api/floors/:floorId` — remove a floor from the dungeon. */
export function deleteFloor(
  floorId: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<void>(`/floors/${floorId}`, {
    method: "DELETE",
    signal,
  });
}
