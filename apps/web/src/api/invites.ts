/**
 * Invite link endpoints.
 *
 * Members mint and revoke reusable invite codes below a project; anybody can
 * inspect a code and either sign up (`/signup`) or join with an existing
 * session (`/join`). Response/request types come from `@guildloom/shared`.
 */
import type {
  CreateInviteResponse,
  InviteInfoResponse,
  InviteJoinResponse,
  InviteListResponse,
  InviteSignupRequest,
  InviteSignupResponse,
} from "@guildloom/shared";

import { apiFetch } from "./client";

/** Query key for a single invite lookup (not part of the shared key factory). */
export function inviteInfoQueryKey(code: string) {
  return ["inviteInfo", code] as const;
}

/**
 * Build the absolute URL shown to the adventurer.
 *
 * The API returns a relative client route (`/invite/<code>`) so the same link
 * works behind any origin; the UI prepends `window.location.origin` before it
 * is copied to the clipboard.
 */
export function inviteAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** `GET /api/projects/:pid/invites` ? invite links of a guild. */
export function fetchInvites(
  projectId: number,
  signal?: AbortSignal,
): Promise<InviteListResponse> {
  return apiFetch<InviteListResponse>(`/projects/${projectId}/invites`, {
    signal,
  });
}

/** `POST /api/projects/:pid/invites` ? mint a reusable invite link. */
export function createInvite(
  projectId: number,
  signal?: AbortSignal,
): Promise<CreateInviteResponse> {
  return apiFetch<CreateInviteResponse>(`/projects/${projectId}/invites`, {
    method: "POST",
    signal,
  });
}

/** `DELETE /api/projects/:pid/invites/:id` ? revoke an invite link. */
export function revokeInvite(
  projectId: number,
  inviteId: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<void>(`/projects/${projectId}/invites/${inviteId}`, {
    method: "DELETE",
    signal,
  });
}

/** `GET /api/invites/:code` ? public invite metadata. */
export function fetchInviteInfo(
  code: string,
  signal?: AbortSignal,
): Promise<InviteInfoResponse> {
  return apiFetch<InviteInfoResponse>(`/invites/${encodeURIComponent(code)}`, {
    signal,
  });
}

/** `POST /api/invites/:code/signup` ? create an account and join at once. */
export function signupWithInvite(
  code: string,
  body: InviteSignupRequest,
  signal?: AbortSignal,
): Promise<InviteSignupResponse> {
  return apiFetch<InviteSignupResponse>(
    `/invites/${encodeURIComponent(code)}/signup`,
    { method: "POST", body, signal },
  );
}

/** `POST /api/invites/:code/join` ? add the signed-in adventurer to the guild. */
export function joinInvite(
  code: string,
  signal?: AbortSignal,
): Promise<InviteJoinResponse> {
  return apiFetch<InviteJoinResponse>(
    `/invites/${encodeURIComponent(code)}/join`,
    { method: "POST", signal },
  );
}
