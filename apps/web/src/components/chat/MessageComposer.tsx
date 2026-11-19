/**
 * Chat composer for the 주점 and quest party rooms.
 *
 * The textarea grows from one to six lines, Enter sends (Shift+Enter inserts a
 * newline) and every Enter/Tab path is IME guarded. Before a body is submitted
 * the typed `@표시이름` text is encoded into `<@id>` tokens with the shared
 * `encodeMentions`. Typing `@` opens a small member listbox: prefix matches
 * come first, the list never shows more than six members and ↑/↓/Enter/Tab/Esc
 * drive it without touching the draft. A failed send keeps the text and shows
 * an alert; a command handler (e.g. `/의뢰`) runs on the raw draft and can
 * consume it without posting a message.
 */
import { encodeMentions, MESSAGE_MAX_LENGTH } from "@guildloom/shared";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent } from "react";

import { ko } from "../../i18n/ko";
import { isImeComposing } from "../../lib/ime";
import { Button, TextArea } from "../ui";

/** Props for {@link MessageComposer}. */
export interface MessageComposerProps {
  onSubmit(body: string): Promise<void>;
  members: { id: number; displayName: string }[];
  placeholder: string;
  /**
   * Try to consume the raw draft (before mention encoding).
   *
   * Resolve `true` when the command handled the text (the composer clears the
   * draft and does not post); resolve `false` for an ordinary message.
   */
  commandHandler?: (text: string) => Promise<boolean>;
}

/** The `@query` token immediately before the cursor, if any. */
interface MentionMatch {
  /** Offset of the `@`. */
  start: number;
  /** Characters typed after `@` (may be empty). */
  query: string;
}

/** Longest member list the mention autocomplete shows. */
const MENTION_LIMIT = 6;

/** Find the mention token that ends exactly at `caret`. */
function findMention(draft: string, caret: number): MentionMatch | null {
  if (caret < 0 || caret > draft.length) {
    return null;
  }
  const before = draft.slice(0, caret);
  const match = /(?:^|\s)@([^\s]*)$/.exec(before);
  if (match === null) {
    return null;
  }
  const query = match[1] ?? "";
  return { start: before.length - query.length - 1, query };
}

/** Members matching the query, prefix matches first, capped at six. */
function mentionCandidates(
  members: { id: number; displayName: string }[],
  query: string,
): { id: number; displayName: string }[] {
  const normalized = query.toLocaleLowerCase();
  const matches = members.filter((member) =>
    member.displayName.toLocaleLowerCase().includes(normalized),
  );
  const prefix = matches.filter((member) =>
    member.displayName.toLocaleLowerCase().startsWith(normalized),
  );
  const rest = matches.filter((member) => !prefix.includes(member));
  return [...prefix, ...rest].slice(0, MENTION_LIMIT);
}

/** Multi-line composer with mention autocomplete. */
export function MessageComposer({
  onSubmit,
  members,
  placeholder,
  commandHandler,
}: MessageComposerProps) {
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const listboxId = useId();

  const mention = findMention(draft, caret);
  const mentionKey = mention === null ? null : `${mention.start}:${mention.query}`;
  const candidates = useMemo(
    () => (mention === null ? [] : mentionCandidates(members, mention.query)),
    [members, mention],
  );
  const listOpen =
    mention !== null &&
    candidates.length > 0 &&
    dismissedKey !== mentionKey;
  const highlightedIndex =
    candidates.length === 0
      ? 0
      : Math.min(activeIndex, candidates.length - 1);
  const activeCandidate = candidates[highlightedIndex];

  useEffect(() => {
    setActiveIndex(0);
  }, [mentionKey]);

  // Grow with the wrapped text up to six lines, then scroll inside the box.
  // jsdom reports a zero scrollHeight; keep the `rows` height there.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    const maxHeight = 128;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    if (nextHeight === 0) {
      textarea.style.height = "";
      return;
    }
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  // Place the caret after the inserted mention once React has painted it.
  useEffect(() => {
    const target = pendingCaretRef.current;
    if (target === null) {
      return;
    }
    pendingCaretRef.current = null;
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(target, target);
    setCaret(target);
  }, [draft]);

  const syncCaret = (): void => {
    const textarea = textareaRef.current;
    if (textarea !== null) {
      setCaret(textarea.selectionStart ?? textarea.value.length);
    }
  };

  const resetAfterSend = (): void => {
    setDraft("");
    setCaret(0);
    setActiveIndex(0);
    setDismissedKey(null);
    setError(null);
  };

  const submit = async (): Promise<void> => {
    if (busy || draft.trim().length === 0) {
      return;
    }
    if (draft.length > MESSAGE_MAX_LENGTH) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (commandHandler !== undefined) {
        try {
          const handled = await commandHandler(draft);
          if (handled) {
            resetAfterSend();
            return;
          }
        } catch (commandError) {
          // A command may reject with its own Korean explanation (for example
          // `/의뢰` without a title); keep the draft so it can be fixed.
          setError(
            commandError instanceof Error &&
              commandError.message.length > 0
              ? commandError.message
              : ko.chat.sendFailed,
          );
          return;
        }
      }

      const body = encodeMentions(draft, members).trim();
      if (body.length === 0) {
        return;
      }
      await onSubmit(body);
      resetAfterSend();
    } catch {
      // Keep the draft so the adventurer can retry without retyping.
      setError(ko.chat.sendFailed);
    } finally {
      setBusy(false);
    }
  };

  const selectCandidate = (member: { id: number; displayName: string }): void => {
    if (mention === null) {
      return;
    }
    // Replace the whole `@query` token, not only the part before the caret, so
    // selecting while the cursor sits mid-token does not duplicate its tail.
    const tail = /^\S*/.exec(draft.slice(caret))?.[0] ?? "";
    const end = caret + tail.length;
    const next = `${draft.slice(0, mention.start)}@${member.displayName} ${draft.slice(end)}`;
    const nextCaret = mention.start + member.displayName.length + 2;
    pendingCaretRef.current = nextCaret;
    setDraft(next);
    setActiveIndex(0);
    setDismissedKey(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const enterPressed = event.key === "Enter";
    if (enterPressed && isImeComposing(event)) {
      return;
    }
    if (event.key === "Tab" && isImeComposing(event)) {
      return;
    }

    if (event.key === "Escape" && listOpen) {
      event.preventDefault();
      setDismissedKey(mentionKey);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!listOpen || candidates.length === 0) {
        return;
      }
      event.preventDefault();
      setActiveIndex(() => {
        const step = event.key === "ArrowDown" ? 1 : -1;
        return (
          (highlightedIndex + step + candidates.length) % candidates.length
        );
      });
      return;
    }

    if (enterPressed && event.shiftKey) {
      return;
    }

    if ((enterPressed || event.key === "Tab") && listOpen) {
      event.preventDefault();
      if (activeCandidate !== undefined) {
        selectCandidate(activeCandidate);
      }
      return;
    }

    if (event.key === "Tab") {
      return;
    }

    if (!enterPressed) {
      return;
    }

    event.preventDefault();
    void submit();
  };

  const rows = Math.max(1, Math.min(6, draft.split("\n").length));
  const tooLong = draft.length > MESSAGE_MAX_LENGTH;
  const canSend =
    !busy && draft.trim().length > 0 && !tooLong;
  const activeOptionId =
    listOpen && activeCandidate !== undefined
      ? `${listboxId}-option-${activeCandidate.id}`
      : undefined;

  return (
    <div className="flex shrink-0 flex-col gap-1">
      {error !== null ? (
        <p role="alert" className="text-xs text-brick">
          {error}
        </p>
      ) : null}

      <div className="relative flex items-end gap-2">
        {listOpen ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={ko.chat.mentionList}
            className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-64 overflow-y-auto rounded-sm border-[1.5px] border-line-strong bg-paper py-1 shadow-hard"
          >
            {candidates.map((member, index) => (
              <li
                key={member.id}
                id={`${listboxId}-option-${member.id}`}
                role="option"
                aria-selected={index === highlightedIndex}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectCandidate(member);
                }}
                onMouseMove={() => setActiveIndex(index)}
                className={
                  index === highlightedIndex
                    ? "cursor-pointer bg-sunken px-2 py-1 text-[13px] font-medium text-ink"
                    : "cursor-pointer px-2 py-1 text-[13px] text-ink"
                }
              >
                {member.displayName}
              </li>
            ))}
          </ul>
        ) : null}

        <TextArea
          ref={textareaRef}
          value={draft}
          rows={rows}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={listOpen}
          aria-activedescendant={activeOptionId}
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onSelect={syncCaret}
          className="max-h-32 min-h-7 min-w-0 flex-1 resize-none py-1"
          style={{ resize: "none" }}
        />

        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {tooLong ? (
            <span data-testid="message-length" className="text-xs text-brick">
              {draft.length}/{MESSAGE_MAX_LENGTH}
            </span>
          ) : null}
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!canSend}
            className="h-7"
          >
            {busy ? ko.chat.sending : ko.chat.send}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default MessageComposer;
