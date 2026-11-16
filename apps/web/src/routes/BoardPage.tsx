/**
 * Four-column quest board.
 *
 * The board fetches the four active stages in one request, groups the cards by
 * stage and lets adventurers drag cards between columns (or reorder within one)
 * with `@dnd-kit`. Drops are applied optimistically and rolled back when the
 * move endpoint fails. A card dropped into the `cleared` column is different:
 * the move settles XP on the server, so it waits for the clear-preview
 * confirmation dialog and only then sends the move. The resulting toast takes
 * the caller's share from that preview because the move response has no
 * rewards. Quick add and bulk paste live at the top of the board column;
 * clicking a card opens the shared quest drawer through `?quest=<id>`.
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
  type ClearPreviewResponse,
  type ListQuestsQuery,
  type QuestSummary,
} from "@guildloom/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { fetchQuests, moveQuest } from "../api/quests";
import BoardColumn from "../components/board/BoardColumn";
import QuickAdd from "../components/board/QuickAdd";
import {
  groupQuestsByStage,
  planQuestMove,
  type QuestMovePlan,
} from "../components/board/movePlan";
import {
  invalidateClearQueries,
  pushClearToast,
  sumMyPreviewReward,
} from "../components/quest/clearFeedback";
import ClearConfirmDialog from "../components/quest/ClearConfirmDialog";
import QuestDrawer from "../components/quest/QuestDrawer";
import { Button, Panel } from "../components/ui";
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
  /** Stage the card was in before the drop, for revocation invalidation. */
  fromStage: QuestSummary["stage"];
  /**
   * The caller's share of the clear preview when the drop cleared the quest.
   * Its presence is also what queues the celebration toast on success.
   */
  clearReward?: number;
}

/** A cleared-column drop waiting for its confirmation dialog. */
interface PendingClearDrop {
  plan: QuestMovePlan;
  quests: QuestSummary[];
  fromStage: QuestSummary["stage"];
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
  const [pendingClearDrop, setPendingClearDrop] =
    useState<PendingClearDrop | null>(null);

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
    onSuccess: (_data, { plan, clearReward }) => {
      if (clearReward === undefined) {
        return;
      }
      setPendingClearDrop(null);
      pushClearToast(queryClient, projectId, plan.questId, clearReward);
    },
    onSettled: (_data, _error, { plan, fromStage }) => {
      // A move rewrites the quest's stage and order and writes a
      // `quest_moved` event, so an open drawer of the dragged quest is stale
      // until its detail and timeline refetch.
      const questId = plan.questId;
      void queryClient.invalidateQueries({
        queryKey: ["quests", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.quest(questId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events(questId),
      });
      // Entering or leaving `cleared` also settles/revokes XP, so the
      // adventurer, guild members and notification bell are stale too.
      if (plan.stage === "cleared" || fromStage === "cleared") {
        invalidateClearQueries(queryClient, projectId, questId);
      }
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
    if (pendingClearDrop) {
      return;
    }
    const { active, over } = event;
    if (!over) {
      return;
    }
    const activeId = Number(active.id);
    if (!Number.isInteger(activeId)) {
      return;
    }

    const quests = questsQuery.data ?? [];
    const dragged = quests.find((quest) => quest.id === activeId);
    const result = planQuestMove(quests, activeId, over.id);
    if (!dragged || !result) {
      return;
    }

    // Dropping into `cleared` settles XP: ask first, and do not touch the
    // board until the dialog is confirmed.
    if (result.plan.stage === "cleared" && dragged.stage !== "cleared") {
      // Drop any failure from an earlier move so the dialog starts clean.
      moveMutation.reset();
      setPendingClearDrop({
        plan: result.plan,
        quests: result.quests,
        fromStage: dragged.stage,
      });
      return;
    }

    moveMutation.mutate({
      plan: result.plan,
      quests: result.quests,
      fromStage: dragged.stage,
    });
  };

  const confirmClearDrop = (preview: ClearPreviewResponse) => {
    if (!pendingClearDrop) {
      return;
    }
    const cachedMe = queryClient.getQueryData<{
      user: { id: number };
    }>(queryKeys.me);
    const myShare = sumMyPreviewReward(
      preview,
      cachedMe?.user.id ?? null,
    );
    moveMutation.mutate({
      ...pendingClearDrop,
      clearReward: myShare,
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
      <section className="min-h-full space-y-2 bg-ground text-ink">
        <p role="alert" className="text-sm text-brick">
          {ko.errors.notFound}
        </p>
      </section>
    );
  }

  return (
    <section className="min-h-full space-y-4 bg-ground text-ink">
      <h1 className="sr-only">{ko.board.title}</h1>

      {questsQuery.isPending ? (
        <p role="status" className="text-xs text-muted">
          {ko.board.loading}
        </p>
      ) : null}

      {questsQuery.isError ? (
        <Panel className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-[13px] text-brick">
            {ko.board.loadFailed}
          </p>
          <Button onClick={() => void questsQuery.refetch()}>
            {ko.common.retry}
          </Button>
        </Panel>
      ) : null}

      <p className="text-[13px] text-muted">{ko.board.dragHint}</p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
        onDragCancel={markJustDragged}
      >
        <div
          data-testid="board-grid"
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"
        >
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
        <p role="alert" className="text-[13px] text-brick">
          {ko.board.moveFailed}
        </p>
      ) : null}

      {pendingClearDrop ? (
        <ClearConfirmDialog
          questId={pendingClearDrop.plan.questId}
          onConfirm={confirmClearDrop}
          onClose={() => setPendingClearDrop(null)}
          pending={moveMutation.isPending}
          failureMessage={
            moveMutation.isError ? ko.board.moveFailed : null
          }
        />
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
