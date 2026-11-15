/**
 * Centered LEVEL UP! celebration.
 *
 * The modal reads the current transition from `useLevelUpStore` and closes
 * after three seconds or on any click. Six CSS-only star particles drift out
 * from the card; `prefers-reduced-motion` turns every animation off in
 * `index.css`, leaving the static card. Colours stay on DESIGN.md tokens —
 * gold is reserved for the level/reward copy and `gold-fill` for the stars.
 */
import type { CSSProperties } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { ko } from "../i18n/ko";
import { useLevelUpStore } from "../lib/levelUp";
import Icon from "./Icon";

/** How long the celebration stays on screen. */
export const LEVEL_UP_DURATION_MS = 3_000;

interface Star {
  left: string;
  top: string;
  size: number;
  x: string;
  y: string;
  delay: number;
}

/** Particle origins and drift vectors (CSS variables feed the keyframes). */
const STARS: Star[] = [
  { left: "10%", top: "28%", size: 10, x: "-34px", y: "-30px", delay: 0 },
  { left: "26%", top: "12%", size: 8, x: "-10px", y: "-46px", delay: 60 },
  { left: "74%", top: "14%", size: 9, x: "16px", y: "-44px", delay: 30 },
  { left: "88%", top: "32%", size: 11, x: "36px", y: "-22px", delay: 90 },
  { left: "20%", top: "72%", size: 9, x: "-30px", y: "32px", delay: 120 },
  { left: "80%", top: "74%", size: 10, x: "30px", y: "30px", delay: 150 },
];

type StarStyle = CSSProperties & {
  "--star-x": string;
  "--star-y": string;
};

/** Star-shaped particle drawn entirely with CSS (no icon font, no emoji). */
function StarParticle({ star }: { star: Star }) {
  const style: StarStyle = {
    left: star.left,
    top: star.top,
    width: star.size,
    height: star.size,
    animationDelay: `${star.delay}ms`,
    "--star-x": star.x,
    "--star-y": star.y,
  };

  return (
    <span
      aria-hidden="true"
      data-testid="level-up-star"
      className="level-up-star pointer-events-none absolute bg-gold-fill"
      style={style}
    />
  );
}

/** Level-up celebration modal, mounted once from `AppLayout`. */
export function LevelUpModal() {
  const current = useLevelUpStore((state) => state.current);
  const dismiss = useLevelUpStore((state) => state.dismiss);

  useEffect(() => {
    if (!current) {
      return;
    }

    const timer = window.setTimeout(dismiss, LEVEL_UP_DURATION_MS);
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        dismiss();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [current, dismiss]);

  if (!current) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-4"
      onClick={dismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ko.levelUp.title}
        data-testid="level-up-modal"
        className="level-up-pop relative w-full max-w-sm rounded-sm border-[1.5px] border-line-strong bg-paper px-6 py-8 text-center shadow-hard"
      >
        {STARS.map((star, index) => (
          <StarParticle key={index} star={star} />
        ))}

        <Icon name="level-up" size={64} className="mx-auto" />
        <p className="mt-3 font-pixel text-[22px] leading-tight text-gold">
          {ko.levelUp.title}
        </p>
        <p className="mt-1 font-pixel text-[16px] text-ink">
          {ko.levelUp.level(current.from, current.to)}
        </p>
        <p className="mt-2 text-xs text-muted">{ko.levelUp.hint}</p>
      </div>
    </div>,
    document.body,
  );
}

export default LevelUpModal;
