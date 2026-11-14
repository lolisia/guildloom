/**
 * Quick add for the board column.
 *
 * - `Enter` posts a single quest title and clears the input.
 * - Pasting two or more non-empty lines opens a confirmation dialog and posts
 *   the lines to the bulk endpoint instead of pasting them into the input.
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
    if (event.key === "Enter") {
      event.preventDefault();
      submitTitle();
    }
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
      <form onSubmit={handleSubmit} className="mb-2">
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          maxLength={200}
          aria-label={ko.board.newQuest}
          placeholder={ko.board.quickAddPlaceholder}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/70"
        />
        {createMutation.isError ? (
          <p role="alert" className="mt-1 text-[11px] text-rose-300">
            {ko.quest.createFailed}
          </p>
        ) : null}
      </form>

      {bulkTitles ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
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
            className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
          >
            <h2 className="text-base font-bold">{ko.board.bulk.title}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {ko.board.bulk.description}
            </p>
            <p className="mt-3 text-sm font-semibold text-emerald-300">
              {ko.board.bulk.confirm(bulkTitles.length)}
            </p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-slate-950 p-2 text-xs text-slate-300">
              {bulkTitles.map((bulkTitle, index) => (
                <li key={`${index}-${bulkTitle}`} className="truncate">
                  {bulkTitle}
                </li>
              ))}
            </ul>

            {bulkMutation.isError ? (
              <p role="alert" className="mt-2 text-xs text-rose-300">
                {ko.board.bulk.failed}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelBulk}
                disabled={bulkMutation.isPending}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
              >
                {ko.common.cancel}
              </button>
              <button
                type="button"
                onClick={confirmBulk}
                disabled={bulkMutation.isPending}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bulkMutation.isPending
                  ? ko.board.bulk.submitting
                  : ko.board.bulk.submit}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default QuickAdd;
