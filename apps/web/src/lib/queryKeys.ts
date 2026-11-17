/**
 * TanStack Query key factory shared by every web screen.
 *
 * Keeping keys here lets later tasks (board, ledger, settings) invalidate or
 * prefetch each other's data without duplicating string literals.
 */
import type { ListQuestsQuery } from "@guildloom/shared";

export const queryKeys = {
  /** `GET /api/setup/status` */
  setupStatus: ["setupStatus"] as const,
  /** `GET /api/auth/me` */
  me: ["me"] as const,
  /** `GET /api/projects` */
  projects: ["projects"] as const,
  /** `GET /api/projects/:projectId` */
  project: (projectId: number) => ["project", projectId] as const,
  /** `GET /api/projects/:projectId/quests` */
  quests: (projectId: number, filters: ListQuestsQuery = {}) =>
    ["quests", projectId, filters] as const,
  /** `GET /api/quests/:questId` */
  quest: (questId: number) => ["quest", questId] as const,
  /** `GET /api/quests/:questId/events` */
  events: (questId: number) => ["events", questId] as const,
  /** `GET /api/quests/:questId/clear-preview` */
  clearPreview: (questId: number) => ["clearPreview", questId] as const,
  /** `GET /api/projects/:projectId/tags` */
  tags: (projectId: number, q = "") => ["tags", projectId, q] as const,
  /** `GET /api/projects/:projectId/invites` */
  invites: (projectId: number) => ["invites", projectId] as const,
  /** `GET /api/notifications` (newest first, includes the unread count). */
  notifications: ["notifications"] as const,
  /** `GET /api/me/nominations` (the adventurer's pending nominations). */
  myNominations: ["myNominations"] as const,
};
