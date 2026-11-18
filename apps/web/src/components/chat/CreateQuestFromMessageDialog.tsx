/**
 * Dialog that turns a chat message into a board quest (의뢰로 만들기).
 *
 * The title defaults to the first line of the message as plain text (mentions
 * expanded, capped at 200 characters) and the situation to the whole message.
 * Submitting posts `sourceMessageId` to the tavern quest endpoint, refreshes
 * the quest board, the room and the unread badges, toasts the new quest number
 * and closes. A 409 means the message was already promoted and shows the
 * dedicated Korean copy instead of a generic failure.
 */
import { messagePlainText } from "@guildloom/shared";
import type { ChatMessage, CreateQuestFromChatResponse } from "@guildloom/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { createQuestFromTavernMessage } from "../../api/chat";
import { ApiClientError } from "../../api/client";
import { ko } from "../../i18n/ko";
import { isImeComposing } from "../../lib/ime";
import { queryKeys } from "../../lib/queryKeys";
import { pushToast } from "../../lib/toast";
import { Button, TextArea, TextInput } from "../ui";

/** Longest quest title accepted by `POST …/tavern/quests`. */
const TITLE_MAX_LENGTH = 200;

/** Props for {@link CreateQuestFromMessageDialog}. */
export interface CreateQuestFromMessageDialogProps {
  message: ChatMessage;
  projectId: number;
  resolveName: (userId: number) => string | null;
  onClose: () => void;
}

/** Prefilled 의뢰 form for a tavern message. */
export function CreateQuestFromMessageDialog({
  message,
  projectId,
  resolveName,
  onClose,
}: CreateQuestFromMessageDialogProps) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const titleFieldId = useId();
  const situationFieldId = useId();

  const plainText = messagePlainText(message.body, resolveName);
  const [title, setTitle] = useState(() => {
    const firstLine = plainText.split(/\r?\n/, 1)[0] ?? "";
    return firstLine.trim().slice(0, TITLE_MAX_LENGTH);
  });
  const [situation, setSituation] = useState(plainText);
  const [conflict, setConflict] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: { title: string; situation: string }) =>
      createQuestFromTavernMessage(projectId, {
        ...body,
        sourceMessageId: message.id,
      }),
    onSuccess: async (created: CreateQuestFromChatResponse) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.quests(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["quests", projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.tavernMessages(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.chatUnread(projectId),
        }),
      ]);
      pushToast(
        ko.chat.questCreated(created.quest.number, created.quest.title),
      );
      onClose();
    },
    onError: (error: unknown) => {
      setConflict(
        error instanceof ApiClientError &&
          (error.status === 409 || error.code === "conflict"),
      );
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || mutation.isPending) {
      return;
    }
    setConflict(false);
    mutation.mutate({
      title: trimmedTitle,
      situation: situation.trim(),
    });
  };

  const guardImeEnter = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && isImeComposing(event)) {
      event.preventDefault();
    }
  };

  const close = () => {
    if (mutation.isPending) {
      return;
    }
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !mutation.isPending) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-sm border-[1.5px] border-line-strong bg-paper p-5 shadow-hard"
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {ko.chat.questDialogTitle}
          </h2>

          <div className="space-y-1.5">
            <label
              htmlFor={titleFieldId}
              className="block text-xs font-medium text-ink"
            >
              {ko.chat.questTitle}
            </label>
            <TextInput
              id={titleFieldId}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={guardImeEnter}
              maxLength={TITLE_MAX_LENGTH}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={situationFieldId}
              className="block text-xs font-medium text-ink"
            >
              {ko.chat.questSituation}
            </label>
            <TextArea
              id={situationFieldId}
              value={situation}
              onChange={(event) => setSituation(event.target.value)}
              onKeyDown={guardImeEnter}
              rows={5}
            />
          </div>

          {conflict ? (
            <p role="alert" className="text-xs text-brick">
              {ko.chat.alreadyPromoted}
            </p>
          ) : null}

          {mutation.isError && !conflict ? (
            <p role="alert" className="text-xs text-brick">
              {ko.chat.questCreateFailed}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close} disabled={mutation.isPending}>
              {ko.common.cancel}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={title.trim().length === 0 || mutation.isPending}
            >
              {mutation.isPending
                ? ko.chat.questSubmitting
                : ko.chat.questSubmit}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export default CreateQuestFromMessageDialog;
