// @vitest-environment node
/**
 * Drawer floors and boss fight (T09).
 *
 * Covers the M2a dungeon checklist and the clear/retry flow against a stateful
 * API stub:
 *
 * - Enter in the add field is ignored while an IME composition is active, and
 *   a multi-line paste adds one floor per non-empty line;
 * - checking/unchecking, renaming, reordering (dnd-kit planner) and deleting a
 *   floor call the exact `/api/floors/*` endpoints and refresh the detail,
 *   event log and `["quests", projectId]` list prefix;
 * - the boss banner renders the waiting copy, retry cannot be submitted with a
 *   blank comment and clearing shows the 던전 클리어! celebration with the
 *   caller's own XP and opens the T06 LEVEL UP modal.
 */
import "./domEnvironment";

import type { Floor, Quest, UserProfile } from "@guildloom/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LevelUpModal from "../src/components/LevelUpModal";
import { planFloorMove } from "../src/components/quest/floorMove";
import { QuestDrawer } from "../src/components/quest/QuestDrawer";
import { ko } from "../src/i18n/ko";
import { useLevelUpStore } from "../src/lib/levelUp";

// Testing Library's `screen` singleton is created when its module loads, which
// happens before this file installs the jsdom window. Bind the queries to the
// freshly created body instead.
const screen = within(document.body);

const NOW = Date.UTC(2026, 0, 2, 3, 0, 0);

const HERO: UserProfile = {
  id: 1,
  loginId: "hero",
  displayName: "김모험",
  xp: 0,
  level: 1,
};

const OTHER_REWARD_USER_ID = 2;

function makeFloor(
  id: number,
  title: string,
  orderKey: string,
  doneAt: number | null = null,
): Floor {
  return {
    id,
    title,
    orderKey,
    doneAt,
    doneBy:
      doneAt === null
        ? null
        : { id: HERO.id, displayName: HERO.displayName },
  };
}

function baseQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: 1,
    projectId: 1,
    number: 42,
    title: "층 테스트 의뢰",
    stage: "board",
    rank: "C",
    orderKey: "a0",
    tags: [],
    createdBy: { id: 2, displayName: "의뢰인" },
    createdAt: NOW,
    updatedAt: NOW,
    party: [],
    pendingNominations: 0,
    bounty: { base: 80, multiplier: 1, total: 80, days: 0, dusty: false },
    situation: "",
    direction: "",
    archiveReason: null,
    nominations: [],
    floors: [],
    firstClaimedAt: NOW,
    ...overrides,
  };
}

const FLOORS: Floor[] = [
  makeFloor(1, "1층: 재현", "a0"),
  makeFloor(2, "2층: 수정", "a1"),
  makeFloor(3, "3층: 검증", "a2"),
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
  body: unknown;
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

/** Stateful API stub covering the endpoints the drawer touches. */
function stubApi(initialQuest: Quest) {
  const state = {
    quest: { ...initialQuest, floors: [...initialQuest.floors] },
  };
  const calls: RecordedCall[] = [];

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
      if (method === "GET" && path === "/api/quests/1") {
        return jsonResponse(state.quest);
      }
      if (method === "GET" && path === "/api/quests/1/events") {
        return jsonResponse([]);
      }
      if (method === "GET" && path === "/api/projects/1/tags") {
        return jsonResponse([]);
      }

      if (method === "POST" && path === "/api/quests/1/floors") {
        const titles = (body as { titles: string[] }).titles;
        const startId =
          Math.max(0, ...state.quest.floors.map((floor) => floor.id)) + 1;
        const created = titles.map((title, index) =>
          makeFloor(startId + index, title, `k${startId + index}`),
        );
        state.quest = {
          ...state.quest,
          floors: [...state.quest.floors, ...created],
        };
        return jsonResponse(state.quest.floors);
      }

      const floorMatch = path.match(/^\/api\/floors\/(\d+)$/);
      if (floorMatch) {
        const floorId = Number(floorMatch[1]);

        if (method === "PATCH") {
          const existing = state.quest.floors.find(
            (floor) => floor.id === floorId,
          );
          if (!existing) {
            return jsonResponse(
              { error: { code: "not_found", message: "floor not found" } },
              404,
            );
          }
          const update = body as { title?: string; done?: boolean };
          const updated: Floor = { ...existing };
          if (update.title !== undefined) {
            updated.title = update.title;
          }
          if (update.done !== undefined) {
            updated.doneAt = update.done ? NOW : null;
            updated.doneBy = update.done
              ? { id: HERO.id, displayName: HERO.displayName }
              : null;
          }
          state.quest = {
            ...state.quest,
            floors: state.quest.floors.map((floor) =>
              floor.id === floorId ? updated : floor,
            ),
          };
          return jsonResponse(updated);
        }

        if (method === "DELETE") {
          state.quest = {
            ...state.quest,
            floors: state.quest.floors.filter(
              (floor) => floor.id !== floorId,
            ),
          };
          return noContentResponse();
        }
      }

      const moveMatch = path.match(/^\/api\/floors\/(\d+)\/move$/);
      if (method === "POST" && moveMatch) {
        const floorId = Number(moveMatch[1]);
        const moved = state.quest.floors.find(
          (floor) => floor.id === floorId,
        );
        if (!moved) {
          return jsonResponse(
            { error: { code: "not_found", message: "floor not found" } },
            404,
          );
        }
        const move = body as { beforeId?: number; afterId?: number };
        const rest = state.quest.floors.filter(
          (floor) => floor.id !== floorId,
        );
        let insertIndex = rest.length;
        if (move.beforeId !== undefined) {
          const index = rest.findIndex(
            (floor) => floor.id === move.beforeId,
          );
          if (index >= 0) {
            insertIndex = index + 1;
          }
        } else if (move.afterId !== undefined) {
          const index = rest.findIndex(
            (floor) => floor.id === move.afterId,
          );
          if (index >= 0) {
            insertIndex = index;
          }
        }
        const updated: Floor = {
          ...moved,
          orderKey: `moved-${floorId}-${NOW}`,
        };
        rest.splice(insertIndex, 0, updated);
        state.quest = { ...state.quest, floors: rest };
        return jsonResponse(updated);
      }

      if (method === "POST" && path === "/api/quests/1/clear") {
        state.quest = { ...state.quest, stage: "cleared" };
        return jsonResponse({
          quest: state.quest,
          rewards: [
            { userId: HERO.id, amount: 40 },
            { userId: OTHER_REWARD_USER_ID, amount: 20 },
          ],
          levelUps: [{ userId: HERO.id, from: 1, to: 2 }],
        });
      }

      if (method === "POST" && path === "/api/quests/1/retry") {
        state.quest = { ...state.quest, stage: "dungeon" };
        return jsonResponse(state.quest);
      }

      return jsonResponse(
        { error: { code: "not_found", message: "not found" } },
        404,
      );
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, state, calls };
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

/** Render the drawer plus the real LEVEL UP modal and wait for the detail. */
async function openDrawer(quest: Quest, client?: QueryClient) {
  const api = stubApi(quest);
  const queryClient = client ?? createQueryClient();
  const user = userEvent.setup();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <QuestDrawer projectId={1} questId={1} onClose={vi.fn()} />
      <LevelUpModal />
    </QueryClientProvider>,
  );

  const dialog = await screen.findByRole("dialog", {
    name: ko.board.drawer.title,
  });
  await within(dialog).findByTestId("quest-floors");
  // PartySection only renders 참여 once `/api/auth/me` resolved, so this also
  // guarantees the clear success handler knows the caller's user id.
  await within(dialog).findByRole("button", { name: ko.party.join });

  return { ...api, queryClient, user, dialog, ...view };
}

function dispatchMultiLinePaste(
  element: HTMLElement,
  text: string,
): void {
  const event = document.createEvent("Event");
  event.initEvent("paste", true, true);
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (): string => text },
  });
  fireEvent(element, event);
}

beforeEach(() => {
  useLevelUpStore.getState().dismiss();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useLevelUpStore.getState().dismiss();
});

describe("QuestFloors", () => {
  it("adds a floor on Enter and ignores the IME composition Enter", async () => {
    const { calls } = await openDrawer(baseQuest({ floors: FLOORS }));
    const input = screen.getByRole("textbox", {
      name: ko.board.drawer.floors.add,
    });

    fireEvent.change(input, { target: { value: "4층: 배포" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(callsTo(calls, "POST", "/api/quests/1/floors")).toHaveLength(0);
    expect(input).toHaveValue("4층: 배포");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/floors")).toHaveLength(1),
    );
    expect(callsTo(calls, "POST", "/api/quests/1/floors")[0]?.body).toEqual({
      titles: ["4층: 배포"],
    });
    expect(await screen.findByDisplayValue("4층: 배포")).toBeInTheDocument();
  });

  it("renames a floor on Enter and ignores the IME composition Enter", async () => {
    const { calls } = await openDrawer(baseQuest({ floors: FLOORS }));
    const titleInput = screen.getByRole("textbox", {
      name: ko.board.drawer.floors.titleLabel("1층: 재현"),
    });

    fireEvent.change(titleInput, { target: { value: "1층: 재현 완료" } });
    fireEvent.keyDown(titleInput, { key: "Enter", isComposing: true });

    expect(callsTo(calls, "PATCH", "/api/floors/1")).toHaveLength(0);

    fireEvent.keyDown(titleInput, { key: "Enter" });

    await waitFor(() =>
      expect(callsTo(calls, "PATCH", "/api/floors/1")).toHaveLength(1),
    );
    expect(callsTo(calls, "PATCH", "/api/floors/1")[0]?.body).toEqual({
      title: "1층: 재현 완료",
    });
  });

  it("adds one floor per non-empty line when multi-line text is pasted", async () => {
    const { calls } = await openDrawer(baseQuest({ floors: FLOORS }));
    const input = screen.getByRole("textbox", {
      name: ko.board.drawer.floors.add,
    });

    dispatchMultiLinePaste(input, "4층: 배포\n 5층: 공지 \n\n6층: 회고");

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/floors")).toHaveLength(1),
    );
    expect(callsTo(calls, "POST", "/api/quests/1/floors")[0]?.body).toEqual({
      titles: ["4층: 배포", "5층: 공지", "6층: 회고"],
    });

    for (const title of ["4층: 배포", "5층: 공지", "6층: 회고"]) {
      expect(await screen.findByDisplayValue(title)).toBeInTheDocument();
    }
  });

  it("checks and unchecks a floor through PATCH /api/floors/:id { done }", async () => {
    const { calls, user } = await openDrawer(baseQuest({ floors: FLOORS }));
    const checkbox = screen.getByRole("checkbox", {
      name: ko.board.drawer.floors.check("1층: 재현"),
    });

    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);

    await waitFor(() =>
      expect(callsTo(calls, "PATCH", "/api/floors/1")).toHaveLength(1),
    );
    expect(callsTo(calls, "PATCH", "/api/floors/1")[0]?.body).toEqual({
      done: true,
    });
    await waitFor(() => expect(checkbox).toBeChecked());

    await user.click(checkbox);

    await waitFor(() =>
      expect(callsTo(calls, "PATCH", "/api/floors/1")).toHaveLength(2),
    );
    expect(callsTo(calls, "PATCH", "/api/floors/1")[1]?.body).toEqual({
      done: false,
    });
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it("reorders and deletes floors through the move/delete endpoints", async () => {
    const { calls, user } = await openDrawer(baseQuest({ floors: FLOORS }));

    await user.click(
      screen.getByRole("button", {
        name: ko.board.drawer.floors.moveDown("1층: 재현"),
      }),
    );

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/floors/1/move")).toHaveLength(1),
    );
    expect(callsTo(calls, "POST", "/api/floors/1/move")[0]?.body).toEqual({
      beforeId: 2,
      afterId: 3,
    });

    const deleteButton = await screen.findByRole("button", {
      name: ko.board.drawer.floors.delete("2층: 수정"),
    });
    await user.click(deleteButton);

    await waitFor(() =>
      expect(callsTo(calls, "DELETE", "/api/floors/2")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(
        screen.queryByDisplayValue("2층: 수정"),
      ).not.toBeInTheDocument(),
    );

    // The dnd-kit planner keeps the arrayMove semantics used by the row.
    expect(planFloorMove(FLOORS, 1, 3)).toMatchObject({
      floorId: 1,
      beforeId: 3,
    });
    expect(planFloorMove(FLOORS, 1, 3)).not.toHaveProperty("afterId");
  });

  it("invalidates the detail, event log and quest list prefix after a floor change", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(["quests", 1, { stage: "board" }], []);
    const { calls, user } = await openDrawer(
      baseQuest({ floors: FLOORS }),
      queryClient,
    );

    const detailBefore = callsTo(calls, "GET", "/api/quests/1").length;
    const eventsBefore = callsTo(calls, "GET", "/api/quests/1/events").length;

    await user.click(
      screen.getByRole("checkbox", {
        name: ko.board.drawer.floors.check("2층: 수정"),
      }),
    );

    await waitFor(() =>
      expect(callsTo(calls, "PATCH", "/api/floors/2")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(callsTo(calls, "GET", "/api/quests/1").length).toBeGreaterThan(
        detailBefore,
      ),
    );
    await waitFor(() =>
      expect(
        callsTo(calls, "GET", "/api/quests/1/events").length,
      ).toBeGreaterThan(eventsBefore),
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryState(["quests", 1, { stage: "board" }])
          ?.isInvalidated,
      ).toBe(true),
    );
  });
});

describe("Boss banner, retry and clear", () => {
  it("shows the boss banner and keeps retry disabled without a comment", async () => {
    const { calls, user } = await openDrawer(
      baseQuest({ stage: "boss", floors: FLOORS }),
    );

    const banner = screen.getByTestId("boss-banner");
    expect(banner.className).toContain("border-brick");
    expect(
      within(banner).getByText(ko.board.drawer.bossBattle.waiting),
    ).toBeInTheDocument();
    expect(
      within(banner).getByRole("button", {
        name: ko.board.drawer.bossBattle.clear,
      }),
    ).toBeInTheDocument();

    await user.click(
      within(banner).getByRole("button", {
        name: ko.board.drawer.bossBattle.retry,
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: ko.board.drawer.bossBattle.retryTitle,
    });
    expect(dialog.className).toContain("bg-paper");
    expect(dialog.className).toContain("border-[1.5px]");
    expect(dialog.className).toContain("border-line-strong");
    expect(dialog.className).toContain("shadow-hard");
    expect(dialog.className).not.toMatch(/gradient|blur|glow/);

    const submit = within(dialog).getByRole("button", {
      name: ko.board.drawer.bossBattle.retrySubmit,
    });
    expect(submit).toBeDisabled();

    const comment = within(dialog).getByRole("textbox", {
      name: ko.board.drawer.bossBattle.retryCommentLabel,
    });
    await user.type(comment, "   ");
    expect(submit).toBeDisabled();
    expect(callsTo(calls, "POST", "/api/quests/1/retry")).toHaveLength(0);

    await user.type(comment, "버그가 재현됩니다");
    await waitFor(() => expect(submit).not.toBeDisabled());
    await user.click(submit);

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/retry")).toHaveLength(1),
    );
    expect(callsTo(calls, "POST", "/api/quests/1/retry")[0]?.body).toEqual({
      comment: "버그가 재현됩니다",
    });
    await waitFor(() =>
      expect(screen.queryByTestId("boss-banner")).not.toBeInTheDocument(),
    );
  });

  it("declares the clear from the boss banner and opens the level-up modal", async () => {
    const { calls, user } = await openDrawer(
      baseQuest({ stage: "boss", floors: FLOORS }),
    );

    await user.click(
      within(screen.getByTestId("boss-banner")).getByRole("button", {
        name: ko.board.drawer.bossBattle.clear,
      }),
    );

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/clear")).toHaveLength(1),
    );
    await assertCelebrationAndLevelUp();
  });

  it.each(["board", "dungeon"] as const)(
    "declares the clear from the footer on the %s stage",
    async (stage) => {
      const { calls, user } = await openDrawer(
        baseQuest({ stage, floors: FLOORS }),
      );

      await user.click(
        screen.getByRole("button", { name: ko.board.drawer.clear.action }),
      );

      await waitFor(() =>
        expect(callsTo(calls, "POST", "/api/quests/1/clear")).toHaveLength(1),
      );
      await assertCelebrationAndLevelUp();
    },
  );
});

/** Assert the 2s celebration copy, my reward and the T06 level-up modal. */
async function assertCelebrationAndLevelUp(): Promise<void> {
  const celebration = await screen.findByTestId("clear-celebration");
  expect(celebration.textContent).not.toMatch(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,
  );

  const card = celebration.firstElementChild as HTMLElement;
  expect(card.className).not.toMatch(/gradient|blur|glow/);
  expect(card.className).toContain("bg-paper");
  expect(card.className).toContain("shadow-hard");

  const title = within(celebration).getByText(
    ko.board.drawer.clear.celebrationTitle,
  );
  expect(title).toHaveClass("font-pixel");
  expect(title).toHaveClass("text-ink");

  const reward = within(celebration).getByText(
    ko.board.drawer.clear.reward(40),
  );
  expect(reward).toHaveClass("font-pixel");
  expect(reward).toHaveClass("text-gold");
  expect(
    within(celebration).queryByText(ko.board.drawer.clear.reward(20)),
  ).toBeNull();

  expect(useLevelUpStore.getState().current).toEqual({
    userId: HERO.id,
    from: 1,
    to: 2,
  });
  expect(await screen.findByTestId("level-up-modal")).toBeInTheDocument();
}
