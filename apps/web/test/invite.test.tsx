// @vitest-environment node
/**
 * Public invite page tests: signup for anonymous visitors, join for
 * signed-in adventurers and the invalid/revoked state. `fetch` is stubbed and
 * every screen renders under its own `MemoryRouter`/`QueryClientProvider`.
 */
import type {
  InviteJoinResponse,
  InviteSignupResponse,
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

// Bind queries to the installed jsdom body (see the bootstrap comment above:
// the shared screen singleton is created before the globals exist).
const screen = within(document.body);

const InvitePage = (await import("../src/routes/InvitePage")).default;
const { ko } = await import("../src/i18n/ko");
const { queryKeys } = await import("../src/lib/queryKeys");

const HERO: UserProfile = {
  id: 1,
  loginId: "hero",
  displayName: "김모험",
  xp: 0,
  level: 1,
};

const PROJECT_NAME = "달빛 길드";

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

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderInvite(code: string) {
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
      <MemoryRouter initialEntries={[`/invite/${code}`]}>
        <Routes>
          <Route path="/invite/:code" element={<InvitePage />} />
          <Route
            path="/g/:projectId"
            element={<div data-testid="board-page">board</div>}
          />
          <Route
            path="/login"
            element={<div data-testid="login-page">login</div>}
          />
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

/** Anonymous visitor: `/api/auth/me` answers 401. */
const ANONYMOUS_ME: MockHandler = () => ({
  status: 401,
  body: { error: { code: "UNAUTHORIZED", message: "unauthorized" } },
});

const VALID_INVITE: MockHandler = () => ({
  body: { projectName: PROJECT_NAME, valid: true },
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("InvitePage", () => {
  it("shows the guild name and a signup form for anonymous visitors", async () => {
    installFetch({
      "GET /api/invites/abc123": VALID_INVITE,
      "GET /api/auth/me": ANONYMOUS_ME,
    });
    const view = renderInvite("abc123");

    expect(await screen.findByText(PROJECT_NAME)).toBeInTheDocument();
    expect(
      await screen.findByText(ko.invite.signupTitle),
    ).toBeInTheDocument();

    // The invite screen has the 64px invite header, a paper panel and the
    // invite/key icons on the signup controls.
    const headerIcon = view.container.querySelector(
      'img[src$="/64/invite.png"]',
    );
    expect(headerIcon).toHaveAttribute("width", "64");
    expect(headerIcon?.closest("section")).toHaveClass(
      "bg-paper",
      "border-line-strong",
      "shadow-hard",
    );
    const signup = screen.getByRole("button", { name: ko.invite.signup });
    expect(signup).toHaveAttribute("type", "submit");
    expect(signup.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/32/invite.png",
    );
    expect(
      screen
        .getByLabelText(ko.invite.password)
        .parentElement?.querySelector("img")
        ?.getAttribute("src"),
    ).toBe("/assets/icons/jrpg-v1/32/key.png");

    expect(
      screen.queryByRole("button", { name: ko.invite.join }),
    ).toBeNull();
  });

  it("signs a new adventurer up and opens the guild board", async () => {
    const signupResponse: InviteSignupResponse = { user: HERO, projectId: 9 };
    const fetchMock = installFetch({
      "GET /api/invites/abc123": VALID_INVITE,
      "GET /api/auth/me": ANONYMOUS_ME,
      "POST /api/invites/abc123/signup": () => ({
        status: 201,
        body: signupResponse,
      }),
    });
    const view = renderInvite("abc123");

    await screen.findByText(ko.invite.signupTitle);
    await view.user.type(
      screen.getByLabelText(ko.invite.displayName),
      "김모험",
    );
    await view.user.type(screen.getByLabelText(ko.invite.loginId), "hero");
    await view.user.type(
      screen.getByLabelText(ko.invite.password),
      "password1",
    );
    await view.user.type(
      screen.getByLabelText(ko.invite.passwordConfirm),
      "password1",
    );
    await view.user.click(
      screen.getByRole("button", { name: ko.invite.signup }),
    );

    await expectPath("/g/9");
    expect(screen.getByTestId("board-page")).toBeInTheDocument();

    const signupCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/invites/abc123/signup" &&
        init?.method === "POST",
    );
    expect(JSON.parse(String(signupCall?.[1]?.body))).toEqual({
      displayName: "김모험",
      loginId: "hero",
      password: "password1",
    });
    expect(view.queryClient.getQueryData(queryKeys.me)).toEqual({ user: HERO });
    expect(view.queryClient.getQueryData(queryKeys.setupStatus)).toEqual({
      needsSetup: false,
    });
  });

  it("rejects a mismatched password confirmation before signing up", async () => {
    const fetchMock = installFetch({
      "GET /api/invites/abc123": VALID_INVITE,
      "GET /api/auth/me": ANONYMOUS_ME,
    });
    const view = renderInvite("abc123");

    await screen.findByText(ko.invite.signupTitle);
    await view.user.type(
      screen.getByLabelText(ko.invite.displayName),
      "김모험",
    );
    await view.user.type(screen.getByLabelText(ko.invite.loginId), "hero");
    await view.user.type(
      screen.getByLabelText(ko.invite.password),
      "password1",
    );
    await view.user.type(
      screen.getByLabelText(ko.invite.passwordConfirm),
      "password2",
    );
    await view.user.click(
      screen.getByRole("button", { name: ko.invite.signup }),
    );

    expect(screen.getByText(ko.invite.passwordMismatch)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url, init]) =>
        String(url).endsWith("/signup") && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("shows the Korean login-id-taken message on a signup conflict", async () => {
    installFetch({
      "GET /api/invites/abc123": VALID_INVITE,
      "GET /api/auth/me": ANONYMOUS_ME,
      "POST /api/invites/abc123/signup": () => ({
        status: 409,
        body: { error: { code: "LOGIN_ID_TAKEN", message: "taken" } },
      }),
    });
    const view = renderInvite("abc123");

    await screen.findByText(ko.invite.signupTitle);
    await view.user.type(
      screen.getByLabelText(ko.invite.displayName),
      "김모험",
    );
    await view.user.type(screen.getByLabelText(ko.invite.loginId), "hero");
    await view.user.type(
      screen.getByLabelText(ko.invite.password),
      "password1",
    );
    await view.user.type(
      screen.getByLabelText(ko.invite.passwordConfirm),
      "password1",
    );
    await view.user.click(
      screen.getByRole("button", { name: ko.invite.signup }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      ko.errors.byCode.login_id_taken ?? ko.errors.conflict,
    );
  });

  it("lets a signed-in adventurer join and treats already-member 200 as success", async () => {
    const joinResponse: InviteJoinResponse = { projectId: 9 };
    const fetchMock = installFetch({
      "GET /api/invites/abc123": VALID_INVITE,
      "GET /api/auth/me": () => ({ body: { user: HERO } }),
      "POST /api/invites/abc123/join": () => ({ status: 200, body: joinResponse }),
    });
    const view = renderInvite("abc123");

    const joinButton = await screen.findByRole("button", {
      name: ko.invite.join,
    });
    expect(joinButton).toHaveAttribute("type", "button");
    expect(joinButton.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/icons/jrpg-v1/32/login.png",
    );
    expect(screen.queryByLabelText(ko.invite.password)).toBeNull();

    await view.user.click(joinButton);

    await expectPath("/g/9");
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/invites/abc123/join" &&
          init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("reports unknown invite codes with a Korean message and login link", async () => {
    installFetch({
      "GET /api/invites/missing": () => ({
        status: 404,
        body: { error: { code: "INVITE_NOT_FOUND", message: "missing" } },
      }),
      "GET /api/auth/me": ANONYMOUS_ME,
    });
    renderInvite("missing");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ko.invite.invalid);
    const loginLink = screen.getByRole("link", {
      name: ko.invite.loginLink,
    });
    expect(loginLink).toHaveAttribute("href", "/login");
    expect(screen.queryByLabelText(ko.invite.password)).toBeNull();
  });

  it("reports revoked invites with the same invalid state", async () => {
    installFetch({
      "GET /api/invites/revoked": () => ({
        body: { projectName: PROJECT_NAME, valid: false },
      }),
      "GET /api/auth/me": ANONYMOUS_ME,
    });
    renderInvite("revoked");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ko.invite.invalid);
    expect(
      screen.getByRole("link", { name: ko.invite.loginLink }),
    ).toHaveAttribute("href", "/login");
    expect(screen.queryByText(ko.invite.signupTitle)).toBeNull();
  });
});
