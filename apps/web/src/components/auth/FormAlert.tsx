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
      className="rounded-sm border-[1.5px] border-brick bg-paper px-3 py-2 text-xs text-brick"
    >
      {message}
    </p>
  );
}

export default FormAlert;
