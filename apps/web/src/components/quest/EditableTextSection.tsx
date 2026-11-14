/**
 * Long-text section used by the quest drawer for "현재 상황" and "수정 방향".
 *
 * Stored text is shown read-only on a sunken surface with `whitespace-pre-wrap`
 * and clickable `http(s)` URLs. The ghost edit button swaps in the shared
 * `TextArea`, which saves on blur (`Escape` cancels the edit).
 */
import { useRef, useState } from "react";

import { ko } from "../../i18n/ko";
import { tokenizeLinks } from "../../lib/format";
import { Button, TextArea } from "../ui";

/** Props for {@link EditableTextSection}. */
export interface EditableTextSectionProps {
  /** Field name used for labels and test hooks (`situation`, `direction`). */
  field: "situation" | "direction";
  label: string;
  value: string;
  placeholder: string;
  emptyText: string;
  onSave: (next: string) => void;
  disabled?: boolean;
}

/** Render stored text with newlines preserved and URLs linkified. */
function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {tokenizeLinks(text).map((token, index) =>
        token.type === "url" ? (
          <a
            key={`${index}-${token.value}`}
            href={token.value}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all text-teal underline underline-offset-2 hover:text-ink"
          >
            {token.value}
          </a>
        ) : (
          <span key={`${index}-text`}>{token.value}</span>
        ),
      )}
    </>
  );
}

/** Read/edit section for a free-form quest field. */
export function EditableTextSection({
  field,
  label,
  value,
  placeholder,
  emptyText,
  onSave,
  disabled = false,
}: EditableTextSectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelledRef = useRef(false);

  const startEditing = () => {
    cancelledRef.current = false;
    setDraft(value);
    setEditing(true);
  };

  const cancelEditing = () => {
    cancelledRef.current = true;
    setDraft(value);
    setEditing(false);
  };

  const commit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const next = draft;
    setEditing(false);
    if (next !== value) {
      onSave(next);
    }
  };

  return (
    <section
      data-field={field}
      data-testid={`quest-${field}`}
      className="space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted">{label}</h3>
        {!editing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={startEditing}
            disabled={disabled}
            aria-label={`${label} ${ko.common.edit}`}
          >
            {ko.common.edit}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <TextArea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              // Keep the drawer's own Escape handler from closing the panel.
              event.stopPropagation();
              cancelEditing();
            }
          }}
          placeholder={placeholder}
          aria-label={label}
          rows={4}
          autoFocus
        />
      ) : value.trim().length > 0 ? (
        <div className="whitespace-pre-wrap break-words rounded-sm border border-line bg-sunken px-2.5 py-2 text-sm leading-relaxed text-ink">
          <LinkifiedText text={value} />
        </div>
      ) : (
        <p className="rounded-sm border border-line bg-sunken px-2.5 py-2 text-xs text-muted">
          {emptyText}
        </p>
      )}
    </section>
  );
}

export default EditableTextSection;
