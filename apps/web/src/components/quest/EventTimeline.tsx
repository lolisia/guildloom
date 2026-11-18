/**
 * The quest's adventure log ("모험 기록").
 *
 * The section only shows its heading and the "전체 기록 보기 (N)" toggle until
 * the adventurer asks for the history; the party chat above it already carries
 * the key events that matter while talking. Expanding lists every recorded
 * event in chronological order (key or not), one line each with its local
 * timestamp. The expanded state is local to the drawer and resets when it
 * closes. With no events at all only the heading remains.
 *
 * Sentences come from the shared `renderEvent`, so the board, the adventure log
 * and the party-chat timeline always produce the same Korean copy.
 */
import {
  renderEvent,
  type EventRenderContext,
  type QuestEvent,
  type SegmentKind,
} from "@guildloom/shared";
import { useState } from "react";

import { ko } from "../../i18n/ko";
import { formatKoreanDateTime } from "../../lib/format";

/** M1 has no familiar directory yet; fall back to the familiar's sequence id. */
export const EVENT_RENDER_CONTEXT: EventRenderContext = {
  familiar: (familiarId) => ({ seq: familiarId }),
};

/** Segment colours shared with the party-chat timeline. */
export const EVENT_SEGMENT_CLASSES: Record<SegmentKind, string> = {
  actor: "font-medium text-ink",
  quest: "text-teal",
  stage: "font-semibold text-ink",
  text: "text-muted",
};

/** Props for {@link EventTimeline}. */
export interface EventTimelineProps {
  events: QuestEvent[] | undefined;
  isPending?: boolean;
  isError?: boolean;
}

/** Rendered quest event history. */
export function EventTimeline({
  events,
  isPending = false,
  isError = false,
}: EventTimelineProps) {
  const [expanded, setExpanded] = useState(false);

  const chronological = [...(events ?? [])].sort(
    (left, right) => left.createdAt - right.createdAt || left.id - right.id,
  );
  const total = chronological.length;
  const visible = expanded ? chronological : [];

  return (
    <section aria-label={ko.board.drawer.history} className="space-y-2">
      <h3 className="text-sm font-medium text-muted">
        {ko.board.drawer.history}
      </h3>

      {isPending ? (
        <p role="status" className="text-xs text-muted">
          {ko.common.loading}
        </p>
      ) : null}

      {isError ? (
        <p role="alert" className="text-xs text-brick">
          {ko.errors.loadFailed}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <ol className="space-y-1">
          {visible.map((event) => (
            <li
              key={event.id}
              data-event-id={event.id}
              data-event-type={event.type}
              className="flex items-baseline justify-between gap-2 rounded-sm border border-line bg-paper px-2.5 py-1.5"
            >
              <p className="min-w-0 text-xs leading-relaxed">
                {renderEvent(event, EVENT_RENDER_CONTEXT).map(
                  (segment, index) => (
                    <span
                      key={`${event.id}-${index}`}
                      data-segment={segment.kind}
                      className={EVENT_SEGMENT_CLASSES[segment.kind]}
                    >
                      {segment.text}
                    </span>
                  ),
                )}
              </p>
              <time
                dateTime={new Date(event.createdAt).toISOString()}
                className="shrink-0 text-xs text-muted"
              >
                {formatKoreanDateTime(event.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      ) : null}

      {!isPending && !isError && total > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="rounded-sm px-1 text-xs font-medium text-teal transition-colors hover:bg-sunken hover:text-ink"
        >
          {ko.board.drawer.showAllHistory(total)}
        </button>
      ) : null}
    </section>
  );
}

export default EventTimeline;
