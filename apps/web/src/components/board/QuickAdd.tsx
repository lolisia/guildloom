/**
 * Quick add for the board column.
 *
 * - `Enter` posts a single quest title and clears the input. An Enter that
 *   confirms an IME composition (Korean, Japanese, Chinese, …) is ignored so
 *   the candidate is committed without posting the quest.
 * - Pasting two or more non-empty lines opens a confirmation dialog and posts
 *   the lines to the bulk endpoint instead of pasting them into the input.
 *
 * The input is a dashed paper request slip; the bulk confirmation is a paper
 * dialog with the design system's single hard shadow.
 *
 * The board's `N` shortcut focuses the input through the forwarded ref.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type {
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  RefObject,
} from "react";

import { bulkCreateQuests, createQuest } from "../../api/quests";
import { ko } from "../../i18n/ko";
import { parsePastedTitles } from "../../lib/format";
import { isImeComposing } from "../../lib/ime";
import { Button, TextInput } from "../ui";

/** Props for {@link QuickAdd}. */
export interface QuickAddProps {
  projectId: number;
  /** Ref used by the board's `N` keyboard shortcut. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

/** Quick-add form shown at the top of the board column. */
export function QuickAdd({ projectId, inputRef }: QuickAddProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [bulkTitles, setBulkTitles] = useState<string[] | null>(null);

  const invalidateQuests = () =>
    queryClient.invalidateQueries({ queryKey: ["quests", projectId] });

  const createMutation = useMutation({
    mutationFn: (nextTitle: string) =>
      createQuest(projectId, { title: nextTitle }),
    onSuccess: async () => {
      setTitle("");
      await invalidateQuests();
      inputRef?.current?.focus();
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (titles: string[]) =>
      bulkCreateQuests(projectId, { titles }),
    onSuccess: async () => {
      setBulkTitles(null);
      setTitle("");
      await invalidateQuests();
      inputRef?.current?.focus();
    },
  });

  const submitTitle = () => {
    const trimmed = title.trim();
    if (trimmed.length === 0 || createMutation.isPending) {
      return;
    }
    createMutation.mutate(trimmed);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitTitle();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    // Always stop the implicit form submit; an Enter that confirms an IME
    // composition only commits the candidate and must not post the quest.
    event.preventDefault();
    if (isImeComposing(event)) {
      return;
    }

    submitTitle();
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData?.getData("text") ?? "";
    const titles = parsePastedTitles(pasted);
    if (titles.length < 2) {
      // A single line is a normal paste into the input.
      return;
    }

    // Keep the input unchanged: the titles are registered only after the
    // adventurer confirms the bulk dialog.
    event.preventDefault();
    bulkMutation.reset();
    setBulkTitles(titles);
  };

  const cancelBulk = () => {
    if (bulkMutation.isPending) {
      return;
    }
    setBulkTitles(null);
  };

  const confirmBulk = () => {
    if (!bulkTitles || bulkMutation.isPending) {
      return;
    }
    bulkMutation.mutate(bulkTitles);
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <TextInput
          ref={inputRef}
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          maxLength={200}
          aria-label={ko.board.newQuest}
          placeholder={ko.board.quickAddPlaceholder}
          className="border-dashed"
        />
        {createMutation.isError ? (
          <p role="alert" className="mt-1 text-[12px] text-brick">
            {ko.quest.createFailed}
          </p>
        ) : null}
      </form>

      {bulkTitles ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              cancelBulk();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={ko.board.bulk.title}
            className="w-full max-w-sm rounded-sm border-[1.5px] border-line-strong bg-paper p-5 shadow-hard"
          >
            <h2 className="text-base font-semibold text-ink">
              {ko.board.bulk.title}
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              {ko.board.bulk.description}
            </p>
            <p className="mt-3 text-sm font-medium text-ink">
              {ko.board.bulk.confirm(bulkTitles.length)}
            </p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-sm border border-line bg-sunken p-2 text-xs text-ink">
              {bulkTitles.map((bulkTitle, index) => (
                <li key={`${index}-${bulkTitle}`} className="truncate">
                  {bulkTitle}
                </li>
              ))}
            </ul>

            {bulkMutation.isError ? (
              <p role="alert" className="mt-2 text-xs text-brick">
                {ko.board.bulk.failed}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={cancelBulk}
                disabled={bulkMutation.isPending}
              >
                {ko.common.cancel}
              </Button>
              <Button
                variant="primary"
                onClick={confirmBulk}
                disabled={bulkMutation.isPending}
              >
                {bulkMutation.isPending
                  ? ko.board.bulk.submitting
                  : ko.board.bulk.submit}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default QuickAdd;
