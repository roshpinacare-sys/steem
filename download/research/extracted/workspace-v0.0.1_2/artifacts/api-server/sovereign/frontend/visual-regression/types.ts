/**
 * frontend/visual-regression/types.ts
 *
 * Type definitions for the zero-dep visual-regression (snapshot/DOM) harness.
 * A "snapshot" here is a deterministic HTML string plus a content hash —
 * no headless browser, no raster diffing. Pure string comparison against a
 * committed golden file is enough because render-html.ts output is
 * byte-deterministic for a given spec.
 */

/** One named snapshot case: a label plus the markup it should produce. */
export interface SnapshotCase {
  name: string;
  html: string;
}

/** Stored golden snapshot file shape (one per snapshot group, e.g. "button"). */
export interface SnapshotFile {
  /** Format version — bump if the on-disk shape ever changes. */
  version: 1;
  /** group name, e.g. "button" | "input" | "table" | "card" */
  group: string;
  entries: Record<string, SnapshotEntry>;
}

export interface SnapshotEntry {
  html: string;
  /** sha256 of html, stored alongside for fast mismatch short-circuit. */
  hash: string;
}

/** Result of comparing live cases against a stored snapshot file. */
export interface DiffResult {
  group: string;
  /** Cases present in both, with matching html. */
  matched: string[];
  /** Cases present in both, with differing html — fail-closed triggers. */
  changed: { name: string; expected: string; actual: string }[];
  /** Cases in the live run not present in the stored snapshot. */
  added: string[];
  /** Cases in the stored snapshot no longer produced live. */
  removed: string[];
}

export function diffIsClean(diff: DiffResult): boolean {
  return diff.changed.length === 0 && diff.added.length === 0 && diff.removed.length === 0;
}
