import { describe, expect, it } from "vitest";

import { splitClearXp } from "../src/index.js";

describe("splitClearXp", () => {
  it("splits evenly when the total divides by the member count", () => {
    expect(splitClearXp(60, [1, 2, 3])).toEqual({ 1: 20, 2: 20, 3: 20 });
  });

  it("gives leftover units one each, starting with the leader", () => {
    // 50 / 3 = 16 remainder 2 → the first two members (leader first) get +1.
    expect(splitClearXp(50, [7, 8, 9])).toEqual({ 7: 17, 8: 17, 9: 16 });

    // 49 / 3 = 16 remainder 1 → only the leader gets the extra unit.
    expect(splitClearXp(49, [7, 8, 9])).toEqual({ 7: 17, 8: 16, 9: 16 });
  });

  it("returns an empty object when the party has no members", () => {
    expect(splitClearXp(80, [])).toEqual({});
  });

  it("gives the whole total to a single member", () => {
    expect(splitClearXp(80, [4])).toEqual({ 4: 80 });
  });

  it("hands out single units when there are more members than XP", () => {
    expect(splitClearXp(2, [1, 2, 3])).toEqual({ 1: 1, 2: 1, 3: 0 });
  });

  it("always distributes exactly the total", () => {
    const shares = splitClearXp(97, [5, 6, 7, 8]);

    expect(Object.values(shares).reduce((sum, share) => sum + share, 0)).toBe(
      97,
    );
  });

  it("counts duplicate ids once so the shares still add up", () => {
    expect(splitClearXp(30, [1, 1, 2])).toEqual({ 1: 15, 2: 15 });
  });
});
