/**
 * A quest rank badge: the pack's rank insignia plus a screen-reader label.
 *
 * The image is decorative (`aria-hidden`) because the rank is announced by the
 * adjacent visually hidden text, which reads as "등급 B" / "등급 없음". The
 * wrapper keeps `data-rank` (`"B"`, or `"none"`) so styling and tests can key
 * off the rank without knowing the icon id.
 */
import type { Rank } from "@guildloom/shared";

import { ko } from "../i18n/ko";
import { RANK_ICON, RANK_ICON_FALLBACK, type IconName } from "../lib/icons";
import Icon from "./Icon";

/** Props for {@link RankBadge}. */
export interface RankBadgeProps {
  rank: Rank | null | undefined;
  size?: 32 | 64;
  className?: string;
}

/** Rank insignia with an accessible label. */
export function RankBadge({ rank, size = 32, className }: RankBadgeProps) {
  const icon: IconName = rank ? RANK_ICON[rank] : RANK_ICON_FALLBACK;
  const rankLabel = rank ? `${ko.quest.rank} ${rank}` : ko.quest.rankNone;
  const classes = className
    ? `inline-flex items-center ${className}`
    : "inline-flex items-center";

  return (
    <span data-rank={rank ?? "none"} className={classes}>
      <Icon name={icon} size={size} />
      <span className="sr-only">{rankLabel}</span>
    </span>
  );
}

export default RankBadge;
