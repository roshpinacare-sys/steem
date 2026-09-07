/**
 * frontend/visual-regression/harness.ts
 *
 * Orchestrates the visual-regression run: for every fixture group, diff its
 * live HTML output against the stored golden snapshot. Designed to run in
 * the zero-dep sandbox with no headless browser — "visual" regression here
 * means "the exact markup a component produces hasn't silently drifted."
 */

import { join } from "node:path";
import { allFixtureGroups } from "./fixtures.ts";
import { diffAgainstSnapshot, writeSnapshot } from "./snapshot.ts";
import { diffIsClean } from "./types.ts";
import type { DiffResult } from "./types.ts";

const SNAPSHOT_DIR = join(import.meta.dirname, "__snapshots__");

function snapshotPath(group: string): string {
  return join(SNAPSHOT_DIR, `${group}.snap.json`);
}

/**
 * Run the full visual-regression suite; returns one DiffResult per group.
 * @param snapshotDir Optional override of the golden-snapshot directory
 *   (used by scripts/visual-regression-check.ts for --dir, and by tests, so
 *   real snapshots are never touched). Defaults to the real __snapshots__ dir.
 */
export function runVisualRegression(snapshotDir: string = SNAPSHOT_DIR): DiffResult[] {
  const groups = allFixtureGroups();
  return Object.entries(groups).map(([group, cases]) =>
    diffAgainstSnapshot(join(snapshotDir, `${group}.snap.json`), group, cases)
  );
}

/** True iff every group's diff is clean (no changed/added/removed cases). */
export function allClean(results: DiffResult[]): boolean {
  return results.every(diffIsClean);
}

/**
 * Regenerate golden snapshots from current live output for every group.
 * Explicit, separate entry point — never called implicitly by the test run,
 * so a snapshot can't silently "fix itself" by being regenerated on failure.
 * @param snapshotDir Optional override (see runVisualRegression).
 */
export function updateAllSnapshots(snapshotDir: string = SNAPSHOT_DIR): void {
  const groups = allFixtureGroups();
  for (const [group, cases] of Object.entries(groups)) {
    writeSnapshot(join(snapshotDir, `${group}.snap.json`), group, cases);
  }
}

export { snapshotPath };
