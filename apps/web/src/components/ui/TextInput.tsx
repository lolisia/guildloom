/**
 * Single-line text input styled like a paper request form.
 *
 * Paper background, 1.5px `line-strong` outline and the global teal focus ring;
 * everything else is passed straight through, so labels, ids, aria attributes
 * and controlled values keep working.
 */
import { forwardRef, type InputHTMLAttributes } from "react";

/** Props for {@link TextInput}. */
export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

/** Paper-styled `<input>`. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ className, ...rest }, ref) {
    const classes = [
      "w-full rounded-sm border-[1.5px] border-line-strong bg-paper px-2.5 py-1.5 text-sm text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return <input ref={ref} className={classes} {...rest} />;
  },
);

export default TextInput;
