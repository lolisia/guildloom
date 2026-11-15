// @vitest-environment node
/**
 * Realtime shell tests.
 *
 * `socket.io-client` is mocked with a controllable fake so the hook can be
 * driven event by event: connect/subscribe, guild switches, cache
 * invalidation, notification toasts, level-ups, reconnect refresh and cleanup
 * (including React StrictMode's double mount).
 *
 * jsdom is installed manually by `domEnvironment` because the workspace-local
 * copy is invisible to the hoisted Vitest runner.
 */
import "./domEnvironment";

import type { Notification } from "@guildloom/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SocketHandler = (payload?: unknown) => void;

const realtime = vi.hoisted(() => {
  const handlers = new Map<string, Set<SocketHandler>>();
  const socket = {
    connected: false,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };

  socket.on.mockImplementation((event: string, handler: SocketHandler) => {
    let listeners = handlers.get(event);
    if (!listeners) {
      listeners = new Set<SocketHandler>();
      handlers.set(event, listeners);
    }
    listeners.add(handler);
    return socket;
  });

  socket.off.mockImplementation((event: string, handler: SocketHandler) => {
    handlers.get(event)?.delete(handler);
    return socket;
  });

  socket.disconnect.mockImplementation(() => {
    socket.connected = false;
  });

  const io = vi.fn(() => socket);

  return {
    io,
    socket,
    handlers,
    emitServer(event: string, payload?: unknown) {
      for (const handler of [...(handlers.get(event) ?? [])]) {
        handler(payload);
      }
    },
    reset() {
      handlers.clear();
      socket.connected = false;
      socket.on.mockClear();
      socket.off.mockClear();
      socket.emit.mockClear();
      socket.disconnect.mockClear();
      io.mockClear();
    },
  };
});

vi.mock("socket.io-client", () => ({ io: realtime.io }));

const { LevelUpModal, LEVEL_UP_DURATION_MS } = await import(
  "../src/components/LevelUpModal"
);
const { ko } = await import("../src/i18n/ko");
const { useLevelUpStore } = await import("../src/lib/levelUp");
const { useRealtime } = await import("../src/lib/realtime");
const { ToastHost, pushToast, useToastStore, TOAST_DURATION_MS } =
  await import("../src/lib/toast");

const NOTIFICATION: Notification = {
  id: 11,
  projectId: 4,
  questId: 9,
  questNumber: 12,
  questTitle: "로그인 버그",
  type: "nominated",
  actor: { id: 2, displayName: "이모험" },
  payload: null,
  createdAt: 1_760_000_000_000,
  readAt: null,
};

function setupRealtime(projectId: number | null, strict = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const wrapper = ({ children }: { children: ReactNode }) => {
    const tree = (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };

  const view = renderHook(
    ({ id }: { id: number | null }) => useRealtime(id),
    { initialProps: { id: projectId }, wrapper },
  );

  return { ...view, queryClient, invalidateSpy };
}

async function connect() {
  await waitFor(() => {
    expect(realtime.io).toHaveBeenCalledWith({ path: "/socket.io" });
  });
  act(() => {
    realtime.socket.connected = true;
    realtime.emitServer("connect");
  });
}

beforeEach(() => {
  realtime.reset();
  useToastStore.getState().clear();
  useLevelUpStore.getState().dismiss();
});

afterEach(() => {
  cleanup();
});

describe("useRealtime", () => {
  it("connects, subscribes to the guild and invalidates quest caches", async () => {
    const view = setupRealtime(4);
    await connect();

    expect(realtime.socket.emit).toHaveBeenCalledWith("subscribe:project", {
      projectId: 4,
    });

    act(() => {
      realtime.emitServer("quest:changed", { projectId: 4, questId: 9 });
    });

    await waitFor(() => {
      expect(view.invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["quests", 4],
      });
      expect(view.invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["quest", 9],
      });
      expect(view.invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["events", 9],
      });
    });
  });

  it("invalidates notifications and pushes a toast on notification:new", async () => {
    const view = setupRealtime(4);
    await connect();

    act(() => {
      realtime.emitServer("notification:new", {
        notification: NOTIFICATION,
      });
    });

    await waitFor(() => {
      expect(view.invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["notifications"],
      });
      // The inline 수락 / 패스 actions read the pending nomination list.
      expect(view.invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["myNominations"],
      });
    });
    expect(
      useToastStore.getState().toasts.map((toast) => toast.message),
    ).toContain(ko.notifications.format(NOTIFICATION));
  });

  it("invalidates me and shows the level-up modal on xp:changed", async () => {
    const view = setupRealtime(4);
    await connect();

    act(() => {
      realtime.emitServer("xp:changed", {
        userId: 1,
        xp: 600,
        level: 5,
        levelUp: { userId: 1, from: 4, to: 5 },
      });
    });

    await waitFor(() => {
      expect(view.invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["me"],
      });
    });
    expect(useLevelUpStore.getState().current).toEqual({
      userId: 1,
      from: 4,
      to: 5,
    });
  });

  it("invalidates the guild detail on members:changed", async () => {
    const view = setupRealtime(4);
    await connect();

    act(() => {
      realtime.emitServer("members:changed", { projectId: 7 });
    });

    await waitFor(() => {
      expect(view.invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["project", 7],
      });
    });
  });

  it("leaves the previous guild on switch and refreshes active queries after a reconnect", async () => {
    const view = setupRealtime(4);
    await connect();

    view.rerender({ id: 5 });

    await waitFor(() => {
      expect(realtime.socket.emit).toHaveBeenCalledWith(
        "unsubscribe:project",
        { projectId: 4 },
      );
      expect(realtime.socket.emit).toHaveBeenCalledWith(
        "subscribe:project",
        { projectId: 5 },
      );
    });

    view.invalidateSpy.mockClear();

    act(() => {
      realtime.emitServer("connect");
    });

    await waitFor(() => {
      expect(view.invalidateSpy).toHaveBeenCalledWith();
    });
    expect(realtime.socket.emit).toHaveBeenCalledWith("subscribe:project", {
      projectId: 5,
    });
  });

  it("cleans up listeners and disconnects on unmount", async () => {
    const view = setupRealtime(4);
    await connect();

    view.unmount();

    expect(realtime.socket.disconnect).toHaveBeenCalled();
    for (const listeners of realtime.handlers.values()) {
      expect(listeners.size).toBe(0);
    }
  });

  it("survives StrictMode's double mount without leaking listeners", async () => {
    const view = setupRealtime(4, true);

    await waitFor(() => {
      expect(realtime.io).toHaveBeenCalled();
    });
    // Whether React reused or remounted the effect, each server event must be
    // observed exactly once.
    expect(realtime.handlers.get("quest:changed")?.size).toBe(1);
    expect(realtime.handlers.get("notification:new")?.size).toBe(1);

    act(() => {
      realtime.socket.connected = true;
      realtime.emitServer("connect");
    });
    expect(realtime.socket.emit).toHaveBeenCalledWith("subscribe:project", {
      projectId: 4,
    });

    view.unmount();
    expect(realtime.socket.disconnect).toHaveBeenCalled();
    for (const listeners of realtime.handlers.values()) {
      expect(listeners.size).toBe(0);
    }
  });
});

describe("LevelUpModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLevelUpStore.getState().dismiss();
  });

  afterEach(() => {
    act(() => {
      useLevelUpStore.getState().dismiss();
    });
    vi.useRealTimers();
  });

  it("renders LEVEL UP! with the level transition, stars and a 3s timer", () => {
    act(() => {
      useLevelUpStore.getState().show({ userId: 1, from: 2, to: 3 });
    });

    const view = render(<LevelUpModal />);

    expect(view.getByText("LEVEL UP!")).toBeInTheDocument();
    expect(view.getByText("Lv.2 → Lv.3")).toBeInTheDocument();
    expect(view.getAllByTestId("level-up-star")).toHaveLength(6);

    act(() => {
      vi.advanceTimersByTime(LEVEL_UP_DURATION_MS - 1);
    });
    expect(view.queryByTestId("level-up-modal")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(view.queryByTestId("level-up-modal")).toBeNull();
  });

  it("closes on click", () => {
    act(() => {
      useLevelUpStore.getState().show({ userId: 1, from: 2, to: 3 });
    });

    const view = render(<LevelUpModal />);
    fireEvent.click(view.getByTestId("level-up-modal"));

    expect(view.queryByTestId("level-up-modal")).toBeNull();
    expect(useLevelUpStore.getState().current).toBeNull();
  });
});

describe("ToastHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().clear();
  });

  afterEach(() => {
    act(() => {
      useToastStore.getState().clear();
    });
    vi.useRealTimers();
  });

  it("shows a toast and removes it after 4 seconds", () => {
    act(() => {
      pushToast("새 알림이 도착했습니다.");
    });

    const view = render(<ToastHost />);
    expect(view.getByText("새 알림이 도착했습니다.")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(view.getByText("새 알림이 도착했습니다.")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(
      view.queryByText("새 알림이 도착했습니다."),
    ).not.toBeInTheDocument();
  });
});
