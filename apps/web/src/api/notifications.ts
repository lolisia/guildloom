/**
 * In-app notification endpoints.
 *
 * The top-bar bell requests the newest notifications together with the
 * server-computed unread count. Reading a notification (or all of them) goes
 * through `POST /api/notifications/read`; callers invalidate
 * `queryKeys.notifications` afterwards so the badge follows the change.
 */
import type {
  NotificationListResponse,
  ReadNotificationsRequest,
} from "@guildloom/shared";

import { apiFetch } from "./client";

/** Page size used by the bell dropdown. */
export const NOTIFICATION_LIMIT = 50;

/** Options for {@link fetchNotifications}. */
export interface FetchNotificationsOptions {
  /** Only return unread notifications (`unread=1`). */
  unread?: boolean;
  /** Page size, 1-100 (default {@link NOTIFICATION_LIMIT}). */
  limit?: number;
  signal?: AbortSignal;
}

/**
 * `GET /api/notifications?limit=50[&unread=1]` — newest notifications first.
 *
 * The response also carries `unreadCount`, so the bell can render the badge
 * from the same request as the list.
 */
export function fetchNotifications(
  options: FetchNotificationsOptions = {},
): Promise<NotificationListResponse> {
  const search = new URLSearchParams({
    limit: String(options.limit ?? NOTIFICATION_LIMIT),
  });
  if (options.unread) {
    search.set("unread", "1");
  }

  return apiFetch<NotificationListResponse>(
    `/notifications?${search.toString()}`,
    { signal: options.signal },
  );
}

/**
 * `POST /api/notifications/read` — mark the given ids, or every notification
 * (`{ all: true }`), as read.
 */
export function markNotificationsRead(
  body: ReadNotificationsRequest,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<void>("/notifications/read", {
    method: "POST",
    body,
    signal,
  });
}
