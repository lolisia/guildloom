// @vitest-environment node
/**
 * Quest card tests.
 *
 * The card is a three-row request sheet: title (number, 신규 chip, clamped
 * title), optional tag row, and one meta row with floor progress, the growing
 * bounty, the pending-nomination badge and a right-aligned block holding the
 * age and the party avatars. Party avatars are an overlapped stack capped at
 * three with a `+N` counter; the leader is only announced (title + sr-only
 * text), never shown as a visible 파티장 label.
 *
 * A board-stage card without a party replaces the creator avatar with the
 * dashed 빈 파티 placeholder.
 *
 * jsdom is installed by `domEnvironment` (the workspace-local copy is invisible
 * to the hoisted Vitest runner). `@dnd-kit/sortable` is mocked so the card can
 * be rendered outside a DndContext; the drag styling itself is covered by
 * `board-design.test.tsx`.
 */
import "./domEnvironment";

import type {
  MyNomination,
  PartySummary,
  QuestSummary,
} from "@guildloom/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import QuestCard, {
  floorProgressPercent,
} from "../src/components/board/QuestCard";
import { ko } from "../src/i18n/ko";
import { queryKeys } from "../src/lib/queryKeys";

vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/sortable")>();
  return {
    ...actual,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

const NOW = Date.now();

const BASE_QUEST: QuestSummary = {
  id: 1,
  number: 7,
  title: "보드 첫 의뢰",
  stage: "board",
  kind: "fix",
  rank: "B",
  orderKey: "a0",
  tags: ["긴급"],
  createdBy: { id: 1, displayName: "김모험" },
  createdAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
  party: [],
  floors: { done: 0, total: 0 },
  pendingNominations: 0,
  bounty: { base: 150, multiplier: 1, total: 150, days: 0, dusty: false },
};

function quest(overrides: Partial<QuestSummary> = {}): QuestSummary {
  return { ...BASE_QUEST, ...overrides };
}

function member(
  overrides: Pick<PartySummary, "userId" | "displayName" | "role" | "status">,
): PartySummary {
  return overrides;
}

function nominationFor(
  questId: number,
  state: MyNomination["state"] = "pending",
): MyNomination {
  return {
    id: 55,
    questId,
    nominee: { id: 1, displayName: "김모험" },
    nominatedBy: { id: 2, displayName: "아린" },
    kind: "nominate",
    state,
    passReason: null,
    createdAt: NOW - 30_000,
    questNumber: 7,
    questTitle: "보드 첫 의뢰",
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

function stubFetch(nominations: MyNomination[] = []) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, _init: RequestInit = {}) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/me/nominations") {
        return jsonResponse(nominations);
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

function renderCard(
  cardQuest: QuestSummary,
  nominations: MyNomination[] = [],
) {
  const fetchMock = stubFetch(nominations);
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
  const onOpen = vi.fn();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <QuestCard quest={cardQuest} onOpen={onOpen} />
    </QueryClientProvider>,
  );

  const card = view.container.querySelector<HTMLElement>(
    `[data-quest-id="${cardQuest.id}"]`,
  );
  if (!card) {
    throw new Error("QuestCard did not render");
  }

  return { ...view, card, fetchMock, onOpen, queryClient };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("QuestCard layout", () => {
  it("renders at most three rows: title, tags and meta", () => {
    const { card: withTags } = renderCard(
      quest({ tags: ["긴급", "버그"] }),
    );
    expect(withTags.children.length).toBe(3);
    expect(withTags.lastElementChild).toHaveAttribute(
      "data-testid",
      "card-meta",
    );

    // No tag row without tags, and the sr-only dusty note never adds a row.
    const { card: withoutTags } = renderCard(
      quest({
        tags: [],
        bounty: {
          base: 150,
          multiplier: 2,
          total: 300,
          days: 12,
          dusty: true,
        },
      }),
    );
    expect(withoutTags.children.length).toBe(2);
    expect(within(withoutTags).getByText(ko.quest.dusty)).toHaveClass(
      "sr-only",
    );
  });

  it("clamps the title to two lines and keeps the full title on hover", () => {
    const title = "아주 길게 이어지는 의뢰 제목";
    const { card } = renderCard(quest({ title }));

    const heading = card.querySelector("h3");
    expect(heading).not.toBeNull();
    expect(heading).toHaveClass(
      "min-w-0",
      "flex-1",
      "text-[14px]",
      "font-semibold",
      "leading-snug",
      "text-ink",
      "line-clamp-2",
    );
    expect(heading).toHaveAttribute("title", title);
    expect(heading).toHaveTextContent(title);
    expect(card).toHaveAttribute("aria-label", `#7 ${title}`);
  });
});

describe("QuestCard M2a data", () => {
  it("renders party avatars with leader and status treatment", () => {
    const { card } = renderCard(
      quest({
        party: [
          member({
            userId: 2,
            displayName: "아린",
            role: "leader",
            status: "fighting",
          }),
          member({
            userId: 3,
            displayName: "김모험",
            role: "member",
            status: "done",
          }),
          member({
            userId: 4,
            displayName: "루나",
            role: "member",
            status: "joined",
          }),
        ],
      }),
    );

    const items = card.querySelectorAll("[data-party-user-id]");
    expect(items).toHaveLength(3);

    for (const item of Array.from(items)) {
      const avatar = item.querySelector("[data-user-id]");
      expect(avatar).toHaveClass("h-6", "w-6");
      // The stack overlaps the rings instead of padding them.
      expect(item.querySelector("[data-party-status]")).not.toHaveClass(
        "p-0.5",
      );
    }

    // The leader is the first avatar: its role lives in the title and the
    // screen-reader text, never in visible copy.
    const leader = card.querySelector('[data-party-role="leader"]');
    expect(leader).toBe(items[0]);
    expect(leader).toHaveAttribute("title", "아린 · 파티장");
    expect(leader?.querySelector(".sr-only")).toHaveTextContent(
      ko.quest.partyLeader,
    );
    expect(leader?.querySelector("img")).toBeNull();

    const fighting = card.querySelector('[data-party-status="fighting"]');
    const done = card.querySelector('[data-party-status="done"]');
    const joined = card.querySelector('[data-party-status="joined"]');
    expect(fighting).toHaveClass("border-teal");
    expect(done).toHaveClass("border-gold");
    expect(joined).toHaveClass("border-line");

    // Status is also available to assistive tech, not just as a border colour.
    expect(
      card.querySelector('[data-party-user-id="2"] .sr-only'),
    ).toHaveTextContent(ko.quest.memberStatuses.fighting);
    expect(
      card.querySelector('[data-party-user-id="3"] .sr-only'),
    ).toHaveTextContent(ko.quest.memberStatuses.done);
    expect(
      card.querySelector('[data-party-user-id="4"] .sr-only'),
    ).toHaveTextContent(ko.quest.memberStatuses.joined);
  });

  it("collapses a four-member party into three avatars and a +1 counter", () => {
    const { card } = renderCard(
      quest({
        party: [
          member({
            userId: 2,
            displayName: "아린",
            role: "leader",
            status: "fighting",
          }),
          member({
            userId: 3,
            displayName: "김모험",
            role: "member",
            status: "done",
          }),
          member({
            userId: 4,
            displayName: "루나",
            role: "member",
            status: "joined",
          }),
          member({
            userId: 5,
            displayName: "토리",
            role: "member",
            status: "fighting",
          }),
        ],
      }),
    );

    const avatars = card.querySelectorAll("[data-party-user-id]");
    expect(avatars).toHaveLength(3);
    expect(
      Array.from(avatars).map((item) =>
        item.getAttribute("data-party-user-id"),
      ),
    ).toEqual(["2", "3", "4"]);
    expect(avatars[0]).toHaveAttribute("data-party-role", "leader");
    expect(avatars[1]).toHaveAttribute("data-party-role", "member");

    const stack = avatars[0]?.parentElement;
    expect(stack?.tagName).toBe("UL");
    expect(stack).toHaveClass("flex", "items-center", "-space-x-1");

    expect(within(card).getByText("+1")).toHaveClass(
      "text-[12px]",
      "text-muted",
    );

    // 파티장 must never be visible copy: every element that owns the text is
    // screen-reader-only.
    const leaderCopy = within(card).queryAllByText(
      new RegExp(ko.quest.partyLeader),
    );
    expect(leaderCopy.length).toBeGreaterThan(0);
    for (const element of leaderCopy) {
      expect(element).toHaveClass("sr-only");
    }
  });

  it("renders floor progress with a thin teal bar", () => {
    const { card } = renderCard(quest({ floors: { done: 2, total: 3 } }));

    expect(within(card).getByText("2/3")).toHaveClass(
      "font-pixel",
      "text-[12px]",
      "text-ink",
    );
    expect(card.querySelector("img")).toBeNull();

    const bar = within(card).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-label", `${ko.quest.floors} 2/3`);
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(bar).toHaveClass(
      "h-1",
      "w-8",
      "overflow-hidden",
      "rounded-sm",
      "bg-sunken",
    );

    const fill = bar.querySelector("span");
    expect(fill).toHaveClass("bg-teal");
    // Two of three floors is 66.67%, independent of the helper under test.
    expect(Number.parseFloat((fill as HTMLElement).style.width)).toBeCloseTo(
      66.67,
      1,
    );
  });

  it("hides the floor number and bar when the quest has no floors", () => {
    const { card } = renderCard(quest({ floors: { done: 0, total: 0 } }));

    expect(within(card).queryByText("0/0")).toBeNull();
    expect(within(card).queryByText(ko.quest.floors)).toBeNull();
    expect(within(card).queryByRole("progressbar")).toBeNull();
  });

  it("clamps floor progress to a valid percentage", () => {
    expect(floorProgressPercent(2, 3)).toBeCloseTo(66.67, 1);
    expect(floorProgressPercent(0, 0)).toBe(0);
    expect(floorProgressPercent(5, 0)).toBe(0);
    expect(floorProgressPercent(5, 4)).toBe(100);
    expect(floorProgressPercent(-1, 4)).toBe(0);
  });

  it("renders the gold bounty total and a multiplier badge above 1", () => {
    const { card } = renderCard(
      quest({
        bounty: {
          base: 250,
          multiplier: 1.2,
          total: 300,
          days: 1,
          dusty: false,
        },
      }),
    );

    const total = within(card).getByText("300");
    expect(total).toHaveClass("font-pixel", "text-[12px]", "text-gold");
    expect(card.querySelector("img")).toBeNull();

    const multiplier = within(card).getByText("×1.2");
    expect(multiplier).toHaveClass("font-pixel", "text-gold");
  });

  it("hides the multiplier badge at 1x", () => {
    const { card } = renderCard(quest());

    expect(within(card).queryByText("×1")).toBeNull();
    expect(within(card).getByText("150")).toHaveClass("text-gold");
  });

  it("keeps the bounty, age and avatars in a single meta row", () => {
    const { card } = renderCard(
      quest({
        floors: { done: 1, total: 2 },
        pendingNominations: 2,
        bounty: {
          base: 250,
          multiplier: 1.2,
          total: 300,
          days: 1,
          dusty: false,
        },
        party: [
          member({
            userId: 2,
            displayName: "아린",
            role: "leader",
            status: "fighting",
          }),
        ],
      }),
    );

    const metaRows = card.querySelectorAll<HTMLElement>(
      "[data-testid='card-meta']",
    );
    expect(metaRows).toHaveLength(1);
    const meta = metaRows[0]!;
    expect(meta).toHaveClass(
      "flex",
      "min-h-6",
      "flex-wrap",
      "items-center",
      "gap-2",
    );
    expect(meta).toHaveTextContent("1/2");
    expect(meta.querySelector("[role='progressbar']")).not.toBeNull();
    expect(
      within(meta).getByText("300"),
    ).toHaveClass("font-pixel", "text-[12px]", "text-gold");
    expect(meta.querySelector("[data-pending-nominations='2']")).not.toBeNull();

    const time = meta.querySelector("time");
    expect(time).not.toBeNull();
    expect(time).toHaveClass("text-[12px]", "text-muted");
    expect(time).toHaveAttribute(
      "dateTime",
      new Date(BASE_QUEST.createdAt).toISOString(),
    );
    expect(time?.textContent).toMatch(/분 전/);

    // The age sits before the avatar group in the right-aligned block.
    const rightGroup = Array.from(meta.children).find((child) =>
      child.classList.contains("ml-auto"),
    );
    expect(rightGroup).not.toBeUndefined();
    expect(rightGroup?.firstElementChild).toBe(time);
    expect(
      rightGroup?.querySelector("[data-party-user-id='2']"),
    ).not.toBeNull();
  });

  it("shows the pending nomination count without an icon", () => {
    const { card } = renderCard(quest({ pendingNominations: 2 }));

    const badge = card.querySelector('[data-pending-nominations="2"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent(`${ko.quest.pendingNominations} 2`);
    expect(badge).toHaveClass(
      "border",
      "border-line",
      "rounded-sm",
      "px-1",
      "py-0",
      "text-xs",
      "text-muted",
    );
    expect(badge?.querySelector("img")).toBeNull();
  });

  it("desaturates dusty cards and announces them without the faded icon", () => {
    const { card } = renderCard(
      quest({
        bounty: {
          base: 150,
          multiplier: 2,
          total: 300,
          days: 12,
          dusty: true,
        },
      }),
    );

    expect(card).toHaveAttribute("data-dusty", "true");
    expect(card).toHaveClass("saturate-50");

    expect(card.querySelector('img[src$="/faded.png"]')).toBeNull();
    expect(within(card).getByText(ko.quest.dusty)).toHaveClass("sr-only");
  });

  it("keeps fresh cards saturated and free of the faded icon", () => {
    const { card } = renderCard(quest());

    expect(card).not.toHaveAttribute("data-dusty");
    expect(card).not.toHaveClass("saturate-50");
    expect(card.querySelector('img[src$="/faded.png"]')).toBeNull();
  });

  it("emphasises a card with the signed-in adventurer's pending nomination", async () => {
    const { card, fetchMock } = renderCard(quest(), [nominationFor(1)]);

    await waitFor(() =>
      expect(card).toHaveAttribute("data-my-nomination", "true"),
    );
    expect(card).toHaveClass("border-teal");
    expect(card).not.toHaveClass("border-line-strong");

    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), "http://localhost");
        return url.pathname === "/api/me/nominations";
      }),
    ).toBe(true);
  });

  it("ignores accepted or other-quest nominations", async () => {
    const { card, queryClient } = renderCard(quest({ id: 1 }), [
      nominationFor(1, "accepted"),
      nominationFor(2, "pending"),
    ]);

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.myNominations)).toBeDefined(),
    );
    expect(card).not.toHaveAttribute("data-my-nomination");
    expect(card).toHaveClass("border-line-strong");
  });

  it("replaces the creator avatar with the empty-party placeholder on board cards", () => {
    const { card } = renderCard(
      quest({
        stage: "board",
        party: [],
        createdBy: { id: 1, displayName: "김모험" },
      }),
    );

    const placeholder = within(card).getByTestId("empty-party");
    expect(placeholder).toHaveTextContent(ko.quest.emptyParty);
    expect(placeholder).toHaveClass(
      "inline-flex",
      "h-5",
      "items-center",
      "border-dashed",
      "border-[1.5px]",
      "border-line-strong",
    );
    expect(card.querySelector("[data-user-id]")).toBeNull();
  });

  it("keeps the creator avatar on other stages without a party", () => {
    const { card } = renderCard(quest({ id: 2, stage: "dungeon", party: [] }));

    expect(within(card).queryByTestId("empty-party")).toBeNull();
    expect(card.querySelector('[data-user-id="1"]')).toHaveClass("h-6", "w-6");
  });

  it("still opens the quest when clicked or activated by key and never shows a rank", () => {
    const { card, onOpen } = renderCard(quest());

    expect(card).toHaveAttribute("role", "button");
    expect(card).toHaveAttribute("tabindex", "0");
    expect(card).toHaveAttribute("aria-label", "#7 보드 첫 의뢰");
    expect(card.querySelector("[data-rank]")).toBeNull();
    expect(within(card).queryByText(/등급/)).toBeNull();

    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(1);

    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(card, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("keeps the card body free of icon images and emoji", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
    const { card } = renderCard(
      quest({
        party: [
          member({
            userId: 2,
            displayName: "아린",
            role: "leader",
            status: "fighting",
          }),
        ],
        floors: { done: 1, total: 2 },
        pendingNominations: 1,
        bounty: {
          base: 150,
          multiplier: 1.2,
          total: 180,
          days: 1,
          dusty: true,
        },
      }),
    );

    expect(card.querySelectorAll("img")).toHaveLength(0);
    expect(card.textContent?.match(emoji)).toBeNull();
  });

  it("shows the 신규 chip only for feature requests", () => {
    const { card: fixCard } = renderCard(quest({ kind: "fix" }));
    expect(fixCard.querySelector("[data-kind]")).toBeNull();
    expect(within(fixCard).queryByText(ko.quest.kinds.feature)).toBeNull();

    const { card: featureCard } = renderCard(quest({ kind: "feature" }));
    const chip = featureCard.querySelector('[data-kind="feature"]');
    expect(chip).toHaveTextContent(ko.quest.kinds.feature);
    expect(chip).toHaveClass("border", "border-line", "text-[12px]");
  });
});
