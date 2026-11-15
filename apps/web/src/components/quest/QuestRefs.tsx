/**
 * Reference documents (참고 문서) of the quest drawer.
 *
 * Sits below the situation/direction fields. Enter in the one-line input
 * attaches `{ target }` through `POST /api/quests/:id/refs`; URLs open in a new
 * tab, local paths copy to the clipboard and every row can be removed through
 * `DELETE /api/refs/:id`. Successful mutations seed the detail cache and
 * invalidate the quest lists and the adventure log.
 */
import { refKind, type Quest, type QuestRef } from "@guildloom/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { KeyboardEvent } from "react";
import { useState } from "react";

import { createQuestRef, deleteQuestRef } from "../../api/quests";
import { ko } from "../../i18n/ko";
import { isImeComposing } from "../../lib/ime";
import { queryKeys } from "../../lib/queryKeys";
import { pushToast } from "../../lib/toast";
import { TextInput } from "../ui";

/** Props for {@link QuestRefs}. */
export interface QuestRefsProps {
  projectId: number;
  quest: Quest;
}

/** One reference row; URLs link out, paths offer a copy action. */
function RefRow({
  questRef,
  disabled,
  onCopy,
  onDelete,
}: {
  questRef: QuestRef;
  disabled: boolean;
  onCopy: (target: string) => void;
  onDelete: (refId: number) => void;
}) {
  const label = questRef.label ?? questRef.target;
  const isUrl = refKind(questRef.target) === "url";

  return (
    <li
      data-ref-id={questRef.id}
      data-ref-kind={isUrl ? "url" : "path"}
      className="flex items-start justify-between gap-2 rounded-sm border border-line bg-paper px-2 py-1 text-xs"
    >
      <span className="min-w-0 flex-1 break-all text-ink">
        {isUrl ? (
          <a
            href={questRef.target}
            target="_blank"
            rel="noreferrer"
            className="text-teal underline underline-offset-2 hover:text-ink"
          >
            {label}
          </a>
        ) : (
          <span>{label}</span>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-1">
        {isUrl ? null : (
          <button
            type="button"
            onClick={() => onCopy(questRef.target)}
            className="rounded-sm px-1 text-xs text-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            {ko.board.drawer.refs.copyPath}
          </button>
        )}
        <button
          type="button"
          aria-label={ko.board.drawer.refs.remove(questRef.target)}
          disabled={disabled}
          onClick={() => onDelete(questRef.id)}
          className="rounded-sm px-1.5 text-sm text-muted transition-colors hover:bg-sunken hover:text-brick disabled:cursor-not-allowed disabled:opacity-50"
        >
          ×
        </button>
      </span>
    </li>
  );
}

/** Reference list plus the one-line add field. */
export function QuestRefs({ projectId, quest }: QuestRefsProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const invalidateLists = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["quests", projectId] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.events(quest.id) });
  };

  const setRefs = (next: QuestRef[]): void => {
    const key = queryKeys.quest(quest.id);
    const cached = queryClient.getQueryData<Quest>(key);
    if (cached) {
      queryClient.setQueryData<Quest>(key, { ...cached, refs: next });
    }
  };

  const addMutation = useMutation({
    mutationFn: (target: string) => createQuestRef(quest.id, { target }),
    onSuccess: (created, target) => {
      const cached = queryClient.getQueryData<Quest>(
        queryKeys.quest(quest.id),
      );
      const known = cached?.refs ?? [];
      setRefs([
        ...known.filter((entry) => entry.id !== created.id),
        created,
      ]);
      setDraft((current) => (current.trim() === target ? "" : current));
      invalidateLists();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (refId: number) => deleteQuestRef(refId),
    onSuccess: (_data, refId) => {
      const cached = queryClient.getQueryData<Quest>(
        queryKeys.quest(quest.id),
      );
      setRefs((cached?.refs ?? []).filter((entry) => entry.id !== refId));
      invalidateLists();
    },
  });

  const submit = (): void => {
    const target = draft.trim();
    if (target.length === 0 || addMutation.isPending) {
      return;
    }
    addMutation.mutate(target);
  };

  const copyPath = (target: string): void => {
    void (async () => {
      try {
        if (navigator.clipboard === undefined) {
          throw new Error("clipboard unavailable");
        }
        await navigator.clipboard.writeText(target);
        pushToast(ko.common.copied);
      } catch {
        pushToast(ko.common.copyFailed);
      }
    })();
  };

  const refs = quest.refs ?? [];

  return (
    <section
      aria-label={ko.board.drawer.refs.title}
      data-testid="quest-refs"
      className="space-y-1.5"
    >
      <h3 className="text-sm font-medium text-muted">
        {ko.board.drawer.refs.title}
      </h3>

      {refs.length === 0 ? (
        <p className="text-xs text-muted">{ko.board.drawer.refs.empty}</p>
      ) : (
        <ul aria-label={ko.board.drawer.refs.title} className="space-y-1">
          {refs.map((questRef) => (
            <RefRow
              key={questRef.id}
              questRef={questRef}
              disabled={deleteMutation.isPending}
              onCopy={copyPath}
              onDelete={(refId) => deleteMutation.mutate(refId)}
            />
          ))}
        </ul>
      )}

      <TextInput
        value={draft}
        aria-label={ko.board.drawer.refs.addLabel}
        placeholder={ko.board.drawer.refs.placeholder}
        maxLength={1000}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== "Enter") {
            return;
          }
          event.preventDefault();
          if (isImeComposing(event)) {
            return;
          }
          submit();
        }}
      />

      {addMutation.isError ? (
        <p role="alert" className="text-xs text-brick">
          {ko.board.drawer.refs.addFailed}
        </p>
      ) : null}

      {deleteMutation.isError ? (
        <p role="alert" className="text-xs text-brick">
          {ko.board.drawer.refs.removeFailed}
        </p>
      ) : null}
    </section>
  );
}

export default QuestRefs;
