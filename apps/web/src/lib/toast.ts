/**
 * Bottom-right toast stack.
 *
 * Anything outside React (the realtime hook, the clear feedback helper) can
 * call {@link pushToast}; the {@link ToastHost} mounted by `AppLayout` renders
 * the stack and dismisses each toast after its own duration (4s by default).
 * An optional action button closes the toast and runs its callback, which is
 * how the 10s `던전 클리어!` toast offers 되돌리기. Toasts use the paper +
 * 1.5px ink + hard `4px 4px 0` shadow treatment DESIGN.md reserves for
 * popovers.
 *
 * This module is a `.ts` file (the realtime hook imports it from outside
 * JSX), so the host is written with `createElement` instead of JSX.
 */
import { createElement, useEffect } from "react";
import { create } from "zustand";

import { Button } from "../components/ui/Button";

/** One action rendered inside a toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** One visible toast. */
export interface ToastItem {
  id: number;
  message: string;
  action?: ToastAction;
  /** How long this toast stays on screen. */
  durationMs: number;
}

/** Optional per-toast behaviour for {@link pushToast}. */
export interface PushToastOptions {
  action?: ToastAction;
  durationMs?: number;
}

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, options?: PushToastOptions) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

/** Default time a toast stays on screen. */
export const TOAST_DURATION_MS = 4_000;

let nextToastId = 1;

/** Toast queue shared by `pushToast` and {@link ToastHost}. */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push(message, options) {
    const id = nextToastId;
    nextToastId += 1;
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id,
          message,
          action: options?.action,
          durationMs: options?.durationMs ?? TOAST_DURATION_MS,
        },
      ],
    }));
    return id;
  },

  dismiss(id) {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },

  clear() {
    set({ toasts: [] });
  },
}));

/** Queue a toast from anywhere (including outside React). */
export function pushToast(
  message: string,
  options?: PushToastOptions,
): number {
  return useToastStore.getState().push(message, options);
}

/** One toast; owns its own auto-dismiss timer. */
function Toast({ toast }: { toast: ToastItem }) {
  const dismiss = useToastStore((state) => state.dismiss);

  useEffect(() => {
    const timer = window.setTimeout(
      () => dismiss(toast.id),
      toast.durationMs,
    );
    return () => window.clearTimeout(timer);
  }, [dismiss, toast.id, toast.durationMs]);

  return createElement(
    "li",
    {
      role: "status",
      "data-toast-id": toast.id,
      className:
        "rounded-sm border-[1.5px] border-line-strong bg-paper px-3 py-2 text-sm text-ink shadow-hard",
    },
    createElement(
      "div",
      { className: "flex items-center justify-between gap-3" },
      createElement(
        "span",
        { className: "min-w-0 flex-1 break-words" },
        toast.message,
      ),
      toast.action
        ? createElement(
            Button,
            {
              variant: "ghost",
              size: "sm",
              className: "shrink-0",
              onClick: () => {
                dismiss(toast.id);
                toast.action?.onClick();
              },
            },
            toast.action.label,
          )
        : null,
    ),
  );
}

/** Fixed bottom-right stack; renders nothing while the queue is empty. */
export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);

  if (toasts.length === 0) {
    return null;
  }

  return createElement(
    "div",
    {
      "data-testid": "toast-host",
      "aria-live": "polite",
      className:
        "fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2",
    },
    createElement(
      "ul",
      { className: "flex flex-col gap-2" },
      toasts.map((toast) =>
        createElement(Toast, { key: toast.id, toast }),
      ),
    ),
  );
}

export default ToastHost;
