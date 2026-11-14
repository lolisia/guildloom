/**
 * Guild (project) endpoints.
 */
import type {
  CreateProjectRequest,
  Project,
  ProjectDetailResponse,
  ProjectListResponse,
  UpdateProjectRequest,
} from "@guildloom/shared";

import { apiFetch } from "./client";

/** `GET /api/projects` — guilds the current user belongs to. */
export function fetchProjects(signal?: AbortSignal): Promise<ProjectListResponse> {
  return apiFetch<ProjectListResponse>("/projects", { signal });
}

/** `POST /api/projects` — create a guild and become its owner. */
export function createProject(
  body: CreateProjectRequest,
  signal?: AbortSignal,
): Promise<Project> {
  return apiFetch<Project>("/projects", { method: "POST", body, signal });
}

/** `GET /api/projects/:projectId` — guild details and members. */
export function fetchProject(
  projectId: number,
  signal?: AbortSignal,
): Promise<ProjectDetailResponse> {
  return apiFetch<ProjectDetailResponse>(`/projects/${projectId}`, { signal });
}

/** `PATCH /api/projects/:projectId` — rename a guild. */
export function updateProject(
  projectId: number,
  body: UpdateProjectRequest,
  signal?: AbortSignal,
): Promise<Project> {
  return apiFetch<Project>(`/projects/${projectId}`, {
    method: "PATCH",
    body,
    signal,
  });
}
