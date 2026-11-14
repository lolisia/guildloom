// @vitest-environment node
/**
 * AdventurerSprite renders a deterministic placeholder avatar. The props
 * interface is frozen for M1, so these tests pin the render contract:
 * first-character label, stable hashed colour, default `idle` state and the
 * rule that state changes must only touch `data-state`.
 *
 * Why the explicit JSDOM bootstrap instead of `@vitest-environment jsdom`?
 * This workspace installs `jsdom` as a dev dependency of `@guildloom/web`, but
 * npm keeps it under `apps/web/node_modules` while Vitest itself is hoisted to
 * the repository root. Vitest's built-in jsdom environment imports `jsdom`
 * relative to the hoisted package, so it cannot see the workspace copy. We run
 * this file in the Node environment and install the very same jsdom window
 * before loading React Testing Library, which keeps the test hermetic (no
 * server, no network) and exercises the real DOM implementation.
 */
import { afterEach, describe, expect, it } from "vitest";

import AdventurerSprite, {
  avatarColorForUserId,
  avatarInitial,
} from "../src/components/AdventurerSprite";

// jsdom 29 ships without type declarations and `@types/jsdom` is not part of
// the M1 dependency set, so import it through an untyped expression (the
// runtime specifier is still the literal "jsdom").
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
  // Keep Node's own globals (fetch, URL, TextEncoder, …) but replace the ones
  // React and Testing Library expect from a browser window.
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

const { cleanup, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});

describe("AdventurerSprite", () => {
  it("renders the first character of the display name", () => {
    const { container } = render(
      <AdventurerSprite userId={7} displayName="김모험" />,
    );

    const sprite = container.querySelector('[data-user-id="7"]');
    expect(sprite).not.toBeNull();
    expect(sprite).toHaveTextContent("김");
    expect(sprite).toHaveAccessibleName("김모험");
  });

  it("defaults to the idle state and the small size", () => {
    const { container } = render(
      <AdventurerSprite userId={11} displayName="아린" />,
    );

    const sprite = container.querySelector(
      '[data-user-id="11"]',
    ) as HTMLElement;
    expect(sprite).toHaveAttribute("data-state", "idle");
    expect(sprite.className).toContain("h-8");
    expect(sprite.className).toContain("w-8");
  });

  it("changes only data-state when the sprite state changes", () => {
    const { container, rerender } = render(
      <AdventurerSprite userId={3} displayName="루나" />,
    );

    const before = container.querySelector(
      '[data-user-id="3"]',
    ) as HTMLElement;
    const textBefore = before.textContent;
    const classBefore = before.className;
    const styleBefore = before.getAttribute("style");

    rerender(
      <AdventurerSprite userId={3} displayName="루나" state="attack" />,
    );

    const after = container.querySelector('[data-user-id="3"]') as HTMLElement;
    expect(after).toHaveAttribute("data-state", "attack");
    expect(after).toHaveAttribute("data-user-id", "3");
    expect(after.textContent).toBe(textBefore);
    expect(after.className).toBe(classBefore);
    expect(after.getAttribute("style")).toBe(styleBefore);
  });

  it("supports every adventurer state through data-state", () => {
    const states = ["idle", "walk", "attack", "hurt", "victory"] as const;

    for (const state of states) {
      const { container, unmount } = render(
        <AdventurerSprite userId={5} displayName="테스" state={state} />,
      );
      const sprite = container.querySelector(
        '[data-user-id="5"]',
      ) as HTMLElement;
      expect(sprite).toHaveAttribute("data-state", state);
      unmount();
    }
  });

  it("derives a stable background colour from the user id", () => {
    const { container, unmount } = render(
      <AdventurerSprite userId={42} displayName="모험" />,
    );
    const firstColor = (
      container.querySelector('[data-user-id="42"]') as HTMLElement
    ).style.backgroundColor;
    unmount();

    const second = render(
      <AdventurerSprite userId={42} displayName="다른이름" />,
    );
    const secondColor = (
      second.container.querySelector('[data-user-id="42"]') as HTMLElement
    ).style.backgroundColor;

    expect(firstColor).not.toBe("");
    expect(firstColor).toBe(secondColor);
    expect(avatarColorForUserId(42)).toBe(avatarColorForUserId(42));
    expect(avatarColorForUserId(42)).toMatch(/^#[0-9a-f]{6}$/);
    expect(avatarColorForUserId(42)).not.toBe(avatarColorForUserId(43));
  });

  it("uses the lazily-sized variant for md and lg", () => {
    const { container, rerender } = render(
      <AdventurerSprite userId={9} displayName="큰모험" size="lg" />,
    );
    const lg = container.querySelector('[data-user-id="9"]') as HTMLElement;
    expect(lg.className).toContain("h-14");

    rerender(<AdventurerSprite userId={9} displayName="큰모험" size="md" />);
    const md = container.querySelector('[data-user-id="9"]') as HTMLElement;
    expect(md.className).toContain("h-10");
  });

  it("keeps unicode code points intact and falls back for empty names", () => {
    expect(avatarInitial("🐉드래곤")).toBe("🐉");
    expect(avatarInitial("  김모험  ")).toBe("김");
    expect(avatarInitial("   ")).toBe("?");

    const { container } = render(
      <AdventurerSprite userId={1} displayName="   " />,
    );
    expect(container.querySelector('[data-user-id="1"]')).toHaveTextContent(
      "?",
    );
  });
});
