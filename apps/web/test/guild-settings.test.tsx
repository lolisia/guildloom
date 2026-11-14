// @vitest-environment node
/**
 * Guild settings tests: owner-only rename, invite creation/copy/revocation
 * (with confirmation) and the member roster. `fetch`, `navigator.clipboard`
 * and `window.confirm` are stubbed; no server is involved.
 */
import type {
  Invite,
  Project,
  ProjectDetailResponse,
  ProjectMember,
  UserProfile,
} from "@guildloom/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { cleanup, render, waitFor, within } = await import(
  "@testing-library/react"
);
const userEvent = (await import("@testing-library/user-event")).default;
const { MemoryRouter, Route, Routes } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

// Bind queries to the installed jsdom body (see the bootstrap comment above:
// the shared screen singleton is created before the globals exist).
const screen = within(document.body);

const GuildSettingsPage = (await import("../src/routes/GuildSettingsPage"))
  .default;
const { ko } = await import("../src/i18n/ko");

const HERO: UserProfile = {
  id: 1,
  loginId: "hero",
  displayName: "김모험",
  xp: 150,
  level: 2,
};

const OWNER_MEMBER: ProjectMember = {
  userId: 1,
  displayName: "김모험",
  role: "owner",
  xp: 150,
  level: 2,
};

const PLAIN_MEMBER: ProjectMember = {
  userId: 2,
  displayName: "아린",
  role: "member",
  xp: 0,
  level: 1,
};

const PROJECT: Project = {
  id: 1,
  name: "달빛 길드",
  createdAt: 1_700_000_000_000,
};

interface MockReply {
  status?: number;
  body?: unknown;
}

type MockHandler = (init: RequestInit) => MockReply | Promise<MockReply>;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function installFetch(routes: Record<string, MockHandler>) {
  const fetchMock = vi.fn(
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = String(input);
      const method = (init.method ?? "GET").toUpperCase();
      const handler = routes[`${method} ${url}`];
      if (!handler) {
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "not found" } },
          404,
        );
      }
      const reply = await handler(init);
      return jsonResponse(reply.body, reply.status ?? 200);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSettings() {
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
      <MemoryRouter initialEntries={["/g/1/settings"]}>
        <Routes>
          <Route
            path="/g/:projectId/settings"
            element={<GuildSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { user: userEvent.setup(), ...view };
}

function stubClipboard() {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

function detail(
  members: ProjectMember[],
  project: Project = PROJECT,
): ProjectDetailResponse {
  return { project, members };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).clipboard;
  window.localStorage.clear();
});

describe("GuildSettingsPage", () => {
  it("lets the owner rename the guild and invalidates the detail query", async () => {
    let projectName = PROJECT.name;
    const fetchMock = installFetch({
      "GET /api/auth/me": () => ({ body: { user: HERO } }),
      "GET /api/projects/1": () => ({
        body: detail([OWNER_MEMBER], { ...PROJECT, name: projectName }),
      }),
      "GET /api/projects/1/invites": () => ({ body: [] }),
      "PATCH /api/projects/1": (init) => {
        const body = JSON.parse(String(init.body)) as { name: string };
        projectName = body.name;
        return { body: { ...PROJECT, name: body.name } };
      },
    });
    const { user } = renderSettings();

    const input = await screen.findByLabelText(ko.settings.guildName);
    expect(input).toHaveValue("달빛 길드");

    await user.clear(input);
    await user.type(input, "새 달빛 길드");
    await user.click(
      screen.getByRole("button", { name: ko.settings.saveGuildName }),
    );

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/projects/1" && init?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      name: "새 달빛 길드",
    });

    expect(await screen.findByText(ko.settings.saved)).toBeInTheDocument();

    await waitFor(() => {
      const reads = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url) === "/api/projects/1" &&
          (init?.method ?? "GET") === "GET",
      );
      expect(reads.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows a read-only guild name to non-owners", async () => {
    installFetch({
      "GET /api/auth/me": () => ({
        body: {
          user: { ...HERO, xp: 0, level: 1 },
        },
      }),
      "GET /api/projects/1": () => ({ body: detail([PLAIN_MEMBER]) }),
      "GET /api/projects/1/invites": () => ({ body: [] }),
    });
    renderSettings();

    expect(
      await screen.findByTestId("guild-name"),
    ).toHaveTextContent("달빛 길드");
    expect(screen.queryByLabelText(ko.settings.guildName)).toBeNull();
    expect(
      screen.queryByRole("button", { name: ko.settings.saveGuildName }),
    ).toBeNull();
  });

  it("creates an invite, copies its absolute URL and revokes it after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    let revoked = false;

    const invites = (): Invite[] => [
      {
        id: 7,
        code: "oldcode",
        url: "/invite/oldcode",
        createdBy: { id: 1, displayName: "김모험" },
        createdAt: 1_700_000_000_000,
        revokedAt: revoked ? 1_700_000_100_000 : null,
      },
    ];

    const fetchMock = installFetch({
      "GET /api/auth/me": () => ({ body: { user: HERO } }),
      "GET /api/projects/1": () => ({ body: detail([OWNER_MEMBER]) }),
      "GET /api/projects/1/invites": () => ({ body: invites() }),
      "POST /api/projects/1/invites": () => ({
        status: 201,
        body: { code: "freshcode", url: "/invite/freshcode" },
      }),
      "DELETE /api/projects/1/invites/7": () => {
        revoked = true;
        return { status: 204 };
      },
    });

    const { user } = renderSettings();
    // `userEvent.setup()` installs its own clipboard stub, so override it
    // after the view (and its user) exist.
    const writeText = stubClipboard();

    await user.click(
      await screen.findByRole("button", { name: ko.settings.createInvite }),
    );

    const created = await screen.findByTestId("created-invite");
    expect(within(created).getByText("freshcode")).toBeInTheDocument();
    expect(
      within(created).getByText("http://localhost/invite/freshcode"),
    ).toBeInTheDocument();

    await user.click(
      within(created).getByRole("button", { name: ko.settings.copyInvite }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "http://localhost/invite/freshcode",
      );
    });
    expect(
      await within(created).findByRole("button", {
        name: ko.settings.copied,
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: ko.settings.revokeInvite }),
    );
    expect(confirmSpy).toHaveBeenCalledWith(ko.settings.revokeConfirm);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/projects/1/invites/7" &&
            init?.method === "DELETE",
        ),
      ).toBe(true);
    });
    expect(await screen.findByText(ko.settings.revoked)).toBeInTheDocument();
  });

  it("does not revoke when the confirmation is dismissed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = installFetch({
      "GET /api/auth/me": () => ({ body: { user: HERO } }),
      "GET /api/projects/1": () => ({ body: detail([OWNER_MEMBER]) }),
      "GET /api/projects/1/invites": () => ({
        body: [
          {
            id: 7,
            code: "oldcode",
            url: "/invite/oldcode",
            createdBy: { id: 1, displayName: "김모험" },
            createdAt: 1_700_000_000_000,
            revokedAt: null,
          },
        ],
      }),
    });

    const { user } = renderSettings();
    await user.click(
      await screen.findByRole("button", { name: ko.settings.revokeInvite }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(ko.settings.revokeConfirm);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/projects/1/invites/7" &&
          init?.method === "DELETE",
      ),
    ).toBe(false);
  });

  it("renders members with avatars, Korean role labels, levels and XP", async () => {
    installFetch({
      "GET /api/auth/me": () => ({ body: { user: HERO } }),
      "GET /api/projects/1": () => ({
        body: detail([OWNER_MEMBER, PLAIN_MEMBER]),
      }),
      "GET /api/projects/1/invites": () => ({ body: [] }),
    });

    renderSettings();

    const list = await screen.findByRole("list", {
      name: ko.settings.members,
    });

    expect(within(list).getByText("김모험")).toBeInTheDocument();
    expect(within(list).getByText(ko.settings.roleOwner)).toBeInTheDocument();
    expect(within(list).getByText(ko.settings.roleMember)).toBeInTheDocument();
    expect(within(list).getByText(ko.tabs.level(2))).toBeInTheDocument();
    expect(within(list).getByText(ko.tabs.level(1))).toBeInTheDocument();
    expect(
      within(list).getByText(ko.tabs.xp(50, 200)),
    ).toBeInTheDocument();
    expect(within(list).getByText(ko.tabs.xp(0, 100))).toBeInTheDocument();

    const ownerSprite = list.querySelector('[data-user-id="1"]');
    expect(ownerSprite).not.toBeNull();
    expect(ownerSprite).toHaveTextContent("김");
    expect((ownerSprite as HTMLElement).className).toContain("h-8");
    expect(list.querySelector('[data-user-id="2"]')).toHaveTextContent("아");
  });
});
