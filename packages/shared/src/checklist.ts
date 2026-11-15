/**
 * Markdown checklist helpers for quest checklists (F1).
 *
 * A checklist item is a Markdown task-list line such as `- [ ] title`,
 * `* [x] title` or an indented variant. Parsing and toggling never rewrite the
 * rest of the document: every non-target line and every line-ending byte
 * (LF/CRLF) stays untouched.
 */

/**
 * Matches one checklist line; the leading indentation is captured as group 1.
 */
const CHECKLIST_LINE_RE = /^(\s*)[-*] \[( |x|X)\] (.+)$/;

/** Matches the checkbox marker of a known checklist line. */
const CHECKBOX_RE = /^(\s*[-*] \[)( |x|X)(\])/;

/** Matches one line separator while keeping it in the split result. */
const LINE_SPLIT_RE = /(\r\n|\n|\r)/;

/** Matches the first line separator of a document. */
const FIRST_NEWLINE_RE = /\r\n|\n|\r/;

/** Whether a document already ends with a line separator. */
const TRAILING_NEWLINE_RE = /(?:\r\n|\n|\r)$/;

/** A parsed checklist item. */
export interface ChecklistItem {
  /** Zero-based position among checklist items (not source lines). */
  index: number;
  /** Zero-based line number in the source text. */
  line: number;
  /** Text after the checkbox marker. */
  text: string;
  /** Whether the box is checked (`x`/`X`). */
  done: boolean;
}

/** Result of {@link parseChecklist}. */
export interface Checklist {
  /** Checklist items in source order. */
  items: ChecklistItem[];
  /** Number of checked items. */
  done: number;
  /** Total number of checklist items. */
  total: number;
}

/** Split `text` into lines, dropping the CRLF/LF/CR separators. */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

/** The line separator a document already uses, defaulting to LF. */
function newlineOf(text: string): string {
  return FIRST_NEWLINE_RE.exec(text)?.[0] ?? "\n";
}

/**
 * Parse every checklist line of `text`.
 *
 * Lines that merely look like checkboxes (`- []`, `-[ ] title`, `1. [ ] title`
 * or `- [ ]` without a title) are ignored.
 */
export function parseChecklist(text: string): Checklist {
  const items: ChecklistItem[] = [];
  let done = 0;

  const lines = splitLines(text);
  for (let line = 0; line < lines.length; line += 1) {
    const match = CHECKLIST_LINE_RE.exec(lines[line] ?? "");
    if (match === null) {
      continue;
    }

    const checked = match[2] === "x" || match[2] === "X";
    if (checked) {
      done += 1;
    }
    items.push({
      index: items.length,
      line,
      text: match[3] ?? "",
      done: checked,
    });
  }

  return { items, done, total: items.length };
}

/**
 * Set the checked state of checklist item `index` (zero-based).
 *
 * Only the `[ ]` / `[x]` marker of the target line changes; all other bytes,
 * including CRLF line endings, are preserved. Throws a `RangeError` when no
 * checklist item has that index.
 */
export function setChecklistItem(
  text: string,
  index: number,
  done: boolean,
): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`Checklist item index out of range: ${index}`);
  }

  // Odd entries are the separators; keeping them in place preserves CRLF/LF.
  const pieces = text.split(LINE_SPLIT_RE);
  let itemIndex = -1;

  for (let piece = 0; piece < pieces.length; piece += 2) {
    const line = pieces[piece] ?? "";
    if (!CHECKLIST_LINE_RE.test(line)) {
      continue;
    }

    itemIndex += 1;
    if (itemIndex !== index) {
      continue;
    }

    pieces[piece] = line.replace(
      CHECKBOX_RE,
      (_match, prefix: string, _marker: string, suffix: string) =>
        `${prefix}${done ? "x" : " "}${suffix}`,
    );
    return pieces.join("");
  }

  throw new RangeError(`Checklist item does not exist: ${index}`);
}

/**
 * Append `titles` as unchecked checklist items (`- [ ] title`).
 *
 * Titles are trimmed and blank (whitespace-only) ones are dropped. New lines
 * reuse the document's existing line ending (LF when it has none), and a
 * separator is inserted first when the document is not empty and does not
 * already end with one.
 */
export function appendChecklistItems(
  text: string,
  titles: readonly string[],
): string {
  const lines = titles
    .map((title) => title.trim())
    .filter((title) => title.length > 0)
    .map((title) => `- [ ] ${title}`);

  if (lines.length === 0) {
    return text;
  }

  const newline = newlineOf(text);
  const separator =
    text.length > 0 && !TRAILING_NEWLINE_RE.test(text) ? newline : "";
  return `${text}${separator}${lines.join(newline)}`;
}
