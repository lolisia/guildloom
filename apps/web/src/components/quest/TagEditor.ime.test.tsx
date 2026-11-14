// @vitest-environment node
/**
 * TagEditor IME guard: the Enter that confirms an IME candidate must not add
 * the half-composed query, while the next plain Enter still adds exactly once.
 *
 * As in the other DOM tests, jsdom is installed manually because Vitest cannot
 * resolve the workspace-local copy from the hoisted runner.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

const { cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const { TagEditor } = await import("./TagEditor");
const { ko } = await import("../../i18n/ko");

// Testing Library's `screen` is bound before the jsdom window exists; bind the
// queries to the freshly created document body instead.
const screen = within(document.body);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Mock the autocomplete request with an empty project tag list. */
function stubTagFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/projects/1/tags") {
      return jsonResponse([]);
    }
    return jsonResponse(
      { error: { code: "not_found", message: "not found" } },
      404,
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderTagEditor(onChange: (next: string[]) => void) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <TagEditor projectId={1} tags={[]} onChange={onChange} />
    </QueryClientProvider>,
  );

  return screen.getByRole("textbox", { name: ko.quest.tagAdd });
}

/**
 * Dispatch a native keyboard event with `keyCode === 229`, the legacy signal
 * Chrome/Edge/Safari send for the Enter that confirms an IME candidate.
 * `KeyboardEventInit` has no `keyCode`, so define it on the instance.
 */
function fireKeyCode229(element: HTMLElement) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "keyCode", {
    configurable: true,
    get: () => 229,
  });
  fireEvent(element, event);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TagEditor IME composition", () => {
  it("ignores the composition Enter and adds the tag on the next Enter", () => {
    stubTagFetch();
    const onChange = vi.fn();
    const input = renderTagEditor(onChange);

    fireEvent.change(input, { target: { value: "인게임" } });
    expect(input).toHaveValue("인게임");

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("인게임");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["인게임"]);
    expect(input).toHaveValue("");
  });

  it("ignores the keyCode 229 fallback and still adds on a plain Enter", () => {
    stubTagFetch();
    const onChange = vi.fn();
    const input = renderTagEditor(onChange);

    fireEvent.change(input, { target: { value: "인게임" } });

    fireKeyCode229(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("인게임");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["인게임"]);
    expect(input).toHaveValue("");
  });

  it("adds once after compositionstart, Enter and compositionend", () => {
    stubTagFetch();
    const onChange = vi.fn();
    const input = renderTagEditor(onChange);

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "인게임" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["인게임"]);
    expect(input).toHaveValue("");
  });
});
