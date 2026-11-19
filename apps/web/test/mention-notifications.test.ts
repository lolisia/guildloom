// @vitest-environment node
/**
 * Copy for `mentioned` notifications (M2b).
 *
 * The tavern room has no quest (`questId: null`); a party chat mention names
 * the quest and quotes the message excerpt from the payload.
 */
import type { Notification } from "@guildloom/shared";
import { describe, expect, it } from "vitest";

import { ko } from "../src/i18n/ko";

/** A tavern mention with an actor and an excerpt. */
const tavernMention: Notification = {
  id: 1,
  projectId: 1,
  questId: null,
  questNumber: null,
  questTitle: null,
  type: "mentioned",
  actor: { id: 3, displayName: "김모험" },
  payload: { excerpt: "안녕하세요" },
  createdAt: 1_700_000_000_000,
  readAt: null,
};

describe("mentioned notification copy", () => {
  it("formats a tavern mention", () => {
    expect(ko.notifications.format(tavernMention)).toBe(
      '김모험 가 주점에서 나를 불렀습니다: "안녕하세요"',
    );
  });

  it("formats a party chat mention with the quest label", () => {
    expect(
      ko.notifications.format({
        ...tavernMention,
        questId: 2,
        questNumber: 7,
        questTitle: "로그인 버그",
      }),
    ).toBe(
      '김모험 가 #7 \'로그인 버그\' 파티 채팅에서 나를 불렀습니다: "안녕하세요"',
    );
  });

  it("falls back to 어떤 모험가 and an empty excerpt", () => {
    expect(
      ko.notifications.format({
        ...tavernMention,
        actor: null,
        payload: null,
      }),
    ).toBe('어떤 모험가 가 주점에서 나를 불렀습니다: ""');
  });
});
