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
});
