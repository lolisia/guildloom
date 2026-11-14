/**
 * A tag chip.
 *
 * Chips are 12px muted text inside a 1px `line` hairline with 2px corners. They
 * never contain icons: the icon rule only permits the pack's 32/64px sizes and
 * a chip is smaller than that. Removal is a plain "×" button whose accessible
 * name comes from the caller (`removeLabel`, e.g. "태그 삭제: 버그").
 */
import type { ReactNode } from "react";

/** Props for {@link Chip}. */
export interface ChipProps {
  children: ReactNode;
  /** Show the "×" remove button and call this when it is pressed. */
  onRemove?: () => void;
  /** Accessible name for the remove button, e.g. `태그 삭제: 버그`. */
  removeLabel?: string;
  className?: string;
}

/** Tag chip. */
export function Chip({ children, onRemove, removeLabel, className }: ChipProps) {
  const classes = [
    "inline-flex items-center gap-1 rounded-sm border border-line px-2 py-0.5 text-xs text-muted",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="rounded-sm px-0.5 leading-none text-muted transition-colors hover:text-brick"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export default Chip;
