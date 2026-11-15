/**
 * Boss fight banner (보스전) at the top of the quest drawer.
 *
 * A quest in the `boss` stage waits for the requester's confirmation, so the
 * banner offers two actions: declare the clear (`POST /api/quests/:id/clear`)
 * or ask for another attempt (`POST /api/quests/:id/retry`). The retry dialog
 * requires a 1–500 character comment; its submit button stays disabled until
 * the trimmed comment is non-empty.
 *
 * The banner is paper with a 1.5px brick rule and brick copy so it reads as the
 * dangerous stage without introducing a second accent colour. The dialog uses
 * the paper + 1.5px line-strong + hard shadow dialog surface from DESIGN.md.
 */
import type { Quest, RetryQuestRequest } from "@guildloom/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MouseEvent } from "react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { retryQuest } from "../../api/quests";
import { ko } from "../../i18n/ko";
import Icon from "../Icon";
import { Button, TextArea } from "../ui";
import { applyQuestUpdate } from "./partyCache";

/** Comment limit enforced by `retryQuestRequestSchema`. */
export const MAX_RETRY_COMMENT_LENGTH = 500;

/** Props for {@link BossBanner}. */
export interface BossBannerProps {
  projectId: number;
  quest: Quest;
  /** Declare the clear through the shared drawer clear mutation. */
  onClear: () => void;
  /** Whether a clear request is in flight. */
  clearPending: boolean;
  /** Failure from the shared clear mutation. */
  clearError: unknown;
}

/** Required-comment dialog for 재도전 요청. */
function RetryDialog({
  questId,
  projectId,
  onClose,
}: {
  questId: number;
  projectId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const descriptionId = useId();
  const commentId = useId();
  const [comment, setComment] = useState("");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      // Capture phase: dismiss only this dialog, not the quest drawer behind it.
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const retryMutation = useMutation({
    mutationFn: (body: RetryQuestRequest) => retryQuest(questId, body),
    onSuccess: (updated) => {
      applyQuestUpdate(queryClient, projectId, updated);
      onClose();
    },
  });

  const trimmed = comment.trim();
  const canSubmit =
    trimmed.length > 0 && trimmed.length <= MAX_RETRY_COMMENT_LENGTH;

  const overlayMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget && !retryMutation.isPending) {
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      data-retry-dialog="true"
      onMouseDown={overlayMouseDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-sm rounded-sm border-[1.5px] border-line-strong bg-paper p-5 shadow-hard"
      >
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {ko.board.drawer.bossBattle.retryTitle}
        </h2>
        <p id={descriptionId} className="mt-1 text-xs text-muted">
          {ko.board.drawer.bossBattle.retryDescription}
        </p>

        <div className="mt-4 space-y-1.5">
          <label
            htmlFor={commentId}
            className="block text-xs font-medium text-ink"
          >
            {ko.board.drawer.bossBattle.retryCommentLabel}
          </label>
          <TextArea
            id={commentId}
            value={comment}
            rows={4}
            maxLength={MAX_RETRY_COMMENT_LENGTH}
            placeholder={ko.board.drawer.bossBattle.retryCommentPlaceholder}
            onChange={(event) => setComment(event.target.value)}
            autoFocus
          />
        </div>

        {retryMutation.isError ? (
          <p role="alert" className="mt-2 text-xs text-brick">
            {ko.board.drawer.bossBattle.retryFailed}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={retryMutation.isPending}
          >
            {ko.common.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit || retryMutation.isPending}
            onClick={() => retryMutation.mutate({ comment: trimmed })}
          >
            {retryMutation.isPending
              ? ko.board.drawer.bossBattle.retrySubmitting
              : ko.board.drawer.bossBattle.retrySubmit}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Brick-highlighted boss banner with clear and retry actions. */
export function BossBanner({
  projectId,
  quest,
  onClear,
  clearPending,
  clearError,
}: BossBannerProps) {
  const [retryOpen, setRetryOpen] = useState(false);

  return (
    <section
      aria-label={ko.board.drawer.bossBattle.waiting}
      data-testid="boss-banner"
      data-boss-stage="true"
      className="rounded-sm border-[1.5px] border-brick bg-paper px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <Icon name="boss" size={64} />
        <p className="min-w-0 text-sm font-semibold leading-snug text-brick">
          {ko.board.drawer.bossBattle.waiting}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          variant="primary"
          disabled={clearPending}
          onClick={onClear}
        >
          {clearPending
            ? ko.board.drawer.clear.working
            : ko.board.drawer.bossBattle.clear}
        </Button>
        <Button
          variant="secondary"
          disabled={clearPending}
          onClick={() => setRetryOpen(true)}
        >
          {ko.board.drawer.bossBattle.retry}
        </Button>
      </div>

      {clearError ? (
        <p role="alert" className="mt-2 text-xs text-brick">
          {ko.board.drawer.clear.failed}
        </p>
      ) : null}

      {retryOpen ? (
        <RetryDialog
          questId={quest.id}
          projectId={projectId}
          onClose={() => setRetryOpen(false)}
        />
      ) : null}
    </section>
  );
}

export default BossBanner;
