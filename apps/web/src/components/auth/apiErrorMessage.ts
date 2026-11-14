/**
 * Translate an API failure into Korean copy.
 *
 * Server error codes win when the shared `ko.errors.byCode` table knows them
 * (validation, invalid credentials, revoked invites, …); otherwise the HTTP
 * status decides. The server's English messages are never shown directly.
 */
import { ApiClientError } from "../../api/client";
import { ko } from "../../i18n/ko";

/** Fallback copy per HTTP status. */
const STATUS_MESSAGES: Record<number, string> = {
  0: ko.errors.network,
  400: ko.errors.validation,
  401: ko.errors.unauthorized,
  403: ko.errors.forbidden,
  404: ko.errors.notFound,
  409: ko.errors.conflict,
  422: ko.errors.validation,
};

/** Korean message for `error`, or `fallback` when it cannot be classified. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiClientError)) {
    return fallback;
  }

  const byCode = ko.errors.byCode[error.code.toLowerCase()];
  if (byCode) {
    return byCode;
  }

  return STATUS_MESSAGES[error.status] ?? fallback;
}
