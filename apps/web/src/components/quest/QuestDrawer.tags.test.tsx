// @vitest-environment node
/**
 * Quest drawer tag editing tests.
 *
 * Rapid tag additions must accumulate through the optimistic tag mutation: the
 * second PATCH has to contain both tags even though the first response has not
 * arrived yet. A failed PATCH must roll the chips back, a composition Enter in
 * the title editor must not commit, and a plain Enter still must.
 *
 * As in the other DOM tests, jsdom is installed manually because Vitest cannot
 * resolve the workspace-local copy from the hoisted runner.
 */
import type { Quest, QuestEvent } from "@guildloom/shared";
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
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const { QuestDrawer } = await import("./QuestDrawer");
const { ko } = await import("../../i18n/ko");

// Testing Library's `screen` is bound before the jsdom window exists; bind the
// queries to the freshly created document body instead.
const screen = within(document.body);

const QUEST_DETAIL: Quest = {
  id: 1,
  number: 1,
  title: "Alpha",
  stage: "board",
  kind: "fix",
  rank: "C",
  orderKey: "a0",
  tags: [],
  createdBy: { id: 1, displayName: "김모험" },
  createdAt: Date.UTC(2026, 0, 2, 3, 0, 0),
  updatedAt: Date.UTC(2026, 0, 4, 3, 0, 0),
  party: [
    {
      user: { id: 1, displayName: "김모험" },
      role: "leader",
      status: "fighting",
      retreatReason: null,
      joinedAt: Date.UTC(2026, 0, 2, 3, 0, 0),
    },
  ],
  pendingNominations: 0,
  bounty: { base: 80, multiplier: 1, total: 80, days: 0, dusty: false },
  projectId: 1,
  situation: "상황",
  direction: "방향",
  archiveReason: null,
  nominations: [],
  floors: { done: 0, total: 0 },
  refs: [],
  firstClaimedAt: Date.UTC(2026, 0, 2, 3, 0, 0),
};

interface MockReply {
  status?: number;
  body?: unknown;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** A promise whose resolution the test controls. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface StubFetchOptions {
  /** Events served once the adventure log has already been fetched once. */
  eventsAfterFirst?: QuestEvent[];
}

/**
 * Stub `fetch` for the drawer's three GETs and a controllable PATCH endpoint.
 * Each PATCH body is recorded and answered only when the test resolves the
 * matching deferred, so "in flight" really means in flight. Adventure-log GETs
 * are counted and the first one always returns an empty history, so a test can
 * prove that a tag edit triggers a refresh which then shows the new event.
 */
function stubFetch({ eventsAfterFirst = [] }: StubFetchOptions = {}) {
  const patchBodies: Record<string, unknown>[] = [];
  const pendingPatches: Deferred<MockReply>[] = [];
  let eventsRequestCount = 0;

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://localhost");
      const method = (init.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname === "/api/quests/1") {
        return jsonResponse(QUEST_DETAIL);
      }
      if (method === "GET" && url.pathname === "/api/quests/1/events") {
        eventsRequestCount += 1;
        return jsonResponse(eventsRequestCount === 1 ? [] : eventsAfterFirst);
      }
      if (method === "GET" && url.pathname === "/api/projects/1/tags") {
        return jsonResponse([]);
      }
      if (method === "GET" && url.pathname === "/api/quests/1/messages") {
        return jsonResponse({ messages: [], hasMore: false });
      }
      if (method === "GET" && url.pathname === "/api/projects/1") {
        return jsonResponse({
          project: { id: 1, name: "달빛 길드", createdAt: 1_768_000_000_000 },
          members: [
            {
              userId: 1,
              displayName: "김모험",
              role: "owner",
              xp: 0,
              level: 1,
            },
          ],
        });
      }
      if (method === "PATCH" && url.pathname === "/api/quests/1") {
        patchBodies.push(
          JSON.parse(String(init.body)) as Record<string, unknown>,
        );
        const reply = deferred<MockReply>();
        pendingPatches.push(reply);
        const resolved = await reply.promise;
        return jsonResponse(resolved.body, resolved.status ?? 200);
      }

      return jsonResponse(
        { error: { code: "not_found", message: "not found" } },
        404,
      );
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    patchBodies,
    pendingPatches,
    /** How many `GET /api/quests/1/events` requests have been made. */
    getEventsRequestCount: () => eventsRequestCount,
  };
}

function renderDrawer() {
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
  const onClose = vi.fn();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <QuestDrawer projectId={1} questId={1} onClose={onClose} />
    </QueryClientProvider>,
  );

  return { ...view, queryClient, onClose, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("QuestDrawer tags", () => {
  it("accumulates two quick additions into the last PATCH body", async () => {
    const { patchBodies, pendingPatches } = stubFetch();
    const { user } = renderDrawer();

    await screen.findByDisplayValue("Alpha");

    const tagInput = screen.getByRole("textbox", { name: ko.quest.tagAdd });

    await user.type(tagInput, "인게임");
    await user.keyboard("{Enter}");
    await screen.findByText("인게임");

    // The first PATCH is still pending; the editor must stay usable so the
    // next addition computes from the optimistically updated tag list.
    expect(tagInput).toBeEnabled();

    await user.type(tagInput, "v1.0");
    await user.keyboard("{Enter}");
    await screen.findByText("v1.0");

    await waitFor(() => expect(patchBodies).toHaveLength(2));
    expect(patchBodies[0]).toEqual({ tags: ["인게임"] });
    expect(patchBodies[1]).toEqual({ tags: ["인게임", "v1.0"] });

    // Both chips are visible while both PATCHes are still in flight.
    expect(pendingPatches).toHaveLength(2);
    expect(screen.getByText("인게임")).toBeInTheDocument();
    expect(screen.getByText("v1.0")).toBeInTheDocument();
  });

  it("refreshes the adventure log once the tag PATCH settles", async () => {
    const tagEvent: QuestEvent = {
      id: 1,
      questId: 1,
      projectId: 1,
      type: "quest_edited",
      payload: { fields: ["tags"] },
      actor: { id: 1, displayName: "김모험" },
      familiarId: null,
      createdAt: Date.UTC(2026, 0, 5, 3, 0, 0),
    };
    const { getEventsRequestCount, pendingPatches } = stubFetch({
      eventsAfterFirst: [tagEvent],
    });
    const { user } = renderDrawer();

    await screen.findByDisplayValue("Alpha");
    await waitFor(() => expect(getEventsRequestCount()).toBe(1));

    const tagInput = screen.getByRole("textbox", { name: ko.quest.tagAdd });

    await user.type(tagInput, "인게임");
    await user.keyboard("{Enter}");
    await screen.findByText("인게임");

    await waitFor(() => expect(pendingPatches).toHaveLength(1));
    expect(getEventsRequestCount()).toBe(1);

    pendingPatches[0]!.resolve({
      body: { ...QUEST_DETAIL, tags: ["인게임"] },
    });

    // The mounted adventure log refetches as soon as the PATCH settles …
    await waitFor(() => expect(getEventsRequestCount()).toBe(2));
    // … and the collapsed log hides non-key edits until the full history opens.
    await user.click(
      screen.getByRole("button", {
        name: ko.board.drawer.showAllHistory(1),
      }),
    );
    expect(
      await screen.findByText(/의뢰 내용을 고쳤습니다 \(태그\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("인게임")).toBeInTheDocument();
  });

  it("rolls the chip back when the tag PATCH fails", async () => {
    const { patchBodies, pendingPatches } = stubFetch();
    const { user } = renderDrawer();

    await screen.findByDisplayValue("Alpha");

    const tagInput = screen.getByRole("textbox", { name: ko.quest.tagAdd });

    await user.type(tagInput, "인게임");
    await user.keyboard("{Enter}");
    await screen.findByText("인게임");

    await waitFor(() => expect(pendingPatches).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ tags: ["인게임"] });

    pendingPatches[0]!.resolve({
      status: 500,
      body: { error: { code: "unexpected_error", message: "boom" } },
    });

    await waitFor(() =>
      expect(screen.queryByText("인게임")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(ko.quest.noTags)).toBeInTheDocument();
  });
});

describe("QuestDrawer title editing", () => {
  it("ignores a composition Enter and commits a plain Enter", async () => {
    const { patchBodies } = stubFetch();
    const { user } = renderDrawer();

    await screen.findByDisplayValue("Alpha");

    const titleInput = screen.getByRole("textbox", {
      name: ko.quest.titleLabel,
    });

    fireEvent.change(titleInput, { target: { value: "합성 제목" } });
    fireEvent.keyDown(titleInput, {
      key: "Enter",
      keyCode: 229,
      isComposing: true,
    });

    // The composition Enter must not reach `commitTitle`.
    await Promise.resolve();
    expect(patchBodies).toHaveLength(0);

    await user.click(titleInput);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(patchBodies).toEqual([{ title: "합성 제목" }]));
  });
});
