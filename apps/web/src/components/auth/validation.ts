/**
 * Client-side validation for the setup, login and invite forms.
 *
 * The rules themselves come from the shared Zod contracts so the browser and
 * the server cannot disagree; this module only adds the Korean presentation
 * (the ko bundle has no per-field Zod messages).
 */
import {
  displayNameSchema,
  guildNameSchema,
  loginIdSchema,
  passwordSchema,
} from "@guildloom/shared";

import { ko } from "../../i18n/ko";

/** Shared generic validation copy, or `null` when the value is accepted. */
function validate(
  result: { success: boolean },
  message: string = ko.errors.validation,
): string | null {
  return result.success ? null : message;
}

/** Guild name: trimmed, 1-40 characters. */
export function validateGuildName(value: string): string | null {
  return validate(guildNameSchema.safeParse(value));
}

/** Adventurer display name: trimmed, 1-20 characters. */
export function validateDisplayName(value: string): string | null {
  return validate(displayNameSchema.safeParse(value));
}

/** Login id: 3-32 lowercase letters, digits, dots, underscores or hyphens. */
export function validateLoginId(value: string): string | null {
  return validate(loginIdSchema.safeParse(value));
}

/** Password: at least 8 characters. */
export function validatePassword(value: string): string | null {
  return validate(passwordSchema.safeParse(value));
}

/** Whether every error slot of a field-error record is empty. */
export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((message) => message !== undefined);
}
