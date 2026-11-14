// @vitest-environment node
/**
 * Unit tests for the IME composition guard.
 *
 * The guard only reads a handful of event fields, so the tests use plain
 * objects cast to the event types instead of constructing DOM events. This
 * keeps the cases deterministic across browsers and environments.
 */
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { describe, expect, it } from "vitest";

import { isImeComposing } from "./ime";

/** Build a native keyboard event stub with only the fields under test. */
function nativeEvent(fields: {
  isComposing?: boolean;
  keyCode?: number;
}): KeyboardEvent {
  return { key: "Enter", ...fields } as unknown as KeyboardEvent;
}

/** Build a React synthetic keyboard event stub with only the fields under test. */
function reactEvent(fields: {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}): ReactKeyboardEvent {
  return { key: "Enter", ...fields } as unknown as ReactKeyboardEvent;
}

describe("isImeComposing", () => {
  it("returns true when a React synthetic event's nativeEvent is composing", () => {
    const event = reactEvent({
      keyCode: 13,
      nativeEvent: { isComposing: true },
    });

    expect(isImeComposing(event)).toBe(true);
  });

  it("returns true when a native event is composing", () => {
    const event = nativeEvent({ keyCode: 13, isComposing: true });

    expect(isImeComposing(event)).toBe(true);
  });

  it("returns true for keyCode 229 (composition Enter)", () => {
    const event = nativeEvent({ keyCode: 229, isComposing: false });

    expect(isImeComposing(event)).toBe(true);
  });

  it("returns false for a normal Enter", () => {
    const event = nativeEvent({ keyCode: 13, isComposing: false });

    expect(isImeComposing(event)).toBe(false);
  });

  it("tolerates a React synthetic event without nativeEvent", () => {
    const event = reactEvent({ keyCode: 13 });

    expect(isImeComposing(event)).toBe(false);
  });

  it("does not treat another key as composition", () => {
    const event = nativeEvent({ keyCode: 65, isComposing: false });

    expect(isImeComposing(event)).toBe(false);
  });
});
