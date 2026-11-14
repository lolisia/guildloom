/**
 * Quest event contracts and human-readable (Korean) event rendering.
 *
 * The server stores raw event payloads as JSON; the web client turns them into
 * sentence segments so that actor, quest and stage references can be styled
 * independently.
 */
import { z } from "zod";

import { idSchema, stageSchema, userRefSchema } from "./api.js";
import type { Stage } from "./constants.js";

/** Every M1 quest event type. */
export const QUEST_EVENT_TYPES = [
  "quest_posted",
  "quest_edited",
  "quest_moved",
  "quest_archived",
] as const;

/** An M1 quest event type. */
export type QuestEventType = (typeof QUEST_EVENT_TYPES)[number];

/** Quest event type enum. */
export const questEventTypeSchema = z.enum(QUEST_EVENT_TYPES);

/** Fields of a quest that can be edited (canonical order). */
export const QUEST_EDITABLE_FIELDS = [
  "title",
  "situation",
  "direction",
  "tags",
  "rank",
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

/** `quest_moved` payload. */
export const questMovedPayloadSchema = z.object({
  from: stageSchema,
  to: stageSchema,
});
export type QuestMovedPayload = z.infer<typeof questMovedPayloadSchema>;

/** `quest_archived` payload. */
export const questArchivedPayloadSchema = z.object({
  reason: z.literal("dropped").optional(),
});
export type QuestArchivedPayload = z.infer<
  typeof questArchivedPayloadSchema
>;

/** A single quest event as returned by `GET /api/quests/:id/events`. */
export const questEventSchema = z.object({
  id: idSchema,
  questId: idSchema,
  projectId: idSchema,
  type: questEventTypeSchema,
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
      default:
        return [{ kind: "text", text: UNRENDERABLE_EVENT }];
    }
  });
}
