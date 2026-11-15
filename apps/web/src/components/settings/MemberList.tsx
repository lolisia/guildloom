/**
 * Guild member list with adventurer avatars, Korean role labels and levels.
 *
 * Sprites stay square per DESIGN.md. Role and level use the pack icons and the
 * pixel font; the role label remains plain Korean text for assistive tech and
 * for the settings tests.
 */
import { levelProgress } from "@guildloom/shared";
import type { ProjectMember } from "@guildloom/shared";

import { ko } from "../../i18n/ko";
import AdventurerSprite from "../AdventurerSprite";
import Icon from "../Icon";
import { Panel } from "../ui";

export interface MemberListProps {
  members: ProjectMember[];
}

/** Renders every guild member from `GET /api/projects/:pid`. */
export function MemberList({ members }: MemberListProps) {
  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">
          {ko.settings.members}
        </h2>
        <span className="text-xs text-muted">
          {ko.settings.memberCount(members.length)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {ko.settings.membersDescription}
      </p>

      <ul aria-label={ko.settings.members} className="mt-4 space-y-2">
        {members.map((member) => {
          const progress = levelProgress(member.xp);
          return (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-3 rounded-sm border border-line bg-paper px-3 py-2"
            >
              <AdventurerSprite
                userId={member.userId}
                displayName={member.displayName}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-ink">
                    {member.displayName}
                  </span>
                  <span
                    data-role={member.role}
                    className="inline-flex items-center gap-1 text-xs text-muted"
                  >
                    <Icon
                      name={member.role === "owner" ? "boss" : "adventurer"}
                      size={32}
                    />
                    {member.role === "owner"
                      ? ko.settings.roleOwner
                      : ko.settings.roleMember}
                  </span>
                </div>
                <p className="mt-0.5 font-pixel text-[12px] text-muted">
                  {ko.tabs.xp(progress.current, progress.next)}
                </p>
              </div>
              <span className="font-pixel text-[12px] font-bold text-gold">
                {ko.tabs.level(member.level)}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export default MemberList;
