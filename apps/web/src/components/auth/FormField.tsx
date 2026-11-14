/**
 * Labeled text input with optional hint and inline error copy.
 *
 * Every auth/settings form uses this so labels, descriptions and `aria-invalid`
 * wiring stay consistent (and tests can rely on `getByLabelText`). The input is
 * the shared `TextInput` atom; an optional pack icon (for example `key` on
 * password fields) sits inside the field at its native 32px size.
 */
import { useId } from "react";
import type { InputHTMLAttributes } from "react";

import type { IconName } from "../../lib/icons";
import Icon from "../Icon";
import { TextInput } from "../ui";

export interface FormFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  /** Stable element id; generated when omitted. */
  id?: string;
  /** Visible label, also the input's accessible name. */
  label: string;
  /** Static hint shown below the input (e.g. the login-id rules). */
  hint?: string;
  /** Korean validation message for this field. */
  error?: string | null;
  /** Optional decorative icon shown inside the field. */
  icon?: IconName;
}

/** Text input with a label, hint and validation error. */
export function FormField({
  id,
  label,
  hint,
  error,
  icon,
  className,
  ...inputProps
}: FormFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  const inputClasses = [icon ? "pl-11" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-xs font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        {icon ? (
          <Icon
            name={icon}
            size={32}
            className="pointer-events-none absolute left-2 top-0.5"
          />
        ) : null}
        <TextInput
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...inputProps}
          className={inputClasses || undefined}
        />
      </div>
      {hint ? (
        <p id={hintId} className="text-xs leading-4 text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-brick">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default FormField;
