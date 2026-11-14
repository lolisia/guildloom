/**
 * Top-bar theme picker: 시스템 / 라이트 / 다크.
 *
 * A ghost button opens a small paper popover with radio-style menu items. The
 * choice is persisted through `setThemePreference` (`localStorage` key
 * `gl:theme`) and applied to `<html data-theme>` immediately. Escape and any
 * click outside the menu close it.
 */
import { useEffect, useRef, useState } from "react";

import { ko } from "../i18n/ko";
import {
  getThemePreference,
  setThemePreference,
  THEME_PREFERENCES,
  type ThemePreference,
} from "../lib/theme";
import Icon from "./Icon";

/** Menu copy per preference. */
const PREFERENCE_LABEL: Record<ThemePreference, string> = {
  system: ko.theme.system,
  light: ko.theme.light,
  dark: ko.theme.dark,
};

/** Props for {@link ThemeMenu}. */
export interface ThemeMenuProps {
  className?: string;
}

/** Theme preference menu for the top bar. */
export function ThemeMenu({ className }: ThemeMenuProps) {
  const [open, setOpen] = useState(false);
  const [preference, setPreference] = useState<ThemePreference>(() =>
    getThemePreference(),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const container = containerRef.current;
      const target = event.target;
      if (
        container &&
        target instanceof Node &&
        !container.contains(target)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const toggle = (): void => {
    setPreference(getThemePreference());
    setOpen((current) => !current);
  };

  const choose = (next: ThemePreference): void => {
    setThemePreference(next);
    setPreference(next);
    setOpen(false);
  };

  const containerClasses = className ? `relative ${className}` : "relative";

  return (
    <div ref={containerRef} className={containerClasses}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="inline-flex h-8 items-center rounded-sm px-3 text-sm font-medium text-ink transition-colors hover:bg-sunken"
      >
        {ko.theme.label}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={ko.theme.label}
          className="absolute right-0 top-full z-50 mt-1 min-w-32 rounded-sm border-[1.5px] border-line-strong bg-paper py-1 shadow-hard"
        >
          {THEME_PREFERENCES.map((option) => {
            const checked = option === preference;

            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                onClick={() => choose(option)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-ink transition-colors hover:bg-sunken"
              >
                <span>{PREFERENCE_LABEL[option]}</span>
                {checked ? <Icon name="success" size={32} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default ThemeMenu;
