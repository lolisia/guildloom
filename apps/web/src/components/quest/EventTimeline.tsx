/**
 * The quest's adventure log ("모험 기록").
 *
 * The section is collapsed by default: only the three most recent key events
 * (notifications-worthy moments from `isKeyEvent`) are listed, one line each
 * with its local timestamp. "전체 기록 보기 (N)" toggles the full history;
 * the expanded state is local to the drawer and resets when it closes.
 *
 * With no key events the collapsed view stands in a one-line
 * "아직 큰 사건은 없습니다" note instead of an empty list. Expanding the
 * history always replaces that note with every recorded event, key or not.
 *
 * Sentences come from the shared `renderEvent`, so the board and the drawer
 * always produce the same Korean copy.
 */
import {
  isKeyEvent,
  renderEvent,
  type EventRenderContext,
  type QuestEvent,
  type SegmentKind,
} from "@guildloom/shared";
import { useState } from "react";

import { ko } from "../../i18n/ko";
import { formatKoreanDateTime } from "../../lib/format";

/** M1 has no familiar directory yet; fall back to the familiar's sequence id. */
const EVENT_CONTEXT: EventRenderContext = {
  familiar: (familiarId) => ({ seq: familiarId }),
};

const SEGMENT_CLASSES: Record<SegmentKind, string> = {
  actor: "font-medium text-ink",
  quest: "text-teal",
  stage: "font-semibold text-ink",
  text: "text-muted",
};

/** How many key events stay visible while the history is collapsed. */
export const COLLAPSED_KEY_EVENT_LIMIT = 3;

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
  const keyEvents = chronological.filter((event) => isKeyEvent(event.type));
  const visible = expanded
    ? chronological
    : keyEvents.slice(-COLLAPSED_KEY_EVENT_LIMIT);
  const total = chronological.length;

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

      {!isPending && !isError && !expanded && keyEvents.length === 0 ? (
        <p className="text-xs text-muted">{ko.board.drawer.keyEventsEmpty}</p>
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
                {renderEvent(event, EVENT_CONTEXT).map((segment, index) => (
                  <span
                    key={`${event.id}-${index}`}
                    data-segment={segment.kind}
                    className={SEGMENT_CLASSES[segment.kind]}
                  >
                    {segment.text}
                  </span>
                ))}
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
