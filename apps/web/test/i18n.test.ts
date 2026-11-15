// @vitest-environment node
/**
 * Guardrails for the Korean copy bundle.
 *
 * Stage and action icons come from the shared `Icon` component, so the copy
 * must stay plain text: an emoji sneaking back into `ko.ts` would bypass the
 * icon system and screen readers would read it as a stray glyph.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Notification } from "@guildloom/shared";
import { describe, expect, it } from "vitest";

import { ko } from "../src/i18n/ko";

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const koSourcePath = fileURLToPath(
  new URL("../src/i18n/ko.ts", import.meta.url),
);

describe("ko copy bundle", () => {
  it("keeps the board column labels plain", () => {
    expect(ko.board.columns).toEqual({
      board: "게시판",
      dungeon: "던전 진행",
      boss: "보스전",
      cleared: "클리어",
    });
  });

  it("contains no emoji in the source", () => {
    const source = readFileSync(koSourcePath, "utf8");
    expect(source.match(EMOJI)).toBeNull();
  });

  it("formats the clear_revoked notification with the revoked XP", () => {
    const notification: Notification = {
      id: 1,
      projectId: 1,
      questId: 2,
      questNumber: 7,
      questTitle: "로그인 버그",
      type: "clear_revoked",
      actor: { id: 3, displayName: "김모험" },
      payload: { xpRevoked: 48 },
      createdAt: Date.UTC(2026, 0, 2, 3, 0, 0),
      readAt: null,
    };

    expect(ko.notifications.format(notification)).toBe(
      "김모험님이 #7 '로그인 버그'의 클리어를 취소했습니다. (XP 48 회수)",
    );
  });
});
