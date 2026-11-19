/**
 * Keep the current chat room read while it is on screen.
 *
 * The hook only reports progress: when the newest loaded message differs from
 * the last one it already sent and the tab is visible, it posts
 * `chat/read` once for that message id. A room switch starts a fresh cursor,
 * and the unread badge query is refreshed after each successful read so the
 * 주점 tab badge drops immediately.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { markChatRead } from "../api/chat";
import { queryKeys } from "./queryKeys";

/**
 * Mark `newestMessageId` read in the given room.
 *
 * @param projectId guild that owns both the tavern and the quest room
 * @param questId `null` for the tavern, otherwise the quest party room
 * @param newestMessageId newest message currently rendered (`undefined` while
 *   the room has no page yet)
 */
export function useMarkRead(
  projectId: number,
  questId: number | null,
  newestMessageId: number | undefined,
): void {
  const queryClient = useQueryClient();

  /** Newest id already posted (or queued) for this room. */
  const lastSentRef = useRef<number | null>(null);
  /** Room the cursor belongs to; survives StrictMode's double effect run. */
  const threadRef = useRef<string | null>(null);
  const threadKey = `${projectId}:${questId === null ? "tavern" : questId}`;

  // A different room must not inherit the other room's cursor.
  useEffect(() => {
    if (threadRef.current !== threadKey) {
      threadRef.current = threadKey;
      lastSentRef.current = null;
    }
  }, [threadKey]);

  useEffect(() => {
    if (newestMessageId === undefined) {
      return;
    }

    const send = (): void => {
      if (document.visibilityState !== "visible") {
        return;
      }
      const last = lastSentRef.current;
      if (last !== null && newestMessageId <= last) {
        return;
      }

      // Remember before the request so a second visibilitychange while it is
      // in flight cannot post the same id twice.
      lastSentRef.current = newestMessageId;
      void markChatRead(projectId, { questId, messageId: newestMessageId })
        .then(() =>
          queryClient.invalidateQueries({
            queryKey: queryKeys.chatUnread(projectId),
          }),
        )
        .catch(() => {
          // The unread badge keeps its previous value; the next message (or a
          // manual refetch) retries the room.
        });
    };

    send();
    document.addEventListener("visibilitychange", send);
    return () => document.removeEventListener("visibilitychange", send);
  }, [projectId, questId, newestMessageId, queryClient]);
}

export default useMarkRead;
