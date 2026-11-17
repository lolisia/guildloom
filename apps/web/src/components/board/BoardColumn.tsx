/**
 * One of the four board columns: a sunken stage lane with a sortable list of
 * quest cards. The board column doubles as the droppable target when it is
 * empty, so cards can always be moved there.
 *
 * The header follows DESIGN.md: 32px stage icon, Galmuri11 12px title/count
 * and a 2px underline in the stage colour (board=ink, dungeon=teal, boss=brick,
 * cleared=gold).
 */
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { QuestSummary } from "@guildloom/shared";
import type { ReactNode } from "react";

import { ko } from "../../i18n/ko";
import { STAGE_ICON } from "../../lib/icons";
import Icon from "../Icon";
import { EmptyState } from "../ui";
import QuestCard from "./QuestCard";
import { columnDropId, type BoardStage } from "./movePlan";

/** The 2px underline that marks each stage's header. */
const STAGE_UNDERLINE: Record<BoardStage, string> = {
  board: "border-ink",
  dungeon: "border-teal",
  boss: "border-brick",
  cleared: "border-gold",
};

/** Props for {@link BoardColumn}. */
export interface BoardColumnProps {
  stage: BoardStage;
  quests: QuestSummary[];
  onOpenQuest: (questId: number) => void;
  /** Optional content rendered between the header and the cards (quick add). */
  children?: ReactNode;
}

/** A single stage column. */
export function BoardColumn({
  stage,
  quests,
  onOpenQuest,
  children,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(stage) });

  return (
    <section
      ref={setNodeRef}
      data-stage={stage}
      aria-label={ko.board.columns[stage]}
      className={`flex min-h-64 flex-col gap-2 rounded-sm border-[1.5px] bg-sunken p-2 transition-colors ${
        isOver ? "border-teal" : "border-line-strong"
      }`}
    >
      <header
        className={`flex items-center gap-2 border-b-2 pb-2 ${STAGE_UNDERLINE[stage]}`}
      >
        <Icon name={STAGE_ICON[stage]} size={32} />
        <h2 className="min-w-0 truncate font-pixel text-[12px] text-ink">
          {ko.board.columns[stage]}
        </h2>
        <span className="ml-auto shrink-0 font-pixel text-[12px] text-muted">
          {ko.board.questCount(quests.length)}
        </span>
      </header>

      {children}

      <SortableContext
        items={quests.map((quest) => quest.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2">
          {quests.length === 0 ? (
            <EmptyState icon="empty" text={ko.board.emptyColumn} />
          ) : (
            quests.map((quest) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                onOpen={onOpenQuest}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  );
}

export default BoardColumn;
