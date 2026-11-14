/**
 * Renders one icon from the `jrpg-v1` pixel pack.
 *
 * Icons are plain PNGs at 32px and 64px (the pack's integer scales), so the
 * component never scales them: callers pick one of the two sizes and the image
 * is rendered at that exact size with `image-rendering: pixelated`. `srcSet`
 * lets a 2x display pick the 64px file while the layout box stays 32px.
 *
 * Icons are decorative by default (`alt=""` + `aria-hidden`). Pass `label` only
 * when the icon carries meaning on its own; otherwise put the accessible name
 * on the surrounding control.
 */
import type { IconName } from "../lib/icons";

/** The two native icon sizes in the pack. */
export type IconSize = 32 | 64;

/** Props for {@link Icon}. */
export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** Accessible name. Without it the icon is hidden from assistive tech. */
  label?: string;
  className?: string;
}

/**
 * Path prefix for the pack.
 *
 * `BASE_URL` ends with a slash in Vite's defaults; deploy under a sub-path
 * (`/guildloom/`) and the icons follow. Normalising the trailing slash keeps a
 * single separator no matter how the base is configured.
 */
function iconBaseUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/+$/, "")}/assets/icons/jrpg-v1/`;
}

/** Build the `src` and `srcSet` for one icon id and size. */
export function iconSources(
  name: IconName,
  size: IconSize,
): { src: string; srcSet: string } {
  const prefix = iconBaseUrl();
  const src32 = `${prefix}32/${name}.png`;
  const src64 = `${prefix}64/${name}.png`;

  if (size === 64) {
    return { src: src64, srcSet: `${src64} 1x` };
  }

  return { src: src32, srcSet: `${src32} 1x, ${src64} 2x` };
}

/** One pixel-pack icon. */
export function Icon({ name, size = 32, label, className }: IconProps) {
  const { src, srcSet } = iconSources(name, size);
  const decorative = label === undefined;
  const classes = className
    ? `inline-block shrink-0 ${className}`
    : "inline-block shrink-0";

  return (
    <img
      src={src}
      srcSet={srcSet}
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={decorative ? true : undefined}
      draggable={false}
      className={classes}
      style={{ imageRendering: "pixelated" }}
    />
  );
}

export default Icon;
