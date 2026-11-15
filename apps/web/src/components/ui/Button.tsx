/**
 * The one button in the design system.
 *
 * Variants follow DESIGN.md: `primary` is the ink button (the only primary
 * action colour), `secondary` is a bordered paper button, `danger` marks
 * destructive actions in brick, and `ghost` is a borderless button for dense
 * toolbars. The default button is 28px tall with 2px corners and a 1.5px
 * border; the small size is 24px.
 *
 * Buttons carry text only. The `icon` prop remains for compatibility with
 * older call sites, but no icon is rendered: the design keeps icons out of
 * buttons so the dense bars stay legible.
 */
import type { ButtonHTMLAttributes } from "react";

import type { IconName } from "../../lib/icons";

/** Button emphasis. */
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

/** Button size. `md` is the default 28px button. */
export type ButtonSize = "sm" | "md";

/** Props for {@link Button}. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Compatibility-only; accepted but never rendered. */
  icon?: IconName;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "border-[1.5px] border-line-strong bg-ink text-paper",
  secondary: "border-[1.5px] border-line-strong bg-paper text-ink",
  danger: "border-[1.5px] border-brick bg-paper text-brick",
  ghost: "text-ink hover:bg-sunken",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "h-7 px-2.5 text-[13px]",
  sm: "h-6 px-2 text-xs",
};

/** Standard guildloom button. Defaults to `type="button"`. */
export function Button({
  variant = "secondary",
  size = "md",
  icon: _icon,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    "inline-flex items-center justify-center rounded-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    SIZE_CLASSES[size],
    VARIANT_CLASSES[variant],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}

export default Button;
