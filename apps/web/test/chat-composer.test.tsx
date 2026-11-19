// @vitest-environment node
/**
 * Chat composer behaviour.
 *
 * `MessageComposer` is the shared text box for the 주점 and quest party rooms.
 * These tests pin the keyboard contract (Enter sends, Shift+Enter is a
 * newline, an IME Enter never submits), mention autocomplete (`@김` → list →
 * `@김철수 ` → `<@id>` on submit), the 4000-character limit and the failure
 * path that keeps the draft.
 */
import "./domEnvironment";

import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import MessageComposer from "../src/components/chat/MessageComposer";
import { ko } from "../src/i18n/ko";

const PLACEHOLDER = ko.chat.tavernPlaceholder;

const MEMBERS = [
  { id: 1, displayName: "김철수" },
  { id: 2, displayName: "김모험" },
  { id: 3, displayName: "이모험" },
  { id: 4, displayName: "박모험" },
];

function setup(
  onSubmit: (body: string) => Promise<void> = async () => undefined,
  extra: Partial<Parameters<typeof MessageComposer>[0]> = {},
) {
  const view = render(
    <MessageComposer
      onSubmit={onSubmit}
      members={MEMBERS}
      placeholder={PLACEHOLDER}
      {...extra}
    />,
  );
  const textarea = view.getByRole("textbox", { name: PLACEHOLDER });
  return { ...view, textarea, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
});

describe("MessageComposer", () => {
  it("sends on Enter and clears the draft", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = setup(onSubmit);

    await view.user.type(view.textarea, "안녕하세요");
    await view.user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("안녕하세요");
    });
    await waitFor(() => {
      expect(view.textarea).toHaveValue("");
    });
  });

  it("inserts a newline on Shift+Enter without sending", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = setup(onSubmit);

    await view.user.type(view.textarea, "첫 줄");
    await view.user.keyboard("{Shift>}{Enter}{/Shift}");
    await view.user.type(view.textarea, "둘째 줄");

    expect(onSubmit).not.toHaveBeenCalled();
    expect(view.textarea).toHaveValue("첫 줄\n둘째 줄");
  });

  it("ignores the Enter that confirms an IME composition", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = setup(onSubmit);

    fireEvent.change(view.textarea, { target: { value: "안녕" } });
    fireEvent.keyDown(view.textarea, { key: "Enter", isComposing: true });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(view.textarea).toHaveValue("안녕");
  });

  it("opens the @김 list, inserts @김철수 and submits the encoded token", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = setup(onSubmit);

    await view.user.type(view.textarea, "@김");

    const listbox = await view.findByRole("listbox", {
      name: ko.chat.mentionList,
    });
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("김철수");
    expect(options[1]).toHaveTextContent("김모험");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(view.textarea).toHaveAttribute("aria-controls", listbox.id);
    expect(view.textarea).toHaveAttribute(
      "aria-activedescendant",
      options[0]?.id ?? "",
    );

    await view.user.keyboard("{Enter}");
    expect(view.textarea).toHaveValue("@김철수 ");
    expect(view.queryByRole("listbox")).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();

    await view.user.keyboard("{Enter}");
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("<@1>");
    });
  });

  it("moves the highlight with the arrow keys and selects with Tab", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = setup(onSubmit);

    await view.user.type(view.textarea, "@김");
    await view.user.keyboard("{ArrowDown}");
    const listbox = view.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    await view.user.keyboard("{Tab}");
    expect(view.textarea).toHaveValue("@김모험 ");
    expect(view.queryByRole("listbox")).toBeNull();
  });

  it("closes the mention list on Escape without touching the draft", async () => {
    const view = setup();

    await view.user.type(view.textarea, "@김");
    expect(view.getByRole("listbox")).toBeInTheDocument();

    await view.user.keyboard("{Escape}");

    expect(view.queryByRole("listbox")).toBeNull();
    expect(view.textarea).toHaveValue("@김");
  });

  it("never shows more than six members and prefers prefix matches", async () => {
    const many = [
      { id: 10, displayName: "가모험" },
      { id: 11, displayName: "나모험" },
      { id: 12, displayName: "다모험" },
      { id: 13, displayName: "라모험" },
      { id: 14, displayName: "마모험" },
      { id: 15, displayName: "바모험" },
      { id: 16, displayName: "모험왕" },
    ];
    const view = setup(async () => undefined, { members: many });

    await view.user.type(view.textarea, "@모험");
    const options = within(view.getByRole("listbox")).getAllByRole("option");
    expect(options.length).toBeLessThanOrEqual(6);
    expect(options[0]).toHaveTextContent("모험왕");
  });

  it("disables sending and shows the counter above 4000 characters", () => {
    const view = setup();

    fireEvent.change(view.textarea, {
      target: { value: "가".repeat(4001) },
    });

    expect(view.getByRole("button", { name: ko.chat.send })).toBeDisabled();
    const counter = view.getByTestId("message-length");
    expect(counter).toHaveTextContent("4001/4000");
    expect(counter.className).toContain("text-brick");
  });

  it("keeps the draft and shows an alert when the send fails", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("network down");
    });
    const view = setup(onSubmit);

    await view.user.type(view.textarea, "실패할 메시지");
    await view.user.keyboard("{Enter}");

    const alert = await view.findByRole("alert");
    expect(alert).toHaveTextContent(ko.chat.sendFailed);
    expect(view.textarea).toHaveValue("실패할 메시지");
  });

  it("runs the command handler on the raw draft and skips the message API", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const commandHandler = vi.fn(async () => true);
    const view = setup(onSubmit, { commandHandler });

    await view.user.type(view.textarea, "/의뢰 서버 점검");
    await view.user.keyboard("{Enter}");

    await waitFor(() => {
      expect(commandHandler).toHaveBeenCalledWith("/의뢰 서버 점검");
    });
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(view.textarea).toHaveValue("");
    });
  });
});
