/**
 * Display formatting helpers shared by the board, ledger and quest drawer.
 *
 * Dates are rendered in the browser's local timezone with Korean punctuation so
 * that the table columns and event timeline stay consistent. The link
 * tokenizer is pure so the drawer can render stored multi-line text with
 * clickable `http(s)` URLs without injecting HTML.
 */
import { ko } from "../i18n/ko";

/** Two-digit zero padding. */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `2026. 1. 2.` — Korean date (local time), or `-` for invalid timestamps. */
export function formatKoreanDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

/** `2026. 1. 2. 13:05` — Korean date and local 24-hour time. */
export function formatKoreanDateTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return `${formatKoreanDate(timestampMs)} ${pad2(date.getHours())}:${pad2(
    date.getMinutes(),
  )}`;
}

/**
 * Relative label such as `3일 전`.
 *
 * Thin wrapper around `ko.time.relative` so components do not need to import
 * both modules; `nowMs` is injectable for deterministic rendering.
 */
export function relativeTime(
  timestampMs: number,
  nowMs: number = Date.now(),
): string {
  return ko.time.relative(timestampMs, nowMs);
}

/** A run of plain text or a clickable URL inside a stored string. */
export interface LinkToken {
  type: "text" | "url";
  value: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]$/;

/**
 * Split `text` into plain text and `http(s)` URL tokens.
 *
 * Punctuation that commonly follows a URL in prose (`.`, `,`, `;`, `:`, `!`,
 * `?`) is kept as text. Newlines are preserved in the text tokens, so callers
 * can render the result with `whitespace-pre-wrap`.
 */
export function tokenizeLinks(text: string): LinkToken[] {
  if (text.length === 0) {
    return [];
  }

  const tokens: LinkToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  URL_PATTERN.lastIndex = 0;

  while ((match = URL_PATTERN.exec(text)) !== null) {
    let url = match[0];
    while (url.length > 0 && TRAILING_PUNCTUATION.test(url)) {
      url = url.slice(0, -1);
    }

    // Require at least one character after the scheme separator.
    if (url.length <= "https://".length) {
      continue;
    }

    const start = match.index;
    if (start > cursor) {
      tokens.push({ type: "text", value: text.slice(cursor, start) });
    }
    tokens.push({ type: "url", value: url });
    cursor = start + url.length;
    URL_PATTERN.lastIndex = cursor;
  }

  if (cursor < text.length) {
    tokens.push({ type: "text", value: text.slice(cursor) });
  }

  return tokens;
}

/**
 * Split pasted text into trimmed, non-empty quest titles.
 *
 * Used by the quick-add paste handler: two or more lines become a bulk-create
 * confirmation instead of being pasted into the single-line input.
 */
export function parsePastedTitles(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
