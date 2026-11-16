// @vitest-environment node
/**
 * Quest drawer checklist, kind, references, history and boss flow (F1).
 *
 * Covers the F1 feedback against a stateful API stub:
 *
 * - direction checklist items toggle optimistically through
 *   `POST /api/quests/:id/checklist/:index { done, text }`, a
 *   `CHECKLIST_CONFLICT` refetches the quest and toasts;
 * - the layers field appends one title per line through
 *   `POST /api/quests/:id/checklist`, ignores the IME composition Enter and
 *   turns multi-line pastes into one title per line;
 * - the 수정/신규 segments PATCH `{ kind }` and swap the field labels and
 *   placeholders;
 * - reference documents are added on Enter, URLs open in a new tab, paths copy
 *   and rows delete through `DELETE /api/refs/:id`;
 * - the adventure log is collapsed to the three most recent key events and
 *   expands to the full history;
 * - the boss banner renders the waiting copy, retry cannot be submitted with a
 *   blank comment and clearing opens the clear-preview confirmation, then
 *   queues the 10s toast with the caller's own XP and opens the T06 LEVEL UP
 *   modal.
 */
import "./domEnvironment";

import {
  appendChecklistItems,
  parseChecklist,
  refKind,
  setChecklistItem,
  type Quest,
  type QuestEvent,
  type QuestRef,
  type ToggleChecklistRequest,
  type UserProfile,
} from "@guildloom/shared";
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
import { QuestDrawer } from "../src/components/quest/QuestDrawer";
import { ko } from "../src/i18n/ko";
import { useLevelUpStore } from "../src/lib/levelUp";
import { useToastStore } from "../src/lib/toast";

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

function baseQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: 1,
    projectId: 1,
    number: 42,
    title: "체크리스트 의뢰",
    stage: "board",
    kind: "fix",
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
    floors: { done: 0, total: 0 },
    refs: [],
    firstClaimedAt: NOW,
    ...overrides,
  };
}

function makeRef(
  id: number,
  target: string,
  label: string | null = null,
): QuestRef {
  return {
    id,
    label,
    target,
    kind: refKind(target),
    createdBy: { id: HERO.id, displayName: HERO.displayName },
    createdAt: NOW,
  };
}

function makeEvent(
  id: number,
  type: QuestEvent["type"],
  createdAt: number,
): QuestEvent {
  return {
    id,
    questId: 1,
    projectId: 1,
    type,
    payload:
      type === "quest_posted"
        ? { number: 42, title: "체크리스트 의뢰" }
        : type === "quest_moved"
          ? { from: "board", to: "dungeon" }
          : {},
    actor: { id: HERO.id, displayName: HERO.displayName },
    familiarId: null,
    createdAt,
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

interface StubOptions {
  events?: QuestEvent[];
  /** Hold checklist toggles until the test resolves them (optimism check). */
  holdChecklistToggle?: boolean;
  /** Answer every checklist toggle with 409 CHECKLIST_CONFLICT. */
  conflictChecklist?: boolean;
}

interface PendingToggle {
  index: number;
  body: ToggleChecklistRequest;
  gate: Deferred<Response>;
}

/** Replace `direction` and keep the cached checklist counters in sync. */
function withDirection(quest: Quest, direction: string): Quest {
  const { done, total } = parseChecklist(direction);
  return { ...quest, direction, floors: { done, total } };
}

/** Stateful API stub covering the endpoints the drawer touches. */
function stubApi(initialQuest: Quest, options: StubOptions = {}) {
  const state: { quest: Quest; events: QuestEvent[] } = {
    quest: {
      ...initialQuest,
      refs: [...(initialQuest.refs ?? [])],
    },
    events: [...(options.events ?? [])],
  };
  const calls: RecordedCall[] = [];
  const pendingToggles: PendingToggle[] = [];

  const toggleResponse = (
    index: number,
    body: ToggleChecklistRequest,
  ): Response => {
    if (options.conflictChecklist) {
      return jsonResponse(
        {
          error: {
            code: "CHECKLIST_CONFLICT",
            message: "checklist changed",
          },
        },
        409,
      );
    }
    const item = parseChecklist(state.quest.direction).items.find(
      (entry) => entry.index === index,
    );
    if (!item || item.text !== body.text) {
      return jsonResponse(
        {
          error: {
            code: "CHECKLIST_CONFLICT",
            message: "checklist changed",
          },
        },
        409,
      );
    }
    state.quest = withDirection(
      state.quest,
      setChecklistItem(state.quest.direction, index, body.done),
    );
    return jsonResponse(state.quest);
  };

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
        return jsonResponse(state.events);
      }
      if (method === "GET" && path === "/api/projects/1/tags") {
        return jsonResponse([]);
      }

      if (method === "PATCH" && path === "/api/quests/1") {
        const update = body as Partial<Quest>;
        state.quest = {
          ...(update.direction === undefined
            ? { ...state.quest, ...update }
            : {
                ...withDirection(state.quest, update.direction),
                ...update,
                direction: update.direction,
              }),
        };
        return jsonResponse(state.quest);
      }

      const toggleMatch = path.match(
        /^\/api\/quests\/1\/checklist\/(\d+)$/,
      );
      if (method === "POST" && toggleMatch) {
        const index = Number(toggleMatch[1]);
        const toggle = body as ToggleChecklistRequest;
        if (options.holdChecklistToggle) {
          const gate = deferred<Response>();
          pendingToggles.push({ index, body: toggle, gate });
          return gate.promise;
        }
        return toggleResponse(index, toggle);
      }

      if (method === "POST" && path === "/api/quests/1/checklist") {
        const titles = (body as { titles: string[] }).titles;
        state.quest = withDirection(
          state.quest,
          appendChecklistItems(state.quest.direction, titles),
        );
        return jsonResponse(state.quest);
      }

      if (method === "POST" && path === "/api/quests/1/refs") {
        const request = body as { target: string; label?: string };
        const refs = state.quest.refs ?? [];
        const created = makeRef(
          Math.max(0, ...refs.map((entry) => entry.id)) + 1,
          request.target,
          request.label?.trim() ? request.label.trim() : null,
        );
        state.quest = {
          ...state.quest,
          refs: [...refs, created],
        };
        return jsonResponse(created, 201);
      }

      const refMatch = path.match(/^\/api\/refs\/(\d+)$/);
      if (method === "DELETE" && refMatch) {
        const refId = Number(refMatch[1]);
        state.quest = {
          ...state.quest,
          refs: (state.quest.refs ?? []).filter(
            (entry) => entry.id !== refId,
          ),
        };
        return noContentResponse();
      }

      if (method === "GET" && path === "/api/quests/1/clear-preview") {
        return jsonResponse({
          total: 60,
          rewards: [
            {
              user: { id: HERO.id, displayName: HERO.displayName },
              amount: 40,
            },
            {
              user: {
                id: OTHER_REWARD_USER_ID,
                displayName: "이모험",
              },
              amount: 20,
            },
          ],
          requesterBonus: null,
          actorIsInvolved: true,
        });
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

      if (method === "POST" && path === "/api/quests/1/unclear") {
        state.quest = { ...state.quest, stage: "boss" };
        return jsonResponse(state.quest);
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
  return {
    fetchMock,
    state,
    calls,
    /** Resolve the oldest held checklist toggle with the server result. */
    acceptPendingToggle(): void {
      const pending = pendingToggles.shift();
      if (!pending) {
        throw new Error("no checklist toggle is pending");
      }
      pending.gate.resolve(toggleResponse(pending.index, pending.body));
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

/** Render the drawer plus the real LEVEL UP modal and wait for the detail. */
async function openDrawer(
  quest: Quest,
  options: StubOptions = {},
  client?: QueryClient,
) {
  const api = stubApi(quest, options);
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
  await within(dialog).findByTestId("quest-dungeon-placeholder");
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

function stubClipboard(
  writeText: (text: string) => Promise<void>,
) {
  return vi
    .spyOn(navigator.clipboard, "writeText")
    .mockImplementation(writeText);
}

beforeEach(() => {
  useLevelUpStore.getState().dismiss();
  useToastStore.getState().clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useLevelUpStore.getState().dismiss();
  useToastStore.getState().clear();
});

describe("QuestDrawer checklist", () => {
  it("checks a direction item optimistically and posts { done, text }", async () => {
    const { calls, dialog, user, acceptPendingToggle } = await openDrawer(
      baseQuest({
        direction: "- [ ] 재현\n- [x] 수정\n- [ ] 검증",
        floors: { done: 1, total: 3 },
      }),
      { holdChecklistToggle: true },
    );

    const checkbox = within(dialog).getByRole("checkbox", { name: "재현" });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    // Optimistic: the box flips before the held request resolves.
    await waitFor(() => expect(checkbox).toBeChecked());
    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/checklist/0")).toHaveLength(
        1,
      ),
    );
    expect(
      callsTo(calls, "POST", "/api/quests/1/checklist/0")[0]?.body,
    ).toEqual({ done: true, text: "재현" });

    acceptPendingToggle();
    await waitFor(() =>
      expect(callsTo(calls, "GET", "/api/quests/1").length).toBeGreaterThan(0),
    );
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/checklist/0")).toHaveLength(
        2,
      ),
    );
    expect(
      callsTo(calls, "POST", "/api/quests/1/checklist/0")[1]?.body,
    ).toEqual({ done: false, text: "재현" });
  });

  it("refetches the quest and toasts on CHECKLIST_CONFLICT", async () => {
    const { calls, dialog, queryClient, user, state } = await openDrawer(
      baseQuest({ direction: "- [ ] 재현" }),
      { conflictChecklist: true },
    );

    const detailBefore = callsTo(calls, "GET", "/api/quests/1").length;
    const eventsBefore = callsTo(calls, "GET", "/api/quests/1/events").length;

    // The server has moved the item's text; the stale click must reload.
    state.quest = withDirection(
      state.quest,
      "- [ ] 재현 (다른 사람이 수정)",
    );

    await user.click(within(dialog).getByRole("checkbox", { name: "재현" }));

    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/quests/1/checklist/0"),
      ).toHaveLength(1),
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
    expect(
      within(dialog).getByRole("checkbox", {
        name: "재현 (다른 사람이 수정)",
      }),
    ).toBeInTheDocument();
    expect(
      useToastStore
        .getState()
        .toasts.some(
          (toast) => toast.message === ko.board.drawer.checklist.conflict,
        ),
    ).toBe(true);
    expect(
      queryClient.getQueryData<Quest>(["quest", 1])?.direction,
    ).toBe("- [ ] 재현 (다른 사람이 수정)");
  });

  it("appends layers on Enter and multi-line paste, ignoring the IME Enter", async () => {
    const { calls, dialog } = await openDrawer(
      baseQuest({ direction: "- [ ] 재현" }),
    );
    const input = within(dialog).getByRole("textbox", {
      name: ko.board.drawer.checklist.addLabel,
    });

    fireEvent.change(input, { target: { value: "4층: 배포" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(callsTo(calls, "POST", "/api/quests/1/checklist")).toHaveLength(0);
    expect(input).toHaveValue("4층: 배포");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/checklist")).toHaveLength(1),
    );
    expect(
      callsTo(calls, "POST", "/api/quests/1/checklist")[0]?.body,
    ).toEqual({ titles: ["4층: 배포"] });
    await within(dialog).findByRole("checkbox", { name: "4층: 배포" });

    dispatchMultiLinePaste(input, "5층: 공지\n 6층: 회고 \n\n7층: 정리");

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/checklist")).toHaveLength(2),
    );
    expect(
      callsTo(calls, "POST", "/api/quests/1/checklist")[1]?.body,
    ).toEqual({ titles: ["5층: 공지", "6층: 회고", "7층: 정리"] });
    for (const title of ["5층: 공지", "6층: 회고", "7층: 정리"]) {
      expect(
        await within(dialog).findByRole("checkbox", { name: title }),
      ).toBeInTheDocument();
    }
  });

  it("edits the raw direction text without touching the checklist markup", async () => {
    const { calls, dialog, user } = await openDrawer(
      baseQuest({ direction: "- [ ] 재현\n메모 https://example.com" }),
    );

    await user.click(
      within(dialog).getByRole("button", {
        name: `${ko.quest.kindFields.fix.direction} ${ko.common.edit}`,
      }),
    );
    const textarea = within(dialog).getByRole("textbox", {
      name: ko.quest.kindFields.fix.direction,
    });
    expect(textarea).toHaveValue("- [ ] 재현\n메모 https://example.com");

    fireEvent.change(textarea, {
      target: { value: "- [x] 재현\n메모 https://example.com" },
    });
    fireEvent.blur(textarea);

    await waitFor(() =>
      expect(callsTo(calls, "PATCH", "/api/quests/1")[0]?.body).toEqual({
        direction: "- [x] 재현\n메모 https://example.com",
      }),
    );
  });
});

describe("QuestDrawer kind segments", () => {
  it("patches the kind and swaps the situation/direction labels and placeholders", async () => {
    const { calls, dialog, user } = await openDrawer(
      baseQuest({ kind: "fix", situation: "상황", direction: "방향" }),
    );

    const fix = within(dialog).getByRole("button", {
      name: ko.quest.kinds.fix,
    });
    const feature = within(dialog).getByRole("button", {
      name: ko.quest.kinds.feature,
    });
    expect(fix).toHaveAttribute("aria-pressed", "true");
    expect(feature).toHaveAttribute("aria-pressed", "false");

    await user.click(
      within(dialog).getByRole("button", {
        name: `${ko.quest.kindFields.fix.situation} ${ko.common.edit}`,
      }),
    );
    expect(
      within(dialog).getByRole("textbox", {
        name: ko.quest.kindFields.fix.situation,
      }),
    ).toHaveAttribute(
      "placeholder",
      ko.quest.kindFields.fix.situationPlaceholder,
    );
    fireEvent.keyDown(
      within(dialog).getByRole("textbox", {
        name: ko.quest.kindFields.fix.situation,
      }),
      { key: "Escape" },
    );

    await user.click(
      within(dialog).getByRole("button", {
        name: `${ko.quest.kindFields.fix.direction} ${ko.common.edit}`,
      }),
    );
    expect(
      within(dialog).getByRole("textbox", {
        name: ko.quest.kindFields.fix.direction,
      }),
    ).toHaveAttribute(
      "placeholder",
      ko.quest.kindFields.fix.directionPlaceholder,
    );
    fireEvent.keyDown(
      within(dialog).getByRole("textbox", {
        name: ko.quest.kindFields.fix.direction,
      }),
      { key: "Escape" },
    );

    await user.click(feature);

    await waitFor(() =>
      expect(callsTo(calls, "PATCH", "/api/quests/1")[0]?.body).toEqual({
        kind: "feature",
      }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: ko.quest.kinds.feature }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(
      within(dialog).getByRole("button", { name: ko.quest.kinds.fix }),
    ).toHaveAttribute("aria-pressed", "false");

    expect(
      within(dialog).getByText(ko.quest.kindFields.feature.situation),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(ko.quest.kindFields.feature.direction),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", {
        name: `${ko.quest.kindFields.feature.situation} ${ko.common.edit}`,
      }),
    );
    expect(
      within(dialog).getByRole("textbox", {
        name: ko.quest.kindFields.feature.situation,
      }),
    ).toHaveAttribute(
      "placeholder",
      ko.quest.kindFields.feature.situationPlaceholder,
    );
    fireEvent.keyDown(
      within(dialog).getByRole("textbox", {
        name: ko.quest.kindFields.feature.situation,
      }),
      { key: "Escape" },
    );

    await user.click(
      within(dialog).getByRole("button", {
        name: `${ko.quest.kindFields.feature.direction} ${ko.common.edit}`,
      }),
    );
    expect(
      within(dialog).getByRole("textbox", {
        name: ko.quest.kindFields.feature.direction,
      }),
    ).toHaveAttribute(
      "placeholder",
      ko.quest.kindFields.feature.directionPlaceholder,
    );
  });

  it("does not PATCH when the current kind is clicked again", async () => {
    const { calls, dialog, user } = await openDrawer(baseQuest());
    await user.click(
      within(dialog).getByRole("button", { name: ko.quest.kinds.fix }),
    );
    expect(callsTo(calls, "PATCH", "/api/quests/1")).toHaveLength(0);
  });
});

describe("QuestDrawer references", () => {
  it("adds a reference on Enter, ignores IME/blank input and opens URLs in a new tab", async () => {
    const { calls, dialog } = await openDrawer(baseQuest());
    const input = within(dialog).getByRole("textbox", {
      name: ko.board.drawer.refs.addLabel,
    });
    expect(input).toHaveAttribute(
      "placeholder",
      ko.board.drawer.refs.placeholder,
    );

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(callsTo(calls, "POST", "/api/quests/1/refs")).toHaveLength(0);

    fireEvent.change(input, {
      target: { value: "https://example.com/spec" },
    });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(callsTo(calls, "POST", "/api/quests/1/refs")).toHaveLength(0);
    expect(input).toHaveValue("https://example.com/spec");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/refs")).toHaveLength(1),
    );
    expect(callsTo(calls, "POST", "/api/quests/1/refs")[0]?.body).toEqual({
      target: "https://example.com/spec",
    });

    const link = await within(dialog).findByRole("link", {
      name: "https://example.com/spec",
    });
    expect(link).toHaveAttribute("href", "https://example.com/spec");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(input).toHaveValue("");
  });

  it("copies a path and toasts success or failure", async () => {
    const pathRef = makeRef(3, "docs/login.md");
    const { dialog } = await openDrawer(
      baseQuest({ refs: [pathRef] }),
    );
    // userEvent.setup() installs its own clipboard stub, so spy after opening.
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);

    const row = dialog.querySelector('[data-ref-id="3"]') as HTMLElement;
    expect(row.querySelector("a")).toBeNull();
    expect(within(row).getByText("docs/login.md")).toBeInTheDocument();

    fireEvent.click(
      within(row).getByRole("button", {
        name: ko.board.drawer.refs.copyPath,
      }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("docs/login.md"));
    await waitFor(() =>
      expect(
        useToastStore
          .getState()
          .toasts.some((toast) => toast.message === ko.common.copied),
      ).toBe(true),
    );

    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(
      within(row).getByRole("button", {
        name: ko.board.drawer.refs.copyPath,
      }),
    );
    await waitFor(() =>
      expect(
        useToastStore
          .getState()
          .toasts.some((toast) => toast.message === ko.common.copyFailed),
      ).toBe(true),
    );
  });

  it("deletes a reference through DELETE /api/refs/:id", async () => {
    const urlRef = makeRef(4, "https://example.com/spec", "설계 명세");
    const { calls, dialog, user } = await openDrawer(
      baseQuest({ refs: [urlRef] }),
    );

    const link = within(dialog).getByRole("link", { name: "설계 명세" });
    expect(link).toHaveAttribute("rel", "noreferrer");

    await user.click(
      within(dialog).getByRole("button", {
        name: ko.board.drawer.refs.remove("https://example.com/spec"),
      }),
    );

    await waitFor(() =>
      expect(callsTo(calls, "DELETE", "/api/refs/4")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(
        within(dialog).queryByRole("link", { name: "설계 명세" }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("QuestDrawer adventure log", () => {
  const events: QuestEvent[] = [
    makeEvent(1, "quest_posted", NOW + 100),
    makeEvent(2, "quest_edited", NOW + 150),
    makeEvent(3, "member_joined", NOW + 200),
    makeEvent(4, "quest_moved", NOW + 250),
    makeEvent(5, "boss_engaged", NOW + 300),
    makeEvent(6, "quest_cleared", NOW + 400),
    makeEvent(7, "clear_revoked", NOW + 500),
  ];

  it("collapses to the three most recent key events and expands the full history", async () => {
    const { dialog, user } = await openDrawer(baseQuest(), { events });

    const collapsed = Array.from(
      dialog.querySelectorAll<HTMLElement>("[data-event-id]"),
    );
    expect(collapsed.map((row) => Number(row.dataset.eventId))).toEqual([
      5, 6, 7,
    ]);
    expect(collapsed.every((row) => row.querySelector("img") === null)).toBe(
      true,
    );

    const toggle = within(dialog).getByRole("button", {
      name: ko.board.drawer.showAllHistory(events.length),
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() =>
      expect(
        Array.from(
          dialog.querySelectorAll<HTMLElement>("[data-event-id]"),
        ).map((row) => Number(row.dataset.eventId)),
      ).toEqual([1, 2, 3, 4, 5, 6, 7]),
    );

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(dialog.querySelectorAll("[data-event-id]")).toHaveLength(3);
  });

  it("shows '아직 큰 사건은 없습니다' when only non-key events exist", async () => {
    const { dialog } = await openDrawer(baseQuest(), {
      events: [
        makeEvent(1, "quest_edited", NOW + 100),
        makeEvent(2, "quest_moved", NOW + 200),
      ],
    });

    expect(
      within(dialog).getByText(ko.board.drawer.keyEventsEmpty),
    ).toBeInTheDocument();
    expect(dialog.querySelectorAll("[data-event-id]")).toHaveLength(0);
  });
});

describe("Boss banner, retry and clear", () => {
  it("shows the boss banner and keeps retry disabled without a comment", async () => {
    const { calls, user } = await openDrawer(
      baseQuest({ stage: "boss", direction: "- [ ] 보스" }),
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
      baseQuest({ stage: "boss", direction: "- [ ] 보스" }),
    );

    await user.click(
      within(screen.getByTestId("boss-banner")).getByRole("button", {
        name: ko.board.drawer.bossBattle.clear,
      }),
    );

    await confirmClear(user);

    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/quests/1/clear")).toHaveLength(1),
    );
    await assertClearToastAndLevelUp();
  });

  it.each(["board", "dungeon"] as const)(
    "declares the clear from the footer on the %s stage",
    async (stage) => {
      const { calls, user } = await openDrawer(
        baseQuest({ stage, direction: "- [x] 보스" }),
      );

      await user.click(
        screen.getByRole("button", { name: ko.board.drawer.clear.action }),
      );

      await confirmClear(user);

      await waitFor(() =>
        expect(callsTo(calls, "POST", "/api/quests/1/clear")).toHaveLength(1),
      );
      await assertClearToastAndLevelUp();
    },
  );
});

/** Confirm the clear-preview dialog once its confirm button is enabled. */
async function confirmClear(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  const dialog = await screen.findByRole("dialog", {
    name: ko.board.drawer.clear.confirmTitle,
  });
  const confirm = within(dialog).getByRole("button", {
    name: ko.board.drawer.clear.action,
  });
  await waitFor(() => expect(confirm).not.toBeDisabled());
  await user.click(confirm);
}

/** Assert the 10s clear toast, my reward and the T06 level-up modal. */
async function assertClearToastAndLevelUp(): Promise<void> {
  const toast = useToastStore
    .getState()
    .toasts.find(
      (entry) =>
        entry.message === ko.board.drawer.clear.success(40),
    );
  expect(toast).toBeDefined();
  expect(toast?.durationMs).toBe(10_000);
  expect(toast?.action?.label).toBe(ko.board.drawer.clear.undo);

  await waitFor(() => {
    expect(
      useToastStore
        .getState()
        .toasts.some(
          (entry) =>
            entry.message === ko.board.drawer.clear.success(20),
        ),
    ).toBe(false);
  });

  expect(useLevelUpStore.getState().current).toEqual({
    userId: HERO.id,
    from: 1,
    to: 2,
  });
  expect(await screen.findByTestId("level-up-modal")).toBeInTheDocument();
}
