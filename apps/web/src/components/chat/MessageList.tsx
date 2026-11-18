/**
 * Scrollable chat transcript shared by the 주점 and quest party rooms.
 *
 * Rows render oldest-first. Same-author messages within five minutes collapse
 * into the previous row's header (`data-grouped`). Older history loads from an
 * explicit [이전 메시지 더 보기] button instead of scroll position, so the
 * transcript never fetches while the adventurer is reading. The view stays
 * pinned to the bottom on first paint and follows new messages only when the
 * reader is already within 80px of the bottom.
 */
import type { ChatMessage } from "@guildloom/shared";
import { useLayoutEffect, useRef } from "react";

import { ko } from "../../i18n/ko";
import { Button, EmptyState } from "../ui";
import MessageRow from "./MessageRow";

/** Props for {@link MessageList}. */
export interface MessageListProps {
  messages: ChatMessage[];
  hasMore: boolean;
  onLoadMore: () => void;
  projectId: number;
  meId: number | null;
  resolveName: (userId: number) => string | null;
  onDelete?: (message: ChatMessage) => Promise<void> | void;
  onPromote?: (message: ChatMessage) => void;
  isPending?: boolean;
  isError?: boolean;
  emptyText?: string;
}

/** Window during which the same author's messages share one header. */
const GROUPING_WINDOW_MS = 5 * 60_000;

/** Distance from the bottom that still counts as "following" the room. */
const NEAR_BOTTOM_PX = 80;

/** Whether `message` continues the previous row's author block. */
export function isGroupedMessage(
  previous: ChatMessage | undefined,
  message: ChatMessage,
): boolean {
  if (previous === undefined) {
    return false;
  }
  if (previous.kind !== "user" || message.kind !== "user") {
    return false;
  }
  if (previous.author === null || message.author === null) {
    return false;
  }
  if (previous.author.id !== message.author.id) {
    return false;
  }
  const elapsed = message.createdAt - previous.createdAt;
  return elapsed >= 0 && elapsed <= GROUPING_WINDOW_MS;
}

/** Oldest-first transcript with history paging and bottom anchoring. */
export function MessageList({
  messages,
  hasMore,
  onLoadMore,
  projectId,
  meId,
  resolveName,
  onDelete,
  onPromote,
  isPending = false,
  isError = false,
  emptyText,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const lastMessageIdRef = useRef<number | null>(null);
  const scrolledOnceRef = useRef(false);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    const newestId =
      messages.length > 0 ? (messages[messages.length - 1]?.id ?? null) : null;

    if (!scrolledOnceRef.current) {
      element.scrollTop = element.scrollHeight;
      scrolledOnceRef.current = true;
      lastMessageIdRef.current = newestId;
      return;
    }

    // Prepending an older page keeps the newest id; only a new message (or the
    // first page arriving) may move the view, and only if the reader follows
    // the bottom already.
    if (newestId !== lastMessageIdRef.current && nearBottomRef.current) {
      element.scrollTop = element.scrollHeight;
    }
    lastMessageIdRef.current = newestId;
  }, [messages]);

  const handleScroll = (): void => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    nearBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      NEAR_BOTTOM_PX;
  };

  const showEmpty = !isPending && !isError && messages.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {hasMore ? (
        <div className="flex shrink-0 justify-center border-b border-line py-1">
          <Button size="sm" variant="ghost" onClick={onLoadMore}>
            {ko.chat.loadMore}
          </Button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="message-scroll"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 py-2"
      >
        {isPending && messages.length === 0 ? (
          <p role="status" className="px-2 py-2 text-xs text-muted">
            {ko.common.loading}
          </p>
        ) : null}

        {isError ? (
          <p role="alert" className="px-2 py-2 text-xs text-brick">
            {ko.errors.loadFailed}
          </p>
        ) : null}

        {showEmpty ? (
          <EmptyState icon="empty" text={emptyText ?? ko.chat.tavernEmpty} />
        ) : null}

        <ol className="flex flex-col">
          {messages.map((message, index) => (
            <li key={message.id}>
              <MessageRow
                message={message}
                projectId={projectId}
                meId={meId}
                resolveName={resolveName}
                grouped={isGroupedMessage(messages[index - 1], message)}
                onDelete={onDelete}
                onPromote={onPromote}
              />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default MessageList;
