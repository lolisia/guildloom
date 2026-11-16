/**
 * Confirmation dialog for declaring a dungeon clear.
 *
 * Opening the dialog fetches `GET /api/quests/:id/clear-preview` so the caller
 * sees the real settlement before committing: the total XP, each recipient's
 * share and the requester bonus (when the creator is not in the party). The
 * confirm button stays disabled while the preview loads or fails, and a
 * bystander sees a brick warning that they are neither the requester nor a
 * party member.
 *
 * The dialog is paper + 1.5px line-strong + hard shadow like the other modal
 * surfaces. Esc and a scrim click cancel; focus starts on 취소 and returns to
 * the opener when the dialog closes. Its Esc listener runs in the capture phase
 * and stops propagation so cancelling the clear does not also close the quest
 * drawer behind it.
 */
import type { ClearPreviewResponse } from "@guildloom/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";

import { fetchClearPreview } from "../../api/quests";
import { ko } from "../../i18n/ko";
import { queryKeys } from "../../lib/queryKeys";
import { Button } from "../ui";

/** Props for {@link ClearConfirmDialog}. */
export interface ClearConfirmDialogProps {
  questId: number;
  /** Called with the loaded preview when the caller confirms the clear. */
  onConfirm: (preview: ClearPreviewResponse) => void;
  /** Closes the dialog without sending any request. */
  onClose: () => void;
  /** Whether the confirmed clear request is in flight. */
  pending?: boolean;
  /** Failure copy shown after the confirmed clear request failed. */
  failureMessage?: string | null;
}

/** Paper confirmation dialog with the planned clear payout. */
export function ClearConfirmDialog({
  questId,
  onConfirm,
  onClose,
  pending = false,
  failureMessage = null,
}: ClearConfirmDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const capturedRef = useRef(false);

  const previewQuery = useQuery({
    queryKey: queryKeys.clearPreview(questId),
    queryFn: ({ signal }) => fetchClearPreview(questId, signal),
    retry: false,
  });

  useLayoutEffect(() => {
    // Capture the opener before moving focus; StrictMode's development double
    // mount runs the cleanup between the two effects, so a second capture
    // would read the dialog's own cancel button.
    if (!capturedRef.current) {
      capturedRef.current = true;
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    dialogRef.current
      ?.querySelector<HTMLButtonElement>("[data-clear-cancel]")
      ?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

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
    return () => document.removeEventListener("keydown", handleKeyDown, true);  }, [onClose]);

  const preview = previewQuery.data;
  const canConfirm =
    preview !== undefined && !previewQuery.isError && !pending;

  const overlayMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      data-clear-confirm="true"
      onMouseDown={overlayMouseDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-sm border-[1.5px] border-line-strong bg-paper p-5 shadow-hard"
      >
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {ko.board.drawer.clear.confirmTitle}
        </h2>

        {previewQuery.isPending ? (
          <p role="status" className="mt-3 text-xs text-muted">
            {ko.board.drawer.clear.previewLoading}
          </p>
        ) : null}

        {previewQuery.isError ? (
          <p role="alert" className="mt-3 text-xs text-brick">
            {ko.board.drawer.clear.previewFailed}
          </p>
        ) : null}

        {preview ? (
          <div className="mt-3 space-y-2">
            <p
              data-clear-preview-total="true"
              className="font-pixel text-[12px] text-ink"
            >
              {ko.board.drawer.clear.totalXp(preview.total)}
            </p>

            <ul
              aria-label={ko.board.drawer.clear.rewardsLabel}
              className="space-y-1"
            >
              {preview.rewards.map((reward) => (
                <li
                  key={reward.user.id}
                  data-reward-user-id={reward.user.id}
                  className="flex items-center justify-between gap-2 text-xs text-ink"
                >
                  <span className="min-w-0 truncate">
                    {reward.user.displayName}
                  </span>
                  <span className="font-pixel text-[12px] text-gold">
                    {ko.board.drawer.clear.reward(reward.amount)}
                  </span>
                </li>
              ))}
            </ul>

            {preview.requesterBonus ? (
              <p data-requester-bonus="true" className="text-xs text-ink">
                {ko.board.drawer.clear.requesterBonus(
                  preview.requesterBonus.user.displayName,
                  preview.requesterBonus.amount,
                )}
              </p>
            ) : null}

            {preview.actorIsInvolved ? null : (
              <p role="alert" className="text-xs text-brick">
                {ko.board.drawer.clear.notInvolved}
              </p>
            )}
          </div>
        ) : null}

        {failureMessage ? (
          <p role="alert" className="mt-3 text-xs text-brick">
            {failureMessage}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            data-clear-cancel="true"
            onClick={onClose}
          >
            {ko.common.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!canConfirm}
            onClick={() => {
              if (preview) {
                onConfirm(preview);
              }
            }}
          >
            {pending
              ? ko.board.drawer.clear.working
              : ko.board.drawer.clear.action}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ClearConfirmDialog;
