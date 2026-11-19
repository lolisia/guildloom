// @vitest-environment node
/**
 * 주점 (tavern) screen, message list and unread badge.
 *
 * The list tests pin the visual contract (24px avatar, grouped rows, deleted
 * copy, system `?quest=` links, promoted chips and hover actions). The screen
 * tests drive the `/의뢰` command and the 의뢰로 만들기 dialog against a stubbed
 * API, and the tab test checks the 99+ cap and aria-label on the unread badge.
 */
import "./domEnvironment";

import type {
  ChatMessage,
  ProjectDetailResponse,
  ProjectSummary,
  UserProfile,
} from "@guildloom/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import MessageList from "../src/components/chat/MessageList";
import { ko } from "../src/i18n/ko";
import { AppRoutes } from "../src/router";

vi.mock("socket.io-client", () => {
  const socket = {
    connected: false,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };

  return { io: vi.fn(() => socket) };
});

const NOW = Date.UTC(2026, 0, 2, 3, 0, 0);

const HERO: UserProfile = {
  id: 1,
  loginId: "hero",
  displayName: "김모험",
  xp: 150,
  level: 2,
};

const PROJECT_SUMMARIES: ProjectSummary[] = [
  { id: 1, name: "달빛 길드", role: "owner" },
];

const PROJECT_DETAIL: ProjectDetailResponse = {
  project: { id: 1, name: "달빛 길드", createdAt: NOW },
  members: [
    { userId: 1, displayName: "김모험", role: "owner", xp: 150, level: 2 },
    { userId: 2, displayName: "김철수", role: "member", xp: 0, level: 1 },
  ],
};

const NAMES = new Map<number, string>([
  [1, "김모험"],
  [2, "김철수"],
]);

function resolveName(userId: number): string | null {
  return NAMES.get(userId) ?? null;
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 1,
    projectId: 1,
    questId: null,
    kind: "user",
    author: { id: 2, displayName: "김철수" },
    familiarId: null,
    body: "",
    payload: null,
    promotedQuest: null,
    createdAt: NOW,
    deletedAt: null,
    ...overrides,
  };
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

function errorResponse(status: number, code: string): Response {
  return jsonResponse({ error: { code, message: code } }, status);
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

interface RecordedCall {
  method: string;
  path: string;
  body?: string;
}

interface StubOptions {
  messages?: ChatMessage[];
  hasMore?: boolean;
  unread?: number;
  promoteConflict?: boolean;
}

/** Stubbed tavern API shared by the screen tests. */
function stubApi(options: StubOptions = {}) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;
      const method = (init.method ?? "GET").toUpperCase();
      calls.push({
        method,
        path,
        body: typeof init.body === "string" ? init.body : undefined,
      });

      if (method === "GET" && path === "/api/setup/status") {
        return jsonResponse({ needsSetup: false });
      }
      if (method === "GET" && path === "/api/auth/me") {
        return jsonResponse({ user: HERO });
      }
      if (method === "GET" && path === "/api/projects") {
        return jsonResponse(PROJECT_SUMMARIES);
      }
      if (method === "GET" && path === "/api/projects/1") {
        return jsonResponse(PROJECT_DETAIL);
      }
      if (method === "GET" && path === "/api/projects/1/tavern/messages") {
        return jsonResponse({
          messages: options.messages ?? [],
          hasMore: options.hasMore ?? false,
        });
      }
      if (method === "GET" && path === "/api/projects/1/chat/unread") {
        return jsonResponse({ tavern: options.unread ?? 0, quests: [] });
      }
      if (method === "POST" && path === "/api/projects/1/chat/read") {
        return noContentResponse();
      }
      if (method === "POST" && path === "/api/projects/1/tavern/messages") {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          body: string;
        };
        return jsonResponse(
          message({ id: 999, body: body.body, createdAt: NOW }),
        );
      }
      if (method === "POST" && path === "/api/projects/1/tavern/quests") {
        if (options.promoteConflict === true) {
          return errorResponse(409, "conflict");
        }
        return jsonResponse({
          quest: { id: 9, number: 42, title: "제목" },
          message: message({ id: 999, kind: "system" }),
        });
      }

      return errorResponse(404, "not_found");
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function renderTavern() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        gcTime: Infinity,
      },
    },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/g/1/tavern"]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, queryClient, user: userEvent.setup() };
}

function composerFor(view: ReturnType<typeof renderTavern>) {
  return view.findByRole("textbox", { name: ko.chat.tavernPlaceholder });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MessageList", () => {
  const LIST_MESSAGES: ChatMessage[] = [
    message({ id: 1, body: "첫 메시지", createdAt: NOW }),
    message({ id: 2, body: "두 번째", createdAt: NOW + 4 * 60_000 }),
    message({
      id: 3,
      author: { id: 1, displayName: "김모험" },
      body: "다른 사람",
      createdAt: NOW + 5 * 60_000,
    }),
    message({
      id: 4,
      author: { id: 1, displayName: "김모험" },
      body: "지울 메시지",
      createdAt: NOW + 20 * 60_000,
      deletedAt: NOW + 21 * 60_000,
    }),
    message({
      id: 5,
      kind: "system",
      author: { id: 1, displayName: "김모험" },
      body: "system",
      createdAt: NOW + 21 * 60_000,
      payload: {
        type: "quest_created",
        questId: 7,
        questNumber: 12,
        questTitle: "로그인 버그",
      },
    }),
    message({
      id: 6,
      body: "승격된 메시지",
      createdAt: NOW + 22 * 60_000,
      promotedQuest: { id: 9, number: 42, title: "승격된 의뢰" },
    }),
  ];

  function renderList(overrides: Partial<Parameters<typeof MessageList>[0]> = {}) {
    const onPromote = vi.fn();
    const onDelete = vi.fn(async () => undefined);
    const onLoadMore = vi.fn();
    const view = render(
      <MemoryRouter>
        <MessageList
          messages={LIST_MESSAGES}
          hasMore={false}
          onLoadMore={onLoadMore}
          projectId={1}
          meId={1}
          resolveName={resolveName}
          onDelete={onDelete}
          onPromote={onPromote}
          emptyText={ko.chat.tavernEmpty}
          {...overrides}
        />
      </MemoryRouter>,
    );
    return { ...view, user: userEvent.setup(), onPromote, onDelete, onLoadMore };
  }

  it("renders rows oldest-first with avatars, names and times", () => {
    const view = renderList();
    const rows = view.container.querySelectorAll("[data-message-id]");
    expect(
      [...rows].map((row) => row.getAttribute("data-message-id")),
    ).toEqual(["1", "2", "3", "4", "5", "6"]);

    const first = view.container.querySelector(
      '[data-message-id="1"]',
    ) as HTMLElement;
    const avatar = first.querySelector('[data-user-id="2"]');
    expect(avatar).not.toBeNull();
    expect(avatar?.className).toContain("h-6");
    expect(avatar?.className).toContain("w-6");

    const name = within(first).getByText("김철수");
    expect(name.className).toContain("text-[14px]");
    expect(name.className).toContain("font-semibold");

    const time = first.querySelector("time") as HTMLElement;
    expect(time).not.toBeNull();
    expect(time.className).toContain("text-xs");
    expect(time.className).toContain("text-muted");
    expect(time.getAttribute("dateTime")).toBe(
      new Date(NOW).toISOString(),
    );
  });

  it("groups same-author messages within five minutes", () => {
    const view = renderList();
    const grouped = view.container.querySelector(
      '[data-message-id="2"]',
    ) as HTMLElement;
    expect(grouped).toHaveAttribute("data-grouped", "true");
    expect(grouped.querySelector('[data-user-id="2"]')).toBeNull();

    const nextAuthor = view.container.querySelector(
      '[data-message-id="3"]',
    ) as HTMLElement;
    expect(nextAuthor).not.toHaveAttribute("data-grouped");

    // A grouped row keeps the compact body aligned under the avatar column.
    expect(within(grouped).queryByText("김철수")).toBeNull();
  });

  it("renders deleted copy, system lines and promoted chips", () => {
    const view = renderList();

    const deleted = view.container.querySelector(
      '[data-message-id="4"]',
    ) as HTMLElement;
    const deletedCopy = within(deleted).getByText(ko.chat.deleted);
    expect(deletedCopy.className).toContain("text-muted");

    const system = view.container.querySelector(
      '[data-message-id="5"]',
    ) as HTMLElement;
    expect(system.getAttribute("data-message-kind")).toBe("system");
    expect(system.querySelector('[role="img"]')).toBeNull();
    expect(system).toHaveTextContent("김모험 가 의뢰 #12 '로그인 버그'");
    expect(system).not.toHaveTextContent("누군가");
    const systemLink = within(system).getByRole("link", {
      name: ko.chat.viewQuest(12),
    });
    expect(systemLink).toHaveAttribute("href", "/g/1?quest=7");

    const promoted = view.container.querySelector(
      '[data-message-id="6"]',
    ) as HTMLElement;
    const promotedLink = within(promoted).getByRole("link", {
      name: ko.chat.promoted(42),
    });
    expect(promotedLink).toHaveAttribute("href", "/g/1?quest=9");
  });

  it("shows row actions only where they are allowed", () => {
    const view = renderList();

    const tavernMessage = view.container.querySelector(
      '[data-message-id="1"]',
    ) as HTMLElement;
    expect(
      within(tavernMessage).getByRole("button", {
        name: ko.chat.promote,
      }),
    ).toBeInTheDocument();
    expect(
      within(tavernMessage).queryByRole("button", {
        name: ko.common.delete,
      }),
    ).toBeNull();

    const mine = view.container.querySelector(
      '[data-message-id="3"]',
    ) as HTMLElement;
    expect(
      within(mine).getByRole("button", { name: ko.common.delete }),
    ).toBeInTheDocument();
    // My own tavern message can still become a quest, as long as it was not
    // promoted before.
    expect(
      within(mine).getByRole("button", { name: ko.chat.promote }),
    ).toBeInTheDocument();

    const promoted = view.container.querySelector(
      '[data-message-id="6"]',
    ) as HTMLElement;
    expect(within(promoted).queryByRole("button")).toBeNull();

    const deleted = view.container.querySelector(
      '[data-message-id="4"]',
    ) as HTMLElement;
    expect(within(deleted).queryByRole("button")).toBeNull();

    const actions = view.container.querySelector(
      '[data-message-id="1"] .group-hover\\:opacity-100',
    );
    expect(actions).not.toBeNull();
  });

  it("confirms author-only deletion with the shared dialog", async () => {
    const view = renderList();
    const mine = view.container.querySelector(
      '[data-message-id="3"]',
    ) as HTMLElement;

    await view.user.click(
      within(mine).getByRole("button", { name: ko.common.delete }),
    );
    const dialog = view.getByRole("dialog", {
      name: ko.chat.deleteConfirm,
    });
    expect(dialog).toBeInTheDocument();

    await view.user.click(
      within(dialog).getByRole("button", { name: ko.common.cancel }),
    );
    expect(view.queryByRole("dialog")).toBeNull();

    await view.user.click(
      within(mine).getByRole("button", { name: ko.common.delete }),
    );
    await view.user.click(
      within(view.getByRole("dialog")).getByRole("button", {
        name: ko.common.delete,
      }),
    );
    await waitFor(() => {
      expect(view.onDelete).toHaveBeenCalledWith(
        expect.objectContaining({ id: 3 }),
      );
    });
  });

  it("shows the empty state and the explicit history button", async () => {
    const view = renderList({ messages: [], hasMore: true });
    expect(await view.findByText(ko.chat.tavernEmpty)).toBeInTheDocument();

    const more = view.getByRole("button", { name: ko.chat.loadMore });
    await view.user.click(more);
    expect(view.onLoadMore).toHaveBeenCalled();
  });
});

describe("TavernPage", () => {
  it("renders the pixel title, empty copy and composer placeholder", async () => {
    stubApi();
    const view = renderTavern();

    const heading = await view.findByRole("heading", {
      name: ko.chat.title,
    });
    expect(heading.className).toContain("font-pixel");
    expect(heading.className).toContain("text-[16px]");

    const section = heading.closest("section") as HTMLElement;
    expect(section.className).toContain("mx-auto");
    expect(section.className).toContain("max-w-screen-lg");

    expect(
      await view.findByText(ko.chat.tavernEmpty),
    ).toBeInTheDocument();
    expect(
      view.getByRole("textbox", { name: ko.chat.tavernPlaceholder }),
    ).toBeInTheDocument();
  });

  it("posts /의뢰 제목 + 상황 to the tavern quest endpoint and not as a message", async () => {
    const { calls } = stubApi({ messages: [] });
    const view = renderTavern();
    const textarea = await composerFor(view);

    await view.user.type(textarea, "/의뢰 제목");
    await view.user.keyboard("{Shift>}{Enter}{/Shift}");
    await view.user.type(textarea, "상황");
    await view.user.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === "POST" &&
            call.path === "/api/projects/1/tavern/quests",
        ),
      ).toBe(true);
    });

    const questCall = calls.find(
      (call) =>
        call.method === "POST" &&
        call.path === "/api/projects/1/tavern/quests",
    );
    expect(JSON.parse(String(questCall?.body))).toEqual({
      title: "제목",
      situation: "상황",
    });
    expect(
      calls.some(
        (call) =>
          call.method === "POST" &&
          call.path === "/api/projects/1/tavern/messages",
      ),
    ).toBe(false);

    expect(
      await view.findByText(ko.chat.questCreated(42, "제목")),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(textarea).toHaveValue("");
    });
  });

  it("posts a tavern message and refreshes the room and unread badges", async () => {
    const { calls } = stubApi({ messages: [] });
    const view = renderTavern();
    const textarea = await composerFor(view);

    await view.user.type(textarea, "안녕 주점");
    await view.user.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === "POST" &&
            call.path === "/api/projects/1/tavern/messages",
        ),
      ).toBe(true);
    });
    const post = calls.find(
      (call) =>
        call.method === "POST" &&
        call.path === "/api/projects/1/tavern/messages",
    );
    expect(JSON.parse(String(post?.body))).toEqual({ body: "안녕 주점" });

    await waitFor(() => {
      const roomReads = calls.filter(
        (call) =>
          call.method === "GET" &&
          call.path === "/api/projects/1/tavern/messages",
      );
      const unreadReads = calls.filter(
        (call) =>
          call.method === "GET" &&
          call.path === "/api/projects/1/chat/unread",
      );
      expect(roomReads.length).toBeGreaterThanOrEqual(2);
      expect(unreadReads.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(textarea).toHaveValue("");
    });
  });

  it("warns about a bare /의뢰 and sends nothing", async () => {
    const { calls } = stubApi({ messages: [] });
    const view = renderTavern();
    const textarea = await composerFor(view);

    await view.user.type(textarea, "/의뢰");
    await view.user.keyboard("{Enter}");

    const alert = await view.findByRole("alert");
    expect(alert).toHaveTextContent(ko.chat.commandTitleRequired);
    expect(textarea).toHaveValue("/의뢰");
    expect(
      calls.some(
        (call) =>
          call.method === "POST" &&
          (call.path === "/api/projects/1/tavern/quests" ||
            call.path === "/api/projects/1/tavern/messages"),
      ),
    ).toBe(false);
  });

  it("prefills the promotion dialog from messagePlainText and posts sourceMessageId", async () => {
    const { calls } = stubApi({
      messages: [
        message({
          id: 7,
          author: { id: 2, displayName: "김철수" },
          body: "안녕 <@2>\n둘째 줄",
        }),
      ],
    });
    const view = renderTavern();

    const promote = await view.findByRole("button", {
      name: ko.chat.promote,
    });
    await view.user.click(promote);

    const dialog = view.getByRole("dialog", {
      name: ko.chat.questDialogTitle,
    });
    const title = within(dialog).getByLabelText(ko.chat.questTitle);
    const situation = within(dialog).getByLabelText(ko.chat.questSituation);
    expect(title).toHaveValue("안녕 @김철수");
    expect(situation).toHaveValue("안녕 @김철수\n둘째 줄");

    await view.user.click(
      within(dialog).getByRole("button", { name: ko.chat.questSubmit }),
    );

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === "POST" &&
            call.path === "/api/projects/1/tavern/quests",
        ),
      ).toBe(true);
    });
    const questCall = calls.find(
      (call) =>
        call.method === "POST" &&
        call.path === "/api/projects/1/tavern/quests",
    );
    expect(JSON.parse(String(questCall?.body))).toEqual({
      title: "안녕 @김철수",
      situation: "안녕 @김철수\n둘째 줄",
      sourceMessageId: 7,
    });
    await waitFor(() => {
      expect(view.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows the 409 copy when the message was already promoted", async () => {
    stubApi({
      promoteConflict: true,
      messages: [
        message({
          id: 8,
          author: { id: 2, displayName: "김철수" },
          body: "이미 승격된 메시지",
        }),
      ],
    });
    const view = renderTavern();

    await view.user.click(
      await view.findByRole("button", { name: ko.chat.promote }),
    );
    await view.user.click(
      within(
        view.getByRole("dialog", { name: ko.chat.questDialogTitle }),
      ).getByRole("button", { name: ko.chat.questSubmit }),
    );

    const alert = await view.findByRole("alert");
    expect(alert).toHaveTextContent(ko.chat.alreadyPromoted);
    expect(
      view.getByRole("dialog", { name: ko.chat.questDialogTitle }),
    ).toBeInTheDocument();
  });

  it("marks the newest message read once while the tab is visible", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    try {
      const { calls } = stubApi({
        messages: [
          message({ id: 5, body: "먼저" }),
          message({ id: 6, body: "나중" }),
        ],
      });
      renderTavern();

      await waitFor(() => {
        expect(
          calls.some(
            (call) =>
              call.method === "POST" &&
              call.path === "/api/projects/1/chat/read",
          ),
        ).toBe(true);
      });

      const reads = calls.filter(
        (call) =>
          call.method === "POST" &&
          call.path === "/api/projects/1/chat/read",
      );
      expect(reads).toHaveLength(1);
      expect(JSON.parse(String(reads[0]?.body))).toEqual({
        questId: null,
        messageId: 6,
      });
    } finally {
      delete (document as unknown as Record<string, unknown>)
        .visibilityState;
    }
  });

  it("shows the unread badge with the 99+ cap and the true aria-label", async () => {
    stubApi({ unread: 120, messages: [] });
    const view = renderTavern();

    const badge = await view.findByTestId("tavern-unread-badge");
    expect(badge).toHaveTextContent("99+");
    expect(badge).toHaveAttribute(
      "aria-label",
      ko.chat.unreadBadge(120),
    );
    expect(badge.className).toContain("font-pixel");
    expect(badge.className).toContain("text-[12px]");

    const tab = badge.closest("a") as HTMLElement;
    expect(tab).toHaveAttribute("href", "/g/1/tavern");
    expect(tab).toHaveAttribute("aria-current", "page");
  });
});
