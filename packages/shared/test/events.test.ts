import { describe, expect, it } from "vitest";

import {
  KEY_EVENT_TYPES,
  MEMBER_STATUS_LABELS,
  QUEST_EVENT_TYPES,
  isKeyEvent,
  renderEvent,
  type EventRenderContext,
  type QuestEvent,
} from "../src/index.js";

const actor = { id: 7, displayName: "김철수" };

function makeEvent(overrides: Partial<QuestEvent> = {}): QuestEvent {
  return {
    id: 1,
    questId: 12,
    projectId: 1,
    type: "quest_posted",
    payload: { number: 12, title: "로그인 버그" },
    actor,
    familiarId: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function sentence(segments: ReturnType<typeof renderEvent>): string {
  return segments.map((segment) => segment.text).join("");
}

describe("renderEvent", () => {
  it("renders a posted quest", () => {
    const segments = renderEvent(makeEvent());

    expect(sentence(segments)).toBe(
      "'김철수' 가 의뢰 #12 '로그인 버그' 를 게시판에 붙였습니다.",
    );
    expect(segments.map((segment) => segment.kind)).toEqual([
      "actor",
      "text",
      "quest",
      "text",
      "stage",
      "text",
    ]);
    expect(segments[2]?.text).toBe("'로그인 버그'");
    expect(segments[4]?.text).toBe("게시판");
  });

  it("renders a moved quest", () => {
    const segments = renderEvent(
      makeEvent({
        type: "quest_moved",
        payload: { from: "board", to: "dungeon" },
      }),
    );

    expect(sentence(segments)).toBe(
      "'김철수' 가 의뢰를 '던전 진행' 으로 옮겼습니다.",
    );
    expect(segments.map((segment) => segment.kind)).toEqual([
      "actor",
      "text",
      "stage",
      "text",
    ]);
    expect(segments[2]?.text).toBe("'던전 진행'");
  });

  it("renders an edited quest with field labels in payload order", () => {
    const segments = renderEvent(
      makeEvent({
        type: "quest_edited",
        payload: { fields: ["situation", "tags"] },
      }),
    );

    expect(sentence(segments)).toBe(
      "'김철수' 가 의뢰 내용을 고쳤습니다 (현재 상황, 태그).",
    );
    expect(segments.map((segment) => segment.kind)).toEqual([
      "actor",
      "text",
    ]);
  });

  it("maps every editable field to its Korean label", () => {
    const segments = renderEvent(
      makeEvent({
        type: "quest_edited",
        payload: {
          fields: ["title", "situation", "direction", "tags", "rank", "kind"],
        },
      }),
    );

    expect(sentence(segments)).toBe(
      "'김철수' 가 의뢰 내용을 고쳤습니다 (제목, 현재 상황, 수정 방향, 태그, 등급, 종류).",
    );
  });

  it("renders an archived quest", () => {
    const segments = renderEvent(
      makeEvent({ type: "quest_archived", payload: { reason: "dropped" } }),
    );

    expect(sentence(segments)).toBe("'김철수' 가 의뢰를 내렸습니다.");
    expect(segments.map((segment) => segment.kind)).toEqual([
      "actor",
      "text",
    ]);
  });

  it("renders an unknown actor as the fallback identity", () => {
    const segments = renderEvent(
      makeEvent({ type: "quest_archived", payload: {}, actor: null }),
    );

    expect(segments[0]).toEqual({
      kind: "actor",
      text: "'알 수 없는 모험가'",
    });
    expect(sentence(segments)).toBe("'알 수 없는 모험가' 가 의뢰를 내렸습니다.");
  });

  it("renders a familiar actor with its name", () => {
    const context: EventRenderContext = {
      familiar: (familiarId) =>
        familiarId === 3 ? { name: "아르고", seq: 3 } : undefined,
    };
    const segments = renderEvent(
      makeEvent({
        type: "quest_archived",
        payload: {},
        familiarId: 3,
      }),
      context,
    );

    expect(segments[0]).toEqual({
      kind: "actor",
      text: "'김철수' 의 소환수 '아르고'",
    });
    expect(sentence(segments)).toBe(
      "'김철수' 의 소환수 '아르고' 가 의뢰를 내렸습니다.",
    );
  });

  it("falls back to the familiar sequence number", () => {
    const segments = renderEvent(
      makeEvent({
        type: "quest_archived",
        payload: {},
        familiarId: 3,
      }),
      { familiar: () => ({ seq: 7 }) },
    );

    expect(segments[0]?.text).toBe("'김철수' 의 소환수 '#7'");
  });

  it("falls back to the familiar id when no context is available", () => {
    const segments = renderEvent(
      makeEvent({
        type: "quest_archived",
        payload: {},
        familiarId: 9,
      }),
    );

    expect(segments[0]?.text).toBe("'김철수' 의 소환수 '#9'");
  });

  it("renders an auto move without an actor", () => {
    const segments = renderEvent(
      makeEvent({
        type: "quest_moved",
        payload: { from: "dungeon", to: "boss", auto: true },
      }),
    );

    expect(sentence(segments)).toBe("의뢰가 '보스전' 으로 이동했습니다.");
    expect(segments.map((segment) => segment.kind)).toEqual([
      "text",
      "stage",
      "text",
    ]);
  });

  it("renders a manual move with an actor even when auto is false", () => {
    const segments = renderEvent(
      makeEvent({
        type: "quest_moved",
        payload: { from: "board", to: "dungeon", auto: false },
      }),
    );

    expect(sentence(segments)).toBe(
      "'김철수' 가 의뢰를 '던전 진행' 으로 옮겼습니다.",
    );
  });

  it("renders a nomination with every nominee", () => {
    const segments = renderEvent(
      makeEvent({
        type: "nominated",
        payload: { userIds: [2, 3], names: ["이영희", "박민수"] },
      }),
    );

    expect(sentence(segments)).toBe(
      "'김철수' 가 '이영희', '박민수' 를 지목했습니다.",
    );
    expect(segments.map((segment) => segment.kind)).toEqual([
      "actor",
      "text",
    ]);
  });

  it("renders a reinforcement request", () => {
    const segments = renderEvent(
      makeEvent({
        type: "reinforcement_requested",
        payload: { userIds: [3], names: ["박민수"] },
      }),
    );

    expect(sentence(segments)).toBe(
      "'김철수' 가 '박민수' 에게 증원을 요청했습니다.",
    );
  });

  it("renders a claim", () => {
    expect(sentence(renderEvent(makeEvent({ type: "claimed", payload: {} }))))
      .toBe("'김철수' 가 의뢰를 수락하고 파티에 합류했습니다.");
  });

  it("renders a pass with and without a reason", () => {
    const withReason = renderEvent(
      makeEvent({ type: "passed", payload: { reason: "내 영역 아님" } }),
    );
    const withoutReason = renderEvent(
      makeEvent({ type: "passed", payload: { reason: null } }),
    );

    expect(sentence(withReason)).toBe(
      "'김철수' 가 지목을 넘겼습니다: 내 영역 아님",
    );
    expect(sentence(withoutReason)).toBe("'김철수' 가 지목을 넘겼습니다");
  });

  it("renders a relay with the target name", () => {
    const segments = renderEvent(
      makeEvent({
        type: "relayed",
        payload: { toUserId: 4, toName: "최지훈", reason: "내 영역 아님" },
      }),
    );

    expect(sentence(segments)).toBe(
      "'김철수' 가 '최지훈' 에게 의뢰를 토스했습니다.",
    );
  });

  it("renders a member joining", () => {
    expect(
      sentence(renderEvent(makeEvent({ type: "member_joined", payload: {} }))),
    ).toBe("'김철수' 가 파티에 참여했습니다.");
  });

  it("renders a member leaving with and without a reason", () => {
    expect(
      sentence(
        renderEvent(
          makeEvent({
            type: "member_left",
            payload: { reason: "담당자가 아님" },
          }),
        ),
      ),
    ).toBe("'김철수' 가 파티에서 나갔습니다: 담당자가 아님");

    expect(
      sentence(
        renderEvent(makeEvent({ type: "member_left", payload: { reason: null } })),
      ),
    ).toBe("'김철수' 가 파티에서 나갔습니다");
  });

  it("renders a status change with its Korean label", () => {
    const segments = renderEvent(
      makeEvent({
        type: "member_status_changed",
        payload: { from: "joined", to: "fighting" },
      }),
    );

    expect(sentence(segments)).toBe(
      "'김철수' 가 공략 상태를 '전투중' 으로 변경했습니다.",
    );
    expect(MEMBER_STATUS_LABELS.done).toBe("전투 완료");
    expect(MEMBER_STATUS_LABELS.retreated).toBe("후퇴");
  });

  it("renders a leader change using the new leader from the payload", () => {
    // The actor (the member whose leave triggered the promotion) differs from
    // the new leader on purpose, proving `payload.name` is what gets rendered.
    const segments = renderEvent(
      makeEvent({
        type: "leader_changed",
        payload: { userId: 4, name: "최지훈" },
        actor: { id: 9, displayName: "박민수" },
      }),
    );

    expect(sentence(segments)).toBe("'최지훈' 가 새 파티장이 되었습니다.");
    expect(segments.map((segment) => segment.kind)).toEqual([
      "actor",
      "text",
    ]);
    expect(segments[0]).toEqual({ kind: "actor", text: "'최지훈'" });
  });

  it("renders a leader change even without an actor", () => {
    expect(
      sentence(
        renderEvent(
          makeEvent({
            type: "leader_changed",
            payload: { userId: 4, name: "최지훈" },
            actor: null,
          }),
        ),
      ),
    ).toBe("'최지훈' 가 새 파티장이 되었습니다.");
  });

  it("renders a floor being added", () => {
    expect(
      sentence(
        renderEvent(
          makeEvent({
            type: "floor_added",
            payload: { floorId: 5, title: "3층: API 수정" },
          }),
        ),
      ),
    ).toBe("'김철수' 가 '3층: API 수정' 을 추가했습니다.");
  });

  it("renders a checklist item being cleared and reopened", () => {
    const cleared = renderEvent(
      makeEvent({
        type: "floor_checked",
        payload: { text: "3층: API 수정", done: true },
      }),
    );
    const reopened = renderEvent(
      makeEvent({
        type: "floor_checked",
        payload: { text: "3층: API 수정", done: false },
      }),
    );

    expect(sentence(cleared)).toBe(
      "'김철수' 가 '3층: API 수정' 을 돌파했습니다.",
    );
    expect(sentence(reopened)).toBe(
      "'김철수' 가 '3층: API 수정' 을 다시 열었습니다.",
    );
  });

  it("renders a reference document being added", () => {
    const labelled = renderEvent(
      makeEvent({
        type: "ref_added",
        payload: {
          refId: 4,
          target: "https://example.com/spec",
          label: "설계 명세",
        },
      }),
    );
    const unlabelled = renderEvent(
      makeEvent({
        type: "ref_added",
        payload: {
          refId: 5,
          target: "docs/login.md",
          label: null,
        },
      }),
    );

    expect(sentence(labelled)).toBe(
      "'김철수' 가 참고 문서 '설계 명세' 를 추가했습니다.",
    );
    expect(sentence(unlabelled)).toBe(
      "'김철수' 가 참고 문서 'docs/login.md' 를 추가했습니다.",
    );
    expect(labelled.map((segment) => segment.kind)).toEqual([
      "actor",
      "text",
    ]);
  });

  it("renders a reference document being removed", () => {
    const labelled = renderEvent(
      makeEvent({
        type: "ref_removed",
        payload: { target: "https://example.com/spec", label: "설계 명세" },
      }),
    );
    const unlabelled = renderEvent(
      makeEvent({
        type: "ref_removed",
        payload: { target: "docs/login.md", label: null },
      }),
    );

    expect(sentence(labelled)).toBe(
      "'김철수' 가 참고 문서 '설계 명세' 를 삭제했습니다.",
    );
    expect(sentence(unlabelled)).toBe(
      "'김철수' 가 참고 문서 'docs/login.md' 를 삭제했습니다.",
    );
  });

  it("renders boss engagement without an actor segment", () => {
    const segments = renderEvent(
      makeEvent({ type: "boss_engaged", payload: {}, actor: null }),
    );

    expect(segments).toEqual([
      {
        kind: "text",
        text: "파티원 모두 전투를 마쳤습니다. 보스전이 시작됩니다!",
      },
    ]);
  });

  it("renders a retry request with its comment", () => {
    expect(
      sentence(
        renderEvent(
          makeEvent({
            type: "retry_requested",
            payload: { comment: "그대로임, 다시 확인 바람" },
          }),
        ),
      ),
    ).toBe("'김철수' 가 재도전을 요청했습니다: 그대로임, 다시 확인 바람");
  });

  it("renders a clear with the per-member rewards", () => {
    const segments = renderEvent(
      makeEvent({
        type: "quest_cleared",
        payload: {
          rewards: [
            { userId: 2, name: "이영희", amount: 48 },
            { userId: 3, name: "최지훈", amount: 48 },
          ],
          bounty: { base: 40, multiplier: 1.2, total: 96, days: 1, dusty: false },
        },
      }),
    );

    expect(sentence(segments)).toBe(
      "'김철수' 가 던전 클리어를 선언했습니다! (이영희 +48, 최지훈 +48)",
    );
    expect(segments.map((segment) => segment.kind)).toEqual([
      "actor",
      "text",
    ]);
  });

  it("omits the reward list when the party was empty", () => {
    const segments = renderEvent(
      makeEvent({
        type: "quest_cleared",
        payload: {
          rewards: [],
          bounty: { base: 40, multiplier: 2, total: 80, days: 5, dusty: true },
        },
      }),
    );

    expect(sentence(segments)).toBe("'김철수' 가 던전 클리어를 선언했습니다!");
  });

  it("renders a revoked clear with the recovered XP", () => {
    const segments = renderEvent(
      makeEvent({
        type: "clear_revoked",
        payload: { xpRevoked: 48 },
      }),
    );

    expect(sentence(segments)).toBe(
      "'김철수' 가 던전 클리어를 취소했습니다. (XP 48 회수)",
    );
    expect(segments.map((segment) => segment.kind)).toEqual([
      "actor",
      "text",
    ]);
  });

  it("returns a safe text segment for malformed payloads", () => {
    const segments = renderEvent(
      makeEvent({
        type: "quest_moved",
        payload: { from: "nowhere", to: "dungeon" },
      }),
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe("text");
    expect(segments[0]?.text.length).toBeGreaterThan(0);
  });

  it("returns a safe text segment for unknown event types", () => {
    const event = {
      ...makeEvent(),
      type: "quest_danced",
    } as unknown as QuestEvent;

    expect(() => renderEvent(event)).not.toThrow();
    expect(renderEvent(event)[0]?.kind).toBe("text");
  });
});

describe("isKeyEvent", () => {
  it("publishes the F1 event types in QUEST_EVENT_TYPES", () => {
    expect(QUEST_EVENT_TYPES).toEqual(
      expect.arrayContaining(["ref_added", "ref_removed", "clear_revoked"]),
    );
  });

  it("flags exactly the guild-wide notification events", () => {
    expect([...KEY_EVENT_TYPES]).toEqual([
      "quest_posted",
      "member_joined",
      "member_left",
      "boss_engaged",
      "retry_requested",
      "quest_cleared",
      "clear_revoked",
    ]);

    for (const type of KEY_EVENT_TYPES) {
      expect(isKeyEvent(type)).toBe(true);
    }
  });

  it("keeps checklist and reference edits out of the key events", () => {
    for (const type of [
      "ref_added",
      "ref_removed",
      "floor_checked",
      "floor_added",
      "quest_edited",
    ]) {
      expect(isKeyEvent(type)).toBe(false);
    }
    expect(isKeyEvent("quest_danced")).toBe(false);
    expect(isKeyEvent("")).toBe(false);
  });

  it("only flags types that exist in QUEST_EVENT_TYPES", () => {
    const known = new Set<string>(QUEST_EVENT_TYPES);
    for (const type of KEY_EVENT_TYPES) {
      expect(known.has(type)).toBe(true);
    }
  });
});
