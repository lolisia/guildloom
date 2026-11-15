import { describe, expect, it } from "vitest";

import {
  appendChecklistItems,
  parseChecklist,
  setChecklistItem,
} from "../src/index.js";

describe("parseChecklist", () => {
  it("parses dash bullets, indentation and checked boxes", () => {
    const text = [
      "# 로그인 버그",
      "- [ ] 재현 절차 확인",
      "  - [x] 세션 만료 재현",
      "* [X] 콘솔 오류 수집",
      "메모: 아직 조사 중",
    ].join("\n");

    expect(parseChecklist(text)).toEqual({
      items: [
        {
          index: 0,
          line: 1,
          text: "재현 절차 확인",
          done: false,
        },
        {
          index: 1,
          line: 2,
          text: "세션 만료 재현",
          done: true,
        },
        {
          index: 2,
          line: 3,
          text: "콘솔 오류 수집",
          done: true,
        },
      ],
      done: 2,
      total: 3,
    });
  });

  it("handles CRLF documents without leaking carriage returns", () => {
    const text =
      "소개\r\n- [x] 완료된 항목\r\n  - [ ] 남은 항목\r\n마무리\r\n";

    expect(parseChecklist(text)).toEqual({
      items: [
        {
          index: 0,
          line: 1,
          text: "완료된 항목",
          done: true,
        },
        {
          index: 1,
          line: 2,
          text: "남은 항목",
          done: false,
        },
      ],
      done: 1,
      total: 2,
    });
  });

  it("ignores lines that only look like checklist items", () => {
    const text = [
      "- [] 대괄호만",
      "-[ ] 대괄호 앞 공백 없음",
      "- [ ]",
      "- [ ] ",
      "1. [ ] 번호 목록",
      "> - [ ] 인용문",
      "- [ ]- 제목 없음",
      "+ [ ] 플러스 글머리",
      "- [ ]-",
    ].join("\n");

    expect(parseChecklist(text)).toEqual({ items: [], done: 0, total: 0 });
  });

  it("returns an empty summary for text without checklists", () => {
    expect(parseChecklist("")).toEqual({ items: [], done: 0, total: 0 });
    expect(parseChecklist("그냥 메모")).toEqual({
      items: [],
      done: 0,
      total: 0,
    });
  });
});

describe("setChecklistItem", () => {
  it("checks an item and leaves every other line untouched", () => {
    const text = "a\n- [ ] one\nb\n- [x] two\n";
    const updated = setChecklistItem(text, 0, true);

    expect(updated).toBe("a\n- [x] one\nb\n- [x] two\n");
  });

  it("unchecks an uppercase X marker", () => {
    const text = "- [X] one\n";
    expect(setChecklistItem(text, 0, false)).toBe("- [ ] one\n");
  });

  it("preserves CRLF line endings and indentation", () => {
    const text = "a\r\n* [x] one\r\nb\r\n  - [ ] two\r\n";
    const updated = setChecklistItem(text, 1, true);

    expect(updated).toBe("a\r\n* [x] one\r\nb\r\n  - [x] two\r\n");
    expect(updated.match(/\r\n/g)).toHaveLength(4);
    expect(updated).not.toMatch(/[^\r]\n/);
  });

  it("preserves mixed LF and CRLF line endings byte for byte", () => {
    const text = "a\r\n- [ ] one\nb\r\n";
    expect(setChecklistItem(text, 0, true)).toBe("a\r\n- [x] one\nb\r\n");
  });

  it("returns an identical string when the state already matches", () => {
    const text = "- [ ] one\r\n- [x] two\r\n";

    expect(setChecklistItem(text, 0, false)).toBe(text);
    expect(setChecklistItem(text, 1, true)).toBe(text);
  });

  it("counts only real checklist items when resolving an index", () => {
    const text = "- [ ]- not an item\n- [ ] actual item";

    expect(setChecklistItem(text, 0, true)).toBe(
      "- [ ]- not an item\n- [x] actual item",
    );
  });

  it("throws for missing or invalid indexes", () => {
    const text = "- [ ] one\n";

    expect(() => setChecklistItem(text, 1, true)).toThrow(RangeError);
    expect(() => setChecklistItem(text, -1, true)).toThrow(RangeError);
    expect(() => setChecklistItem(text, 0.5, true)).toThrow(RangeError);
    expect(() => setChecklistItem("no items", 0, true)).toThrow(RangeError);
  });
});

describe("appendChecklistItems", () => {
  it("appends unchecked items to an empty document", () => {
    expect(appendChecklistItems("", ["첫 항목", "둘째 항목"])).toBe(
      "- [ ] 첫 항목\n- [ ] 둘째 항목",
    );
  });

  it("adds exactly one newline when the document does not end with one", () => {
    expect(appendChecklistItems("메모", ["할 일"])).toBe("메모\n- [ ] 할 일");
    expect(appendChecklistItems("메모\r\n", ["할 일"])).toBe(
      "메모\r\n- [ ] 할 일",
    );
    expect(appendChecklistItems("메모\n", ["할 일"])).toBe("메모\n- [ ] 할 일");
  });

  it("keeps the document's CRLF style for appended lines", () => {
    expect(appendChecklistItems("메모\r\n기존", ["할 일"])).toBe(
      "메모\r\n기존\r\n- [ ] 할 일",
    );
    expect(appendChecklistItems("메모\r\n", ["하나", "둘"])).toBe(
      "메모\r\n- [ ] 하나\r\n- [ ] 둘",
    );
  });

  it("drops blank titles and trims the kept ones", () => {
    expect(
      appendChecklistItems("", ["  ", "\t", "  실제 항목  ", ""]),
    ).toBe("- [ ] 실제 항목");
  });

  it("returns the document unchanged when every title is blank", () => {
    expect(appendChecklistItems("메모\n", ["   ", ""])).toBe("메모\n");
    expect(appendChecklistItems("", [])).toBe("");
  });
});
