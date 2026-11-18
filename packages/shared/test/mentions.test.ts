import { describe, expect, it } from "vitest";

import {
  M2B_NOTIFICATION_TYPES,
  MESSAGE_KINDS,
  MESSAGE_MAX_LENGTH,
  MESSAGE_PAGE_DEFAULT,
  MESSAGE_PAGE_MAX,
  MENTION_NOTIFY_MAX,
  MENTION_TOKEN_RE,
  NOTIFICATION_TYPES,
  UNREAD_DISPLAY_CAP,
  chatMessageSchema,
  chatUnreadResponseSchema,
  createQuestFromChatRequestSchema,
  createQuestFromChatResponseSchema,
  encodeMentions,
  extractMentionIds,
  markReadRequestSchema,
  messageKindSchema,
  messagePageQuerySchema,
  messagePageResponseSchema,
  messagePlainText,
  notificationTypeSchema,
  postMessageRequestSchema,
  renderSystemMessage,
  segmentMessage,
  type MentionMember,
} from "../src/index.js";

/** Members used by the mention encoding cases (longest name wins). */
const members: MentionMember[] = [
  { id: 1, displayName: "김" },
  { id: 2, displayName: "김철수" },
];

/** Name resolver where only user 2 is still a guild member. */
const resolveName = (userId: number): string | null =>
  userId === 2 ? "김철수" : null;

/** Message payload shape used by every chat schema case. */
const message = {
  id: 1,
  projectId: 2,
  questId: null,
  kind: "user",
  author: { id: 3, displayName: "김모험" },
  familiarId: null,
  body: "안녕하세요",
  payload: null,
  promotedQuest: null,
  createdAt: 1_700_000_000_000,
  deletedAt: null,
} as const;

describe("M2b constants", () => {
  it("defines the message kinds", () => {
    expect(MESSAGE_KINDS).toEqual(["user", "system"]);
    expect(messageKindSchema.options).toEqual([...MESSAGE_KINDS]);
  });

  it("adds mentioned as the last notification type", () => {
    expect(M2B_NOTIFICATION_TYPES).toEqual(["mentioned"]);
    expect(NOTIFICATION_TYPES).toContain("mentioned");
    expect(NOTIFICATION_TYPES.at(-1)).toBe("mentioned");
    expect(notificationTypeSchema.options).toEqual([...NOTIFICATION_TYPES]);
  });

  it("exports the chat limits", () => {
    expect(MESSAGE_MAX_LENGTH).toBe(4000);
    expect(MESSAGE_PAGE_DEFAULT).toBe(50);
    expect(MESSAGE_PAGE_MAX).toBe(100);
    expect(MENTION_NOTIFY_MAX).toBe(20);
    expect(UNREAD_DISPLAY_CAP).toBe(99);
  });
});

describe("MENTION_TOKEN_RE", () => {
  it("matches stored mention tokens", () => {
    expect(MENTION_TOKEN_RE.source).toBe("<@(\\d+)>");
    expect(MENTION_TOKEN_RE.global).toBe(true);
  });
});

describe("extractMentionIds", () => {
  it("returns unique user ids in first-seen order", () => {
    expect(extractMentionIds("<@2> hi <@3> <@2>")).toEqual([2, 3]);
  });

  it("ignores messages without tokens", () => {
    expect(extractMentionIds("아무도 부르지 않았습니다")).toEqual([]);
  });

  it("deduplicates differently padded ids", () => {
    expect(extractMentionIds("<@007> <@7>")).toEqual([7]);
  });
});

describe("encodeMentions", () => {
  it("matches the longest name first", () => {
    expect(encodeMentions("@김철수 확인", members)).toBe("<@2> 확인");
  });

  it("encodes a name at end of string", () => {
    expect(encodeMentions("@김", members)).toBe("<@1>");
  });

  it("stops at characters appended to the name", () => {
    expect(encodeMentions("@김철수님", members)).toBe("@김철수님");
    expect(encodeMentions("@김철수입니다", members)).toBe("@김철수입니다");
  });

  it("keeps unknown names as text", () => {
    expect(encodeMentions("@박영희 확인", members)).toBe("@박영희 확인");
  });

  it("accepts whitespace and sentence punctuation after the name", () => {
    expect(encodeMentions("@김, @김철수~", members)).toBe("<@1>, <@2>~");
    expect(encodeMentions('"@김"', members)).toBe('"<@1>"');
    expect(encodeMentions("@김\n다음 줄", members)).toBe("<@1>\n다음 줄");
  });

  it("never touches existing mention tokens", () => {
    expect(encodeMentions("<@1> @김", members)).toBe("<@1> <@1>");
    expect(encodeMentions("<@1>", [{ id: 9, displayName: "1" }])).toBe(
      "<@1>",
    );
  });

  it("matches names case-sensitively", () => {
    const english = [{ id: 4, displayName: "Alice" }];
    expect(encodeMentions("@Alice 안녕", english)).toBe("<@4> 안녕");
    expect(encodeMentions("@alice 안녕", english)).toBe("@alice 안녕");
  });

  it("returns the text unchanged without members", () => {
    expect(encodeMentions("@김 안녕", [])).toBe("@김 안녕");
  });
});

describe("segmentMessage", () => {
  it("keeps mentions, URLs and text in source order", () => {
    expect(
      segmentMessage(
        "안녕 <@2> https://example.com/a). 그리고 <@99>",
        resolveName,
      ),
    ).toEqual([
      { kind: "text", text: "안녕 " },
      { kind: "mention", userId: 2, name: "김철수" },
      { kind: "text", text: " " },
      { kind: "url", url: "https://example.com/a" },
      { kind: "text", text: " 그리고 " },
      { kind: "mention", userId: 99, name: null },
    ]);
  });

  it("strips trailing sentence punctuation from URLs", () => {
    expect(segmentMessage("https://a.com/x,", resolveName)).toEqual([
      { kind: "url", url: "https://a.com/x" },
    ]);
    expect(segmentMessage("https://a.com/x).", resolveName)).toEqual([
      { kind: "url", url: "https://a.com/x" },
    ]);
  });

  it("never emits empty text segments", () => {
    expect(segmentMessage("", resolveName)).toEqual([]);
    expect(segmentMessage("<@1><@2>", resolveName)).toEqual([
      { kind: "mention", userId: 1, name: null },
      { kind: "mention", userId: 2, name: "김철수" },
    ]);
  });

  it("keeps malformed tokens as text", () => {
    expect(segmentMessage("<@abc> <@2>", resolveName)).toEqual([
      { kind: "text", text: "<@abc> " },
      { kind: "mention", userId: 2, name: "김철수" },
    ]);
  });
});

describe("messagePlainText", () => {
  it("replaces mentions and leaves URLs as written", () => {
    expect(
      messagePlainText(
        "안녕 <@2>, <@99> https://x.com/a).",
        resolveName,
      ),
    ).toBe("안녕 @김철수, @알 수 없음 https://x.com/a).");
  });

  it("returns text without tokens unchanged", () => {
    expect(messagePlainText("그냥 문장", resolveName)).toBe("그냥 문장");
  });
});

describe("renderSystemMessage", () => {
  const payload = {
    type: "quest_created",
    questId: 5,
    questNumber: 12,
    questTitle: "로그인 버그",
    sourceMessageId: 3,
  };

  it("renders the quest_created sentence", () => {
    expect(renderSystemMessage(payload, "김모험")).toEqual([
      {
        kind: "text",
        text: "김모험 가 의뢰 #12 '로그인 버그' 을 게시판에 올렸습니다.",
      },
    ]);
  });

  it("falls back to 누군가 without an actor", () => {
    expect(renderSystemMessage(payload, null)).toEqual([
      {
        kind: "text",
        text: "누군가 가 의뢰 #12 '로그인 버그' 을 게시판에 올렸습니다.",
      },
    ]);
  });

  it("renders nothing for other payloads", () => {
    expect(renderSystemMessage({ type: "quest_deleted" }, "김모험")).toEqual(
      [],
    );
    expect(renderSystemMessage(null, "김모험")).toEqual([]);
    expect(
      renderSystemMessage({ type: "quest_created" }, "김모험"),
    ).toEqual([]);
  });
});

describe("chat schemas", () => {
  it("parses a chat message and rejects an unknown kind", () => {
    expect(chatMessageSchema.parse(message)).toEqual(message);
    expect(
      chatMessageSchema.safeParse({ ...message, kind: "bot" }).success,
    ).toBe(false);
  });

  it("keeps the exact chat message keys", () => {
    expect(Object.keys(chatMessageSchema.shape)).toEqual([
      "id",
      "projectId",
      "questId",
      "kind",
      "author",
      "familiarId",
      "body",
      "payload",
      "promotedQuest",
      "createdAt",
      "deletedAt",
    ]);
  });

  it("accepts a system message with a promoted quest", () => {
    expect(
      chatMessageSchema.safeParse({
        ...message,
        kind: "system",
        author: null,
        promotedQuest: { id: 9, number: 12, title: "로그인 버그" },
      }).success,
    ).toBe(true);
  });

  it("parses the message page query with defaults and limits", () => {
    expect(messagePageQuerySchema.parse({})).toEqual({
      limit: MESSAGE_PAGE_DEFAULT,
    });
    expect(
      messagePageQuerySchema.parse({ before: "12", limit: "100" }),
    ).toEqual({ before: 12, limit: 100 });
    expect(messagePageQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(messagePageQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(messagePageQuerySchema.safeParse({ before: "0" }).success).toBe(
      false,
    );
    expect(messagePageQuerySchema.safeParse({ before: "-2" }).success).toBe(
      false,
    );
    expect(messagePageQuerySchema.safeParse({ before: "abc" }).success).toBe(
      false,
    );
  });

  it("describes a message page", () => {
    expect(messagePageResponseSchema.parse({ messages: [], hasMore: false }))
      .toEqual({ messages: [], hasMore: false });
    expect(Object.keys(messagePageResponseSchema.shape)).toEqual([
      "messages",
      "hasMore",
    ]);
  });

  it("trims and bounds a posted message body", () => {
    expect(postMessageRequestSchema.parse({ body: "  안녕  " })).toEqual({
      body: "안녕",
    });
    expect(postMessageRequestSchema.safeParse({ body: "   " }).success).toBe(
      false,
    );
    expect(
      postMessageRequestSchema.safeParse({
        body: "가".repeat(MESSAGE_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      postMessageRequestSchema.safeParse({
        body: "가".repeat(MESSAGE_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });

  it("validates a quest created from chat", () => {
    expect(
      createQuestFromChatRequestSchema.parse({
        title: "  로그인 버그  ",
        situation: "세션 만료",
        sourceMessageId: 3,
      }),
    ).toEqual({
      title: "로그인 버그",
      situation: "세션 만료",
      sourceMessageId: 3,
    });
    expect(
      createQuestFromChatRequestSchema.safeParse({ title: "  " }).success,
    ).toBe(false);
    expect(
      createQuestFromChatRequestSchema.safeParse({
        title: "가".repeat(201),
      }).success,
    ).toBe(false);
    expect(
      createQuestFromChatRequestSchema.safeParse({
        title: "제목",
        situation: "가".repeat(20_001),
      }).success,
    ).toBe(false);
    expect(Object.keys(createQuestFromChatResponseSchema.shape)).toEqual([
      "quest",
      "message",
    ]);
  });

  it("describes unread and read markers", () => {
    expect(
      chatUnreadResponseSchema.parse({
        tavern: 3,
        quests: [{ questId: 7, count: 2 }],
      }),
    ).toEqual({ tavern: 3, quests: [{ questId: 7, count: 2 }] });
    expect(Object.keys(chatUnreadResponseSchema.shape)).toEqual([
      "tavern",
      "quests",
    ]);
    expect(
      chatUnreadResponseSchema.safeParse({
        tavern: 0,
        quests: [{ questId: null, count: 1 }],
      }).success,
    ).toBe(false);

    expect(
      markReadRequestSchema.parse({ questId: null, messageId: 4 }),
    ).toEqual({ questId: null, messageId: 4 });
    expect(
      markReadRequestSchema.safeParse({ questId: 3, messageId: 4 }).success,
    ).toBe(true);
    expect(markReadRequestSchema.safeParse({ messageId: 4 }).success).toBe(
      false,
    );
    expect(Object.keys(markReadRequestSchema.shape)).toEqual([
      "questId",
      "messageId",
    ]);
  });
});
