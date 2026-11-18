/**
 * Quest detail drawer, opened from the board and the ledger through the
 * `?quest=<id>` URL query.
 *
 * The drawer owns the detail and event queries for one quest, inline edits
 * (title, kind, tags, situation, direction), the direction checklist, reference
 * documents, the boss clear/retry actions and the archive flow. Scalar
 * mutations update the quest cache from the server response and invalidate the
 * board and ledger lists so cards stay in sync. Tags go through a dedicated
 * optimistic mutation so rapid chip edits accumulate locally instead of racing
 * stale server state. Checklist toggles are optimistic too and fall back to a
 * fresh detail fetch when the server reports `CHECKLIST_CONFLICT`.
 *
 * Declaring a clear opens {@link ClearConfirmDialog} with the server's
 * clear-preview, then celebrates the caller's own reward through the 10s toast
 * with a 되돌리기 action (and opens the LEVEL UP modal when the settlement
 * reports a level transition for them). A cleared quest can be revoked from the
 * footer after a confirmation that names the XP being taken back.
 *
 * Layout follows DESIGN.md: the page is dimmed with the theme-aware `scrim`
 * token (never a blur) and a paper panel slides in from the right behind a
 * 1.5px line-strong rule.
 */
import {
  QUEST_KINDS,
  setChecklistItem,
  type Quest,
  type QuestKind,
  type QuestSummary,
  type UpdateQuestRequest,
} from "@guildloom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";

import { fetchMe } from "../../api/auth";
import { ApiClientError } from "../../api/client";
import {
  appendChecklist,
  archiveQuest,
  clearQuest,
  fetchEvents,
  fetchQuest,
  toggleChecklist,
  unclearQuest,
  updateQuest,
} from "../../api/quests";
import { ko } from "../../i18n/ko";
import { isImeComposing } from "../../lib/ime";
import { useLevelUpStore } from "../../lib/levelUp";
import { queryKeys } from "../../lib/queryKeys";
import { pushToast } from "../../lib/toast";
import { Button, TextInput } from "../ui";
import BossBanner from "./BossBanner";
import { ChecklistAddField, ChecklistText } from "./ChecklistText";
import ClearConfirmDialog from "./ClearConfirmDialog";
import {
  invalidateClearQueries,
  latestClearedXp,
  pushClearToast,
  sumMyReward,
} from "./clearFeedback";
import DungeonView from "./DungeonView";
import EditableTextSection from "./EditableTextSection";
import PartySection from "./PartySection";
import QuestChat from "./QuestChat";
import QuestRefs from "./QuestRefs";
import TagEditor from "./TagEditor";
import UnclearConfirmDialog from "./UnclearConfirmDialog";

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

/** Variables of one optimistic checklist toggle. */
interface ChecklistToggleVariables {
  index: number;
  text: string;
  done: boolean;
}

/** Snapshot needed to roll an optimistic checklist toggle back on failure. */
interface ChecklistToggleContext {
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

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
  });
  const meId = meQuery.data?.user.id ?? null;
  const showLevelUp = useLevelUpStore((state) => state.show);

  const quest = questQuery.data;
  const [titleDraft, setTitleDraft] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [unclearOpen, setUnclearOpen] = useState(false);
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
      if (confirmArchive || unclearOpen) {
        setConfirmArchive(false);
        setUnclearOpen(false);
        return;
      }
      onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmArchive, onClose, unclearOpen]);

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
      // The server records a `quest_edited` event for a successful tag PATCH;
      // refresh the adventure log so the drawer shows it without being
      // reopened. A failed PATCH leaves the server history unchanged, so the
      // extra refetch is harmless there too.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events(questId),
      });
      void queryClient.invalidateQueries({ queryKey: ["tags", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["quests", projectId] });
    },
  });

  /**
   * Checklist toggles are optimistic: the cached direction flips immediately
   * with the shared `setChecklistItem` helper, then the server detail replaces
   * it. A `CHECKLIST_CONFLICT` means somebody edited the list first; refetch
   * the quest and tell the caller instead of guessing which row is right.
   */
  const toggleMutation = useMutation<
    Quest,
    Error,
    ChecklistToggleVariables,
    ChecklistToggleContext
  >({
    mutationFn: ({ index, text, done }) =>
      toggleChecklist(questId, index, { done, text }),
    onMutate: async ({ index, done }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.quest(questId) });
      const previous = queryClient.getQueryData<Quest>(
        queryKeys.quest(questId),
      );
      if (previous) {
        try {
          queryClient.setQueryData<Quest>(queryKeys.quest(questId), {
            ...previous,
            direction: setChecklistItem(previous.direction, index, done),
          });
        } catch {
          // The item disappeared between render and click; the refetch below
          // will bring the current list back.
        }
      }
      return { previous };
    },
    onError: async (error, _variables, context) => {
      if (
        error instanceof ApiClientError &&
        error.code === "CHECKLIST_CONFLICT"
      ) {
        pushToast(ko.board.drawer.checklist.conflict);
        await queryClient.fetchQuery({
          queryKey: queryKeys.quest(questId),
          queryFn: ({ signal }) => fetchQuest(questId, signal),
          staleTime: 0,
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.events(questId),
        });
        void queryClient.invalidateQueries({
          queryKey: ["quests", projectId],
        });
        return;
      }
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.quest(questId), context.previous);
      }
    },
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

  /** Append one or more checklist items, then seed the detail cache. */
  const appendMutation = useMutation({
    mutationFn: (titles: string[]) => appendChecklist(questId, { titles }),
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

  const archiveMutation = useMutation({
    mutationFn: () => archiveQuest(questId, { reason: "dropped" }),
    onSuccess: (archivedQuest) => {
      // Drop the card from board caches immediately; the refetch below is the
      // source of truth once the server responds. Only summary-compatible
      // fields are copied: the detail response carries PartyMember[] while list
      // items carry PartySummary[].
      queryClient.setQueriesData<QuestSummary[]>(
        { queryKey: ["quests", projectId] },
        (list) =>
          list?.map((summary) =>
            summary.id === archivedQuest.id
              ? {
                  ...summary,
                  title: archivedQuest.title,
                  stage: archivedQuest.stage,
                  rank: archivedQuest.rank,
                  orderKey: archivedQuest.orderKey,
                  tags: archivedQuest.tags,
                  updatedAt: archivedQuest.updatedAt,
                }
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

  const clearMutation = useMutation({
    mutationFn: () => clearQuest(questId),
    onSuccess: (result) => {
      setClearOpen(false);
      queryClient.setQueryData(queryKeys.quest(questId), result.quest);
      invalidateClearQueries(queryClient, projectId, questId);

      const cachedMe = queryClient.getQueryData<{
        user: { id: number };
      }>(queryKeys.me);
      const currentMeId = cachedMe?.user.id ?? meId;
      pushClearToast(
        queryClient,
        projectId,
        questId,
        sumMyReward(result.rewards, currentMeId),
      );

      if (currentMeId !== null) {
        const levelUp = result.levelUps.find(
          (entry) => entry.userId === currentMeId,
        );
        if (levelUp) {
          showLevelUp(levelUp);
        }
      }
    },
  });

  const unclearMutation = useMutation({
    mutationFn: () => unclearQuest(questId),
    onSuccess: (updated) => {
      setUnclearOpen(false);
      queryClient.setQueryData(queryKeys.quest(questId), updated);
      invalidateClearQueries(queryClient, projectId, questId);
      pushToast(ko.board.drawer.unclear.success);
    },
  });

  const openClearConfirm = () => {
    clearMutation.reset();
    setClearOpen(true);
  };

  const openUnclearConfirm = () => {
    unclearMutation.reset();
    setUnclearOpen(true);
  };

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

  const changeKind = (next: QuestKind) => {
    if (!quest) {
      return;
    }
    const current = quest.kind ?? "fix";
    if (current !== next) {
      updateMutation.mutate({ kind: next });
    }
  };

  const overlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const kind: QuestKind = quest?.kind ?? "fix";
  const kindFields = ko.quest.kindFields[kind];
  const toggleConflict =
    toggleMutation.error instanceof ApiClientError &&
    toggleMutation.error.code === "CHECKLIST_CONFLICT";

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex justify-end bg-scrim"
      onMouseDown={overlayMouseDown}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-[40vw] min-w-[360px] max-w-[560px] flex-col rounded-none border-l-[1.5px] border-line-strong bg-paper"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-[18px] font-semibold text-ink">
            {ko.board.drawer.title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {ko.common.close}
          </Button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {questQuery.isPending ? (
            <p role="status" className="text-sm text-muted">
              {ko.common.loading}
            </p>
          ) : null}

          {questQuery.isError ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-brick">
                {ko.quest.loadFailed}
              </p>
              <Button size="sm" onClick={() => void questQuery.refetch()}>
                {ko.common.retry}
              </Button>
            </div>
          ) : null}

          {quest ? (
            <>
              {quest.stage === "boss" ? (
                <BossBanner
                  projectId={projectId}
                  quest={quest}
                  onClear={openClearConfirm}
                  clearPending={clearMutation.isPending}
                  clearError={clearMutation.error}
                />
              ) : null}

              <DungeonView quest={quest} />

              <PartySection projectId={projectId} quest={quest} />

              <div className="space-y-1.5">
                <label
                  htmlFor={titleInputId}
                  className="block text-sm font-medium text-muted"
                >
                  {ko.quest.titleLabel}
                </label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-pixel text-[12px] text-muted">
                    #{quest.number}
                  </span>
                  <TextInput
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
                    className="font-semibold"
                  />
                </div>
              </div>

              <div
                role="group"
                aria-label={ko.quest.kindLabel}
                data-testid="quest-kind"
                className="flex items-center gap-1.5"
              >
                {QUEST_KINDS.map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={kind === value ? "primary" : "secondary"}
                    aria-pressed={kind === value}
                    data-kind={value}
                    disabled={updateMutation.isPending}
                    onClick={() => changeKind(value)}
                  >
                    {ko.quest.kinds[value]}
                  </Button>
                ))}
              </div>

              <TagEditor
                projectId={projectId}
                tags={quest.tags}
                onChange={changeTags}
                disabled={updateMutation.isPending}
              />

              <EditableTextSection
                field="situation"
                label={kindFields.situation}
                value={quest.situation}
                placeholder={kindFields.situationPlaceholder}
                emptyText={kindFields.emptySituation}
                onSave={(next) => {
                  if (next !== quest.situation) {
                    updateMutation.mutate({ situation: next });
                  }
                }}
                disabled={updateMutation.isPending}
              />

              <div className="space-y-1.5">
                <EditableTextSection
                  field="direction"
                  label={kindFields.direction}
                  value={quest.direction}
                  placeholder={kindFields.directionPlaceholder}
                  emptyText={kindFields.emptyDirection}
                  onSave={(next) => {
                    if (next !== quest.direction) {
                      updateMutation.mutate({ direction: next });
                    }
                  }}
                  disabled={updateMutation.isPending}
                  renderRead={(value) => (
                    <ChecklistText
                      value={value}
                      onToggle={(item, done) =>
                        toggleMutation.mutate({
                          index: item.index,
                          text: item.text,
                          done,
                        })
                      }
                    />
                  )}
                />

                <ChecklistAddField
                  pending={appendMutation.isPending}
                  onSubmit={(titles) => appendMutation.mutate(titles)}
                />

                {appendMutation.isError ? (
                  <p role="alert" className="text-xs text-brick">
                    {ko.board.drawer.checklist.addFailed}
                  </p>
                ) : null}

                {toggleMutation.isError && !toggleConflict ? (
                  <p role="alert" className="text-xs text-brick">
                    {ko.board.drawer.checklist.toggleFailed}
                  </p>
                ) : null}
              </div>

              <QuestRefs projectId={projectId} quest={quest} />

              <QuestChat
                projectId={projectId}
                questId={questId}
                events={eventsQuery.data}
                eventsPending={eventsQuery.isPending}
                eventsError={eventsQuery.isError}
              />
            </>
          ) : null}
        </div>

        {quest ? (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
            <div className="min-w-0 text-xs text-muted">
              {unclearMutation.isError ? (
                <p role="alert" className="text-brick">
                  {ko.board.drawer.unclear.failed}
                </p>
              ) : clearMutation.isError &&
                (quest.stage === "board" || quest.stage === "dungeon") ? (
                <p role="alert" className="text-brick">
                  {ko.board.drawer.clear.failed}
                </p>
              ) : updateMutation.isError ? (
                <p role="alert" className="text-brick">
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
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {quest.stage === "board" || quest.stage === "dungeon" ? (
                <Button
                  variant="primary"
                  disabled={clearMutation.isPending || archiveMutation.isPending}
                  onClick={openClearConfirm}
                >
                  {clearMutation.isPending
                    ? ko.board.drawer.clear.working
                    : ko.board.drawer.clear.action}
                </Button>
              ) : null}
              {quest.stage === "cleared" ? (
                <Button
                  variant="danger"
                  disabled={
                    unclearMutation.isPending || archiveMutation.isPending
                  }
                  onClick={openUnclearConfirm}
                >
                  {unclearMutation.isPending
                    ? ko.board.drawer.unclear.working
                    : ko.board.drawer.unclear.action}
                </Button>
              ) : null}
              <Button
                variant="danger"
                onClick={() => {
                  archiveMutation.reset();
                  setConfirmArchive(true);
                }}
                disabled={
                  clearMutation.isPending || unclearMutation.isPending
                }
              >
                {ko.board.drawer.archive}
              </Button>
            </div>
          </footer>
        ) : null}
      </aside>

      {clearOpen ? (
        <ClearConfirmDialog
          questId={questId}
          onConfirm={() => clearMutation.mutate()}
          onClose={() => setClearOpen(false)}
          pending={clearMutation.isPending}
          failureMessage={
            clearMutation.isError
              ? ko.board.drawer.clear.failed
              : null
          }
        />
      ) : null}

      {unclearOpen ? (
        <UnclearConfirmDialog
          xp={latestClearedXp(eventsQuery.data)}
          onConfirm={() => unclearMutation.mutate()}
          onClose={() => setUnclearOpen(false)}
          pending={unclearMutation.isPending}
          failureMessage={
            unclearMutation.isError
              ? ko.board.drawer.unclear.failed
              : null
          }
        />
      ) : null}

      {confirmArchive ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
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
            className="w-full max-w-sm rounded-sm border-[1.5px] border-line-strong bg-paper p-5 shadow-hard"
          >
            <p className="text-sm font-semibold text-ink">
              {ko.board.drawer.archiveConfirm}
            </p>

            {archiveMutation.isError ? (
              <p role="alert" className="mt-2 text-xs text-brick">
                {ko.board.drawer.archiveFailed}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setConfirmArchive(false)}
                disabled={archiveMutation.isPending}
              >
                {ko.common.cancel}
              </Button>
              <Button
                variant="danger"
                onClick={() => archiveMutation.mutate()}
                disabled={archiveMutation.isPending}
              >
                {archiveMutation.isPending
                  ? ko.common.saving
                  : ko.board.drawer.archive}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

export default QuestDrawer;
