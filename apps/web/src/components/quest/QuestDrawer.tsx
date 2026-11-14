/**
 * Quest detail drawer, opened from the board and the ledger through the
 * `?quest=<id>` URL query.
 *
 * The drawer owns the detail and event queries for one quest, inline edits
 * (title, rank, tags, situation, direction) and the archive flow. Scalar
 * mutations update the quest cache from the server response and invalidate the
 * board and ledger lists so cards stay in sync. Tags go through a dedicated
 * optimistic mutation so rapid chip edits accumulate locally instead of
 * racing stale server state.
 */
import {
  RANKS,
  type Quest,
  type QuestSummary,
  type Rank,
  type UpdateQuestRequest,
} from "@guildloom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";

import {
  archiveQuest,
  fetchEvents,
  fetchQuest,
  updateQuest,
} from "../../api/quests";
import { ko } from "../../i18n/ko";
import { isImeComposing } from "../../lib/ime";
import { queryKeys } from "../../lib/queryKeys";
import AdventurerSprite from "../AdventurerSprite";
import EditableTextSection from "./EditableTextSection";
import EventTimeline from "./EventTimeline";
import TagEditor from "./TagEditor";

/** Props for {@link QuestDrawer}. */
export interface QuestDrawerProps {
  projectId: number;
  questId: number;
  /** Closes the drawer, typically by removing the `quest` search param. */
  onClose: () => void;
}

/** Snapshot needed to roll an optimistic tag edit back on failure. */
interface TagMutationContext {
  previous: Quest | undefined;
}

/** Slide-over quest detail panel. */
export function QuestDrawer({
  projectId,
  questId,
  onClose,
}: QuestDrawerProps) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const titleInputId = useId();

  const questQuery = useQuery({
    queryKey: queryKeys.quest(questId),
    queryFn: ({ signal }) => fetchQuest(questId, signal),
  });

  const eventsQuery = useQuery({
    queryKey: queryKeys.events(questId),
    queryFn: ({ signal }) => fetchEvents(questId, signal),
  });

  const quest = questQuery.data;
  const [titleDraft, setTitleDraft] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const seededQuestId = useRef<number | null>(null);

  useEffect(() => {
    if (quest && seededQuestId.current !== quest.id) {
      seededQuestId.current = quest.id;
      setTitleDraft(quest.title);
    }
  }, [quest]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (confirmArchive) {
        setConfirmArchive(false);
        return;
      }
      onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmArchive, onClose]);

  const updateMutation = useMutation({
    mutationFn: (body: UpdateQuestRequest) => updateQuest(questId, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.quest(questId), updated);
      void queryClient.invalidateQueries({
        queryKey: ["quests", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events(questId),
      });
    },
  });

  /**
   * Tag edits are optimistic: each call carries the full cumulative list, the
   * cache is patched before the request leaves and rolled back on failure. The
   * PATCH response is deliberately ignored — a slow earlier response must not
   * overwrite tags added after it.
   */
  const tagMutation = useMutation<Quest, Error, string[], TagMutationContext>({
    mutationFn: (tags) => updateQuest(questId, { tags }),
    onMutate: async (nextTags) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.quest(questId) });
      const previous = queryClient.getQueryData<Quest>(
        queryKeys.quest(questId),
      );
      if (previous) {
        queryClient.setQueryData<Quest>(queryKeys.quest(questId), {
          ...previous,
          tags: nextTags,
        });
      }
      return { previous };
    },
    onError: (_error, _nextTags, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.quest(questId), context.previous);
      }
    },
    onSettled: () => {
      // Mark the detail stale for the next natural fetch instead of refetching
      // now: an immediate refetch can resolve while a newer tag edit is still
      // optimistic and overwrite that newer list. The tag autocomplete and
      // board lists are safe to refresh right away.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.quest(questId),
        refetchType: "none",
      });
      void queryClient.invalidateQueries({ queryKey: ["tags", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["quests", projectId] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveQuest(questId, { reason: "dropped" }),
    onSuccess: (archivedQuest) => {
      // Drop the card from board caches immediately; the refetch below is the
      // source of truth once the server responds.
      queryClient.setQueriesData<QuestSummary[]>(
        { queryKey: ["quests", projectId] },
        (list) =>
          list?.map((summary) =>
            summary.id === archivedQuest.id
              ? { ...summary, ...archivedQuest }
              : summary,
          ),
      );
      setConfirmArchive(false);
      onClose();
      void queryClient.invalidateQueries({
        queryKey: ["quests", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events(questId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["tags", projectId],
      });
    },
  });

  const commitTitle = () => {
    if (!quest) {
      return;
    }
    const next = titleDraft.trim();
    if (next.length === 0 || next === quest.title) {
      setTitleDraft(quest.title);
      return;
    }
    setTitleDraft(next);
    updateMutation.mutate({ title: next });
  };

  const changeTags = (nextTags: string[]) => {
    tagMutation.mutate(nextTags);
  };

  const overlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-950/70 backdrop-blur-sm"
      onMouseDown={overlayMouseDown}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-slate-900 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <h2 id={titleId} className="text-base font-bold text-slate-100">
            {ko.board.drawer.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={ko.common.close}
            className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {questQuery.isPending ? (
            <p role="status" className="text-sm text-slate-400">
              {ko.common.loading}
            </p>
          ) : null}

          {questQuery.isError ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-rose-300">
                {ko.quest.loadFailed}
              </p>
              <button
                type="button"
                onClick={() => void questQuery.refetch()}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
              >
                {ko.common.retry}
              </button>
            </div>
          ) : null}

          {quest ? (
            <>
              <div
                data-testid="quest-dungeon-placeholder"
                style={{ height: "120px" }}
                className="relative flex w-full shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-b from-indigo-950/70 to-slate-950"
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {ko.board.drawer.dungeonView}
                </span>
                <p className="text-sm font-semibold text-slate-300">
                  {ko.board.drawer.dungeonComingSoon}
                </p>
                <div className="absolute right-3 top-3">
                  <AdventurerSprite
                    userId={quest.createdBy.id}
                    displayName={quest.createdBy.displayName}
                    size="md"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor={titleInputId}
                  className="block text-xs font-bold uppercase tracking-wide text-slate-400"
                >
                  {ko.quest.titleLabel}
                </label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs font-bold text-slate-500">
                    #{quest.number}
                  </span>
                  <input
                    id={titleInputId}
                    type="text"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (isImeComposing(event)) {
                          return;
                        }
                        commitTitle();
                      }
                    }}
                    maxLength={200}
                    aria-label={ko.quest.titleLabel}
                    placeholder={ko.quest.titlePlaceholder}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/70"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor={`${titleInputId}-rank`}
                  className="text-xs font-bold uppercase tracking-wide text-slate-400"
                >
                  {ko.quest.rank}
                </label>
                <select
                  id={`${titleInputId}-rank`}
                  value={quest.rank ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateMutation.mutate({
                      rank: value === "" ? null : (value as Rank),
                    });
                  }}
                  aria-label={ko.quest.rank}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500/70"
                >
                  <option value="">{ko.quest.rankNone}</option>
                  {RANKS.map((rank) => (
                    <option key={rank} value={rank}>
                      {ko.quest.ranks[rank]}
                    </option>
                  ))}
                </select>
              </div>

              <TagEditor
                projectId={projectId}
                tags={quest.tags}
                onChange={changeTags}
                disabled={updateMutation.isPending}
              />

              <EditableTextSection
                field="situation"
                label={ko.board.drawer.situation}
                value={quest.situation}
                placeholder={ko.quest.situationPlaceholder}
                emptyText={ko.board.drawer.emptySituation}
                onSave={(next) => {
                  if (next !== quest.situation) {
                    updateMutation.mutate({ situation: next });
                  }
                }}
                disabled={updateMutation.isPending}
              />

              <EditableTextSection
                field="direction"
                label={ko.board.drawer.direction}
                value={quest.direction}
                placeholder={ko.quest.directionPlaceholder}
                emptyText={ko.board.drawer.emptyDirection}
                onSave={(next) => {
                  if (next !== quest.direction) {
                    updateMutation.mutate({ direction: next });
                  }
                }}
                disabled={updateMutation.isPending}
              />

              <EventTimeline
                events={eventsQuery.data}
                isPending={eventsQuery.isPending}
                isError={eventsQuery.isError}
              />
            </>
          ) : null}
        </div>

        {quest ? (
          <footer className="flex items-center justify-between gap-2 border-t border-slate-800 px-4 py-3">
            <div className="min-w-0 text-[11px] text-slate-500">
              {updateMutation.isError ? (
                <p role="alert" className="text-rose-300">
                  {ko.quest.updateFailed}
                </p>
              ) : updateMutation.isPending ? (
                <p>{ko.common.saving}</p>
              ) : (
                <p>
                  {ko.quest.createdBy}: {quest.createdBy.displayName}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                archiveMutation.reset();
                setConfirmArchive(true);
              }}
              className="shrink-0 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/10"
            >
              {ko.board.drawer.archive}
            </button>
          </footer>
        ) : null}
      </aside>

      {confirmArchive ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          data-archive-confirm="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmArchive(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={ko.board.drawer.archive}
            className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
          >
            <p className="text-sm font-semibold text-slate-100">
              {ko.board.drawer.archiveConfirm}
            </p>

            {archiveMutation.isError ? (
              <p role="alert" className="mt-2 text-xs text-rose-300">
                {ko.board.drawer.archiveFailed}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmArchive(false)}
                disabled={archiveMutation.isPending}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
              >
                {ko.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => archiveMutation.mutate()}
                disabled={archiveMutation.isPending}
                className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition-colors hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {archiveMutation.isPending
                  ? ko.common.saving
                  : ko.board.drawer.archive}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

export default QuestDrawer;
