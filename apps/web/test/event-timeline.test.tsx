// @vitest-environment node
/**
 * Adventure-log contract (M2b T05).
 *
 * The party chat now carries the key events, so the drawer's 모험 기록 keeps
 * only its heading and the "전체 기록 보기 (N)" toggle until the adventurer asks
 * for the history. Expanding lists every recorded event in chronological order
 * (key or not); collapsing hides them again. With no events only the heading
 * remains — there is no collapsed "최근 핵심 3건" list or empty note anymore.
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
import { formatKoreanDateTime } from "../src/lib/format";

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

describe("EventTimeline", () => {
  it("keeps only the heading when no event exists", () => {
    const view = render(<EventTimeline events={[]} />);

    expect(
      view.getByRole("heading", { name: ko.board.drawer.history }),
    ).toBeInTheDocument();
    expect(view.container.querySelectorAll("[data-event-id]")).toHaveLength(0);
    expect(view.queryByRole("button")).toBeNull();
    expect(
      view.queryByText("아직 큰 사건은 없습니다"),
    ).toBeNull();

    view.rerender(<EventTimeline events={undefined} />);
    expect(view.queryByRole("button")).toBeNull();
    expect(view.container.querySelectorAll("[data-event-id]")).toHaveLength(0);
  });

  it("shows only the toggle until expanded, then lists every event in order", async () => {
    const user = userEvent.setup();
    const events = [
      makeEvent(1, "quest_posted", { number: 12, title: "로그인 버그" }),
      makeEvent(2, "quest_edited", { fields: ["tags"] }),
      makeEvent(3, "ref_added", {
        refId: 4,
        target: "docs/login.md",
        label: null,
      }),
    ];
    const view = render(<EventTimeline events={events} />);

    // Collapsed: heading + toggle only; no recent key events and no note.
    expect(eventIds(view.container)).toEqual([]);
    expect(
      view.queryByText("아직 큰 사건은 없습니다"),
    ).toBeNull();

    const toggle = view.getByRole("button", {
      name: ko.board.drawer.showAllHistory(events.length),
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(eventIds(view.container)).toEqual([1, 2, 3]);
    // Key and non-key events are rendered exactly like the old expanded state:
    // one bordered row each with its full timestamp and styled segments.
    for (const event of events) {
      expect(
        view.getByText(formatKoreanDateTime(event.createdAt)),
      ).toBeInTheDocument();
    }
    const first = view.container.querySelector<HTMLElement>(
      "[data-event-id='1']",
    );
    expect(first?.querySelectorAll("[data-segment]").length).toBeGreaterThan(0);
    expect(first?.querySelector("img")).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(eventIds(view.container)).toEqual([]);
  });

  it("renders both checklist and legacy floor_checked payloads when expanded", async () => {
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

    await user.click(
      view.getByRole("button", {
        name: ko.board.drawer.showAllHistory(events.length),
      }),
    );

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
