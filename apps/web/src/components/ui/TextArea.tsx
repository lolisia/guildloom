/**
 * Multi-line text area, the same paper surface as {@link TextInput}.
 *
 * Used for the quest's "현재 상황" / "수정 방향" fields. Resizes vertically by
 * default; callers can override with `className`.
 */
import { forwardRef, type TextareaHTMLAttributes } from "react";

/** Props for {@link TextArea}. */
export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Paper-styled `<textarea>`. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ className, rows = 4, ...rest }, ref) {
    const classes = [
      "w-full resize-y rounded-sm border-[1.5px] border-line-strong bg-paper px-2.5 py-1.5 text-sm leading-relaxed text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return <textarea ref={ref} rows={rows} className={classes} {...rest} />;
  },
);

export default TextArea;
