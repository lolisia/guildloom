// @vitest-environment node
/**
 * Ledger row IME guard: the Enter that confirms an IME candidate (Korean,
 * Japanese, Chinese, …) must not open the quest drawer, while a plain Enter on
 * the same focused row still opens the shared `?quest=<id>` drawer.
 *
 * As in the other DOM tests, jsdom is installed manually because Vitest cannot
 * resolve the workspace-local copy from the hoisted runner.
 */
import type { Quest, QuestSummary } from "@guildloom/shared";
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

const { cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { MemoryRouter, Route, Routes, useLocation } = await import(
  "react-router-dom"
);
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const { default: LedgerPage } = await import("./LedgerPage");
const { ko } = await import("../i18n/ko");

// Testing Library's `screen` is bound before the jsdom window exists; bind the
// queries to the freshly created document body instead.
const screen = within(document.body);

const SUMMARY: QuestSummary = {
  id: 1,
  number: 1,
  title: "Alpha",
  stage: "board",
  rank: null,
  orderKey: "a0",
  tags: [],
  createdBy: { id: 1, displayName: "김모험" },
  createdAt: Date.UTC(2026, 0, 2, 3, 0, 0),
  updatedAt: Date.UTC(2026, 0, 4, 3, 0, 0),
  party: [],
  floors: { done: 0, total: 0 },
  pendingNominations: 0,
  bounty: { base: 40, multiplier: 1, total: 40, days: 0, dusty: false },
};

const QUEST: Quest = {
  ...SUMMARY,
  projectId: 1,
  situation: "상황",
  direction: "방향",
  archiveReason: null,
  party: [
    {
      user: { id: 1, displayName: "김모험" },
      role: "leader",
      status: "done",
      retreatReason: null,
      joinedAt: Date.UTC(2026, 0, 2, 3, 0, 0),
    },
  ],
  nominations: [],
  floors: [
    {
      id: 1,
      title: "1층: 상황",
      orderKey: "a0",
      doneAt: Date.UTC(2026, 0, 4, 3, 0, 0),
      doneBy: { id: 1, displayName: "김모험" },
    },
  ],
  firstClaimedAt: Date.UTC(2026, 0, 2, 3, 0, 0),
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

function defaultHandler(): MockHandler {
  return (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET" && url.pathname === "/api/projects/1/quests") {
      return { body: [SUMMARY] };
    }
    if (method === "GET" && url.pathname === "/api/projects/1/tags") {
      return { body: [] };
    }
    if (method === "GET" && url.pathname === "/api/quests/1") {
      return { body: QUEST };
    }
    if (method === "GET" && url.pathname === "/api/quests/1/events") {
      return { body: [] };
    }
    return undefined;
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

function renderLedger() {
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

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/g/1/ledger"]}>
        <Routes>
          <Route path="/g/:projectId/ledger" element={<LedgerPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Fire the Enter that confirms an IME candidate.
 *
 * React exposes the DOM event as `nativeEvent`, so `isComposing` is the signal
 * the guard reads first. Chrome/Edge/Safari also report the confirming Enter as
 * `keyCode === 229`, so the event carries both signals like a real browser
 * composition Enter does.
 */
function fireCompositionEnter(row: HTMLElement) {
  fireEvent.keyDown(row, {
    key: "Enter",
    isComposing: true,
    keyCode: 229,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LedgerPage IME Enter handling", () => {
  it("ignores a composition Enter and opens the drawer on a normal Enter", async () => {
    const fetchMock = stubFetch(defaultHandler());
    const { container } = renderLedger();

    await screen.findByText("Alpha");

    const row = container.querySelector<HTMLTableRowElement>(
      'tr[data-quest-id="1"]',
    );
    expect(row).not.toBeNull();
    row!.focus();
    expect(row).toHaveFocus();

    fireCompositionEnter(row!);

    // The composition Enter must neither navigate nor mount the drawer.
    expect(screen.getByTestId("location")).toHaveTextContent("/g/1/ledger");
    expect(screen.getByTestId("location")).not.toHaveTextContent("quest=1");
    expect(
      screen.queryByRole("dialog", { name: ko.board.drawer.title }),
    ).not.toBeInTheDocument();
    const detailCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === "/api/quests/1";
    });
    expect(detailCalls).toHaveLength(0);

    // A plain Enter on the same row opens the shared drawer.
    fireEvent.keyDown(row!, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("?quest=1"),
    );
    expect(
      await screen.findByRole("dialog", { name: ko.board.drawer.title }),
    ).toBeInTheDocument();
  });
});
