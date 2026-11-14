/**
 * Barrel for the shared UI atoms.
 *
 * Import design-system primitives from `components/ui` so screens never reach
 * into individual files, and so the set of allowed surfaces and controls stays
 * easy to review against DESIGN.md.
 */
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button";
export { Chip, type ChipProps } from "./Chip";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { Panel, type PanelProps } from "./Panel";
export { TextArea, type TextAreaProps } from "./TextArea";
export { TextInput, type TextInputProps } from "./TextInput";
