// @vitest-environment node
/**
 * Shell smoke tests: setup/auth guards, last-project redirect, the tab bar,
 * the API client and the shared Korean copy.
 *
 * The workspace installs `jsdom` as a dev dependency of `@guildloom/web`, but
 * npm keeps it under `apps/web/node_modules` while Vitest is hoisted to the
 * repository root. Vitest's built-in jsdom environment therefore cannot resolve
 * the package, so we run in the Node environment and install the same jsdom
 * window before loading React Testing Library. Everything else is hermetic:
 * `fetch` is always stubbed and no server or network is involved.
 */
import type { MeResponse, ProjectSummary, UserProfile } from "@guildloom/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The authenticated shell now opens the realtime Socket.IO connection.
 * These routing/render tests stay offline with an inert client;
 * `realtime.test.tsx` installs its own controllable fake instead.
 */
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

// jsdom 29 ships without type declarations and `@types/jsdom` is not part of
// the M1 dependency set, so import it through an untyped expression (the
// runtime specifier is still the literal "jsdom").
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
  // Keep Node's own globals (fetch, URL, TextEncoder, …) but replace the ones
  // React and Testing Library expect from a browser window.
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

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const userEvent = (await import("@testing-library/user-event")).default;
const { MemoryRouter, useLocation } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const { ApiClientError, apiFetch } = await import("../src/api/client");
const { fetchMe, fetchSetupStatus, login, logout, setup } = await import(
  "../src/api/auth"
);
const { createProject, fetchProject, fetchProjects, updateProject } = await import(
  "../src/api/projects"
);
const { ko } = await import("../src/i18n/ko");
const { queryKeys } = await import("../src/lib/queryKeys");
const { AppRoutes } = await import("../src/router");

type RenderResult = ReturnType<typeof render>;

const HERO: UserProfile = {
  id: 1,
  loginId: "hero",
  displayName: "김모험",
  xp: 150,
  level: 2,
};

const PROJECTS: ProjectSummary[] = [
  { id: 1, name: "달빛 길드", role: "owner" },
  { id: 2, name: "별빛 길드", role: "member" },
];

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

function stubFetch(
  implementation: (
    input: RequestInfo | URL,
    init: RequestInit,
  ) => Promise<Response>,
) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

interface RenderOptions {
  needsSetup?: boolean;
  me?: UserProfile | null;
  projects?: ProjectSummary[];
  handlers?: Record<string, MockHandler>;
}

function renderApp(initialPath: string, options: RenderOptions = {}) {
  const {
    needsSetup = false,
    me = HERO,
    projects = PROJECTS,
    handlers = {},
  } = options;

  const fetchMock = vi.fn(
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = String(input);
      const method = (init.method ?? "GET").toUpperCase();
      const key = `${method} ${url}`;

      const handler = handlers[key];
      if (handler) {
        const reply = await handler(init);
        if (reply.status === 204) {
          return noContentResponse();
        }
        return jsonResponse(reply.body, reply.status ?? 200);
      }

      if (key === "GET /api/setup/status") {
        return jsonResponse({ needsSetup });
      }

      if (key === "GET /api/auth/me") {
        if (me) {
          return jsonResponse({ user: me } satisfies MeResponse);
        }
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

      if (key === "GET /api/projects") {
        return jsonResponse(projects);
      }

      if (key === "POST /api/auth/logout") {
        return noContentResponse();
      }

      return jsonResponse(
        { error: { code: "not_found", message: "not found" } },
        404,
      );
    },
  );

  vi.stubGlobal("fetch", fetchMock);

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
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return {
    fetchMock,
    queryClient,
    user: userEvent.setup(),
    ...view,
  };
}

async function expectPath(view: RenderResult, path: string) {
  await waitFor(() => {
    expect(view.getByTestId("location").textContent).toBe(path);
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("router guards", () => {
  it("redirects every non-invite route to /setup while setup is required", async () => {
    const view = renderApp("/login", { needsSetup: true, me: null });
    await expectPath(view, "/setup");
  });

  it("keeps /invite/:code public while setup is required", async () => {
    const view = renderApp("/invite/abc123", { needsSetup: true, me: null });
    await expectPath(view, "/invite/abc123");
  });

  it("redirects unauthenticated visitors to /login after setup", async () => {
    const view = renderApp("/g/1", { needsSetup: false, me: null });
    await expectPath(view, "/login");
  });

  it("keeps /invite/:code public after setup for signed-out visitors", async () => {
    const view = renderApp("/invite/xyz789", { needsSetup: false, me: null });
    await expectPath(view, "/invite/xyz789");
  });

  it("sends authenticated visitors away from /setup and /login", async () => {
    const view = renderApp("/setup", { needsSetup: false, me: HERO });
    await expectPath(view, "/g/1");
  });

  it("exposes the board, ledger and settings routes", async () => {
    const board = renderApp("/g/1", { me: HERO });
    await expectPath(board, "/g/1");
    board.unmount();

    const ledger = renderApp("/g/1/ledger", { me: HERO });
    await expectPath(ledger, "/g/1/ledger");
    ledger.unmount();

    const settings = renderApp("/g/1/settings", { me: HERO });
    await expectPath(settings, "/g/1/settings");
  });

  it("records the visited project in gl:lastProject", async () => {
    const view = renderApp("/g/2/settings", { me: HERO });
    await expectPath(view, "/g/2/settings");
    await waitFor(() => {
      expect(window.localStorage.getItem("gl:lastProject")).toBe("2");
    });
  });
});

describe("RootRedirect", () => {
  it("uses the remembered project when it belongs to the adventurer", async () => {
    window.localStorage.setItem("gl:lastProject", "2");
    const view = renderApp("/", { me: HERO });
    await expectPath(view, "/g/2");
  });

  it("falls back to the first project when the remembered one is stale", async () => {
    window.localStorage.setItem("gl:lastProject", "999");
    const view = renderApp("/", { me: HERO });
    await expectPath(view, "/g/1");
  });

  it("falls back to the first project when nothing is remembered", async () => {
    const view = renderApp("/", { me: HERO });
    await expectPath(view, "/g/1");
  });

  it("renders the guild empty state when no projects exist", async () => {
    const view = renderApp("/", { me: HERO, projects: [] });

    const message = await view.findByText(ko.common.noProjects);
    expect(view.getByText(ko.common.noProjectsHint)).toBeInTheDocument();

    const icon = message.closest("div")?.querySelector("img");
    expect(icon?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/64/guild.png",
    );
    expect(icon).toHaveAttribute("width", "64");
  });

  it("renders the project-load error in the route body with a token retry", async () => {
    const view = renderApp("/", {
      me: HERO,
      handlers: {
        "GET /api/projects": () => ({
          status: 500,
          body: {
            error: { code: "unexpected_error", message: "projects down" },
          },
        }),
      },
    });

    await waitFor(() => {
      expect(view.container.querySelector("main")).not.toBeNull();
    });
    const main = view.container.querySelector("main") as HTMLElement;
    const message = await within(main).findByText(ko.errors.loadFailed);
    expect(message.className).toContain("text-brick");

    const retry = within(main).getByRole("button", { name: ko.common.retry });
    expect(retry.className).toContain("bg-paper");
    expect(retry.className).toContain("border-line-strong");

    await view.user.click(retry);
    await waitFor(() => {
      const projectReads = view.fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url) === "/api/projects" &&
          (init?.method ?? "GET") === "GET",
      );
      expect(projectReads.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("shell route states", () => {
  it("renders the loading state with design tokens", async () => {
    const view = renderApp("/login", {
      me: null,
      handlers: {
        "GET /api/setup/status": () => new Promise<MockReply>(() => {}),
      },
    });

    const status = await view.findByRole("status");
    expect(status.className).toContain("bg-ground");
    expect(status.className).toContain("font-body");
    expect(status.className).toContain("text-ink");
    expect(status).toHaveTextContent(ko.common.loading);
  });

  it("renders the shell error with a secondary retry button", async () => {
    const view = renderApp("/login", {
      me: null,
      handlers: {
        "GET /api/setup/status": () => ({
          status: 500,
          body: {
            error: { code: "unexpected_error", message: "setup down" },
          },
        }),
      },
    });

    const message = await view.findByText(ko.errors.loadFailed);
    expect(message.className).toContain("text-brick");

    const screen = message.parentElement as HTMLElement;
    expect(screen.className).toContain("bg-ground");
    expect(screen.className).toContain("font-body");
    expect(screen.className).toContain("text-ink");

    const retry = within(screen).getByRole("button", { name: ko.common.retry });
    expect(retry.className).toContain("bg-paper");
    expect(retry.className).toContain("border-line-strong");

    await view.user.click(retry);
    await waitFor(() => {
      const setupReads = view.fetchMock.mock.calls.filter(
        ([url]) => String(url) === "/api/setup/status",
      );
      expect(setupReads.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("TabBar", () => {
  it("lists the user's guilds and marks the active one", async () => {
    const view = renderApp("/g/1", { me: HERO });

    const active = await view.findByRole("link", { name: "달빛 길드" });
    const other = view.getByRole("link", { name: "별빛 길드" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveAttribute("data-role", "owner");
    expect(active.className).toContain("border-[1.5px]");
    expect(active.className).toContain("border-line-strong");
    expect(active.className).toContain("bg-ground");
    expect(other).not.toHaveAttribute("aria-current");
    expect(other).toHaveAttribute("data-role", "member");
    expect(other.className).not.toContain("border-");
    expect(other.className).toContain("hover:bg-sunken");
  });

  it("shows the sprite, display name, Lv.N and XP progress", async () => {
    const view = renderApp("/g/1", { me: HERO });
    await view.findByRole("link", { name: "달빛 길드" });

    const sprite = view.container.querySelector('[data-user-id="1"]');
    expect(sprite).not.toBeNull();
    expect(sprite).toHaveTextContent("김");
    expect(sprite).toHaveAttribute("data-state", "idle");

    expect(view.getByText(HERO.displayName)).toBeInTheDocument();
    const levelBadge = view.getByText(ko.tabs.level(2));
    expect(levelBadge).toBeInTheDocument();
    expect(levelBadge.className).toContain("font-pixel");
    expect(levelBadge.className).toContain("text-gold");

    const progressbar = view.getByRole("progressbar", {
      name: ko.tabs.xpLabel,
    });
    expect(progressbar).toHaveAttribute("aria-valuemin", "0");
    expect(progressbar).toHaveAttribute("aria-valuenow", "50");
    expect(progressbar).toHaveAttribute("aria-valuemax", "200");
    expect(progressbar).toHaveAttribute("title", ko.tabs.xp(50, 200));
    expect(progressbar.className).toContain("h-2");
    expect(progressbar.className).toContain("border-[1.5px]");
    expect(progressbar.className).toContain("border-line-strong");

    const fill = progressbar.firstElementChild as HTMLElement;
    expect(fill.className).toContain("bg-gold-fill");
    expect(fill).toHaveStyle({ width: "25%" });
  });

  it("renders a paper top bar with outlined guild and view tabs", async () => {
    const view = renderApp("/g/1", { me: HERO });
    await view.findByRole("link", { name: "달빛 길드" });

    const header = view.container.querySelector("header") as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("top-0");
    expect(header.className).toContain("bg-paper");
    expect(header.className).toContain("border-b-[1.5px]");
    expect(header.className).toContain("border-line-strong");
    expect(header.className).not.toContain("backdrop");
    expect(header.textContent).not.toContain("⚔");

    const logo = within(header).getByRole("link", {
      name: ko.common.appName,
    });
    expect(logo.className).toContain("font-pixel");
    expect(logo.className).toContain("text-[16px]");

    const views = view.getByRole("navigation", { name: ko.tabs.viewToggle });
    const board = within(views).getByRole("link", { name: ko.tabs.board });
    const ledger = within(views).getByRole("link", { name: ko.tabs.ledger });
    const settings = within(views).getByRole("link", {
      name: ko.tabs.settings,
    });

    expect(board).toHaveAttribute("aria-current", "page");
    expect(board.className).toContain("border-[1.5px]");
    expect(board.className).toContain("border-line-strong");
    expect(board.className).toContain("bg-ground");
    expect(ledger.className).not.toContain("border-");
    expect(ledger.className).toContain("hover:bg-sunken");
    expect(settings.className).not.toContain("border-");

    const icons: Array<[HTMLElement, string]> = [
      [board, "board"],
      [ledger, "ledger"],
      [settings, "settings"],
    ];
    for (const [link, iconName] of icons) {
      const image = link.querySelector("img");
      expect(image?.getAttribute("src")).toBe(
        `/assets/icons/jrpg-v1/32/${iconName}.png`,
      );
      expect(image).toHaveAttribute("width", "32");
    }

    expect(within(board).getByText(ko.tabs.board)).toBeInTheDocument();
    expect(within(ledger).getByText(ko.tabs.ledger)).toBeInTheDocument();
    expect(within(settings).getByText(ko.tabs.settings)).toBeInTheDocument();

    const create = view.getByRole("button", { name: ko.tabs.createGuild });
    expect(create.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/32/add.png",
    );
  });

  it("renders the theme menu and a ghost logout with the logout icon", async () => {
    const view = renderApp("/g/1", { me: HERO });
    await view.findByRole("link", { name: "달빛 길드" });

    expect(view.getByRole("button", { name: ko.theme.label })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );

    const logoutButton = view.getByRole("button", {
      name: ko.tabs.logout,
    });
    expect(logoutButton.className).toContain("hover:bg-sunken");
    expect(logoutButton.className).not.toContain("border-line-strong");
    expect(logoutButton.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/32/logout.png",
    );
  });

  it("renders the project-load error and retry as separate flex items", async () => {
    const view = renderApp("/g/1", {
      me: HERO,
      handlers: {
        "GET /api/projects": () => ({
          status: 500,
          body: {
            error: { code: "unexpected_error", message: "projects down" },
          },
        }),
      },
    });

    const projectList = await view.findByRole("navigation", {
      name: ko.tabs.projectList,
    });
    const message = await within(projectList).findByText(
      ko.errors.loadFailed,
    );
    const group = message.parentElement as HTMLElement;

    expect(group.className).toContain("flex");
    expect(group.className).toContain("gap-2");
    expect(group.textContent).not.toContain("·");

    const retry = within(group).getByRole("button", {
      name: ko.common.retry,
    });
    expect(group).toContainElement(retry);

    await view.user.click(retry);
    await waitFor(() => {
      const projectReads = view.fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url) === "/api/projects" &&
          (init?.method ?? "GET") === "GET",
      );
      expect(projectReads.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("ignores the Enter that confirms an IME candidate in the create dialog", async () => {
    const view = renderApp("/g/1", { me: HERO });
    await view.user.click(
      await view.findByRole("button", { name: ko.tabs.createGuild }),
    );

    const dialog = view.getByRole("dialog", {
      name: ko.tabs.createGuildTitle,
    });
    const input = within(dialog).getByLabelText(ko.tabs.guildName);
    fireEvent.change(input, { target: { value: "새 길드" } });

    const composingEnter = fireEvent.keyDown(input, {
      key: "Enter",
      isComposing: true,
    });
    expect(composingEnter).toBe(false);
    expect(
      view.fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/projects" && init?.method === "POST",
      ),
    ).toBe(false);

    const regularEnter = fireEvent.keyDown(input, { key: "Enter" });
    expect(regularEnter).toBe(true);
  });

  it("switches guilds and persists gl:lastProject", async () => {
    const view = renderApp("/g/1", { me: HERO });
    const { user } = view;

    await user.click(await view.findByRole("link", { name: "별빛 길드" }));
    await expectPath(view, "/g/2");
    await waitFor(() => {
      expect(window.localStorage.getItem("gl:lastProject")).toBe("2");
    });
    expect(view.getByRole("link", { name: "별빛 길드" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("toggles between the board and the ledger", async () => {
    const view = renderApp("/g/1", { me: HERO });
    const { user } = view;
    await view.findByRole("link", { name: "달빛 길드" });

    await user.click(view.getByRole("link", { name: ko.tabs.ledger }));
    await expectPath(view, "/g/1/ledger");
    expect(view.getByRole("link", { name: ko.tabs.ledger })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(view.getByRole("link", { name: ko.tabs.board }));
    await expectPath(view, "/g/1");
    expect(view.getByRole("link", { name: ko.tabs.board })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("creates a guild, invalidates projects and navigates to it", async () => {
    const view = renderApp("/g/1", {
      me: HERO,
      handlers: {
        "POST /api/projects": (init) => {
          const body = JSON.parse(String(init.body)) as { name: string };
          return {
            status: 201,
            body: { id: 3, name: body.name, createdAt: 1 },
          };
        },
      },
    });
    const { user, fetchMock } = view;

    await user.click(
      await view.findByRole("button", { name: ko.tabs.createGuild }),
    );

    const dialog = view.getByRole("dialog", {
      name: ko.tabs.createGuildTitle,
    });
    expect(dialog.className).toContain("bg-paper");
    expect(dialog.className).toContain("border-[1.5px]");
    expect(dialog.className).toContain("border-line-strong");
    expect(dialog.className).toContain("shadow-hard");
    expect(dialog.className).toContain("rounded-sm");

    const submit = within(dialog).getByRole("button", {
      name: ko.common.create,
    });
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit.className).toContain("bg-ink");
    expect(submit.className).toContain("text-paper");

    await user.type(
      within(dialog).getByLabelText(ko.tabs.guildName),
      "새로운 길드",
    );
    await user.click(submit);

    await expectPath(view, "/g/3");

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/projects" && init?.method === "POST",
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: "새로운 길드",
    });

    await waitFor(() => {
      const projectReads = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url) === "/api/projects" &&
          (init?.method ?? "GET") === "GET",
      );
      expect(projectReads.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("logs out, clears the session and returns to /login", async () => {
    const view = renderApp("/g/1", { me: HERO });
    const { user, fetchMock } = view;

    await user.click(
      await view.findByRole("button", { name: ko.tabs.logout }),
    );

    await expectPath(view, "/login");
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/auth/logout" && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("drops private notification and nomination caches on logout", async () => {
    const view = renderApp("/g/1", { me: HERO });
    const { queryClient, user } = view;

    // Wait for the guild list so its initial fetch can no longer land after
    // the logout assertions.
    await view.findByRole("link", { name: "달빛 길드" });
    const projectReads = () =>
      view.fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url) === "/api/projects" &&
          (init?.method ?? "GET") === "GET",
      ).length;
    const readsBeforeLogout = projectReads();

    // A query cache lives for the whole app session (the test client keeps
    // data forever), so seed what the bell and inline actions would cache.
    act(() => {
      queryClient.setQueryData(queryKeys.notifications, {
        items: [],
        unreadCount: 3,
      });
      queryClient.setQueryData(queryKeys.myNominations, []);
      queryClient.setQueryData(queryKeys.projects, PROJECTS);
    });

    await user.click(view.getByRole("button", { name: ko.tabs.logout }));
    await expectPath(view, "/login");

    expect(queryClient.getQueryData(queryKeys.notifications)).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.myNominations)).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.projects)).toBeUndefined();
    // The last render of the signed-in shell must not restart the guild
    // query after its cache was removed.
    expect(projectReads()).toBe(readsBeforeLogout);
  });
});

describe("apiFetch", () => {
  it("prefixes /api, sends JSON and parses the body", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ ok: true }));

    const result = await apiFetch<{ ok: boolean }>("/ping", {
      method: "POST",
      body: { hello: "world" },
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ping",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ hello: "world" }),
        credentials: "same-origin",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("does not double-prefix paths that already start with /api", async () => {
    const fetchMock = stubFetch(async () => jsonResponse([]));

    await apiFetch("/api/projects");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/projects");
  });

  it("omits JSON headers when there is no body", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}));

    await apiFetch("/setup/status");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({ Accept: "application/json" });
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe("same-origin");
  });

  it("resolves undefined for 204 responses", async () => {
    stubFetch(async () => noContentResponse());

    await expect(
      apiFetch<void>("/auth/logout", { method: "POST" }),
    ).resolves.toBeUndefined();
  });

  it("throws ApiClientError parsed from {error:{code,message}}", async () => {
    stubFetch(async () =>
      jsonResponse(
        { error: { code: "forbidden", message: "권한이 없습니다." } },
        403,
      ),
    );

    const error = await apiFetch("/secret").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 403,
      code: "forbidden",
      message: "권한이 없습니다.",
    });
  });

  it("falls back to a generic message for malformed error bodies", async () => {
    stubFetch(async () => jsonResponse({ nope: true }, 500));

    const error = await apiFetch("/broken").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 500,
      code: "unexpected_error",
      message: ko.errors.http(500),
    });
  });

  it("wraps transport failures in ApiClientError", async () => {
    stubFetch(async () => {
      throw new TypeError("network down");
    });

    const error = await apiFetch("/offline").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 0,
      code: "network_error",
      message: ko.errors.network,
    });
  });
});

describe("API modules", () => {
  it("call the documented endpoints with the shared request bodies", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}));

    await fetchSetupStatus();
    await setup({
      guildName: "달빛 길드",
      displayName: "김모험",
      loginId: "hero",
      password: "password1",
    });
    await login({ loginId: "hero", password: "password1" });
    await logout();
    await fetchMe();

    await fetchProjects();
    await createProject({ name: "새 길드" });
    await fetchProject(5);
    await updateProject(5, { name: "이름 변경" });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body,
    }));

    expect(calls).toEqual([
      { url: "/api/setup/status", method: "GET", body: undefined },
      {
        url: "/api/setup",
        method: "POST",
        body: JSON.stringify({
          guildName: "달빛 길드",
          displayName: "김모험",
          loginId: "hero",
          password: "password1",
        }),
      },
      {
        url: "/api/auth/login",
        method: "POST",
        body: JSON.stringify({ loginId: "hero", password: "password1" }),
      },
      { url: "/api/auth/logout", method: "POST", body: undefined },
      { url: "/api/auth/me", method: "GET", body: undefined },
      { url: "/api/projects", method: "GET", body: undefined },
      {
        url: "/api/projects",
        method: "POST",
        body: JSON.stringify({ name: "새 길드" }),
      },
      { url: "/api/projects/5", method: "GET", body: undefined },
      {
        url: "/api/projects/5",
        method: "PATCH",
        body: JSON.stringify({ name: "이름 변경" }),
      },
    ]);
  });
});

describe("queryKeys", () => {
  it("matches the keys later tasks will reuse", () => {
    expect(queryKeys.setupStatus).toEqual(["setupStatus"]);
    expect(queryKeys.me).toEqual(["me"]);
    expect(queryKeys.projects).toEqual(["projects"]);
    expect(queryKeys.project(4)).toEqual(["project", 4]);
    expect(queryKeys.quests(4, { stage: "board" })).toEqual([
      "quests",
      4,
      { stage: "board" },
    ]);
    expect(queryKeys.quest(9)).toEqual(["quest", 9]);
    expect(queryKeys.events(9)).toEqual(["events", 9]);
    expect(queryKeys.tags(4)).toEqual(["tags", 4, ""]);
    expect(queryKeys.tags(4, "긴급")).toEqual(["tags", 4, "긴급"]);
    expect(queryKeys.invites(4)).toEqual(["invites", 4]);
  });
});

describe("ko copy", () => {
  it("contains the exact board column labels", () => {
    expect(ko.board.columns).toEqual({
      board: "게시판",
      dungeon: "던전 진행",
      boss: "보스전",
      cleared: "클리어",
    });
  });

  it("contains the exact ledger column labels", () => {
    expect(ko.ledger.columns).toEqual({
      number: "번호",
      title: "제목",
      tags: "태그",
      party: "파티",
      bounty: "현상금",
      floors: "층",
      stage: "단계",
      rank: "등급",
      createdBy: "작성자",
      createdAt: "등록일",
      updatedAt: "수정일",
    });
  });

  it("contains the exact drawer labels and bulk confirm template", () => {
    expect(ko.board.drawer.situation).toBe("현재 상황");
    expect(ko.board.drawer.direction).toBe("수정 방향");
    expect(ko.board.drawer.dungeonComingSoon).toBe("던전 뷰 준비 중");
    expect(ko.board.drawer.history).toBe("모험 기록");
    expect(ko.board.drawer.archive).toBe("의뢰 내리기");
    expect(ko.board.bulk.confirm(7)).toBe("7건을 의뢰로 등록할까요?");
  });

  it("exposes setup, login, invite, settings and error labels", () => {
    expect(ko.setup.title).toBe("길드 만들기");
    expect(ko.login.title).toBe("로그인");
    expect(ko.invite.title).toBe("길드 초대");
    expect(ko.settings.title).toBe("길드 설정");
    expect(ko.errors.generic.length).toBeGreaterThan(0);
  });

  it("formats relative time in Korean", () => {
    const now = new Date("2026-01-01T12:00:00Z").getTime();

    expect(ko.time.relative(now, now)).toBe("방금 전");
    expect(ko.time.relative(now - 30_000, now)).toBe("방금 전");
    expect(ko.time.relative(now - 5 * 60_000, now)).toBe("5분 전");
    expect(ko.time.relative(now - 3 * 3_600_000, now)).toBe("3시간 전");
    expect(ko.time.relative(now - 4 * 86_400_000, now)).toBe("4일 전");
    expect(ko.time.relative(now + 1_000, now)).toBe("방금 전");
  });
});
