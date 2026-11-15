/**
 * The 88px dungeon view at the top of the quest drawer.
 *
 * The party's horizontal position is the quest's clear progress: the checked
 * checklist ratio parsed from `direction` when the checklist has items,
 * otherwise a per-stage fallback (board 0, dungeon 0.5, boss 0.9, cleared 1).
 * Active members are drawn as {@link AdventurerSprite}s on the dungeon lane
 * and animate according to their clear status (`fighting` attacks, `done`
 * celebrates, `joined` idles). A boss stage also pins the pack's boss icon and
 * its 보스 label to the right end of the lane.
 *
 * The outer container keeps the `quest-dungeon-placeholder` test id from M1 so
 * the board, ledger and drawer suites keep a stable handle on this panel.
 */
import {
  parseChecklist,
  type AdventurerState,
  type MemberStatus,
  type PartyMember,
  type Quest,
  type Stage,
} from "@guildloom/shared";

import { ko } from "../../i18n/ko";
import { STAGE_ICON } from "../../lib/icons";
import AdventurerSprite from "../AdventurerSprite";
import Icon from "../Icon";
import { STAGE_MARK_CLASSES } from "./stageMark";

/** Progress shown when the checklist has no items yet. */
export const STAGE_PROGRESS_FALLBACK: Record<Stage, number> = {
  rumor: 0,
  board: 0,
  dungeon: 0.5,
  boss: 0.9,
  cleared: 1,
  archived: 1,
};

/** Sprite animation state for each clear status. */
export const SPRITE_STATE_BY_MEMBER_STATUS: Record<
  MemberStatus,
  AdventurerState
> = {
  joined: "idle",
  fighting: "attack",
  done: "victory",
  retreated: "idle",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Checked-checklist ratio, or the stage fallback when it has no items. */
export function dungeonProgress(stage: Stage, direction: string): number {
  const { done, total } = parseChecklist(direction);
  if (total > 0) {
    return clamp(done / total, 0, 1);
  }
  return STAGE_PROGRESS_FALLBACK[stage];
}

/**
 * Horizontal positions (0–1) for the active party at `progress`.
 *
 * The group is centred on the progress marker and spread just enough that the
 * sprites do not stack, while staying inside the lane at both ends.
 */
export function dungeonPartyPositions(
  progress: number,
  count: number,
): number[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [clamp(progress, 0, 1)];
  }

  const min = 0.04;
  const max = 0.96;
  const width = Math.min(0.08 * (count - 1), max - min);
  const start = clamp(progress - width / 2, min, max - width);
  return Array.from(
    { length: count },
    (_unused, index) => start + (width * index) / (count - 1),
  );
}

/** Props for {@link DungeonView}. */
export interface DungeonViewProps {
  quest: Quest;
}

/** Sunken dungeon lane with the stage marker, progress and party sprites. */
export function DungeonView({ quest }: DungeonViewProps) {
  const progress = dungeonProgress(quest.stage, quest.direction);
  const { done, total } = parseChecklist(quest.direction);
  const activeMembers: PartyMember[] = quest.party.filter(
    (member) => member.status !== "retreated",
  );
  const positions = dungeonPartyPositions(progress, activeMembers.length);
  const progressText =
    total > 0
      ? ko.board.drawer.floorRatio(done, total)
      : ko.board.drawer.progressPercent(Math.round(progress * 100));

  return (
    <div
      data-testid="quest-dungeon-placeholder"
      data-dungeon-stage={quest.stage}
      data-dungeon-progress={progress}
      style={{ height: "88px" }}
      className="relative w-full shrink-0 overflow-hidden rounded-sm border-[1.5px] border-line-strong bg-sunken"
    >
      <div className="absolute left-2 top-0 flex items-center gap-2">
        <span className="flex flex-col items-center gap-1">
          <Icon name={STAGE_ICON[quest.stage]} size={64} />
          <span
            aria-hidden="true"
            data-stage-mark={quest.stage}
            className={`h-0.5 w-10 ${STAGE_MARK_CLASSES[quest.stage]}`}
          />
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-muted">
            {ko.board.drawer.dungeonView}
          </span>
          <span className="font-pixel text-[12px] text-ink">
            {progressText}
          </span>
        </span>
      </div>

      {quest.stage === "boss" ? (
        <div
          data-testid="dungeon-boss"
          data-dungeon-boss="true"
          className="absolute right-2 top-0 flex flex-col items-center gap-0.5"
        >
          <Icon name="boss" size={64} label={ko.board.drawer.boss} />
          <span className="text-xs font-medium text-brick">
            {ko.board.drawer.boss}
          </span>
        </div>
      ) : null}

      <div className="absolute inset-x-2 bottom-1 h-8">
        <div
          role="progressbar"
          aria-label={ko.board.drawer.dungeonProgress}
          aria-valuemin={0}
          aria-valuemax={total > 0 ? total : 100}
          aria-valuenow={total > 0 ? done : Math.round(progress * 100)}
          className="absolute inset-x-0 bottom-0 h-0.5 bg-line"
        >
          <span
            className="block h-full bg-teal"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {activeMembers.length > 0 ? (
          <ul aria-label={ko.quest.party} className="absolute inset-0">
            {activeMembers.map((member, index) => {
              const position = positions[index] ?? progress;
              const leftPercent = Math.round(position * 1000) / 10;
              const state = SPRITE_STATE_BY_MEMBER_STATUS[member.status];
              return (
                <li
                  key={member.user.id}
                  data-dungeon-member={member.user.id}
                  data-dungeon-state={state}
                  data-dungeon-progress={progress}
                  className="absolute bottom-1 -translate-x-1/2"
                  style={{ left: `${leftPercent}%` }}
                >
                  <AdventurerSprite
                    userId={member.user.id}
                    displayName={member.user.displayName}
                    state={state}
                    size="md"
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export default DungeonView;
