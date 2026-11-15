// @vitest-environment node
/**
 * Bulk-paste quick add: a two-line paste must not touch the input until the
 * adventurer confirms "N건을 의뢰로 등록할까요?", then POST the trimmed titles to
 * `/quests/bulk`. Cancelling leaves the input unchanged.
 *
 * DOM setup mirrors `shell.test.tsx`: Node environment plus a local jsdom
 * window because Vitest (hoisted) cannot resolve the workspace-local `jsdom`.
 */
import type { QuestSummary } from "@guildloom/shared";
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
const userEvent = (await import("@testing-library/user-event")).default;
const { MemoryRouter, Route, Routes } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const { default: BoardPage } = await import("../src/routes/BoardPage");
const { ko } = await import("../src/i18n/ko");

// `screen` snapshots `document.body` when Testing Library loads, which happens
// before this file installs its jsdom window; bind the queries ourselves.
const screen = within(document.body);

const NOW = Date.now();

const QUESTS: QuestSummary[] = [
  {
    id: 1,
    number: 1,
    title: "기존 의뢰",
    stage: "board",
    kind: "fix",
    rank: null,
    orderKey: "a0",
    tags: [],
    createdBy: { id: 1, displayName: "김모험" },
    createdAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    party: [],
    floors: { done: 0, total: 0 },
    pendingNominations: 0,
    bounty: { base: 40, multiplier: 1, total: 40, days: 0, dusty: false },
  },
];

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

function boardHandler(): MockHandler {
  return (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET" && url.pathname === "/api/projects/1/quests") {
      return { body: QUESTS };
    }
    if (method === "GET" && url.pathname === "/api/projects/1/tags") {
      return { body: [] };
    }
    return undefined;
  };
}

function renderBoard() {
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
      <MemoryRouter initialEntries={["/g/1"]}>
        <Routes>
          <Route path="/g/:projectId" element={<BoardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, queryClient, user: userEvent.setup() };
}

/** Paste helper: jsdom has no DataTransfer, so provide `getData` directly. */
function pasteText(input: HTMLElement, text: string) {
  fireEvent.paste(input, {
    clipboardData: { getData: () => text },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("quick add bulk paste", () => {
  it("asks for confirmation and posts both trimmed titles", async () => {
    const fetchMock = stubFetch((url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "POST" && url.pathname === "/api/projects/1/quests/bulk") {
        return { status: 201, body: [] };
      }
      return boardHandler()(url, init);
    });

    const { user } = renderBoard();
    await screen.findByText("기존 의뢰");

    const input = screen.getByRole("textbox", { name: ko.board.newQuest });
    expect(input).toHaveValue("");

    pasteText(input, "첫 번째 의뢰\n\n  두 번째 의뢰  \n");

    const confirmText = "2건을 의뢰로 등록할까요?";
    expect(screen.getByText(confirmText)).toBeInTheDocument();

    const dialog = screen.getByRole("dialog", {
      name: ko.board.bulk.title,
    });
    expect(within(dialog).getByText(confirmText)).toBeInTheDocument();

    // The paste was prevented, so the single-line input is untouched.
    expect(input).toHaveValue("");

    await user.click(
      within(dialog).getByRole("button", { name: ko.board.bulk.submit }),
    );

    await waitFor(() => {
      const bulkCall = fetchMock.mock.calls.find(([url, init]) => {
        return (
          String(url) === "/api/projects/1/quests/bulk" &&
          init?.method === "POST"
        );
      });
      expect(bulkCall).toBeDefined();
      expect(JSON.parse(String(bulkCall?.[1]?.body))).toEqual({
        titles: ["첫 번째 의뢰", "두 번째 의뢰"],
      });
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: ko.board.bulk.title }),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps the input unchanged when the bulk confirmation is cancelled", async () => {
    stubFetch(boardHandler());
    const { user } = renderBoard();

    await screen.findByText("기존 의뢰");
    const input = screen.getByRole("textbox", { name: ko.board.newQuest });

    await user.type(input, "메모");
    expect(input).toHaveValue("메모");

    pasteText(input, "알파\n베타");

    const dialog = screen.getByRole("dialog", {
      name: ko.board.bulk.title,
    });
    expect(within(dialog).getByText("2건을 의뢰로 등록할까요?")).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: ko.common.cancel }),
    );

    expect(
      screen.queryByRole("dialog", { name: ko.board.bulk.title }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue("메모");
  });

  it("renders the bulk confirmation as a paper dialog with the hard shadow", async () => {
    stubFetch(boardHandler());
    const { user } = renderBoard();

    await screen.findByText("기존 의뢰");
    const input = screen.getByRole("textbox", { name: ko.board.newQuest });
    pasteText(input, "알파\n베타");

    const dialog = screen.getByRole("dialog", {
      name: ko.board.bulk.title,
    });
    expect(dialog).toHaveClass(
      "bg-paper",
      "border-[1.5px]",
      "border-line-strong",
      "shadow-hard",
      "rounded-sm",
    );
    expect(dialog.className).not.toContain("rounded-2xl");
    expect(dialog.className).not.toContain("backdrop-blur");
    expect(dialog.parentElement).toHaveClass("bg-scrim");

    await user.click(
      within(dialog).getByRole("button", { name: ko.common.cancel }),
    );
    expect(
      screen.queryByRole("dialog", { name: ko.board.bulk.title }),
    ).not.toBeInTheDocument();
  });
});
