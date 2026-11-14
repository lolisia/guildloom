/**
 * The quest's adventure log ("모험 기록").
 *
 * Segments come straight from the shared `renderEvent`, so the board, the
 * drawer and later surfaces always produce the same Korean sentences. Actor /
 * quest / stage segments are styled by kind, each entry shows its local
 * timestamp, and a 32px pack icon on the left names the kind of event at a
 * glance.
 */
import {
  renderEvent,
  type EventRenderContext,
  type QuestEvent,
  type SegmentKind,
  type Stage,
} from "@guildloom/shared";

import { ko } from "../../i18n/ko";
import { STAGE_ICON, type IconName } from "../../lib/icons";
import { formatKoreanDateTime } from "../../lib/format";
import Icon from "../Icon";

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

/** Icon for every event type except `quest_moved`, which follows its target. */
const EVENT_ICON: Record<QuestEvent["type"], IconName> = {
  quest_posted: "quest",
  quest_edited: "edit",
  quest_moved: "arrow-right",
  quest_archived: "dropped",
};

/** Icon shown to the left of an event row. */
export function eventIcon(event: QuestEvent): IconName {
  if (event.type === "quest_moved") {
    const payload = event.payload as { to?: Stage } | null | undefined;
    // A missing target falls back to the board icon; an unknown event type or
    // stage keeps the neutral arrow instead of losing the row.
    return STAGE_ICON[payload?.to ?? "board"] ?? "arrow-right";
  }

  return EVENT_ICON[event.type] ?? "arrow-right";
}

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

      {!isPending && !isError && (events?.length ?? 0) === 0 ? (
        <p className="text-xs text-muted">{ko.board.drawer.emptyHistory}</p>
      ) : null}

      {events && events.length > 0 ? (
        <ol className="space-y-1.5">
          {events.map((event) => (
            <li
              key={event.id}
              data-event-id={event.id}
              data-event-type={event.type}
              className="flex items-start gap-2 rounded-sm border border-line bg-paper px-2.5 py-2"
            >
              <Icon name={eventIcon(event)} size={32} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-relaxed">
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
                  className="mt-1 block text-xs text-muted"
                >
                  {formatKoreanDateTime(event.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export default EventTimeline;
