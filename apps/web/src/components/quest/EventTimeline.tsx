/**
 * The quest's adventure log ("모험 기록").
 *
 * Segments come straight from the shared `renderEvent`, so the board, the
 * drawer and later surfaces always produce the same Korean sentences. Actor /
 * quest / stage segments are styled by kind and each entry shows its local
 * timestamp.
 */
import {
  renderEvent,
  type EventRenderContext,
  type QuestEvent,
  type SegmentKind,
} from "@guildloom/shared";

import { ko } from "../../i18n/ko";
import { formatKoreanDateTime } from "../../lib/format";

/** M1 has no familiar directory yet; fall back to the familiar's sequence id. */
const EVENT_CONTEXT: EventRenderContext = {
  familiar: (familiarId) => ({ seq: familiarId }),
};

const SEGMENT_CLASSES: Record<SegmentKind, string> = {
  actor: "font-medium text-emerald-300",
  quest: "text-sky-300",
  stage: "font-semibold text-amber-300",
  text: "text-slate-300",
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
  return (
    <section aria-label={ko.board.drawer.history} className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {ko.board.drawer.history}
      </h3>

      {isPending ? (
        <p role="status" className="text-xs text-slate-500">
          {ko.common.loading}
        </p>
      ) : null}

      {isError ? (
        <p role="alert" className="text-xs text-rose-300">
          {ko.errors.loadFailed}
        </p>
      ) : null}

      {!isPending && !isError && (events?.length ?? 0) === 0 ? (
        <p className="text-xs text-slate-500">
          {ko.board.drawer.emptyHistory}
        </p>
      ) : null}

      {events && events.length > 0 ? (
        <ol className="space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              data-event-id={event.id}
              data-event-type={event.type}
              className="rounded-lg border border-slate-800/80 bg-slate-950/50 px-2.5 py-2"
            >
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
                className="mt-1 block text-[10px] text-slate-500"
              >
                {formatKoreanDateTime(event.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export default EventTimeline;
