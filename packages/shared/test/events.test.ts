import { describe, expect, it } from "vitest";

import {
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
        payload: { fields: ["title", "situation", "direction", "tags", "rank"] },
      }),
    );

    expect(sentence(segments)).toBe(
      "'김철수' 가 의뢰 내용을 고쳤습니다 (제목, 현재 상황, 수정 방향, 태그, 등급).",
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
      type: "quest_cleared",
    } as unknown as QuestEvent;

    expect(() => renderEvent(event)).not.toThrow();
    expect(renderEvent(event)[0]?.kind).toBe("text");
  });
});
