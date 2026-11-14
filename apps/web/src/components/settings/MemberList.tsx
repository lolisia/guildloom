/**
 * Guild member list with adventurer avatars, Korean role labels and levels.
 */
import { levelProgress } from "@guildloom/shared";
import type { ProjectMember } from "@guildloom/shared";

import { ko } from "../../i18n/ko";
import AdventurerSprite from "../AdventurerSprite";

export interface MemberListProps {
  members: ProjectMember[];
}

/** Renders every guild member from `GET /api/projects/:pid`. */
export function MemberList({ members }: MemberListProps) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-slate-200">
          {ko.settings.members}
        </h2>
        <span className="text-xs text-slate-400">
          {ko.settings.memberCount(members.length)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {ko.settings.membersDescription}
      </p>

      <ul aria-label={ko.settings.members} className="mt-4 space-y-2">
        {members.map((member) => {
          const progress = levelProgress(member.xp);
          return (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
            >
              <AdventurerSprite
                userId={member.userId}
                displayName={member.displayName}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="truncate text-sm font-semibold text-slate-100">
                    {member.displayName}
                  </span>
                  <span
                    data-role={member.role}
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      member.role === "owner"
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {member.role === "owner"
                      ? ko.settings.roleOwner
                      : ko.settings.roleMember}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {ko.tabs.xp(progress.current, progress.next)}
                </p>
              </div>
              <span className="text-xs font-bold text-amber-300">
                {ko.tabs.level(member.level)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default MemberList;
