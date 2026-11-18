// @vitest-environment node
/**
 * Party chat in the quest drawer (M2b T05).
 *
 * The drawer timeline interleaves party messages with the quest's key events
 * (oldest first, events before messages on equal timestamps). Non-key edits
 * such as `quest_edited` stay out of the timeline and only appear in the
 * adventure log behind [전체 기록 보기]. Backwards paging loads the page before
 * the oldest loaded message, and the composer's send/delete paths refresh the
 * room, the quest events and the board's unread badges.
 *
 * As in the other DOM tests, jsdom is installed manually because Vitest cannot
 * resolve the workspace-local copy from the hoisted runner.
 */
import "./domEnvironment";

import type {
  ChatMessage,
  MessagePageResponse,
  ProjectDetailResponse,
  Quest,
  QuestEvent,
  UserProfile,
} from "@guildloom/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuestChat } from "../src/components/quest/QuestChat";
import { QuestDrawer } from "../src/components/quest/QuestDrawer";
import { ko } from "../src/i18n/ko";
import { mergeChatTimeline } from "../src/lib/chatTimeline";
import { queryKeys } from "../src/lib/queryKeys";

const NOW = Date.UTC(2026, 0, 2, 3, 0, 0);

const HERO: UserProfile = {
  id: 1,
  loginId: "hero",
  displayName: "김모험",
  xp: 150,
  level: 2,
};

const PROJECT: ProjectDetailResponse = {
  project: { id: 1, name: "달빛 길드", createdAt: NOW },
  members: [
    { userId: 1, displayName: "김모험", role: "owner", xp: 150, level: 2 },
    { userId: 2, displayName: "이모험", role: "member", xp: 40, level: 1 },
  ],
};

const QUEST: Quest = {
  id: 1,
  number: 7,
  title: "로그인 버그",
  stage: "board",
  kind: "fix",
  rank: "B",
  orderKey: "a0",
  tags: [],
  createdBy: { id: 1, displayName: "김모험" },
  createdAt: NOW,
  updatedAt: NOW,
  party: [],
  pendingNominations: 0,
  bounty: { base: 150, multiplier: 1, total: 150, days: 0, dusty: false },
  projectId: 1,
  situation: "상황",
  direction: "- [ ] 재현",
  archiveReason: null,
  nominations: [],
  floors: { done: 0, total: 1 },
  refs: [],
  firstClaimedAt: NOW,
};

function message(
  id: number,
  authorId: number,
  createdAt: number,
  body = `메시지 ${id}`,
): ChatMessage {
  return {
    id,
    projectId: 1,
    questId: 1,
    kind: "user",
    author: {
      id: authorId,
      displayName: authorId === 1 ? "김모험" : "이모험",
    },
    familiarId: null,
    body,
    payload: null,
    promotedQuest: null,
    createdAt,
    deletedAt: null,
  };
}

function event(
  id: number,
  type: QuestEvent["type"],
  payload: unknown,
  createdAt: number,
): QuestEvent {
  return {
    id,
    questId: 1,
    projectId: 1,
    type,
    payload,
    actor: { id: 2, displayName: "이모험" },
    familiarId: null,
    createdAt,
  };
}

const POSTED = event(
  100,
  "quest_posted",
  { number: 7, title: "로그인 버그" },
  NOW + 1_500,
);
const EDITED = event(101, "quest_edited", { fields: ["tags"] }, NOW + 2_500);
const BOSS = event(102, "boss_engaged", {}, NOW + 3_000);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function noContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    statusText: "No Content",
    json: async () => {
      throw new Error("204 responses have no body");
    },
    text: async () => "",
  } as unknown as Response;
}

interface StubOptions {
  /** Message pages served in request order. */
  pages?: MessagePageResponse[];
  /** Events served by `GET /api/quests/1/events` for the drawer test. */
  events?: QuestEvent[];
}

function stubApi({
  pages = [{ messages: [], hasMore: false }],
  events = [],
}: StubOptions = {}) {
  const calls: { method: string; path: string; search: string; body: unknown }[] =
    [];
  const messageRequests: URL[] = [];
  const remaining = [...pages];

  const fetchMock = vi.fn(
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = new URL(String(input), "http://localhost");
      const method = (init.method ?? "GET").toUpperCase();
      const body =
        init.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({
        method,
        path: url.pathname,
        search: url.search,
        body,
      });

      if (method === "GET" && url.pathname === "/api/auth/me") {
        return jsonResponse({ user: HERO });
      }
      if (method === "GET" && url.pathname === "/api/projects/1") {
        return jsonResponse(PROJECT);
      }
      if (method === "GET" && url.pathname === "/api/projects/1/tags") {
        return jsonResponse([]);
      }
      if (method === "GET" && url.pathname === "/api/projects/1/chat/unread") {
        return jsonResponse({ tavern: 0, quests: [] });
      }
      if (method === "POST" && url.pathname === "/api/projects/1/chat/read") {
        return noContentResponse();
      }
      if (method === "GET" && url.pathname === "/api/quests/1") {
        return jsonResponse(QUEST);
      }
      if (method === "GET" && url.pathname === "/api/quests/1/events") {
        return jsonResponse(events);
      }
      if (method === "GET" && url.pathname === "/api/quests/1/messages") {
        messageRequests.push(url);
        const page = remaining.shift() ?? { messages: [], hasMore: false };
        return jsonResponse(page);
      }
      if (method === "POST" && url.pathname === "/api/quests/1/messages") {
        const created = message(
          99,
          HERO.id,
          NOW + 4_000,
          (body as { body: string }).body,
        );
        return jsonResponse(created, 201);
      }
      if (method === "DELETE" && /^\/api\/messages\/\d+$/.test(url.pathname)) {
        return noContentResponse();
      }

      return jsonResponse(
        { error: { code: "not_found", message: "not found" } },
        404,
      );
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  return { fetchMock, calls, messageRequests };
}

function makeQueryClient(): QueryClient {
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

function renderChat(
  options: StubOptions & { events?: QuestEvent[] } = {},
) {
  const api = stubApi(options);
  const queryClient = makeQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <QuestChat
          projectId={1}
          questId={1}
          events={options.events ?? []}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, ...api, queryClient, user: userEvent.setup() };
}

function renderDrawer(events: QuestEvent[]) {
  const api = stubApi({ events });
  const queryClient = makeQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <QuestDrawer projectId={1} questId={1} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, ...api, queryClient, user: userEvent.setup() };
}

function timelineKinds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-timeline-kind]"),
  ).map((row) => row.dataset.timelineKind ?? "");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mergeChatTimeline", () => {
  it("interleaves messages and key events by time, events first on ties", () => {
    const messages = [
      message(10, 2, 1_000),
      message(11, 1, 1_500),
      message(12, 2, 2_000),
    ];
    const events = [
      event(100, "quest_posted", { number: 1, title: "의뢰" }, 1_200),
      // Ties with message 11 and 12: the system line comes first.
      event(101, "member_joined", {}, 1_500),
      event(102, "boss_engaged", {}, 2_000),
    ];

    const timeline = mergeChatTimeline(messages, events, { hasMore: false });

    expect(
      timeline.map((item) =>
        item.kind === "message" ? `m${item.message.id}` : `e${item.event.id}`,
      ),
    ).toEqual(["m10", "e100", "e101", "m11", "e102", "m12"]);
    expect(timeline.map((item) => item.createdAt)).toEqual([
      1_000, 1_200, 1_500, 1_500, 2_000, 2_000,
    ]);
  });

  it("excludes non-key events such as quest_edited", () => {
    const messages = [message(10, 2, 1_000)];
    const events = [
      event(100, "quest_posted", { number: 1, title: "의뢰" }, 1_100),
      event(101, "quest_edited", { fields: ["tags"] }, 1_200),
      event(102, "ref_added", { refId: 1, target: "a", label: null }, 1_300),
      event(103, "quest_moved", { from: "board", to: "dungeon" }, 1_400),
    ];

    const timeline = mergeChatTimeline(messages, events, { hasMore: false });

    expect(
      timeline.filter((item) => item.kind === "event").map((item) => item.event.id),
    ).toEqual([100]);
  });

  it("drops events older than the oldest loaded message while history remains", () => {
    const messages = [message(10, 2, 2_000), message(11, 1, 3_000)];
    const events = [
      event(100, "quest_posted", { number: 1, title: "의뢰" }, 1_999),
      event(101, "member_joined", {}, 2_000),
      event(102, "boss_engaged", {}, 2_500),
    ];

    expect(
      mergeChatTimeline(messages, events, { hasMore: true }).map((item) =>
        item.kind === "message" ? `m${item.message.id}` : `e${item.event.id}`,
      ),
    ).toEqual(["e101", "m10", "e102", "m11"]);

    // The newest page has no older history, so every key event is shown.
    expect(
      mergeChatTimeline(messages, events, { hasMore: false }),
    ).toHaveLength(5);

    // With no message loaded yet the event history is kept as-is even while
    // older pages are still pending.
    expect(
      mergeChatTimeline([], events, { hasMore: true }).map((item) =>
        item.kind === "event" ? item.event.id : -1,
      ),
    ).toEqual([100, 101, 102]);
  });
});

describe("QuestChat timeline", () => {
  it("renders the mixed timeline, excludes non-key events and breaks groups on events", async () => {
    const messages = [
      message(10, 2, NOW + 1_000),
      message(11, 2, NOW + 2_000, "두 번째"),
      message(12, 2, NOW + 2_100, "세 번째"),
    ];
    const events = [POSTED, EDITED, BOSS];
    const view = renderChat({
      events,
      pages: [{ messages, hasMore: false }],
    });

    await view.findByText("메시지 10");

    const scroll = view.getByTestId("party-chat-scroll");
    expect(scroll).toHaveClass("max-h-[360px]", "overflow-y-auto");
    expect(timelineKinds(scroll)).toEqual([
      "message",
      "event",
      "message",
      "message",
      "event",
    ]);

    // Grouping: an event between same-author messages breaks the group; the
    // following message with no event in between stays grouped.
    const m10 = scroll.querySelector<HTMLElement>("[data-message-id='10']");
    const m11 = scroll.querySelector<HTMLElement>("[data-message-id='11']");
    const m12 = scroll.querySelector<HTMLElement>("[data-message-id='12']");
    expect(m10).not.toHaveAttribute("data-grouped");
    expect(m11).not.toHaveAttribute("data-grouped");
    expect(m12).toHaveAttribute("data-grouped", "true");

    // Event rows are avatar-less muted lines with the shared segment classes.
    const eventRows = Array.from(
      scroll.querySelectorAll<HTMLElement>("[data-timeline-kind='event']"),
    );
    expect(eventRows).toHaveLength(2);
    for (const row of eventRows) {
      expect(row.querySelector("[data-user-id]")).toBeNull();
      expect(row.querySelector("img")).toBeNull();
      expect(row.querySelector("p")).toHaveClass("text-xs", "text-muted");
    }
    const postedRow = eventRows[0]!;
    expect(postedRow).toHaveTextContent("'이모험'");
    expect(
      postedRow.querySelector("[data-segment='actor']"),
    ).toHaveClass("font-medium", "text-ink");
    expect(
      postedRow.querySelector("[data-segment='quest']"),
    ).toHaveClass("text-teal");

    // quest_edited is not a key event: it never enters the party timeline.
    expect(scroll.textContent).not.toContain("의뢰 내용을 고쳤습니다");
    expect(within(scroll).queryByText(/의뢰 내용을 고쳤습니다/)).toBeNull();

    // The adventure log keeps every event behind its toggle.
    expect(
      view.getByRole("heading", { name: ko.board.drawer.history }),
    ).toBeInTheDocument();
    expect(
      view.getByRole("button", {
        name: ko.board.drawer.showAllHistory(events.length),
      }),
    ).toBeInTheDocument();
  });

  it("pages backwards from the oldest loaded message", async () => {
    const view = renderChat({
      pages: [
        {
          messages: [message(10, 2, NOW + 1_000), message(11, 2, NOW + 2_000)],
          hasMore: true,
        },
        {
          messages: [message(9, 1, NOW)],
          hasMore: false,
        },
      ],
    });

    const more = await view.findByRole("button", { name: ko.chat.loadMore });
    await view.user.click(more);

    await waitFor(() =>
      expect(
        view.container.querySelector("[data-message-id='9']"),
      ).not.toBeNull(),
    );
    const ids = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-message-id]"),
    ).map((row) => Number(row.dataset.messageId));
    expect(ids).toEqual([9, 10, 11]);
    expect(view.queryByRole("button", { name: ko.chat.loadMore })).toBeNull();

    expect(view.messageRequests).toHaveLength(2);
    expect(view.messageRequests[0]!.searchParams.get("before")).toBeNull();
    expect(view.messageRequests[0]!.searchParams.get("limit")).toBe("50");
    expect(view.messageRequests[1]!.searchParams.get("before")).toBe("10");
    expect(view.messageRequests[1]!.searchParams.get("limit")).toBe("50");
  });

  it("posts through the party composer and invalidates the room, events and badges", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    try {
      const view = renderChat({
        pages: [{ messages: [message(10, 2, NOW + 1_000)], hasMore: false }],
        events: [POSTED],
      });
      // Seed the caches the invalidation targets even though this isolated
      // section has no observer for the events/unread queries.
      view.queryClient.setQueryData(queryKeys.events(1), [POSTED]);
      view.queryClient.setQueryData(queryKeys.chatUnread(1), {
        tavern: 0,
        quests: [],
      });

      const composer = await view.findByPlaceholderText(
        ko.partyChat.composerPlaceholder,
      );
      const requestsBefore = view.messageRequests.length;
      await view.user.type(composer, "@이모험 확인 부탁해");
      await view.user.click(
        view.getByRole("button", { name: ko.chat.send }),
      );

      await waitFor(() =>
        expect(
          view.calls.some(
            (call) =>
              call.method === "POST" && call.path === "/api/quests/1/messages",
          ),
        ).toBe(true),
      );
      const post = view.calls.find(
        (call) =>
          call.method === "POST" && call.path === "/api/quests/1/messages",
      );
      expect(post?.body).toEqual({ body: "<@2> 확인 부탁해" });

      await waitFor(() =>
        expect(view.messageRequests.length).toBeGreaterThan(requestsBefore),
      );
      expect(
        view.queryClient.getQueryState(queryKeys.events(1))?.isInvalidated,
      ).toBe(true);
      expect(
        view.queryClient.getQueryState(queryKeys.chatUnread(1))?.isInvalidated,
      ).toBe(true);
    } finally {
      delete (document as unknown as Record<string, unknown>)
        .visibilityState;
    }
  });

  it("deletes the author's own message and invalidates the same caches", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    try {
      const view = renderChat({
        pages: [
          {
            messages: [message(10, 1, NOW + 1_000, "내 메시지")],
            hasMore: false,
          },
        ],
        events: [],
      });
      view.queryClient.setQueryData(queryKeys.events(1), []);
      view.queryClient.setQueryData(queryKeys.chatUnread(1), {
        tavern: 0,
        quests: [],
      });
      await view.findByText("내 메시지");

      await view.user.click(view.getByRole("button", { name: ko.common.delete }));
      const dialog = await view.findByRole("dialog", {
        name: ko.chat.deleteConfirm,
      });
      const requestsBefore = view.messageRequests.length;
      await view.user.click(
        within(dialog).getByRole("button", { name: ko.common.delete }),
      );

      await waitFor(() =>
        expect(
          view.calls.some(
            (call) =>
              call.method === "DELETE" && call.path === "/api/messages/10",
          ),
        ).toBe(true),
      );
      await waitFor(() =>
        expect(view.messageRequests.length).toBeGreaterThan(requestsBefore),
      );
      expect(
        view.queryClient.getQueryState(queryKeys.events(1))?.isInvalidated,
      ).toBe(true);
      expect(
        view.queryClient.getQueryState(queryKeys.chatUnread(1))?.isInvalidated,
      ).toBe(true);
    } finally {
      delete (document as unknown as Record<string, unknown>)
        .visibilityState;
    }
  });

  it("marks the newest loaded message read while the section is mounted", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    try {
      const view = renderChat({
        pages: [
          {
            messages: [message(10, 2, NOW + 1_000), message(11, 2, NOW + 2_000)],
            hasMore: false,
          },
        ],
      });

      await waitFor(() => {
        const read = view.calls.find(
          (call) =>
            call.method === "POST" &&
            call.path === "/api/projects/1/chat/read",
        );
        expect(read).toBeDefined();
        expect(read?.body).toEqual({ questId: 1, messageId: 11 });
      });
    } finally {
      delete (document as unknown as Record<string, unknown>)
        .visibilityState;
    }
  });
});

describe("QuestDrawer party chat", () => {
  it("shows 파티 채팅 and expands the full adventure log", async () => {
    const view = renderDrawer([POSTED, EDITED, BOSS]);

    const dialog = await view.findByRole("dialog", {
      name: ko.board.drawer.title,
    });

    expect(
      await within(dialog).findByRole("heading", {
        name: ko.partyChat.title,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByPlaceholderText(ko.partyChat.composerPlaceholder),
    ).toBeInTheDocument();
    // No command handler: `/의뢰` is plain party text.
    expect(
      within(dialog).queryByText("아직 큰 사건은 없습니다"),
    ).toBeNull();

    expect(dialog.querySelectorAll("[data-event-id]")).toHaveLength(0);
    const toggle = await within(dialog).findByRole("button", {
      name: ko.board.drawer.showAllHistory(3),
    });
    await view.user.click(toggle);

    await waitFor(() =>
      expect(
        Array.from(
          dialog.querySelectorAll<HTMLElement>("[data-event-id]"),
        ).map((row) => Number(row.dataset.eventId)),
      ).toEqual([100, 101, 102]),
    );
  });
});
