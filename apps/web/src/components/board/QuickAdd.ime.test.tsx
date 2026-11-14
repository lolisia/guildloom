// @vitest-environment node
/**
 * Quick add IME guard: the Enter that confirms a Korean composition must not
 * post the quest, while the following normal Enter posts it exactly once.
 *
 * Chrome/Edge/Safari sometimes report that composition Enter as `keyCode` 229
 * only, so both signals are covered.
 *
 * DOM setup mirrors `bulk-paste.test.tsx`: Node environment plus a local jsdom
 * window because Vitest (hoisted) cannot resolve the workspace-local `jsdom`.
 */
import type { Quest } from "@guildloom/shared";
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

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const { QuickAdd } = await import("./QuickAdd");
const { ko } = await import("../../i18n/ko");

// `screen` snapshots `document.body` when Testing Library loads, which happens
// before this file installs its jsdom window; bind the queries ourselves.
const screen = within(document.body);

const NOW = Date.now();

/** Minimal quest returned by the mocked create endpoint. */
const CREATED_QUEST: Quest = {
  id: 2,
  number: 2,
  title: "인게임",
  stage: "board",
  rank: null,
  orderKey: "a1",
  tags: [],
  createdBy: { id: 1, displayName: "김모험" },
  createdAt: NOW,
  updatedAt: NOW,
  projectId: 1,
  situation: "",
  direction: "",
  archiveReason: null,
};

interface MockReply {
  status?: number;
  body?: unknown;
}

type MockHandler = (url: URL, init: RequestInit) => MockReply | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function stubFetch(handler: MockHandler) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://localhost");
      const reply = handler(url, init);
      if (!reply) {
        return jsonResponse(
          { error: { code: "not_found", message: "not found" } },
          404,
        );
      }
      return jsonResponse(reply.body, reply.status ?? 200);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type FetchMock = ReturnType<typeof stubFetch>;

/** POSTs made to the project's create-quest endpoint. */
function createPostCalls(fetchMock: FetchMock) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = new URL(String(input), "http://localhost");
    return (
      url.pathname === "/api/projects/1/quests" &&
      (init?.method ?? "GET").toUpperCase() === "POST"
    );
  });
}

/** Answer the create endpoint with a minimal quest; 404 for everything else. */
function createQuestHandler(url: URL, init: RequestInit): MockReply | undefined {
  if (
    (init.method ?? "GET").toUpperCase() === "POST" &&
    url.pathname === "/api/projects/1/quests"
  ) {
    return { status: 201, body: CREATED_QUEST };
  }
  return undefined;
}

function renderQuickAdd() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <QuickAdd projectId={1} />
    </QueryClientProvider>,
  );

  return { ...view, queryClient };
}

/** Let queued microtasks run so a submission would have reached `fetch`. */
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * Dispatch the native keydown Chrome/Edge/Safari send for the Enter that
 * confirms an IME candidate. `keyCode` is a legacy read-only property that
 * Testing Library's synthetic initializer may drop, so define it directly.
 */
function dispatchCompositionEnterKeyCode229(input: HTMLElement) {
  const event = new jsdomWindow.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "keyCode", {
    configurable: true,
    value: 229,
  });
  fireEvent(input, event);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("QuickAdd IME guard", () => {
  it("posts nothing on a composition Enter and once on the following Enter", async () => {
    const fetchMock = stubFetch(createQuestHandler);
    const { queryClient } = renderQuickAdd();

    const input = screen.getByRole("textbox", {
      name: ko.board.newQuest,
    }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "인게임" } });
    expect(input).toHaveValue("인게임");

    const notCanceled = fireEvent.keyDown(input, {
      key: "Enter",
      isComposing: true,
    });

    // The handler still cancels the implicit form submit.
    expect(notCanceled).toBe(false);

    await settle();

    expect(input).toHaveValue("인게임");
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(createPostCalls(fetchMock)).toHaveLength(0);

    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });

    await waitFor(() => expect(createPostCalls(fetchMock)).toHaveLength(1));
    const [createCall] = createPostCalls(fetchMock);
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      title: "인게임",
    });

    await waitFor(() => expect(input).toHaveValue(""));
    expect(createPostCalls(fetchMock)).toHaveLength(1);
  });

  it("ignores the keyCode 229 variant of the composition Enter", async () => {
    const fetchMock = stubFetch(createQuestHandler);
    const { queryClient } = renderQuickAdd();

    const input = screen.getByRole("textbox", {
      name: ko.board.newQuest,
    }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "인게임" } });
    dispatchCompositionEnterKeyCode229(input);

    await settle();

    expect(input).toHaveValue("인게임");
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(createPostCalls(fetchMock)).toHaveLength(0);

    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });

    await waitFor(() => expect(createPostCalls(fetchMock)).toHaveLength(1));
    const [createCall] = createPostCalls(fetchMock);
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      title: "인게임",
    });
  });
});
