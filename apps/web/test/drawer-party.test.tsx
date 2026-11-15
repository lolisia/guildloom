// @vitest-environment node
/**
 * Drawer party experience (T08).
 *
 * Covers the M2a party surface end to end against a stubbed API:
 *
 * - the dungeon lane positions active members by floor/stage progress and maps
 *   fighting/done/joined to the attack/victory/idle sprite states, including
 *   the boss marker;
 * - the party section shows 수락/패스 for the nominee, 참여 for a non-member and
 *   the status toggles + 후퇴 for an active member, posting the documented
 *   endpoints and bodies;
 * - the 지목/증원 요청 popover hides active party members and submits the
 *   selected ids;
 * - the shared pass dialog excludes the active party from the toss list and
 *   posts the preset reason + relay target;
 * - every mutation refreshes the quest cache and the board/events/nomination/
 *   notification queries, and 403/409 failures render Korean copy.
 */
import "./domEnvironment";

import {
  MEMBER_STATUS_LABELS,
  PASS_REASON_PRESETS,
  type MemberStatus,
  type Nomination,
  type PartyMember,
  type PartyRole,
  type ProjectDetailResponse,
  type Quest,
  type UserProfile,
} from "@guildloom/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuestDrawer } from "../src/components/quest/QuestDrawer";
import { ko } from "../src/i18n/ko";
import { queryKeys } from "../src/lib/queryKeys";

const NOW = Date.UTC(2026, 0, 2, 3, 0, 0);

const HERO: UserProfile = {
  id: 1,
  loginId: "hero",
  displayName: "김모험",
  xp: 0,
  level: 1,
};

const PROJECT: ProjectDetailResponse = {
  project: { id: 1, name: "달빛 길드", createdAt: NOW },
  members: [
    { userId: 1, displayName: "김모험", role: "owner", xp: 0, level: 1 },
    { userId: 2, displayName: "이모험", role: "member", xp: 10, level: 1 },
    { userId: 3, displayName: "박모험", role: "member", xp: 0, level: 1 },
    { userId: 4, displayName: "최모험", role: "member", xp: 0, level: 1 },
  ],
};

function member(
  userId: number,
  displayName: string,
  status: MemberStatus,
  role: PartyRole = "member",
  retreatReason: string | null = null,
): PartyMember {
  return {
    user: { id: userId, displayName },
    role,
    status,
    retreatReason,
    joinedAt: NOW,
  };
}

function nomination(overrides: Partial<Nomination> = {}): Nomination {
  return {
    id: 55,
    questId: 1,
    nominee: { id: HERO.id, displayName: HERO.displayName },
    nominatedBy: { id: 2, displayName: "이모험" },
    kind: "nominate",
    state: "pending",
    passReason: null,
    createdAt: NOW,
    ...overrides,
  };
}

function baseQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: 1,
    projectId: 1,
    number: 42,
    title: "파티 의뢰",
    stage: "board",
    kind: "fix",
    rank: "C",
    orderKey: "a0",
    tags: [],
    createdBy: { id: 2, displayName: "이모험" },
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

interface StubOptions {
  /** Fail every POST to this path with the given HTTP status. */
  failPost?: { path: string; status: number };
}

/** Stateful quest/party API stub shared by the drawer-party tests. */
function stubApi(initialQuest: Quest, options: StubOptions = {}) {
  let currentQuest = initialQuest;

  const fetchMock = vi.fn(
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;
      const method = (init.method ?? "GET").toUpperCase();

      if (method === "GET" && path === "/api/auth/me") {
        return jsonResponse({ user: HERO });
      }
      if (method === "GET" && path === "/api/projects/1") {
        return jsonResponse(PROJECT);
      }
      if (method === "GET" && path === "/api/projects/1/tags") {
        return jsonResponse([]);
      }
      if (method === "GET" && path === "/api/quests/1") {
        return jsonResponse(currentQuest);
      }
      if (method === "GET" && path === "/api/quests/1/events") {
        return jsonResponse([]);
      }

      if (method === "POST" && options.failPost?.path === path) {
        return errorResponse(options.failPost.status, "conflict");
      }

      if (method === "POST" && path === "/api/quests/1/join") {
        const alreadyActive = currentQuest.party.some(
          (entry) =>
            entry.user.id === HERO.id && entry.status !== "retreated",
        );
        if (!alreadyActive) {
          currentQuest = {
            ...currentQuest,
            party: [
              ...currentQuest.party,
              member(
                HERO.id,
                HERO.displayName,
                "joined",
                currentQuest.party.length === 0 ? "leader" : "member",
              ),
            ],
          };
        }
        return jsonResponse(currentQuest);
      }

      if (method === "POST" && path === "/api/quests/1/status") {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          status: MemberStatus;
        };
        currentQuest = {
          ...currentQuest,
          party: currentQuest.party.map((entry) =>
            entry.user.id === HERO.id
              ? { ...entry, status: body.status }
              : entry,
          ),
        };
        return jsonResponse(currentQuest);
      }

      if (method === "POST" && path === "/api/quests/1/leave") {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          reason?: string;
        };
        currentQuest = {
          ...currentQuest,
          party: currentQuest.party.map((entry) =>
            entry.user.id === HERO.id
              ? {
                  ...entry,
                  status: "retreated",
                  retreatReason: body.reason ?? null,
                }
              : entry,
          ),
        };
        return jsonResponse(currentQuest);
      }

      if (
        method === "POST" &&
        (path === "/api/quests/1/nominations" ||
          path === "/api/quests/1/reinforcements")
      ) {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          userIds: number[];
        };
        const kind = path.endsWith("reinforcements")
          ? "reinforce"
          : "nominate";
        const created = body.userIds.map((userId, index) => {
          const target = PROJECT.members.find(
            (projectMember) => projectMember.userId === userId,
          );
          return nomination({
            id: 60 + index,
            nominee: {
              id: userId,
              displayName: target?.displayName ?? `모험가 ${userId}`,
            },
            nominatedBy: { id: HERO.id, displayName: HERO.displayName },
            kind,
          });
        });
        currentQuest = {
          ...currentQuest,
          nominations: [...currentQuest.nominations, ...created],
          pendingNominations:
            currentQuest.nominations.length + created.length,
        };
        return jsonResponse({ nominations: created });
      }

      if (method === "POST" && path === "/api/nominations/55/accept") {
        currentQuest = {
          ...currentQuest,
          nominations: currentQuest.nominations.filter(
            (entry) => entry.id !== 55,
          ),
          pendingNominations: Math.max(
            0,
            currentQuest.pendingNominations - 1,
          ),
          party: [
            ...currentQuest.party,
            member(
              HERO.id,
              HERO.displayName,
              "joined",
              currentQuest.party.length === 0 ? "leader" : "member",
            ),
          ],
        };
        return jsonResponse(currentQuest);
      }

      if (method === "POST" && path === "/api/nominations/55/pass") {
        currentQuest = {
          ...currentQuest,
          nominations: currentQuest.nominations.filter(
            (entry) => entry.id !== 55,
          ),
          pendingNominations: Math.max(
            0,
            currentQuest.pendingNominations - 1,
          ),
        };
        return jsonResponse(currentQuest);
      }

      if (method === "DELETE" && path === "/api/nominations/55") {
        currentQuest = {
          ...currentQuest,
          nominations: currentQuest.nominations.filter(
            (entry) => entry.id !== 55,
          ),
          pendingNominations: Math.max(
            0,
            currentQuest.pendingNominations - 1,
          ),
        };
        return noContentResponse();
      }

      return errorResponse(404, "not_found");
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, getQuest: () => currentQuest };
}

function findCall(
  fetchMock: ReturnType<typeof stubApi>["fetchMock"],
  path: string,
  method: string,
) {
  return fetchMock.mock.calls.find(([input, init]) => {
    const url = new URL(String(input), "http://localhost");
    return (
      url.pathname === path &&
      (init?.method ?? "GET").toUpperCase() === method
    );
  });
}

function renderDrawer(quest: Quest, options: StubOptions = {}) {
  const api = stubApi(quest, options);
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

  return { ...view, api, queryClient, onClose, user: userEvent.setup() };
}

async function openDrawer(quest: Quest, options: StubOptions = {}) {
  const context = renderDrawer(quest, options);
  const dialog = await context.findByRole("dialog", {
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

describe("QuestDrawer dungeon view", () => {
  it("positions the active party by checklist progress and maps status to sprite state", async () => {
    const quest = baseQuest({
      stage: "dungeon",
      direction: "- [x] 1층\n- [ ] 2층\n- [x] 3층\n- [ ] 4층",
      floors: { done: 2, total: 4 },
      party: [
        member(2, "이모험", "fighting", "leader"),
        member(3, "박모험", "done"),
        member(4, "최모험", "joined"),
        member(5, "한모험", "retreated", "member", "오늘은 어려움"),
      ],
    });
    const { dialog } = await openDrawer(quest);
    const placeholder = within(dialog).getByTestId(
      "quest-dungeon-placeholder",
    );

    expect(placeholder).toHaveAttribute("data-dungeon-progress", "0.5");

    const lanes = Array.from(
      placeholder.querySelectorAll<HTMLElement>("[data-dungeon-member]"),
    );
    expect(lanes.map((lane) => lane.dataset.dungeonMember)).toEqual([
      "2",
      "3",
      "4",
    ]);
    expect(lanes.map((lane) => lane.dataset.dungeonState)).toEqual([
      "attack",
      "victory",
      "idle",
    ]);
    // Three sprites spread evenly around the 50% progress marker.
    expect(lanes.map((lane) => lane.style.left)).toEqual([
      "42%",
      "50%",
      "58%",
    ]);
    expect(lanes[0]?.querySelector('[data-user-id="2"]')).toHaveAttribute(
      "data-state",
      "attack",
    );
    expect(lanes[1]?.querySelector('[data-user-id="3"]')).toHaveAttribute(
      "data-state",
      "victory",
    );
    expect(lanes[2]?.querySelector('[data-user-id="4"]')).toHaveAttribute(
      "data-state",
      "idle",
    );

    const progress = within(placeholder).getByRole("progressbar", {
      name: ko.board.drawer.dungeonProgress,
    });
    expect(progress).toHaveAttribute("aria-valuenow", "2");
    expect(progress).toHaveAttribute("aria-valuemax", "4");
  });

  it("falls back to the stage ratio when the checklist is empty", async () => {
    const cases = [
      { stage: "board" as const, ratio: "0" },
      { stage: "dungeon" as const, ratio: "0.5" },
      { stage: "boss" as const, ratio: "0.9" },
      { stage: "cleared" as const, ratio: "1" },
    ];

    for (const { stage, ratio } of cases) {
      const { dialog } = await openDrawer(
        baseQuest({
          stage,
          party: [member(2, "이모험", "fighting", "leader")],
        }),
      );
      expect(
        within(dialog).getByTestId("quest-dungeon-placeholder"),
      ).toHaveAttribute("data-dungeon-progress", ratio);
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("marks the boss stage with the boss icon and 보스 label at the right end", async () => {
    const { dialog } = await openDrawer(
      baseQuest({
        stage: "boss",
        party: [member(2, "이모험", "fighting", "leader")],
      }),
    );
    const placeholder = within(dialog).getByTestId(
      "quest-dungeon-placeholder",
    );
    const bossMarker = placeholder.querySelector<HTMLElement>(
      '[data-dungeon-boss="true"]',
    );

    expect(bossMarker).not.toBeNull();
    expect(bossMarker?.className).toContain("right-2");
    expect(
      within(bossMarker as HTMLElement).getByText(ko.board.drawer.boss),
    ).toBeInTheDocument();
    const bossIcon = bossMarker?.querySelector("img");
    expect(bossIcon?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/64/boss.png",
    );
    expect(bossIcon).toHaveAttribute("width", "64");
    expect(bossIcon).toHaveAttribute("height", "64");
  });
});

describe("QuestDrawer party section", () => {
  it("shows the leader marker and status chips for active members", async () => {
    const { dialog } = await openDrawer(
      baseQuest({
        party: [
          member(2, "이모험", "fighting", "leader"),
          member(3, "박모험", "done"),
          member(4, "최모험", "retreated", "member", "휴가"),
        ],
      }),
    );

    const section = within(dialog).getByTestId("party-section");
    expect(
      within(section).getByRole("heading", { name: ko.party.title }),
    ).toBeInTheDocument();
    expect(within(section).getByText(ko.quest.partyLeader)).toBeInTheDocument();
    expect(
      within(section).getByText(MEMBER_STATUS_LABELS.fighting),
    ).toBeInTheDocument();
    // F1 dropped the per-status icon; the chip is text only.
    expect(
      section.querySelector('[data-party-status-chip="fighting"] img'),
    ).toBeNull();
    expect(
      section.querySelector('[data-party-user-id="2"]'),
    ).toHaveAttribute("data-party-role", "leader");

    const retreated = within(section).getByTestId("retreated-list");
    expect(retreated.tagName).toBe("DETAILS");
    expect(retreated).not.toHaveAttribute("open");
    expect(retreated.className).toContain("opacity-60");
    expect(
      within(retreated).getByText(ko.party.retreated),
    ).toBeInTheDocument();
    expect(within(retreated).getByText("최모험")).toBeInTheDocument();
    expect(
      within(retreated).getByText(ko.party.retreatReason("휴가")),
    ).toBeInTheDocument();
  });

  it("shows 수락/패스 for my pending nomination and accepts it", async () => {
    const { dialog, api, user } = await openDrawer(
      baseQuest({ nominations: [nomination()] }),
    );

    const actions = within(dialog).getByTestId("party-actions");
    expect(
      within(actions).getByRole("button", { name: ko.party.accept }),
    ).toBeInTheDocument();
    expect(
      within(actions).getByRole("button", { name: ko.party.pass }),
    ).toBeInTheDocument();
    expect(
      within(actions).queryByRole("button", { name: ko.party.join }),
    ).toBeNull();

    expect(
      within(dialog).getByText(
        `${ko.party.nominationLabel}: ${HERO.displayName}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(ko.party.nominatedBy("이모험")),
    ).toBeInTheDocument();
    // The nominee may also withdraw the nomination.
    expect(
      within(dialog).getByRole("button", {
        name: ko.party.cancelNomination,
      }),
    ).toBeInTheDocument();

    await user.click(
      within(actions).getByRole("button", { name: ko.party.accept }),
    );

    await waitFor(() =>
      expect(
        findCall(api.fetchMock, "/api/nominations/55/accept", "POST"),
      ).toBeDefined(),
    );
    await waitFor(() =>
      expect(api.getQuest().party.map((entry) => entry.user.id)).toContain(
        HERO.id,
      ),
    );
  });

  it("shows 참여 for a non-member and posts join", async () => {
    const { dialog, api, user } = await openDrawer(baseQuest());

    const actions = within(dialog).getByTestId("party-actions");
    expect(
      within(actions).getByRole("button", { name: ko.party.join }),
    ).toBeInTheDocument();
    expect(
      within(actions).queryByRole("button", { name: ko.party.accept }),
    ).toBeNull();
    expect(
      within(actions).queryByRole("button", { name: ko.party.leave }),
    ).toBeNull();

    await user.click(
      within(actions).getByRole("button", { name: ko.party.join }),
    );

    await waitFor(() =>
      expect(findCall(api.fetchMock, "/api/quests/1/join", "POST")).toBeDefined(),
    );
    await waitFor(() =>
      expect(api.getQuest().party.map((entry) => entry.user.id)).toContain(
        HERO.id,
      ),
    );
  });

  it("toggles the active member status and posts the exact body", async () => {
    const { dialog, api, user } = await openDrawer(
      baseQuest({
        party: [
          member(HERO.id, HERO.displayName, "joined", "leader"),
          member(2, "이모험", "fighting"),
        ],
      }),
    );

    const actions = within(dialog).getByTestId("party-actions");
    const joined = within(actions).getByRole("button", {
      name: MEMBER_STATUS_LABELS.joined,
    });
    expect(joined).toHaveAttribute("aria-pressed", "true");
    expect(
      within(actions).getByRole("button", {
        name: MEMBER_STATUS_LABELS.done,
      }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(actions).queryByRole("button", { name: ko.party.join }),
    ).toBeNull();

    await user.click(
      within(actions).getByRole("button", {
        name: MEMBER_STATUS_LABELS.fighting,
      }),
    );

    await waitFor(() => {
      const call = findCall(api.fetchMock, "/api/quests/1/status", "POST");
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        status: "fighting",
      });
    });
  });

  it("retreats with an optional reason through the leave dialog", async () => {
    const { dialog, api, user } = await openDrawer(
      baseQuest({
        party: [member(HERO.id, HERO.displayName, "fighting", "leader")],
      }),
    );

    await user.click(
      within(dialog).getByRole("button", { name: ko.party.leave }),
    );

    const leaveDialog = await within(document.body).findByRole("dialog", {
      name: ko.party.leaveTitle,
    });
    expect(leaveDialog.className).toContain("shadow-hard");
    expect(leaveDialog.className).toContain("border-[1.5px]");
    await user.type(
      within(leaveDialog).getByLabelText(ko.party.leaveReasonLabel),
      "일정이 겹침",
    );
    await user.click(
      within(leaveDialog).getByRole("button", {
        name: ko.party.leaveConfirm,
      }),
    );

    await waitFor(() => {
      const call = findCall(api.fetchMock, "/api/quests/1/leave", "POST");
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        reason: "일정이 겹침",
      });
    });
    await waitFor(() =>
      expect(api.getQuest().party[0]?.status).toBe("retreated"),
    );
  });

  it("cancels a nomination I made with DELETE /api/nominations/:id", async () => {
    const { dialog, api, user } = await openDrawer(
      baseQuest({
        nominations: [
          nomination({
            nominee: { id: 3, displayName: "박모험" },
            nominatedBy: { id: HERO.id, displayName: HERO.displayName },
          }),
        ],
      }),
    );

    await user.click(
      within(dialog).getByRole("button", {
        name: ko.party.cancelNomination,
      }),
    );

    await waitFor(() =>
      expect(
        findCall(api.fetchMock, "/api/nominations/55", "DELETE"),
      ).toBeDefined(),
    );
  });

  it("hides the cancel action when I am neither nominee nor nominator", async () => {
    const { dialog } = await openDrawer(
      baseQuest({
        nominations: [
          nomination({
            nominee: { id: 3, displayName: "박모험" },
            nominatedBy: { id: 2, displayName: "이모험" },
          }),
        ],
      }),
    );

    expect(
      within(dialog).queryByRole("button", {
        name: ko.party.cancelNomination,
      }),
    ).toBeNull();
  });

  it("shows Korean copy for 409 and 403 party failures", async () => {
    const conflict = await openDrawer(
      baseQuest({
        party: [member(HERO.id, HERO.displayName, "joined", "leader")],
      }),
      { failPost: { path: "/api/quests/1/status", status: 409 } },
    );
    await conflict.user.click(
      within(conflict.dialog).getByRole("button", {
        name: MEMBER_STATUS_LABELS.fighting,
      }),
    );
    await waitFor(() =>
      expect(within(conflict.dialog).getByRole("alert")).toHaveTextContent(
        ko.party.errors.conflict,
      ),
    );

    cleanup();
    vi.unstubAllGlobals();

    const forbidden = await openDrawer(baseQuest(), {
      failPost: { path: "/api/quests/1/join", status: 403 },
    });
    await forbidden.user.click(
      within(forbidden.dialog).getByRole("button", {
        name: ko.party.join,
      }),
    );
    await waitFor(() =>
      expect(within(forbidden.dialog).getByRole("alert")).toHaveTextContent(
        ko.party.errors.forbidden,
      ),
    );
  });
});

describe("QuestDrawer nominate / reinforce popover", () => {
  it("asks for reinforcements without listing active party members", async () => {
    const { dialog, api, user } = await openDrawer(
      baseQuest({
        party: [
          member(HERO.id, HERO.displayName, "joined", "leader"),
          member(2, "이모험", "fighting"),
        ],
      }),
    );

    await user.click(
      within(dialog).getByRole("button", { name: ko.party.reinforce }),
    );

    const popover = await within(document.body).findByRole("dialog", {
      name: ko.party.reinforceTitle,
    });
    await waitFor(() =>
      expect(within(popover).getAllByRole("checkbox")).toHaveLength(2),
    );
    expect(
      within(popover).queryByRole("checkbox", { name: "김모험" }),
    ).toBeNull();
    expect(
      within(popover).queryByRole("checkbox", { name: "이모험" }),
    ).toBeNull();
    expect(
      api.fetchMock.mock.calls.some(
        ([input]) => String(input) === "/api/projects/1",
      ),
    ).toBe(true);

    await user.click(
      within(popover).getByRole("checkbox", { name: "최모험" }),
    );
    await user.click(
      within(popover).getByRole("button", {
        name: ko.party.reinforceSubmit,
      }),
    );

    await waitFor(() => {
      const call = findCall(
        api.fetchMock,
        "/api/quests/1/reinforcements",
        "POST",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ userIds: [4] });
    });
  });

  it("nominates from a non-member and hides active party members", async () => {
    const { dialog, api, user } = await openDrawer(
      baseQuest({
        party: [member(2, "이모험", "fighting", "leader")],
      }),
    );

    await user.click(
      within(dialog).getByRole("button", { name: ko.party.nominate }),
    );

    const popover = await within(document.body).findByRole("dialog", {
      name: ko.party.nominateTitle,
    });
    await waitFor(() =>
      expect(within(popover).getAllByRole("checkbox")).toHaveLength(3),
    );
    expect(
      within(popover).queryByRole("checkbox", { name: "이모험" }),
    ).toBeNull();

    await user.click(
      within(popover).getByRole("checkbox", { name: "박모험" }),
    );
    await user.click(
      within(popover).getByRole("button", {
        name: ko.party.nominateSubmit,
      }),
    );

    await waitFor(() => {
      const call = findCall(
        api.fetchMock,
        "/api/quests/1/nominations",
        "POST",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ userIds: [3] });
    });
  });
});

describe("QuestDrawer pass dialog", () => {
  it("posts the preset reason and toss target, excluding the active party", async () => {
    const { dialog, api, user } = await openDrawer(
      baseQuest({
        party: [member(2, "이모험", "fighting", "leader")],
        nominations: [nomination()],
      }),
    );

    await user.click(
      within(dialog).getByRole("button", { name: ko.party.pass }),
    );

    const passDialog = await within(document.body).findByRole("dialog", {
      name: ko.pass.title,
    });
    for (const preset of PASS_REASON_PRESETS) {
      expect(
        within(passDialog).getByRole("button", { name: preset }),
      ).toBeInTheDocument();
    }

    const toss = within(passDialog).getByLabelText(
      ko.pass.tossLabel,
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(
        within(toss)
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual([ko.pass.tossNone, "박모험", "최모험"]);
    });

    await user.click(
      within(passDialog).getByRole("button", {
        name: PASS_REASON_PRESETS[1]!,
      }),
    );
    await user.selectOptions(toss, "4");
    await user.click(
      within(passDialog).getByRole("button", { name: ko.pass.submit }),
    );

    await waitFor(() => {
      const call = findCall(api.fetchMock, "/api/nominations/55/pass", "POST");
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        reason: PASS_REASON_PRESETS[1],
        relayToUserId: 4,
      });
    });
  });
});

describe("QuestDrawer party cache refresh", () => {
  it("refreshes the quest, events, board, nominations and notifications", async () => {
    const { dialog, queryClient, user } = await openDrawer(
      baseQuest({
        party: [member(HERO.id, HERO.displayName, "joined", "leader")],
      }),
    );

    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await user.click(
      within(dialog).getByRole("button", {
        name: MEMBER_STATUS_LABELS.fighting,
      }),
    );

    await waitFor(() => {
      const keys = invalidate.mock.calls.map(
        ([filters]) => filters?.queryKey,
      );
      expect(keys).toContainEqual(["quests", 1]);
      expect(keys).toContainEqual(queryKeys.quest(1));
      expect(keys).toContainEqual(queryKeys.events(1));
      expect(keys).toContainEqual(queryKeys.myNominations);
      expect(keys).toContainEqual(queryKeys.notifications);
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Quest>(queryKeys.quest(1))?.party[0]?.status,
      ).toBe("fighting"),
    );
  });
});
