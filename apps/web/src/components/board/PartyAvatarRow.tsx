/**
 * Active party strip for a board card.
 *
 * Each member is a 32px {@link AdventurerSprite} inside a status-coloured
 * 1.5px ring: `joined` = line, `fighting` = teal and `done` = gold (DESIGN.md's
 * information/clear palette). The ring sits around the sprite's own ink
 * outline, so the avatar keeps the square 24/32px shape from DESIGN.md.
 *
 * The leader is marked with the pack's `party` icon plus the visible 파티장
 * label, and every member carries a screen-reader-only status label so the
 * state never depends on colour alone.
 *
 * `retreated` members never appear on a card summary (the server sends only
 * the active party), but the status map is total over `PartySummary` anyway.
 */
import type { MemberStatus, PartySummary } from "@guildloom/shared";

import { ko } from "../../i18n/ko";
import AdventurerSprite from "../AdventurerSprite";
import Icon from "../Icon";

/** Ring colour per clear status. */
const STATUS_BORDER: Record<MemberStatus, string> = {
  joined: "border-line",
  fighting: "border-teal",
  done: "border-gold",
  retreated: "border-line",
};

/** Props for {@link PartyAvatarRow}. */
export interface PartyAvatarRowProps {
  /** Active party members, leader first (as returned by the API). */
  party: PartySummary[];
}

/** Party avatars with leader and status treatment; nothing when empty. */
export function PartyAvatarRow({ party }: PartyAvatarRowProps) {
  if (party.length === 0) {
    return null;
  }

  return (
    <ul
      aria-label={ko.quest.party}
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      {party.map((member) => (
        <li
          key={member.userId}
          data-party-user-id={member.userId}
          data-party-role={member.role}
          className="flex items-center gap-1"
        >
          <span
            data-party-status={member.status}
            className={`inline-flex items-center justify-center rounded-sm border-[1.5px] p-0.5 ${STATUS_BORDER[member.status]}`}
          >
            <AdventurerSprite
              userId={member.userId}
              displayName={member.displayName}
              size="sm"
            />
          </span>
          <span className="sr-only">
            {ko.quest.memberStatuses[member.status]}
          </span>
          {member.role === "leader" ? (
            <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-ink">
              <Icon name="party" size={32} />
              {ko.quest.partyLeader}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default PartyAvatarRow;
