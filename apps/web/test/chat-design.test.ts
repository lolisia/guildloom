// @vitest-environment node
/**
 * `## 채팅`: the M2b chat design contract in DESIGN.md.
 *
 * The chat system itself is already implemented; this task only writes its
 * design down, so the document is the deliverable. This suite is its guard:
 * the section must keep covering the message row, five-minute grouping,
 * system/event lines, mention chips, hover/focus row actions, the composer
 * with its IME guard, the unread badges, the tavern width and the drawer
 * timeline. It also proves the new section stays inside the existing token
 * system (no new colours, fonts, gradients, blur, emoji or icons), and that
 * the YAML front matter and every older section were left alone. Line endings
 * are normalised so the checks read the same on Windows checkouts.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const DESIGN_MD = readFileSync(
  new URL("../DESIGN.md", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

interface Section {
  /** Number of `## title` headings found; the section guard expects one. */
  count: number;
  /** Contents after the heading, up to the next `##` heading. */
  body: string;
}

/** Read one top-level Markdown section by its exact heading text. */
function readSection(markdown: string, title: string): Section {
  const lines = markdown.split("\n");
  const heading = `## ${title}`;
  const indexes = lines
    .map((line, index) => (line === heading ? index : -1))
    .filter((index) => index !== -1);

  if (indexes.length !== 1) {
    return { count: indexes.length, body: "" };
  }

  const start = indexes[0]! + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index]!.startsWith("## ")) {
      end = index;
      break;
    }
  }

  return { count: 1, body: lines.slice(start, end).join("\n") };
}

/** The leading `--- ... ---` block, without its fences. */
function readFrontMatter(markdown: string): string {
  return /^---\n([\s\S]*?)\n---\n/.exec(markdown)?.[1] ?? "";
}

interface ThemeColors {
  light: Record<string, string>;
  dark: Record<string, string>;
}

/** Read the quoted `colors.light` / `colors.dark` token values. */
function readThemeColors(frontMatter: string): ThemeColors {
  const colors: ThemeColors = { light: {}, dark: {} };
  let theme: keyof ThemeColors | null = null;

  for (const line of frontMatter.split("\n")) {
    if (/^[A-Za-z][\w-]*:/.test(line)) {
      // A new top-level key closes the colors block.
      theme = null;
      continue;
    }

    const themeLine = /^ {2}(light|dark):\s*$/.exec(line);
    if (themeLine?.[1] !== undefined) {
      theme = themeLine[1] as keyof ThemeColors;
      continue;
    }

    if (theme === null) {
      continue;
    }

    const token = /^ {4}([a-z-]+):\s*"([^"]*)"/.exec(line);
    if (token?.[1] !== undefined && token[2] !== undefined) {
      colors[theme][token[1]] = token[2];
    }
  }

  return colors;
}

const CHAT = readSection(DESIGN_MD, "채팅");
const FRONT_MATTER = readFrontMatter(DESIGN_MD);
const COLORS = readThemeColors(FRONT_MATTER);

/** The sections that existed before the chat section was added, in order. */
const ORIGINAL_SECTIONS = [
  "Overview",
  "Colors",
  "Typography",
  "Layout",
  "Elevation & Depth",
  "Shapes",
  "Components",
  "Motion",
  "Theme",
  "Don't",
  "Don't change",
] as const;

describe("DESIGN.md 채팅 section", () => {
  it("adds exactly one 채팅 section between Components and Motion", () => {
    expect(CHAT.count).toBe(1);
    expect(CHAT.body.trim().length).toBeGreaterThan(0);

    const components = DESIGN_MD.indexOf("## Components");
    const chat = DESIGN_MD.indexOf("## 채팅");
    const motion = DESIGN_MD.indexOf("## Motion");

    expect(components).toBeGreaterThan(-1);
    expect(chat).toBeGreaterThan(components);
    expect(chat).toBeLessThan(motion);
  });

  it("keeps the section in the document's one-line rule list form", () => {
    const rules = CHAT.body
      .split("\n")
      .filter((line) => line.trim().length > 0);

    expect(rules.length).toBeGreaterThanOrEqual(10);
    for (const rule of rules) {
      expect(rule.startsWith("- ")).toBe(true);
    }
  });

  it("documents the message row: 24px avatar, name, time and body", () => {
    expect(CHAT.body).toMatch(/24px 아바타/);
    expect(CHAT.body).toMatch(/14px 600/);
    expect(CHAT.body).toMatch(/12px `text-muted`/);
    expect(CHAT.body).toMatch(/<time dateTime>/);
    expect(CHAT.body).toMatch(/HH:MM/);
    expect(CHAT.body).toMatch(/14px\/1\.5/);
  });

  it("documents five-minute grouping without a repeated header", () => {
    expect(CHAT.body).toMatch(/같은 모험가가 5분 안에/);
    expect(CHAT.body).toMatch(/data-grouped/);
    expect(CHAT.body).toMatch(/아바타와 이름, 시각을 반복하지 않고/);
  });

  it("documents system and timeline event rows as one muted line", () => {
    expect(CHAT.body).toMatch(/시스템 메시지와 파티 타임라인의 이벤트 줄/);
    expect(CHAT.body).toMatch(/아바타와 아이콘 없이/);
    expect(CHAT.body).toMatch(/`text-xs` 한 줄\(`text-muted`\)/);
    expect(CHAT.body).toMatch(/renderSystemMessage/);
    expect(CHAT.body).toMatch(/renderEvent/);
  });

  it("documents mention chips with self emphasis and the unknown fallback", () => {
    expect(CHAT.body).toMatch(/`@이름`/);
    expect(CHAT.body).toMatch(/`@알 수 없음`/);
    expect(CHAT.body).toMatch(/teal 바탕 \+ paper 글자/);
    expect(CHAT.body).toMatch(/sunken 바탕 \+ ink/);
  });

  it("documents hover/focus-only text row actions", () => {
    expect(CHAT.body).toContain("[의뢰로 만들기]");
    expect(CHAT.body).toContain("[삭제]");
    expect(CHAT.body).toMatch(/12px 텍스트 버튼/);
    expect(CHAT.body).toMatch(/hover 또는 줄 안 focus/);
    expect(CHAT.body).toMatch(/group-focus-within/);
  });

  it("documents the 1–6 line composer, Enter, Shift+Enter and the IME guard", () => {
    expect(CHAT.body).toContain("1–6줄");
    expect(CHAT.body).toMatch(/28px에서 시작해 128px/);
    expect(CHAT.body).toMatch(/Enter는 보내기/);
    expect(CHAT.body).toMatch(/Shift\+Enter는 줄바꿈/);
    expect(CHAT.body).toMatch(/IME 조합 중 Enter\/Tab/);
    expect(CHAT.body).toMatch(/isImeComposing/);
  });

  it("documents the 주점 tab and board-card unread badges", () => {
    expect(CHAT.body).toMatch(/주점 탭/);
    expect(CHAT.body).toMatch(/보드 카드/);
    expect(CHAT.body).toMatch(/새 글 n/);
    expect(CHAT.body).toContain("99+");
    expect(CHAT.body).toMatch(/픽셀 12px/);
    expect(CHAT.body).toMatch(/aria-label/);
  });

  it("documents the tavern width and the drawer timeline toggle", () => {
    expect(CHAT.body).toContain("max-w-screen-lg");
    expect(CHAT.body).toContain("max-h-[360px]");
    expect(CHAT.body).toContain("[전체 기록 보기 (n)]");
    expect(CHAT.body).toMatch(/aria-expanded/);
    expect(CHAT.body).toMatch(/isKeyEvent/);
  });

  it("introduces no new colours, fonts, effects, emoji or icons", () => {
    expect(CHAT.body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CHAT.body).not.toMatch(
      /\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch)\(/i,
    );
    expect(CHAT.body).not.toMatch(/gradient|backdrop-blur|blur/i);
    expect(CHAT.body).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(CHAT.body).not.toMatch(/uppercase|tracking-(?:wide|wider|widest)/);
    expect(CHAT.body).not.toMatch(/<Icon\b|lucide|assets\/icons|\.png/);
  });

  it("keeps rounded-sm as the only radius", () => {
    expect(CHAT.body).toContain("rounded-sm");
    expect(CHAT.body).not.toMatch(/\brounded-(?!sm\b)[\w[\]-]+/);
  });

  it("reserves shadow-hard for the delete dialog and mention popover", () => {
    const shadowLines = CHAT.body
      .split("\n")
      .filter((line) => line.includes("shadow-hard"));

    expect(shadowLines.length).toBeGreaterThan(0);
    for (const line of shadowLines) {
      expect(line).toMatch(/대화상자|팝오버/);
    }
    expect(CHAT.body).not.toMatch(/\bshadow-(?!hard\b)/);
  });

  it("sticks to the existing palette tokens", () => {
    for (const token of [
      "ground",
      "paper",
      "sunken",
      "ink",
      "muted",
      "line",
      "teal",
      "gold",
      "brick",
    ]) {
      expect(CHAT.body).toContain(token);
    }
    expect(CHAT.body).toMatch(/`gold`는 보상 숫자가 아니므로 쓰지 않는다/);
  });
});

describe("DESIGN.md front matter", () => {
  it("keeps the original top-level keys in order", () => {
    const keys = FRONT_MATTER.split("\n")
      .filter((line) => /^[A-Za-z][\w-]*:/.test(line))
      .map((line) => line.slice(0, line.indexOf(":")));

    expect(keys).toEqual([
      "version",
      "name",
      "description",
      "colors",
      "typography",
      "rounded",
      "spacing",
      "border",
    ]);
  });

  it("keeps the version, name and description unchanged", () => {
    expect(FRONT_MATTER).toContain("version: alpha");
    expect(FRONT_MATTER).toContain("name: guildloom");
    expect(FRONT_MATTER).toContain(
      "description: 소규모 개발팀의 이슈를 길드 의뢰처럼 다루는 업무 도구. 오래 켜 두어도 읽기 편하고, 보상 숫자에서만 게임의 손맛이 난다.",
    );
  });

  it("keeps both theme colour maps exactly", () => {
    expect(COLORS.light).toEqual({
      ground: "#E8EBE4",
      paper: "#FAFAF6",
      sunken: "#DEE2DA",
      ink: "#1F2429",
      scrim: "rgb(31 36 41 / 0.40)",
      muted: "#545C64",
      line: "#C3C9C0",
      teal: "#20585B",
      gold: "#7A5716",
      "gold-fill": "#CE9C3C",
      brick: "#793D35",
      "avatar-ink": "#FAFAF6",
    });
    expect(COLORS.dark).toEqual({
      ground: "#191923",
      paper: "#23232F",
      sunken: "#14141C",
      ink: "#EDE3CF",
      scrim: "rgb(8 8 12 / 0.60)",
      muted: "#A69F96",
      line: "#3A3946",
      teal: "#75B5A1",
      gold: "#EFC45E",
      "gold-fill": "#CE9C3C",
      brick: "#E69B72",
    });
  });

  it("keeps the typography, radius, spacing and border values", () => {
    for (const value of [
      "    fontFamily: Galmuri11",
      "    sizes: [12px, 16px, 22px]",
      "    fontFamily: IBM Plex Sans KR",
      "    weights: [400, 500, 600]",
      "    scale: [12px, 13px, 14px, 18px, 22px]",
      "    lineHeight: 1.5",
      "  none: 0",
      "  sm: 2px",
      "spacing: [4px, 8px, 12px, 16px, 24px, 32px]",
      "  hairline: 1px solid line",
      "  outline: 1.5px solid ink",
    ]) {
      expect(FRONT_MATTER).toContain(value);
    }
  });
});

describe("DESIGN.md existing sections", () => {
  it("keeps every original section heading in order", () => {
    const headings = [...DESIGN_MD.matchAll(/^## (.+)$/gm)].map(
      (match) => match[1]!,
    );

    let previous = -1;
    for (const section of ORIGINAL_SECTIONS) {
      const index = headings.indexOf(section);
      expect(index, `missing or reordered: ${section}`).toBeGreaterThan(
        previous,
      );
      previous = index;
    }
  });

  it("keeps a sentinel rule from each original section", () => {
    for (const rule of [
      "길드 회관의 의뢰 게시판",
      "ground/paper/sunken: 면의 높이는",
      "픽셀 서체(Galmuri11)는 숫자",
      "뒤 배경은 scrim 토큰",
      "그림자를 기본으로 쓰지 않는다",
      "반경은 2px(sm) 하나다",
      "퀘스트 카드: paper",
      "상태 변화는 120–180ms ease-out만 쓴다",
      "localStorage `gl:theme`",
      "이모지를 아이콘으로 쓰기",
      "아이콘 팩 `public/assets/icons/jrpg-v1/`",
    ]) {
      expect(DESIGN_MD).toContain(rule);
    }
  });
});
