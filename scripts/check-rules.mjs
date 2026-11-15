#!/usr/bin/env node
/**
 * guildloom design-rule scanner.
 *
 * Dependency-free on purpose: this file may only use Node builtins so it can
 * run in `scripts/verify.sh` without an install step. `checkSource` is the pure
 * entry point for the per-file source rules (used by the test file and future
 * tooling); `checkTokens` and `checkAvatarPalette` add the palette rules that
 * span a file's design values; `run` collects the files a git checkout exposes
 * and checks each one. Running this file directly
 * prints every violation as `path:line: [rule-id] message` on stderr and exits
 * 1, or prints `check-rules: ok (N files)` and exits 0.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Extensions that may contain a local absolute path (rule 11). */
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
  ".sh",
  ".yml",
  ".yaml",
  ".sql",
]);

/** Message shown for a `rules-allow` directive without a reason. */
const ALLOW_REASON_MESSAGE = "rules-allow에는 비어 있지 않은 이유를 적어라";

const RULE_MESSAGES = {
  "ime-enter":
    "한글 IME 조합 중 Enter가 제출되지 않도록 isImeComposing(event)를 확인하라 (apps/web/src/lib/ime.ts)",
  "no-emoji": "use <Icon name=.../> instead",
  "no-default-palette": "Tailwind 기본 팔레트 대신 디자인 토큰을 사용하라",
  "no-gradient-blur": "그라디언트·블러 효과 대신 스크림과 하드 섀도를 사용하라",
  "scrim-backdrop": "use bg-scrim",
  "pixel-font-size":
    "픽셀 폰트 크기는 text-[12px], text-[16px], text-[22px]만 허용한다",
  "icon-size": "아이콘 size는 32 또는 64만 허용한다",
  radius: "rounded, rounded-sm, rounded-none만 허용한다",
  shadow: "shadow-hard, shadow-none만 허용한다",
  "no-uppercase": "uppercase와 tracking-wide/wider/widest를 사용하지 마라",
  "no-local-path": "local absolute path is not allowed",
  "allow-reason": ALLOW_REASON_MESSAGE,
};

/** `key === "Enter"` style comparisons, in both operand orders. */
const ENTER_COMPARISON_RE = /\bkey\s*(?:===|!==|==|!=)\s*(["'])Enter\1/;
const ENTER_COMPARISON_REVERSED_RE =
  /(["'])Enter\1\s*(?:===|!==|==|!=)\s*(?:[A-Za-z_$][\w$]*\s*\??\.\s*)?key\b/;

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
/** Extended_Pictographic but intentionally allowed in text. */
const ALLOWED_PICTOGRAPHS = new Set(["©", "®", "™"]);

const CLASS_PREFIX =
  "bg|text|border|ring|fill|stroke|from|via|to|outline|divide|accent|caret|decoration|shadow";
const TAILWIND_COLORS =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

const DEFAULT_PALETTE_RE = new RegExp(
  `^(?:${CLASS_PREFIX})-(?:${TAILWIND_COLORS})-\\d{2,3}(?:/\\S+)?$`,
);
const MONO_PALETTE_RE = new RegExp(
  `^(?:${CLASS_PREFIX})-(?:white|black)(?:/\\S+)?$`,
);

const GRADIENT_BLUR_PATTERNS = [
  "bg-gradient-",
  "bg-linear-",
  "bg-radial-",
  "linear-gradient(",
  "radial-gradient(",
  "backdrop-blur",
  "blur-",
  "filter: blur",
];
const FILTER_BLUR_RE = /filter:\s*blur/;

const SCRIM_BACKDROP_RE = /^bg-(?:ink|black)\/\d+(?:\.\d+)?$/;

const PIXEL_FONT_TOKEN = "font-pixel";
const PIXEL_NAMED_SIZE_RE = /^text-(?:xs|sm|base|lg|xl|[2-9]xl)$/;
const PIXEL_ARBITRARY_SIZE_RE = /^text-\[([^\]]+)\](?:\/\S+)?$/;
const CSS_LENGTH_RE =
  /^\d+(?:\.\d+)?(?:px|rem|em|pt|ex|ch|vw|vh|vmin|vmax)$/;
const PIXEL_ALLOWED_ARBITRARY_SIZES = new Set([
  "text-[12px]",
  "text-[16px]",
  "text-[22px]",
]);

const ICON_TAG_RE = /<Icon\b/g;
const ICON_SIZE_RE = /\bsize\s*=\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}/g;

const PIXEL_RADIUS_ALLOWED = new Set([
  "rounded",
  "rounded-sm",
  "rounded-none",
]);
const SHADOW_ALLOWED = new Set(["shadow-hard", "shadow-none"]);
const UPPERCASE_TOKENS = new Set([
  "uppercase",
  "tracking-wide",
  "tracking-wider",
  "tracking-widest",
]);

const DIRECTIVE_RE = /^rules-allow\s+([a-z][a-z0-9-]*)\s*:\s*(.*)$/;

/**
 * Local absolute paths that must never be committed. The slash-heavy patterns
 * are regex literals so this file does not itself trip rule 11.
 */
const LOCAL_PATH_RES = [
  /[A-Za-z]:[\\/](?:Users|DEV)[\\/][^\s"'`<>]*/g,
  /\/[a-z]\/DEV\/[^\s"'`<>]*/g,
  /\/Users\/[^/]+\/[^\s"'`<>]*/g,
];

/** Files that own the palette values checked by rules 12-13. */
const TOKEN_CSS_FILE = "apps/web/src/index.css";
const AVATAR_SPRITE_FILE = "apps/web/src/components/AdventurerSprite.tsx";

/** WCAG 2.x AA minimum contrast for normal text. */
const MIN_CONTRAST_RATIO = 4.5;

/** Foreground/background design tokens paired by the contrast rule. */
const CONTRAST_FOREGROUND_TOKENS = ["ink", "muted", "teal", "gold", "brick"];
const CONTRAST_BACKGROUND_TOKENS = ["paper", "ground", "sunken"];

/** Light token block (`@theme static`) and dark override block. */
const THEME_BLOCK_RE = /@theme\b[^{]*\{/;
const DARK_THEME_BLOCK_RE = /\[data-theme\s*=\s*["']?dark["']?\]\s*\{/;

/** `AVATAR_INITIAL_COLOR = "#RRGGBB"` and `AVATAR_COLORS = [ ... ] as const`. */
const AVATAR_INITIAL_RE =
  /AVATAR_INITIAL_COLOR\s*=\s*["'](#[0-9a-fA-F]{6})["']/;
const AVATAR_COLORS_RE = /AVATAR_COLORS\s*=\s*\[/;

/** Normalize a path to forward slashes and remove a leading `./`. */
function normalizePath(filePath) {
  const normalized = String(filePath).replace(/\\/g, "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function basename(file) {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? file : file.slice(slash + 1);
}

/** Whether rule 11 must scan this file. */
function isTextFile(file) {
  const name = basename(file);
  if (name === "package-lock.json") return false;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function isWebSource(file) {
  if (!/^apps\/web\/src\/.+\.(?:ts|tsx)$/.test(file)) return false;
  if (/\.test\.(?:ts|tsx)$/.test(file)) return false;
  return !file.split("/").includes("test");
}

function isSharedSource(file) {
  return /^packages\/shared\/src\/.+\.ts$/.test(file);
}

function isCssSource(file) {
  return /^apps\/web\/src\/.+\.css$/.test(file);
}

function isHtmlSource(file) {
  return file === "apps/web/index.html";
}

/** Number of newlines inside `text` before `index`. */
function lineOffset(text, index) {
  let total = 0;
  const limit = Math.min(index, text.length);
  for (let i = 0; i < limit; i += 1) {
    if (text.charCodeAt(i) === 10) total += 1;
  }
  return total;
}

/** 1-based line number of `index` inside `text`. */
function lineAt(text, index) {
  return lineOffset(text, index) + 1;
}

function countNewlines(text) {
  return lineOffset(text, text.length);
}

/** Split on whitespace while keeping each token's offset. */
function splitTokens(content) {
  const tokens = [];
  const matcher = /\S+/g;
  let match;
  while ((match = matcher.exec(content)) !== null) {
    tokens.push({ value: match[0], index: match.index });
  }
  return tokens;
}

/** Strip Tailwind variant prefixes and important markers. */
function stripVariants(token) {
  const colon = token.lastIndexOf(":");
  let value = colon === -1 ? token : token.slice(colon + 1);
  if (value.startsWith("!")) value = value.slice(1);
  if (value.endsWith("!")) value = value.slice(0, -1);
  return value;
}

/** Closing offset of a single-line string, or -1 when the quote is stray. */
function findStringEnd(text, start, quote) {
  let j = start + 1;
  while (j < text.length) {
    const current = text[j];
    if (current === "\\") {
      j += 2;
      continue;
    }
    if (current === "\n") return -1;
    if (current === quote) return j;
    j += 1;
  }
  return -1;
}

/**
 * Lex JS/TS/TSX enough to find string literals and comments.
 *
 * Template literals are treated as one string (including `${...}`), which is
 * sufficient for class scanning and keeps line numbers correct. A quote with no
 * closing partner on the same line is treated as plain text so apostrophes in
 * JSX copy (e.g. `Don't`) do not swallow the rest of the file.
 */
function lexJs(text) {
  const strings = [];
  const comments = [];
  let i = 0;
  let line = 1;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i + 2);
      const stop = end === -1 ? text.length : end;
      comments.push({ line, text: text.slice(i + 2, stop) });
      i = stop;
      continue;
    }

    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end;
      const body = text.slice(i + 2, stop);
      let bodyLine = line;
      for (const piece of body.split("\n")) {
        comments.push({ line: bodyLine, text: piece.replace(/\r$/, "") });
        bodyLine += 1;
      }
      const after = end === -1 ? text.length : stop + 2;
      line += countNewlines(text.slice(i, after));
      i = after;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      if (ch !== "`" && findStringEnd(text, i, ch) === -1) {
        i += 1;
        continue;
      }
      const startLine = line;
      let j = i + 1;
      let content = "";
      let closed = false;
      while (j < text.length) {
        const current = text[j];
        if (current === "\\") {
          const escaped = text[j + 1];
          if (escaped === "\n") line += 1;
          content += escaped === undefined ? current : current + escaped;
          j += escaped === undefined ? 1 : 2;
          continue;
        }
        if (current === ch) {
          closed = true;
          break;
        }
        if (current === "\n") line += 1;
        content += current;
        j += 1;
      }
      strings.push({ line: startLine, content });
      i = closed ? j + 1 : j;
      continue;
    }

    if (ch === "\n") line += 1;
    i += 1;
  }

  return { strings, comments };
}

/** Lex CSS comments (their text feeds allow directives). */
function lexCss(text) {
  const comments = [];
  let i = 0;
  let line = 1;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end;
      const body = text.slice(i + 2, stop);
      let bodyLine = line;
      for (const piece of body.split("\n")) {
        comments.push({ line: bodyLine, text: piece.replace(/\r$/, "") });
        bodyLine += 1;
      }
      const after = end === -1 ? text.length : stop + 2;
      line += countNewlines(text.slice(i, after));
      i = after;
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (findStringEnd(text, i, ch) === -1) {
        i += 1;
        continue;
      }
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === ch) {
          j += 1;
          break;
        }
        if (text[j] === "\n") line += 1;
        j += 1;
      }
      i = j;
      continue;
    }

    if (ch === "\n") line += 1;
    i += 1;
  }

  return { comments };
}

/** Lex an HTML file: comments become directives, class values become tokens. */
function lexHtml(text) {
  const comments = [];
  const maskedRanges = [];
  let i = 0;
  let line = 1;

  while (i < text.length) {
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      const stop = end === -1 ? text.length : end;
      const body = text.slice(i + 4, stop);
      let bodyLine = line;
      for (const piece of body.split("\n")) {
        comments.push({ line: bodyLine, text: piece.replace(/\r$/, "") });
        bodyLine += 1;
      }
      const after = end === -1 ? text.length : stop + 3;
      line += countNewlines(text.slice(i, after));
      maskedRanges.push([i, after]);
      i = after;
      continue;
    }

    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end;
      const body = text.slice(i + 2, stop);
      let bodyLine = line;
      for (const piece of body.split("\n")) {
        comments.push({ line: bodyLine, text: piece.replace(/\r$/, "") });
        bodyLine += 1;
      }
      const after = end === -1 ? text.length : stop + 2;
      line += countNewlines(text.slice(i, after));
      maskedRanges.push([i, after]);
      i = after;
      continue;
    }

    if (text[i] === "\n") line += 1;
    i += 1;
  }

  const maskedChars = text.split("");
  for (const [start, end] of maskedRanges) {
    for (let j = start; j < end; j += 1) {
      if (maskedChars[j] !== "\n" && maskedChars[j] !== "\r") {
        maskedChars[j] = " ";
      }
    }
  }
  const masked = maskedChars.join("");

  const classTokens = [];
  const attributeRe = /\b(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attributeRe.exec(masked)) !== null) {
    const value = match[1] ?? match[2] ?? "";
    const quoteIndex = match[0].search(/["']/);
    const valueStart = match.index + quoteIndex + 1;
    const valueLine = lineAt(masked, valueStart);
    for (const token of splitTokens(value)) {
      classTokens.push({
        value: stripVariants(token.value),
        line: valueLine + lineOffset(value, token.index),
      });
    }
  }

  return { comments, classTokens };
}

/** Parse `rules-allow <rule>: <reason>` lines out of comments. */
function parseDirectives(comments) {
  const directives = [];
  for (const comment of comments) {
    const text = comment.text.replace(/^\s*\*?\s*/, "").trimEnd();
    const match = DIRECTIVE_RE.exec(text);
    if (match === null) continue;
    directives.push({
      line: comment.line,
      rule: match[1],
      reason: match[2].trim(),
    });
  }
  return directives;
}

/** Class tokens (variant-stripped) from every string literal in the file. */
function classTokensFromStrings(strings) {
  const tokens = [];
  for (const string of strings) {
    for (const token of splitTokens(string.content)) {
      tokens.push({
        value: stripVariants(token.value),
        line: string.line + lineOffset(string.content, token.index),
      });
    }
  }
  return tokens;
}

/** First gradient/blur offset on one line of text, or -1. */
function gradientBlurIndex(text) {
  let index = -1;
  for (const pattern of GRADIENT_BLUR_PATTERNS) {
    const found = text.indexOf(pattern);
    if (found !== -1 && (index === -1 || found < index)) index = found;
  }
  const match = FILTER_BLUR_RE.exec(text);
  if (match !== null && (index === -1 || match.index < index)) {
    index = match.index;
  }
  return index;
}

/** End offset of a JSX tag (the `>`), or -1 when malformed. */
function findTagEnd(source, start) {
  let quote = null;
  let braces = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      braces += 1;
      continue;
    }
    if (ch === "}") {
      if (braces > 0) braces -= 1;
      continue;
    }
    if (ch === ">" && braces === 0) return i;
    if (ch === "<" && braces === 0) return -1;
  }
  return -1;
}

function compareViolations(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.rule === b.rule) return 0;
  return a.rule < b.rule ? -1 : 1;
}

/**
 * Check one file in memory.
 *
 * @param {string} filePath path relative to the repository root (either slash
 *   style is accepted; the returned `file` always uses `/`).
 * @param {string} text file contents.
 * @returns {{file: string, line: number, rule: string, message: string}[]}
 */
export function checkSource(filePath, text) {
  const file = normalizePath(filePath);
  const source = String(text ?? "");
  const lines = source.split(/\r?\n/);

  const web = isWebSource(file);
  const shared = isSharedSource(file);
  const css = isCssSource(file);
  const html = isHtmlSource(file);

  const violations = [];
  const push = (line, rule, message = RULE_MESSAGES[rule]) => {
    violations.push({ file, line, rule, message });
  };

  let directives = [];
  let strings = [];
  let classTokens = [];

  if (web || shared) {
    const lexed = lexJs(source);
    directives = parseDirectives(lexed.comments);
    strings = lexed.strings;
    classTokens = classTokensFromStrings(strings);
  } else if (css) {
    directives = parseDirectives(lexCss(source).comments);
  } else if (html) {
    const lexed = lexHtml(source);
    directives = parseDirectives(lexed.comments);
    classTokens = lexed.classTokens;
  }

  // Rule 1: Enter key handling must be IME aware.
  if (web) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (
        !ENTER_COMPARISON_RE.test(line) &&
        !ENTER_COMPARISON_REVERSED_RE.test(line)
      ) {
        continue;
      }
      const window = lines.slice(index, index + 11).join("\n");
      if (window.includes("isImeComposing(")) continue;
      push(index + 1, "ime-enter");
    }
  }

  // Rule 2: no emoji anywhere in web/shared source.
  if (web || shared) {
    for (let index = 0; index < lines.length; index += 1) {
      const matches = lines[index].match(EMOJI_RE);
      if (matches === null) continue;
      if (matches.some((char) => !ALLOWED_PICTOGRAPHS.has(char))) {
        push(index + 1, "no-emoji");
      }
    }
  }

  // Rule 3: no stock Tailwind palette utilities.
  if (web || html) {
    for (const token of classTokens) {
      if (
        DEFAULT_PALETTE_RE.test(token.value) ||
        MONO_PALETTE_RE.test(token.value)
      ) {
        push(token.line, "no-default-palette");
      }
    }
  }

  // Rule 4: no gradients or blur. TS scans string tokens; CSS scans raw text.
  if (web) {
    for (const string of strings) {
      const segments = string.content.split("\n");
      for (let index = 0; index < segments.length; index += 1) {
        if (gradientBlurIndex(segments[index]) !== -1) {
          push(string.line + index, "no-gradient-blur");
        }
      }
    }
  } else if (css) {
    for (let index = 0; index < lines.length; index += 1) {
      if (gradientBlurIndex(lines[index]) !== -1) {
        push(index + 1, "no-gradient-blur");
      }
    }
  }

  // Rule 5: `bg-ink/40` and `bg-black/50` are not backdrops.
  if (web) {
    for (const token of classTokens) {
      if (SCRIM_BACKDROP_RE.test(token.value)) {
        push(token.line, "scrim-backdrop");
      }
    }
  }

  // Rule 6: pixel font sizes are limited to 12/16/22px.
  if (web) {
    for (const string of strings) {
      const tokens = splitTokens(string.content).map((token) => ({
        value: stripVariants(token.value),
        line: string.line + lineOffset(string.content, token.index),
      }));
      if (!tokens.some((token) => token.value === PIXEL_FONT_TOKEN)) continue;
      for (const token of tokens) {
        const value = token.value;
        if (PIXEL_NAMED_SIZE_RE.test(value)) {
          push(token.line, "pixel-font-size");
          continue;
        }
        const arbitrary = PIXEL_ARBITRARY_SIZE_RE.exec(value);
        if (arbitrary === null) continue;
        const rawInner = arbitrary[1];
        const inner = rawInner.startsWith("length:")
          ? rawInner.slice("length:".length)
          : rawInner;
        const isLength =
          CSS_LENGTH_RE.test(inner) ||
          /^(?:clamp|calc|min|max)\(/.test(inner);
        if (!isLength) continue;
        if (!PIXEL_ALLOWED_ARBITRARY_SIZES.has(`text-[${inner}]`)) {
          push(token.line, "pixel-font-size");
        }
      }
    }
  }

  // Rule 7: <Icon size={N}> only accepts 32 or 64.
  if (web) {
    let match;
    ICON_TAG_RE.lastIndex = 0;
    while ((match = ICON_TAG_RE.exec(source)) !== null) {
      const tagEnd = findTagEnd(source, match.index + match[0].length);
      if (tagEnd === -1) continue;
      const tag = source.slice(match.index, tagEnd + 1);
      let sizeMatch;
      ICON_SIZE_RE.lastIndex = 0;
      while ((sizeMatch = ICON_SIZE_RE.exec(tag)) !== null) {
        const size = Number(sizeMatch[1]);
        if (size !== 32 && size !== 64) {
          push(
            lineAt(source, match.index + sizeMatch.index),
            "icon-size",
          );
        }
      }
      ICON_TAG_RE.lastIndex = tagEnd + 1;
    }
  }

  // Rules 8-10: radius, shadow and typography tokens.
  if (web) {
    for (const token of classTokens) {
      const value = token.value;

      if (
        !PIXEL_RADIUS_ALLOWED.has(value) &&
        /^rounded(?:-|$)/.test(value)
      ) {
        push(token.line, "radius");
      }

      if (
        !SHADOW_ALLOWED.has(value) &&
        (value === "shadow" || value.startsWith("shadow-"))
      ) {
        push(token.line, "shadow");
      }

      if (UPPERCASE_TOKENS.has(value)) {
        push(token.line, "no-uppercase");
      }
    }
  }

  // Rule 11: local absolute paths, in every text file.
  if (isTextFile(file)) {
    for (let index = 0; index < lines.length; index += 1) {
      for (const matcher of LOCAL_PATH_RES) {
        matcher.lastIndex = 0;
        let match;
        while ((match = matcher.exec(lines[index])) !== null) {
          push(
            index + 1,
            "no-local-path",
            `local absolute path is not allowed: ${match[0]}`,
          );
        }
      }
    }
  }

  // `rules-allow` directives without a reason are violations of their own.
  for (const directive of directives) {
    if (directive.reason.length === 0) {
      push(directive.line, "allow-reason", ALLOW_REASON_MESSAGE);
    }
  }

  // A non-empty directive suppresses matching rules on its line and the next.
  const activeDirectives = directives.filter(
    (directive) => directive.reason.length > 0,
  );
  const kept = violations.filter((violation) => {
    if (violation.rule === "allow-reason") return true;
    return !activeDirectives.some(
      (directive) =>
        directive.rule === violation.rule &&
        (directive.line === violation.line ||
          directive.line === violation.line - 1),
    );
  });

  return kept.sort(compareViolations);
}

/** Blank out CSS comments, preserving every offset and line break. */
function maskCssComments(text) {
  const chars = text.split("");
  let i = 0;
  while (i < text.length) {
    if (text[i] === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let j = i; j < stop; j += 1) {
        if (chars[j] !== "\n" && chars[j] !== "\r") chars[j] = " ";
      }
      i = stop;
      continue;
    }
    i += 1;
  }
  return chars.join("");
}

/**
 * Inner offset range of the first `{ ... }` block whose header matches
 * `header`, or `null` when that block is absent.
 */
function cssBlockRange(masked, header) {
  const match = header.exec(masked);
  if (match === null) return null;
  const open = match.index + match[0].lastIndexOf("{");
  let depth = 0;
  for (let index = open; index < masked.length; index += 1) {
    const ch = masked[index];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { start: open + 1, end: index };
    }
  }
  return { start: open + 1, end: masked.length };
}

/** `--color-<name>: #RRGGBB` declarations inside `[start, end)`. */
function parseColorTokens(masked, start, end) {
  const tokens = new Map();
  const matcher =
    /--color-([A-Za-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})(?![0-9a-fA-F])/g;
  matcher.lastIndex = start;
  let match;
  while ((match = matcher.exec(masked)) !== null) {
    if (match.index >= end) break;
    tokens.set(match[1], {
      hex: match[2],
      line: lineAt(masked, match.index),
    });
  }
  return tokens;
}

/** Dark tokens layered over light ones; anything dark omits is inherited. */
function tokensForTheme(lightTokens, darkTokens, theme) {
  if (theme !== "dark") return lightTokens;
  const merged = new Map(lightTokens);
  for (const [name, token] of darkTokens) merged.set(name, token);
  return merged;
}

/** WCAG 2.x linearisation of one 0-255 sRGB channel. */
function linearizeChannel(value) {
  const channel = value / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of a `#RRGGBB` colour. */
function relativeLuminance(hex) {
  const digits = hex.slice(1);
  const red = Number.parseInt(digits.slice(0, 2), 16);
  const green = Number.parseInt(digits.slice(2, 4), 16);
  const blue = Number.parseInt(digits.slice(4, 6), 16);
  return (
    0.2126 * linearizeChannel(red) +
    0.7152 * linearizeChannel(green) +
    0.0722 * linearizeChannel(blue)
  );
}

/** WCAG 2.x contrast ratio between two `#RRGGBB` colours. */
function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** `X.XX (< 4.5)` suffix shared by the contrast failure messages. */
function contrastSuffix(ratio) {
  return `${ratio.toFixed(2)} (< ${MIN_CONTRAST_RATIO})`;
}

/** Offset of the `]` matching the `[` at `open`, or -1 when unterminated. */
function findBracketEnd(text, open) {
  let depth = 0;
  let quote = null;
  for (let index = open; index < text.length; index += 1) {
    const ch = text[index];
    if (quote !== null) {
      if (ch === "\\") {
        index += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Check design-token contrast (rule 12) in `apps/web/src/index.css`.
 *
 * The light `@theme static` block defines the palette and
 * `[data-theme="dark"]` overrides it; a dark theme inherits every token it
 * does not redefine. Each theme must clear WCAG 2.x AA (4.5:1) for every
 * foreground token on every background token. `rgb(...)` declarations such as
 * `--color-scrim` are intentionally not part of the pairs.
 *
 * @param {string} cssText contents of `apps/web/src/index.css`.
 * @returns {{file: string, line: number, rule: string, message: string}[]}
 */
export function checkTokens(cssText) {
  const masked = maskCssComments(String(cssText ?? ""));
  const lightRange = cssBlockRange(masked, THEME_BLOCK_RE);
  const darkRange = cssBlockRange(masked, DARK_THEME_BLOCK_RE);
  const lightTokens =
    lightRange === null
      ? new Map()
      : parseColorTokens(masked, lightRange.start, lightRange.end);
  const darkTokens =
    darkRange === null
      ? new Map()
      : parseColorTokens(masked, darkRange.start, darkRange.end);

  const violations = [];
  const push = (line, message) => {
    violations.push({ file: TOKEN_CSS_FILE, line, rule: "contrast", message });
  };

  for (const theme of ["light", "dark"]) {
    const tokens = tokensForTheme(lightTokens, darkTokens, theme);

    for (const name of [
      ...CONTRAST_FOREGROUND_TOKENS,
      ...CONTRAST_BACKGROUND_TOKENS,
    ]) {
      if (!tokens.has(name)) {
        push(1, `missing token --color-${name} (${theme})`);
      }
    }

    for (const foreground of CONTRAST_FOREGROUND_TOKENS) {
      const foregroundToken = tokens.get(foreground);
      if (foregroundToken === undefined) continue;
      for (const background of CONTRAST_BACKGROUND_TOKENS) {
        const backgroundToken = tokens.get(background);
        if (backgroundToken === undefined) continue;
        const ratio = contrastRatio(foregroundToken.hex, backgroundToken.hex);
        if (ratio >= MIN_CONTRAST_RATIO) continue;
        push(
          foregroundToken.line,
          `contrast ${theme} ${foreground}/${background} = ${contrastSuffix(ratio)}`,
        );
      }
    }
  }

  return violations.sort(compareViolations);
}

/**
 * Check the avatar palette (rule 13) in
 * `apps/web/src/components/AdventurerSprite.tsx`.
 *
 * Every 6-digit hex of the `AVATAR_COLORS = [ ... ] as const` array is a
 * background for the theme-independent `AVATAR_INITIAL_COLOR` initial, so each
 * pair must clear WCAG 2.x AA (4.5:1).
 *
 * @param {string} tsText contents of the sprite component.
 * @returns {{file: string, line: number, rule: string, message: string}[]}
 */
export function checkAvatarPalette(tsText) {
  const source = String(tsText ?? "");
  const violations = [];
  const push = (line, message) => {
    violations.push({
      file: AVATAR_SPRITE_FILE,
      line,
      rule: "avatar-contrast",
      message,
    });
  };

  const initialMatch = AVATAR_INITIAL_RE.exec(source);
  const header = AVATAR_COLORS_RE.exec(source);
  const open = header === null ? -1 : header.index + header[0].lastIndexOf("[");
  const close = open === -1 ? -1 : findBracketEnd(source, open);

  const entries = [];
  if (close !== -1) {
    const matcher = /#[0-9a-fA-F]{6}(?![0-9a-fA-F])/g;
    matcher.lastIndex = open + 1;
    let match;
    while ((match = matcher.exec(source)) !== null) {
      if (match.index >= close) break;
      entries.push({ hex: match[0], line: lineAt(source, match.index) });
    }
  }

  if (initialMatch === null) push(1, "missing AVATAR_INITIAL_COLOR");
  if (entries.length === 0) push(1, "missing AVATAR_COLORS");
  if (initialMatch === null) return violations.sort(compareViolations);

  const initial = initialMatch[1];
  for (const entry of entries) {
    const ratio = contrastRatio(entry.hex, initial);
    if (ratio >= MIN_CONTRAST_RATIO) continue;
    push(
      entry.line,
      `avatar contrast ${entry.hex}/${initial} = ${contrastSuffix(ratio)}`,
    );
  }

  return violations.sort(compareViolations);
}

/** Read a repository-relative file, or `null` when it is not present. */
function readRepoFile(root, file) {
  try {
    return readFileSync(path.join(root, file), "utf8");
  } catch {
    return null;
  }
}

/** List the repository files a git checkout exposes (NUL-safe). */
function listFiles(rootDir) {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ls-files failed in ${rootDir}: ${result.stderr || result.status}`,
    );
  }
  return result.stdout
    .split("\0")
    .filter((entry) => entry.length > 0)
    .map(normalizePath);
}

/**
 * Check every inspectable text file below `rootDir`.
 *
 * @returns {{file: string, line: number, rule: string, message: string}[]}
 */
export function run(rootDir) {
  const root = path.resolve(rootDir);
  const violations = [];

  for (const file of listFiles(root)) {
    if (!isTextFile(file)) continue;
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    violations.push(...checkSource(file, text));
  }

  // Rules 12-13 own two fixed files rather than matching a source-rule path;
  // read them directly so they are checked even for a partial checkout.
  const cssText = readRepoFile(root, TOKEN_CSS_FILE);
  if (cssText !== null) violations.push(...checkTokens(cssText));

  const spriteText = readRepoFile(root, AVATAR_SPRITE_FILE);
  if (spriteText !== null) violations.push(...checkAvatarPalette(spriteText));

  return violations.sort(compareViolations);
}

const invokedPath = process.argv[1];
const isMain =
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href;

if (isMain) {
  const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const violations = run(rootDir);

  if (violations.length > 0) {
    for (const violation of violations) {
      process.stderr.write(
        `${violation.file}:${violation.line}: [${violation.rule}] ${violation.message}\n`,
      );
    }
    process.exitCode = 1;
  } else {
    const inspected = listFiles(rootDir).filter(isTextFile).length;
    process.stdout.write(`check-rules: ok (${inspected} files)\n`);
  }
}
