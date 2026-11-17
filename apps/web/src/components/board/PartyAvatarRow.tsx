/**
 * Active party strip for a board card.
 *
 * Members are drawn as a dense, overlapped stack of 24px
 * {@link AdventurerSprite} avatars so the card keeps its three-row height. Each
 * sprite sits inside a status-coloured 1.5px ring: `joined` = line,
 * `fighting` = teal and `done` = gold (DESIGN.md's information/clear palette).
 * The ring hugs the sprite's own ink outline, so the avatar keeps the square
 * 24px shape from DESIGN.md.
 *
 * Only the first `max` members are drawn; the rest collapse into a `+N`
 * counter. The API returns the leader first and that order is preserved, so
 * the first member carries the leader title instead of a visible 파티장 label.
 * Every member also carries a screen-reader-only status label (with the leader
 * marker) so the state never depends on colour alone.
 *
 * `retreated` members never appear on a card summary (the server sends only
 * the active party), but the status map is total over `PartySummary` anyway.
 */
import type { MemberStatus, PartySummary } from "@guildloom/shared";

import { ko } from "../../i18n/ko";
import AdventurerSprite from "../AdventurerSprite";

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
  /** Maximum avatars drawn in the stack; defaults to 3. */
  max?: number;
}

/** Party avatars with leader and status treatment; nothing when empty. */
export function PartyAvatarRow({ party, max = 3 }: PartyAvatarRowProps) {
  if (party.length === 0) {
    return null;
  }

  const limit = Number.isFinite(max) ? Math.max(0, Math.trunc(max)) : 0;
  const visible = party.slice(0, limit);
  const hidden = party.length - visible.length;

  return (
    <ul aria-label={ko.quest.party} className="flex items-center -space-x-1">
      {visible.map((member) => {
        const isLeader = member.role === "leader";

        return (
          <li
            key={member.userId}
            data-party-user-id={member.userId}
            data-party-role={member.role}
            title={
              isLeader
                ? `${member.displayName} · ${ko.quest.partyLeader}`
                : undefined
            }
          >
            <span
              data-party-status={member.status}
              className={`inline-flex items-center justify-center rounded-sm border-[1.5px] ${STATUS_BORDER[member.status]}`}
            >
              <AdventurerSprite
                userId={member.userId}
                displayName={member.displayName}
                size="sm"
              />
            </span>
            <span className="sr-only">
              {ko.quest.memberStatuses[member.status]}
              {isLeader ? ` ${ko.quest.partyLeader}` : ""}
            </span>
          </li>
        );
      })}
      {hidden > 0 ? (
        // The stack's -space-x-1 margin eats 4px; `pl-1` gives it back so the
        // counter starts at the last avatar's edge.
        <li className="pl-1 text-[12px] text-muted">{`+${hidden}`}</li>
      ) : null}
    </ul>
  );
}

export default PartyAvatarRow;
