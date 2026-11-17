// @vitest-environment node
/**
 * Adventure-log collapse rules (F1 T08).
 *
 * The drawer's 모험 기록 starts collapsed to the three latest key events. With
 * no key event at all the collapsed view says 아직 큰 사건은 없습니다; opening
 * "전체 기록 보기" must replace that note with every recorded event (key or
 * not), so the copy can never sit above a full list.
 *
 * `QuestEvent["type"]` is also pinned to the shared union here: assigning it to
 * `QuestEventType` only compiles while the response schema exports the real
 * enum instead of a widened `string`.
 *
 * As in the other DOM tests, jsdom is installed manually because Vitest cannot
 * resolve the workspace-local copy from the hoisted runner.
 */
import "./domEnvironment";

import type { QuestEvent, QuestEventType } from "@guildloom/shared";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { EventTimeline } from "../src/components/quest/EventTimeline";
import { ko } from "../src/i18n/ko";

const ACTOR = { id: 7, displayName: "김모험" };

/** F1 event types that must stay part of the response union. */
const F1_EVENT_TYPES = ["ref_added", "ref_removed", "clear_revoked"] as const;

/**
 * Compile-time guard for the shared contract. If `questEventSchema` widens the
 * response `type` back to `string`, this return no longer typechecks.
 */
function asQuestEventType(type: QuestEvent["type"]): QuestEventType {
  return type;
}

function makeEvent(
  id: number,
  type: QuestEvent["type"],
  payload: unknown,
): QuestEvent {
  return {
    id,
    questId: 1,
    projectId: 1,
    type,
    payload,
    actor: ACTOR,
    familiarId: null,
    createdAt: Date.UTC(2026, 0, 2, 3, 0, 0) + id * 60_000,
  };
}

function eventIds(container: HTMLElement): number[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-event-id]"),
  ).map((row) => Number(row.dataset.eventId));
}

afterEach(() => {
  cleanup();
});

describe("EventTimeline collapse", () => {
  it("shows the empty key-event note only while collapsed", async () => {
    const user = userEvent.setup();
    const events = [
      makeEvent(1, "quest_edited", { fields: ["tags"] }),
      makeEvent(2, "quest_moved", { from: "board", to: "dungeon" }),
    ];
    const view = render(<EventTimeline events={events} />);

    expect(view.getByText(ko.board.drawer.keyEventsEmpty)).toBeInTheDocument();
    expect(eventIds(view.container)).toEqual([]);

    await user.click(
      view.getByRole("button", {
        name: ko.board.drawer.showAllHistory(events.length),
      }),
    );

    expect(view.queryByText(ko.board.drawer.keyEventsEmpty)).toBeNull();
    expect(eventIds(view.container)).toEqual([1, 2]);
  });

  it("lists only key events while collapsed and every event once expanded", async () => {
    const user = userEvent.setup();
    const events = [
      makeEvent(1, "quest_edited", { fields: ["tags"] }),
      makeEvent(2, "quest_posted", { number: 12, title: "로그인 버그" }),
      makeEvent(3, "ref_added", {
        refId: 4,
        target: "docs/login.md",
        label: null,
      }),
    ];
    const view = render(<EventTimeline events={events} />);

    expect(view.queryByText(ko.board.drawer.keyEventsEmpty)).toBeNull();
    expect(eventIds(view.container)).toEqual([2]);

    await user.click(
      view.getByRole("button", {
        name: ko.board.drawer.showAllHistory(events.length),
      }),
    );

    expect(view.queryByText(ko.board.drawer.keyEventsEmpty)).toBeNull();
    expect(eventIds(view.container)).toEqual([1, 2, 3]);
  });

  it("renders both checklist and legacy floor_checked payloads", async () => {
    const user = userEvent.setup();
    const events = [
      makeEvent(1, "floor_checked", { text: "재현 확인", done: true }),
      makeEvent(2, "floor_checked", {
        floorId: 5,
        title: "3층: API 수정",
        done: false,
      }),
    ];
    const view = render(<EventTimeline events={events} />);

    // Both are non-key events, so the collapsed log stays empty.
    expect(view.getByText(ko.board.drawer.keyEventsEmpty)).toBeInTheDocument();

    await user.click(
      view.getByRole("button", {
        name: ko.board.drawer.showAllHistory(events.length),
      }),
    );

    expect(view.queryByText(ko.board.drawer.keyEventsEmpty)).toBeNull();
    expect(view.container).toHaveTextContent(
      "'김모험' 가 '재현 확인' 을 돌파했습니다.",
    );
    expect(view.container).toHaveTextContent(
      "'김모험' 가 '3층: API 수정' 을 다시 열었습니다.",
    );
  });

  it("keeps the shared response event type a real union", () => {
    for (const type of F1_EVENT_TYPES) {
      expect(asQuestEventType(type)).toBe(type);
    }
  });
});
