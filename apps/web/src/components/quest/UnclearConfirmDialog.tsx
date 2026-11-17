/**
 * Confirmation dialog for revoking a completed clear.
 *
 * `POST /api/quests/:id/unclear` takes the whole round's XP back and returns
 * the card to the boss column, so the dialog spells out the exact amount:
 * the sum of the latest `quest_cleared` event's rewards. Focus starts on 취소
 * and returns to the opener when the dialog closes; Esc runs in the capture
 * phase so it does not also close the drawer behind it.
 */
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";

import { ko } from "../../i18n/ko";
import { Button } from "../ui";

/** Props for {@link UnclearConfirmDialog}. */
export interface UnclearConfirmDialogProps {
  /** XP paid by the clear being revoked. */
  xp: number;
  onConfirm: () => void;
  onClose: () => void;
  /** Whether `POST /unclear` is in flight. */
  pending?: boolean;
  /** Failure copy shown after the revoke request failed. */
  failureMessage?: string | null;
}

/** Paper confirmation dialog for 클리어 취소. */
export function UnclearConfirmDialog({
  xp,
  onConfirm,
  onClose,
  pending = false,
  failureMessage = null,
}: UnclearConfirmDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const capturedRef = useRef(false);

  useLayoutEffect(() => {
    if (!capturedRef.current) {
      capturedRef.current = true;
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    dialogRef.current
      ?.querySelector<HTMLButtonElement>("[data-unclear-cancel]")
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
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const overlayMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      data-unclear-confirm="true"
      onMouseDown={overlayMouseDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-sm border-[1.5px] border-line-strong bg-paper p-5 shadow-hard"
      >
        <h2 id={titleId} className="text-[18px] font-semibold text-ink">
          {ko.board.drawer.unclear.confirmTitle}
        </h2>
        <p className="mt-2 text-sm text-ink">
          {ko.board.drawer.unclear.confirm(xp)}
        </p>

        {failureMessage ? (
          <p role="alert" className="mt-3 text-xs text-brick">
            {failureMessage}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            data-unclear-cancel="true"
            onClick={onClose}
          >
            {ko.common.cancel}
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {pending
              ? ko.board.drawer.unclear.working
              : ko.board.drawer.unclear.action}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default UnclearConfirmDialog;
