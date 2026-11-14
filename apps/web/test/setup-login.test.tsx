// @vitest-environment node
/**
 * Setup wizard and login screen tests.
 *
 * Both screens are rendered under `MemoryRouter`/`QueryClientProvider` with a
 * stubbed `fetch`; no server or network is involved. The explicit JSDOM
 * bootstrap mirrors `shell.test.tsx` (Vitest is hoisted to the repo root while
 * jsdom lives in `apps/web/node_modules`).
 */
import type {
  Project,
  SetupResponse,
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
const { MemoryRouter, Route, Routes, useLocation } = await import(
  "react-router-dom"
);
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

// `@testing-library/dom`'s `screen` singleton was initialised (by the shared
// setup file) before the jsdom globals above existed, so bind a fresh query
// object to the installed body instead.
const screen = within(document.body);

const SetupPage = (await import("../src/routes/SetupPage")).default;
const LoginPage = (await import("../src/routes/LoginPage")).default;
const { ko } = await import("../src/i18n/ko");
const { queryKeys } = await import("../src/lib/queryKeys");

const HERO: UserProfile = {
  id: 1,
  loginId: "hero",
  displayName: "김모험",
  xp: 0,
  level: 1,
};

const PROJECT: Project = {
  id: 5,
  name: "달빛 길드",
  createdAt: 1_700_000_000_000,
};

const SETUP_RESPONSE: SetupResponse = { user: HERO, project: PROJECT };

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

function errorResponse(status: number, code: string): Response {
  return jsonResponse({ error: { code, message: code } }, status);
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
        return errorResponse(404, "NOT_FOUND");
      }
      const reply = await handler(init);
      return jsonResponse(reply.body, reply.status ?? 200);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderAt(initialPath: string) {
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
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/g/:projectId"
            element={<div data-testid="board-page">board</div>}
          />
          <Route path="/" element={<div data-testid="home-page">home</div>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { queryClient, user: userEvent.setup(), ...view };
}

async function expectPath(path: string) {
  await waitFor(() => {
    expect(screen.getByTestId("location").textContent).toBe(path);
  });
}

interface SetupValues {
  guildName?: string;
  displayName?: string;
  loginId?: string;
  password?: string;
  passwordConfirm?: string;
}

async function fillSetupForm(
  user: ReturnType<typeof userEvent.setup>,
  values: SetupValues = {},
) {
  const {
    guildName = "달빛 길드",
    displayName = "김모험",
    loginId = "hero",
    password = "password1",
    passwordConfirm = password,
  } = values;

  await user.type(screen.getByLabelText(ko.setup.guildName), guildName);
  await user.type(screen.getByLabelText(ko.setup.displayName), displayName);
  await user.type(screen.getByLabelText(ko.setup.loginId), loginId);
  await user.type(screen.getByLabelText(ko.setup.password), password);
  await user.type(
    screen.getByLabelText(ko.setup.passwordConfirm),
    passwordConfirm,
  );
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

describe("SetupPage", () => {
  it("creates the first guild, caches the session and opens the new board", async () => {
    let needsSetup = true;
    const fetchMock = installFetch({
      "GET /api/setup/status": () => ({ body: { needsSetup } }),
      "POST /api/setup": () => {
        needsSetup = false;
        return { status: 201, body: SETUP_RESPONSE };
      },
    });
    const view = renderAt("/setup");
    const invalidateSpy = vi.spyOn(view.queryClient, "invalidateQueries");
    await screen.findByLabelText(ko.setup.guildName);
    await fillSetupForm(view.user, { guildName: "  달빛 길드  " });
    await view.user.click(
      screen.getByRole("button", { name: ko.setup.submit }),
    );

    await expectPath("/g/5");
    expect(screen.getByTestId("board-page")).toBeInTheDocument();

    const setupCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/setup" && init?.method === "POST",
    );
    expect(setupCall).toBeDefined();
    expect(JSON.parse(String(setupCall?.[1]?.body))).toEqual({
      guildName: "달빛 길드",
      displayName: "김모험",
      loginId: "hero",
      password: "password1",
    });

    // The session and setup state are primed, and the shared keys invalidated.
    expect(view.queryClient.getQueryData(queryKeys.me)).toEqual({
      user: HERO,
    });
    await waitFor(() => {
      expect(view.queryClient.getQueryData(queryKeys.setupStatus)).toEqual({
        needsSetup: false,
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.setupStatus,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.me });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.projects,
    });
  });

  it("blocks empty input with Korean validation copy and no request", async () => {
    const fetchMock = installFetch({
      "GET /api/setup/status": () => ({ body: { needsSetup: true } }),
    });
    const view = renderAt("/setup");

    await screen.findByLabelText(ko.setup.guildName);
    await view.user.click(
      screen.getByRole("button", { name: ko.setup.submit }),
    );

    expect(
      screen.getAllByText(ko.errors.validation).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/setup" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("rejects mismatched passwords before calling the API", async () => {
    const fetchMock = installFetch({
      "GET /api/setup/status": () => ({ body: { needsSetup: true } }),
    });
    const view = renderAt("/setup");

    await screen.findByLabelText(ko.setup.guildName);
    await fillSetupForm(view.user, { passwordConfirm: "password2" });
    await view.user.click(
      screen.getByRole("button", { name: ko.setup.submit }),
    );

    expect(screen.getByText(ko.setup.passwordMismatch)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/setup" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("shows the Korean conflict message on a 409 response", async () => {
    installFetch({
      "GET /api/setup/status": () => ({ body: { needsSetup: true } }),
      "POST /api/setup": () => ({ status: 409, body: { error: {} } }),
    });
    const view = renderAt("/setup");

    await screen.findByLabelText(ko.setup.guildName);
    await fillSetupForm(view.user);
    await view.user.click(
      screen.getByRole("button", { name: ko.setup.submit }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ko.errors.conflict);
    await expectPath("/setup");
  });

  it("redirects away when setup is already complete", async () => {
    installFetch({
      "GET /api/setup/status": () => ({ body: { needsSetup: false } }),
    });
    renderAt("/setup");

    await expectPath("/");
    expect(screen.getByTestId("home-page")).toBeInTheDocument();
    expect(screen.queryByLabelText(ko.setup.guildName)).toBeNull();
  });
});

describe("LoginPage", () => {
  it("logs in and returns to the remembered guild", async () => {
    window.localStorage.setItem("gl:lastProject", "2");
    const fetchMock = installFetch({
      "POST /api/auth/login": () => ({ body: { user: HERO } }),
    });
    const view = renderAt("/login");

    await screen.findByLabelText(ko.login.loginId);
    await view.user.type(screen.getByLabelText(ko.login.loginId), "hero");
    await view.user.type(
      screen.getByLabelText(ko.login.password),
      "password1",
    );
    await view.user.click(
      screen.getByRole("button", { name: ko.login.submit }),
    );

    await expectPath("/g/2");
    const loginCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/auth/login" && init?.method === "POST",
    );
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({
      loginId: "hero",
      password: "password1",
    });
    expect(view.queryClient.getQueryData(queryKeys.me)).toEqual({ user: HERO });
  });

  it("falls back to / when no guild was remembered", async () => {
    installFetch({
      "POST /api/auth/login": () => ({ body: { user: HERO } }),
    });
    const view = renderAt("/login");

    await screen.findByLabelText(ko.login.loginId);
    await view.user.type(screen.getByLabelText(ko.login.loginId), "hero");
    await view.user.type(
      screen.getByLabelText(ko.login.password),
      "password1",
    );
    await view.user.click(
      screen.getByRole("button", { name: ko.login.submit }),
    );

    await expectPath("/");
    expect(screen.getByTestId("home-page")).toBeInTheDocument();
  });

  it("shows the Korean invalid-credentials message on 401", async () => {
    installFetch({
      "POST /api/auth/login": () => ({
        status: 401,
        body: { error: { code: "INVALID_CREDENTIALS", message: "nope" } },
      }),
    });
    const view = renderAt("/login");

    await screen.findByLabelText(ko.login.loginId);
    await view.user.type(screen.getByLabelText(ko.login.loginId), "hero");
    await view.user.type(
      screen.getByLabelText(ko.login.password),
      "wrongpass",
    );
    await view.user.click(
      screen.getByRole("button", { name: ko.login.submit }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ko.login.invalidCredentials);
    await expectPath("/login");
  });

  it("validates the form before hitting the API", async () => {
    const fetchMock = installFetch({});
    const view = renderAt("/login");

    await screen.findByLabelText(ko.login.loginId);
    await view.user.click(
      screen.getByRole("button", { name: ko.login.submit }),
    );

    expect(
      screen.getAllByText(ko.errors.validation).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/auth/login" && init?.method === "POST",
      ),
    ).toBe(false);
  });
});
