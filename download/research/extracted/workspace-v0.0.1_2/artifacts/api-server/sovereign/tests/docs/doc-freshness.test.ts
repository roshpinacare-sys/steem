/**
 * tests/docs/doc-freshness.test.ts — guards against stale docs misleading agents.
 *
 * Two founding research docs (TFA_master_plan_v20 @ v20, TFA_breakthrough_research
 * @ v83) carry version-specific numbers that are now hundreds of versions old. They
 * are kept for history but MUST be banner-marked as archival so an agent never
 * mistakes their figures for the current state.
 *
 *   HAPPY        both archival docs carry the archive banner.
 *   EDGE         the banner points readers to the live source-of-truth (MANIFEST).
 *   FAIL-CLOSED  the detector rejects a doc that lacks the banner.
 */
import { test, assert } from "../_harness.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_MARK = "מסמך ארכיון";
const ARCHIVAL_DOCS = ["TFA_master_plan_v20.md", "TFA_breakthrough_research.md"];

function isArchivalBannered(text: string): boolean {
  // banner must be near the very top (first ~400 chars) and name the source of truth.
  const head = text.slice(0, 400);
  return head.includes(ARCHIVE_MARK) && head.includes("MANIFEST.md");
}

test("archival research docs carry an archive banner", () => {
  for (const name of ARCHIVAL_DOCS) {
    const path = join(root, name);
    assert(existsSync(path), `${name} exists`);
    assert(isArchivalBannered(readFileSync(path, "utf8")), `${name} is banner-marked as archival`);
  }
});

test("banner points to the live source of truth", () => {
  const text = readFileSync(join(root, ARCHIVAL_DOCS[0]), "utf8").slice(0, 400);
  assert(text.includes("MANIFEST.md"), "banner names MANIFEST.md as source of truth");
});

test("fail-closed: detector rejects a doc without the banner", () => {
  assert(!isArchivalBannered("# Some doc\n\nNo banner here.\n"), "missing banner → not archival-marked");
  assert(!isArchivalBannered(ARCHIVE_MARK + " but no source-of-truth pointer"), "partial banner rejected");
});
