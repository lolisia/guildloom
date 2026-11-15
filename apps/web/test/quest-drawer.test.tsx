// @vitest-environment node
/**
 * Quest drawer restyle tests (T06).
 *
 * The drawer is the main detail surface, so this file pins the design-system
 * contract: an ink 40% overlay without blur, a paper panel behind a 1.5px
 * line-strong rule, the sunken 120px stage panel with its 64px icon and 2px
 * stage mark, the 64px rank badge next to the unchanged rank select, the
 * archived action and confirmation dialog, Chip-based tags and the 32px event
 * icons. Selectors used by board.test.tsx (dungeon placeholder, situation,
 * events, archive dialog, combobox, tag controls) are asserted here as well so
 * a restyle cannot silently break them.
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
const { RANKS } = await import("@guildloom/shared");

const { QuestDrawer } = await import("../src/components/quest/QuestDrawer");
const { eventIcon } = await import("../src/components/quest/EventTimeline");
const { STAGE_MARK_CLASSES } = await import(
  "../src/components/quest/stageMark"
);
const { ko } = await import("../src/i18n/ko");
const { formatKoreanDateTime } = await import("../src/lib/format");

// Testing Library's `screen` singleton is created when its module loads, which
// happens before this file installs the jsdom window. Bind the queries to the
// freshly created body instead.
const screen = within(document.body);

const CREATED_AT = Date.UTC(2026, 0, 2, 3, 0, 0);

const QUEST: Quest = {
  id: 1,
  number: 283,
  title: "보드 첫 의뢰",
  stage: "board",
  rank: "B",
  orderKey: "a0",
  tags: ["긴급", "버그"],
  createdBy: { id: 7, displayName: "김모험" },
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  party: [
    {
      user: { id: 7, displayName: "김모험" },
      role: "leader",
      status: "fighting",
      retreatReason: null,
      joinedAt: CREATED_AT,
    },
  ],
  pendingNominations: 0,
  bounty: { base: 150, multiplier: 1, total: 150, days: 0, dusty: false },
  projectId: 1,
  situation: "첫 줄\n둘째 줄 https://example.com",
  direction: "다음 단계로 진행합니다.",
  archiveReason: null,
  nominations: [],
  floors: [
    {
      id: 1,
      title: "1층: 재현",
      orderKey: "a0",
      doneAt: null,
      doneBy: null,
    },
  ],
  firstClaimedAt: CREATED_AT,
};

const EVENTS: QuestEvent[] = [
  {
    id: 10,
    questId: 1,
    projectId: 1,
    type: "quest_posted",
    payload: { number: 283, title: "보드 첫 의뢰" },
    actor: { id: 7, displayName: "김모험" },
    familiarId: null,
    createdAt: CREATED_AT,
  },
  {
    id: 11,
    questId: 1,
    projectId: 1,
    type: "quest_edited",
    payload: { fields: ["tags"] },
    actor: { id: 8, displayName: "아린" },
    familiarId: null,
    createdAt: CREATED_AT + 86_400_000,
  },
  {
    id: 12,
    questId: 1,
    projectId: 1,
    type: "quest_moved",
    payload: { from: "board", to: "dungeon" },
    actor: { id: 8, displayName: "아린" },
    familiarId: null,
    createdAt: CREATED_AT + 2 * 86_400_000,
  },
  {
    id: 13,
    questId: 1,
    projectId: 1,
    type: "quest_archived",
    payload: { reason: "dropped" },
    actor: { id: 9, displayName: "루나" },
    familiarId: null,
    createdAt: CREATED_AT + 3 * 86_400_000,
  },
  {
    // A moved event without a target falls back to the board icon instead of
    // losing the row.
    id: 14,
    questId: 1,
    projectId: 1,
    type: "quest_moved",
    payload: { from: "board" },
    actor: { id: 9, displayName: "루나" },
    familiarId: null,
    createdAt: CREATED_AT + 4 * 86_400_000,
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

function stubFetch(quest: Quest = QUEST) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://localhost");
      const method = (init.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname === "/api/quests/1") {
        return jsonResponse(quest);
      }
      if (method === "GET" && url.pathname === "/api/quests/1/events") {
        return jsonResponse(EVENTS);
      }
      if (method === "GET" && url.pathname === "/api/projects/1/tags") {
        return jsonResponse([]);
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

async function openDrawer(quest: Quest = QUEST) {
  stubFetch(quest);
  const context = renderDrawer();
  const dialog = await screen.findByRole("dialog", {
    name: ko.board.drawer.title,
  });
  await within(dialog).findByTestId("quest-dungeon-placeholder");

  return { ...context, dialog };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("QuestDrawer design", () => {
  it("dims with scrim, opens a paper panel and closes with the close icon", async () => {
    const { dialog } = await openDrawer();
    const overlay = dialog.parentElement as HTMLElement;

    expect(overlay.className).toContain("bg-scrim");
    expect(overlay.className).not.toMatch(/blur/);

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.className).toContain("bg-paper");
    expect(dialog.className).toContain("border-l-[1.5px]");
    expect(dialog.className).toContain("border-line-strong");
    expect(dialog.className).toContain("rounded-none");
    expect(dialog.className).toContain("h-full");
    expect(dialog.className).not.toContain("shadow-2xl");
    expect(dialog.className).not.toMatch(/rounded-(xl|2xl|3xl|full)/);

    const close = within(dialog).getByRole("button", {
      name: ko.common.close,
    });
    expect(close.textContent).toBe("");
    const closeIcon = close.querySelector("img");
    expect(closeIcon?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/32/close.png",
    );
    expect(closeIcon).toHaveAttribute("width", "32");
    expect(closeIcon).toHaveAttribute("height", "32");
  });

  it("keeps the 120px sunken dungeon view with icon, mark, copy and avatar", async () => {
    const { dialog } = await openDrawer();
    const placeholder = within(dialog).getByTestId(
      "quest-dungeon-placeholder",
    );

    expect(placeholder).toHaveStyle({ height: "120px" });
    expect(placeholder.className).toContain("bg-sunken");
    expect(placeholder.className).toContain("border-[1.5px]");
    expect(placeholder.className).toContain("border-line-strong");
    expect(placeholder.className).not.toMatch(/gradient/);
    expect(placeholder.className).not.toMatch(/rounded-(xl|2xl|3xl|full)/);

    expect(
      within(placeholder).getByText(ko.board.drawer.dungeonView),
    ).toBeInTheDocument();
    expect(
      within(placeholder).getByText(ko.board.drawer.dungeonComingSoon),
    ).toBeInTheDocument();

    const stageIcon = placeholder.querySelector("img");
    expect(stageIcon?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/64/board.png",
    );
    expect(stageIcon).toHaveAttribute("width", "64");
    expect(stageIcon).toHaveAttribute("height", "64");

    const mark = placeholder.querySelector("[data-stage-mark]");
    expect(mark).toHaveAttribute("data-stage-mark", "board");
    expect(mark?.className).toContain("h-0.5");
    expect(mark?.className).toContain(STAGE_MARK_CLASSES.board);

    const avatar = placeholder.querySelector('[data-user-id="7"]');
    expect(avatar).not.toBeNull();
    expect(avatar).toHaveClass("h-10", "w-10");
    expect(avatar?.parentElement?.className).toContain("right-3");
    expect(avatar?.parentElement?.className).toContain("top-3");
  });

  it("uses the board stage colour mapping and the stage-specific icon", async () => {
    expect(STAGE_MARK_CLASSES).toMatchObject({
      board: "bg-ink",
      dungeon: "bg-teal",
      boss: "bg-brick",
      cleared: "bg-gold",
      archived: "bg-gold",
    });

    const { dialog } = await openDrawer({ ...QUEST, stage: "dungeon" });
    const placeholder = within(dialog).getByTestId(
      "quest-dungeon-placeholder",
    );
    const mark = placeholder.querySelector("[data-stage-mark]");

    expect(mark).toHaveAttribute("data-stage-mark", "dungeon");
    expect(mark?.className).toContain("bg-teal");
    expect(placeholder.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/64/dungeon.png",
    );
  });

  it("shows a 64px rank badge beside the unchanged rank combobox", async () => {
    const { dialog } = await openDrawer();

    const select = within(dialog).getByRole("combobox", {
      name: ko.quest.rank,
    }) as HTMLSelectElement;
    expect(select).toHaveValue("B");
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "",
      ...RANKS,
    ]);
    expect(
      Array.from(select.options).map((option) => option.textContent),
    ).toEqual([
      ko.quest.rankNone,
      ...RANKS.map((rank) => ko.quest.ranks[rank]),
    ]);

    const badge = dialog.querySelector('[data-rank="B"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent("등급 B");
    const badgeIcon = badge?.querySelector("img");
    expect(badgeIcon?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/64/rank-b.png",
    );
    expect(badgeIcon).toHaveAttribute("width", "64");
  });

  it("styles the title and situation with atoms and sentence-case labels", async () => {
    const { dialog } = await openDrawer();

    const title = within(dialog).getByRole("textbox", {
      name: ko.quest.titleLabel,
    });
    expect(title).toHaveValue(QUEST.title);
    expect(title.className).toContain("bg-paper");
    expect(title.className).toContain("border-line-strong");

    const situation = within(dialog).getByTestId("quest-situation");
    expect(situation.querySelector(".whitespace-pre-wrap")).not.toBeNull();
    expect(
      within(dialog).getByRole("link", { name: "https://example.com" }),
    ).toHaveAttribute("href", "https://example.com");

    const labels = Array.from(dialog.querySelectorAll("h2, h3, label"));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.className).not.toMatch(/upper/);
      expect(label.className).not.toMatch(/tracking-/);
    }
  });

  it("renders tag chips with Chip and keeps the remove accessible names", async () => {
    const { dialog } = await openDrawer();

    for (const tag of QUEST.tags) {
      const remove = within(dialog).getByRole("button", {
        name: ko.quest.tagRemove(tag),
      });
      expect(remove).toHaveTextContent("×");

      const chip = remove.closest("span");
      expect(chip).not.toBeNull();
      expect(chip?.className).toContain("border-line");
      expect(chip?.className).toContain("text-muted");
      expect(chip?.querySelector("img")).toBeNull();
    }

    const tagInput = within(dialog).getByRole("textbox", {
      name: ko.quest.tagAdd,
    });
    expect(tagInput.className).toContain("bg-paper");
    expect(tagInput.className).toContain("border-line-strong");
  });

  it("gives every event row a 32px icon and keeps the event hooks", async () => {
    const { dialog } = await openDrawer();

    await screen.findByText(formatKoreanDateTime(EVENTS[0]!.createdAt));

    const rows = Array.from(
      dialog.querySelectorAll<HTMLElement>("[data-event-id]"),
    );
    expect(rows).toHaveLength(EVENTS.length);
    expect(rows.map((row) => Number(row.dataset.eventId))).toEqual([
      10, 11, 12, 13, 14,
    ]);
    expect(rows.map((row) => row.dataset.eventType)).toEqual([
      "quest_posted",
      "quest_edited",
      "quest_moved",
      "quest_archived",
      "quest_moved",
    ]);

    const icons = rows.map((row) => row.querySelector("img"));
    expect(icons.map((icon) => icon?.getAttribute("src"))).toEqual([
      "/assets/icons/jrpg-v1/32/quest.png",
      "/assets/icons/jrpg-v1/32/edit.png",
      "/assets/icons/jrpg-v1/32/dungeon.png",
      "/assets/icons/jrpg-v1/32/dropped.png",
      "/assets/icons/jrpg-v1/32/board.png",
    ]);
    for (const [index, icon] of icons.entries()) {
      expect(icon).toHaveAttribute("width", "32");
      expect(icon).toHaveAttribute("height", "32");
      expect(rows[index]?.firstElementChild).toBe(icon);
    }

    expect(
      rows[0]?.querySelectorAll("[data-segment]").length,
    ).toBeGreaterThan(0);
    expect(within(rows[0]!).getByText("'김모험'")).toBeInTheDocument();
    for (const event of EVENTS) {
      expect(
        within(dialog).getByText(formatKoreanDateTime(event.createdAt)),
      ).toBeInTheDocument();
    }
  });

  it("maps every M2 event type to its icon", () => {
    const expected: Partial<Record<QuestEvent["type"], string>> = {
      nominated: "nominate",
      reinforcement_requested: "reinforce",
      claimed: "accept",
      passed: "pass",
      relayed: "relay",
      member_joined: "joined",
      member_left: "retreated",
      member_status_changed: "fighting",
      leader_changed: "party",
      floor_added: "floor",
      floor_checked: "floor",
      boss_engaged: "boss",
      retry_requested: "refresh",
      quest_cleared: "cleared",
    };

    for (const [type, icon] of Object.entries(expected)) {
      expect(
        eventIcon({ ...EVENTS[0]!, type: type as QuestEvent["type"] }),
      ).toBe(icon);
    }
  });

  it("falls back to the neutral arrow for an unknown type or stage", () => {
    expect(
      eventIcon({ ...EVENTS[0]!, type: "quest_reopened" as QuestEvent["type"] }),
    ).toBe("arrow-right");
    expect(eventIcon({ ...EVENTS[2]!, payload: { to: "limbo" } })).toBe(
      "arrow-right",
    );
  });

  it("keeps archive dangerous and confirms on paper with the hard shadow", async () => {
    const { dialog, onClose, user } = await openDrawer();

    const archive = within(dialog).getByRole("button", {
      name: ko.board.drawer.archive,
    });
    expect(archive.className).toContain("border-brick");
    expect(archive.className).toContain("text-brick");
    expect(archive.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/32/dropped.png",
    );

    await user.click(archive);

    const confirm = await screen.findByRole("dialog", {
      name: ko.board.drawer.archive,
    });
    expect(confirm.className).toContain("bg-paper");
    expect(confirm.className).toContain("border-[1.5px]");
    expect(confirm.className).toContain("border-line-strong");
    expect(confirm.className).toContain("shadow-hard");
    expect(confirm.className).not.toContain("shadow-2xl");
    expect(document.querySelector("[data-archive-confirm]")).not.toBeNull();
    expect(
      within(confirm).getByRole("button", { name: ko.common.cancel }),
    ).toBeInTheDocument();
    expect(
      within(confirm).getByRole("button", { name: ko.board.drawer.archive }),
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: ko.board.drawer.archive }),
      ).not.toBeInTheDocument(),
    );
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the overlay and from the close button", async () => {
    const { dialog, onClose, user } = await openDrawer();
    const overlay = dialog.parentElement as HTMLElement;

    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(
      within(dialog).getByRole("button", { name: ko.common.close }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
