/**
 * A paper panel: the default surface for grouped content.
 *
 * Paper background, 1.5px `line-strong` outline, 2px corners and no shadow.
 * Depth comes from the ground/paper/sunken steps, not from elevation.
 */
import type { ReactNode } from "react";

/** Props for {@link Panel}. */
export interface PanelProps {
  children: ReactNode;
  className?: string;
}

/** Paper surface with a hard outline and no shadow. */
export function Panel({ children, className }: PanelProps) {
  const classes = [
    "rounded-sm border-[1.5px] border-line-strong bg-paper p-4",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <section className={classes}>{children}</section>;
}

export default Panel;
