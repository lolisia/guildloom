// @vitest-environment node
/**
 * Design-system tests: the pixel Icon, the theme module, the theme menu and the
 * shared UI atoms (including the compact 28px control and avatar density).
 *
 * This workspace keeps `jsdom` inside `apps/web/node_modules` while Vitest is
 * hoisted to the repository root, so the built-in `jsdom` environment cannot
 * resolve it. Like the other DOM tests we run in the Node environment and
 * install the same jsdom window before loading React Testing Library.
 *
 * jsdom has no `window.matchMedia`, so this file installs a controllable stub:
 * `setSystemDark` flips the OS preference and notifies subscribers, which is
 * exactly what `watchSystemTheme` listens for.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThemePreference } from "../src/lib/theme";

interface JsdomModule {
  JSDOM: new (
    markup?: string,
    options?: { url?: string },
  ) => { window: unknown };
}

const { JSDOM } = (await import("jsdom" as string)) as JsdomModule;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
const jsdomWindow = dom.window as unknown as Window & typeof globalThis;
const surface = globalThis as unknown as Record<string, unknown>;
const overriddenGlobals = new Set([
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
]);
const windowOnlyKeys = new Set(["window", "self", "top", "parent"]);

for (const key of Object.getOwnPropertyNames(jsdomWindow)) {
  if (windowOnlyKeys.has(key)) {
    continue;
  }
  if (key in surface && !overriddenGlobals.has(key)) {
    continue;
  }

  let value: unknown;
  try {
    value = (jsdomWindow as unknown as Record<string, unknown>)[key];
  } catch {
    continue;
  }

  const installed =
    typeof value === "function" && !/^[A-Z]/.test(key)
      ? (value as (...args: unknown[]) => unknown).bind(jsdomWindow)
      : value;

  Object.defineProperty(surface, key, {
    get: () => installed,
    set: (next: unknown) => {
      (jsdomWindow as unknown as Record<string, unknown>)[key] = next;
    },
    configurable: true,
  });
}

surface.window = surface;
surface.self = surface;
surface.top = surface;
surface.parent = surface;

// --- matchMedia stub -------------------------------------------------------
// jsdom 29 does not implement matchMedia; theme.ts explicitly guards for that,
// so tests install a minimal MediaQueryList that can be flipped on demand.

let systemDark = false;
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();

function createMediaQueryList(query: string): MediaQueryList {
  const list: MediaQueryList = {
    get matches() {
      return query === "(prefers-color-scheme: dark)" ? systemDark : false;
    },
    media: query,
    onchange: null,
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
    ) {
      if (type === "change" && typeof listener === "function") {
        mediaListeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    },
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
    ) {
      if (type === "change" && typeof listener === "function") {
        mediaListeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    },
    addListener(listener) {
      mediaListeners.add(listener as (event: MediaQueryListEvent) => void);
    },
    removeListener(listener) {
      mediaListeners.delete(listener as (event: MediaQueryListEvent) => void);
    },
    dispatchEvent() {
      return true;
    },
  };

  return list;
}

Object.defineProperty(surface, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string) => createMediaQueryList(query),
});

function setSystemDark(dark: boolean): void {
  systemDark = dark;
  for (const listener of [...mediaListeners]) {
    listener({ matches: dark, media: "(prefers-color-scheme: dark)" } as MediaQueryListEvent);
  }
}

const { cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const userEvent = (await import("@testing-library/user-event")).default;

const { default: Icon, iconSources } = await import("../src/components/Icon");
const { default: ThemeMenu } = await import("../src/components/ThemeMenu");
const { default: Button } = await import("../src/components/ui/Button");
const { default: Chip } = await import("../src/components/ui/Chip");
const { default: EmptyState } = await import("../src/components/ui/EmptyState");
const { default: Panel } = await import("../src/components/ui/Panel");
const { default: TextArea } = await import("../src/components/ui/TextArea");
const { default: TextInput } = await import("../src/components/ui/TextInput");
const { ko } = await import("../src/i18n/ko");
const theme = await import("../src/lib/theme");

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  systemDark = false;
  mediaListeners.clear();
});

afterEach(() => {
  cleanup();
});

describe("Icon", () => {
  it("renders the BASE_URL-prefixed 32px PNG with a 2x srcSet", () => {
    const view = render(<Icon name="board" />);
    const img = view.container.querySelector("img");

    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/assets/icons/jrpg-v1/32/board.png");
    expect(img?.getAttribute("srcSet")).toBe(
      "/assets/icons/jrpg-v1/32/board.png 1x, /assets/icons/jrpg-v1/64/board.png 2x",
    );
    expect(img).toHaveAttribute("width", "32");
    expect(img).toHaveAttribute("height", "32");
    expect(img).toHaveAttribute("draggable", "false");
    expect(img?.style.imageRendering).toBe("pixelated");
    expect(img?.style.filter).toBe("");
  });

  it("renders the 64px PNG at 1x when asked for the large size", () => {
    const view = render(<Icon name="rank-b" size={64} />);
    const img = view.container.querySelector("img");

    expect(img?.getAttribute("src")).toBe("/assets/icons/jrpg-v1/64/rank-b.png");
    expect(img?.getAttribute("srcSet")).toBe(
      "/assets/icons/jrpg-v1/64/rank-b.png 1x",
    );
    expect(img).toHaveAttribute("width", "64");
    expect(img).toHaveAttribute("height", "64");
    expect(img?.style.imageRendering).toBe("pixelated");
  });

  it("is decorative without a label and named with one", () => {
    const decorative = render(<Icon name="quest" />);
    const hiddenImage = decorative.container.querySelector("img");
    expect(hiddenImage).toHaveAttribute("alt", "");
    expect(hiddenImage).toHaveAttribute("aria-hidden", "true");
    expect(decorative.queryByRole("img")).toBeNull();
    decorative.unmount();

    const labelled = render(<Icon name="quest" label="의뢰" />);
    const namedImage = labelled.getByRole("img", { name: "의뢰" });
    expect(namedImage).toHaveAttribute("alt", "의뢰");
    expect(namedImage).not.toHaveAttribute("aria-hidden");
  });

  it("builds srcSet strings for both sizes", () => {
    expect(iconSources("guild", 32)).toEqual({
      src: "/assets/icons/jrpg-v1/32/guild.png",
      srcSet:
        "/assets/icons/jrpg-v1/32/guild.png 1x, /assets/icons/jrpg-v1/64/guild.png 2x",
    });
    expect(iconSources("guild", 64)).toEqual({
      src: "/assets/icons/jrpg-v1/64/guild.png",
      srcSet: "/assets/icons/jrpg-v1/64/guild.png 1x",
    });
  });
});

describe("theme module", () => {
  it("defaults to system when nothing is stored", () => {
    expect(theme.getThemePreference()).toBe("system");
  });

  it("persists an explicit preference and applies it immediately", () => {
    theme.setThemePreference("dark");
    expect(window.localStorage.getItem(theme.THEME_STORAGE_KEY)).toBe("dark");
    expect(theme.getThemePreference()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    theme.setThemePreference("light");
    expect(window.localStorage.getItem(theme.THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("treats unknown stored values as system", () => {
    window.localStorage.setItem(theme.THEME_STORAGE_KEY, "neon");

    expect(theme.getThemePreference()).toBe("system");
    theme.applyTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows matchMedia while the preference is system", () => {
    systemDark = true;
    theme.setThemePreference("system");
    expect(document.documentElement.dataset.theme).toBe("dark");

    systemDark = false;
    theme.applyTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("lists system, light and dark as the accepted preferences", () => {
    expect(theme.THEME_PREFERENCES).toEqual(["system", "light", "dark"]);
  });

  it("rejects an unknown preference instead of silently resetting", () => {
    expect(() =>
      theme.setThemePreference("neon" as unknown as ThemePreference),
    ).toThrow(TypeError);
  });

  it("degrades gracefully when matchMedia is missing", () => {
    const stub = (surface as { matchMedia?: unknown }).matchMedia;
    Reflect.deleteProperty(surface, "matchMedia");

    try {
      expect(theme.systemPrefersDark()).toBe(false);
      theme.applyTheme();
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(() => theme.watchSystemTheme()).not.toThrow();
    } finally {
      surface.matchMedia = stub;
    }
  });

  it("still applies a choice when localStorage is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(surface, "localStorage");
    Reflect.deleteProperty(surface, "localStorage");

    try {
      expect(theme.getThemePreference()).toBe("system");
      expect(() => theme.setThemePreference("dark")).not.toThrow();
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally {
      if (descriptor) {
        Object.defineProperty(surface, "localStorage", descriptor);
      }
    }
  });

  it("re-applies system changes until unsubscribed and never overrides a choice", () => {
    theme.setThemePreference("system");
    const unsubscribe = theme.watchSystemTheme();
    expect(mediaListeners.size).toBe(1);

    setSystemDark(true);
    expect(document.documentElement.dataset.theme).toBe("dark");

    theme.setThemePreference("light");
    setSystemDark(false);
    expect(document.documentElement.dataset.theme).toBe("light");

    setSystemDark(true);
    expect(document.documentElement.dataset.theme).toBe("light");

    unsubscribe();
    expect(mediaListeners.size).toBe(0);
  });
});

describe("ThemeMenu", () => {
  it("opens a radio menu, persists the choice and closes", async () => {
    const user = userEvent.setup();
    const view = render(<ThemeMenu />);
    const trigger = view.getByRole("button", { name: ko.theme.label });

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = view.getByRole("menu", { name: ko.theme.label });
    const options = within(menu).getAllByRole("menuitemradio");
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      ko.theme.system,
      ko.theme.light,
      ko.theme.dark,
    ]);
    expect(options[0]).toHaveAttribute("aria-checked", "true");

    await user.click(within(menu).getByRole("menuitemradio", { name: ko.theme.dark }));

    expect(window.localStorage.getItem(theme.THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(view.queryByRole("menu")).toBeNull();

    await user.click(trigger);
    const dark = view.getByRole("menuitemradio", { name: ko.theme.dark });
    expect(dark).toHaveAttribute("aria-checked", "true");
    expect(dark.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/32/success.png",
    );
  });

  it("closes on Escape and on an outside click", async () => {
    const user = userEvent.setup();
    const view = render(
      <>
        <ThemeMenu />
        <button type="button">바깥</button>
      </>,
    );
    const trigger = view.getByRole("button", { name: ko.theme.label });

    await user.click(trigger);
    expect(view.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(view.queryByRole("menu")).toBeNull();

    await user.click(trigger);
    expect(view.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(view.getByRole("button", { name: "바깥" }));
    expect(view.queryByRole("menu")).toBeNull();
  });
});

describe("density tokens", () => {
  it("sets the page body to 14px text on a 1.5 line height", () => {
    const css = readFileSync(
      new URL("../src/index.css", import.meta.url),
      "utf8",
    );
    const bodyBlock = /body\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";

    expect(bodyBlock).toContain("font-size: 14px");
    expect(bodyBlock).toContain("line-height: 1.5");
  });
});

describe("UI atoms", () => {
  it("Button defaults to type=button and the secondary variant", () => {
    const view = render(<Button>저장</Button>);
    const button = view.getByRole("button", { name: "저장" });

    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain("bg-paper");
    expect(button.className).toContain("text-ink");
    expect(button.className).toContain("border-line-strong");
    expect(button.className).toContain("h-7");
    expect(button.className).toContain("px-2.5");
    expect(button.className).toContain("text-[13px]");
    expect(button.className).not.toContain("shadow");
  });

  it("Button supports every variant and spreads native props", async () => {
    const onClick = vi.fn();
    const view = render(
      <>
        <Button variant="primary" type="submit" onClick={onClick}>
          등록
        </Button>
        <Button variant="danger">삭제</Button>
        <Button variant="ghost">취소</Button>
        <Button disabled>대기</Button>
      </>,
    );

    const primary = view.getByRole("button", { name: "등록" });
    expect(primary).toHaveAttribute("type", "submit");
    expect(primary.className).toContain("bg-ink");
    expect(primary.className).toContain("text-paper");
    await userEvent.setup().click(primary);
    expect(onClick).toHaveBeenCalledTimes(1);

    expect(view.getByRole("button", { name: "삭제" }).className).toContain(
      "border-brick",
    );
    expect(view.getByRole("button", { name: "삭제" }).className).toContain(
      "text-brick",
    );
    expect(view.getByRole("button", { name: "취소" }).className).toContain(
      "hover:bg-sunken",
    );
    expect(view.getByRole("button", { name: "대기" })).toBeDisabled();
  });

  it("Button never renders an icon, even when the legacy prop is passed", () => {
    const md = render(<Button icon="add">추가</Button>);
    expect(md.container.querySelector("img")).toBeNull();
    expect(md.getByRole("button", { name: "추가" }).className).toContain("h-7");
    md.unmount();

    const sm = render(
      <Button size="sm" icon="add">
        추가
      </Button>,
    );
    expect(sm.container.querySelector("img")).toBeNull();
    expect(sm.getByRole("button", { name: "추가" }).className).toContain("h-6");
  });

  it("TextInput forwards its ref and passes native props through", () => {
    let refValue: HTMLInputElement | null = null;
    const view = render(
      <TextInput
        ref={(element) => {
          refValue = element;
        }}
        id="title"
        name="title"
        value="의뢰"
        onChange={() => {}}
        placeholder="제목"
        maxLength={80}
        aria-invalid="true"
      />,
    );

    const input = view.getByPlaceholderText("제목") as HTMLInputElement;
    expect(refValue).toBe(input);
    expect(input).toHaveAttribute("id", "title");
    expect(input).toHaveAttribute("name", "title");
    expect(input).toHaveAttribute("maxlength", "80");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.className).toContain("bg-paper");
    expect(input.className).toContain("border-line-strong");
    expect(input.className).toContain("placeholder:text-muted");
    expect(input.className).toContain("h-7");
    expect(input.className).toContain("px-2");
    expect(input.className).toContain("text-[13px]");
  });

  it("TextArea forwards its ref, defaults to four rows and forwards props", () => {
    let refValue: HTMLTextAreaElement | null = null;
    const view = render(
      <TextArea
        ref={(element) => {
          refValue = element;
        }}
        aria-label="현재 상황"
        placeholder="지금 어떤 상황인가요?"
        autoFocus
      />,
    );

    const textarea = view.getByLabelText("현재 상황") as HTMLTextAreaElement;
    expect(refValue).toBe(textarea);
    expect(textarea).toHaveAttribute("rows", "4");
    expect(textarea).toHaveAttribute("placeholder", "지금 어떤 상황인가요?");
    expect(textarea.className).toContain("bg-paper");
    expect(textarea.className).toContain("border-line-strong");
    expect(textarea.className).toContain("text-[13px]");
    expect(textarea.className).not.toContain("h-7");
  });

  it("Chip keeps icons out and removes through a labelled text button", async () => {
    const onRemove = vi.fn();
    const view = render(
      <Chip onRemove={onRemove} removeLabel="태그 삭제: 버그">
        버그
      </Chip>,
    );

    const chip = view.container.querySelector(
      'span.border-line',
    ) as HTMLElement;
    expect(chip).toHaveTextContent("버그");
    expect(chip.className).toContain("border-line");
    expect(chip.className).toContain("text-muted");
    expect(chip.className).toContain("text-xs");
    expect(chip.querySelector("img")).toBeNull();

    const remove = view.getByRole("button", { name: "태그 삭제: 버그" });
    expect(remove).toHaveTextContent("×");
    await userEvent.setup().click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("Panel is a paper surface without a shadow", () => {
    const view = render(<Panel className="mt-2">내용</Panel>);
    const panel = view.getByText("내용").closest("section") as HTMLElement;

    expect(panel).not.toBeNull();
    expect(panel.className).toContain("bg-paper");
    expect(panel.className).toContain("border-line-strong");
    expect(panel.className).toContain("rounded-sm");
    expect(panel.className).toContain("mt-2");
    expect(panel.className).not.toContain("shadow");
  });

  it("EmptyState renders a 64px icon, one line of text and an action", () => {
    const view = render(
      <EmptyState
        icon="empty"
        text={ko.board.empty}
        action={<Button icon="add">새 의뢰</Button>}
      />,
    );

    expect(view.getByText(ko.board.empty)).toBeInTheDocument();
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/64/empty.png",
    );
    expect(view.getByRole("button", { name: "새 의뢰" })).toBeInTheDocument();
  });
});
