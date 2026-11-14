/**
 * The one button in the design system.
 *
 * Variants follow DESIGN.md: `primary` is the ink button (the only primary
 * action colour), `secondary` is a bordered paper button, `danger` marks
 * destructive actions in brick, and `ghost` is a borderless button for dense
 * toolbars. Buttons are 32px tall with 2px corners and a 1.5px border.
 *
 * Icons sit on the left at their native 32px size with a 6px gap; the small
 * size omits the icon.
 */
import type { ButtonHTMLAttributes } from "react";

import type { IconName } from "../../lib/icons";
import Icon from "../Icon";

/** Button emphasis. */
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

/** Button size. `md` is the default 32px button. */
export type ButtonSize = "sm" | "md";

/** Props for {@link Button}. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "border-[1.5px] border-line-strong bg-ink text-paper",
  secondary: "border-[1.5px] border-line-strong bg-paper text-ink",
  danger: "border-[1.5px] border-brick bg-paper text-brick",
  ghost: "text-ink hover:bg-sunken",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "h-8 gap-1.5 px-3 text-sm",
  sm: "h-6 gap-1.5 px-2 text-xs",
};

/** Standard guildloom button. Defaults to `type="button"`. */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
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
      {icon && size === "md" ? <Icon name={icon} size={32} /> : null}
      {children}
    </button>
  );
}

export default Button;
