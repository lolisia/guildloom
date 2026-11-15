// @vitest-environment node
/**
 * Quest drawer restyle tests (T06, F1 density).
 *
 * The drawer is the main detail surface, so this file pins the design-system
 * contract: an ink 40% overlay without blur, a paper panel behind a 1.5px
 * line-strong rule, the sunken 88px stage panel with its 64px icon and 2px
 * stage mark, the 수정/신규 kind segments that replaced the rank control, the
 * collapsed adventure log without row icons, the archived action and
 * confirmation dialog and Chip-based tags. Selectors used by board.test.tsx
 * (dungeon placeholder, situation, events, archive dialog, tag controls) are
 * asserted here as well so a restyle cannot silently break them.
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

const { QuestDrawer } = await import("../src/components/quest/QuestDrawer");
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
  kind: "fix",
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
  direction: "- [ ] 1층: 재현",
  archiveReason: null,
  nominations: [],
  floors: { done: 0, total: 1 },
  refs: [],
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
  it("dims with scrim, opens a paper panel and closes with the text button", async () => {
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
    expect(dialog.className).toContain("w-[40vw]");
    expect(dialog.className).toContain("min-w-[360px]");
    expect(dialog.className).toContain("max-w-[560px]");
    expect(dialog.className).not.toContain("shadow-2xl");
    expect(dialog.className).not.toMatch(/rounded-(xl|2xl|3xl|full)/);

    const title = within(dialog).getByRole("heading", {
      name: ko.board.drawer.title,
    });
    expect(title).toHaveClass("text-[18px]");

    const close = within(dialog).getByRole("button", {
      name: ko.common.close,
    });
    expect(close.textContent).toBe(ko.common.close);
    expect(close.querySelector("img")).toBeNull();
  });

  it("keeps the 88px sunken dungeon view with stage icon, mark, progress and party sprite", async () => {
    const { dialog } = await openDrawer();
    const placeholder = within(dialog).getByTestId(
      "quest-dungeon-placeholder",
    );

    expect(placeholder).toHaveStyle({ height: "88px" });
    expect(placeholder.className).toContain("bg-sunken");
    expect(placeholder.className).toContain("border-[1.5px]");
    expect(placeholder.className).toContain("border-line-strong");
    expect(placeholder.className).not.toMatch(/gradient/);
    expect(placeholder.className).not.toMatch(/rounded-(xl|2xl|3xl|full)/);

    expect(
      within(placeholder).getByText(ko.board.drawer.dungeonView),
    ).toBeInTheDocument();
    // QUEST has one unchecked checklist item, so progress is 0/1.
    expect(placeholder).toHaveAttribute("data-dungeon-progress", "0");

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

    const partyLane = placeholder.querySelector(
      '[data-dungeon-member="7"]',
    ) as HTMLElement | null;
    expect(partyLane).not.toBeNull();
    expect(partyLane).toHaveAttribute("data-dungeon-state", "attack");
    expect(partyLane?.style.left).toBe("0%");

    const partySprite = placeholder.querySelector('[data-user-id="7"]');
    expect(partySprite).not.toBeNull();
    expect(partySprite).toHaveClass("h-10", "w-10");
    expect(partySprite).toHaveAttribute("data-state", "attack");
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

  it("shows kind segments instead of the retired rank control", async () => {
    const { dialog } = await openDrawer();

    const fix = within(dialog).getByRole("button", {
      name: ko.quest.kinds.fix,
    });
    const feature = within(dialog).getByRole("button", {
      name: ko.quest.kinds.feature,
    });
    expect(fix).toHaveAttribute("aria-pressed", "true");
    expect(feature).toHaveAttribute("aria-pressed", "false");

    expect(
      within(dialog).queryByRole("combobox", { name: ko.quest.rank }),
    ).toBeNull();
    expect(dialog.querySelector("[data-rank]")).toBeNull();
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

  it("collapses the adventure log to key events and expands the full history", async () => {
    const { dialog, user } = await openDrawer();

    await screen.findByText(formatKoreanDateTime(EVENTS[0]!.createdAt));

    // Collapsed: only the quest_posted key event is visible, without an icon.
    const rows = Array.from(
      dialog.querySelectorAll<HTMLElement>("[data-event-id]"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-event-id", "10");
    expect(rows[0]?.querySelector("img")).toBeNull();
    expect(
      within(rows[0]!).getByText(formatKoreanDateTime(EVENTS[0]!.createdAt)),
    ).toBeInTheDocument();
    expect(
      rows[0]?.querySelectorAll("[data-segment]").length,
    ).toBeGreaterThan(0);
    expect(within(rows[0]!).getByText("'김모험'")).toBeInTheDocument();

    const toggle = within(dialog).getByRole("button", {
      name: ko.board.drawer.showAllHistory(EVENTS.length),
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() =>
      expect(
        Array.from(
          dialog.querySelectorAll<HTMLElement>("[data-event-id]"),
        ).map((row) => Number(row.dataset.eventId)),
      ).toEqual([10, 11, 12, 13, 14]),
    );
    for (const event of EVENTS) {
      expect(
        within(dialog).getByText(formatKoreanDateTime(event.createdAt)),
      ).toBeInTheDocument();
    }

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(dialog.querySelectorAll("[data-event-id]")).toHaveLength(1);
  });

  it("shows the empty key-event copy when only non-key events exist", async () => {
    const onlyEdits = EVENTS.filter(
      (event) =>
        event.type !== "quest_posted" &&
        event.type !== "member_joined" &&
        event.type !== "member_left" &&
        event.type !== "boss_engaged" &&
        event.type !== "retry_requested" &&
        event.type !== "quest_cleared" &&
        event.type !== "clear_revoked",
    );
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(String(input), "http://localhost");
        const method = (init.method ?? "GET").toUpperCase();
        if (method === "GET" && url.pathname === "/api/quests/1") {
          return jsonResponse(QUEST);
        }
        if (method === "GET" && url.pathname === "/api/quests/1/events") {
          return jsonResponse(onlyEdits);
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

    render(
      <QueryClientProvider client={new QueryClient()}>
        <QuestDrawer projectId={1} questId={1} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole("dialog", {
      name: ko.board.drawer.title,
    });
    expect(
      await within(dialog).findByText(ko.board.drawer.keyEventsEmpty),
    ).toBeInTheDocument();
    expect(dialog.querySelectorAll("[data-event-id]")).toHaveLength(0);
  });

  it("keeps archive dangerous and confirms on paper with the hard shadow", async () => {
    const { dialog, onClose, user } = await openDrawer();

    const archive = within(dialog).getByRole("button", {
      name: ko.board.drawer.archive,
    });
    expect(archive.className).toContain("border-brick");
    expect(archive.className).toContain("text-brick");
    expect(archive.querySelector("img")).toBeNull();

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
