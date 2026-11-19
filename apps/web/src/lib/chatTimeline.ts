/**
 * Merge a quest party room's messages with its key events.
 *
 * The drawer shows one mixed transcript: the party chat (oldest first) with the
 * notification-worthy quest events interleaved by timestamp. Only events that
 * notify the guild (`isKeyEvent`) are part of the timeline; ordinary edits stay
 * in the adventure log behind the [전체 기록 보기] toggle.
 *
 * Message pages load backwards from the newest page, so while older history
 * still exists (`hasMore`) the events that happened before the oldest loaded
 * message are hidden. Otherwise an event from months ago would jump above a
 * page that starts mid-conversation. With no message loaded at all the event
 * history is kept as-is.
 */
import { isKeyEvent, type ChatMessage, type QuestEvent } from "@guildloom/shared";

/** One row of the mixed party-chat timeline. */
export type ChatTimelineItem =
  | { kind: "message"; message: ChatMessage; createdAt: number }
  | { kind: "event"; event: QuestEvent; createdAt: number };

/** Options for {@link mergeChatTimeline}. */
export interface MergeChatTimelineOptions {
  /** Whether older message pages still exist above the oldest loaded one. */
  hasMore: boolean;
}

/** Earliest `createdAt` of the loaded messages, or `null` when empty. */
function oldestMessageCreatedAt(messages: ChatMessage[]): number | null {
  let oldest: number | null = null;
  for (const message of messages) {
    if (oldest === null || message.createdAt < oldest) {
      oldest = message.createdAt;
    }
  }
  return oldest;
}

/** Key events that belong in the timeline, oldest first. */
function timelineEvents(
  events: QuestEvent[] | undefined,
  cutoff: number | null,
): QuestEvent[] {
  const merged: QuestEvent[] = [];
  for (const event of events ?? []) {
    if (!isKeyEvent(event.type)) {
      continue;
    }
    if (cutoff !== null && event.createdAt < cutoff) {
      continue;
    }
    merged.push(event);
  }
  // Stable sort, so events recorded at the same millisecond keep their
  // server order.
  return merged.sort((left, right) => left.createdAt - right.createdAt);
}

/**
 * Interleave messages and key events, oldest first.
 *
 * Messages keep the order they are given in (the server returns them
 * oldest-first). An event is emitted before the first message it does not
 * follow, so an event that shares a message's timestamp comes first. With no
 * messages the events themselves are sorted by `createdAt`.
 */
export function mergeChatTimeline(
  messages: ChatMessage[],
  events: QuestEvent[] | undefined,
  { hasMore }: MergeChatTimelineOptions,
): ChatTimelineItem[] {
  const cutoff = hasMore ? oldestMessageCreatedAt(messages) : null;
  const pendingEvents = timelineEvents(events, cutoff);
  const items: ChatTimelineItem[] = [];
  let nextEvent = 0;

  for (const message of messages) {
    while (
      nextEvent < pendingEvents.length &&
      pendingEvents[nextEvent]!.createdAt <= message.createdAt
    ) {
      const event = pendingEvents[nextEvent]!;
      items.push({ kind: "event", event, createdAt: event.createdAt });
      nextEvent += 1;
    }
    items.push({
      kind: "message",
      message,
      createdAt: message.createdAt,
    });
  }

  for (; nextEvent < pendingEvents.length; nextEvent += 1) {
    const event = pendingEvents[nextEvent]!;
    items.push({ kind: "event", event, createdAt: event.createdAt });
  }

  return items;
}

export default mergeChatTimeline;
