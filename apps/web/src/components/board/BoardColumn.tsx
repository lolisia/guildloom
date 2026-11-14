/**
 * One of the four board columns: a droppable stage lane with a sortable list of
 * quest cards. The board column doubles as the droppable target when it is
 * empty, so cards can always be moved there.
 */
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { QuestSummary } from "@guildloom/shared";
import type { ReactNode } from "react";

import { ko } from "../../i18n/ko";
import QuestCard from "./QuestCard";
import { columnDropId, type BoardStage } from "./movePlan";

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
      className={`flex min-h-[16rem] flex-col rounded-2xl border bg-slate-950/40 p-2.5 transition-colors ${
        isOver
          ? "border-emerald-500/60 bg-emerald-500/5"
          : "border-slate-800"
      }`}
    >
      <header className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <h2 className="truncate text-sm font-bold text-slate-200">
          {ko.board.columns[stage]}
        </h2>
        <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
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
            <p className="rounded-lg border border-dashed border-slate-800 px-2 py-4 text-center text-[11px] text-slate-600">
              {ko.board.emptyColumn}
            </p>
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
