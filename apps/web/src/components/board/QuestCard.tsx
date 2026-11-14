/**
 * A single draggable quest card.
 *
 * The whole card is the drag activator (pointer/touch sensors) and also opens
 * the quest drawer when clicked. It renders the shared card information:
 * `#number`, title, tag chips, an optional rank badge, relative creation time
 * and the creator's adventurer sprite.
 */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { QuestSummary } from "@guildloom/shared";
import type { KeyboardEvent } from "react";

import { ko } from "../../i18n/ko";
import { formatKoreanDate, relativeTime } from "../../lib/format";
import AdventurerSprite from "../AdventurerSprite";

/** Props for {@link QuestCard}. */
export interface QuestCardProps {
  quest: QuestSummary;
  /** Called with the quest id when the card is clicked or activated by key. */
  onOpen: (questId: number) => void;
}

/** Board card for a quest. */
export function QuestCard({ quest, onOpen }: QuestCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: quest.id, data: { stage: quest.stage } });

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(quest.id);
    }
  };

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`#${quest.number} ${quest.title}`}
      data-quest-id={quest.id}
      data-stage={quest.stage}
      onClick={() => onOpen(quest.id)}
      onKeyDown={handleKeyDown}
      className={`cursor-grab touch-none select-none space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-3 text-left shadow-sm transition-colors hover:border-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${
        isDragging ? "z-10 cursor-grabbing opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold tracking-wide text-slate-500">
          #{quest.number}
        </span>
        {quest.rank ? (
          <span
            aria-label={`${ko.quest.rank} ${quest.rank}`}
            data-rank={quest.rank}
            className="rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-black text-amber-300"
          >
            {quest.rank}
          </span>
        ) : null}
      </div>

      <h3 className="text-sm font-semibold leading-snug text-slate-100">
        {quest.title}
      </h3>

      {quest.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label={ko.quest.tags}>
          {quest.tags.map((tag) => (
            <li key={tag}>
              <span className="inline-block rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                {tag}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <time
          dateTime={new Date(quest.createdAt).toISOString()}
          title={formatKoreanDate(quest.createdAt)}
          className="text-[11px] text-slate-500"
        >
          {relativeTime(quest.createdAt)}
        </time>
        <AdventurerSprite
          userId={quest.createdBy.id}
          displayName={quest.createdBy.displayName}
          size="sm"
        />
      </div>
    </article>
  );
}

export default QuestCard;
