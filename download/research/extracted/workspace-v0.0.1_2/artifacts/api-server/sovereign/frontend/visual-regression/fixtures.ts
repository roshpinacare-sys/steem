/**
 * frontend/visual-regression/fixtures.ts
 *
 * Canonical fixture cases for the visual-regression harness — one well-known
 * spec per ComponentState per group, fed through the existing builders and
 * the deterministic HTML serializer. This is the single source of truth for
 * "what the kit currently renders"; snapshot.ts only ever sees these strings.
 *
 * Kept deliberately small (one variant/kind per group, all six states) —
 * the goal is regression detection, not exhaustive coverage (that's
 * component-primitives.test.ts's job).
 */

import {
  ALL_STATES,
  buildButton,
  buildInput,
  buildTable,
  buildCard,
  renderButtonHtml,
  renderInputHtml,
  renderTableHtml,
  renderCardHtml,
} from "../component-primitives/index.ts";
import type { TableColumn, TableRow } from "../component-primitives/index.ts";
import type { SnapshotCase } from "./types.ts";

const TABLE_COLUMNS: TableColumn[] = [
  { key: "name", label: "Name" },
  { key: "amount", label: "Amount", numeric: true, sortDir: "asc" },
];

const TABLE_ROWS: TableRow[] = [
  { id: "row-1", cells: { name: "Alpha", amount: 100 } },
  { id: "row-2", cells: { name: "Beta", amount: 250 } },
];

export function buttonFixtures(): SnapshotCase[] {
  return ALL_STATES.map((state) => {
    const spec = buildButton({ variant: "primary", label: "Approve", state });
    return { name: `primary-${state}`, html: renderButtonHtml(spec) };
  });
}

export function inputFixtures(): SnapshotCase[] {
  return ALL_STATES.map((state) => {
    const spec = buildInput({ type: "text", label: "Tenant ID", state });
    return { name: `text-${state}`, html: renderInputHtml(spec) };
  });
}

export function tableFixtures(): SnapshotCase[] {
  return ALL_STATES.map((state) => {
    const rows = state === "empty" ? [] : TABLE_ROWS;
    const spec = buildTable({ state, columns: TABLE_COLUMNS, rows, emptyMessage: "No rows" });
    return { name: `sortable-${state}`, html: renderTableHtml(spec) };
  });
}

export function cardFixtures(): SnapshotCase[] {
  return ALL_STATES.map((state) => {
    const spec = buildCard({ kind: "verdict", title: "Passport #1", state, verdict: "valid" });
    return { name: `verdict-${state}`, html: renderCardHtml(spec) };
  });
}

/** All four groups, keyed by group name — what the harness iterates. */
export function allFixtureGroups(): Record<string, SnapshotCase[]> {
  return {
    button: buttonFixtures(),
    input: inputFixtures(),
    table: tableFixtures(),
    card: cardFixtures(),
  };
}
