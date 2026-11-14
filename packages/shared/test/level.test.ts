import { describe, expect, it } from "vitest";

import { levelFromXp, levelProgress, xpForLevel } from "../src/index.js";

describe("xpForLevel", () => {
  it("uses the 50 * n * (n - 1) curve", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(300);
    expect(xpForLevel(4)).toBe(600);
    expect(xpForLevel(10)).toBe(4500);
  });
});

describe("levelFromXp", () => {
  it("treats 0 as level 1", () => {
    expect(levelFromXp(0)).toBe(1);
  });

  it("stays level 1 just below the 100 XP boundary", () => {
    expect(levelFromXp(99)).toBe(1);
  });

  it("promotes to level 2 exactly at 100 XP", () => {
    expect(levelFromXp(100)).toBe(2);
  });

  it("stays level 2 just below the 300 XP boundary", () => {
    expect(levelFromXp(299)).toBe(2);
  });

  it("promotes to level 3 exactly at 300 XP", () => {
    expect(levelFromXp(300)).toBe(3);
  });

  it("clamps negative XP to level 1", () => {
    expect(levelFromXp(-50)).toBe(1);
  });

  it("handles large values", () => {
    expect(levelFromXp(xpForLevel(42))).toBe(42);
    expect(levelFromXp(xpForLevel(42) - 1)).toBe(41);
  });
});

describe("levelProgress", () => {
  it("reports zero progress at level 1", () => {
    expect(levelProgress(0)).toEqual({ level: 1, current: 0, next: 100 });
  });

  it("reports progress near the end of level 1", () => {
    expect(levelProgress(99)).toEqual({ level: 1, current: 99, next: 100 });
  });

  it("resets progress when reaching level 2", () => {
    expect(levelProgress(100)).toEqual({ level: 2, current: 0, next: 200 });
  });

  it("reports progress near the end of level 2", () => {
    expect(levelProgress(299)).toEqual({ level: 2, current: 199, next: 200 });
  });

  it("resets progress when reaching level 3", () => {
    expect(levelProgress(300)).toEqual({ level: 3, current: 0, next: 300 });
  });

  it("reports the span remaining inside the current level", () => {
    expect(levelProgress(150)).toEqual({ level: 2, current: 50, next: 200 });
  });
});
