// @vitest-environment node
/**
 * Notification bell tests.
 *
 * The bell renders the unread badge from `GET /api/notifications`, lists the
 * newest notifications first, marks them read, navigates to the quest and
 * offers inline 수락 / 패스 for nominations that are still pending in
 * `GET /api/me/nominations`. The shared pass dialog is exercised here too
 * (preset reason + toss recipient → exact POST body).
 */
import "./domEnvironment";

import {
  PASS_REASON_PRESETS,
  type MyNomination,
  type Notification,
  type ProjectDetailResponse,
  type UserProfile,
} from "@guildloom/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchNotifications, markNotificationsRead } from "../src/api/notifications";
import {
  accept,
  cancel,
  fetchMyNominations,
  join,
  leave,
  nominate,
  pass,
  reinforce,
  status,
} from "../src/api/party";
import NotificationsMenu from "../src/components/NotificationsMenu";
import { ko } from "../src/i18n/ko";

const NOW = 1_760_000_000_000;

const HERO: UserProfile = {
  id: 1,
  loginId: "hero",
  displayName: "김모험",
  xp: 150,
  level: 2,
};

const NOTIFICATIONS: Notification[] = [
  {
    id: 1,
    projectId: 4,
    questId: 9,
    questNumber: 12,
    questTitle: "로그인 버그",
    type: "nominated",
    actor: { id: 2, displayName: "이모험" },
    payload: null,
    createdAt: NOW - 60_000,
    readAt: null,
  },
  {
    id: 2,
    projectId: 4,
    questId: 10,
    questNumber: 13,
    questTitle: "보스전 준비",
    type: "boss_engaged",
    actor: null,
    payload: null,
    createdAt: NOW - 30_000,
    readAt: null,
  },
  {
    id: 3,
    projectId: 4,
    questId: 11,
    questNumber: 14,
    questTitle: "정리하기",
    type: "quest_cleared",
    actor: null,
    payload: null,
    createdAt: NOW - 120_000,
    readAt: NOW - 100_000,
  },
];

const MY_NOMINATION: MyNomination = {
  id: 55,
  questId: 9,
  nominee: HERO,
  nominatedBy: { id: 2, displayName: "이모험" },
  kind: "nominate",
  state: "pending",
  passReason: null,
  createdAt: NOW - 60_000,
  questNumber: 12,
  questTitle: "로그인 버그",
};

const MY_NOMINATIONS: MyNomination[] = [MY_NOMINATION];

const PROJECT_DETAIL: ProjectDetailResponse = {
  project: { id: 4, name: "달빛 길드", createdAt: 1 },
  members: [
    { userId: 1, displayName: "김모험", role: "owner", xp: 150, level: 2 },
    { userId: 2, displayName: "이모험", role: "member", xp: 50, level: 1 },
    { userId: 3, displayName: "박모험", role: "member", xp: 10, level: 1 },
  ],
};

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

/** Stateful notification/party API stub shared by the bell tests. */
function stubApi(options: { meFails?: boolean } = {}) {
  let unreadCount = 2;
  let allRead = false;

  const fetchMock = vi.fn(
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = String(input);
      const method = (init.method ?? "GET").toUpperCase();

      if (method === "GET" && url === "/api/notifications?limit=50") {
        return jsonResponse({
          items: allRead
            ? NOTIFICATIONS.map((item) => ({ ...item, readAt: NOW }))
            : NOTIFICATIONS,
          unreadCount,
        });
      }

      if (method === "GET" && url === "/api/me/nominations") {
        return jsonResponse(MY_NOMINATIONS);
      }

      if (method === "GET" && url === "/api/projects/4") {
        return jsonResponse(PROJECT_DETAIL);
      }

      if (method === "GET" && url === "/api/auth/me") {
        if (options.meFails) {
          return jsonResponse(
            {
              error: {
                code: "unauthorized",
                message: "로그인이 필요합니다.",
              },
            },
            401,
          );
        }
        return jsonResponse({ user: HERO });
      }

      if (method === "POST" && url === "/api/notifications/read") {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          all?: boolean;
          ids?: number[];
        };
        if (body.all === true) {
          allRead = true;
          unreadCount = 0;
        } else if (Array.isArray(body.ids)) {
          unreadCount = Math.max(0, unreadCount - body.ids.length);
        }
        return noContentResponse();
      }

      if (method === "POST" && url === "/api/nominations/55/accept") {
        return jsonResponse({ ...MY_NOMINATION, state: "accepted" });
      }

      if (method === "POST" && url === "/api/nominations/55/pass") {
        return jsonResponse({ ...MY_NOMINATION, state: "passed" });
      }

      return jsonResponse(
        { error: { code: "not_found", message: "not found" } },
        404,
      );
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

function renderMenu(initialPath = "/g/4") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        {children}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );

  const view = render(<NotificationsMenu />, { wrapper });

  return {
    ...view,
    queryClient,
    user: userEvent.setup(),
  };
}

async function openMenu(view: ReturnType<typeof renderMenu>) {
  await waitFor(() => {
    expect(view.getByTestId("notification-unread-badge")).toHaveTextContent(
      "2",
    );
  });
  await view.user.click(
    view.getByRole("button", { name: ko.notifications.label }),
  );
}

function findCall(
  fetchMock: ReturnType<typeof stubApi>,
  url: string,
  method: string,
) {
  return fetchMock.mock.calls.find(([input, init]) => {
    return (
      String(input) === url &&
      (init?.method ?? "GET").toUpperCase() === method
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NotificationsMenu", () => {
  it("shows the unread badge and newest-first Korean notifications, then marks all read", async () => {
    const fetchMock = stubApi();
    const view = renderMenu();
    await openMenu(view);

    // Newest first: id 2 (30s ago), id 1 (60s ago), id 3 (120s ago).
    const rows = view.getAllByTestId(/^notification-\d+$/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "notification-2",
      "notification-1",
      "notification-3",
    ]);

    for (const notification of NOTIFICATIONS) {
      expect(
        view.getByText(ko.notifications.format(notification)),
      ).toBeInTheDocument();
    }

    await view.user.click(
      view.getByRole("button", { name: ko.notifications.markAllRead }),
    );

    await waitFor(() => {
      expect(
        view.queryByTestId("notification-unread-badge"),
      ).not.toBeInTheDocument();
    });

    const readCall = findCall(fetchMock, "/api/notifications/read", "POST");
    expect(readCall).toBeDefined();
    expect(JSON.parse(String(readCall?.[1]?.body))).toEqual({ all: true });
  });

  it("accepts a pending nomination inline with POST /api/nominations/:id/accept", async () => {
    const fetchMock = stubApi();
    const view = renderMenu();
    await openMenu(view);

    const row = await view.findByTestId("notification-1");
    await view.user.click(
      within(row).getByRole("button", { name: ko.notifications.accept }),
    );

    await waitFor(() => {
      expect(
        findCall(fetchMock, "/api/nominations/55/accept", "POST"),
      ).toBeDefined();
    });

    const acceptCall = findCall(
      fetchMock,
      "/api/nominations/55/accept",
      "POST",
    );
    expect(acceptCall?.[1]?.method).toBe("POST");
    expect(acceptCall?.[1]?.body).toBeUndefined();
  });

  it("opens the pass dialog with presets, filters the toss list and posts the reason", async () => {
    const fetchMock = stubApi();
    const view = renderMenu();
    await openMenu(view);

    const row = await view.findByTestId("notification-1");
    await view.user.click(
      within(row).getByRole("button", { name: ko.notifications.pass }),
    );

    const dialog = await view.findByRole("dialog", { name: ko.pass.title });

    for (const preset of PASS_REASON_PRESETS) {
      expect(
        within(dialog).getByRole("button", { name: preset }),
      ).toBeInTheDocument();
    }

    const select = within(dialog).getByLabelText(
      ko.pass.tossLabel,
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(
        within(select)
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual([ko.pass.tossNone, "박모험"]);
    });

    await view.user.click(
      within(dialog).getByRole("button", {
        name: PASS_REASON_PRESETS[0],
      }),
    );
    await view.user.selectOptions(select, "3");
    await view.user.click(
      within(dialog).getByRole("button", { name: ko.pass.submit }),
    );

    await waitFor(() => {
      expect(
        view.queryByRole("dialog", { name: ko.pass.title }),
      ).not.toBeInTheDocument();
    });

    const passCall = findCall(fetchMock, "/api/nominations/55/pass", "POST");
    expect(passCall).toBeDefined();
    expect(JSON.parse(String(passCall?.[1]?.body))).toEqual({
      reason: PASS_REASON_PRESETS[0],
      relayToUserId: 3,
    });
  });

  it("keeps the toss select disabled when the current user cannot be loaded", async () => {
    stubApi({ meFails: true });
    const view = renderMenu();
    await openMenu(view);

    const row = await view.findByTestId("notification-1");
    await view.user.click(
      within(row).getByRole("button", { name: ko.notifications.pass }),
    );

    const dialog = await view.findByRole("dialog", { name: ko.pass.title });
    const select = within(dialog).getByLabelText(
      ko.pass.tossLabel,
    ) as HTMLSelectElement;

    // Without /api/auth/me the caller cannot be filtered out, so the select
    // must never offer a (possibly self) toss target.
    await waitFor(() => {
      expect(select).toBeDisabled();
    });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([ko.pass.tossNone]);
    expect(
      within(dialog).getByRole("alert"),
    ).toHaveTextContent(ko.pass.membersLoadFailed);
  });

  it("navigates to the quest and marks the notification read", async () => {
    const fetchMock = stubApi();
    const view = renderMenu();
    await openMenu(view);

    const row = await view.findByTestId("notification-2");
    await view.user.click(
      within(row).getByText(ko.notifications.format(NOTIFICATIONS[1] as Notification)),
    );

    await waitFor(() => {
      expect(view.getByTestId("location").textContent).toBe(
        "/g/4?quest=10",
      );
    });

    const readCall = findCall(fetchMock, "/api/notifications/read", "POST");
    await waitFor(() => {
      expect(readCall).toBeDefined();
    });
    expect(JSON.parse(String(readCall?.[1]?.body))).toEqual({ ids: [2] });
  });
});

describe("notification and party API wrappers", () => {
  it("calls the documented endpoints with the shared request bodies", async () => {
    const fetchMock = vi.fn(
      async (
        _input: RequestInfo | URL,
        _init: RequestInit = {},
      ): Promise<Response> => jsonResponse({}),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchNotifications();
    await fetchNotifications({ unread: true });
    await markNotificationsRead({ all: true });
    await fetchMyNominations();
    await nominate(3, { userIds: [2, 3] });
    await reinforce(3, { userIds: [4] });
    await accept(55);
    await pass(55, { reason: PASS_REASON_PRESETS[0], relayToUserId: 3 });
    await cancel(55);
    await join(3);
    await leave(3, { reason: "바쁨" });
    await status(3, { status: "fighting" });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body,
    }));

    expect(calls).toEqual([
      {
        url: "/api/notifications?limit=50",
        method: "GET",
        body: undefined,
      },
      {
        url: "/api/notifications?limit=50&unread=1",
        method: "GET",
        body: undefined,
      },
      {
        url: "/api/notifications/read",
        method: "POST",
        body: JSON.stringify({ all: true }),
      },
      { url: "/api/me/nominations", method: "GET", body: undefined },
      {
        url: "/api/quests/3/nominations",
        method: "POST",
        body: JSON.stringify({ userIds: [2, 3] }),
      },
      {
        url: "/api/quests/3/reinforcements",
        method: "POST",
        body: JSON.stringify({ userIds: [4] }),
      },
      {
        url: "/api/nominations/55/accept",
        method: "POST",
        body: undefined,
      },
      {
        url: "/api/nominations/55/pass",
        method: "POST",
        body: JSON.stringify({
          reason: PASS_REASON_PRESETS[0],
          relayToUserId: 3,
        }),
      },
      {
        url: "/api/nominations/55",
        method: "DELETE",
        body: undefined,
      },
      { url: "/api/quests/3/join", method: "POST", body: undefined },
      {
        url: "/api/quests/3/leave",
        method: "POST",
        body: JSON.stringify({ reason: "바쁨" }),
      },
      {
        url: "/api/quests/3/status",
        method: "POST",
        body: JSON.stringify({ status: "fighting" }),
      },
    ]);
  });
});
