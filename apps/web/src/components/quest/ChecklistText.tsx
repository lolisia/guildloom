/**
 * Read-only checklist rendering and the "층 추가" field for the direction
 * section.
 *
 * `direction` is free-form Markdown: checklist lines (`- [ ] title`) become
 * real checkboxes, everything else stays linkified text. Adding new floors is a
 * single-line input that splits multi-line pastes into one title per line, and
 * submits through `POST /api/quests/:id/checklist`.
 */
import { parseChecklist, type ChecklistItem } from "@guildloom/shared";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { Fragment, useState } from "react";

import { ko } from "../../i18n/ko";
import { isImeComposing } from "../../lib/ime";
import { TextInput } from "../ui";
import { LinkifiedText } from "./EditableTextSection";

/** Maximum number of checklist titles the append endpoint accepts. */
export const MAX_ADD_CHECKLIST_ITEMS = 50;

/** Maximum length of one checklist title enforced by the shared contract. */
export const MAX_CHECKLIST_TITLE_LENGTH = 200;

/** Split typed or pasted text into one trimmed title per line. */
export function splitChecklistTitles(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((title) => title.trim().slice(0, MAX_CHECKLIST_TITLE_LENGTH))
    .filter((title) => title.length > 0)
    .slice(0, MAX_ADD_CHECKLIST_ITEMS);
}

/** Props for {@link ChecklistText}. */
export interface ChecklistTextProps {
  /** Raw `direction` value. */
  value: string;
  /** Called with the parsed item and its next checked state. */
  onToggle: (item: ChecklistItem, done: boolean) => void;
}

/**
 * Render `value` one source line at a time: checklist lines become checkbox
 * rows, every other line keeps the URL linkification of the read state.
 */
export function ChecklistText({ value, onToggle }: ChecklistTextProps) {
  const checklist = parseChecklist(value);
  const byLine = new Map(
    checklist.items.map((item) => [item.line, item] as const),
  );
  const lines = value.split(/\r\n|\n|\r/);

  return (
    <>
      {lines.map((line, lineIndex) => {
        const item = byLine.get(lineIndex);
        return (
          <Fragment key={lineIndex}>
            {lineIndex > 0 ? <br /> : null}
            {item ? (
              <label
                data-checklist-index={item.index}
                data-checklist-done={item.done ? "true" : "false"}
                className="inline-flex items-start gap-2 align-top"
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(event) => onToggle(item, event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-teal"
                />
                <span
                  className={
                    item.done ? "text-muted line-through" : "text-ink"
                  }
                >
                  {item.text}
                </span>
              </label>
            ) : (
              <LinkifiedText text={line} />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/** Props for {@link ChecklistAddField}. */
export interface ChecklistAddFieldProps {
  /** Whether an append request is in flight. */
  pending: boolean;
  /** Called with one or more titles from Enter or a multi-line paste. */
  onSubmit: (titles: string[]) => void;
}

/** One-line "층 추가" field below the direction section. */
export function ChecklistAddField({
  pending,
  onSubmit,
}: ChecklistAddFieldProps) {
  const [draft, setDraft] = useState("");

  const submitDraft = (): void => {
    const titles = splitChecklistTitles(draft);
    if (titles.length === 0) {
      return;
    }
    setDraft("");
    onSubmit(titles);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const text = event.clipboardData?.getData("text") ?? "";
    if (!/[\r\n]/.test(text)) {
      return;
    }
    event.preventDefault();
    const titles = splitChecklistTitles(text);
    if (titles.length === 0) {
      return;
    }
    setDraft("");
    onSubmit(titles);
  };

  return (
    <TextInput
      value={draft}
      aria-label={ko.board.drawer.checklist.addLabel}
      placeholder={ko.board.drawer.checklist.addPlaceholder}
      disabled={pending}
      maxLength={MAX_CHECKLIST_TITLE_LENGTH * MAX_ADD_CHECKLIST_ITEMS}
      onChange={(event) => setDraft(event.target.value)}
      onPaste={handlePaste}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        if (isImeComposing(event)) {
          return;
        }
        submitDraft();
      }}
    />
  );
}

export default ChecklistText;
