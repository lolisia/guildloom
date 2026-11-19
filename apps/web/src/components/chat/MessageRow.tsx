/**
 * One chat row in the 주점 or a quest party room.
 *
 * User messages show a 24px avatar, the author name and the clock time; a run
 * of messages from the same author within five minutes is rendered compactly
 * (`grouped`) without repeating the header. System messages are a single muted
 * line rendered from their payload and link to the promoted quest. Hover (or
 * keyboard focus within) reveals the text-only row actions: 의뢰로 만들기 for
 * tavern messages and 삭제 for the author's own messages.
 */
import { renderSystemMessage } from "@guildloom/shared";
import type { ChatMessage, MessageSegment } from "@guildloom/shared";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { ko } from "../../i18n/ko";
import AdventurerSprite from "../AdventurerSprite";
import { Button } from "../ui";
import MessageBody from "./MessageBody";

/** Props for {@link MessageRow}. */
export interface MessageRowProps {
  message: ChatMessage;
  projectId: number;
  meId: number | null;
  resolveName: (userId: number) => string | null;
  /** Same author as the previous row and within five minutes. */
  grouped?: boolean;
  onDelete?: (message: ChatMessage) => Promise<void> | void;
  onPromote?: (message: ChatMessage) => void;
}

/** Quest facts a `quest_created` system payload carries. */
interface QuestCreatedInfo {
  questId: number | null;
  questNumber: number;
}

/** Read the quest id/number out of a `quest_created` system payload. */
function readQuestCreated(payload: unknown): QuestCreatedInfo | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== "quest_created") {
    return null;
  }
  const questNumber = record.questNumber;
  if (typeof questNumber !== "number") {
    return null;
  }
  const questId =
    typeof record.questId === "number" ? record.questId : null;
  return { questId, questNumber };
}

/** Flatten renderSystemMessage segments into one plain line. */
function systemLine(segments: MessageSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.kind === "mention") {
        return `@${segment.name ?? ko.common.unknown}`;
      }
      return segment.kind === "text" ? segment.text : segment.url;
    })
    .join("");
}

/** `HH:MM` in the viewer's local time. */
function clockTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Internal link to the quest drawer on the board. */
function questLink(projectId: number, questId: number): string {
  return `/g/${projectId}?quest=${questId}`;
}

/**
 * One message row, including its author-only delete confirmation dialog.
 *
 * The dialog is portalled to `document.body` so the row's scroll container
 * never clips it.
 */
export function MessageRow({
  message,
  projectId,
  meId,
  resolveName,
  grouped = false,
  onDelete,
  onPromote,
}: MessageRowProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const dialogTitleId = useId();

  const rowData = {
    "data-message-id": message.id,
    "data-message-kind": message.kind,
  };

  if (message.kind === "system") {
    const rendered = renderSystemMessage(
      message.payload,
      message.author?.displayName ?? null,
    );
    const line = rendered.length > 0 ? systemLine(rendered) : message.body;
    const created = readQuestCreated(message.payload);
    const questId = created?.questId ?? message.promotedQuest?.id ?? null;

    return (
      <div
        {...rowData}
        className="group flex flex-col gap-0.5 py-1"
      >
        <p className="text-xs leading-relaxed text-muted">
          {line}
          {created !== null && questId !== null ? (
            <>
              {" "}
              <Link
                to={questLink(projectId, questId)}
                className="text-teal hover:underline"
              >
                {ko.chat.viewQuest(created.questNumber)}
              </Link>
            </>
          ) : null}
        </p>
      </div>
    );
  }

  const author = message.author;
  const authorName = author?.displayName ?? ko.common.unknown;
  const deleted = message.deletedAt !== null;
  const promoted = message.promotedQuest;
  const canPromote =
    !deleted &&
    promoted === null &&
    message.questId === null &&
    onPromote !== undefined;
  const canDelete =
    !deleted &&
    onDelete !== undefined &&
    meId !== null &&
    author !== null &&
    author.id === meId;
  const hasActions = canPromote || canDelete;

  const closeDelete = () => {
    if (deleting) {
      return;
    }
    setDeleteOpen(false);
    setDeleteFailed(false);
  };

  const confirmDelete = async () => {
    if (onDelete === undefined) {
      return;
    }
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await onDelete(message);
      setDeleteOpen(false);
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      {...rowData}
      {...(grouped ? { "data-grouped": "true" } : {})}
      className="group relative flex gap-2 px-1 pt-1.5"
    >
      <div className="w-6 shrink-0">
        {!grouped && author !== null ? (
          <AdventurerSprite
            userId={author.id}
            displayName={author.displayName}
            size="sm"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped ? (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[14px] font-semibold text-ink">
              {authorName}
            </span>
            <time
              dateTime={new Date(message.createdAt).toISOString()}
              className="text-xs text-muted"
            >
              {clockTime(message.createdAt)}
            </time>
          </div>
        ) : null}

        {deleted ? (
          <p className="text-[14px] text-muted">{ko.chat.deleted}</p>
        ) : (
          <MessageBody
            body={message.body}
            resolveName={resolveName}
            currentUserId={meId}
          />
        )}

        {promoted !== null ? (
          <Link
            to={questLink(projectId, promoted.id)}
            className="mt-1 inline-flex items-center rounded-sm border border-line bg-sunken px-1.5 py-0.5 text-xs text-muted hover:text-ink"
          >
            {ko.chat.promoted(promoted.number)}
          </Link>
        ) : null}

        {hasActions ? (
          <div className="mt-1 flex items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {canPromote ? (
              <button
                type="button"
                onClick={() => onPromote?.(message)}
                className="rounded-sm text-xs text-muted transition-colors hover:text-ink"
              >
                {ko.chat.promote}
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                onClick={() => {
                  setDeleteFailed(false);
                  setDeleteOpen(true);
                }}
                className="rounded-sm text-xs text-muted transition-colors hover:text-brick"
              >
                {ko.common.delete}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {deleteOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closeDelete();
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !deleting) {
                  closeDelete();
                }
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                className="w-full max-w-sm rounded-sm border-[1.5px] border-line-strong bg-paper p-5 shadow-hard"
              >
                <h2
                  id={dialogTitleId}
                  className="text-base font-semibold text-ink"
                >
                  {ko.chat.deleteConfirm}
                </h2>

                {deleteFailed ? (
                  <p role="alert" className="mt-2 text-xs text-brick">
                    {ko.chat.deleteFailed}
                  </p>
                ) : null}

                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={closeDelete}
                    disabled={deleting}
                    autoFocus
                  >
                    {ko.common.cancel}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => void confirmDelete()}
                    disabled={deleting}
                  >
                    {ko.common.delete}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default MessageRow;
