/**
 * One chat message body with mentions and bare URLs.
 *
 * The shared `segmentMessage` splits the stored body into text, `<@id>` mention
 * tokens and bare URLs. Mentions render as small `@표시이름` chips; a mention of
 * the signed-in adventurer uses the teal emphasis so it stands out in a busy
 * room. Newlines are preserved exactly (chat bodies are plain text), and URLs
 * open in a new tab.
 */
import { segmentMessage } from "@guildloom/shared";

import { ko } from "../../i18n/ko";

/** Props for {@link MessageBody}. */
export interface MessageBodyProps {
  body: string;
  resolveName: (userId: number) => string | null;
  currentUserId: number | null;
}

/** Mention chip classes for the current user (`teal`) and everyone else. */
const MENTION_MINE_CLASSES =
  "rounded-sm bg-teal px-1 font-medium text-paper";
const MENTION_OTHER_CLASSES =
  "rounded-sm border border-line bg-sunken px-1 text-ink";

/** Plain-text body with mention chips and external links. */
export function MessageBody({
  body,
  resolveName,
  currentUserId,
}: MessageBodyProps) {
  const segments = segmentMessage(body, resolveName);

  return (
    <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">
      {segments.map((segment, index) => {
        if (segment.kind === "mention") {
          const name = segment.name ?? ko.common.unknown;
          const mine =
            currentUserId !== null && segment.userId === currentUserId;
          return (
            <span
              key={`mention-${index}`}
              data-mention-user-id={segment.userId}
              className={mine ? MENTION_MINE_CLASSES : MENTION_OTHER_CLASSES}
            >
              @{name}
            </span>
          );
        }

        if (segment.kind === "url") {
          return (
            <a
              key={`url-${index}`}
              href={segment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal underline decoration-1 underline-offset-2"
            >
              {segment.url}
            </a>
          );
        }

        return <span key={`text-${index}`}>{segment.text}</span>;
      })}
    </p>
  );
}

export default MessageBody;
