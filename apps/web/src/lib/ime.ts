/**
 * IME composition guard for keyboard handlers.
 *
 * Browsers report an in-progress IME composition (Korean, Japanese, Chinese,
 * …) inconsistently: React synthetic events expose the flag on
 * `nativeEvent.isComposing`, native events expose it on `isComposing`, and
 * Chrome/Edge/Safari sometimes report the Enter that confirms a candidate as
 * `keyCode === 229` only. Keyboard handlers that submit on Enter must skip
 * when this returns `true`, otherwise confirming an IME candidate fires the
 * shortcut prematurely.
 */
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * The fields the guard reads. Both {@link ReactKeyboardEvent} and the DOM
 * {@link KeyboardEvent} are assignable to this shape, so the implementation can
 * inspect the union without casts while still tolerating a missing
 * `nativeEvent`.
 */
interface ComposingKeyboardEvent {
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly nativeEvent?: { readonly isComposing?: boolean } | null;
}

/**
 * Whether a keyboard event belongs to an IME composition in progress.
 *
 * Accepts both React synthetic keyboard events and native DOM keyboard
 * events. Returns `true` when any of these signals is set:
 *
 * - `nativeEvent.isComposing` (React synthetic events)
 * - `isComposing` (native events)
 * - `keyCode === 229` (composition Enter in Chrome/Edge/Safari)
 *
 * A regular Enter (`keyCode === 13`, `isComposing === false`) returns `false`.
 */
export function isImeComposing(
  event: ReactKeyboardEvent | KeyboardEvent,
): boolean {
  const candidate: ComposingKeyboardEvent = event;

  return (
    candidate.nativeEvent?.isComposing === true ||
    candidate.isComposing === true ||
    candidate.keyCode === 229
  );
}
