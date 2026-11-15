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
 *
 * Layout follows DESIGN.md: the page is dimmed with the theme-aware `scrim`
 * token (never a blur) and a paper panel slides in from the right behind a
 * 1.5px line-strong rule.
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
import { STAGE_ICON } from "../../lib/icons";
import { queryKeys } from "../../lib/queryKeys";
import AdventurerSprite from "../AdventurerSprite";
import Icon from "../Icon";
import RankBadge from "../RankBadge";
import { Button, TextInput } from "../ui";
import EditableTextSection from "./EditableTextSection";
import EventTimeline from "./EventTimeline";
import { STAGE_MARK_CLASSES } from "./stageMark";
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

  const archiveMutation = useMutation({
    mutationFn: () => archiveQuest(questId, { reason: "dropped" }),
    onSuccess: (archivedQuest) => {
      // Drop the card from board caches immediately; the refetch below is the
      // source of truth once the server responds. Only summary-compatible
      // fields are copied: the detail response carries PartyMember[]/Floor[]
      // while list items carry PartySummary[]/{done,total}.
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
      className="fixed inset-0 z-40 flex justify-end bg-scrim"
      onMouseDown={overlayMouseDown}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full max-w-xl flex-col rounded-none border-l-[1.5px] border-line-strong bg-paper"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {ko.board.drawer.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={ko.common.close}
            className="rounded-sm p-1 text-ink transition-colors hover:bg-sunken"
          >
            <Icon name="close" size={32} />
          </button>
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
              <div
                data-testid="quest-dungeon-placeholder"
                style={{ height: "120px" }}
                className="relative flex w-full shrink-0 items-center justify-center overflow-hidden rounded-sm border-[1.5px] border-line-strong bg-sunken"
              >
                <div className="absolute inset-y-3 left-3 flex flex-col items-center justify-center gap-1">
                  <Icon name={STAGE_ICON[quest.stage]} size={64} />
                  <span
                    aria-hidden="true"
                    data-stage-mark={quest.stage}
                    className={`h-0.5 w-10 ${STAGE_MARK_CLASSES[quest.stage]}`}
                  />
                </div>
                <div className="flex flex-col items-center gap-0.5 px-16 text-center">
                  <span className="text-xs font-medium text-muted">
                    {ko.board.drawer.dungeonView}
                  </span>
                  <p className="text-sm font-semibold text-ink">
                    {ko.board.drawer.dungeonComingSoon}
                  </p>
                </div>
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
                  className="block text-sm font-medium text-muted"
                >
                  {ko.quest.titleLabel}
                </label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-pixel text-xs text-muted">
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

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor={`${titleInputId}-rank`}
                    className="text-sm font-medium text-muted"
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
                    className="h-8 rounded-sm border-[1.5px] border-line-strong bg-paper px-2 text-sm text-ink"
                  >
                    <option value="">{ko.quest.rankNone}</option>
                    {RANKS.map((rank) => (
                      <option key={rank} value={rank}>
                        {ko.quest.ranks[rank]}
                      </option>
                    ))}
                  </select>
                </div>
                <RankBadge rank={quest.rank} size={64} />
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
          <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
            <div className="min-w-0 text-xs text-muted">
              {updateMutation.isError ? (
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
            <Button
              variant="danger"
              icon="dropped"
              onClick={() => {
                archiveMutation.reset();
                setConfirmArchive(true);
              }}
              className="shrink-0"
            >
              {ko.board.drawer.archive}
            </Button>
          </footer>
        ) : null}
      </aside>

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
