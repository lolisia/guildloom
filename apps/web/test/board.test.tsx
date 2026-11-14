// @vitest-environment node
/**
 * Board, quick add and quest drawer tests.
 *
 * This workspace keeps `jsdom` inside `apps/web/node_modules` while Vitest is
 * hoisted to the repository root, so the built-in `jsdom` environment cannot
 * resolve it. Every DOM test file therefore runs in the Node environment and
 * installs the same jsdom window before loading React Testing Library (see
 * `shell.test.tsx`). `fetch` is stubbed; no server is involved.
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

const { cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const userEvent = (await import("@testing-library/user-event")).default;
const { MemoryRouter, Route, Routes, useLocation } = await import(
  "react-router-dom"
);
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const { default: BoardPage } = await import("../src/routes/BoardPage");
const { planQuestMove } = await import("../src/components/board/movePlan");
const { ko } = await import("../src/i18n/ko");
const { formatKoreanDateTime } = await import("../src/lib/format");

// Testing Library's `screen` singleton is created when its module loads, which
// happens before this file installs the jsdom window. Bind the queries to the
// freshly created body instead.
const screen = within(document.body);

const NOW = Date.now();

const QUESTS: QuestSummary[] = [
  {
    id: 1,
    number: 1,
    title: "보드 첫 의뢰",
    stage: "board",
    rank: "B",
    orderKey: "a0",
    tags: ["긴급", "버그"],
    createdBy: { id: 1, displayName: "김모험" },
    createdAt: NOW - 3 * 86_400_000,
    updatedAt: NOW - 3_600_000,
  },
  {
    id: 2,
    number: 2,
    title: "던전 의뢰",
    stage: "dungeon",
    rank: null,
    orderKey: "a1",
    tags: [],
    createdBy: { id: 2, displayName: "아린" },
    createdAt: NOW - 2 * 3_600_000,
    updatedAt: NOW - 2 * 3_600_000,
  },
  {
    id: 3,
    number: 3,
    title: "보스 의뢰",
    stage: "boss",
    rank: "S",
    orderKey: "a2",
    tags: ["보스"],
    createdBy: { id: 3, displayName: "루나" },
    createdAt: NOW - 30 * 60_000,
    updatedAt: NOW - 30 * 60_000,
  },
  {
    id: 4,
    number: 4,
    title: "클리어 의뢰",
    stage: "cleared",
    rank: null,
    orderKey: "a3",
    tags: [],
    createdBy: { id: 1, displayName: "김모험" },
    createdAt: NOW - 5 * 60_000,
    updatedAt: NOW - 5 * 60_000,
  },
];

const QUEST_DETAIL: Quest = {
  ...QUESTS[0]!,
  projectId: 1,
  situation: "첫 줄\n둘째 줄 https://example.com",
  direction: "다음 단계로 진행합니다.",
  archiveReason: null,
};

const EVENTS: QuestEvent[] = [
  {
    id: 10,
    questId: 1,
    projectId: 1,
    type: "quest_posted",
    payload: { number: 1, title: "보드 첫 의뢰" },
    actor: { id: 1, displayName: "김모험" },
    familiarId: null,
    createdAt: NOW - 3 * 86_400_000,
  },
  {
    id: 11,
    questId: 1,
    projectId: 1,
    type: "quest_moved",
    payload: { from: "board", to: "dungeon" },
    actor: { id: 2, displayName: "아린" },
    familiarId: null,
    createdAt: NOW - 2 * 86_400_000,
  },
];

interface MockReply {
  status?: number;
  body?: unknown;
}

type MockHandler = (
  url: URL,
  init: RequestInit,
) => MockReply | undefined | Promise<MockReply | undefined>;

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
      const reply = await handler(url, init);
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

function filterByStage(quests: QuestSummary[], url: URL): MockReply {
  const stageParam = url.searchParams.get("stage");
  const stages = stageParam ? stageParam.split(",") : [];
  return {
    body: stages.length > 0
      ? quests.filter((quest) => stages.includes(quest.stage))
      : quests,
  };
}

function defaultHandler(quests: QuestSummary[] = QUESTS): MockHandler {
  return (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();

    if (method === "GET" && url.pathname === "/api/projects/1/quests") {
      return filterByStage(quests, url);
    }
    if (method === "GET" && url.pathname === "/api/projects/1/tags") {
      return {
        body: [
          { id: 1, name: "긴급", count: 1 },
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

function renderBoard(initialEntry = "/g/1") {
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
          <Route path="/g/:projectId" element={<BoardPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, queryClient, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BoardPage", () => {
  it("renders the four exact columns and the card details", async () => {
    const fetchMock = stubFetch(defaultHandler());
    const { container } = renderBoard();

    for (const label of Object.values(ko.board.columns)) {
      // Plain labels now collide with the sr-only page title ("게시판"), so
      // scope the heading lookup to the column region itself.
      const column = await screen.findByRole("region", { name: label });
      expect(
        within(column).getByRole("heading", { name: label }),
      ).toBeInTheDocument();
    }

    expect(await screen.findByText("보드 첫 의뢰")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("긴급")).toBeInTheDocument();
    expect(screen.getByText("버그")).toBeInTheDocument();
    expect(container.querySelector('[data-rank="B"]')).toHaveTextContent("B");
    expect(screen.getByText("3일 전")).toBeInTheDocument();
    expect(screen.getByText("던전 의뢰")).toBeInTheDocument();
    expect(screen.getByText("보스 의뢰")).toBeInTheDocument();
    expect(screen.getByText("클리어 의뢰")).toBeInTheDocument();

    const creatorSprite = container.querySelector('[data-user-id="1"]');
    expect(creatorSprite).not.toBeNull();
    expect(creatorSprite).toHaveClass("h-8", "w-8");

    const listCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = new URL(String(input), "http://localhost");
      return (
        url.pathname === "/api/projects/1/quests" &&
        (init?.method ?? "GET") === "GET"
      );
    });
    expect(listCall).toBeDefined();
    expect(String(listCall?.[0])).toBe(
      "/api/projects/1/quests?stage=board,dungeon,boss,cleared",
    );
    const stageParam = new URL(
      String(listCall?.[0]),
      "http://localhost",
    ).searchParams.get("stage");
    expect(stageParam).toBe("board,dungeon,boss,cleared");
  });

  it("focuses quick add with N and posts a new quest on Enter", async () => {
    const fetchMock = stubFetch((url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "POST" && url.pathname === "/api/projects/1/quests") {
        return { status: 201, body: { ...QUEST_DETAIL, id: 99, number: 99 } };
      }
      return defaultHandler()(url, init);
    });
    const { user } = renderBoard();

    await screen.findByText("보드 첫 의뢰");
    const input = screen.getByRole("textbox", { name: ko.board.newQuest });

    expect(input).not.toHaveFocus();
    fireEvent.keyDown(document.body, { key: "n" });
    expect(input).toHaveFocus();

    await user.type(input, "새 의뢰{Enter}");

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(([url, init]) => {
        return (
          String(url) === "/api/projects/1/quests" &&
          init?.method === "POST"
        );
      });
      expect(createCall).toBeDefined();
      expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
        title: "새 의뢰",
      });
    });

    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("plans drops with the neighbouring ids and keeps arrayMove order", () => {
    const board = [
      { ...QUESTS[0]!, id: 10 },
      { ...QUESTS[0]!, id: 11 },
      { ...QUESTS[0]!, id: 12 },
    ];

    const downward = planQuestMove(board, 10, 12);
    expect(downward?.plan).toEqual({
      questId: 10,
      stage: "board",
      beforeId: 12,
    });
    expect(downward?.quests.map((quest) => quest.id)).toEqual([11, 12, 10]);

    const upward = planQuestMove(board, 12, 10);
    expect(upward?.plan).toEqual({
      questId: 12,
      stage: "board",
      afterId: 10,
    });
    expect(upward?.quests.map((quest) => quest.id)).toEqual([12, 10, 11]);

    const crossColumn = planQuestMove(QUESTS, 1, 2);
    expect(crossColumn?.plan).toEqual({
      questId: 1,
      stage: "dungeon",
      afterId: 2,
    });
    expect(crossColumn?.quests.find((quest) => quest.id === 1)?.stage).toBe(
      "dungeon",
    );

    const emptyColumn = planQuestMove(QUESTS, 1, "column:cleared");
    expect(emptyColumn?.plan).toEqual({
      questId: 1,
      stage: "cleared",
      beforeId: 4,
    });
  });

  it("opens the drawer from a card with the dungeon placeholder and events", async () => {
    stubFetch(defaultHandler());
    const { user } = renderBoard();

    await screen.findByText("보드 첫 의뢰");
    await user.click(
      screen.getByRole("button", { name: "#1 보드 첫 의뢰" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("?quest=1"),
    );

    const dialog = await screen.findByRole("dialog", {
      name: ko.board.drawer.title,
    });

    expect(
      await within(dialog).findByText(ko.board.drawer.dungeonComingSoon),
    ).toBeInTheDocument();
    const placeholder = within(dialog).getByTestId(
      "quest-dungeon-placeholder",
    );
    expect(placeholder).toHaveStyle({ height: "120px" });
    const creatorSprite = placeholder.querySelector('[data-user-id="1"]');
    expect(creatorSprite).not.toBeNull();
    expect(creatorSprite).toHaveClass("h-10", "w-10");

    const situation = within(dialog).getByTestId("quest-situation");
    expect(situation.querySelector(".whitespace-pre-wrap")).not.toBeNull();
    expect(
      within(dialog).getByRole("link", { name: "https://example.com" }),
    ).toHaveAttribute("href", "https://example.com");

    expect(within(dialog).getByText("'김모험'")).toBeInTheDocument();
    expect(
      within(dialog).getByText(formatKoreanDateTime(EVENTS[0]!.createdAt)),
    ).toBeInTheDocument();
    expect(dialog.querySelectorAll("[data-event-id]")).toHaveLength(2);
  });

  it("saves title, rank, tags and long text through PATCH", async () => {
    const patches: unknown[] = [];
    const fetchMock = stubFetch((url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "PATCH" && url.pathname === "/api/quests/1") {
        const body = JSON.parse(String(init.body)) as Partial<Quest>;
        patches.push(body);
        return { body: { ...QUEST_DETAIL, ...body } };
      }
      return defaultHandler()(url, init);
    });

    const { user } = renderBoard("/g/1?quest=1");
    const dialog = await screen.findByRole("dialog", {
      name: ko.board.drawer.title,
    });

    const titleInput = await within(dialog).findByRole("textbox", {
      name: ko.quest.titleLabel,
    });
    await user.clear(titleInput);
    await user.type(titleInput, "수정된 제목{Enter}");
    await waitFor(() =>
      expect(patches).toContainEqual({ title: "수정된 제목" }),
    );

    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: ko.quest.rank }),
      "A",
    );
    await waitFor(() => expect(patches).toContainEqual({ rank: "A" }));

    const tagInput = within(dialog).getByRole("textbox", {
      name: ko.quest.tagAdd,
    });
    await user.type(tagInput, "새태그");
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = new URL(String(input), "http://localhost");
          return (
            url.pathname === "/api/projects/1/tags" &&
            url.searchParams.get("q") === "새"
          );
        }),
      ).toBe(true);
    });
    await user.type(tagInput, "{Enter}");
    await waitFor(() =>
      expect(patches).toContainEqual({
        tags: ["긴급", "버그", "새태그"],
      }),
    );

    const removeTagButton = await within(dialog).findByRole("button", {
      name: ko.quest.tagRemove("새태그"),
    });
    await waitFor(() => expect(removeTagButton).not.toBeDisabled());
    await user.click(removeTagButton);
    await waitFor(() =>
      expect(patches).toContainEqual({ tags: ["긴급", "버그"] }),
    );

    const editSituation = within(dialog).getByRole("button", {
      name: `${ko.board.drawer.situation} ${ko.common.edit}`,
    });
    await waitFor(() => expect(editSituation).not.toBeDisabled());
    await user.click(editSituation);
    const situationInput = within(dialog).getByRole("textbox", {
      name: ko.board.drawer.situation,
    });
    fireEvent.change(situationInput, {
      target: { value: "새 상황\n둘째 줄" },
    });
    fireEvent.blur(situationInput);
    await waitFor(() =>
      expect(patches).toContainEqual({ situation: "새 상황\n둘째 줄" }),
    );
  });

  it("archives the quest after confirmation and removes it from the board", async () => {
    let archived = false;
    const fetchMock = stubFetch((url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "POST" && url.pathname === "/api/quests/1/archive") {
        archived = true;
        return {
          body: {
            ...QUEST_DETAIL,
            stage: "archived",
            archiveReason: "dropped",
          },
        };
      }
      if (method === "GET" && url.pathname === "/api/projects/1/quests") {
        return filterByStage(
          archived ? QUESTS.filter((quest) => quest.id !== 1) : QUESTS,
          url,
        );
      }
      return defaultHandler()(url, init);
    });

    const { user } = renderBoard("/g/1?quest=1");
    const dialog = await screen.findByRole("dialog", {
      name: ko.board.drawer.title,
    });

    await user.click(
      await within(dialog).findByRole("button", {
        name: ko.board.drawer.archive,
      }),
    );

    const confirmDialog = await screen.findByRole("dialog", {
      name: ko.board.drawer.archive,
    });
    expect(
      within(confirmDialog).getByText(ko.board.drawer.archiveConfirm),
    ).toBeInTheDocument();

    await user.click(
      within(confirmDialog).getByRole("button", {
        name: ko.board.drawer.archive,
      }),
    );

    await waitFor(() => {
      const archiveCall = fetchMock.mock.calls.find(([url, init]) => {
        return (
          String(url) === "/api/quests/1/archive" &&
          init?.method === "POST"
        );
      });
      expect(archiveCall).toBeDefined();
      expect(JSON.parse(String(archiveCall?.[1]?.body))).toEqual({
        reason: "dropped",
      });
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: ko.board.drawer.title }),
      ).not.toBeInTheDocument(),
    );

    await waitFor(() =>
      expect(screen.queryByText("보드 첫 의뢰")).not.toBeInTheDocument(),
    );
  });
});
