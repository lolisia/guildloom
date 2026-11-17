/**
 * Regression test for the removed dungeon-floor API (F1).
 *
 * Floors are replaced by quest checklists, so every former floor endpoint must
 * be gone and answer the standard 404 envelope instead of authenticating.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./helpers.js";

let test: TestApp;

beforeEach(async () => {
  test = await createTestApp();
});

afterEach(async () => {
  await test.close();
});

describe("removed floor endpoints", () => {
  it("answers 404 for every former floor route", async () => {
    const calls = [
      { method: "POST" as const, url: "/api/quests/1/floors", payload: { titles: ["1층"] } },
      { method: "PATCH" as const, url: "/api/floors/1", payload: { done: true } },
      { method: "POST" as const, url: "/api/floors/1/move", payload: {} },
      { method: "DELETE" as const, url: "/api/floors/1" },
    ];

    for (const call of calls) {
      const response = await test.app.inject(call);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Not found" },
      });
    }
  });
});
