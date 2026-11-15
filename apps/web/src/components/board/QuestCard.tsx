/**
 * A single draggable quest card: a paper request sheet pinned to the board.
 *
 * The whole card is the drag activator (pointer/touch sensors) and also opens
 * the quest drawer when clicked. Beyond the number, title and tags it shows the
 * M2a live board data: the active party (leader first, with status rings),
 * floor progress, the growing bounty and any pending nominations. A feature
 * request ("신규") carries a small border chip; dusty unclaimed quests are
 * desaturated and announce that state to assistive tech. A pending nomination
 * for the signed-in adventurer emphasises the card outline in teal.
 *
 * Only the card being dragged is lifted off the wall: DESIGN.md's hard
 * `4px 4px 0 ink` shadow plus a `translate(-2px, -2px)` paper-lift. Resting
 * cards have no shadow at all.
 */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { QuestSummary } from "@guildloom/shared";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, KeyboardEvent } from "react";

import { fetchMyNominations } from "../../api/party";
import { ko } from "../../i18n/ko";
import { formatKoreanDate, relativeTime } from "../../lib/format";
import { queryKeys } from "../../lib/queryKeys";
import AdventurerSprite from "../AdventurerSprite";
import { Chip } from "../ui";
import PartyAvatarRow from "./PartyAvatarRow";

/** Props for {@link QuestCard}. */
export interface QuestCardProps {
  quest: QuestSummary;
  /** Called with the quest id when the card is clicked or activated by key. */
  onOpen: (questId: number) => void;
}

/** Width of the floor progress bar, clamped to 0–100%. */
export function floorProgressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (done / total) * 100));
}

/**
 * Bounty total with Korean thousands separators.
 *
 * Exported so the ledger renders the same reward number as the board card.
 */
export function formatBounty(total: number): string {
  return Math.round(total).toLocaleString("ko-KR");
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

  // Every card subscribes to the same key, so TanStack Query issues one request
  // for the whole board and keeps the emphasis in sync when a nomination is
  // accepted or passed elsewhere in the app.
  const myNominationsQuery = useQuery({
    queryKey: queryKeys.myNominations,
    queryFn: ({ signal }) => fetchMyNominations(signal),
    retry: false,
  });

  const hasMyNomination =
    myNominationsQuery.data?.some(
      (nomination) =>
        nomination.questId === quest.id && nomination.state === "pending",
    ) ?? false;
  const dusty = quest.bounty.dusty;
  const floorPercent = floorProgressPercent(
    quest.floors.done,
    quest.floors.total,
  );
  // The board stage is the unclaimed lane: there the creator avatar gives way
  // to the dashed "빈 파티" slip until someone joins the party.
  const showEmptyParty = quest.stage === "board" && quest.party.length === 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // rules-allow ime-enter: 텍스트 입력이 아닌 카드 키보드 활성화
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

  const cardClasses = [
    "flex cursor-grab touch-none select-none flex-col gap-1 rounded-sm border-[1.5px] bg-paper px-2.5 py-2 text-left transition-colors",
    hasMyNomination ? "border-teal" : "border-line-strong",
    dusty ? "saturate-50" : "",
    isDragging ? "relative cursor-grabbing" : "",
  ]
    .filter(Boolean)
    .join(" ");

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
      data-my-nomination={hasMyNomination ? "true" : undefined}
      data-dusty={dusty ? "true" : undefined}
      onClick={() => onOpen(quest.id)}
      onKeyDown={handleKeyDown}
      className={cardClasses}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-pixel text-[12px] text-muted">
          #{quest.number}
        </span>
        {quest.kind === "feature" ? (
          <span
            data-kind="feature"
            className="inline-flex items-center rounded-sm border border-line px-1 text-[12px] leading-4 text-muted"
          >
            {ko.quest.kinds.feature}
          </span>
        ) : null}
        {dusty ? <span className="sr-only">{ko.quest.dusty}</span> : null}
      </div>

      <h3 className="text-[14px] font-semibold leading-snug text-ink">
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

      <PartyAvatarRow party={quest.party} />

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span className="sr-only">{ko.quest.floors}</span>
          <span className="font-pixel text-[12px] text-ink">
            {quest.floors.done}/{quest.floors.total}
          </span>
          {quest.floors.total > 0 ? (
            <span
              role="progressbar"
              aria-label={`${ko.quest.floors} ${quest.floors.done}/${quest.floors.total}`}
              aria-valuemin={0}
              aria-valuemax={quest.floors.total}
              aria-valuenow={quest.floors.done}
              className="h-1 min-w-10 flex-1 overflow-hidden rounded-sm bg-sunken"
            >
              <span
                className="block h-full bg-teal"
                style={{ width: `${floorPercent}%` }}
              />
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <span className="sr-only">{ko.quest.bounty}</span>
            <span className="font-pixel text-[12px] text-gold">
              {formatBounty(quest.bounty.total)}
            </span>
          </span>

          {quest.bounty.multiplier > 1 ? (
            <span className="inline-flex items-center rounded-sm border border-gold px-1 font-pixel text-[12px] text-gold">
              {ko.quest.bountyMultiplier(quest.bounty.multiplier)}
            </span>
          ) : null}

          {quest.pendingNominations > 0 ? (
            <span
              data-pending-nominations={quest.pendingNominations}
              className="inline-flex items-center gap-1 rounded-sm border border-line px-1 py-0.5 text-xs text-muted"
            >
              <span>
                {ko.quest.pendingNominations}{" "}
                <span className="font-pixel text-[12px] text-ink">
                  {quest.pendingNominations}
                </span>
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <time
          dateTime={new Date(quest.createdAt).toISOString()}
          title={formatKoreanDate(quest.createdAt)}
          className="text-[12px] text-muted"
        >
          {relativeTime(quest.createdAt)}
        </time>
        {showEmptyParty ? (
          <span
            data-testid="empty-party"
            className="inline-flex h-6 items-center rounded-sm border-[1.5px] border-dashed border-line-strong px-2 text-[12px] text-muted"
          >
            {ko.quest.emptyParty}
          </span>
        ) : (
          <AdventurerSprite
            userId={quest.createdBy.id}
            displayName={quest.createdBy.displayName}
            size="sm"
          />
        )}
      </div>
    </article>
  );
}

export default QuestCard;
