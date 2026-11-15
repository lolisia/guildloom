// @vitest-environment node
/**
 * Ledger table tests: the eight exact columns, the design-system table surface
 * (sunken header, line separators), stage/rank/avatar cells, text/tag/search
 * filtering, client-side header sorting and opening the shared quest drawer
 * from a row.
 *
 * As in the other DOM tests, jsdom is installed manually because Vitest cannot
 * resolve the workspace-local copy from the hoisted runner.
 */
import type { Quest, QuestEvent, QuestSummary } from "@guildloom/shared";
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

const { cleanup, render, waitFor, within } = await import(
  "@testing-library/react"
);
const userEvent = (await import("@testing-library/user-event")).default;
const { MemoryRouter, Route, Routes, useLocation } = await import(
  "react-router-dom"
);
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const { default: LedgerPage } = await import("../src/routes/LedgerPage");
const { ko } = await import("../src/i18n/ko");
const { formatKoreanDate } = await import("../src/lib/format");

// Testing Library's `screen` is bound before the jsdom window exists; bind the
// queries to the freshly created document body instead.
const screen = within(document.body);

const QUESTS: QuestSummary[] = [
  {
    id: 1,
    number: 1,
    title: "Alpha",
    stage: "board",
    rank: "C",
    orderKey: "a0",
    tags: ["긴급"],
    createdBy: { id: 1, displayName: "김모험" },
    createdAt: Date.UTC(2026, 0, 2, 3, 0, 0),
    updatedAt: Date.UTC(2026, 0, 4, 3, 0, 0),
    party: [],
    floors: { done: 0, total: 0 },
    pendingNominations: 0,
    bounty: { base: 80, multiplier: 1, total: 80, days: 0, dusty: false },
  },
  {
    id: 2,
    number: 2,
    title: "Beta",
    stage: "dungeon",
    rank: "A",
    orderKey: "a1",
    tags: ["버그"],
    createdBy: { id: 2, displayName: "아린" },
    createdAt: Date.UTC(2026, 0, 1, 3, 0, 0),
    updatedAt: Date.UTC(2026, 0, 3, 3, 0, 0),
    party: [],
    floors: { done: 0, total: 0 },
    pendingNominations: 0,
    bounty: { base: 250, multiplier: 1, total: 250, days: 0, dusty: false },
  },
  {
    id: 3,
    number: 3,
    title: "Gamma",
    stage: "archived",
    rank: null,
    orderKey: "a2",
    tags: ["긴급"],
    createdBy: { id: 3, displayName: "루나" },
    createdAt: Date.UTC(2026, 0, 3, 3, 0, 0),
    updatedAt: Date.UTC(2026, 0, 5, 3, 0, 0),
    party: [],
    floors: { done: 0, total: 0 },
    pendingNominations: 0,
    bounty: { base: 40, multiplier: 1, total: 40, days: 0, dusty: false },
  },
];

const QUEST_DETAIL: Quest = {
  ...QUESTS[0]!,
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
      title: "1층: 상황 정리",
      orderKey: "a0",
      doneAt: Date.UTC(2026, 0, 4, 3, 0, 0),
      doneBy: { id: 1, displayName: "김모험" },
    },
  ],
  firstClaimedAt: Date.UTC(2026, 0, 2, 3, 0, 0),
};

const EVENTS: QuestEvent[] = [
  {
    id: 10,
    questId: 1,
    projectId: 1,
    type: "quest_posted",
    payload: { number: 1, title: "Alpha" },
    actor: { id: 1, displayName: "김모험" },
    familiarId: null,
    createdAt: Date.UTC(2026, 0, 2, 3, 0, 0),
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

function filteredQuests(url: URL): QuestSummary[] {
  const stageParam = url.searchParams.get("stage");
  const stages = stageParam ? stageParam.split(",").filter(Boolean) : [];
  const tag = url.searchParams.get("tag");
  const search = url.searchParams.get("q")?.toLowerCase() ?? "";

  return QUESTS.filter(
    (quest) => stages.length === 0 || stages.includes(quest.stage),
  )
    .filter((quest) => !tag || quest.tags.includes(tag))
    .filter(
      (quest) =>
        search.length === 0 || quest.title.toLowerCase().includes(search),
    );
}

function defaultHandler(): MockHandler {
  return (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET" && url.pathname === "/api/projects/1/quests") {
      return { body: filteredQuests(url) };
    }
    if (method === "GET" && url.pathname === "/api/projects/1/tags") {
      return {
        body: [
          { id: 1, name: "긴급", count: 2 },
          { id: 2, name: "버그", count: 1 },
        ],
      };
    }
    if (method === "GET" && url.pathname === "/api/quests/1") {
      return { body: QUEST_DETAIL };
    }
    if (method === "GET" && url.pathname === "/api/quests/1/events") {
      return { body: EVENTS };
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

function renderLedger(initialEntry = "/g/1/ledger") {
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
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/g/:projectId/ledger" element={<LedgerPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, queryClient, user: userEvent.setup() };
}

/** Titles shown in the ledger body, in row order. */
function rowTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("tbody tr")).map((row) => {
    const cells = row.querySelectorAll("td");
    return cells[1]?.textContent?.trim() ?? "";
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LedgerPage", () => {
  it("renders the eight exact columns with Korean dates", async () => {
    stubFetch(defaultHandler());
    const { container } = renderLedger();

    await screen.findByText("Alpha");

    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(8);
    for (const label of Object.values(ko.ledger.columns)) {
      expect(
        screen.getByRole("button", { name: ko.ledger.sortBy(label) }),
      ).toBeInTheDocument();
    }

    expect(rowTitles(container)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(
      screen.getAllByText(formatKoreanDate(QUESTS[0]!.createdAt)).length,
    ).toBeGreaterThan(0);
  });

  it("uses a sunken header, 1px line separators and sunken row hover", async () => {
    stubFetch(defaultHandler());
    const { container } = renderLedger();

    await screen.findByText("Alpha");

    expect(container.querySelector("thead")).toHaveClass("bg-sunken");
    // The table is not a rounded card: depth comes from the sunken header.
    const largeRadii = Array.from(container.querySelectorAll("*")).flatMap(
      (element) =>
        Array.from(element.classList).filter(
          (name) => name.startsWith("rounded-") && name !== "rounded-sm",
        ),
    );
    expect(largeRadii).toEqual([]);

    const rows = Array.from(
      container.querySelectorAll("tbody tr[data-quest-id]"),
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toHaveClass("border-b", "border-line", "hover:bg-sunken");
    }
  });

  it("shows stage icons, rank badges and square author avatars", async () => {
    stubFetch(defaultHandler());
    const { container } = renderLedger();

    await screen.findByText("Alpha");

    const row = container.querySelector<HTMLTableRowElement>(
      'tbody tr[data-quest-id="1"]',
    );
    expect(row).not.toBeNull();
    const cells = row!.querySelectorAll<HTMLTableCellElement>("td");
    expect(cells).toHaveLength(8);

    const stageCell = cells[3]!;
    expect(stageCell.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("board.png"),
    );
    expect(stageCell).toHaveTextContent(ko.quest.stages.board);

    const rankCell = cells[4]!;
    const rank = rankCell.querySelector("[data-rank]");
    expect(rank).toHaveAttribute("data-rank", "C");
    expect(rank?.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("rank-c.png"),
    );

    const authorCell = cells[5]!;
    const avatar = authorCell.querySelector("[data-user-id='1']");
    expect(avatar).toBeInTheDocument();
    expect(avatar?.className).toContain("rounded-sm");
    expect(avatar?.className).toContain("h-8");
    expect(avatar?.className).toContain("w-8");
  });

  it("marks the active sort column with an ascending or descending icon", async () => {
    stubFetch(defaultHandler());
    const { user } = renderLedger();

    await screen.findByText("Alpha");

    const createdAtHeader = screen.getByRole("button", {
      name: ko.ledger.sortBy(ko.ledger.columns.createdAt),
    });
    const titleHeader = screen.getByRole("button", {
      name: ko.ledger.sortBy(ko.ledger.columns.title),
    });
    expect(createdAtHeader.querySelector("img")).toBeNull();
    expect(titleHeader.querySelector("img")).toBeNull();

    await user.click(createdAtHeader);
    await waitFor(() =>
      expect(createdAtHeader.querySelector("img")).toHaveAttribute(
        "src",
        expect.stringContaining("sort-ascending.png"),
      ),
    );
    expect(titleHeader.querySelector("img")).toBeNull();

    await user.click(createdAtHeader);
    await waitFor(() =>
      expect(createdAtHeader.querySelector("img")).toHaveAttribute(
        "src",
        expect.stringContaining("sort-descending.png"),
      ),
    );

    await user.click(titleHeader);
    await waitFor(() =>
      expect(titleHeader.querySelector("img")).toHaveAttribute(
        "src",
        expect.stringContaining("sort-ascending.png"),
      ),
    );
    expect(createdAtHeader.querySelector("img")).toBeNull();
  });

  it("filters by tag and sends the tag to the list endpoint", async () => {
    const fetchMock = stubFetch(defaultHandler());
    const { user } = renderLedger();

    await screen.findByText("Alpha");
    expect(screen.getByText("Beta")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: ko.board.filterByTag }),
      "긴급",
    );

    await waitFor(() => {
      expect(screen.queryByText("Beta")).not.toBeInTheDocument();
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Gamma")).toBeInTheDocument();
    });

    const tagCall = fetchMock.mock.calls.find(([input]) => {
      const url = new URL(String(input), "http://localhost");
      return (
        url.pathname === "/api/projects/1/quests" &&
        url.searchParams.get("tag") === "긴급"
      );
    });
    expect(tagCall).toBeDefined();
  });

  it("supports multi-select stage filters for every stage", async () => {
    const fetchMock = stubFetch(defaultHandler());
    const { user } = renderLedger();

    await screen.findByText("Beta");
    expect(screen.getByText("Gamma")).toBeInTheDocument();

    const archived = screen.getByRole("checkbox", {
      name: ko.quest.stages.archived,
    });
    expect(archived).toBeChecked();

    await user.click(archived);

    await waitFor(() => {
      expect(archived).not.toBeChecked();
      expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });

    const stageCall = fetchMock.mock.calls.find(([input]) => {
      const url = new URL(String(input), "http://localhost");
      const stage = url.searchParams.get("stage");
      return (
        url.pathname === "/api/projects/1/quests" &&
        stage !== null &&
        !stage.split(",").includes("archived")
      );
    });
    expect(stageCall).toBeDefined();
  });

  it("searches by text and sends q to the list endpoint", async () => {
    const fetchMock = stubFetch(defaultHandler());
    const { user } = renderLedger();

    await screen.findByText("Alpha");

    await user.type(
      screen.getByRole("searchbox", { name: ko.common.search }),
      "Alpha",
    );

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.queryByText("Beta")).not.toBeInTheDocument();
      expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
    });

    const searchCall = fetchMock.mock.calls.find(([input]) => {
      const url = new URL(String(input), "http://localhost");
      return (
        url.pathname === "/api/projects/1/quests" &&
        url.searchParams.get("q") === "Alpha"
      );
    });
    expect(searchCall).toBeDefined();
  });

  it("sorts client-side when a header is clicked", async () => {
    stubFetch(defaultHandler());
    const { container, user } = renderLedger();

    await screen.findByText("Alpha");
    expect(rowTitles(container)).toEqual(["Alpha", "Beta", "Gamma"]);

    const createdAtHeader = screen.getByRole("button", {
      name: ko.ledger.sortBy(ko.ledger.columns.createdAt),
    });

    await user.click(createdAtHeader);
    await waitFor(() =>
      expect(rowTitles(container)).toEqual(["Beta", "Alpha", "Gamma"]),
    );

    await user.click(createdAtHeader);
    await waitFor(() =>
      expect(rowTitles(container)).toEqual(["Gamma", "Alpha", "Beta"]),
    );

    const titleHeader = screen.getByRole("button", {
      name: ko.ledger.sortBy(ko.ledger.columns.title),
    });
    await user.click(titleHeader);
    await waitFor(() =>
      expect(rowTitles(container)).toEqual(["Alpha", "Beta", "Gamma"]),
    );
  });

  it("opens the shared quest drawer from a row", async () => {
    stubFetch(defaultHandler());
    const { user } = renderLedger();

    await screen.findByText("Alpha");
    await user.click(screen.getByText("Alpha"));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("?quest=1"),
    );

    const dialog = await screen.findByRole("dialog", {
      name: ko.board.drawer.title,
    });
    expect(
      await within(dialog).findByText(ko.board.drawer.dungeonComingSoon),
    ).toBeInTheDocument();
  });
});
