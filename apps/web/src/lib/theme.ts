/**
 * Light/dark theme preference, persisted in localStorage and applied to
 * `<html data-theme="light|dark">`.
 *
 * The stored preference is `system`, `light` or `dark`. `system` follows the
 * OS through `prefers-color-scheme`, which is what most people want by default;
 * an explicit choice survives reloads.
 *
 * `index.html` repeats the resolution inline before first paint so the page
 * never flashes the wrong theme. Keep the storage key and the accepted values
 * in sync with that script.
 */

/** A user's theme choice. `system` follows the OS. */
export type ThemePreference = "system" | "light" | "dark";

/** localStorage key holding the theme preference. */
export const THEME_STORAGE_KEY = "gl:theme";

/** Every accepted preference, in menu order. */
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

/** The theme actually painted on the page; `system` always resolves to one. */
export type ResolvedTheme = "light" | "dark";

/** Narrow an arbitrary value to a {@link ThemePreference}. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/**
 * localStorage can be missing (server rendering, privacy modes) or throw on
 * access, so every read and write goes through this guard.
 */
function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The OS colour-scheme query, or `null` when `matchMedia` is unavailable. */
function getSystemQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }

  try {
    return window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return null;
  }
}

/** Whether the OS currently asks for the dark theme. Defaults to light. */
export function systemPrefersDark(): boolean {
  return getSystemQuery()?.matches ?? false;
}

/** Read the stored preference; unset or invalid values mean `system`. */
export function getThemePreference(): ThemePreference {
  try {
    const stored = getStorage()?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Resolve a preference to the theme that should be painted. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return preference;
}

/** Paint a preference onto `<html data-theme>`. */
function paintTheme(preference: ThemePreference): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = resolveTheme(preference);
}

/** Apply the stored preference to the document. */
export function applyTheme(): void {
  paintTheme(getThemePreference());
}

/**
 * Persist a preference and apply it immediately.
 *
 * Invalid values are a programming error, so they throw instead of silently
 * resetting the user's choice.
 */
export function setThemePreference(preference: ThemePreference): void {
  if (!isThemePreference(preference)) {
    throw new TypeError(`Unknown theme preference: ${String(preference)}`);
  }

  try {
    getStorage()?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be full or blocked; the in-page theme still applies.
  }

  paintTheme(preference);
}

/**
 * Re-apply the theme when the OS colour scheme changes.
 *
 * Only listeners whose preference is still `system` react, so an explicit
 * light/dark choice is never overridden. Returns an unsubscribe function.
 */
export function watchSystemTheme(): () => void {
  const query = getSystemQuery();

  if (!query) {
    return () => {};
  }

  const handleChange = (): void => {
    if (getThemePreference() === "system") {
      applyTheme();
    }
  };

  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", handleChange);
    return () => {
      query.removeEventListener("change", handleChange);
    };
  }

  // Safari < 14 only implements the deprecated listener API.
  if (typeof query.addListener === "function") {
    query.addListener(handleChange);
    return () => {
      query.removeListener(handleChange);
    };
  }

  return () => {};
}
