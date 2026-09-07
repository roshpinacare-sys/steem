/**
 * frontend/component-primitives/table.ts
 *
 * Table primitive — sortable columns × six states.
 * Empty state: when rows array is empty or state === "empty", sets aria-label to emptyMessage.
 * Sort: first sorted column sets --table-sort-col CSS var for accent highlight.
 * Zero runtime dependencies.
 */

import type { TableSpec, TableColumn, TableRow, ComponentState } from "./types.ts";
import { ALL_STATES } from "./types.ts";

const BASE_CLASS = "tfa-table";

const STATE_CLASSES: Partial<Record<ComponentState, string>> = {
  loading:  "tfa-table--loading",
  empty:    "tfa-table--empty",
  disabled: "tfa-table--disabled",
};

const BASE_CSS: Record<string, string> = {
  "--table-bg":          "oklch(0.99 0.004 225)",
  "--table-border":      "oklch(0.86 0.008 225)",
  "--table-header-bg":   "oklch(0.93 0.007 225)",
  "--table-header-fg":   "oklch(0.20 0.010 240)",
  "--table-row-hover":   "oklch(0.97 0.006 225)",
  "--table-stripe":      "oklch(0.95 0.006 225)",
  "--table-sort-accent": "oklch(0.54 0.140 221)",
};

export interface BuildTableOptions {
  state?: ComponentState;
  columns: TableColumn[];
  rows: TableRow[];
  emptyMessage?: string;
}

/**
 * Build a fully-specified TableSpec for one state.
 * Fail-closed: throws on null opts, non-array columns, empty columns, bad column shape,
 * non-array rows, or unknown state.
 */
export function buildTable(opts: BuildTableOptions): TableSpec {
  if (opts == null || typeof opts !== "object") {
    throw new Error("buildTable: opts must be an object");
  }
  if (!Array.isArray(opts.columns)) {
    throw new Error("buildTable: columns must be an array");
  }
  if (opts.columns.length === 0) {
    throw new Error("buildTable: columns must not be empty");
  }
  for (const col of opts.columns) {
    if (!col || typeof col.key !== "string" || col.key === "") {
      throw new Error("buildTable: each column must have a non-empty string key");
    }
    if (typeof col.label !== "string" || col.label === "") {
      throw new Error("buildTable: each column must have a non-empty string label");
    }
  }
  if (!Array.isArray(opts.rows)) {
    throw new Error("buildTable: rows must be an array");
  }

  const state: ComponentState = opts.state ?? "hover";
  if (!(ALL_STATES as readonly string[]).includes(state)) {
    throw new Error(`buildTable: unknown state "${state}"`);
  }

  const classes: string[] = [BASE_CLASS];
  const sc = STATE_CLASSES[state];
  if (sc) classes.push(sc);

  const ariaAttrs: Record<string, string> = { role: "table" };
  if (state === "loading") ariaAttrs["aria-busy"] = "true";
  const isEmpty = state === "empty" || opts.rows.length === 0;
  if (isEmpty) ariaAttrs["aria-label"] = opts.emptyMessage ?? "No data";

  // Efficiency: single find() — stop at first sorted column instead of scanning all.
  const cssVars: Record<string, string> = { ...BASE_CSS };
  const sortedCol = opts.columns.find(c => c.sortDir && c.sortDir !== "none");
  if (sortedCol) cssVars["--table-sort-col"] = sortedCol.key;

  return {
    state,
    columns: opts.columns,
    rows: opts.rows,
    classes,
    ariaAttrs,
    cssVars,
    ...(opts.emptyMessage !== undefined ? { emptyMessage: opts.emptyMessage } : {}),
  };
}

/**
 * Return one TableSpec per ComponentState — the canonical six-state kit.
 */
export function buildTableKit(columns: TableColumn[], rows: TableRow[]): TableSpec[] {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error("buildTableKit: columns must be a non-empty array");
  }
  if (!Array.isArray(rows)) {
    throw new Error("buildTableKit: rows must be an array");
  }
  return ALL_STATES.map(state => buildTable({ columns, rows, state }));
}
