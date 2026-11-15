// @vitest-environment node
/**
 * NominationPopover cache bookkeeping (F1).
 *
 * The popover sends `POST /api/quests/:id/nominations` (지목) or
 * `.../reinforcements` (증원 요청) and the server records one quest event per
 * batch. The popover is rendered on its own here — nobody else can refresh the
 * adventure log for it — so this suite proves it invalidates
 * `queryKeys.events(questId)` itself instead of relying on its parent.
 */
import "./domEnvironment";

import type { Nomination, ProjectDetailResponse } from "@guildloom/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import NominationPopover from "../src/components/quest/NominationPopover";
import { ko } from "../src/i18n/ko";
import { queryKeys } from "../src/lib/queryKeys";

// Testing Library's `screen` singleton is created when its module loads, which
// happens before this file installs the jsdom window. Bind the queries to the
// freshly created body instead.
const screen = within(document.body);

const NOW = Date.UTC(2026, 0, 2, 3, 0, 0);

const PROJECT: ProjectDetailResponse = {
  project: { id: 1, name: "달빛 길드", createdAt: NOW },
  members: [
    { userId: 1, displayName: "김모험", role: "owner", xp: 0, level: 1 },
    { userId: 2, displayName: "이모험", role: "member", xp: 10, level: 1 },
    { userId: 3, displayName: "박모험", role: "member", xp: 0, level: 1 },
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

/** API stub for the popover's roster load and nomination POST. */
function stubApi(questId: number, created: Nomination[]) {
  const fetchMock = vi.fn(
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = new URL(String(input), "http://localhost");
      const method = (init.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname === "/api/projects/1") {
        return jsonResponse(PROJECT);
      }
      if (
        method === "POST" &&
        url.pathname === `/api/quests/${questId}/nominations`
      ) {
        return jsonResponse({ nominations: created });
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NominationPopover", () => {
  it("invalidates the quest event timeline after a nomination batch", async () => {
    const questId = 7;
    const created: Nomination[] = [
      {
        id: 60,
        questId,
        nominee: { id: 3, displayName: "박모험" },
        nominatedBy: { id: 1, displayName: "김모험" },
        kind: "nominate",
        state: "pending",
        passReason: null,
        createdAt: NOW,
      },
    ];
    const fetchMock = stubApi(questId, created);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <NominationPopover
          projectId={1}
          questId={questId}
          kind="nominate"
          activeUserIds={[]}
          onCreated={onCreated}
        />
      </QueryClientProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: ko.party.nominate }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: ko.party.nominateTitle,
    });
    await waitFor(() =>
      expect(within(dialog).getAllByRole("checkbox")).toHaveLength(3),
    );

    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await user.click(
      within(dialog).getByRole("checkbox", { name: "박모험" }),
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: ko.party.nominateSubmit,
      }),
    );

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          new URL(String(input), "http://localhost").pathname ===
            `/api/quests/${questId}/nominations` &&
          (init?.method ?? "GET").toUpperCase() === "POST",
      ),
    ).toBe(true);

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(queryKeys.events(questId));
  });
});
