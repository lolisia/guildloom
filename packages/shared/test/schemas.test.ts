import { describe, expect, it } from "vitest";

import {
  RANKS,
  STAGES,
  bulkCreateQuestsRequestSchema,
  createQuestRequestSchema,
  displayNameSchema,
  guildNameSchema,
  loginIdSchema,
  passwordSchema,
  questEventSchema,
  questEventsResponseSchema,
  questSummarySchema,
  rankSchema,
  stageSchema,
  updateQuestRequestSchema,
} from "../src/index.js";

describe("loginIdSchema", () => {
  it("accepts ids of 3 to 32 allowed characters", () => {
    expect(loginIdSchema.safeParse("abc").success).toBe(true);
    expect(loginIdSchema.safeParse("a".repeat(32)).success).toBe(true);
    expect(loginIdSchema.safeParse("user.name_1-x").success).toBe(true);
  });

  it("rejects ids shorter than 3 or longer than 32", () => {
    expect(loginIdSchema.safeParse("ab").success).toBe(false);
    expect(loginIdSchema.safeParse("a".repeat(33)).success).toBe(false);
  });

  it("rejects invalid characters", () => {
    expect(loginIdSchema.safeParse("ABC").success).toBe(false);
    expect(loginIdSchema.safeParse("abc def").success).toBe(false);
    expect(loginIdSchema.safeParse("abc!").success).toBe(false);
    expect(loginIdSchema.safeParse("한글").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("requires at least 8 characters", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
  });
});

describe("displayNameSchema", () => {
  it("accepts 1 to 20 trimmed characters", () => {
    expect(displayNameSchema.safeParse("김").success).toBe(true);
    expect(displayNameSchema.safeParse("가".repeat(20)).success).toBe(true);
  });

  it("rejects names longer than 20 characters", () => {
    expect(displayNameSchema.safeParse("가".repeat(21)).success).toBe(false);
  });

  it("rejects blank names and trims surrounding whitespace", () => {
    expect(displayNameSchema.safeParse("   ").success).toBe(false);
    expect(displayNameSchema.parse("  김철수  ")).toBe("김철수");
  });
});

describe("guildNameSchema", () => {
  it("accepts 1 to 40 trimmed characters", () => {
    expect(guildNameSchema.safeParse("길드").success).toBe(true);
    expect(guildNameSchema.safeParse("가".repeat(40)).success).toBe(true);
  });

  it("rejects blank or longer names", () => {
    expect(guildNameSchema.safeParse("").success).toBe(false);
    expect(guildNameSchema.safeParse("가".repeat(41)).success).toBe(false);
    expect(guildNameSchema.parse("  모험가 길드  ")).toBe("모험가 길드");
  });
});

describe("stageSchema and rankSchema", () => {
  it("accepts exactly the known stages", () => {
    expect(stageSchema.options).toEqual([...STAGES]);
    for (const stage of STAGES) {
      expect(stageSchema.safeParse(stage).success).toBe(true);
    }
    expect(stageSchema.safeParse("nowhere").success).toBe(false);
  });

  it("accepts exactly the known ranks", () => {
    expect(rankSchema.options).toEqual([...RANKS]);
    for (const rank of RANKS) {
      expect(rankSchema.safeParse(rank).success).toBe(true);
    }
    expect(rankSchema.safeParse("Z").success).toBe(false);
    expect(rankSchema.safeParse(null).success).toBe(false);
  });

  it("allows a null rank where the API allows none", () => {
    expect(
      createQuestRequestSchema.safeParse({ title: "로그인 버그", rank: null })
        .success,
    ).toBe(true);
    expect(updateQuestRequestSchema.safeParse({ rank: null }).success).toBe(
      true,
    );
  });
});

describe("bulkCreateQuestsRequestSchema", () => {
  it("accepts 1 to 100 titles", () => {
    expect(
      bulkCreateQuestsRequestSchema.safeParse({ titles: ["하나"] }).success,
    ).toBe(true);
    expect(
      bulkCreateQuestsRequestSchema.safeParse({
        titles: Array.from({ length: 100 }, (_, index) => `퀘스트 ${index}`),
      }).success,
    ).toBe(true);
  });

  it("rejects empty lists and more than 100 titles", () => {
    expect(bulkCreateQuestsRequestSchema.safeParse({ titles: [] }).success).toBe(
      false,
    );
    expect(
      bulkCreateQuestsRequestSchema.safeParse({
        titles: Array.from({ length: 101 }, (_, index) => `퀘스트 ${index}`),
      }).success,
    ).toBe(false);
  });

  it("limits each title to 200 characters but lets blank lines through", () => {
    expect(
      bulkCreateQuestsRequestSchema.safeParse({ titles: ["a".repeat(200)] })
        .success,
    ).toBe(true);
    expect(
      bulkCreateQuestsRequestSchema.safeParse({ titles: ["a".repeat(201)] })
        .success,
    ).toBe(false);
    // The server filters whitespace-only lines after validation.
    expect(
      bulkCreateQuestsRequestSchema.safeParse({ titles: ["   ", "real"] })
        .success,
    ).toBe(true);
  });
});

describe("questSummarySchema", () => {
  const summary = {
    id: 1,
    number: 12,
    title: "로그인 버그",
    stage: "board",
    rank: null,
    orderKey: "a0",
    tags: ["버그"],
    createdBy: { id: 7, displayName: "김철수" },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
  };

  it("has exactly the agreed fields", () => {
    expect(Object.keys(questSummarySchema.shape)).toEqual([
      "id",
      "number",
      "title",
      "stage",
      "rank",
      "orderKey",
      "tags",
      "createdBy",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("parses a quest summary and keeps its shape", () => {
    const parsed = questSummarySchema.parse(summary);

    expect(parsed).toEqual(summary);
    expect(Object.keys(parsed)).toEqual(Object.keys(summary));
  });

  it("accepts a rank and null", () => {
    expect(questSummarySchema.parse({ ...summary, rank: "S" }).rank).toBe("S");
    expect(questSummarySchema.parse({ ...summary, rank: null }).rank).toBeNull();
  });

  it("rejects a summary with an invalid stage", () => {
    expect(
      questSummarySchema.safeParse({ ...summary, stage: "nowhere" }).success,
    ).toBe(false);
  });
});

describe("questEventSchema", () => {
  const event = {
    id: 1,
    questId: 12,
    projectId: 1,
    type: "quest_moved",
    payload: { from: "board", to: "dungeon" },
    actor: { id: 7, displayName: "김철수" },
    familiarId: null,
    createdAt: 1_700_000_000_000,
  };

  it("parses an event with actor and payload", () => {
    expect(questEventSchema.parse(event)).toEqual(event);
  });

  it("accepts a null actor and a familiar id", () => {
    const parsed = questEventSchema.parse({
      ...event,
      actor: null,
      familiarId: 3,
      payload: null,
    });

    expect(parsed.actor).toBeNull();
    expect(parsed.familiarId).toBe(3);
    expect(parsed.payload).toBeNull();
  });

  it("rejects unknown event types", () => {
    expect(
      questEventSchema.safeParse({ ...event, type: "quest_cleared" }).success,
    ).toBe(false);
  });

  it("parses an event list response", () => {
    expect(questEventsResponseSchema.parse([event])).toEqual([event]);
  });
});
