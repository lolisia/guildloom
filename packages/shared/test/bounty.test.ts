import { describe, expect, expectTypeOf, it } from "vitest";

import {
  BASE_CLEAR_XP,
  BOUNTY_CAP,
  DUSTY_AFTER_DAYS,
  computeBounty,
  type BountyInput,
} from "../src/index.js";

const DAY = 86_400_000;
const CREATED_AT = Date.UTC(2026, 0, 1, 0, 0, 0);

describe("computeBounty", () => {
  it("uses the flat 40 XP clear base on day 0", () => {
    expect(BASE_CLEAR_XP).toBe(40);
    expect(
      computeBounty({
        createdAt: CREATED_AT,
        firstClaimedAt: null,
        now: CREATED_AT,
      }),
    ).toEqual({
      base: 40,
      multiplier: 1,
      total: 40,
      days: 0,
      dusty: false,
    });
  });

  it("takes only the quest timestamps, never a rank", () => {
    expectTypeOf<keyof BountyInput>().toEqualTypeOf<
      "createdAt" | "firstClaimedAt" | "now"
    >();
  });

  it("adds 20% per full day on the board", () => {
    const bounty = computeBounty({
      createdAt: CREATED_AT,
      firstClaimedAt: null,
      now: CREATED_AT + 3 * DAY,
    });

    expect(bounty.days).toBe(3);
    expect(bounty.multiplier).toBe(1.6);
    expect(bounty.total).toBe(64); // round(40 * 1.6)
    expect(bounty.dusty).toBe(false);
  });

  it("ignores partial days", () => {
    const bounty = computeBounty({
      createdAt: CREATED_AT,
      firstClaimedAt: null,
      now: CREATED_AT + 3 * DAY + (DAY - 1),
    });

    expect(bounty.days).toBe(3);
    expect(bounty.multiplier).toBe(1.6);
  });

  it("caps the multiplier at BOUNTY_CAP", () => {
    const capped = computeBounty({
      createdAt: CREATED_AT,
      firstClaimedAt: null,
      now: CREATED_AT + 5 * DAY,
    });
    const longOpen = computeBounty({
      createdAt: CREATED_AT,
      firstClaimedAt: null,
      now: CREATED_AT + 60 * DAY,
    });

    expect(BOUNTY_CAP).toBe(2);
    expect(capped.multiplier).toBe(2);
    expect(capped.total).toBe(80);
    expect(longOpen.multiplier).toBe(2);
    expect(longOpen.total).toBe(80);
    expect(longOpen.days).toBe(60);
  });

  it("freezes the multiplier once the party is claimed", () => {
    const firstClaimedAt = CREATED_AT + 3 * DAY;

    const bounty = computeBounty({
      createdAt: CREATED_AT,
      firstClaimedAt,
      now: CREATED_AT + 30 * DAY,
    });

    expect(bounty.days).toBe(3);
    expect(bounty.multiplier).toBe(1.6);
    expect(bounty.total).toBe(64);
    expect(bounty.dusty).toBe(false);
  });

  it("turns dusty only after the cap plus the grace period", () => {
    const dust = (days: number) =>
      computeBounty({
        createdAt: CREATED_AT,
        firstClaimedAt: null,
        now: CREATED_AT + days * DAY,
      });

    expect(DUSTY_AFTER_DAYS).toBe(12);
    expect(dust(11).dusty).toBe(false);
    expect(dust(12).dusty).toBe(true);
    expect(dust(30).dusty).toBe(true);

    // A claimed quest never becomes dusty, even long after the cap.
    expect(
      computeBounty({
        createdAt: CREATED_AT,
        firstClaimedAt: CREATED_AT + DAY,
        now: CREATED_AT + 30 * DAY,
      }).dusty,
    ).toBe(false);
  });

  it("never returns negative days for clocks that run backwards", () => {
    const bounty = computeBounty({
      createdAt: CREATED_AT,
      firstClaimedAt: null,
      now: CREATED_AT - 3 * DAY,
    });

    expect(bounty.days).toBe(0);
    expect(bounty.multiplier).toBe(1);
    expect(bounty.total).toBe(40);
  });
});
