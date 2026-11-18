// @vitest-environment node
/**
 * Clear / unclear UX (F1 T06).
 *
 * Covers the whole flow against a stateful API stub:
 *
 * - the confirmation dialog loads `GET /api/quests/:id/clear-preview` and
 *   shows the total, every recipient's share, the requester bonus and the
 *   non-participant warning;
 * - Esc, the scrim and 취소 close it without calling clear/unclear and return
 *   focus to the button that opened it;
 * - the boss banner and the drawer footer both go through the dialog;
 * - a successful clear queues the 10s `던전 클리어! +N XP` toast and its
 *   되돌리기 action calls `POST /api/quests/:id/unclear`;
 * - the cleared drawer revokes the clear after naming the XP taken back;
 * - dropping a card on the 클리어 column waits for the dialog, sends no move
 *   before confirmation and celebrates the preview's share afterwards; and
 * - toast durations stay 4s by default and 10s for the action toast.
 *
 * `@dnd-kit` cannot start a real pointer drag in jsdom (every rect is zero), so
 * the board test captures the `onDragEnd` handler from the rendered
 * `DndContext` and invokes it directly.
 */
import "./domEnvironment";

import type {
  ClearPreviewResponse,
  Quest,
  QuestEvent,
  QuestSummary,
} from "@guildloom/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dndBridge = vi.hoisted(() => ({
  onDragEnd: null as ((event: unknown) => void) | null,
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const React = await import("react");
  type Props = React.ComponentProps<typeof actual.DndContext>;
  return {
    ...actual,
    DndContext: (props: Props) => {
      dndBridge.onDragEnd = props.onDragEnd as unknown as (
        event: unknown,
      ) => void;
      return React.createElement(actual.DndContext, props);
    },
  };
});

const { MemoryRouter, Route, Routes } = await import("react-router-dom");
const { default: BoardPage } = await import("../src/routes/BoardPage");
const { QuestDrawer } = await import(
  "../src/components/quest/QuestDrawer"
);
const { ko } = await import("../src/i18n/ko");
const { sumMyPreviewReward } = await import(
  "../src/components/quest/clearFeedback"
);
const { queryKeys } = await import("../src/lib/queryKeys");
const { ToastHost, TOAST_DURATION_MS, pushToast, useToastStore } =
  await import("../src/lib/toast");

// Testing Library's `screen` singleton is created when its module loads, which
// happens before this file installs the jsdom window. Bind the queries to the
// freshly created body instead.
const screen = within(document.body);

const NOW = Date.UTC(2026, 0, 2, 3, 0, 0);

const HERO = {
  id: 1,
  loginId: "hero",
  displayName: "김모험",
  xp: 0,
  level: 1,
};

const OTHER_USER = { id: 2, displayName: "이모험" };
const REQUESTER = { id: 3, displayName: "루나" };

const PREVIEW: ClearPreviewResponse = {
  total: 60,
  rewards: [
    { user: { id: HERO.id, displayName: HERO.displayName }, amount: 40 },
    { user: OTHER_USER, amount: 20 },
  ],
  requesterBonus: null,
  actorIsInvolved: true,
};

function baseQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: 1,
    projectId: 1,
    number: 42,
    title: "클리어 의뢰",
    stage: "board",
    kind: "fix",
    rank: "C",
    orderKey: "a0",
    tags: [],
    createdBy: { id: 1, displayName: "김모험" },
    createdAt: NOW,
    updatedAt: NOW,
    party: [],
    pendingNominations: 0,
    bounty: { base: 80, multiplier: 1, total: 80, days: 0, dusty: false },
    situation: "",
    direction: "",
    archiveReason: null,
    nominations: [],
    floors: { done: 0, total: 0 },
    refs: [],
    firstClaimedAt: NOW,
    ...overrides,
  };
}

function clearedEvent(): QuestEvent {
  return {
    id: 90,
    questId: 1,
    projectId: 1,
    type: "quest_cleared",
    payload: {
      rewards: [
        { userId: HERO.id, name: HERO.displayName, amount: 40 },
        { userId: OTHER_USER.id, name: OTHER_USER.displayName, amount: 20 },
      ],
      bounty: { base: 80, multiplier: 1, total: 80, days: 0, dusty: false },
    },
    actor: { id: HERO.id, displayName: HERO.displayName },
    familiarId: null,
    createdAt: NOW,
  };
}

const BOARD_SUMMARIES: QuestSummary[] = [
  {
    id: 1,
    number: 42,
    title: "클리어 의뢰",
    stage: "board",
    kind: "fix",
    rank: null,
    orderKey: "a0",
    tags: [],
    createdBy: { id: HERO.id, displayName: HERO.displayName },
    createdAt: NOW,
    updatedAt: NOW,
    party: [],
    floors: { done: 0, total: 0 },
    pendingNominations: 0,
    bounty: { base: 80, multiplier: 1, total: 80, days: 0, dusty: false },
  },
  {
    id: 4,
    number: 4,
    title: "이미 클리어한 의뢰",
    stage: "cleared",
    kind: "fix",
    rank: null,
    orderKey: "a3",
    tags: [],
    createdBy: { id: OTHER_USER.id, displayName: OTHER_USER.displayName },
    createdAt: NOW,
    updatedAt: NOW,
    party: [],
    floors: { done: 0, total: 0 },
    pendingNominations: 0,
    bounty: { base: 40, multiplier: 1, total: 40, days: 0, dusty: false },
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function parseBody(init: RequestInit): unknown {
  if (typeof init.body !== "string" || init.body.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(init.body) as unknown;
  } catch {
    return init.body;
  }
}

interface StubOptions {
  preview?: ClearPreviewResponse;
  previewError?: boolean;
  events?: QuestEvent[];
  boardQuests?: QuestSummary[];
  /** Hold clear-preview responses until the test releases them. */
  holdPreview?: boolean;
}

/** Stateful API stub covering every endpoint the clear flows touch. */
function stubApi(initialQuest: Quest, options: StubOptions = {}) {
  const state = {
    quest: { ...initialQuest },
    events: [...(options.events ?? [])],
    preview: options.preview ?? PREVIEW,
    boardQuests: (options.boardQuests ?? BOARD_SUMMARIES).map((quest) => ({
      ...quest,
    })),
  };
  const pendingPreviews: Deferred<Response>[] = [];
  const calls: RecordedCall[] = [];

  const previewResponse = (): Response =>
    options.previewError
      ? jsonResponse(
          {
            error: {
              code: "conflict",
              message: "cannot preview a clear",
            },
          },
          409,
        )
      : jsonResponse(state.preview);

  const fetchMock = vi.fn(
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;
      const method = (init.method ?? "GET").toUpperCase();
      const body = parseBody(init);
      calls.push({ method, path, body });

      if (method === "GET" && path === "/api/auth/me") {
        return jsonResponse({ user: HERO });
      }
      if (method === "GET" && path === "/api/projects/1/tags") {
        return jsonResponse([]);
      }
      if (method === "GET" && path === "/api/quests/1/messages") {
        return jsonResponse({ messages: [], hasMore: false });
      }
      if (method === "GET" && path === "/api/projects/1") {
        return jsonResponse({
          project: { id: 1, name: "달빛 길드", createdAt: NOW },
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
      if (method === "GET" && path === "/api/projects/1/chat/unread") {
        return jsonResponse({ tavern: 0, quests: [] });
      }
      if (method === "GET" && path === "/api/me/nominations") {
        return jsonResponse([]);
      }
      if (method === "GET" && path === "/api/quests/1") {
        return jsonResponse(state.quest);
      }
      if (method === "GET" && path === "/api/quests/1/events") {
        return jsonResponse(state.events);
      }
      if (method === "GET" && path === "/api/quests/1/clear-preview") {
        if (options.holdPreview) {
          const gate = deferred<Response>();
          pendingPreviews.push(gate);
          return gate.promise;
        }
        return previewResponse();
      }
      if (method === "GET" && path === "/api/projects/1/quests") {
        const stageParam = url.searchParams.get("stage");
        const stages = stageParam ? stageParam.split(",") : [];
        return jsonResponse(
          stages.length > 0
            ? state.boardQuests.filter((quest) => stages.includes(quest.stage))
            : state.boardQuests,
        );
      }
      if (method === "POST" && path === "/api/quests/1/clear") {
        state.quest = { ...state.quest, stage: "cleared" };
        return jsonResponse({
          quest: state.quest,
          rewards: [
            { userId: HERO.id, amount: 40 },
            { userId: OTHER_USER.id, amount: 20 },
          ],
          levelUps: [],
        });
      }
      if (method === "POST" && path === "/api/quests/1/unclear") {
        state.quest = { ...state.quest, stage: "boss" };
        return jsonResponse(state.quest);
      }
      if (method === "POST" && path === "/api/quests/1/move") {
        const request = body as { stage: Quest["stage"] };
        state.quest = { ...state.quest, stage: request.stage };
        state.boardQuests = state.boardQuests.map((quest) =>
          quest.id === 1 ? { ...quest, stage: request.stage } : quest,
        );
        return jsonResponse(state.quest);
      }

      return jsonResponse(
        { error: { code: "not_found", message: "not found" } },
        404,
      );
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    state,
    fetchMock,
    releasePreview(): void {
      const gate = pendingPreviews.shift();
      if (!gate) {
        throw new Error("no clear-preview request is pending");
      }
      gate.resolve(previewResponse());
    },
  };
}

function callsTo(
  calls: RecordedCall[],
  method: string,
  path: string,
): RecordedCall[] {
  return calls.filter(
    (call) => call.method === method && call.path === path,
  );
}

function createQueryClient(): QueryClient {
  return new QueryClient({
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
}

/** Invalidate-filter keys recorded by a QueryClient spy. */
function invalidatedKeys(queryClient: QueryClient): string[] {
  return vi
    .mocked(queryClient.invalidateQueries)
    .mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
}

async function openDrawer(quest: Quest, options: StubOptions = {}) {
  const api = stubApi(quest, options);
  const queryClient = createQueryClient();
  queryClient.setQueryData(queryKeys.me, { user: HERO });
  const user = userEvent.setup();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <QuestDrawer projectId={1} questId={1} onClose={vi.fn()} />
      <ToastHost />
    </QueryClientProvider>,
  );

  const dialog = await screen.findByRole("dialog", {
    name: ko.board.drawer.title,
  });
  await within(dialog).findByTestId("quest-dungeon-placeholder");
  // PartySection only renders 참여 once `/api/auth/me` resolved, so this also
  // guarantees the clear success handler knows the caller's user id.
  await within(dialog).findByRole("button", { name: ko.party.join });

  return { ...api, view, queryClient, user, dialog };
}

async function openClearConfirm(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  triggerName: string = ko.board.drawer.clear.action,
): Promise<HTMLElement> {
  await user.click(within(dialog).getByRole("button", { name: triggerName }));
  return screen.findByRole("dialog", {
    name: ko.board.drawer.clear.confirmTitle,
  });
}

async function confirmEnabled(confirm: HTMLElement): Promise<HTMLElement> {
  const button = within(confirm).getByRole("button", {
    name: ko.board.drawer.clear.action,
  });
  await waitFor(() => expect(button).not.toBeDisabled());
  return button;
}

beforeEach(() => {
  useToastStore.getState().clear();
  dndBridge.onDragEnd = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useToastStore.getState().clear();
});

describe("ClearConfirmDialog preview", () => {
  it("adds the requester bonus to the caller's preview share", () => {
    expect(
      sumMyPreviewReward(
        {
          ...PREVIEW,
          requesterBonus: { user: HERO, amount: 15 },
        },
        HERO.id,
      ),
    ).toBe(55);
    expect(
      sumMyPreviewReward(
        {
          ...PREVIEW,
          requesterBonus: { user: REQUESTER, amount: 15 },
        },
        HERO.id,
      ),
    ).toBe(40);
    expect(sumMyPreviewReward(PREVIEW, null)).toBe(0);
  });

  it("shows the total, each recipient's share and the requester bonus", async () => {
    const preview: ClearPreviewResponse = {
      ...PREVIEW,
      total: 70,
      requesterBonus: { user: REQUESTER, amount: 10 },
    };
    const { user, dialog, releasePreview } = await openDrawer(
      baseQuest({ stage: "boss" }),
      { preview, holdPreview: true },
    );

    const confirm = await openClearConfirm(
      user,
      dialog,
      ko.board.drawer.bossBattle.clear,
    );

    const confirmButton = within(confirm).getByRole("button", {
      name: ko.board.drawer.clear.action,
    });
    expect(confirmButton).toBeDisabled();
    expect(
      within(confirm).getByText(ko.board.drawer.clear.previewLoading),
    ).toBeInTheDocument();

    releasePreview();
    await waitFor(() => expect(confirmButton).not.toBeDisabled());

    expect(confirm.className).toContain("bg-paper");
    expect(confirm.className).toContain("border-[1.5px]");
    expect(confirm.className).toContain("border-line-strong");
    expect(confirm.className).toContain("shadow-hard");
    expect(confirm.className).not.toMatch(/gradient|blur|glow/);

    // F1 dialog titles use the 18px body step, not Tailwind's 16px `text-base`.
    const title = within(confirm).getByRole("heading", {
      name: ko.board.drawer.clear.confirmTitle,
    });
    expect(title).toHaveClass("text-[18px]");
    expect(title).not.toHaveClass("text-base");

    expect(
      within(confirm).getByText(ko.board.drawer.clear.totalXp(70)),
    ).toBeInTheDocument();
    expect(within(confirm).getByText(HERO.displayName)).toBeInTheDocument();
    expect(within(confirm).getByText(OTHER_USER.displayName)).toBeInTheDocument();
    expect(
      within(confirm).getByText(ko.board.drawer.clear.reward(40)),
    ).toBeInTheDocument();
    expect(
      within(confirm).getByText(ko.board.drawer.clear.reward(20)),
    ).toBeInTheDocument();
    expect(
      within(confirm).getByText(
        ko.board.drawer.clear.requesterBonus(REQUESTER.displayName, 10),
      ),
    ).toBeInTheDocument();
    expect(
      within(confirm).queryByText(ko.board.drawer.clear.notInvolved),
    ).toBeNull();
  });

  it("warns in brick when the caller is not the requester or a party member", async () => {
    const { user, dialog } = await openDrawer(
      baseQuest({ stage: "dungeon" }),
      { preview: { ...PREVIEW, actorIsInvolved: false } },
    );

    const confirm = await openClearConfirm(user, dialog);
    await waitFor(() =>
      expect(
        within(confirm).getByText(ko.board.drawer.clear.notInvolved),
      ).toBeInTheDocument(),
    );
    expect(
      within(confirm).getByText(ko.board.drawer.clear.notInvolved),
    ).toHaveClass("text-brick");
  });

  it("keeps confirm disabled when the preview fails", async () => {
    const { user, dialog } = await openDrawer(baseQuest({ stage: "board" }), {
      previewError: true,
    });

    const confirm = await openClearConfirm(user, dialog);
    await waitFor(() =>
      expect(
        within(confirm).getByText(ko.board.drawer.clear.previewFailed),
      ).toBeInTheDocument(),
    );
    expect(
      within(confirm).getByRole("button", {
        name: ko.board.drawer.clear.action,
      }),
    ).toBeDisabled();
  });
});

describe("ClearConfirmDialog cancel paths", () => {
  it("closes on Esc, scrim and 취소 without calling clear or unclear, restoring focus", async () => {
    const { calls, user } = await openDrawer(baseQuest({ stage: "boss" }));
    const trigger = within(
      screen.getByTestId("boss-banner"),
    ).getByRole("button", { name: ko.board.drawer.bossBattle.clear });

    // Esc
    let confirm = await openClearConfirm(
      user,
      screen.getByRole("dialog", { name: ko.board.drawer.title }),
      ko.board.drawer.bossBattle.clear,
    );
    const cancel = within(confirm).getByRole("button", {
      name: ko.common.cancel,
    });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.keyDown(cancel, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: ko.board.drawer.clear.confirmTitle,
        }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("dialog", { name: ko.board.drawer.title }),
    ).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    // Scrim
    await user.click(trigger);
    confirm = await screen.findByRole("dialog", {
      name: ko.board.drawer.clear.confirmTitle,
    });
    const scrim = document.querySelector<HTMLElement>(
      "[data-clear-confirm]",
    );
    expect(scrim).not.toBeNull();
    fireEvent.mouseDown(scrim!);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: ko.board.drawer.clear.confirmTitle,
        }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());

    // 취소 button
    await user.click(trigger);
    confirm = await screen.findByRole("dialog", {
      name: ko.board.drawer.clear.confirmTitle,
    });
    await user.click(
      within(confirm).getByRole("button", { name: ko.common.cancel }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: ko.board.drawer.clear.confirmTitle,
        }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());

    expect(callsTo(calls, "POST", "/api/quests/1/clear")).toHaveLength(0);
    expect(callsTo(calls, "POST", "/api/quests/1/unclear")).toHaveLength(0);
  });
});

describe("clear success toast", () => {
  it("queues the 10s toast and its 되돌리기 action calls unclear", async () => {
    const { calls, user, dialog, queryClient } = await openDrawer(
      baseQuest({ stage: "board" }),
    );
    vi.spyOn(queryClient, "invalidateQueries");

    const confirm = await openClearConfirm(user, dialog);
    await user.click(await confirmEnabled(confirm));

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/clear")).toHaveLength(1),
    );

    const message = ko.board.drawer.clear.success(40);
    await screen.findByText(message);
    const toast = useToastStore
      .getState()
      .toasts.find((entry) => entry.message === message);
    expect(toast?.durationMs).toBe(10_000);
    expect(toast?.action?.label).toBe(ko.board.drawer.clear.undo);

    // Clear invalidates the quest, board list, events, bell, me and project.
    const keysAfterClear = invalidatedKeys(queryClient);
    for (const expected of [
      queryKeys.quest(1),
      ["quests", 1],
      queryKeys.events(1),
      queryKeys.notifications,
      queryKeys.me,
      queryKeys.project(1),
    ]) {
      expect(keysAfterClear).toContain(JSON.stringify(expected));
    }

    await user.click(
      screen.getByRole("button", { name: ko.board.drawer.clear.undo }),
    );

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/unclear")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.queryByText(message)).not.toBeInTheDocument(),
    );
    expect(
      queryClient.getQueryData<Quest>(queryKeys.quest(1))?.stage,
    ).toBe("boss");

    const keysAfterUnclear = invalidatedKeys(queryClient);
    for (const expected of [
      queryKeys.quest(1),
      ["quests", 1],
      queryKeys.events(1),
      queryKeys.notifications,
      queryKeys.me,
      queryKeys.project(1),
    ]) {
      expect(keysAfterUnclear).toContain(JSON.stringify(expected));
    }

    // The dialog and the toast share one clear request, not one per click.
    expect(callsTo(calls, "POST", "/api/quests/1/clear")).toHaveLength(1);
  });

  it("goes back to boss from the cleared drawer after confirming 클리어 취소", async () => {
    const { calls, user, dialog, queryClient } = await openDrawer(
      baseQuest({ stage: "cleared" }),
      { events: [clearedEvent()] },
    );

    const revoke = within(dialog).getByRole("button", {
      name: ko.board.drawer.unclear.action,
    });
    expect(revoke.className).toContain("border-brick");

    await user.click(revoke);
    let confirm = await screen.findByRole("dialog", {
      name: ko.board.drawer.unclear.confirmTitle,
    });
    expect(
      within(confirm).getByText(ko.board.drawer.unclear.confirm(60)),
    ).toBeInTheDocument();

    const title = within(confirm).getByRole("heading", {
      name: ko.board.drawer.unclear.confirmTitle,
    });
    expect(title).toHaveClass("text-[18px]");
    expect(title).not.toHaveClass("text-base");

    // Cancelling the revoke must not call unclear.
    await user.click(
      within(confirm).getByRole("button", { name: ko.common.cancel }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: ko.board.drawer.unclear.confirmTitle,
        }),
      ).not.toBeInTheDocument(),
    );
    expect(callsTo(calls, "POST", "/api/quests/1/unclear")).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", {
        name: ko.board.drawer.unclear.action,
      }),
    );
    confirm = await screen.findByRole("dialog", {
      name: ko.board.drawer.unclear.confirmTitle,
    });
    await user.click(
      within(confirm).getByRole("button", {
        name: ko.board.drawer.unclear.action,
      }),
    );

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/unclear")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.getByTestId("boss-banner")).toBeInTheDocument(),
    );
    expect(
      queryClient.getQueryData<Quest>(queryKeys.quest(1))?.stage,
    ).toBe("boss");
  });
});

describe("BoardPage cleared-column drop", () => {
  it("waits for the clear dialog and only moves the card after confirmation", async () => {
    const preview: ClearPreviewResponse = {
      ...PREVIEW,
      total: 70,
      requesterBonus: {
        user: { id: HERO.id, displayName: HERO.displayName },
        amount: 10,
      },
    };
    const api = stubApi(baseQuest({ stage: "board" }), {
      boardQuests: BOARD_SUMMARIES,
      preview,
    });
    const queryClient = createQueryClient();
    queryClient.setQueryData(queryKeys.me, { user: HERO });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/g/1"]}>
          <Routes>
            <Route path="/g/:projectId" element={<BoardPage />} />
          </Routes>
        </MemoryRouter>
        <ToastHost />
      </QueryClientProvider>,
    );

    await screen.findByText("클리어 의뢰");
    expect(dndBridge.onDragEnd).not.toBeNull();

    act(() => {
      dndBridge.onDragEnd?.({
        active: { id: 1 },
        over: { id: "column:cleared" },
      });
    });

    const confirm = await screen.findByRole("dialog", {
      name: ko.board.drawer.clear.confirmTitle,
    });
    expect(
      await within(confirm).findByText(ko.board.drawer.clear.totalXp(70)),
    ).toBeInTheDocument();

    // Nothing moved: no move request and the card is still on the board.
    expect(callsTo(api.calls, "POST", "/api/quests/1/move")).toHaveLength(0);
    const boardColumn = screen.getByRole("region", {
      name: ko.board.columns.board,
    });
    expect(within(boardColumn).getByText("클리어 의뢰")).toBeInTheDocument();

    await user.click(await confirmEnabled(confirm));

    await waitFor(() =>
      expect(callsTo(api.calls, "POST", "/api/quests/1/move")).toHaveLength(1),
    );
    expect(callsTo(api.calls, "POST", "/api/quests/1/move")[0]?.body).toMatchObject(
      { stage: "cleared" },
    );

    // The move response has no rewards, so the toast's +N comes from the
    // clear preview the dialog fetched: my party share (40) + requester
    // bonus (10).
    const message = ko.board.drawer.clear.success(50);
    await screen.findByText(message);
    expect(
      useToastStore
        .getState()
        .toasts.find((entry) => entry.message === message)?.durationMs,
    ).toBe(10_000);

    await waitFor(() =>
      expect(
        within(
          screen.getByRole("region", { name: ko.board.columns.cleared }),
        ).getByText("클리어 의뢰"),
      ).toBeInTheDocument(),
    );
  });
});

describe("toast durations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().clear();
  });

  afterEach(() => {
    useToastStore.getState().clear();
    vi.useRealTimers();
  });

  it("keeps the original pushToast 4s default", () => {
    render(<ToastHost />);
    act(() => {
      pushToast("기본 토스트");
    });

    expect(screen.getByText("기본 토스트")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(screen.getByText("기본 토스트")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("기본 토스트")).toBeNull();
  });

  it("renders the action button and keeps a 10s action toast", () => {
    const onClick = vi.fn();
    render(<ToastHost />);
    act(() => {
      pushToast("액션 토스트", {
        durationMs: 10_000,
        action: { label: ko.board.drawer.clear.undo, onClick },
      });
    });

    expect(useToastStore.getState().toasts[0]?.durationMs).toBe(10_000);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.getByText("액션 토스트")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000 - TOAST_DURATION_MS - 1);
    });
    expect(screen.getByText("액션 토스트")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: ko.board.drawer.clear.undo }),
    );
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("액션 토스트")).toBeNull();
  });
});
