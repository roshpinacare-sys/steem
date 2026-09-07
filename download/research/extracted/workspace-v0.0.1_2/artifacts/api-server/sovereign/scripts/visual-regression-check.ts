/**
 * scripts/visual-regression-check.ts
 *
 * CLI for the zero-dep visual-regression harness (frontend/visual-regression/).
 * Until now `updateAllSnapshots()` and `runVisualRegression()` were only
 * reachable from inside test code — there was no ops-facing way to check or
 * regenerate the golden snapshots outside of writing ad-hoc JS. This gives
 * CI and operators a single command for both.
 *
 * Usage (run from artifacts/api-server/sovereign/):
 *   node scripts/visual-regression-check.ts            # check: exit 0 if clean, 1 if not
 *   node scripts/visual-regression-check.ts --update    # explicitly regenerate goldens, then verify
 *   node scripts/visual-regression-check.ts --dir <path> # override snapshot dir (testing only)
 *
 * --update is a separate, explicit flag — never run implicitly on a failed
 * check, so a real regression can't "fix itself" silently in CI.
 *
 * Exit codes: 0 = clean (or update succeeded and re-verified clean), 1 = diff
 * found (or update somehow left a diff — fail-closed, never claims success
 * it didn't observe).
 */

import {
  runVisualRegression,
  updateAllSnapshots,
  allClean,
} from "../frontend/visual-regression/harness.ts";
import type { DiffResult } from "../frontend/visual-regression/types.ts";

function parseArgs(argv: string[]): { update: boolean; dir?: string } {
  const update = argv.includes("--update");
  const dirFlagIndex = argv.indexOf("--dir");
  const dir = dirFlagIndex !== -1 ? argv[dirFlagIndex + 1] : undefined;
  if (dirFlagIndex !== -1 && !dir) {
    throw new Error("--dir requires a path argument");
  }
  return { update, dir };
}

function printResults(results: DiffResult[]): void {
  for (const r of results) {
    const parts: string[] = [];
    if (r.changed.length) parts.push(`${r.changed.length} changed`);
    if (r.added.length) parts.push(`${r.added.length} added`);
    if (r.removed.length) parts.push(`${r.removed.length} removed`);
    if (parts.length === 0) {
      console.log(`  ✓ ${r.group}: clean (${r.matched.length} matched)`);
    } else {
      console.log(`  ✗ ${r.group}: ${parts.join(", ")} (${r.matched.length} matched)`);
      for (const c of r.changed) console.log(`      changed: ${c.name}`);
      for (const n of r.added) console.log(`      added:   ${n}`);
      for (const n of r.removed) console.log(`      removed: ${n}`);
    }
  }
}

function main(): void {
  const { update, dir } = parseArgs(process.argv.slice(2));

  if (update) {
    console.log("=== Visual Regression: updating golden snapshots ===");
    updateAllSnapshots(dir);
    // Re-run immediately to verify the write actually produced a clean diff —
    // never report success without observing it.
    const verify = runVisualRegression(dir);
    printResults(verify);
    if (!allClean(verify)) {
      console.error("\nUpdate did not produce a clean diff — see above. Exiting 1.");
      process.exit(1);
    }
    console.log("\nSnapshots updated and verified clean.");
    process.exit(0);
  }

  console.log("=== Visual Regression: checking against committed snapshots ===");
  const results = runVisualRegression(dir);
  printResults(results);
  if (!allClean(results)) {
    console.error("\nVisual regression detected. Run with --update to regenerate goldens (only after confirming the change is intentional).");
    process.exit(1);
  }
  console.log("\nAll groups clean.");
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(`\nvisual-regression-check failed: ${(err as Error).message}`);
  process.exit(1);
}
