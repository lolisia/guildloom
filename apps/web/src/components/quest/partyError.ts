/**
 * Korean copy for party-mutation failures.
 *
 * Party routes reject unauthorized actors with 403 and stale/closed quests or
 * nominations with 409. Both need a specific sentence instead of the generic
 * "문제가 발생했습니다" fallback, so the drawer and the nomination popover share
 * this mapping.
 */
import { ApiClientError } from "../../api/client";
import { ko } from "../../i18n/ko";

/** Map a thrown API error to the Korean message shown next to the action. */
export function partyErrorMessage(
  error: unknown,
  fallback: string = ko.party.errors.failed,
): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) {
      return ko.party.errors.forbidden;
    }
    if (error.status === 409) {
      return ko.party.errors.conflict;
    }
  }
  return fallback;
}
