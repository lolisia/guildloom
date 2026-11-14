/**
 * A single draggable quest card: a paper request sheet pinned to the board.
 *
 * The whole card is the drag activator (pointer/touch sensors) and also opens
 * the quest drawer when clicked. It renders the shared card information:
 * the pixel `#number`, rank insignia, title, tag chips, relative creation time
 * and the creator's adventurer sprite.
 *
 * Only the card being dragged is lifted off the wall: DESIGN.md's hard
 * `4px 4px 0 ink` shadow plus a `translate(-2px, -2px)` paper-lift. Resting
 * cards have no shadow at all.
 */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { QuestSummary } from "@guildloom/shared";
import type { CSSProperties, KeyboardEvent } from "react";

import { ko } from "../../i18n/ko";
import { formatKoreanDate, relativeTime } from "../../lib/format";
import AdventurerSprite from "../AdventurerSprite";
import RankBadge from "../RankBadge";
import { Chip } from "../ui";

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

  const dragTransform = CSS.Transform.toString(transform);
  const style: CSSProperties = {
    transition: isDragging ? undefined : transition,
  };
  if (dragTransform) {
    style.transform = dragTransform;
  }
  if (isDragging) {
    // Combine the dnd-kit transform with the lift so the card keeps following
    // the pointer while sitting 2px up and to the left.
    style.transform = dragTransform
      ? `${dragTransform} translate(-2px, -2px)`
      : "translate(-2px, -2px)";
    style.boxShadow = "4px 4px 0 var(--color-ink)";
    style.zIndex = 10;
  }

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`#${quest.number} ${quest.title}`}
      data-quest-id={quest.id}
      data-stage={quest.stage}
      onClick={() => onOpen(quest.id)}
      onKeyDown={handleKeyDown}
      className={`flex cursor-grab touch-none select-none flex-col gap-2 rounded-sm border-[1.5px] border-line-strong bg-paper px-[14px] py-3 text-left transition-colors ${
        isDragging ? "relative cursor-grabbing" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-pixel text-[12px] text-muted">
          #{quest.number}
        </span>
        <RankBadge rank={quest.rank} size={32} />
      </div>

      <h3 className="text-[15px] font-semibold leading-snug text-ink">
        {quest.title}
      </h3>

      {quest.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label={ko.quest.tags}>
          {quest.tags.map((tag) => (
            <li key={tag}>
              <Chip>{tag}</Chip>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <time
          dateTime={new Date(quest.createdAt).toISOString()}
          title={formatKoreanDate(quest.createdAt)}
          className="text-[12px] text-muted"
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
