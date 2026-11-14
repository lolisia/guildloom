/**
 * Tag chips with project-wide autocomplete for the quest drawer.
 *
 * Typing queries `GET /api/projects/:pid/tags?q=`, clicking a suggestion or
 * pressing `Enter` adds the typed tag, and each chip can be removed. The parent
 * receives the full replacement tag list for a single `PATCH tags` call.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchTags } from "../../api/quests";
import { ko } from "../../i18n/ko";
import { queryKeys } from "../../lib/queryKeys";

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
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {ko.quest.tags}
      </h3>

      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={ko.quest.tags}>
          {tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-slate-800 py-0.5 pl-2 pr-1 text-[11px] font-medium text-slate-200"
            >
              <span>{tag}</span>
              <button
                type="button"
                onClick={() => removeTag(tag)}
                disabled={disabled}
                aria-label={ko.quest.tagRemove(tag)}
                className="rounded-full px-1 text-slate-400 hover:bg-slate-700 hover:text-rose-300 disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">{ko.quest.noTags}</p>
      )}

      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTag(query);
            }
          }}
          maxLength={50}
          disabled={disabled}
          aria-label={ko.quest.tagAdd}
          placeholder={ko.quest.tagsPlaceholder}
          autoComplete="off"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/70 disabled:opacity-60"
        />

        {focused && suggestions.length > 0 ? (
          <ul
            aria-label={ko.quest.tags}
            className="absolute left-0 right-0 z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl"
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
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left text-xs text-slate-200 hover:bg-slate-800"
                >
                  <span>{tag.name}</span>
                  <span className="text-[10px] text-slate-500">
                    {ko.board.questCount(tag.count)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {tagsQuery.isError ? (
        <p role="alert" className="text-[11px] text-rose-300">
          {ko.quest.tagsFailed}
        </p>
      ) : null}
    </section>
  );
}

export default TagEditor;
