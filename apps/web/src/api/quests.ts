/**
 * Quest, event and tag endpoints.
 *
 * Every function returns the shared Zod-inferred type so pages and components
 * never duplicate response shapes. `fetchQuests` accepts the same
 * `ListQuestsQuery` filters as the server (`stage` is a comma-separated list).
 */
import type {
  AppendChecklistRequest,
  ArchiveQuestRequest,
  BulkCreateQuestsRequest,
  ClearQuestResponse,
  CreateQuestRefRequest,
  CreateQuestRequest,
  ListQuestsQuery,
  MoveQuestRequest,
  Quest,
  QuestEventsResponse,
  QuestListResponse,
  QuestRef,
  RetryQuestRequest,
  TagListResponse,
  ToggleChecklistRequest,
  UpdateQuestRequest,
} from "@guildloom/shared";

import { apiFetch } from "./client";

/** Build the `?stage=…&tag=…&q=…` suffix for a quest list request. */
function questListQueryString(query: ListQuestsQuery): string {
  const parts: string[] = [];

  const stage = query.stage?.trim();
  if (stage) {
    const stages = stage
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (stages.length > 0) {
      // `stage` is a comma-separated list of known stage names; keep the commas
      // readable instead of percent-encoding them (the server splits on ",").
      const encoded = stages
        .map((value) => encodeURIComponent(value))
        .join(",");
      parts.push(`stage=${encoded}`);
    }
  }

  const tag = query.tag?.trim();
  if (tag) {
    parts.push(`tag=${encodeURIComponent(tag)}`);
  }

  const text = query.q?.trim();
  if (text) {
    parts.push(`q=${encodeURIComponent(text)}`);
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/** `GET /api/projects/:projectId/quests` — quest cards in `orderKey` order. */
export function fetchQuests(
  projectId: number,
  query: ListQuestsQuery = {},
  signal?: AbortSignal,
): Promise<QuestListResponse> {
  return apiFetch<QuestListResponse>(
    `/projects/${projectId}/quests${questListQueryString(query)}`,
    { signal },
  );
}

/** `POST /api/projects/:projectId/quests` — post a new quest. */
export function createQuest(
  projectId: number,
  body: CreateQuestRequest,
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/projects/${projectId}/quests`, {
    method: "POST",
    body,
    signal,
  });
}

/** `POST /api/projects/:projectId/quests/bulk` — post many quests at once. */
export function bulkCreateQuests(
  projectId: number,
  body: BulkCreateQuestsRequest,
  signal?: AbortSignal,
): Promise<Quest[]> {
  return apiFetch<Quest[]>(`/projects/${projectId}/quests/bulk`, {
    method: "POST",
    body,
    signal,
  });
}

/** `GET /api/quests/:questId` — full quest detail. */
export function fetchQuest(
  questId: number,
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/quests/${questId}`, { signal });
}

/** `PATCH /api/quests/:questId` — edit title, text, tags, rank or kind. */
export function updateQuest(
  questId: number,
  body: UpdateQuestRequest,
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/quests/${questId}`, {
    method: "PATCH",
    body,
    signal,
  });
}

/**
 * `POST /api/quests/:questId/refs` — attach a reference document.
 *
 * The server answers with the created row (201), which the drawer appends to
 * the cached detail.
 */
export function createQuestRef(
  questId: number,
  body: CreateQuestRefRequest,
  signal?: AbortSignal,
): Promise<QuestRef> {
  return apiFetch<QuestRef>(`/quests/${questId}/refs`, {
    method: "POST",
    body,
    signal,
  });
}

/** `DELETE /api/refs/:refId` — remove a reference document. */
export function deleteQuestRef(
  refId: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<void>(`/refs/${refId}`, {
    method: "DELETE",
    signal,
  });
}

/**
 * `POST /api/quests/:questId/checklist/:index` — check/uncheck one item.
 *
 * `text` is the checklist text the caller saw; the server answers a
 * `CHECKLIST_CONFLICT` when it no longer matches.
 */
export function toggleChecklist(
  questId: number,
  index: number,
  body: ToggleChecklistRequest,
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/quests/${questId}/checklist/${index}`, {
    method: "POST",
    body,
    signal,
  });
}

/** `POST /api/quests/:questId/checklist` — append one item per title. */
export function appendChecklist(
  questId: number,
  body: AppendChecklistRequest,
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/quests/${questId}/checklist`, {
    method: "POST",
    body,
    signal,
  });
}

/** `POST /api/quests/:questId/move` — move a quest between/within columns. */
export function moveQuest(
  questId: number,
  body: MoveQuestRequest,
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/quests/${questId}/move`, {
    method: "POST",
    body,
    signal,
  });
}

/** `POST /api/quests/:questId/archive` — drop a quest from the board. */
export function archiveQuest(
  questId: number,
  body: ArchiveQuestRequest = {},
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/quests/${questId}/archive`, {
    method: "POST",
    body,
    signal,
  });
}

/**
 * `POST /api/quests/:questId/clear` — declare the dungeon clear.
 *
 * The response carries the settled quest, the XP actually paid to each
 * participant and every level transition, so the drawer can celebrate the
 * caller's own reward without a second request.
 */
export function clearQuest(
  questId: number,
  signal?: AbortSignal,
): Promise<ClearQuestResponse> {
  return apiFetch<ClearQuestResponse>(`/quests/${questId}/clear`, {
    method: "POST",
    signal,
  });
}

/** `POST /api/quests/:questId/retry` — send a boss quest back to the dungeon. */
export function retryQuest(
  questId: number,
  body: RetryQuestRequest,
  signal?: AbortSignal,
): Promise<Quest> {
  return apiFetch<Quest>(`/quests/${questId}/retry`, {
    method: "POST",
    body,
    signal,
  });
}

/** `GET /api/quests/:questId/events` — the quest's adventure log. */
export function fetchEvents(
  questId: number,
  signal?: AbortSignal,
): Promise<QuestEventsResponse> {
  return apiFetch<QuestEventsResponse>(`/quests/${questId}/events`, {
    signal,
  });
}

/** `GET /api/projects/:projectId/tags` — tag autocomplete, most used first. */
export function fetchTags(
  projectId: number,
  q = "",
  signal?: AbortSignal,
): Promise<TagListResponse> {
  const search = new URLSearchParams();
  const trimmed = q.trim();
  if (trimmed.length > 0) {
    search.set("q", trimmed);
  }
  const serialized = search.toString();
  return apiFetch<TagListResponse>(
    `/projects/${projectId}/tags${serialized ? `?${serialized}` : ""}`,
    { signal },
  );
}
