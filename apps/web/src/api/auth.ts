/**
 * Auth and first-run setup endpoints.
 *
 * Response/request types come from `@guildloom/shared` so the server and the
 * web client cannot drift apart.
 */
import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  SetupRequest,
  SetupResponse,
  SetupStatusResponse,
} from "@guildloom/shared";

import { apiFetch } from "./client";

/** `GET /api/setup/status` — whether the first-run setup is still required. */
export function fetchSetupStatus(
  signal?: AbortSignal,
): Promise<SetupStatusResponse> {
  return apiFetch<SetupStatusResponse>("/setup/status", { signal });
}

/** `POST /api/setup` — create the first guild and its owner account. */
export function setup(
  body: SetupRequest,
  signal?: AbortSignal,
): Promise<SetupResponse> {
  return apiFetch<SetupResponse>("/setup", { method: "POST", body, signal });
}

/** `POST /api/auth/login` — start a session. */
export function login(
  body: LoginRequest,
  signal?: AbortSignal,
): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body,
    signal,
  });
}

/** `POST /api/auth/logout` — end the current session. */
export function logout(signal?: AbortSignal): Promise<void> {
  return apiFetch<void>("/auth/logout", { method: "POST", signal });
}

/** `GET /api/auth/me` — the signed-in adventurer. */
export function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  return apiFetch<MeResponse>("/auth/me", { signal });
}
