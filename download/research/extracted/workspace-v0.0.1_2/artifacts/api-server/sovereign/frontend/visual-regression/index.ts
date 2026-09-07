/**
 * TFA Frontend Visual-Regression Harness — zero-dep snapshot/DOM testing.
 *
 * Runs the canonical component-primitive fixtures (Button/Input/Table/Card ×
 * six states) through the deterministic HTML serializer and diffs the
 * result against committed golden snapshots. No headless browser, no raster
 * diffing — markup-level regression detection only. Zero runtime
 * dependencies (node:fs, node:crypto, node:path built-ins only).
 */

export type { SnapshotCase, SnapshotFile, SnapshotEntry, DiffResult } from "./types.ts";
export { diffIsClean } from "./types.ts";

export { readSnapshot, writeSnapshot, diffAgainstSnapshot } from "./snapshot.ts";

export {
  buttonFixtures,
  inputFixtures,
  tableFixtures,
  cardFixtures,
  allFixtureGroups,
} from "./fixtures.ts";

export { runVisualRegression, allClean, updateAllSnapshots, snapshotPath } from "./harness.ts";
