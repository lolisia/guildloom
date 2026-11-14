/**
 * Small typed wrapper around `fetch` for the guildloom HTTP API.
 *
 * Every request is prefixed with `/api`, sends credentials for the same
 * origin (cookie session) and exchanges JSON bodies. Failed responses are
 * converted into {@link ApiClientError} using the shared
 * `{ error: { code, message } }` shape.
 */
import { apiErrorSchema } from "@guildloom/shared";

import { ko } from "../i18n/ko";

/** HTTP methods used by the M1 API. */
export type ApiMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Options accepted by {@link apiFetch}. */
export interface ApiRequestOptions {
  method?: ApiMethod;
  /** JSON-serializable request body. Omit for GET/DELETE requests. */
  body?: unknown;
  signal?: AbortSignal;
}

/** Error thrown for non-2xx responses and network failures. */
export class ApiClientError extends Error {
  /** HTTP status, or 0 for transport failures. */
  readonly status: number;
  /** Machine-readable error code (`{ error: { code } }`). */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

/** Prefix a path with `/api` exactly once. */
function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized === "/api" || normalized.startsWith("/api/")
    ? normalized
    : `/api${normalized}`;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

async function parseErrorBody(
  response: Response,
): Promise<{ code: string; message: string }> {
  try {
    const parsed = apiErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      return parsed.data.error;
    }
  } catch {
    // The body was empty or not JSON; fall through to the generic message.
  }

  return {
    code: "unexpected_error",
    message: ko.errors.http(response.status),
  };
}

/**
 * Perform a JSON request against the guildloom API.
 *
 * `apiFetch` resolves with the parsed JSON body, or `undefined` for a 204
 * response. Non-2xx responses throw {@link ApiClientError}.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { method = "GET", body, signal } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      body: payload,
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ApiClientError(0, "network_error", ko.errors.network);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const { code, message } = await parseErrorBody(response);
    throw new ApiClientError(response.status, code, message);
  }

  return (await response.json()) as T;
}
