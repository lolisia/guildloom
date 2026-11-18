// @vitest-environment node
/**
 * The modal/drawer backdrop is the theme-aware `scrim` token, not an alpha
 * modifier on `ink`.
 *
 * `--color-ink` flips to cream (#EDE3CF) in the dark theme, so the old
 * `bg-ink/40` backdrop turned into a bright wash instead of dimming the page.
 * This file is the regression guard:
 *
 *  1. no source file may reintroduce a `bg-ink/<alpha>` utility (the four
 *     overlay call sites are pinned to plain `bg-scrim`);
 *  2. index.css must define `--color-scrim` in `@theme static` (light) and in
 *     `[data-theme="dark"]` (near-black), with the alpha baked into the token;
 *  3. DESIGN.md front matter must carry the very same two values so the design
 *     contract cannot drift from the code.
 */
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));
const INDEX_CSS = readFileSync(join(SRC_DIR, "index.css"), "utf8");
const DESIGN_MD = readFileSync(
  new URL("../DESIGN.md", import.meta.url),
  "utf8",
);

/** Light scrim: ink #1F2429 at 40%, painted over the light ground. */
const LIGHT_SCRIM = "rgb(31 36 41 / 0.40)";
/** Dark scrim: near-black at 60%, darker than the #191923 dark ground. */
const DARK_SCRIM = "rgb(8 8 12 / 0.60)";

/** Every `.ts`/`.tsx` file under `src/`, `node_modules` excluded. */
function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (
      extname(entry.name) === ".ts" ||
      extname(entry.name) === ".tsx"
    ) {
      files.push(path);
    }
  }
  return files;
}

const SOURCE_FILES = listSourceFiles(SRC_DIR);
const SOURCE_CACHE = new Map<string, string>();

function readSource(path: string): string {
  const cached = SOURCE_CACHE.get(path);
  if (cached !== undefined) {
    return cached;
  }
  const contents = readFileSync(path, "utf8");
  SOURCE_CACHE.set(path, contents);
  return contents;
}

/** Relative POSIX-style path, for readable failure messages. */
function relativeSourcePath(path: string): string {
  return relative(SRC_DIR, path).replaceAll("\\", "/");
}

// Same parsing approach as test/sprite.test.tsx: read the real token sheet.
function readCssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  return pattern.exec(INDEX_CSS)?.[1] ?? "";
}

function readCustomProperties(block: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) {
      properties.set(name, value.trim());
    }
  }
  return properties;
}

const THEME_TOKENS = readCustomProperties(readCssBlock("@theme static"));
const DARK_TOKENS = readCustomProperties(readCssBlock('[data-theme="dark"]'));

function token(theme: "light" | "dark", name: string): string {
  const value =
    theme === "dark"
      ? (DARK_TOKENS.get(name) ?? THEME_TOKENS.get(name))
      : THEME_TOKENS.get(name);
  if (value === undefined) {
    throw new Error(`index.css does not define ${name} for the ${theme} theme`);
  }
  return value;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex?.[1]) {
    const numeric = Number.parseInt(hex[1], 16);
    return {
      r: (numeric >> 16) & 0xff,
      g: (numeric >> 8) & 0xff,
      b: numeric & 0xff,
      a: 1,
    };
  }

  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/i.exec(
    value.trim(),
  );
  if (!rgb) {
    throw new Error(`unsupported colour value: ${value}`);
  }
  return {
    r: Number(rgb[1]),
    g: Number(rgb[2]),
    b: Number(rgb[3]),
    a: Number(rgb[4]),
  };
}

/** Alpha-composite a (possibly translucent) colour over an opaque background. */
function composite(foreground: Rgba, background: Rgba): Rgba {
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}

/** WCAG 2.1 relative luminance of an sRGB colour. */
function luminance(color: Rgba): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  );
}

interface DesignColors {
  light: Map<string, string>;
  dark: Map<string, string>;
}

/**
 * Read the `colors.light` / `colors.dark` maps out of the DESIGN.md YAML front
 * matter. The file is hand-written and only ever uses quoted values, so a tiny
 * indentation-aware reader is enough and avoids pulling in a YAML dependency.
 */
function readDesignColors(markdown: string): DesignColors {
  const frontMatter =
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1] ?? "";
  const colors: DesignColors = {
    light: new Map<string, string>(),
    dark: new Map<string, string>(),
  };
  let section: "light" | "dark" | null = null;

  for (const line of frontMatter.split(/\r?\n/)) {
    if (/^[A-Za-z][\w-]*:/.test(line)) {
      // A new top-level key closes the `colors` section.
      section = null;
      continue;
    }

    const themeLine = /^ {2}(light|dark):\s*$/.exec(line);
    if (themeLine?.[1]) {
      section = themeLine[1] as "light" | "dark";
      continue;
    }

    if (section === null) {
      continue;
    }

    const property = /^ {4}([\w-]+):\s*"([^"]*)"/.exec(line);
    if (property?.[1] && property[2] !== undefined) {
      colors[section].set(property[1], property[2]);
    }
  }

  return colors;
}

const DESIGN_COLORS = readDesignColors(DESIGN_MD);

describe("scrim token", () => {
  it("defines the light scrim in @theme static so bg-scrim is generated", () => {
    expect(THEME_TOKENS.get("--color-scrim")).toBe(LIGHT_SCRIM);
    // `@theme inline` would inline the value and break the dark override.
    expect(readCssBlock("@theme inline")).not.toContain("--color-scrim");
  });

  it("swaps to a near-black scrim for the dark theme", () => {
    expect(DARK_TOKENS.get("--color-scrim")).toBe(DARK_SCRIM);
  });

  it("keeps the light scrim ink-based at 40%", () => {
    const scrim = parseColor(token("light", "--color-scrim"));
    const ink = parseColor(token("light", "--color-ink"));

    expect(scrim.a).toBeCloseTo(0.4, 2);
    expect([scrim.r, scrim.g, scrim.b]).toEqual([ink.r, ink.g, ink.b]);
  });

  it("composites darker than the page ground in both themes", () => {
    const lightGround = parseColor(token("light", "--color-ground"));
    const darkGround = parseColor(token("dark", "--color-ground"));
    const light = composite(
      parseColor(token("light", "--color-scrim")),
      lightGround,
    );
    const dark = composite(
      parseColor(token("dark", "--color-scrim")),
      darkGround,
    );

    expect(luminance(light)).toBeLessThan(luminance(lightGround) * 0.75);
    expect(luminance(dark)).toBeLessThan(luminance(darkGround) * 0.75);
    // "거의 검정": the composited dark scrim stays a very dark grey.
    expect(Math.max(dark.r, dark.g, dark.b)).toBeLessThan(32);
  });
});

describe("scrim call sites", () => {
  it("never dims the page with a theme-inverted ink alpha", () => {
    const offenders = SOURCE_FILES.filter((file) =>
      readSource(file).includes("bg-ink/"),
    ).map(relativeSourcePath);

    expect(offenders).toEqual([]);
  });

  it("paints every modal/drawer overlay with plain bg-scrim", () => {
    const overlayCounts = [
      ["components/quest/QuestDrawer.tsx", 2], // drawer + archive confirm
      ["components/quest/ClearConfirmDialog.tsx", 1], // clear confirmation
      ["components/quest/UnclearConfirmDialog.tsx", 1], // clear revocation
      ["components/board/QuickAdd.tsx", 1], // bulk-paste confirm
      ["components/TabBar.tsx", 1], // create-guild dialog
      ["components/chat/MessageRow.tsx", 1], // delete-message confirm
      ["components/chat/CreateQuestFromMessageDialog.tsx", 1], // 의뢰로 만들기
    ] as const;

    let total = 0;
    for (const [file, expected] of overlayCounts) {
      const source = readSource(join(SRC_DIR, ...file.split("/")));
      const uses = source.match(/(?<![\w-])bg-scrim(?![\w/-])/g) ?? [];
      expect(uses, `${file} overlay count`).toHaveLength(expected);
      total += uses.length;
    }
    expect(total).toBe(8);
  });

  it("keeps the alpha inside the token instead of an opacity modifier", () => {
    const offenders = SOURCE_FILES.filter((file) =>
      /bg-scrim\//.test(readSource(file)),
    ).map(relativeSourcePath);

    expect(offenders).toEqual([]);
  });

  it("does not blur any backdrop (DESIGN.md forbids it)", () => {
    for (const file of [
      "components/quest/QuestDrawer.tsx",
      "components/board/QuickAdd.tsx",
      "components/TabBar.tsx",
      "components/chat/MessageRow.tsx",
      "components/chat/CreateQuestFromMessageDialog.tsx",
    ]) {
      expect(
        readSource(join(SRC_DIR, ...file.split("/"))),
        `${file} must not use backdrop-blur`,
      ).not.toContain("backdrop-blur");
    }
  });
});

describe("DESIGN.md scrim contract", () => {
  it("lists the same scrim values as index.css for light and dark", () => {
    expect(DESIGN_COLORS.light.get("scrim")).toBe(LIGHT_SCRIM);
    expect(DESIGN_COLORS.dark.get("scrim")).toBe(DARK_SCRIM);
    expect(DESIGN_COLORS.light.get("scrim")).toBe(
      THEME_TOKENS.get("--color-scrim"),
    );
    expect(DESIGN_COLORS.dark.get("scrim")).toBe(
      DARK_TOKENS.get("--color-scrim"),
    );
  });

  it("names the scrim token in Layout and forbids inverted backdrops", () => {
    expect(DESIGN_MD).toMatch(/뒤 배경은 scrim 토큰/);
    expect(DESIGN_MD).toMatch(/배경막에 ink 같은 테마 반전 색을 쓰지 않는다/);
  });
});
