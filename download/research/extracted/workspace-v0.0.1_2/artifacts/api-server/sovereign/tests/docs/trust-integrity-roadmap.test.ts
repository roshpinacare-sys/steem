/**
 * tests/docs/trust-integrity-roadmap.test.ts — guards the trust-integrity roadmap.
 *
 * TRUST_INTEGRITY_ROADMAP.md is product *direction* for the trust-integrity layer
 * (log integrity + trust proofs), not a state report. To stop it from drifting into
 * a competing "source of truth", it MUST carry a pointer back to MANIFEST.md near
 * the top. This guard mirrors the frontend-ard-blueprint guard.
 *
 *   HAPPY        the roadmap exists and is substantial.
 *   EDGE         it names MANIFEST.md as the source of truth, near the top, and
 *                covers the open frontier (federation, selective disclosure, drift).
 *   FAIL-CLOSED  the detector rejects a doc that lacks the pointer.
 */
import { test, assert } from "../_harness.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROADMAP = "TRUST_INTEGRITY_ROADMAP.md";

// the pointer must appear near the very top (first ~400 chars) and name MANIFEST.
function hasSourceOfTruthPointer(text: string): boolean {
  const head = text.slice(0, 400);
  return head.includes("MANIFEST.md");
}

test("roadmap exists and is substantial", () => {
  const path = join(root, ROADMAP);
  assert(existsSync(path), `${ROADMAP} exists`);
  const text = readFileSync(path, "utf8");
  assert(text.length > 2000, `${ROADMAP} is substantial (>2000 chars)`);
});

test("roadmap names MANIFEST.md as the source of truth near the top", () => {
  const text = readFileSync(join(root, ROADMAP), "utf8");
  assert(hasSourceOfTruthPointer(text), "roadmap points readers to MANIFEST.md");
});

test("roadmap covers the open frontier and the built foundation", () => {
  const text = readFileSync(join(root, ROADMAP), "utf8");
  // built foundation referenced (so agents don't rebuild it)
  assert(text.includes("consistency-proof"), "references the consistency-proof foundation");
  assert(text.includes("witness"), "references the witness foundation");
  // open frontier present (so agents have unblocked work)
  assert(text.includes("federation") || text.includes("trust mesh"), "covers cross-log federation");
  assert(text.toLowerCase().includes("selective disclosure"), "covers selective disclosure");
  assert(text.toLowerCase().includes("drift"), "covers predictive risk drift");
});

test("fail-closed: detector rejects a doc without the source-of-truth pointer", () => {
  assert(!hasSourceOfTruthPointer("# Some doc\n\nNo pointer here.\n"), "missing pointer → rejected");
  assert(!hasSourceOfTruthPointer("MANIFEST is great"), "pointer must name MANIFEST.md exactly");
});
