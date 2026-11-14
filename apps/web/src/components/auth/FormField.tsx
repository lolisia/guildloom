/**
 * Labeled text input with optional hint and inline error copy.
 *
 * Every auth/settings form uses this so labels, descriptions and `aria-invalid`
 * wiring stay consistent (and tests can rely on `getByLabelText`).
 */
import { useId } from "react";
import type { InputHTMLAttributes } from "react";

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
}

/** Text input with a label, hint and validation error. */
export function FormField({
  id,
  label,
  hint,
  error,
  ...inputProps
}: FormFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-slate-300"
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/70"
      />
      {hint ? (
        <p id={hintId} className="text-[11px] leading-4 text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default FormField;
