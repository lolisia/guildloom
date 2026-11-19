/**
 * Chat mention encoding, segmentation and system-message rendering.
 *
 * A mention is stored in a message body as a `<@id>` token: the composer turns
 * typed `@표시이름` text into tokens with {@link encodeMentions}, and the
 * message view turns tokens back into typed segments with
 * {@link segmentMessage}. Both directions are pure so the server can reuse
 * them when it extracts the users to notify.
 */

/** Matches a stored mention token, capturing the mentioned user id. */
export const MENTION_TOKEN_RE = /<@(\d+)>/g;

/** Text shown for a mention whose user no longer resolves. */
const UNKNOWN_MENTION_NAME = "알 수 없음";

/** Actor shown on a system message that was written without one. */
const UNKNOWN_ACTOR = "누군가";

/** Non-whitespace characters that may immediately follow an encoded name. */
const MENTION_TRAILING_RE = /[.,!?:;)\]}'"~]/;

/** Matches the start of a bare URL inside a message body. */
const URL_START_RE = /^https?:\/\//;

/** A member the composer may encode as a mention. */
export interface MentionMember {
  /** User id written into the token. */
  id: number;
  /** Display name (표시이름) typed after `@`. */
  displayName: string;
}

/** Look up the display name of a mentioned user (`null` when unknown). */
export type ResolveMentionName = (userId: number) => string | null;

/** A rendered piece of a chat message body. */
export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; userId: number; name: string | null }
  | { kind: "url"; url: string };

/** A mention token read from `body`, with the offset just past its `>`. */
interface MentionToken {
  userId: number;
  end: number;
}

/**
 * Read a `<@id>` token starting at `start`.
 *
 * Returns `null` when the text there is not a well-formed token, so callers
 * keep it as plain text instead of guessing.
 */
function readMentionToken(
  body: string,
  start: number,
): MentionToken | null {
  if (body.charAt(start) !== "<" || body.charAt(start + 1) !== "@") {
    return null;
  }

  let end = start + 2;
  while (end < body.length) {
    const char = body.charAt(end);
    if (char < "0" || char > "9") {
      break;
    }
    end += 1;
  }

  if (end === start + 2 || body.charAt(end) !== ">") {
    return null;
  }

  return {
    userId: Number(body.slice(start + 2, end)),
    end: end + 1,
  };
}

/**
 * Unique mentioned user ids in first-seen order.
 *
 * Repeated tokens and tokens naming the same user only yield one id.
 */
export function extractMentionIds(body: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();

  MENTION_TOKEN_RE.lastIndex = 0;
  for (const match of body.matchAll(MENTION_TOKEN_RE)) {
    const digits = match[1];
    if (digits === undefined) {
      continue;
    }
    const userId = Number(digits);
    if (seen.has(userId)) {
      continue;
    }
    seen.add(userId);
    ids.push(userId);
  }
  MENTION_TOKEN_RE.lastIndex = 0;

  return ids;
}

/**
 * Replace every `@표시이름` in `text` with a `<@id>` mention token.
 *
 * Names are matched case-sensitively and longest first, so `@김철수` never
 * becomes the token for a member named `김`. The `@` must sit immediately
 * before the name and the name must end at the end of the string, whitespace
 * or one of `.,!?:;)]}'"~`. An unmatched `@name` and every existing `<@id>`
 * token are left untouched.
 */
export function encodeMentions(
  text: string,
  members: readonly MentionMember[],
): string {
  const namedMembers = members
    .filter((member) => member.displayName.length > 0)
    .sort((a, b) => b.displayName.length - a.displayName.length);

  if (namedMembers.length === 0) {
    return text;
  }

  let encoded = "";
  let index = 0;

  while (index < text.length) {
    const token = readMentionToken(text, index);
    if (token !== null) {
      encoded += text.slice(index, token.end);
      index = token.end;
      continue;
    }

    if (text.charAt(index) !== "@") {
      encoded += text.charAt(index);
      index += 1;
      continue;
    }

    const member = namedMembers.find(({ displayName }) => {
      if (!text.startsWith(displayName, index + 1)) {
        return false;
      }
      const after = text.charAt(index + 1 + displayName.length);
      return (
        after === "" ||
        /\s/.test(after) ||
        MENTION_TRAILING_RE.test(after)
      );
    });

    if (member === undefined) {
      encoded += "@";
      index += 1;
      continue;
    }

    encoded += `<@${member.id}>`;
    index += 1 + member.displayName.length;
  }

  return encoded;
}

/**
 * Read a bare URL starting at `start`, or `null` when none starts there.
 *
 * A URL runs until whitespace; trailing `.`, `,` and `)` sentence punctuation
 * is removed from the segment.
 */
function readUrl(
  body: string,
  start: number,
): { url: string; end: number } | null {
  if (!URL_START_RE.test(body.slice(start, start + 8))) {
    return null;
  }

  let end = start;
  while (end < body.length && !/\s/.test(body.charAt(end))) {
    end += 1;
  }

  let url = body.slice(start, end);
  while (url.length > 0 && /[.,)]/.test(url.charAt(url.length - 1))) {
    url = url.slice(0, -1);
  }

  return { url, end };
}

/**
 * Split a message body into text, mention and URL segments in source order.
 *
 * Mention tokens become {@link MessageSegment | mention segments} whose name is
 * resolved through `resolveName` (`null` for an unknown user). Empty text
 * segments are never produced.
 */
export function segmentMessage(
  body: string,
  resolveName: ResolveMentionName,
): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let text = "";

  const flushText = (): void => {
    if (text.length === 0) {
      return;
    }
    segments.push({ kind: "text", text });
    text = "";
  };

  let index = 0;
  while (index < body.length) {
    const token = readMentionToken(body, index);
    if (token !== null) {
      flushText();
      segments.push({
        kind: "mention",
        userId: token.userId,
        name: resolveName(token.userId) ?? null,
      });
      index = token.end;
      continue;
    }

    const url = readUrl(body, index);
    if (url !== null) {
      flushText();
      segments.push({ kind: "url", url: url.url });
      index = url.end;
      continue;
    }

    text += body.charAt(index);
    index += 1;
  }

  flushText();
  return segments;
}

/**
 * Render a message body as plain text.
 *
 * Every mention becomes `@이름` (`@알 수 없음` for an unknown user); all other
 * text, URLs included, is left exactly as written.
 */
export function messagePlainText(
  body: string,
  resolveName: ResolveMentionName,
): string {
  return body.replace(MENTION_TOKEN_RE, (_match: string, digits: string) => {
    const name = resolveName(Number(digits));
    return `@${name ?? UNKNOWN_MENTION_NAME}`;
  });
}

/**
 * Render the payload of a `system` message into segments.
 *
 * Only the `quest_created` payload is rendered, as one sentence naming the
 * actor (or `누군가` when there is none) and the promoted quest. Any other
 * payload yields no segments so the stored body is shown instead.
 */
export function renderSystemMessage(
  payload: unknown,
  actorName: string | null,
): MessageSegment[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (record.type !== "quest_created") {
    return [];
  }

  const questNumber = record.questNumber;
  const questTitle = record.questTitle;
  if (typeof questNumber !== "number" || typeof questTitle !== "string") {
    return [];
  }

  const actor = actorName ?? UNKNOWN_ACTOR;
  return [
    {
      kind: "text",
      text: `${actor} 가 의뢰 #${questNumber} '${questTitle}' 을 게시판에 올렸습니다.`,
    },
  ];
}
