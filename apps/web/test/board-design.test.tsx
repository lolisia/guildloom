// @vitest-environment node
/**
 * Board design-system tests.
 *
 * These prove the T05 restyle against DESIGN.md: sunken columns with stage
 * underlines, the paper quest card, the dashed quick-add slip, the drag-only
 * hard shadow and the responsive four-column grid.
 *
 * The suite runs without a real browser, so `@dnd-kit/sortable`'s `useSortable`
 * is mocked. That lets the drag state be switched on for one card and proves
 * the transform/box-shadow combination without simulating pointer gestures.
 * Everything else (DndContext, droppable columns, real SortableContext) uses
 * the actual library. DOM setup mirrors `board.test.tsx`: Node environment
 * plus a local jsdom window because Vitest (hoisted) cannot resolve the
 * workspace-local `jsdom`.
 */
import type { QuestSummary } from "@guildloom/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const sortableMock = vi.hoisted(() => ({
  useSortable: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/sortable")>();
  return { ...actual, useSortable: sortableMock.useSortable };
});

const { cleanup, render, within } = await import("@testing-library/react");
const { MemoryRouter, Route, Routes } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const { BOARD_COLUMNS } = await import("@guildloom/shared");
const { default: BoardPage } = await import("../src/routes/BoardPage");
const { default: QuestCard } = await import(
  "../src/components/board/QuestCard"
);
const { ko } = await import("../src/i18n/ko");
const { STAGE_ICON } = await import("../src/lib/icons");

// `screen` snapshots `document.body` when Testing Library loads, which happens
// before this file installs its jsdom window; bind the queries ourselves.
const screen = within(document.body);

const NOW = Date.now();

const QUESTS: QuestSummary[] = [
  {
    id: 1,
    number: 1,
    title: "보드 첫 의뢰",
    stage: "board",
    kind: "fix",
    rank: "B",
    orderKey: "a0",
    tags: ["긴급", "버그"],
    createdBy: { id: 1, displayName: "김모험" },
    createdAt: NOW - 3 * 86_400_000,
    updatedAt: NOW - 3_600_000,
    party: [],
    floors: { done: 0, total: 0 },
    pendingNominations: 0,
    bounty: { base: 150, multiplier: 1, total: 150, days: 0, dusty: false },
  },
  {
    id: 2,
    number: 2,
    title: "던전 의뢰",
    stage: "dungeon",
    kind: "feature",
    rank: null,
    orderKey: "a1",
    tags: [],
    createdBy: { id: 2, displayName: "아린" },
    createdAt: NOW - 2 * 3_600_000,
    updatedAt: NOW - 2 * 3_600_000,
    party: [],
    floors: { done: 0, total: 0 },
    pendingNominations: 0,
    bounty: { base: 40, multiplier: 1, total: 40, days: 0, dusty: false },
  },
  {
    id: 3,
    number: 3,
    title: "보스 의뢰",
    stage: "boss",
    kind: "fix",
    rank: "S",
    orderKey: "a2",
    tags: ["보스"],
    createdBy: { id: 3, displayName: "루나" },
    createdAt: NOW - 30 * 60_000,
    updatedAt: NOW - 30 * 60_000,
    party: [],
    floors: { done: 0, total: 0 },
    pendingNominations: 0,
    bounty: { base: 400, multiplier: 1, total: 400, days: 0, dusty: false },
  },
  {
    id: 4,
    number: 4,
    title: "클리어 의뢰",
    stage: "cleared",
    kind: "fix",
    rank: null,
    orderKey: "a3",
    tags: [],
    createdBy: { id: 1, displayName: "김모험" },
    createdAt: NOW - 5 * 60_000,
    updatedAt: NOW - 5 * 60_000,
    party: [],
    floors: { done: 0, total: 0 },
    pendingNominations: 0,
    bounty: { base: 40, multiplier: 1, total: 40, days: 0, dusty: false },
  },
];

const STAGE_UNDERLINE: Record<string, string> = {
  board: "border-ink",
  dungeon: "border-teal",
  boss: "border-brick",
  cleared: "border-gold",
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

function boardHandler(quests: QuestSummary[] = QUESTS): MockHandler {
  return (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET" && url.pathname === "/api/projects/1/quests") {
      const stageParam = url.searchParams.get("stage");
      const stages = stageParam ? stageParam.split(",") : [];
      return {
        body:
          stages.length > 0
            ? quests.filter((quest) => stages.includes(quest.stage))
            : quests,
      };
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

  return { ...view, queryClient };
}

function defaultSortable(overrides: Record<string, unknown> = {}) {
  return {
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
    ...overrides,
  };
}

beforeEach(() => {
  sortableMock.useSortable.mockReturnValue(defaultSortable());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("board design", () => {
  it("renders sunken stage columns with pixel headers and stage underlines", async () => {
    stubFetch(boardHandler());
    renderBoard();
    await screen.findByText("보드 첫 의뢰");

    for (const stage of BOARD_COLUMNS) {
      const column = await screen.findByRole("region", {
        name: ko.board.columns[stage],
      });

      expect(column).toHaveAttribute("data-stage", stage);
      expect(column).toHaveClass(
        "bg-sunken",
        "border-[1.5px]",
        "border-line-strong",
        "rounded-sm",
        "p-3",
      );

      const header = column.querySelector("header");
      expect(header).not.toBeNull();
      expect(header).toHaveClass("border-b-2", STAGE_UNDERLINE[stage]!);

      const stageIcon = header?.querySelector("img");
      expect(stageIcon).toHaveAttribute(
        "src",
        `/assets/icons/jrpg-v1/32/${STAGE_ICON[stage]}.png`,
      );
      expect(stageIcon).toHaveAttribute("width", "32");
      expect(stageIcon).toHaveAttribute("height", "32");

      const heading = within(column).getByRole("heading", {
        name: ko.board.columns[stage],
      });
      expect(heading).toHaveClass("font-pixel", "text-[16px]");

      const count = within(column).getByText(ko.board.questCount(1));
      expect(count).toHaveClass("font-pixel", "text-[12px]", "text-muted");
    }
  });

  it("lays the four columns out with a 20px gap: 1 / 2x2 / 4", async () => {
    stubFetch(boardHandler());
    const { container } = renderBoard();

    const grid = container.querySelector('[data-testid="board-grid"]');
    expect(grid).not.toBeNull();
    expect(grid).toHaveClass(
      "grid",
      "grid-cols-1",
      "gap-5",
      "md:grid-cols-2",
      "xl:grid-cols-4",
    );
    expect(grid?.children).toHaveLength(4);

    await screen.findByText("보드 첫 의뢰");
  });

  it("renders empty columns with the 64px empty icon and guidance", async () => {
    stubFetch(boardHandler([QUESTS[0]!]));
    renderBoard();

    await screen.findByText("보드 첫 의뢰");
    for (const stage of ["dungeon", "boss", "cleared"] as const) {
      const column = screen.getByRole("region", {
        name: ko.board.columns[stage],
      });
      expect(within(column).getByText(ko.board.emptyColumn)).toBeInTheDocument();
      const emptyIcon = column.querySelector('img[src*="/64/empty.png"]');
      expect(emptyIcon).not.toBeNull();
      expect(emptyIcon).toHaveAttribute("width", "64");
    }
  });

  it("renders quest cards as paper sheets with badge, chips and meta", async () => {
    stubFetch(boardHandler());
    const { container } = renderBoard();

    await screen.findByText("보드 첫 의뢰");
    const card = container.querySelector(
      '[data-quest-id="1"]',
    ) as HTMLElement;

    expect(card).toHaveClass(
      "bg-paper",
      "border-[1.5px]",
      "border-line-strong",
      "rounded-sm",
      "px-[14px]",
      "py-3",
    );
    expect(card).toHaveAttribute("role", "button");
    expect(card).toHaveAttribute("tabindex", "0");
    expect(card).toHaveAttribute("data-stage", "board");
    expect(card).toHaveAttribute("aria-label", "#1 보드 첫 의뢰");

    expect(within(card).getByText("#1")).toHaveClass(
      "font-pixel",
      "text-[12px]",
      "text-muted",
    );

    const rank = card.querySelector('[data-rank="B"]');
    expect(rank).not.toBeNull();
    expect(rank).toHaveTextContent("B");
    expect(rank?.querySelector("img")).toHaveAttribute("width", "32");

    expect(
      within(card).getByRole("heading", { name: "보드 첫 의뢰" }),
    ).toHaveClass("text-[15px]", "font-semibold");

    expect(within(card).getByText("긴급")).toHaveClass(
      "border",
      "border-line",
      "text-xs",
      "text-muted",
    );

    const time = card.querySelector("time");
    expect(time).toHaveClass("text-[12px]", "text-muted");
    expect(time).toHaveTextContent("3일 전");

    // A board-stage card without an active party shows the dashed 빈 파티
    // placeholder instead of the creator avatar.
    expect(card.querySelector('[data-user-id="1"]')).toBeNull();
    expect(within(card).getByTestId("empty-party")).toHaveTextContent(
      ko.quest.emptyParty,
    );
    expect(within(card).getByTestId("empty-party")).toHaveClass(
      "border-dashed",
      "border-[1.5px]",
    );

    // Other stages keep the creator avatar at the sm (32px) size.
    const clearedCard = container.querySelector(
      '[data-quest-id="4"]',
    ) as HTMLElement;
    expect(clearedCard.querySelector('[data-user-id="1"]')).toHaveClass(
      "h-8",
      "w-8",
    );
  });

  it("keeps every resting card flat", async () => {
    stubFetch(boardHandler());
    const { container } = renderBoard();

    await screen.findByText("보드 첫 의뢰");
    const cards = [
      ...container.querySelectorAll<HTMLElement>("[data-quest-id]"),
    ];
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.style.boxShadow).toBe("");
      expect(card.className).not.toContain("shadow");
    }
  });

  it("lifts only the dragged card with an offset and hard ink shadow", () => {
    sortableMock.useSortable.mockReturnValue(
      defaultSortable({
        isDragging: true,
        transform: { x: 12, y: 6, scaleX: 1, scaleY: 1 },
        transition: "transform 160ms ease-out",
      }),
    );

    stubFetch(boardHandler());
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
        mutations: { retry: false },
      },
    });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <QuestCard quest={QUESTS[0]!} onOpen={() => {}} />
      </QueryClientProvider>,
    );
    const card = container.querySelector(
      '[data-quest-id="1"]',
    ) as HTMLElement;

    expect(card.style.transform).toBe(
      "translate3d(12px, 6px, 0) scaleX(1) scaleY(1) translate(-2px, -2px)",
    );
    expect(card.style.boxShadow).toBe("4px 4px 0 var(--color-ink)");
    expect(card.style.zIndex).toBe("10");
  });

  it("styles quick add as a dashed paper input", async () => {
    stubFetch(boardHandler());
    renderBoard();

    await screen.findByText("보드 첫 의뢰");
    const input = screen.getByRole("textbox", { name: ko.board.newQuest });

    expect(input).toHaveAttribute(
      "placeholder",
      ko.board.quickAddPlaceholder,
    );
    expect(input).toHaveClass(
      "border-dashed",
      "border-[1.5px]",
      "border-line-strong",
      "bg-paper",
      "rounded-sm",
    );
  });
});
