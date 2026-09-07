/**
 * tests/frontend/component-primitives.test.ts
 *
 * Tests for frontend/component-primitives/ — Button, Input, Table, Card × six states.
 *
 * HAPPY     (12): kit produces all 6 states; correct classes; aria attrs on loading/disabled;
 *                 spinner on loading button; focus border override; table sort CSS var;
 *                 verdict card accent; errorMessage aria; empty table aria-label.
 * EDGE      (11): ghost empty state; custom iconSvg on non-loading; helpText passthrough;
 *                 rows=[] triggers empty aria-label; sort col; elevated card without verdict;
 *                 verdict card without verdict field; label with spaces; ALL_STATES length;
 *                 table loading aria-busy; all card kit entries have base class.
 * FAIL-CLOSED (13): null opts throws (button/input/table/card); missing/unknown variant;
 *                   blank label; unknown state; unknown input type; empty columns array;
 *                   unknown card kind; unknown verdict; buildButtonKit blank label;
 *                   buildCardKit blank title.
 */

import {
  ALL_STATES,
  buildButton,
  buildButtonKit,
  buildInput,
  buildInputKit,
  buildTable,
  buildTableKit,
  buildCard,
  buildCardKit,
} from "../../frontend/component-primitives/index.ts";
import type { TableColumn, TableRow } from "../../frontend/component-primitives/index.ts";

// ── micro harness ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertThrows(label: string, fn: () => unknown): void {
  try {
    fn();
    console.error(`  ✗ ${label} (expected throw, got none)`);
    failed++;
  } catch {
    console.log(`  ✓ ${label}`);
    passed++;
  }
}

// ── fixtures ──────────────────────────────────────────────────────────────

const COLS: TableColumn[] = [
  { key: "id",     label: "ID",     sortDir: "asc" },
  { key: "action", label: "Action", sortDir: "none" },
  { key: "risk",   label: "Risk",   numeric: true },
];
const ROWS: TableRow[] = [
  { id: "r1", cells: { id: "r1", action: "read_file", risk: 12 } },
  { id: "r2", cells: { id: "r2", action: "db_write",  risk: 78 } },
];

// ══════════════════════════════════════════════════════════════════════════
// HAPPY-PATH
// ══════════════════════════════════════════════════════════════════════════

console.log("\n── HAPPY-PATH ───────────────────────────────────────────");

{
  const kit = buildButtonKit("primary", "Submit");
  assert(
    "buildButtonKit primary produces exactly 6 specs",
    kit.length === 6,
  );
  assert(
    "buildButtonKit primary — states match ALL_STATES order",
    kit.map(s => s.state).join(",") === [...ALL_STATES].join(","),
  );
}

{
  const spec = buildButton({ variant: "primary", label: "Go", state: "hover" });
  assert("buildButton primary hover — has base class tfa-btn",      spec.classes.includes("tfa-btn"));
  assert("buildButton primary hover — has variant class",           spec.classes.includes("tfa-btn--primary"));
  assert("buildButton primary hover — no disabled/loading class",
    !spec.classes.includes("tfa-btn--disabled") && !spec.classes.includes("tfa-btn--loading"));
}

{
  const spec = buildButton({ variant: "secondary", label: "Cancel", state: "loading" });
  assert("buildButton loading — aria-disabled=true",  spec.ariaAttrs["aria-disabled"] === "true");
  assert("buildButton loading — aria-busy=true",      spec.ariaAttrs["aria-busy"] === "true");
  assert("buildButton loading — iconSvg is spinner",  typeof spec.iconSvg === "string" && spec.iconSvg.includes("tfa-spin"));
  assert("buildButton loading — has loading class",   spec.classes.includes("tfa-btn--loading"));
}

{
  const spec = buildButton({ variant: "danger", label: "Delete", state: "disabled" });
  assert("buildButton disabled — aria-disabled=true",            spec.ariaAttrs["aria-disabled"] === "true");
  assert("buildButton disabled — no aria-busy",                  spec.ariaAttrs["aria-busy"] === undefined);
  assert("buildButton disabled — has disabled class",            spec.classes.includes("tfa-btn--disabled"));
}

{
  const kit = buildInputKit("email", "Email address");
  assert(
    "buildInputKit email — produces exactly 6 specs",
    kit.length === 6,
  );
}

{
  const spec = buildInput({ type: "text", label: "Name", state: "focus" });
  const borderVal = spec.cssVars["--input-border"];
  const ringVal   = spec.cssVars["--input-focus-ring"];
  assert("buildInput focus — border var equals focus-ring var", borderVal === ringVal);
}

{
  const spec = buildInput({ type: "password", label: "Password", errorMessage: "Too short" });
  assert("buildInput with errorMessage — aria-invalid=true",       spec.ariaAttrs["aria-invalid"] === "true");
  assert("buildInput with errorMessage — aria-describedby set",    spec.ariaAttrs["aria-describedby"] === "input-error");
  assert("buildInput with errorMessage — error class present",     spec.classes.includes("tfa-input--error"));
}

{
  const kit = buildTableKit(COLS, ROWS);
  assert("buildTableKit — produces exactly 6 specs", kit.length === 6);
}

{
  const spec = buildTable({ columns: COLS, rows: [], state: "empty", emptyMessage: "No actions found" });
  assert("buildTable empty — aria-label set to emptyMessage", spec.ariaAttrs["aria-label"] === "No actions found");
  assert("buildTable empty — has empty class",                spec.classes.includes("tfa-table--empty"));
}

{
  const kit = buildCardKit("verdict", "Trust Gate");
  assert("buildCardKit verdict — produces exactly 6 specs", kit.length === 6);
}

{
  const spec = buildCard({ kind: "verdict", title: "Result", state: "hover", verdict: "valid" });
  assert("buildCard verdict valid — accent is green OKLCH",   spec.cssVars["--card-accent"]?.includes("150") ?? false);
  assert("buildCard verdict valid — verdict field present",   spec.verdict === "valid");
}

// ══════════════════════════════════════════════════════════════════════════
// EDGE-CASES
// ══════════════════════════════════════════════════════════════════════════

console.log("\n── EDGE-CASES ───────────────────────────────────────────");

{
  // Ghost + empty state: no disabled/loading class; ghost bg is transparent
  const spec = buildButton({ variant: "ghost", label: "More", state: "empty" });
  assert("buildButton ghost empty — no loading/disabled class",
    !spec.classes.includes("tfa-btn--loading") && !spec.classes.includes("tfa-btn--disabled"));
  assert("buildButton ghost empty — bg is transparent",   spec.cssVars["--btn-bg"] === "transparent");
}

{
  // Custom iconSvg on non-loading state passes through
  const spec = buildButton({ variant: "primary", label: "Upload", state: "active", iconSvg: "<svg/>" });
  assert("buildButton active with custom iconSvg — preserved", spec.iconSvg === "<svg/>");
}

{
  const spec = buildInput({ type: "search", label: "Query", helpText: "Search by action type" });
  assert("buildInput — helpText passes through", spec.helpText === "Search by action type");
}

{
  // rows=[] without explicit empty state still sets aria-label (isEmpty logic)
  const spec = buildTable({ columns: COLS, rows: [], emptyMessage: "Nothing here" });
  assert("buildTable rows=[] — aria-label set even in non-empty state", spec.ariaAttrs["aria-label"] === "Nothing here");
}

{
  // Sort column CSS var set to first sorted column key
  const spec = buildTable({ columns: COLS, rows: ROWS });
  assert("buildTable — --table-sort-col set to first sorted column key", spec.cssVars["--table-sort-col"] === "id");
}

{
  const spec = buildCard({ kind: "elevated", title: "Summary", state: "focus" });
  assert("buildCard elevated — no verdict CSS vars injected",
    spec.cssVars["--card-accent"] === undefined && spec.verdict === undefined);
}

{
  // verdict kind without verdict field — no accent CSS
  const spec = buildCard({ kind: "verdict", title: "Pending Review", state: "hover" });
  assert("buildCard verdict kind — no verdict field → no accent vars", spec.cssVars["--card-accent"] === undefined);
}

{
  const spec = buildButton({ variant: "secondary", label: "  Save Changes  ", state: "hover" });
  assert("buildButton — label with surrounding spaces is valid", spec.label === "  Save Changes  ");
}

{
  assert("ALL_STATES — has exactly 6 elements", ALL_STATES.length === 6);
}

{
  const kit = buildTableKit(COLS, ROWS);
  const loadingSpec = kit.find(s => s.state === "loading")!;
  assert("buildTableKit loading — aria-busy=true", loadingSpec.ariaAttrs["aria-busy"] === "true");
}

{
  const kit = buildCardKit("elevated", "Dashboard");
  assert(
    "buildCardKit elevated — all 6 specs include base class tfa-card",
    kit.every(s => s.classes.includes("tfa-card")),
  );
}

// ══════════════════════════════════════════════════════════════════════════
// FAIL-CLOSED
// ══════════════════════════════════════════════════════════════════════════

console.log("\n── FAIL-CLOSED ──────────────────────────────────────────");

assertThrows("buildButton null opts — throws",          () => buildButton(null as never));
assertThrows("buildButton missing variant — throws",    () => buildButton({ variant: "" as never, label: "X" }));
assertThrows("buildButton unknown variant — throws",    () => buildButton({ variant: "outline" as never, label: "X" }));
assertThrows("buildButton blank label — throws",        () => buildButton({ variant: "primary", label: "   " }));
assertThrows("buildButton unknown state — throws",      () => buildButton({ variant: "primary", label: "X", state: "pressed" as never }));

assertThrows("buildInput null opts — throws",           () => buildInput(null as never));
assertThrows("buildInput unknown type — throws",        () => buildInput({ type: "checkbox" as never, label: "X" }));
assertThrows("buildInput blank label — throws",         () => buildInput({ type: "text", label: "" }));

assertThrows("buildTable null opts — throws",           () => buildTable(null as never));
assertThrows("buildTable empty columns — throws",       () => buildTable({ columns: [], rows: [] }));
assertThrows("buildTable non-array columns — throws",   () => buildTable({ columns: "bad" as never, rows: [] }));

assertThrows("buildCard null opts — throws",            () => buildCard(null as never));
assertThrows("buildCard unknown kind — throws",         () => buildCard({ kind: "floating" as never, title: "X" }));
assertThrows("buildCard unknown verdict — throws",      () => buildCard({ kind: "verdict", title: "X", verdict: "maybe" as never }));
assertThrows("buildButtonKit blank label — throws",     () => buildButtonKit("primary", ""));
assertThrows("buildCardKit blank title — throws",       () => buildCardKit("default", "  "));

// ── footer ────────────────────────────────────────────────────────────────

console.log(`\nResult: ${passed} pass, ${failed} fail`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
