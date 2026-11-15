import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkAvatarPalette,
  checkSource,
  checkTokens,
  run,
} from "./check-rules.mjs";

const WEB = "apps/web/src/x.tsx";
const SHARED = "packages/shared/src/x.ts";
const CSS = "apps/web/src/x.css";
const HTML = "apps/web/index.html";
const README = "README.md";
const TOKEN_FILE = "apps/web/src/index.css";
const AVATAR_FILE = "apps/web/src/components/AdventurerSprite.tsx";

const IME_MESSAGE =
  "한글 IME 조합 중 Enter가 제출되지 않도록 isImeComposing(event)를 확인하라 (apps/web/src/lib/ime.ts)";

/** Fixture paths are assembled from fragments so this file stays rule-11 clean. */
const WINDOWS_DEV_PATH = [
  "D:",
  "\\",
  "DEV",
  "\\",
  "guildloom",
  "\\",
  "notes.md",
].join("");
const WINDOWS_USERS_PATH = [
  "C:",
  "\\",
  "Use",
  "rs",
  "\\",
  "bob",
  "\\",
  "notes.md",
].join("");
const MACOS_PATH = ["/Use", "rs", "/", "alice", "/", "notes.md"].join("");
const GIT_BASH_PATH = ["/", "d", "/", "DEV", "/", "guildloom"].join("");

function violationsFor(file, text) {
  return checkSource(file, text);
}

function rulesFor(file, text) {
  return violationsFor(file, text).map((violation) => violation.rule);
}

function hasRule(file, text, rule) {
  return rulesFor(file, text).includes(rule);
}

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "guildloom-check-rules-"));
  const init = spawnSync("git", ["init", "-q"], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(init.status, 0, init.stderr);
  return dir;
}

test("checkSource selects rules by normalized path", () => {
  assert.deepEqual(checkSource("apps/web/src/x.test.tsx", 'const c = "rounded-full";'), []);
  assert.deepEqual(
    checkSource("apps/web/src/test/fixture.tsx", 'const c = "rounded-full";'),
    [],
  );
  assert.deepEqual(
    checkSource("apps/web/src/x.css", 'const c = "rounded-full";'),
    [],
  );
  assert.equal(
    hasRule("apps\\web\\src\\x.tsx", 'const c = "rounded-full";', "radius"),
    true,
  );
  assert.equal(
    checkSource("apps\\web\\src\\x.tsx", 'const c = "rounded-full";')[0].file,
    WEB,
  );
  assert.equal(
    hasRule("packages/shared/src/x.ts", 'const c = "rounded-full";', "radius"),
    false,
  );
});

test("the lexer does not treat JSX apostrophes as string openers", () => {
  const text = [
    "<p>Don't stop the party</p>",
    'const c = "rounded-full";',
  ].join("\n");
  assert.equal(hasRule(WEB, text, "radius"), true);
});

test("rule 1 ime-enter: an unguarded Enter comparison fails", () => {
  const violations = violationsFor(WEB, 'if (e.key === "Enter") submit();');
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0], {
    file: WEB,
    line: 1,
    rule: "ime-enter",
    message: IME_MESSAGE,
  });
});

test("rule 1 ime-enter: every comparison form is covered", () => {
  for (const comparison of [
    'if (e.key !== "Enter") return;',
    "if (e.key == 'Enter') return;",
    'if ("Enter" === e.key) return;',
  ]) {
    assert.equal(hasRule(WEB, comparison, "ime-enter"), true, comparison);
  }
});

test("rule 1 ime-enter: a guard on the same line passes", () => {
  assert.equal(
    hasRule(WEB, 'if (e.key === "Enter" && !isImeComposing(e)) submit();', "ime-enter"),
    false,
  );
});

test("rule 1 ime-enter: a guard within the next ten lines passes", () => {
  const guarded = [
    'if (e.key === "Enter") {',
    "  if (isImeComposing(e)) return;",
    "  submit();",
    "}",
  ].join("\n");
  assert.equal(hasRule(WEB, guarded, "ime-enter"), false);

  const farEnough = [
    'if (e.key === "Enter") {',
    ...Array.from({ length: 8 }, (_, index) => `  step${index}();`),
    "  if (isImeComposing(e)) return;",
    "  submit();",
    "}",
  ].join("\n");
  assert.equal(hasRule(WEB, farEnough, "ime-enter"), false);
});

test("rule 1 ime-enter: a guard beyond ten lines does not pass", () => {
  const tooLate = [
    'if (e.key === "Enter") {',
    ...Array.from({ length: 10 }, (_, index) => `  step${index}();`),
    "  if (isImeComposing(e)) return;",
    "  submit();",
    "}",
  ].join("\n");
  assert.equal(hasRule(WEB, tooLate, "ime-enter"), true);
});

test("rule 2 no-emoji: pictographs fail in web and shared source", () => {
  assert.equal(hasRule(WEB, 'const label = "🎉";', "no-emoji"), true);
  assert.equal(hasRule(SHARED, 'export const party = "🎉";', "no-emoji"), true);
});

test("rule 2 no-emoji: allowed marks and typographic symbols pass", () => {
  const text = 'const marks = "© ® ™ × · → …";';
  assert.equal(hasRule(WEB, text, "no-emoji"), false);
});

test("rule 3 no-default-palette: stock palette utilities fail", () => {
  assert.equal(hasRule(WEB, 'const c = "text-gray-500";', "no-default-palette"), true);
  assert.equal(hasRule(WEB, 'const c = "hover:bg-white/50";', "no-default-palette"), true);
  assert.equal(hasRule(WEB, 'const c = "border-red-500 ring-sky-300";', "no-default-palette"), true);
  assert.equal(
    hasRule(HTML, '<div class="text-gray-500"></div>', "no-default-palette"),
    true,
  );
  assert.equal(
    hasRule(HTML, "<div class='bg-black/50'></div>", "no-default-palette"),
    true,
  );
});

test("rule 3 no-default-palette: design tokens pass", () => {
  assert.equal(
    hasRule(WEB, 'const c = "text-teal bg-paper accent-teal border-line";', "no-default-palette"),
    false,
  );
  assert.equal(
    hasRule(HTML, '<div class="bg-paper text-ink text-gold-fill"></div>', "no-default-palette"),
    false,
  );
});

test("rule 4 no-gradient-blur: gradients and blur fail in web source and CSS", () => {
  assert.equal(
    hasRule(WEB, 'const c = "bg-gradient-to-r from-teal to-gold";', "no-gradient-blur"),
    true,
  );
  assert.equal(hasRule(WEB, 'const c = "backdrop-blur-sm";', "no-gradient-blur"), true);
  assert.equal(hasRule(WEB, 'const c = "blur-md";', "no-gradient-blur"), true);
  assert.equal(
    hasRule(CSS, ".panel { background: linear-gradient(red, blue); }", "no-gradient-blur"),
    true,
  );
  assert.equal(
    hasRule(CSS, ".panel { background: radial-gradient(red, blue); }", "no-gradient-blur"),
    true,
  );
  assert.equal(hasRule(CSS, ".panel { filter: blur(2px); }", "no-gradient-blur"), true);
});

test("rule 4 no-gradient-blur: flat surfaces and hard shadows pass", () => {
  assert.equal(hasRule(WEB, 'const c = "bg-paper shadow-hard";', "no-gradient-blur"), false);
  assert.equal(
    hasRule(CSS, ".panel { background: var(--color-paper); }", "no-gradient-blur"),
    false,
  );
});

test("rule 5 scrim-backdrop: bg-ink/40 fails and points at bg-scrim", () => {
  const violations = violationsFor(WEB, 'const c = "bg-ink/40";');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, "scrim-backdrop");
  assert.match(violations[0].message, /bg-scrim/);
  assert.equal(hasRule(WEB, 'const c = "hover:bg-black/50";', "scrim-backdrop"), true);
});

test("rule 5 scrim-backdrop: bg-scrim passes", () => {
  assert.equal(hasRule(WEB, 'const c = "bg-scrim";', "scrim-backdrop"), false);
});

test("rule 6 pixel-font-size: only 12/16/22px pass with font-pixel", () => {
  assert.equal(hasRule(WEB, 'const c = "font-pixel text-sm";', "pixel-font-size"), true);
  assert.equal(hasRule(WEB, 'const c = "font-pixel text-[14px]";', "pixel-font-size"), true);
  assert.equal(hasRule(WEB, 'const c = "font-pixel text-2xl";', "pixel-font-size"), true);
  assert.equal(
    hasRule(WEB, 'const c = "font-pixel text-[1.5rem]";', "pixel-font-size"),
    true,
  );
});

test("rule 6 pixel-font-size: allowed sizes and color utilities pass", () => {
  assert.equal(
    hasRule(WEB, 'const c = "font-pixel text-[12px] text-[16px] text-[22px]";', "pixel-font-size"),
    false,
  );
  assert.equal(
    hasRule(
      WEB,
      'const c = "font-pixel text-ink text-muted text-teal text-gold text-brick text-paper";',
      "pixel-font-size",
    ),
    false,
  );
  assert.equal(hasRule(WEB, 'const c = "text-sm";', "pixel-font-size"), false);
  assert.equal(hasRule(WEB, 'const c = "text-[14px]";', "pixel-font-size"), false);
  assert.equal(hasRule(WEB, 'const c = "font-pixel";', "pixel-font-size"), false);
});

test("rule 7 icon-size: sizes other than 32 or 64 fail", () => {
  assert.equal(
    hasRule(WEB, 'const el = <Icon name="add" size={48} />;', "icon-size"),
    true,
  );
  assert.equal(
    hasRule(WEB, 'const el = <Icon\n  name="add"\n  size={12}\n/>;', "icon-size"),
    true,
  );
});

test("rule 7 icon-size: 32, 64 and dynamic expressions pass", () => {
  const text = [
    'const a = <Icon name="add" size={32} />;',
    'const b = <Icon name="add" size={64} />;',
    'const c = <Icon name="add" size={size} />;',
    'const d = <Icon name="add" size={ICON_SIZE} />;',
  ].join("\n");
  assert.equal(hasRule(WEB, text, "icon-size"), false);
});

test("rule 8 radius: only rounded, rounded-sm and rounded-none pass", () => {
  for (const token of [
    "rounded-full",
    "rounded-md",
    "rounded-xl",
    "rounded-t-sm",
    "rounded-[6px]",
  ]) {
    assert.equal(hasRule(WEB, `const c = "${token}";`, "radius"), true, token);
  }
  assert.equal(
    hasRule(WEB, 'const c = "rounded rounded-sm rounded-none";', "radius"),
    false,
  );
});

test("rule 9 shadow: bare and non-token shadows fail", () => {
  for (const token of ["shadow", "shadow-md", "shadow-lg", "shadow-[4px_4px_0]"]) {
    assert.equal(hasRule(WEB, `const c = "${token}";`, "shadow"), true, token);
  }
  assert.equal(
    hasRule(WEB, 'const style = { boxShadow: "none" };', "shadow"),
    false,
  );
});

test("rule 9 shadow: shadow-hard and shadow-none pass", () => {
  assert.equal(hasRule(WEB, 'const c = "shadow-hard shadow-none";', "shadow"), false);
});

test("rule 10 no-uppercase: uppercase and wide tracking fail", () => {
  for (const token of [
    "uppercase",
    "tracking-wide",
    "tracking-wider",
    "tracking-widest",
  ]) {
    assert.equal(hasRule(WEB, `const c = "${token}";`, "no-uppercase"), true, token);
  }
});

test("rule 10 no-uppercase: normal case and tight tracking pass", () => {
  assert.equal(
    hasRule(WEB, 'const c = "normal-case tracking-tight tracking-normal";', "no-uppercase"),
    false,
  );
});

test("rule 11 no-local-path: local absolute paths fail in text files", () => {
  for (const sample of [
    WINDOWS_DEV_PATH,
    WINDOWS_USERS_PATH,
    MACOS_PATH,
    GIT_BASH_PATH,
  ]) {
    const violations = violationsFor(README, `see ${sample} for details`);
    const found = violations.find((violation) => violation.rule === "no-local-path");
    assert.notEqual(found, undefined, sample);
    assert.ok(found.message.includes(sample), found.message);
  }
});

test("rule 11 no-local-path: relative paths, other extensions and package-lock pass", () => {
  assert.equal(
    hasRule(README, "see apps/web/src/x.tsx for details", "no-local-path"),
    false,
  );
  assert.equal(hasRule("assets/x.png", WINDOWS_DEV_PATH, "no-local-path"), false);
  assert.equal(hasRule("package-lock.json", WINDOWS_DEV_PATH, "no-local-path"), false);
});

test("allow-reason: an empty reason fails and does not suppress", () => {
  const text = ["// rules-allow radius:", 'const c = "rounded-full";'].join("\n");
  const violations = violationsFor(WEB, text);
  const allowViolations = violations.filter(
    (violation) => violation.rule === "allow-reason",
  );
  assert.equal(allowViolations.length, 1);
  assert.equal(allowViolations[0].line, 1);
  assert.equal(violations.some((violation) => violation.rule === "radius"), true);
});

test("allow-reason: whitespace-only reasons fail too", () => {
  const text = ["// rules-allow shadow:   ", 'const c = "shadow-md";'].join("\n");
  assert.equal(hasRule(WEB, text, "allow-reason"), true);
  assert.equal(hasRule(WEB, text, "shadow"), true);
});

test("allow-reason: a same-line directive suppresses the matching rule", () => {
  const text = 'const c = "rounded-full"; // rules-allow radius: legacy spec import';
  assert.deepEqual(violationsFor(WEB, text), []);
});

test("allow-reason: a previous-line directive suppresses the matching rule", () => {
  const text = [
    "// rules-allow radius: legacy card corner",
    'const c = "rounded-full";',
  ].join("\n");
  assert.deepEqual(violationsFor(WEB, text), []);
});

test("allow-reason: /* */ directives work on the same and previous line", () => {
  const sameLine = 'const c = "rounded-full"; /* rules-allow radius: legacy */';
  assert.deepEqual(violationsFor(WEB, sameLine), []);
  const previousLine = [
    "/* rules-allow shadow: hard shadow is intentional */",
    'const c = "shadow-md";',
  ].join("\n");
  assert.deepEqual(violationsFor(WEB, previousLine), []);
});

test("allow-reason: {/* */} directives suppress", () => {
  const text = [
    "{/* rules-allow radius: pixel art card corners */}",
    'const c = "rounded-full";',
  ].join("\n");
  assert.deepEqual(violationsFor(WEB, text), []);
});

test("allow-reason: a directive for another rule does not suppress", () => {
  const text = [
    "// rules-allow shadow: this comment is about elevation",
    'const c = "rounded-full";',
  ].join("\n");
  assert.equal(hasRule(WEB, text, "radius"), true);
});

test("allow-reason: directive text inside a string is not a directive", () => {
  const text = [
    'const note = "// rules-allow radius: not a real directive";',
    'const c = "rounded-full";',
  ].join("\n");
  const violations = violationsFor(WEB, text);
  assert.equal(violations.some((violation) => violation.rule === "radius"), true);
  assert.equal(violations.some((violation) => violation.rule === "allow-reason"), false);
});

test("allow-reason: allow-reason itself cannot be suppressed", () => {
  const text = [
    "// rules-allow allow-reason: this rule is special",
    "// rules-allow radius:",
    'const c = "rounded-full";',
  ].join("\n");
  const violations = violationsFor(WEB, text);
  assert.equal(violations.some((violation) => violation.rule === "allow-reason"), true);
});

test("allow-reason: suppression reaches only the next line", () => {
  const text = [
    "// rules-allow radius: one-off",
    'const a = "rounded";',
    'const b = "rounded-full";',
  ].join("\n");
  assert.equal(hasRule(WEB, text, "radius"), true);
});

test("checkSource handles CRLF line endings", () => {
  const violations = violationsFor(WEB, 'const a = 1;\r\nconst c = "rounded-full";\r\n');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 2);
});

test("run reports violations in untracked working-tree files", () => {
  const dir = makeRepo();
  try {
    mkdirSync(path.join(dir, "apps", "web", "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "apps", "web", "src", "bad.tsx"),
      'const c = "rounded-full";\n',
      "utf8",
    );
    const violations = run(dir);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, "apps/web/src/bad.tsx");
    assert.equal(violations[0].line, 1);
    assert.equal(violations[0].rule, "radius");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run returns an empty list for a clean fixture", () => {
  const dir = makeRepo();
  try {
    mkdirSync(path.join(dir, "apps", "web", "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "apps", "web", "src", "good.tsx"),
      'const c = "rounded-sm shadow-hard";\n',
      "utf8",
    );
    assert.deepEqual(run(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI prints violations to stderr and exits 1", () => {
  const dir = makeRepo();
  try {
    mkdirSync(path.join(dir, "scripts"), { recursive: true });
    const script = fileURLToPath(new URL("./check-rules.mjs", import.meta.url));
    writeFileSync(
      path.join(dir, "scripts", "check-rules.mjs"),
      readFileSync(script, "utf8"),
      "utf8",
    );
    mkdirSync(path.join(dir, "apps", "web", "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "apps", "web", "src", "bad.tsx"),
      'const c = "rounded-full";\n',
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [path.join("scripts", "check-rules.mjs")],
      { cwd: dir, encoding: "utf8", windowsHide: true },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /apps\/web\/src\/bad\.tsx:1: \[radius\] /);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI prints the ok line and exits 0 on a clean checkout", () => {
  const dir = makeRepo();
  try {
    mkdirSync(path.join(dir, "scripts"), { recursive: true });
    const script = fileURLToPath(new URL("./check-rules.mjs", import.meta.url));
    writeFileSync(
      path.join(dir, "scripts", "check-rules.mjs"),
      readFileSync(script, "utf8"),
      "utf8",
    );
    mkdirSync(path.join(dir, "apps", "web", "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "apps", "web", "src", "good.tsx"),
      'const c = "rounded-sm shadow-hard";\n',
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [path.join("scripts", "check-rules.mjs")],
      { cwd: dir, encoding: "utf8", windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "check-rules: ok (2 files)");
    assert.equal(result.stderr, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the scanner and this test file have no rule-11 self violations", () => {
  for (const name of ["check-rules.mjs", "check-rules.test.mjs"]) {
    const filePath = fileURLToPath(new URL(name, import.meta.url));
    assert.deepEqual(checkSource(`scripts/${name}`, readFileSync(filePath, "utf8")), []);
  }
});

/** A token set whose every foreground clears 4.5:1 on every background. */
const PASSING_TOKENS = [
  "--color-paper: #FFFFFF;",
  "--color-ground: #FFFFFF;",
  "--color-sunken: #FFFFFF;",
  "--color-ink: #000000;",
  "--color-muted: #000000;",
  "--color-teal: #000000;",
  "--color-gold: #000000;",
  "--color-brick: #000000;",
];

/** Render a `header { declarations }` CSS block, one declaration per line. */
function cssBlock(header, declarations) {
  return [header, ...declarations.map((line) => `  ${line}`), "}"].join("\n");
}

test("rule 12 contrast: a palette clearing 4.5:1 has no violations", () => {
  assert.deepEqual(checkTokens(cssBlock("@theme static {", PASSING_TOKENS)), []);

  // rgb() tokens and declarations inside comments never join the palette.
  const css = [
    cssBlock("@theme static {", [
      "--color-scrim: rgb(31 36 41 / 0.40);",
      ...PASSING_TOKENS,
      "/* --color-teal: #777777; */",
    ]),
    "",
    cssBlock('[data-theme="dark"] {', ["--color-scrim: rgb(8 8 12 / 0.60);"]),
  ].join("\n");
  assert.deepEqual(checkTokens(css), []);
});

test("rule 12 contrast: a failing light pair reports the exact message and line", () => {
  const css = [
    cssBlock("@theme static {", [
      "--color-paper: #FFFFFF;", // 2
      "--color-ground: #FFFFFF;", // 3
      "--color-sunken: #FFFFFF;", // 4
      "--color-ink: #777777;", // 5
      "--color-muted: #000000;",
      "--color-teal: #000000;",
      "--color-gold: #000000;",
      "--color-brick: #000000;",
    ]),
    // Dark keeps a passing ink value so only the light theme fails.
    cssBlock('[data-theme="dark"] {', ["--color-ink: #000000;"]),
  ].join("\n");

  assert.deepEqual(checkTokens(css), [
    {
      file: TOKEN_FILE,
      line: 5,
      rule: "contrast",
      message: "contrast light ink/paper = 4.48 (< 4.5)",
    },
    {
      file: TOKEN_FILE,
      line: 5,
      rule: "contrast",
      message: "contrast light ink/ground = 4.48 (< 4.5)",
    },
    {
      file: TOKEN_FILE,
      line: 5,
      rule: "contrast",
      message: "contrast light ink/sunken = 4.48 (< 4.5)",
    },
  ]);
});

test("rule 12 contrast: a dark override can fail while light passes", () => {
  const css = [
    cssBlock("@theme static {", PASSING_TOKENS), // 1-10
    "", // 11
    cssBlock('[data-theme="dark"] {', ["--color-ink: #777777;"]), // 12-14
  ].join("\n");

  const violations = checkTokens(css);
  assert.deepEqual(
    violations.map((violation) => violation.message),
    [
      "contrast dark ink/paper = 4.48 (< 4.5)",
      "contrast dark ink/ground = 4.48 (< 4.5)",
      "contrast dark ink/sunken = 4.48 (< 4.5)",
    ],
  );
  for (const violation of violations) {
    assert.equal(violation.file, TOKEN_FILE);
    assert.equal(violation.line, 13);
    assert.equal(violation.rule, "contrast");
  }
});

test("rule 12 contrast: dark inherits light tokens it does not redefine", () => {
  const css = [
    cssBlock("@theme static {", [
      "--color-paper: #FFFFFF;", // 2
      "--color-ground: #FFFFFF;", // 3
      "--color-sunken: #FFFFFF;", // 4
      "--color-ink: #777777;", // 5
      "--color-muted: #000000;",
      "--color-teal: #000000;",
      "--color-gold: #000000;",
      "--color-brick: #000000;",
    ]),
    "",
    cssBlock('[data-theme="dark"] {', ["--color-brick: #000000;"]),
  ].join("\n");

  const dark = checkTokens(css).filter((violation) =>
    violation.message.startsWith("contrast dark "),
  );
  assert.deepEqual(
    dark.map((violation) => [violation.line, violation.message]),
    [
      [5, "contrast dark ink/paper = 4.48 (< 4.5)"],
      [5, "contrast dark ink/ground = 4.48 (< 4.5)"],
      [5, "contrast dark ink/sunken = 4.48 (< 4.5)"],
    ],
  );
});

test("rule 12 contrast: missing tokens are reported once per theme", () => {
  const css = cssBlock("@theme static {", [
    "--color-paper: #FFFFFF;",
    "--color-ground: #FFFFFF;",
    "--color-sunken: #FFFFFF;",
    "--color-ink: #000000;",
    "--color-muted: #000000;",
    "--color-gold: #000000;",
    "--color-brick: #000000;",
  ]);

  assert.deepEqual(checkTokens(css), [
    {
      file: TOKEN_FILE,
      line: 1,
      rule: "contrast",
      message: "missing token --color-teal (light)",
    },
    {
      file: TOKEN_FILE,
      line: 1,
      rule: "contrast",
      message: "missing token --color-teal (dark)",
    },
  ]);
});

test("rule 12 contrast: an absent theme block reports every required token", () => {
  const violations = checkTokens("");
  assert.equal(violations.length, 16);
  assert.ok(violations.every((violation) => violation.line === 1));
  assert.ok(
    violations.every((violation) =>
      violation.message.startsWith("missing token --color-"),
    ),
  );
  assert.equal(
    violations.filter((violation) => violation.message.endsWith("(light)"))
      .length,
    8,
  );
  assert.equal(
    violations.filter((violation) => violation.message.endsWith("(dark)"))
      .length,
    8,
  );
});

test("rule 13 avatar-contrast: a low-contrast entry reports the exact message", () => {
  const text = [
    'export const AVATAR_INITIAL_COLOR = "#ffffff";', // 1
    "", // 2
    "export const AVATAR_COLORS = [", // 3
    '  "#000000",', // 4
    '  "#777777",', // 5
    "] as const;", // 6
  ].join("\n");

  assert.deepEqual(checkAvatarPalette(text), [
    {
      file: AVATAR_FILE,
      line: 5,
      rule: "avatar-contrast",
      message: "avatar contrast #777777/#ffffff = 4.48 (< 4.5)",
    },
  ]);
});

test("rule 13 avatar-contrast: entries at or above 4.5:1 pass", () => {
  const text = [
    'export const AVATAR_INITIAL_COLOR = "#ffffff";',
    "",
    "export const AVATAR_COLORS = [",
    '  "#000000",',
    '  "#767676",', // 4.54:1
    "] as const;",
  ].join("\n");

  assert.deepEqual(checkAvatarPalette(text), []);
});

test("rule 13 avatar-contrast: a missing initial or palette is reported", () => {
  const noInitial = [
    "export const AVATAR_COLORS = [",
    '  "#000000",',
    "] as const;",
  ].join("\n");
  const initialViolations = checkAvatarPalette(noInitial);
  assert.equal(initialViolations.length, 1);
  assert.equal(initialViolations[0].file, AVATAR_FILE);
  assert.equal(initialViolations[0].line, 1);
  assert.equal(initialViolations[0].rule, "avatar-contrast");
  assert.match(initialViolations[0].message, /missing AVATAR_INITIAL_COLOR/);

  const noPalette = 'export const AVATAR_INITIAL_COLOR = "#ffffff";';
  const paletteViolations = checkAvatarPalette(noPalette);
  assert.equal(paletteViolations.length, 1);
  assert.equal(paletteViolations[0].line, 1);
  assert.equal(paletteViolations[0].rule, "avatar-contrast");
  assert.match(paletteViolations[0].message, /missing AVATAR_COLORS/);

  const emptyPalette = [
    'export const AVATAR_INITIAL_COLOR = "#ffffff";',
    "export const AVATAR_COLORS = [] as const;",
  ].join("\n");
  const emptyViolations = checkAvatarPalette(emptyPalette);
  assert.equal(emptyViolations.length, 1);
  assert.match(emptyViolations[0].message, /missing AVATAR_COLORS/);
});

test("the real index.css and AdventurerSprite palette pass both rules", () => {
  const css = readFileSync(
    new URL("../apps/web/src/index.css", import.meta.url),
    "utf8",
  );
  assert.deepEqual(checkTokens(css), []);

  const sprite = readFileSync(
    new URL("../apps/web/src/components/AdventurerSprite.tsx", import.meta.url),
    "utf8",
  );
  assert.deepEqual(checkAvatarPalette(sprite), []);
});

test("run appends rules 12-13 for the fixed palette files", () => {
  const dir = makeRepo();
  try {
    const src = path.join(dir, "apps", "web", "src");
    mkdirSync(path.join(src, "components"), { recursive: true });
    writeFileSync(
      path.join(src, "index.css"),
      [
        cssBlock("@theme static {", [
          "--color-paper: #FFFFFF;",
          "--color-ground: #FFFFFF;",
          "--color-sunken: #FFFFFF;",
          "--color-ink: #777777;",
          "--color-muted: #000000;",
          "--color-teal: #000000;",
          "--color-gold: #000000;",
          "--color-brick: #000000;",
        ]),
        // Dark overrides ink so only the light theme fails.
        cssBlock('[data-theme="dark"] {', ["--color-ink: #000000;"]),
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      path.join(src, "components", "AdventurerSprite.tsx"),
      [
        'export const AVATAR_INITIAL_COLOR = "#ffffff";',
        "",
        "export const AVATAR_COLORS = [",
        '  "#777777",',
        "] as const;",
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(run(dir), [
      {
        file: AVATAR_FILE,
        line: 4,
        rule: "avatar-contrast",
        message: "avatar contrast #777777/#ffffff = 4.48 (< 4.5)",
      },
      {
        file: TOKEN_FILE,
        line: 5,
        rule: "contrast",
        message: "contrast light ink/paper = 4.48 (< 4.5)",
      },
      {
        file: TOKEN_FILE,
        line: 5,
        rule: "contrast",
        message: "contrast light ink/ground = 4.48 (< 4.5)",
      },
      {
        file: TOKEN_FILE,
        line: 5,
        rule: "contrast",
        message: "contrast light ink/sunken = 4.48 (< 4.5)",
      },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
