/**
 * frontend/component-primitives/types.ts
 *
 * Canonical type definitions for the TFA component primitive library.
 * Six interactive states per control: hover / focus / active / disabled / loading / empty.
 * Zero runtime dependencies.
 */

/** The six required states for every interactive control in the TFA design system. */
export type ComponentState =
  | "hover"
  | "focus"
  | "active"
  | "disabled"
  | "loading"
  | "empty";

/** All six states as a readonly tuple — iterate to produce the full kit. */
export const ALL_STATES: readonly ComponentState[] = [
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "empty",
] as const;

// ─── Button ──────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonSpec {
  variant: ButtonVariant;
  label: string;
  state: ComponentState;
  classes: string[];
  ariaAttrs: Record<string, string>;
  cssVars: Record<string, string>;
  iconSvg?: string;
}

// ─── Input ───────────────────────────────────────────────────────────────────

export type InputType = "text" | "email" | "password" | "number" | "search";

export interface InputSpec {
  type: InputType;
  label: string;
  state: ComponentState;
  classes: string[];
  ariaAttrs: Record<string, string>;
  cssVars: Record<string, string>;
  helpText?: string;
  errorMessage?: string;
}

// ─── Table ───────────────────────────────────────────────────────────────────

export type TableSortDir = "asc" | "desc" | "none";

export interface TableColumn {
  key: string;
  label: string;
  sortDir?: TableSortDir;
  numeric?: boolean;
}

export interface TableRow {
  id: string;
  cells: Record<string, string | number>;
}

export interface TableSpec {
  state: ComponentState;
  columns: TableColumn[];
  rows: TableRow[];
  classes: string[];
  ariaAttrs: Record<string, string>;
  cssVars: Record<string, string>;
  emptyMessage?: string;
}

// ─── Card ────────────────────────────────────────────────────────────────────

export type CardKind = "default" | "elevated" | "outlined" | "verdict";

/** Semantic verdict colour — restricted to trust/decision meaning only. */
export type VerdictKind = "valid" | "invalid" | "pending";

export interface CardSpec {
  kind: CardKind;
  state: ComponentState;
  title: string;
  body?: string;
  classes: string[];
  ariaAttrs: Record<string, string>;
  cssVars: Record<string, string>;
  verdict?: VerdictKind;
}
