/**
 * Quest event contracts and human-readable (Korean) event rendering.
 *
 * The server stores raw event payloads as JSON; the web client turns them into
 * sentence segments so that actor, quest and stage references can be styled
 * independently.
 */
import { z } from "zod";

import {
  bountySchema,
  idSchema,
  memberStatusSchema,
  stageSchema,
  userRefSchema,
} from "./api.js";
import type { MemberStatus, Stage } from "./constants.js";

/**
 * Every quest event type (M1 lifecycle, M2 party and boss, then F1 feedback).
 */
export const QUEST_EVENT_TYPES = [
  "quest_posted",
  "quest_edited",
  "quest_moved",
  "quest_archived",
  "nominated",
  "reinforcement_requested",
  "claimed",
  "passed",
  "relayed",
  "member_joined",
  "member_left",
  "member_status_changed",
  "leader_changed",
  "floor_added",
  "floor_checked",
  "boss_engaged",
  "retry_requested",
  "quest_cleared",
  "ref_added",
  "ref_removed",
  "clear_revoked",
] as const;

/** A quest event type. */
export type QuestEventType = (typeof QUEST_EVENT_TYPES)[number];

/** Quest event type enum. */
export const questEventTypeSchema = z.enum(QUEST_EVENT_TYPES);

/**
 * The event type schema used by responses.
 *
 * Runtime validation is the full enum above. The inferred TypeScript type is
 * deliberately widened to `string` so consumers that keep a
 * `Record<QuestEvent["type"], ...>` (the current board timeline) stay
 * assignable until the F1 web task adds icons for the new event types.
 */
const questEventResponseTypeSchema = questEventTypeSchema as unknown as z.ZodType<
  string
>;

/**
 * Event types that notify the guild as a whole (보드 알림). Reference and
 * checklist edits stay in the quest log instead.
 */
export const KEY_EVENT_TYPES = [
  "quest_posted",
  "member_joined",
  "member_left",
  "boss_engaged",
  "retry_requested",
  "quest_cleared",
  "clear_revoked",
] as const;

/** A quest event type that produces a guild-wide notification. */
export type KeyEventType = (typeof KEY_EVENT_TYPES)[number];

const KEY_EVENT_TYPE_SET: ReadonlySet<string> = new Set(KEY_EVENT_TYPES);

/** Whether `type` is one of {@link KEY_EVENT_TYPES}. */
export function isKeyEvent(type: string): type is KeyEventType {
  return KEY_EVENT_TYPE_SET.has(type);
}

/** Fields of a quest that can be edited (canonical order). */
export const QUEST_EDITABLE_FIELDS = [
  "title",
  "situation",
  "direction",
  "tags",
  "rank",
  "kind",
] as const;

/** A quest field name that may appear in a `quest_edited` payload. */
export type QuestEditableField = (typeof QUEST_EDITABLE_FIELDS)[number];

/** Quest editable field enum. */
export const questEditableFieldSchema = z.enum(QUEST_EDITABLE_FIELDS);

/** `quest_posted` payload. */
export const questPostedPayloadSchema = z.object({
  number: z.number().int(),
  title: z.string(),
});
export type QuestPostedPayload = z.infer<typeof questPostedPayloadSchema>;

/** `quest_edited` payload: only the fields that actually changed. */
export const questEditedPayloadSchema = z.object({
  fields: z.array(questEditableFieldSchema),
});
export type QuestEditedPayload = z.infer<typeof questEditedPayloadSchema>;

/** `quest_moved` payload. `auto` marks a stage change computed by the server. */
export const questMovedPayloadSchema = z.object({
  from: stageSchema,
  to: stageSchema,
  auto: z.boolean().optional(),
});
export type QuestMovedPayload = z.infer<typeof questMovedPayloadSchema>;

/** `quest_archived` payload. */
export const questArchivedPayloadSchema = z.object({
  reason: z.literal("dropped").optional(),
});
export type QuestArchivedPayload = z.infer<
  typeof questArchivedPayloadSchema
>;

/** `nominated` payload: the nominees' ids and display names. */
export const nominatedPayloadSchema = z.object({
  userIds: z.array(idSchema),
  names: z.array(z.string()),
});
export type NominatedPayload = z.infer<typeof nominatedPayloadSchema>;

/** `reinforcement_requested` payload (same shape as `nominated`). */
export const reinforcementRequestedPayloadSchema = nominatedPayloadSchema;
export type ReinforcementRequestedPayload = NominatedPayload;

/** `claimed` payload (the actor accepted a nomination). */
export const claimedPayloadSchema = z.object({});
export type ClaimedPayload = z.infer<typeof claimedPayloadSchema>;

/** `passed` payload: an optional reason for passing (패스). */
export const passedPayloadSchema = z.object({
  reason: z.string().nullish(),
});
export type PassedPayload = z.infer<typeof passedPayloadSchema>;

/** `relayed` payload: who received the toss and why it was passed on. */
export const relayedPayloadSchema = z.object({
  toUserId: idSchema,
  toName: z.string(),
  reason: z.string().nullish(),
});
export type RelayedPayload = z.infer<typeof relayedPayloadSchema>;

/** `member_joined` payload. */
export const memberJoinedPayloadSchema = z.object({});
export type MemberJoinedPayload = z.infer<typeof memberJoinedPayloadSchema>;

/** `member_left` payload: an optional retreat reason (후퇴). */
export const memberLeftPayloadSchema = z.object({
  reason: z.string().nullish(),
});
export type MemberLeftPayload = z.infer<typeof memberLeftPayloadSchema>;

/** `member_status_changed` payload. */
export const memberStatusChangedPayloadSchema = z.object({
  from: memberStatusSchema,
  to: memberStatusSchema,
});
export type MemberStatusChangedPayload = z.infer<
  typeof memberStatusChangedPayloadSchema
>;

/** `leader_changed` payload. */
export const leaderChangedPayloadSchema = z.object({
  userId: idSchema,
  name: z.string(),
});
export type LeaderChangedPayload = z.infer<typeof leaderChangedPayloadSchema>;

/** `floor_added` payload. */
export const floorAddedPayloadSchema = z.object({
  floorId: idSchema,
  title: z.string(),
});
export type FloorAddedPayload = z.infer<typeof floorAddedPayloadSchema>;

/**
 * `floor_checked` payload (`done: false` reopens the item).
 *
 * The type name is historical: F1 checklists reuse it, so the payload carries
 * the checklist item text instead of a floor id/title.
 */
export const floorCheckedPayloadSchema = z.object({
  text: z.string(),
  done: z.boolean(),
});
export type FloorCheckedPayload = z.infer<typeof floorCheckedPayloadSchema>;

/** `ref_added` payload (참고 문서 추가). */
export const refAddedPayloadSchema = z.object({
  refId: idSchema,
  target: z.string(),
  label: z.string().nullable(),
});
export type RefAddedPayload = z.infer<typeof refAddedPayloadSchema>;

/** `ref_removed` payload (참고 문서 삭제). */
export const refRemovedPayloadSchema = z.object({
  target: z.string(),
  label: z.string().nullable(),
});
export type RefRemovedPayload = z.infer<typeof refRemovedPayloadSchema>;

/** `clear_revoked` payload: the XP taken back from every reward. */
export const clearRevokedPayloadSchema = z.object({
  xpRevoked: z.number().int(),
});
export type ClearRevokedPayload = z.infer<typeof clearRevokedPayloadSchema>;

/** `boss_engaged` payload. */
export const bossEngagedPayloadSchema = z.object({});
export type BossEngagedPayload = z.infer<typeof bossEngagedPayloadSchema>;

/** `retry_requested` payload: the reviewer's comment. */
export const retryRequestedPayloadSchema = z.object({
  comment: z.string(),
});
export type RetryRequestedPayload = z.infer<
  typeof retryRequestedPayloadSchema
>;

/** `quest_cleared` payload: per-member rewards and the frozen bounty. */
export const questClearedPayloadSchema = z.object({
  rewards: z.array(
    z.object({
      userId: idSchema,
      name: z.string(),
      amount: z.number().int(),
    }),
  ),
  bounty: bountySchema,
});
export type QuestClearedPayload = z.infer<typeof questClearedPayloadSchema>;

/** A single quest event as returned by `GET /api/quests/:id/events`. */
export const questEventSchema = z.object({
  id: idSchema,
  questId: idSchema,
  projectId: idSchema,
  type: questEventResponseTypeSchema,
  payload: z.unknown(),
  actor: userRefSchema.nullable(),
  familiarId: z.number().int().nullable(),
  createdAt: z.number().int(),
});
export type QuestEvent = z.infer<typeof questEventSchema>;

/** `GET /api/quests/:id/events` response. */
export const questEventsResponseSchema = z.array(questEventSchema);
export type QuestEventsResponse = z.infer<typeof questEventsResponseSchema>;

/** Korean labels for every quest stage. */
export const EVENT_STAGE_LABELS = {
  rumor: "소문",
  board: "게시판",
  dungeon: "던전 진행",
  boss: "보스전",
  cleared: "클리어",
  archived: "아카이브",
} as const satisfies Record<Stage, string>;

/** Korean labels for every party member clear status. */
export const MEMBER_STATUS_LABELS = {
  joined: "합류",
  fighting: "전투중",
  done: "전투 완료",
  retreated: "후퇴",
} as const satisfies Record<MemberStatus, string>;

/** Kinds of segments produced by {@link renderEvent}. */
export type SegmentKind = "actor" | "text" | "quest" | "stage";

/** A piece of a rendered event sentence. */
export interface Segment {
  kind: SegmentKind;
  text: string;
}

/** Familiar information the renderer may look up for actor notation. */
export interface FamiliarInfo {
  name?: string;
  seq?: number;
}

/** Rendering context, used to expand familiar ids into names/sequence numbers. */
export interface EventRenderContext {
  familiar?: (familiarId: number) => FamiliarInfo | undefined;
}

const EDIT_FIELD_LABELS: Record<QuestEditableField, string> = {
  title: "제목",
  situation: "현재 상황",
  direction: "수정 방향",
  tags: "태그",
  rank: "등급",
  kind: "종류",
};

const UNKNOWN_ACTOR = "알 수 없는 모험가";
const UNRENDERABLE_EVENT = "이벤트를 표시할 수 없습니다.";

function renderActor(
  event: QuestEvent,
  ctx: EventRenderContext | undefined,
): Segment {
  if (!event.actor) {
    return { kind: "actor", text: `'${UNKNOWN_ACTOR}'` };
  }

  const actor = `'${event.actor.displayName}'`;
  if (event.familiarId === null) {
    return { kind: "actor", text: actor };
  }

  const familiar = ctx?.familiar?.(event.familiarId);
  let familiarLabel: string;
  if (familiar?.name) {
    familiarLabel = familiar.name;
  } else if (familiar?.seq !== undefined) {
    familiarLabel = `#${familiar.seq}`;
  } else {
    familiarLabel = `#${event.familiarId}`;
  }

  return {
    kind: "actor",
    text: `${actor} 의 소환수 '${familiarLabel}'`,
  };
}

function withSafeFallback(render: () => Segment[]): Segment[] {
  try {
    return render();
  } catch {
    return [{ kind: "text", text: UNRENDERABLE_EVENT }];
  }
}

/**
 * Render a quest event into typed segments whose concatenated text is the
 * Korean sentence shown in the UI.
 *
 * Malformed payloads (or unknown event types at runtime) produce a single
 * safe text segment instead of throwing.
 */
export function renderEvent(
  event: QuestEvent,
  ctx?: EventRenderContext,
): Segment[] {
  return withSafeFallback(() => {
    switch (event.type) {
      case "quest_posted": {
        const payload = questPostedPayloadSchema.parse(event.payload);
        return [
          renderActor(event, ctx),
          { kind: "text", text: ` 가 의뢰 #${payload.number} ` },
          { kind: "quest", text: `'${payload.title}'` },
          { kind: "text", text: " 를 " },
          { kind: "stage", text: EVENT_STAGE_LABELS.board },
          { kind: "text", text: "에 붙였습니다." },
        ];
      }
      case "quest_moved": {
        const payload = questMovedPayloadSchema.parse(event.payload);
        if (payload.auto === true) {
          return [
            { kind: "text", text: "의뢰가 " },
            { kind: "stage", text: `'${EVENT_STAGE_LABELS[payload.to]}'` },
            { kind: "text", text: " 으로 이동했습니다." },
          ];
        }
        return [
          renderActor(event, ctx),
          { kind: "text", text: " 가 의뢰를 " },
          { kind: "stage", text: `'${EVENT_STAGE_LABELS[payload.to]}'` },
          { kind: "text", text: " 으로 옮겼습니다." },
        ];
      }
      case "quest_edited": {
        const payload = questEditedPayloadSchema.parse(event.payload);
        const labels = payload.fields.map(
          (field) => EDIT_FIELD_LABELS[field],
        );
        return [
          renderActor(event, ctx),
          {
            kind: "text",
            text: ` 가 의뢰 내용을 고쳤습니다 (${labels.join(", ")}).`,
          },
        ];
      }
      case "quest_archived": {
        questArchivedPayloadSchema.parse(event.payload);
        return [
          renderActor(event, ctx),
          { kind: "text", text: " 가 의뢰를 내렸습니다." },
        ];
      }
      case "nominated": {
        const payload = nominatedPayloadSchema.parse(event.payload);
        const names = payload.names.map((name) => `'${name}'`).join(", ");
        return [
          renderActor(event, ctx),
          { kind: "text", text: ` 가 ${names} 를 지목했습니다.` },
        ];
      }
      case "reinforcement_requested": {
        const payload = reinforcementRequestedPayloadSchema.parse(
          event.payload,
        );
        const names = payload.names.map((name) => `'${name}'`).join(", ");
        return [
          renderActor(event, ctx),
          { kind: "text", text: ` 가 ${names} 에게 증원을 요청했습니다.` },
        ];
      }
      case "claimed": {
        claimedPayloadSchema.parse(event.payload);
        return [
          renderActor(event, ctx),
          { kind: "text", text: " 가 의뢰를 수락하고 파티에 합류했습니다." },
        ];
      }
      case "passed": {
        const payload = passedPayloadSchema.parse(event.payload);
        const reason = payload.reason?.trim() || null;
        return [
          renderActor(event, ctx),
          {
            kind: "text",
            text: ` 가 지목을 넘겼습니다${reason === null ? "" : `: ${reason}`}`,
          },
        ];
      }
      case "relayed": {
        const payload = relayedPayloadSchema.parse(event.payload);
        return [
          renderActor(event, ctx),
          {
            kind: "text",
            text: ` 가 '${payload.toName}' 에게 의뢰를 토스했습니다.`,
          },
        ];
      }
      case "member_joined": {
        memberJoinedPayloadSchema.parse(event.payload);
        return [
          renderActor(event, ctx),
          { kind: "text", text: " 가 파티에 참여했습니다." },
        ];
      }
      case "member_left": {
        const payload = memberLeftPayloadSchema.parse(event.payload);
        const reason = payload.reason?.trim() || null;
        return [
          renderActor(event, ctx),
          {
            kind: "text",
            text: ` 가 파티에서 나갔습니다${reason === null ? "" : `: ${reason}`}`,
          },
        ];
      }
      case "member_status_changed": {
        const payload = memberStatusChangedPayloadSchema.parse(event.payload);
        return [
          renderActor(event, ctx),
          {
            kind: "text",
            text: ` 가 공략 상태를 '${MEMBER_STATUS_LABELS[payload.to]}' 으로 변경했습니다.`,
          },
        ];
      }
      case "leader_changed": {
        const payload = leaderChangedPayloadSchema.parse(event.payload);
        // The actor of a leader change is whoever triggered the succession
        // (e.g. the departing leader), so name the new leader from the payload.
        return [
          { kind: "actor", text: `'${payload.name}'` },
          { kind: "text", text: " 가 새 파티장이 되었습니다." },
        ];
      }
      case "floor_added": {
        const payload = floorAddedPayloadSchema.parse(event.payload);
        return [
          renderActor(event, ctx),
          { kind: "text", text: ` 가 '${payload.title}' 을 추가했습니다.` },
        ];
      }
      case "floor_checked": {
        const payload = floorCheckedPayloadSchema.parse(event.payload);
        const verb = payload.done ? "돌파했습니다." : "다시 열었습니다.";
        return [
          renderActor(event, ctx),
          { kind: "text", text: ` 가 '${payload.text}' 을 ${verb}` },
        ];
      }
      case "ref_added": {
        const payload = refAddedPayloadSchema.parse(event.payload);
        const label = payload.label ?? payload.target;
        return [
          renderActor(event, ctx),
          {
            kind: "text",
            text: ` 가 참고 문서 '${label}' 를 추가했습니다.`,
          },
        ];
      }
      case "ref_removed": {
        const payload = refRemovedPayloadSchema.parse(event.payload);
        const label = payload.label ?? payload.target;
        return [
          renderActor(event, ctx),
          {
            kind: "text",
            text: ` 가 참고 문서 '${label}' 를 삭제했습니다.`,
          },
        ];
      }
      case "boss_engaged": {
        bossEngagedPayloadSchema.parse(event.payload);
        return [
          {
            kind: "text",
            text: "파티원 모두 전투를 마쳤습니다. 보스전이 시작됩니다!",
          },
        ];
      }
      case "retry_requested": {
        const payload = retryRequestedPayloadSchema.parse(event.payload);
        return [
          renderActor(event, ctx),
          { kind: "text", text: ` 가 재도전을 요청했습니다: ${payload.comment}` },
        ];
      }
      case "quest_cleared": {
        const payload = questClearedPayloadSchema.parse(event.payload);
        const rewards = payload.rewards
          .map((reward) => `${reward.name} +${reward.amount}`)
          .join(", ");
        // An empty party still clears; only show the parenthetical when there
        // is at least one member reward to list.
        const suffix = rewards.length > 0 ? ` (${rewards})` : "";
        return [
          renderActor(event, ctx),
          {
            kind: "text",
            text: ` 가 던전 클리어를 선언했습니다!${suffix}`,
          },
        ];
      }
      case "clear_revoked": {
        const payload = clearRevokedPayloadSchema.parse(event.payload);
        return [
          renderActor(event, ctx),
          {
            kind: "text",
            text: ` 가 던전 클리어를 취소했습니다. (XP ${payload.xpRevoked} 회수)`,
          },
        ];
      }
      default:
        return [{ kind: "text", text: UNRENDERABLE_EVENT }];
    }
  });
}
