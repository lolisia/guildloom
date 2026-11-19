/**
 * Party chat inside the quest drawer.
 *
 * The section merges the party room's message pages with the quest's key
 * events into one oldest-first transcript, then offers the composer and the
 * adventure-log toggle underneath. Older message pages load from the explicit
 * [이전 메시지 더 보기] button so the 360px scroll area never fetches while the
 * adventurer is reading.
 *
 * Mention names and the composer's autocomplete come from the guild member
 * list (`fetchProject`), exactly like the 주점. Sending and deleting a message
 * refresh the room, the quest timeline and the board's unread badges; while the
 * section is mounted the newest loaded message is reported as read.
 */
import {
  renderEvent,
  type ChatMessage,
  type QuestEvent,
} from "@guildloom/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { fetchMe } from "../../api/auth";
import {
  deleteChatMessage,
  fetchQuestMessages,
  postQuestMessage,
} from "../../api/chat";
import { fetchProject } from "../../api/projects";
import { ko } from "../../i18n/ko";
import {
  mergeChatTimeline,
  type ChatTimelineItem,
} from "../../lib/chatTimeline";
import { queryKeys } from "../../lib/queryKeys";
import { useMarkRead } from "../../lib/useMarkRead";
import MessageComposer from "../chat/MessageComposer";
import { isGroupedMessage } from "../chat/MessageList";
import MessageRow from "../chat/MessageRow";
import { Button } from "../ui";
import EventTimeline, {
  EVENT_RENDER_CONTEXT,
  EVENT_SEGMENT_CLASSES,
} from "./EventTimeline";

/** Messages fetched per page; the server default is the same 50. */
const MESSAGE_PAGE_SIZE = 50;

/** Props for {@link QuestChat}. */
export interface QuestChatProps {
  projectId: number;
  questId: number;
  /** Quest events for the mixed timeline and the adventure log. */
  events: QuestEvent[] | undefined;
  eventsPending?: boolean;
  eventsError?: boolean;
}

/**
 * Whether a message continues the previous timeline row's author block.
 *
 * An event between two messages always breaks the group, even when the same
 * author wrote both.
 */
function isGroupedTimelineMessage(
  previous: ChatTimelineItem | undefined,
  message: ChatMessage,
): boolean {
  if (previous === undefined || previous.kind !== "message") {
    return false;
  }
  return isGroupedMessage(previous.message, message);
}

/** Mixed party transcript, composer and adventure log of one quest. */
export function QuestChat({
  projectId,
  questId,
  events,
  eventsPending = false,
  eventsError = false,
}: QuestChatProps) {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
  });
  const meId = meQuery.data?.user.id ?? null;

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: ({ signal }) => fetchProject(projectId, signal),
  });

  const members = useMemo(
    () =>
      (projectQuery.data?.members ?? []).map((member) => ({
        id: member.userId,
        displayName: member.displayName,
      })),
    [projectQuery.data],
  );

  const nameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const member of projectQuery.data?.members ?? []) {
      map.set(member.userId, member.displayName);
    }
    return map;
  }, [projectQuery.data]);

  const resolveName = useCallback(
    (userId: number): string | null => nameById.get(userId) ?? null,
    [nameById],
  );

  const messagesQuery = useInfiniteQuery({
    queryKey: queryKeys.questMessages(questId),
    queryFn: ({ pageParam, signal }) =>
      fetchQuestMessages(
        questId,
        {
          limit: MESSAGE_PAGE_SIZE,
          ...(pageParam === undefined ? {} : { before: pageParam }),
        },
        signal,
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.messages[0]?.id : undefined,
  });

  // Pages arrive newest first; reverse them so every message renders
  // oldest-to-newest with the newest page at the bottom.
  const messages = useMemo(() => {
    const pages = messagesQuery.data?.pages ?? [];
    return pages
      .slice()
      .reverse()
      .flatMap((page) => page.messages);
  }, [messagesQuery.data]);

  const timeline = useMemo(
    () =>
      mergeChatTimeline(messages, events, {
        hasMore: messagesQuery.hasNextPage,
      }),
    [messages, events, messagesQuery.hasNextPage],
  );

  const newestMessageId =
    messages.length > 0 ? messages[messages.length - 1]?.id : undefined;

  useMarkRead(projectId, questId, newestMessageId);

  /**
   * A posted or deleted message refreshes three surfaces: the room transcript,
   * the quest timeline the drawer merges with it and the board's unread
   * badges. Each mutation invalidates all three itself so the refresh stays
   * next to the request that causes it.
   */
  const sendMutation = useMutation({
    mutationFn: (body: string) => postQuestMessage(questId, { body }),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.questMessages(questId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events(questId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatUnread(projectId),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (messageId: number) => deleteChatMessage(messageId),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.questMessages(questId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events(questId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatUnread(projectId),
      });
    },
  });

  const handleSend = async (body: string): Promise<void> => {
    await sendMutation.mutateAsync(body);
  };

  const handleDelete = async (message: ChatMessage): Promise<void> => {
    await deleteMutation.mutateAsync(message.id);
  };

  return (
    <section aria-label={ko.partyChat.title} className="space-y-2">
      <h3 className="text-sm font-medium text-muted">{ko.partyChat.title}</h3>

      <div
        data-testid="party-chat-scroll"
        className="max-h-[360px] overflow-y-auto"
      >
        {messagesQuery.hasNextPage ? (
          <div className="flex shrink-0 justify-center border-b border-line py-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void messagesQuery.fetchNextPage()}
            >
              {ko.chat.loadMore}
            </Button>
          </div>
        ) : null}

        {messagesQuery.isPending ? (
          <p className="px-1 py-2 text-xs text-muted">{ko.common.loading}</p>
        ) : null}

        {messagesQuery.isError ? (
          <p className="px-1 py-2 text-xs text-brick">
            {ko.errors.loadFailed}
          </p>
        ) : null}

        <ol className="flex flex-col">
          {timeline.map((item, index) =>
            item.kind === "message" ? (
              <li
                key={`message-${item.message.id}`}
                data-timeline-kind="message"
              >
                <MessageRow
                  message={item.message}
                  projectId={projectId}
                  meId={meId}
                  resolveName={resolveName}
                  grouped={isGroupedTimelineMessage(
                    timeline[index - 1],
                    item.message,
                  )}
                  onDelete={handleDelete}
                />
              </li>
            ) : (
              <li
                key={`event-${item.event.id}`}
                data-timeline-kind="event"
                className="px-1 py-1"
              >
                <p className="text-xs leading-relaxed text-muted">
                  {renderEvent(item.event, EVENT_RENDER_CONTEXT).map(
                    (segment, segmentIndex) => (
                      <span
                        key={`${item.event.id}-${segmentIndex}`}
                        data-segment={segment.kind}
                        className={EVENT_SEGMENT_CLASSES[segment.kind]}
                      >
                        {segment.text}
                      </span>
                    ),
                  )}
                </p>
              </li>
            ),
          )}
        </ol>
      </div>

      <MessageComposer
        onSubmit={handleSend}
        members={members}
        placeholder={ko.partyChat.composerPlaceholder}
      />

      <EventTimeline
        events={events}
        isPending={eventsPending}
        isError={eventsError}
      />
    </section>
  );
}

export default QuestChat;
