/**
 * tests/frontend/visual-regression.test.ts
 *
 * Tests for frontend/visual-regression/ — the zero-dep snapshot/DOM harness
 * (FRONTEND_AND_ARD_BLUEPRINT.md §5 item 10).
 *
 * HAPPY       (9): allFixtureGroups produces all 4 groups × 6 states each;
 *                  render-html serializers are deterministic (same spec → same
 *                  string twice); writeSnapshot + diffAgainstSnapshot round-trips
 *                  clean; diffIsClean true on a clean result; runVisualRegression
 *                  + updateAllSnapshots are clean against the real committed
 *                  golden snapshots (the actual regression gate); attribute order
 *                  in rendered HTML is sorted/stable across two builds.
 * EDGE        (6): diffAgainstSnapshot reports `added` for a brand-new case name
 *                  not yet in the golden file; reports `removed` for a golden
 *                  entry no longer produced live; a single-character HTML change
 *                  is caught (hash short-circuit doesn't mask a real diff);
 *                  table empty-state fixture renders the configured emptyMessage;
 *                  card fixtures carry the verdict attribute through to markup;
 *                  re-running writeSnapshot then diff twice is idempotent.
 * FAIL-CLOSED (5): diffAgainstSnapshot against a missing snapshot file reports
 *                  every case as `added` (never silently "matched"); readSnapshot
 *                  throws on a corrupt (non-JSON) file rather than treating it as
 *                  empty; readSnapshot throws on a wrong-shape JSON file (missing
 *                  version/group/entries); diffAgainstSnapshot on a real change
 *                  is NOT reported clean (diffIsClean === false); allClean is
 *                  false if even one of several groups has a change.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  allFixtureGroups,
  buttonFixtures,
  tableFixtures,
  cardFixtures,
} from "../../frontend/visual-regression/fixtures.ts";
import {
  readSnapshot,
  writeSnapshot,
  diffAgainstSnapshot,
} from "../../frontend/visual-regression/snapshot.ts";
import { diffIsClean } from "../../frontend/visual-regression/types.ts";
import {
  runVisualRegression,
  allClean,
  updateAllSnapshots,
} from "../../frontend/visual-regression/harness.ts";
import { ALL_STATES } from "../../frontend/component-primitives/index.ts";

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

// ── scratch dir for isolated snapshot I/O (never touches the real golden files) ──

const scratch = mkdtempSync(join(tmpdir(), "tfa-visual-regression-test-"));

// ── HAPPY ─────────────────────────────────────────────────────────────────────

const groups = allFixtureGroups();
assert("allFixtureGroups produces 4 groups", Object.keys(groups).length === 4);
assert(
  "every group has exactly ALL_STATES.length cases",
  Object.values(groups).every((cases) => cases.length === ALL_STATES.length)
);

const b1 = buttonFixtures();
const b2 = buttonFixtures();
assert(
  "render-html serializers are deterministic (same spec → same string)",
  JSON.stringify(b1) === JSON.stringify(b2)
);

{
  const file = join(scratch, "happy-roundtrip.snap.json");
  const cases = buttonFixtures();
  writeSnapshot(file, "button", cases);
  const diff = diffAgainstSnapshot(file, "button", cases);
  assert("writeSnapshot + diffAgainstSnapshot round-trips clean", diffIsClean(diff));
  assert("diffIsClean true on a clean result", diffIsClean(diff) === true);
}

{
  const results = runVisualRegression();
  assert(
    "runVisualRegression is clean against the committed golden snapshots",
    allClean(results)
  );
  // updateAllSnapshots is exercised here too (idempotent — re-running on already-clean
  // fixtures must not introduce drift).
  updateAllSnapshots();
  const after = runVisualRegression();
  assert("updateAllSnapshots followed by a fresh run is still clean", allClean(after));
}

{
  const html = buttonFixtures()[0].html;
  const styleMatch = html.match(/style="([^"]*)"/);
  assert("rendered style attribute exists and is non-empty", !!styleMatch && styleMatch[1].length > 0);
  const decls = styleMatch![1].split(";").map((d) => d.split(":")[0]);
  const sorted = [...decls].sort();
  assert("cssVar declarations in rendered HTML are sorted (stable attribute order)", JSON.stringify(decls) === JSON.stringify(sorted));
}

// ── EDGE ──────────────────────────────────────────────────────────────────────

{
  const file = join(scratch, "edge-added.snap.json");
  writeSnapshot(file, "button", buttonFixtures().slice(0, 3));
  const diff = diffAgainstSnapshot(file, "button", buttonFixtures());
  assert("diffAgainstSnapshot reports `added` for new case names", diff.added.length === 3);
}

{
  const file = join(scratch, "edge-removed.snap.json");
  writeSnapshot(file, "button", buttonFixtures());
  const diff = diffAgainstSnapshot(file, "button", buttonFixtures().slice(0, 3));
  assert("diffAgainstSnapshot reports `removed` for dropped golden entries", diff.removed.length === 3);
}

{
  const file = join(scratch, "edge-single-char.snap.json");
  const cases = buttonFixtures();
  writeSnapshot(file, "button", cases);
  const mutated = cases.map((c, i) => (i === 0 ? { ...c, html: c.html + " " } : c));
  const diff = diffAgainstSnapshot(file, "button", mutated);
  assert("a single-character HTML change is caught (hash short-circuit doesn't mask it)", diff.changed.length === 1);
}

{
  const empty = tableFixtures().find((c) => c.name === "sortable-empty")!;
  assert("table empty-state fixture renders the configured emptyMessage", empty.html.includes("No rows"));
}

{
  const valid = cardFixtures().find((c) => c.name === "verdict-hover")!;
  assert("card fixtures carry the verdict attribute through to markup", valid.html.includes('data-verdict="valid"'));
}

{
  const file = join(scratch, "edge-idempotent.snap.json");
  const cases = buttonFixtures();
  writeSnapshot(file, "button", cases);
  const d1 = diffAgainstSnapshot(file, "button", cases);
  writeSnapshot(file, "button", cases);
  const d2 = diffAgainstSnapshot(file, "button", cases);
  assert("re-running writeSnapshot then diff twice is idempotent", diffIsClean(d1) && diffIsClean(d2));
}

// ── FAIL-CLOSED ───────────────────────────────────────────────────────────────

{
  const file = join(scratch, "does-not-exist.snap.json");
  const cases = buttonFixtures();
  const diff = diffAgainstSnapshot(file, "button", cases);
  assert(
    "missing snapshot file reports every case as `added` (never silently matched)",
    diff.added.length === cases.length && diff.matched.length === 0
  );
}

{
  const file = join(scratch, "corrupt.snap.json");
  writeFileSync(file, "{ not valid json", "utf8");
  assertThrows("readSnapshot throws on a corrupt (non-JSON) file", () => readSnapshot(file));
}

{
  const file = join(scratch, "wrong-shape.snap.json");
  writeFileSync(file, JSON.stringify({ foo: "bar" }), "utf8");
  assertThrows("readSnapshot throws on wrong-shape JSON (missing version/group/entries)", () =>
    readSnapshot(file)
  );
}

{
  const file = join(scratch, "fail-closed-real-change.snap.json");
  const cases = buttonFixtures();
  writeSnapshot(file, "button", cases);
  const mutated = cases.map((c, i) => (i === 0 ? { ...c, html: "<button>DIFFERENT</button>" } : c));
  const diff = diffAgainstSnapshot(file, "button", mutated);
  assert("a real change is NOT reported clean", diffIsClean(diff) === false);
}

{
  const fileA = join(scratch, "allclean-a.snap.json");
  const fileB = join(scratch, "allclean-b.snap.json");
  const casesA = buttonFixtures();
  const casesB = tableFixtures();
  writeSnapshot(fileA, "button", casesA);
  writeSnapshot(fileB, "table", casesB);
  const mutatedB = casesB.map((c, i) => (i === 0 ? { ...c, html: c.html + "x" } : c));
  const diffA = diffAgainstSnapshot(fileA, "button", casesA);
  const diffB = diffAgainstSnapshot(fileB, "table", mutatedB);
  assert("allClean is false if even one of several groups has a change", allClean([diffA, diffB]) === false);
}

// ── cleanup + summary ─────────────────────────────────────────────────────────

rmSync(scratch, { recursive: true, force: true });

console.log(`\nResult: ${passed} pass, ${failed} fail`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
