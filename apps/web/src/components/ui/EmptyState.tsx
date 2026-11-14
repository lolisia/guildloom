/**
 * Empty-state block: one large pack icon, one line of guidance and an optional
 * action button.
 *
 * The 64px icon is the pack's native 2x size; it is never scaled. The text is a
 * single short sentence (DESIGN.md forbids ornamented, multi-line empty copy).
 */
import type { ReactNode } from "react";

import type { IconName } from "../../lib/icons";
import Icon from "../Icon";

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  icon: IconName;
  text: string;
  action?: ReactNode;
  className?: string;
}

/** Centered empty-state placeholder. */
export function EmptyState({ icon, text, action, className }: EmptyStateProps) {
  const classes = [
    "flex flex-col items-center justify-center gap-3 px-4 py-8 text-center",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <Icon name={icon} size={64} />
      <p className="text-sm text-muted">{text}</p>
      {action}
    </div>
  );
}

export default EmptyState;
