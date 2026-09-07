/**
 * tests/docs/frontend-ard-blueprint.test.ts — guards the Frontend & ARD blueprint.
 *
 * The blueprint (FRONTEND_AND_ARD_BLUEPRINT.md) is product *direction* for two new
 * workstreams (Frontend + ARD), not a state report. To stop it from drifting into
 * a second, competing "source of truth" the way the old research docs did, it MUST
 * carry a pointer back to MANIFEST.md near the top. This guard enforces that.
 *
 *   HAPPY        the blueprint exists and is substantial.
 *   EDGE         it names MANIFEST.md as the source of truth, near the top.
 *   FAIL-CLOSED  the detector rejects a blueprint that lacks the pointer.
 */
import { test, assert } from "../_harness.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BLUEPRINT = "FRONTEND_AND_ARD_BLUEPRINT.md";

// the pointer must appear near the very top (first ~400 chars) and name MANIFEST.
function hasSourceOfTruthPointer(text: string): boolean {
  const head = text.slice(0, 400);
  return head.includes("MANIFEST.md");
}

test("blueprint exists and is substantial", () => {
  const path = join(root, BLUEPRINT);
  assert(existsSync(path), `${BLUEPRINT} exists`);
  const text = readFileSync(path, "utf8");
  assert(text.length > 2000, `${BLUEPRINT} is substantial (>2000 chars)`);
});

test("blueprint names MANIFEST.md as the source of truth near the top", () => {
  const text = readFileSync(join(root, BLUEPRINT), "utf8");
  assert(hasSourceOfTruthPointer(text), "blueprint points readers to MANIFEST.md");
});

test("blueprint covers both workstreams (Frontend + ARD)", () => {
  const text = readFileSync(join(root, BLUEPRINT), "utf8");
  assert(text.includes("ARD"), "blueprint covers ARD");
  assert(text.includes("OKLCH"), "blueprint covers the design-token foundation");
  assert(text.includes("trustManifest"), "blueprint covers the ARD trust schema");
});

test("fail-closed: detector rejects a doc without the source-of-truth pointer", () => {
  assert(!hasSourceOfTruthPointer("# Some doc\n\nNo pointer here.\n"), "missing pointer → rejected");
  assert(!hasSourceOfTruthPointer("MANIFEST is great"), "pointer must name MANIFEST.md exactly");
});
