/**
 * Party (파티) and nomination (지목) endpoints.
 *
 * A nomination is the "who should take this quest?" ping; accepting joins the
 * party, passing hands it on (optionally tossing it to another member), and
 * reinforcing asks additional adventurers to join. Accept/pass answer with the
 * updated quest detail (the server also broadcasts `quest:changed` and
 * `members:changed`), while withdrawing a nomination is a `204 No Content`
 * delete. Screens should still invalidate their queries rather than trust the
 * echo — a broadcast from another client may land first.
 */
import type {
  LeavePartyRequest,
  MemberStatusRequest,
  MyNominationsResponse,
  NominateRequest,
  NominationListResponse,
  PassNominationRequest,
  Quest,
} from "@guildloom/shared";

import { apiFetch } from "./client";

/** `GET /api/me/nominations` — the current adventurer's pending nominations. */
export function fetchMyNominations(
  signal?: AbortSignal,
): Promise<MyNominationsResponse> {
  return apiFetch<MyNominationsResponse>("/me/nominations", { signal });
}

/** `POST /api/quests/:questId/nominations` — nominate up to ten members. */
export function nominate(
  questId: number,
  body: NominateRequest,
  signal?: AbortSignal,
): Promise<NominationListResponse> {
  return apiFetch<NominationListResponse>(
    `/quests/${questId}/nominations`,
    { method: "POST", body, signal },
  );
}

/** `POST /api/quests/:questId/reinforcements` — request reinforcements. */
export function reinforce(
  questId: number,
  body: NominateRequest,
  signal?: AbortSignal,
): Promise<NominationListResponse> {
  return apiFetch<NominationListResponse>(
    `/quests/${questId}/reinforcements`,
    { method: "POST", body, signal },
  );
}

/**
 * `POST /api/nominations/:nominationId/accept` — join the quest's party and
 * return the updated quest detail.
 */
export function accept(
  nominationId: number,
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/nominations/${nominationId}/accept`, {
    method: "POST",
    signal,
  });
}

/**
 * `POST /api/nominations/:nominationId/pass` — pass a nomination, optionally
 * with a reason and/or by tossing it to another member. Answers with the
 * updated quest detail.
 */
export function pass(
  nominationId: number,
  body: PassNominationRequest = {},
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/nominations/${nominationId}/pass`, {
    method: "POST",
    body,
    signal,
  });
}

/**
 * `DELETE /api/nominations/:nominationId` — withdraw a nomination (204).
 *
 * Only the nominator may cancel; the server answers with no body.
 */
export function cancel(
  nominationId: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<void>(`/nominations/${nominationId}`, {
    method: "DELETE",
    signal,
  });
}

/** `POST /api/quests/:questId/join` — join the party directly. */
export function join(
  questId: number,
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/quests/${questId}/join`, {
    method: "POST",
    signal,
  });
}

/** `POST /api/quests/:questId/leave` — retreat with an optional reason. */
export function leave(
  questId: number,
  body: LeavePartyRequest = {},
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/quests/${questId}/leave`, {
    method: "POST",
    body,
    signal,
  });
}

/** `POST /api/quests/:questId/status` — report the member's clear status. */
export function status(
  questId: number,
  body: MemberStatusRequest,
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/quests/${questId}/status`, {
    method: "POST",
    body,
    signal,
  });
}
