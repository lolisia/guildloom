/**
 * Tag chips with project-wide autocomplete for the quest drawer.
 *
 * Typing queries `GET /api/projects/:pid/tags?q=`, clicking a suggestion or
 * pressing `Enter` adds the typed tag, and each chip can be removed. The parent
 * receives the full replacement tag list for a single `PATCH tags` call.
 *
 * Chips are the shared `Chip` atom: hairline outline, muted 12px text and a
 * "×" remove button whose accessible name stays `ko.quest.tagRemove(tag)`.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchTags } from "../../api/quests";
import { ko } from "../../i18n/ko";
import { isImeComposing } from "../../lib/ime";
import { queryKeys } from "../../lib/queryKeys";
import { Chip, TextInput } from "../ui";

/** Props for {@link TagEditor}. */
export interface TagEditorProps {
  projectId: number;
  tags: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/** Editable tag chip list with autocomplete. */
export function TagEditor({
  projectId,
  tags,
  onChange,
  disabled = false,
}: TagEditorProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const tagsQuery = useQuery({
    queryKey: queryKeys.tags(projectId, query.trim()),
    queryFn: ({ signal }) => fetchTags(projectId, query.trim(), signal),
    staleTime: 30_000,
  });

  const suggestions = (tagsQuery.data ?? []).filter(
    (tag) => !tags.includes(tag.name),
  );

  const addTag = (raw: string) => {
    const name = raw.trim();
    if (name.length === 0 || tags.includes(name) || disabled) {
      return;
    }
    onChange([...tags, name]);
    setQuery("");
  };

  const removeTag = (tag: string) => {
    if (disabled) {
      return;
    }
    onChange(tags.filter((existing) => existing !== tag));
  };

  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-medium text-muted">{ko.quest.tags}</h3>

      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={ko.quest.tags}>
          {tags.map((tag) => (
            <li key={tag}>
              <Chip
                removeLabel={ko.quest.tagRemove(tag)}
                onRemove={disabled ? undefined : () => removeTag(tag)}
              >
                {tag}
              </Chip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">{ko.quest.noTags}</p>
      )}

      <div className="relative">
        <TextInput
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              // Confirming an IME candidate also fires Enter; adding the tag
              // then would submit a half-composed word.
              if (isImeComposing(event)) {
                return;
              }
              addTag(query);
            }
          }}
          maxLength={50}
          disabled={disabled}
          aria-label={ko.quest.tagAdd}
          placeholder={ko.quest.tagsPlaceholder}
          autoComplete="off"
        />

        {focused && suggestions.length > 0 ? (
          <ul
            aria-label={ko.quest.tags}
            className="absolute left-0 right-0 z-10 mt-1 max-h-40 overflow-y-auto rounded-sm border-[1.5px] border-line-strong bg-paper py-1 shadow-hard"
          >
            {suggestions.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  // Keep focus on the input so the click lands before the
                  // suggestion list unmounts.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addTag(tag.name)}
                  aria-label={tag.name}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left text-xs text-ink transition-colors hover:bg-sunken"
                >
                  <span>{tag.name}</span>
                  <span className="text-xs text-muted">
                    {ko.board.questCount(tag.count)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {tagsQuery.isError ? (
        <p role="alert" className="text-xs text-brick">
          {ko.quest.tagsFailed}
        </p>
      ) : null}
    </section>
  );
}

export default TagEditor;
