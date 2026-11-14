// @vitest-environment node
/**
 * IME guard tests for the guild rename form.
 *
 * The workspace keeps `jsdom` inside `apps/web/node_modules` while Vitest is
 * hoisted to the repository root, so the built-in `jsdom` environment cannot
 * resolve it. Every DOM test file therefore runs in the Node environment and
 * installs the same jsdom window before loading React Testing Library (see
 * `test/shell.test.tsx`). `fetch` is stubbed; no server is involved.
 */
import type { Project } from "@guildloom/shared";
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

const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const { default: GuildNameForm } = await import("./GuildNameForm");
const { ko } = await import("../../i18n/ko");

const PROJECT: Project = {
  id: 1,
  name: "달빛 길드",
  createdAt: 1_700_000_000_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GuildNameForm IME guard", () => {
  it("cancels a composing Enter, then renames on a normal submit", async () => {
    const fetchMock = vi.fn(
      async (
        input: RequestInfo | URL,
        init: RequestInit = {},
      ): Promise<Response> => {
        const url = String(input);
        const method = (init.method ?? "GET").toUpperCase();
        if (method === "PATCH" && url === "/api/projects/1") {
          const body = JSON.parse(String(init.body)) as { name: string };
          return jsonResponse({ ...PROJECT, name: body.name });
        }
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "not found" } },
          404,
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const view = render(
      <QueryClientProvider client={queryClient}>
        <GuildNameForm projectId={1} projectName="달빛 길드" isOwner />
      </QueryClientProvider>,
    );

    const input = view.getByLabelText(ko.settings.guildName);
    fireEvent.change(input, { target: { value: "새 달빛 길드" } });
    expect(input).toHaveValue("새 달빛 길드");

    // Enter confirming an IME candidate: the default (implicit form submit)
    // is canceled and no request leaves the component.
    expect(
      fireEvent.keyDown(input, { key: "Enter", isComposing: true }),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    // A plain Enter is not canceled, and submitting the form renames the guild.
    expect(
      fireEvent.keyDown(input, { key: "Enter", isComposing: false }),
    ).toBe(true);

    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/projects/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "새 달빛 길드" });
  });
});
