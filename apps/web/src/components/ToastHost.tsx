/**
 * Re-export of the toast stack from `lib/toast`.
 *
 * The store lives next to the realtime hook (so `pushToast` can be called
 * outside React); `AppLayout` imports the host through this component path so
 * the shell keeps one component per shell concern.
 */
export { ToastHost, default } from "../lib/toast";
