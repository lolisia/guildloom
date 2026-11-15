import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_TYPES,
  QUEST_KINDS,
  RANKS,
  STAGES,
  XP_REASONS,
  appendChecklistRequestSchema,
  bulkCreateQuestsRequestSchema,
  clearPreviewResponseSchema,
  clearQuestResponseSchema,
  createQuestRefRequestSchema,
  createQuestRequestSchema,
  displayNameSchema,
  guildNameSchema,
  leavePartyRequestSchema,
  loginIdSchema,
  memberStatusRequestSchema,
  myNominationSchema,
  myNominationsResponseSchema,
  nominateRequestSchema,
  nominationListResponseSchema,
  nominationSchema,
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationSchema,
  notificationTypeSchema,
  passNominationRequestSchema,
  passwordSchema,
  questEventSchema,
  questEventsResponseSchema,
  questKindSchema,
  questRefSchema,
  questSchema,
  questSummarySchema,
  rankSchema,
  readNotificationsRequestSchema,
  refKind,
  retryQuestRequestSchema,
  stageSchema,
  toggleChecklistRequestSchema,
  updateQuestRequestSchema,
} from "../src/index.js";

/** A complete quest detail payload, including the M2 party/detail shapes. */
const questDetail = {
  id: 1,
  number: 12,
  title: "로그인 버그",
  stage: "dungeon",
  rank: "D",
  orderKey: "a0",
  tags: ["버그"],
  createdBy: { id: 7, displayName: "김철수" },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_500,
  pendingNominations: 1,
  projectId: 2,
  situation: "세션 만료 후 빈 화면",
  direction: "- [x] 로그인 재현\n- [ ] 세션 갱신",
  archiveReason: null,
  party: [
    {
      user: { id: 7, displayName: "김철수" },
      role: "leader",
      status: "fighting",
      retreatReason: null,
      joinedAt: 1_700_000_000_000,
    },
    {
      user: { id: 8, displayName: "이영희" },
      role: "member",
      status: "retreated",
      retreatReason: "담당자가 아님",
      joinedAt: 1_700_000_000_100,
    },
  ],
  nominations: [
    {
      id: 11,
      questId: 1,
      nominee: { id: 9, displayName: "박민수" },
      nominatedBy: { id: 7, displayName: "김철수" },
      kind: "nominate",
      state: "pending",
      passReason: null,
      createdAt: 1_700_000_000_200,
    },
  ],
  floors: { done: 1, total: 2 },
  bounty: {
    base: 40,
    multiplier: 1.2,
    total: 48,
    days: 1,
    dusty: false,
  },
  firstClaimedAt: 1_700_000_000_000,
};

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

  it("accepts fix/feature kinds on create and update", () => {
    expect(
      createQuestRequestSchema.parse({ title: "로그인 버그", kind: "feature" })
        .kind,
    ).toBe("feature");
    expect(
      createQuestRequestSchema.parse({ title: "로그인 버그" }).kind,
    ).toBeUndefined();
    expect(
      createQuestRequestSchema.safeParse({ title: "로그인 버그", kind: "chore" })
        .success,
    ).toBe(false);
    expect(updateQuestRequestSchema.parse({ kind: "fix" }).kind).toBe("fix");
  });
});

describe("notification and XP constants", () => {
  it("adds the clear_revoked notification type", () => {
    expect(NOTIFICATION_TYPES).toContain("clear_revoked");
  });

  it("adds the revoke XP reason while keeping the existing ones", () => {
    expect(XP_REASONS).toEqual(["clear", "requester", "guide", "revoke"]);
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
    party: [
      {
        userId: 7,
        displayName: "김철수",
        role: "leader",
        status: "fighting",
      },
    ],
    floors: { done: 1, total: 3 },
    pendingNominations: 2,
    bounty: {
      base: 40,
      multiplier: 1.2,
      total: 48,
      days: 1,
      dusty: false,
    },
  };

  it("has exactly the agreed fields", () => {
    expect(Object.keys(questSummarySchema.shape)).toEqual([
      "id",
      "number",
      "title",
      "stage",
      "kind",
      "rank",
      "orderKey",
      "tags",
      "createdBy",
      "createdAt",
      "updatedAt",
      "party",
      "floors",
      "pendingNominations",
      "bounty",
    ]);
  });

  it("parses a quest summary and fills the default kind", () => {
    const parsed = questSummarySchema.parse(summary);

    expect(parsed).toEqual({ ...summary, kind: "fix" });
    expect(Object.keys(parsed).filter((key) => key !== "kind")).toEqual(
      Object.keys(summary),
    );
  });

  it("accepts a rank and null", () => {
    expect(questSummarySchema.parse({ ...summary, rank: "S" }).rank).toBe("S");
    expect(questSummarySchema.parse({ ...summary, rank: null }).rank).toBeNull();
  });

  it("accepts exactly the known quest kinds and defaults to fix", () => {
    expect(questKindSchema.options).toEqual([...QUEST_KINDS]);
    expect([...QUEST_KINDS]).toEqual(["fix", "feature"]);
    expect(questSummarySchema.parse(summary).kind).toBe("fix");
    expect(
      questSummarySchema.parse({ ...summary, kind: "feature" }).kind,
    ).toBe("feature");
    expect(
      questSummarySchema.safeParse({ ...summary, kind: "chore" }).success,
    ).toBe(false);
  });

  it("serializes a legacy summary that has no kind yet", () => {
    // Fastify serializes responses with Zod's encode direction; the field is
    // optional there until the server sends it (parse still fills "fix").
    expect(questSummarySchema.encode(summary)).toEqual(summary);
  });

  it("rejects a summary with an invalid stage", () => {
    expect(
      questSummarySchema.safeParse({ ...summary, stage: "nowhere" }).success,
    ).toBe(false);
  });
});

describe("questSchema", () => {
  it("overrides the summary party with the detail shape", () => {
    const parsed = questSchema.parse(questDetail);

    expect(parsed).toEqual({ ...questDetail, kind: "fix", refs: [] });
    // PartyMember carries the full user ref, not the summary's flat fields.
    expect(parsed.party[0]?.user.displayName).toBe("김철수");
    expect(parsed.party[1]?.retreatReason).toBe("담당자가 아님");
    expect(parsed.floors).toEqual({ done: 1, total: 2 });
    expect(parsed.nominations[0]?.nominee.id).toBe(9);
    expect(parsed.firstClaimedAt).toBe(1_700_000_000_000);
  });

  /**
   * The server's party routes still answer through this schema with the
   * retired floor rows (`loadQuestView` returns an empty array), so the
   * deprecated branch stays parseable until that wrapper is removed.
   */
  it("still accepts the deprecated floor rows the party routes emit", () => {
    expect(questSchema.parse({ ...questDetail, floors: [] }).floors).toEqual(
      [],
    );

    const withRows = questSchema.parse({
      ...questDetail,
      floors: [
        {
          id: 5,
          title: "1층: 로그인 재현",
          orderKey: "a0",
          doneAt: null,
          doneBy: null,
        },
      ],
    });
    expect(withRows.floors).toHaveLength(1);

    expect(
      questSchema.safeParse({ ...questDetail, floors: [{ id: 5 }] }).success,
    ).toBe(false);
  });

  it("defaults kind and refs while accepting explicit values", () => {
    expect(questSchema.parse(questDetail).kind).toBe("fix");
    expect(questSchema.parse(questDetail).refs).toEqual([]);

    const ref = {
      id: 3,
      label: "설계 명세",
      target: "https://example.com/spec",
      kind: "url",
      createdBy: { id: 7, displayName: "김철수" },
      createdAt: 1_700_000_000_400,
    };
    const parsed = questSchema.parse({
      ...questDetail,
      kind: "feature",
      refs: [ref],
    });

    expect(parsed.kind).toBe("feature");
    expect(parsed.refs).toEqual([ref]);
  });

  it("requires firstClaimedAt and accepts null while unclaimed", () => {
    expect(
      questSchema.parse({ ...questDetail, firstClaimedAt: null })
        .firstClaimedAt,
    ).toBeNull();

    const { firstClaimedAt: _omitted, ...withoutFirstClaim } = questDetail;
    expect(questSchema.safeParse(withoutFirstClaim).success).toBe(false);
  });

  it("serializes a legacy detail that has no kind or refs yet", () => {
    expect(questSchema.encode(questDetail)).toEqual(questDetail);
  });

  it("keeps the summary fields and adds the detail-only ones", () => {
    for (const key of Object.keys(questSummarySchema.shape)) {
      expect(questSchema.shape).toHaveProperty(key);
    }
    for (const key of [
      "projectId",
      "situation",
      "direction",
      "archiveReason",
      "nominations",
      "refs",
      "firstClaimedAt",
    ]) {
      expect(questSchema.shape).toHaveProperty(key);
    }
  });
});

describe("quest refs, checklists and clear preview", () => {
  const userRef = { id: 7, displayName: "김철수" };

  it("classifies http(s) targets as urls and everything else as paths", () => {
    expect(refKind("https://example.com/spec")).toBe("url");
    expect(refKind("HTTP://Example.com/spec")).toBe("url");
    expect(refKind("  https://example.com/spec  ")).toBe("url");
    expect(refKind("docs/login.md")).toBe("path");
    expect(refKind("ftp://example.com/spec")).toBe("path");
    expect(refKind("")).toBe("path");
  });

  it("parses a reference document with a nullable label", () => {
    const ref = {
      id: 3,
      label: "설계 명세",
      target: "https://example.com/spec",
      kind: "url",
      createdBy: userRef,
      createdAt: 1_700_000_000_000,
    };

    expect(questRefSchema.parse(ref)).toEqual(ref);
    expect(questRefSchema.parse({ ...ref, label: null }).label).toBeNull();
    expect(questRefSchema.safeParse({ ...ref, kind: "ftp" }).success).toBe(
      false,
    );
  });

  it("validates reference creation input", () => {
    expect(
      createQuestRefRequestSchema.parse({ target: "  docs/a.md  " }),
    ).toEqual({ target: "docs/a.md" });
    expect(
      createQuestRefRequestSchema.parse({
        label: "  설계 명세  ",
        target: "https://example.com/spec",
      }),
    ).toEqual({ label: "설계 명세", target: "https://example.com/spec" });
    expect(
      createQuestRefRequestSchema.safeParse({ target: "   " }).success,
    ).toBe(false);
    expect(
      createQuestRefRequestSchema.safeParse({ target: "a".repeat(1000) })
        .success,
    ).toBe(true);
    expect(
      createQuestRefRequestSchema.safeParse({ target: "a".repeat(1001) })
        .success,
    ).toBe(false);
    expect(
      createQuestRefRequestSchema.safeParse({
        label: "가".repeat(101),
        target: "docs/a.md",
      }).success,
    ).toBe(false);
  });

  it("validates checklist toggle input", () => {
    expect(
      toggleChecklistRequestSchema.parse({ done: true, text: "- [ ] a" }),
    ).toEqual({ done: true, text: "- [ ] a" });
    expect(toggleChecklistRequestSchema.safeParse({ done: true }).success).toBe(
      false,
    );
    expect(
      toggleChecklistRequestSchema.safeParse({ done: "yes", text: "" }).success,
    ).toBe(false);
  });

  it("caps checklist appends at 50 titles of 200 characters", () => {
    // Blank titles pass validation and are dropped by appendChecklistItems.
    expect(
      appendChecklistRequestSchema.parse({ titles: ["  할 일  ", "   "] }),
    ).toEqual({ titles: ["  할 일  ", "   "] });
    expect(
      appendChecklistRequestSchema.safeParse({
        titles: Array.from({ length: 50 }, (_, index) => `${index}번`),
      }).success,
    ).toBe(true);
    expect(
      appendChecklistRequestSchema.safeParse({
        titles: Array.from({ length: 51 }, (_, index) => `${index}번`),
      }).success,
    ).toBe(false);
    expect(
      appendChecklistRequestSchema.safeParse({ titles: [] }).success,
    ).toBe(false);
    expect(
      appendChecklistRequestSchema.safeParse({ titles: ["가".repeat(201)] })
        .success,
    ).toBe(false);
  });

  it("parses the clear preview with and without a requester bonus", () => {
    const preview = {
      total: 96,
      rewards: [{ user: userRef, amount: 48 }],
      requesterBonus: { user: { id: 8, displayName: "이영희" }, amount: 5 },
      actorIsInvolved: true,
    };

    expect(clearPreviewResponseSchema.parse(preview)).toEqual(preview);
    expect(
      clearPreviewResponseSchema.parse({ ...preview, requesterBonus: null })
        .requesterBonus,
    ).toBeNull();
    expect(
      clearPreviewResponseSchema.safeParse({ ...preview, total: 1.5 }).success,
    ).toBe(false);
    expect(
      clearPreviewResponseSchema.safeParse({
        ...preview,
        actorIsInvolved: "yes",
      }).success,
    ).toBe(false);
  });
});

describe("nomination and notification schemas", () => {
  const ref = { id: 3, displayName: "박민수" };

  it("parses a nomination with an optional pass reason", () => {
    const nomination = {
      id: 11,
      questId: 12,
      nominee: ref,
      nominatedBy: { id: 7, displayName: "김철수" },
      kind: "nominate",
      state: "pending",
      passReason: null,
      createdAt: 1_700_000_000_000,
    };

    expect(nominationSchema.parse(nomination)).toEqual(nomination);
    expect(
      nominationSchema.safeParse({ ...nomination, kind: "assign" }).success,
    ).toBe(false);
    expect(
      nominationSchema.safeParse({ ...nomination, state: "expired" }).success,
    ).toBe(false);
  });

  it("carries the quest number and title on my nominations", () => {
    const parsed = myNominationSchema.parse({
      id: 11,
      questId: 12,
      nominee: ref,
      nominatedBy: { id: 7, displayName: "김철수" },
      kind: "relay",
      state: "pending",
      passReason: "내 영역 아님",
      createdAt: 1_700_000_000_000,
      questNumber: 283,
      questTitle: "로그인 버그",
    });

    expect(parsed.questNumber).toBe(283);
    expect(parsed.questTitle).toBe("로그인 버그");
  });

  it("allows notification quest references to be null", () => {
    const parsed = notificationSchema.parse({
      id: 1,
      projectId: 2,
      questId: null,
      questNumber: null,
      questTitle: null,
      type: "boss_engaged",
      actor: null,
      payload: {},
      createdAt: 1_700_000_000_000,
      readAt: null,
    });

    expect(parsed.questId).toBeNull();
    expect(parsed.readAt).toBeNull();
  });

  it("accepts the F1 clear_revoked notification at runtime", () => {
    expect(notificationTypeSchema.parse("clear_revoked")).toBe("clear_revoked");

    const parsed = notificationSchema.parse({
      id: 2,
      projectId: 2,
      questId: 12,
      questNumber: 12,
      questTitle: "로그인 버그",
      type: "clear_revoked",
      actor: ref,
      payload: { xpRevoked: 48 },
      createdAt: 1_700_000_000_000,
      readAt: null,
    });

    expect(parsed.type).toBe("clear_revoked");
    expect(parsed.payload).toEqual({ xpRevoked: 48 });
  });
});

describe("party request schemas", () => {
  it("limits nominations to 1-10 users", () => {
    expect(nominateRequestSchema.safeParse({ userIds: [1] }).success).toBe(true);
    expect(
      nominateRequestSchema.safeParse({
        userIds: Array.from({ length: 10 }, (_, index) => index + 1),
      }).success,
    ).toBe(true);
    expect(nominateRequestSchema.safeParse({ userIds: [] }).success).toBe(false);
    expect(
      nominateRequestSchema.safeParse({
        userIds: Array.from({ length: 11 }, (_, index) => index + 1),
      }).success,
    ).toBe(false);
  });

  it("keeps pass reasons within 100 characters", () => {
    expect(passNominationRequestSchema.safeParse({}).success).toBe(true);
    expect(
      passNominationRequestSchema.safeParse({ reason: "가".repeat(100) })
        .success,
    ).toBe(true);
    expect(
      passNominationRequestSchema.safeParse({ reason: "가".repeat(101) })
        .success,
    ).toBe(false);
    expect(passNominationRequestSchema.parse({ relayToUserId: 9 })).toEqual({
      relayToUserId: 9,
    });
  });

  it("keeps leave reasons within 100 characters", () => {
    expect(leavePartyRequestSchema.safeParse({}).success).toBe(true);
    expect(
      leavePartyRequestSchema.safeParse({ reason: "가".repeat(100) }).success,
    ).toBe(true);
    expect(
      leavePartyRequestSchema.safeParse({ reason: "가".repeat(101) }).success,
    ).toBe(false);
  });

  it("only accepts the active member statuses", () => {
    for (const status of ["joined", "fighting", "done"]) {
      expect(memberStatusRequestSchema.safeParse({ status }).success).toBe(true);
    }
    expect(
      memberStatusRequestSchema.safeParse({ status: "retreated" }).success,
    ).toBe(false);
  });

  it("requires a 1-500 character retry comment", () => {
    expect(
      retryQuestRequestSchema.safeParse({ comment: "다시 확인 바람" }).success,
    ).toBe(true);
    expect(retryQuestRequestSchema.safeParse({ comment: "   " }).success).toBe(
      false,
    );
    expect(
      retryQuestRequestSchema.safeParse({ comment: "가".repeat(501) }).success,
    ).toBe(false);
  });
});

describe("readNotificationsRequestSchema", () => {
  it("accepts explicit ids or a read-all flag", () => {
    expect(readNotificationsRequestSchema.safeParse({}).success).toBe(true);
    expect(
      readNotificationsRequestSchema.safeParse({ ids: [1, 2] }).success,
    ).toBe(true);
    expect(readNotificationsRequestSchema.safeParse({ all: true }).success).toBe(
      true,
    );
    expect(
      readNotificationsRequestSchema.safeParse({ ids: ["1"] }).success,
    ).toBe(false);
  });
});

describe("notificationListQuerySchema", () => {
  it("defaults the limit to 50 and coerces numeric strings", () => {
    expect(notificationListQuerySchema.parse({}).limit).toBe(50);
    expect(notificationListQuerySchema.parse({ limit: "20" }).limit).toBe(20);
  });

  it("rejects limits outside 1-100 and unknown unread values", () => {
    expect(notificationListQuerySchema.safeParse({ limit: "0" }).success).toBe(
      false,
    );
    expect(notificationListQuerySchema.safeParse({ limit: "101" }).success).toBe(
      false,
    );
    expect(
      notificationListQuerySchema.safeParse({ unread: "true" }).success,
    ).toBe(false);
    expect(notificationListQuerySchema.safeParse({ unread: "1" }).success).toBe(
      true,
    );
  });
});

describe("action response schemas", () => {
  it("wraps created nominations", () => {
    const nominations = [questDetail.nominations[0]!];

    expect(
      nominationListResponseSchema.parse({ nominations }),
    ).toEqual({ nominations });
    expect(nominationListResponseSchema.safeParse({}).success).toBe(false);
  });

  it("returns the cleared quest, per-member rewards and level ups", () => {
    const parsed = clearQuestResponseSchema.parse({
      quest: questDetail,
      rewards: [{ userId: 7, amount: 48 }],
      levelUps: [{ userId: 7, from: 2, to: 3 }],
    });

    expect(parsed.quest.stage).toBe("dungeon");
    expect(parsed.rewards).toEqual([{ userId: 7, amount: 48 }]);
    expect(parsed.levelUps).toEqual([{ userId: 7, from: 2, to: 3 }]);
  });

  it("returns notification items with the unread count", () => {
    const item = {
      id: 1,
      projectId: 2,
      questId: 1,
      questNumber: 12,
      questTitle: "로그인 버그",
      type: "nominated",
      actor: { id: 7, displayName: "김철수" },
      payload: { userIds: [9], names: ["박민수"] },
      createdAt: 1_700_000_000_000,
      readAt: null,
    };

    expect(
      notificationListResponseSchema.parse({ items: [item], unreadCount: 1 }),
    ).toEqual({ items: [item], unreadCount: 1 });
    expect(
      notificationListResponseSchema.safeParse({ items: [] }).success,
    ).toBe(false);
  });

  it("returns my pending nominations", () => {
    const mine = {
      ...questDetail.nominations[0]!,
      questNumber: 12,
      questTitle: "로그인 버그",
    };
    expect(myNominationsResponseSchema.parse([mine])).toEqual([mine]);
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
      questEventSchema.safeParse({ ...event, type: "quest_danced" }).success,
    ).toBe(false);
  });

  it("accepts the M2 party and boss event types", () => {
    for (const type of [
      "nominated",
      "reinforcement_requested",
      "claimed",
      "passed",
      "relayed",
      "member_joined",
      "member_left",
      "member_status_changed",
      "leader_changed",
      "floor_added",
      "floor_checked",
      "boss_engaged",
      "retry_requested",
      "quest_cleared",
    ]) {
      expect(questEventSchema.safeParse({ ...event, type }).success).toBe(true);
    }
  });

  it("accepts the F1 reference and revoke event types", () => {
    for (const type of ["ref_added", "ref_removed", "clear_revoked"]) {
      expect(questEventSchema.safeParse({ ...event, type }).success).toBe(true);
    }
  });

  it("parses an event list response", () => {
    expect(questEventsResponseSchema.parse([event])).toEqual([event]);
  });
});
