/**
 * Tavern (주점) and quest party chat endpoints.
 *
 * Both rooms share the same message page shape: the list endpoints answer with
 * the newest page first and take a `before` cursor so the client can page
 * backwards through history. A message that mentions members stores `<@id>`
 * tokens (the composer encodes them); promoting a tavern message into a quest
 * answers with the new quest plus the system message that announces it.
 */
import type {
  ChatMessage,
  ChatUnreadResponse,
  CreateQuestFromChatRequest,
  CreateQuestFromChatResponse,
  MarkReadRequest,
  MessagePageQuery,
  MessagePageResponse,
  PostMessageRequest,
} from "@guildloom/shared";

import { apiFetch } from "./client";

/**
 * Filters for a message page.
 *
 * Both fields are optional: a missing `before` asks for the newest page and a
 * missing `limit` lets the server use its default page size.
 */
export type ChatMessagePageQuery = Partial<MessagePageQuery>;

/** Build `?before=…&limit=…`, omitting undefined filters. */
function messagePageQueryString(query: ChatMessagePageQuery): string {
  const search = new URLSearchParams();
  if (query.before !== undefined) {
    search.set("before", String(query.before));
  }
  if (query.limit !== undefined) {
    search.set("limit", String(query.limit));
  }

  const serialized = search.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
}

/** `GET /api/projects/:projectId/tavern/messages` — a page of 주점 history. */
export function fetchTavernMessages(
  projectId: number,
  query: ChatMessagePageQuery = {},
  signal?: AbortSignal,
): Promise<MessagePageResponse> {
  return apiFetch<MessagePageResponse>(
    `/projects/${projectId}/tavern/messages${messagePageQueryString(query)}`,
    { signal },
  );
}

/** `POST /api/projects/:projectId/tavern/messages` — speak in the 주점. */
export function postTavernMessage(
  projectId: number,
  body: PostMessageRequest,
  signal?: AbortSignal,
): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/projects/${projectId}/tavern/messages`, {
    method: "POST",
    body,
    signal,
  });
}

/** `GET /api/quests/:questId/messages` — a page of party chat history. */
export function fetchQuestMessages(
  questId: number,
  query: ChatMessagePageQuery = {},
  signal?: AbortSignal,
): Promise<MessagePageResponse> {
  return apiFetch<MessagePageResponse>(
    `/quests/${questId}/messages${messagePageQueryString(query)}`,
    { signal },
  );
}

/** `POST /api/quests/:questId/messages` — speak in a quest party room. */
export function postQuestMessage(
  questId: number,
  body: PostMessageRequest,
  signal?: AbortSignal,
): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/quests/${questId}/messages`, {
    method: "POST",
    body,
    signal,
  });
}

/** `DELETE /api/messages/:messageId` — soft-delete a message (204). */
export function deleteChatMessage(
  messageId: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<void>(`/messages/${messageId}`, {
    method: "DELETE",
    signal,
  });
}

/**
 * `POST /api/projects/:projectId/tavern/quests` — turn a tavern message into a
 * quest (the source message id travels in the body).
 */
export function createQuestFromTavernMessage(
  projectId: number,
  body: CreateQuestFromChatRequest,
  signal?: AbortSignal,
): Promise<CreateQuestFromChatResponse> {
  return apiFetch<CreateQuestFromChatResponse>(
    `/projects/${projectId}/tavern/quests`,
    { method: "POST", body, signal },
  );
}

/** `GET /api/projects/:projectId/chat/unread` — stacked unread badges. */
export function fetchChatUnread(
  projectId: number,
  signal?: AbortSignal,
): Promise<ChatUnreadResponse> {
  return apiFetch<ChatUnreadResponse>(`/projects/${projectId}/chat/unread`, {
    signal,
  });
}

/** `POST /api/projects/:projectId/chat/read` — mark a room read (204). */
export function markChatRead(
  projectId: number,
  body: MarkReadRequest,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<void>(`/projects/${projectId}/chat/read`, {
    method: "POST",
    body,
    signal,
  });
}
