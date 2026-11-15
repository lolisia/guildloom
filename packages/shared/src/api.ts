/**
 * Zod contracts for the guildloom HTTP API.
 *
 * Every request body and response body used by `apps/server` and `apps/web`
 * lives here, together with the inferred TypeScript types (named without the
 * `Schema` suffix).
 */
import { z } from "zod";

import {
  ACTIVE_MEMBER_STATUSES,
  MEMBER_STATUSES,
  NOMINATION_KINDS,
  NOMINATION_STATES,
  NOTIFICATION_TYPES,
  PARTY_ROLES,
  QUEST_KINDS,
  RANKS,
  STAGES,
  type NotificationType,
} from "./constants.js";

/** Numeric primary key (SQLite autoincrement). */
export const idSchema = z.number().int();

/** Timestamp in epoch milliseconds. */
export const timestampSchema = z.number().int();

/** Quest stage enum. */
export const stageSchema = z.enum(STAGES);

/** Quest rank enum. */
export const rankSchema = z.enum(RANKS);

/** Quest kind enum (`fix` or `feature`). */
export const questKindSchema = z.enum(QUEST_KINDS);

/** `{ id, displayName }` reference used for creators and actors. */
export const userRefSchema = z.object({
  id: idSchema,
  displayName: z.string(),
});
export type UserRef = z.infer<typeof userRefSchema>;

/** How a reference target is opened: a URL in the browser or a local path. */
export const refKindSchema = z.enum(["url", "path"]);
export type RefKind = z.infer<typeof refKindSchema>;

/**
 * Classify a reference target as a URL (`http://` or `https://`, case
 * insensitive) or a local filesystem path.
 */
export function refKind(target: string): RefKind {
  return /^https?:\/\//i.test(target.trim()) ? "url" : "path";
}

/** A reference document (참고 문서) attached to a quest. */
export const questRefSchema = z.object({
  id: idSchema,
  label: z.string().nullable(),
  target: z.string(),
  kind: refKindSchema,
  createdBy: userRefSchema,
  createdAt: timestampSchema,
});
export type QuestRef = z.infer<typeof questRefSchema>;

/** Login id: 3-32 lowercase letters, digits, dots, underscores or hyphens. */
export const loginIdSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9._-]+$/);

/** Password: at least 8 characters. */
export const passwordSchema = z.string().min(8);

/** Display name: trimmed, 1-20 characters. */
export const displayNameSchema = z.string().trim().min(1).max(20);

/** Guild (project) name: trimmed, 1-40 characters. */
export const guildNameSchema = z.string().trim().min(1).max(40);

/** Standard error body: `{ error: { code, message } }`. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/** Membership role within a project. */
export const projectRoleSchema = z.enum(["owner", "member"]);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

/** Authenticated user profile. */
export const userProfileSchema = z.object({
  id: idSchema,
  loginId: z.string(),
  displayName: z.string(),
  xp: z.number().int(),
  level: z.number().int(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/** A project (guild). */
export const projectSchema = z.object({
  id: idSchema,
  name: z.string(),
  createdAt: timestampSchema,
});
export type Project = z.infer<typeof projectSchema>;

/** A project as listed for the current user. */
export const projectSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  role: projectRoleSchema,
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

/** `GET /api/projects` response. */
export const projectListResponseSchema = z.array(projectSummarySchema);
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

/** `POST /api/projects` request. */
export const createProjectRequestSchema = z.object({
  name: guildNameSchema,
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/** `PATCH /api/projects/:pid` request. */
export const updateProjectRequestSchema = z.object({
  name: guildNameSchema,
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

/** A project member with their adventurer stats. */
export const projectMemberSchema = z.object({
  userId: idSchema,
  displayName: z.string(),
  role: projectRoleSchema,
  xp: z.number().int(),
  level: z.number().int(),
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

/** `GET /api/projects/:pid` response. */
export const projectDetailResponseSchema = z.object({
  project: projectSchema,
  members: z.array(projectMemberSchema),
});
export type ProjectDetailResponse = z.infer<
  typeof projectDetailResponseSchema
>;

/** `GET /api/setup/status` response. */
export const setupStatusResponseSchema = z.object({
  needsSetup: z.boolean(),
});
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;

/** `POST /api/setup` request (first-run guild creation). */
export const setupRequestSchema = z.object({
  guildName: guildNameSchema,
  displayName: displayNameSchema,
  loginId: loginIdSchema,
  password: passwordSchema,
});
export type SetupRequest = z.infer<typeof setupRequestSchema>;

/** `POST /api/setup` response. */
export const setupResponseSchema = z.object({
  user: userProfileSchema,
  project: projectSchema,
});
export type SetupResponse = z.infer<typeof setupResponseSchema>;

/** `POST /api/auth/login` request. */
export const loginRequestSchema = z.object({
  loginId: loginIdSchema,
  password: passwordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** `POST /api/auth/login` response. */
export const loginResponseSchema = z.object({
  user: userProfileSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** `GET /api/auth/me` response. */
export const meResponseSchema = z.object({
  user: userProfileSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** A project invite link. */
export const inviteSchema = z.object({
  id: idSchema,
  code: z.string(),
  url: z.string(),
  createdBy: userRefSchema,
  createdAt: timestampSchema,
  revokedAt: timestampSchema.nullable(),
});
export type Invite = z.infer<typeof inviteSchema>;

/** `GET /api/projects/:pid/invites` response. */
export const inviteListResponseSchema = z.array(inviteSchema);
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>;

/** `POST /api/projects/:pid/invites` response. */
export const createInviteResponseSchema = z.object({
  code: z.string(),
  url: z.string(),
});
export type CreateInviteResponse = z.infer<
  typeof createInviteResponseSchema
>;

/** `GET /api/invites/:code` response. */
export const inviteInfoResponseSchema = z.object({
  projectName: z.string(),
  valid: z.boolean(),
});
export type InviteInfoResponse = z.infer<typeof inviteInfoResponseSchema>;

/** `POST /api/invites/:code/signup` request. */
export const inviteSignupRequestSchema = z.object({
  displayName: displayNameSchema,
  loginId: loginIdSchema,
  password: passwordSchema,
});
export type InviteSignupRequest = z.infer<
  typeof inviteSignupRequestSchema
>;

/** `POST /api/invites/:code/signup` response. */
export const inviteSignupResponseSchema = z.object({
  user: userProfileSchema,
  projectId: idSchema,
});
export type InviteSignupResponse = z.infer<
  typeof inviteSignupResponseSchema
>;

/** `POST /api/invites/:code/join` response. */
export const inviteJoinResponseSchema = z.object({
  projectId: idSchema,
});
export type InviteJoinResponse = z.infer<typeof inviteJoinResponseSchema>;

/** Tag with its usage count, used by autocomplete. */
export const tagSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  count: z.number().int(),
});
export type TagSummary = z.infer<typeof tagSummarySchema>;

/** `GET /api/projects/:pid/tags` response. */
export const tagListResponseSchema = z.array(tagSummarySchema);
export type TagListResponse = z.infer<typeof tagListResponseSchema>;

/** Party (담당자) role enum. */
export const partyRoleSchema = z.enum(PARTY_ROLES);

/** Party member clear status enum. */
export const memberStatusSchema = z.enum(MEMBER_STATUSES);

/** Statuses an active member may set for themselves. */
export const activeMemberStatusSchema = z.enum(ACTIVE_MEMBER_STATUSES);

/** How a nomination came about. */
export const nominationKindSchema = z.enum(NOMINATION_KINDS);

/** Nomination lifecycle state. */
export const nominationStateSchema = z.enum(NOMINATION_STATES);

/**
 * In-app notification type.
 *
 * The runtime enum includes every value in {@link NOTIFICATION_TYPES}
 * (`clear_revoked` included); the output type stays the pre-F1 union until the
 * web copy switch learns the new case.
 */
export const notificationTypeSchema = z.enum(
  NOTIFICATION_TYPES,
) as unknown as z.ZodType<NotificationType, string>;

/** Bounty (현상금) shown on quest cards. */
export const bountySchema = z.object({
  base: z.number().int(),
  multiplier: z.number(),
  total: z.number().int(),
  days: z.number().int(),
  dusty: z.boolean(),
});
export type Bounty = z.infer<typeof bountySchema>;

/** Active party member as summarised on a board card (leader first). */
export const partySummarySchema = z.object({
  userId: idSchema,
  displayName: z.string(),
  role: partyRoleSchema,
  status: memberStatusSchema,
});
export type PartySummary = z.infer<typeof partySummarySchema>;

/** Party member in the quest detail, retreated members included. */
export const partyMemberSchema = z.object({
  user: userRefSchema,
  role: partyRoleSchema,
  status: memberStatusSchema,
  retreatReason: z.string().nullable(),
  joinedAt: timestampSchema,
});
export type PartyMember = z.infer<typeof partyMemberSchema>;

/** A pending nomination (지목) in the quest detail. */
export const nominationSchema = z.object({
  id: idSchema,
  questId: idSchema,
  nominee: userRefSchema,
  nominatedBy: userRefSchema,
  kind: nominationKindSchema,
  state: nominationStateSchema,
  passReason: z.string().nullable(),
  createdAt: timestampSchema,
});
export type Nomination = z.infer<typeof nominationSchema>;

/**
 * A floor (층) of the quest dungeon.
 *
 * @deprecated Dungeon floors are replaced by quest checklists (F1); this shape
 * only keeps the not-yet-migrated floor routes compiling and is removed with
 * them.
 */
export const floorSchema = z.object({
  id: idSchema,
  title: z.string(),
  orderKey: z.string(),
  doneAt: timestampSchema.nullable(),
  doneBy: userRefSchema.nullable(),
});
/** @deprecated See {@link floorSchema}; removed with the floor routes. */
export type Floor = z.infer<typeof floorSchema>;

/** In-app notification row for the current user. */
export const notificationSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  questId: idSchema.nullable(),
  questNumber: z.number().int().nullable(),
  questTitle: z.string().nullable(),
  type: notificationTypeSchema,
  actor: userRefSchema.nullable(),
  payload: z.unknown(),
  createdAt: timestampSchema,
  readAt: timestampSchema.nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

/** A level change reported after XP is awarded. */
export const levelUpSchema = z.object({
  userId: idSchema,
  from: z.number().int(),
  to: z.number().int(),
});
export type LevelUp = z.infer<typeof levelUpSchema>;

/** Quest card data returned by list endpoints. */
export const questSummarySchema = z.object({
  id: idSchema,
  number: z.number().int(),
  title: z.string(),
  stage: stageSchema,
  // Defaulted for new quests and optional so responses from a server that does
  // not send the field yet still serialize (the F1 server task fills it in).
  kind: questKindSchema.default("fix").optional(),
  rank: rankSchema.nullable(),
  orderKey: z.string(),
  tags: z.array(z.string()),
  createdBy: userRefSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  party: z.array(partySummarySchema),
  floors: z.object({
    done: z.number().int(),
    total: z.number().int(),
  }),
  pendingNominations: z.number().int(),
  bounty: bountySchema,
});
export type QuestSummary = z.infer<typeof questSummarySchema>;

/** Full quest data returned by detail endpoints. */
export const questSchema = questSummarySchema.extend({
  projectId: idSchema,
  situation: z.string(),
  direction: z.string(),
  archiveReason: z.string().nullable(),
  party: z.array(partyMemberSchema),
  nominations: z.array(nominationSchema),
  /**
   * @deprecated Dungeon floors are replaced by checklists (F1). Kept as the
   * detail array while the floor routes still exist; T04 removes it and the
   * detail inherits the summary's `{ done, total }` instead.
   */
  floors: z.array(floorSchema),
  // Defaulted for new refs and optional until the server sends the list.
  refs: z.array(questRefSchema).default([]).optional(),
  bounty: bountySchema,
  firstClaimedAt: timestampSchema.nullable(),
});
export type Quest = z.infer<typeof questSchema>;

/** My pending nomination together with the quest it belongs to. */
export const myNominationSchema = nominationSchema.extend({
  questNumber: z.number().int(),
  questTitle: z.string(),
});
export type MyNomination = z.infer<typeof myNominationSchema>;

/** `GET /api/projects/:pid/quests` response. */
export const questListResponseSchema = z.array(questSummarySchema);
export type QuestListResponse = z.infer<typeof questListResponseSchema>;

/** `POST /api/projects/:pid/quests` request. */
export const createQuestRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  situation: z.string().max(20_000).optional(),
  direction: z.string().max(20_000).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  rank: rankSchema.nullable().optional(),
  kind: questKindSchema.optional(),
});
export type CreateQuestRequest = z.infer<typeof createQuestRequestSchema>;

/** `POST /api/projects/:pid/quests/bulk` request. */
export const bulkCreateQuestsRequestSchema = z.object({
  // Blank/whitespace-only lines are allowed through the schema; the server
  // removes them before creating quests.
  titles: z.array(z.string().max(200)).min(1).max(100),
});
export type BulkCreateQuestsRequest = z.infer<
  typeof bulkCreateQuestsRequestSchema
>;

/** `PATCH /api/quests/:id` request. */
export const updateQuestRequestSchema = createQuestRequestSchema.partial();
export type UpdateQuestRequest = z.infer<typeof updateQuestRequestSchema>;

/** `POST /api/quests/:id/refs` request (참고 문서 추가). */
export const createQuestRefRequestSchema = z.object({
  label: z.string().trim().max(100).optional(),
  target: z.string().trim().min(1).max(1000),
});
export type CreateQuestRefRequest = z.infer<
  typeof createQuestRefRequestSchema
>;

/** `POST /api/quests/:id/move` request. */
export const moveQuestRequestSchema = z.object({
  stage: stageSchema,
  beforeId: idSchema.optional(),
  afterId: idSchema.optional(),
});
export type MoveQuestRequest = z.infer<typeof moveQuestRequestSchema>;

/** `POST /api/quests/:id/archive` request. */
export const archiveQuestRequestSchema = z.object({
  reason: z.literal("dropped").optional(),
});
export type ArchiveQuestRequest = z.infer<typeof archiveQuestRequestSchema>;

/** `POST /api/quests/:id/nominations` request (지목). */
export const nominateRequestSchema = z.object({
  userIds: z.array(idSchema).min(1).max(10),
});
export type NominateRequest = z.infer<typeof nominateRequestSchema>;

/** `POST /api/nominations/:id/pass` request (패스 또는 토스). */
export const passNominationRequestSchema = z.object({
  reason: z.string().trim().max(100).optional(),
  relayToUserId: idSchema.optional(),
});
export type PassNominationRequest = z.infer<
  typeof passNominationRequestSchema
>;

/** `POST /api/quests/:id/leave` request (후퇴). */
export const leavePartyRequestSchema = z.object({
  reason: z.string().trim().max(100).optional(),
});
export type LeavePartyRequest = z.infer<typeof leavePartyRequestSchema>;

/** `POST /api/quests/:id/status` request (공략 상태). */
export const memberStatusRequestSchema = z.object({
  status: activeMemberStatusSchema,
});
export type MemberStatusRequest = z.infer<typeof memberStatusRequestSchema>;

/** `POST /api/quests/:id/retry` request (재도전 요청). */
export const retryQuestRequestSchema = z.object({
  comment: z.string().trim().min(1).max(500),
});
export type RetryQuestRequest = z.infer<typeof retryQuestRequestSchema>;

/** `POST /api/quests/:id/checklist/:index` request (체크리스트 토글). */
export const toggleChecklistRequestSchema = z.object({
  done: z.boolean(),
  text: z.string(),
});
export type ToggleChecklistRequest = z.infer<
  typeof toggleChecklistRequestSchema
>;

/** `POST /api/quests/:id/checklist` request (체크리스트 항목 추가). */
export const appendChecklistRequestSchema = z.object({
  // Whitespace-only titles are allowed through the schema; the server drops
  // them before appending the checklist lines.
  titles: z.array(z.string().max(200)).min(1).max(50),
});
export type AppendChecklistRequest = z.infer<
  typeof appendChecklistRequestSchema
>;

/**
 * `POST /api/quests/:id/floors` request (층 추가).
 *
 * @deprecated Floors are replaced by checklists (F1); removed with the floor
 * routes.
 */
export const addFloorsRequestSchema = z.object({
  // Whitespace-only lines are allowed through the schema; the server drops
  // them before creating floors.
  titles: z.array(z.string().max(200)).min(1).max(50),
});
/** @deprecated See {@link addFloorsRequestSchema}. */
export type AddFloorsRequest = z.infer<typeof addFloorsRequestSchema>;

/**
 * `PATCH /api/floors/:id` request.
 *
 * @deprecated Floors are replaced by checklists (F1); removed with the floor
 * routes.
 */
export const updateFloorRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  done: z.boolean().optional(),
});
/** @deprecated See {@link updateFloorRequestSchema}. */
export type UpdateFloorRequest = z.infer<typeof updateFloorRequestSchema>;

/**
 * `POST /api/floors/:id/move` request.
 *
 * @deprecated Floors are replaced by checklists (F1); removed with the floor
 * routes.
 */
export const moveFloorRequestSchema = z.object({
  beforeId: idSchema.optional(),
  afterId: idSchema.optional(),
});
/** @deprecated See {@link moveFloorRequestSchema}. */
export type MoveFloorRequest = z.infer<typeof moveFloorRequestSchema>;

/** `POST /api/notifications/read` request. */
export const readNotificationsRequestSchema = z.object({
  ids: z.array(idSchema).optional(),
  all: z.boolean().optional(),
});
export type ReadNotificationsRequest = z.infer<
  typeof readNotificationsRequestSchema
>;

/** `GET /api/notifications` query (`unread=1`, limit 1-100, default 50). */
export const notificationListQuerySchema = z.object({
  unread: z.enum(["0", "1"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type NotificationListQuery = z.infer<
  typeof notificationListQuerySchema
>;

/** `POST /api/quests/:id/nominations` and `.../reinforcements` response. */
export const nominationListResponseSchema = z.object({
  nominations: z.array(nominationSchema),
});
export type NominationListResponse = z.infer<
  typeof nominationListResponseSchema
>;

/** `POST /api/quests/:id/clear` response. */
export const clearQuestResponseSchema = z.object({
  quest: questSchema,
  rewards: z.array(
    z.object({
      userId: idSchema,
      amount: z.number().int(),
    }),
  ),
  levelUps: z.array(levelUpSchema),
});
export type ClearQuestResponse = z.infer<typeof clearQuestResponseSchema>;

/** `GET /api/quests/:id/clear-preview` response. */
export const clearPreviewResponseSchema = z.object({
  total: z.number().int(),
  rewards: z.array(
    z.object({
      user: userRefSchema,
      amount: z.number().int(),
    }),
  ),
  requesterBonus: z
    .object({
      user: userRefSchema,
      amount: z.number().int(),
    })
    .nullable(),
  actorIsInvolved: z.boolean(),
});
export type ClearPreviewResponse = z.infer<typeof clearPreviewResponseSchema>;

/** `GET /api/notifications` response. */
export const notificationListResponseSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().int(),
});
export type NotificationListResponse = z.infer<
  typeof notificationListResponseSchema
>;

/**
 * `POST /api/quests/:id/floors` response (the quest's floors).
 *
 * @deprecated Floors are replaced by checklists (F1); removed with the floor
 * routes.
 */
export const floorListResponseSchema = z.array(floorSchema);
/** @deprecated See {@link floorListResponseSchema}. */
export type FloorListResponse = z.infer<typeof floorListResponseSchema>;

/** `GET /api/me/nominations` response (my pending nominations). */
export const myNominationsResponseSchema = z.array(myNominationSchema);
export type MyNominationsResponse = z.infer<
  typeof myNominationsResponseSchema
>;

/** `GET /api/projects/:pid/quests` query. `stage` is a comma-separated list. */
export const listQuestsQuerySchema = z.object({
  stage: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
});
export type ListQuestsQuery = z.infer<typeof listQuestsQuerySchema>;

/** `GET /api/projects/:pid/tags` query. */
export const tagAutocompleteQuerySchema = z.object({
  q: z.string().optional(),
});
export type TagAutocompleteQuery = z.infer<
  typeof tagAutocompleteQuerySchema
>;
