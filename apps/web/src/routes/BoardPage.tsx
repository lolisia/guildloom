/**
 * Four-column quest board.
 *
 * The board fetches the four active stages in one request, groups the cards by
 * stage and lets adventurers drag cards between columns (or reorder within one)
 * with `@dnd-kit`. Drops are applied optimistically and rolled back when the
 * move endpoint fails. Quick add and bulk paste live at the top of the board
 * column; clicking a card opens the shared quest drawer through `?quest=<id>`.
 */
import {
  closestCorners,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BOARD_COLUMNS,
  type ListQuestsQuery,
  type QuestSummary,
} from "@guildloom/shared";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { fetchQuests, moveQuest } from "../api/quests";
import BoardColumn from "../components/board/BoardColumn";
import QuickAdd from "../components/board/QuickAdd";
import {
  groupQuestsByStage,
  planQuestMove,
  type QuestMovePlan,
} from "../components/board/movePlan";
import QuestDrawer from "../components/quest/QuestDrawer";
import { ko } from "../i18n/ko";
import { queryKeys } from "../lib/queryKeys";

/** Filters shared by the board query and its optimistic cache updates. */
const BOARD_FILTERS: ListQuestsQuery = {
  stage: BOARD_COLUMNS.join(","),
};

interface MoveVariables {
  plan: QuestMovePlan;
  /** Full optimistic list used for the immediate cache update. */
  quests: QuestSummary[];
}

/** Parse a positive integer route/search value. */
function parsePositiveInt(raw: string | null | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Main quest board. */
export default function BoardPage() {
  const { projectId: projectIdParam } = useParams<{ projectId: string }>();
  const parsedProjectId = parsePositiveInt(projectIdParam);
  const projectId = parsedProjectId ?? 0;

  const [searchParams, setSearchParams] = useSearchParams();
  const openQuestId = parsePositiveInt(searchParams.get("quest"));

  const queryClient = useQueryClient();
  const quickAddRef = useRef<HTMLInputElement | null>(null);
  const justDraggedRef = useRef(false);

  const questsQuery = useQuery({
    queryKey: queryKeys.quests(projectId, BOARD_FILTERS),
    queryFn: ({ signal }) => fetchQuests(projectId, BOARD_FILTERS, signal),
    enabled: parsedProjectId !== null,
  });

  const columns = useMemo(
    () => groupQuestsByStage(questsQuery.data ?? []),
    [questsQuery.data],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const moveMutation = useMutation({
    mutationFn: ({ plan }: MoveVariables) =>
      moveQuest(plan.questId, {
        stage: plan.stage,
        beforeId: plan.beforeId,
        afterId: plan.afterId,
      }),
    onMutate: async ({ quests }: MoveVariables) => {
      const key = queryKeys.quests(projectId, BOARD_FILTERS);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<QuestSummary[]>(key);
      queryClient.setQueryData(key, quests);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.quests(projectId, BOARD_FILTERS),
          context.previous,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["quests", projectId],
      });
    },
  });

  const openQuest = useCallback(
    (questId: number) => {
      if (justDraggedRef.current) {
        return;
      }
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set("quest", String(questId));
        return next;
      });
    },
    [setSearchParams],
  );

  const closeQuest = useCallback(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("quest");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const markJustDragged = () => {
    // A drag ends with `pointerup`, which browsers turn into a `click` on the
    // card. Suppress that one click so dropping does not also open the drawer.
    justDraggedRef.current = true;
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    markJustDragged();
    const { active, over } = event;
    if (!over) {
      return;
    }
    const activeId = Number(active.id);
    if (!Number.isInteger(activeId)) {
      return;
    }

    const result = planQuestMove(
      questsQuery.data ?? [],
      activeId,
      over.id,
    );
    if (!result) {
      return;
    }
    moveMutation.mutate({
      plan: result.plan,
      quests: result.quests,
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key.toLowerCase() !== "n"
      ) {
        return;
      }

      const elements = [
        event.target as HTMLElement | null,
        document.activeElement as HTMLElement | null,
      ];
      for (const element of elements) {
        if (!element) {
          continue;
        }
        const tag = element.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          element.isContentEditable
        ) {
          return;
        }
      }

      // Do not steal focus from an open dialog (quest drawer / bulk confirm).
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }

      const input = quickAddRef.current;
      if (!input) {
        return;
      }
      event.preventDefault();
      input.focus();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (parsedProjectId === null) {
    return (
      <section className="space-y-2">
        <p role="alert" className="text-sm text-rose-300">
          {ko.errors.notFound}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h1 className="sr-only">{ko.board.title}</h1>

      {questsQuery.isPending ? (
        <p role="status" className="text-xs text-slate-500">
          {ko.board.loading}
        </p>
      ) : null}

      {questsQuery.isError ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-xs text-rose-300">
            {ko.board.loadFailed}
          </p>
          <button
            type="button"
            onClick={() => void questsQuery.refetch()}
            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
          >
            {ko.common.retry}
          </button>
        </div>
      ) : null}

      <p className="text-[11px] text-slate-500">{ko.board.dragHint}</p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
        onDragCancel={markJustDragged}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {BOARD_COLUMNS.map((stage) => (
            <BoardColumn
              key={stage}
              stage={stage}
              quests={columns[stage]}
              onOpenQuest={openQuest}
            >
              {stage === "board" ? (
                <QuickAdd projectId={projectId} inputRef={quickAddRef} />
              ) : null}
            </BoardColumn>
          ))}
        </div>
      </DndContext>

      {moveMutation.isError ? (
        <p role="alert" className="text-xs text-rose-300">
          {ko.board.moveFailed}
        </p>
      ) : null}

      {openQuestId !== null ? (
        <QuestDrawer
          projectId={projectId}
          questId={openQuestId}
          onClose={closeQuest}
        />
      ) : null}
    </section>
  );
}
