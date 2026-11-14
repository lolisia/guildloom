/**
 * Inline error banner for a failed form submission.
 */
export interface FormAlertProps {
  /** Message to show; `null` renders nothing. */
  message: string | null;
}

/** Accessible (`role="alert"`) error banner used by every form. */
export function FormAlert({ message }: FormAlertProps) {
  if (!message) {
    return null;
  }

  return (
    <p
      role="alert"
      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
    >
      {message}
    </p>
  );
}

export default FormAlert;
