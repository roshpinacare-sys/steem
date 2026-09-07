// src/lib/polyglot/incremental.ts
//
// v4.1: INCREMENTAL BUILDS. Instead of rebuilding the entire PDF from scratch,
// compare the new ZIP against the previous build's files and only encode the
// changes. This is dramatically faster for large codebases where most files
// don't change between builds.
//
// Flow:
//   1. Extract the previous PDF's files (if a base PDF is provided).
//   2. Compare against the new ZIP's files.
//   3. If nothing changed → return the previous PDF (no rebuild needed).
//   4. If files changed → build a new PDF with ALL files (the text layer
//      needs the full file set for readability), but mark the delta in the
//      manifest's `incrementalInfo` field.
//   5. The manifest carries `incrementalInfo: { baseMerkleRoot, changedFiles,
//      addedCount, modifiedCount, deletedCount, unchangedCount }` so an agent
//      can see what changed without diffing.
//
// NOTE: the PDF always contains the FULL file set (for readability). The
// "incremental" part is:
//   - The build is faster (we skip re-hashing/deduping unchanged files by
//     reusing the previous build's manifest entries for unchanged files).
//   - The manifest records what changed (so agents can focus on the diff).
//   - The delta protocol can be used to produce a minimal delta from the
//     previous PDF to the new one.

import { sha256HexSync } from "./bytes";
import { fileHash } from "./merkle";
import { createDelta, type FileEntry } from "./delta";
import type { FullManifest } from "./types";

export interface IncrementalInfo {
  baseMerkleRoot: string;
  changedFiles: { name: string; action: "added" | "modified" | "deleted" | "unchanged" }[];
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  unchangedCount: number;
  buildTimeMs: number;
  isIncremental: boolean;
}

/**
 * Compare two file sets and produce an IncrementalInfo describing what changed.
 */
export function computeIncrementalInfo(
  baseFiles: FileEntry[],
  newFiles: FileEntry[],
  baseMerkleRoot: string,
  buildTimeMs: number
): IncrementalInfo {
  const baseMap = new Map<string, string>(); // name → sha
  for (const f of baseFiles) baseMap.set(f.name, sha256HexSync(f.bytes));

  const newMap = new Map<string, string>();
  for (const f of newFiles) newMap.set(f.name, sha256HexSync(f.bytes));

  const changedFiles: { name: string; action: "added" | "modified" | "deleted" | "unchanged" }[] = [];
  let added = 0, modified = 0, deleted = 0, unchanged = 0;

  // Check new files (added or modified or unchanged).
  for (const f of newFiles) {
    const baseSha = baseMap.get(f.name);
    if (!baseSha) {
      changedFiles.push({ name: f.name, action: "added" });
      added++;
    } else if (baseSha !== sha256HexSync(f.bytes)) {
      changedFiles.push({ name: f.name, action: "modified" });
      modified++;
    } else {
      changedFiles.push({ name: f.name, action: "unchanged" });
      unchanged++;
    }
  }

  // Check deleted files (in base but not in new).
  for (const f of baseFiles) {
    if (!newMap.has(f.name)) {
      changedFiles.push({ name: f.name, action: "deleted" });
      deleted++;
    }
  }

  return {
    baseMerkleRoot,
    changedFiles,
    addedCount: added,
    modifiedCount: modified,
    deletedCount: deleted,
    unchangedCount: unchanged,
    buildTimeMs,
    isIncremental: added > 0 || modified > 0 || deleted > 0,
  };
}

/**
 * Quick check: has anything actually changed between two file sets?
 * If not, the build can be skipped entirely (return the previous PDF).
 */
export function hasChanges(baseFiles: FileEntry[], newFiles: FileEntry[]): boolean {
  if (baseFiles.length !== newFiles.length) return true;
  const baseMap = new Map<string, string>();
  for (const f of baseFiles) baseMap.set(f.name, sha256HexSync(f.bytes));
  for (const f of newFiles) {
    const baseSha = baseMap.get(f.name);
    if (!baseSha || baseSha !== sha256HexSync(f.bytes)) return true;
  }
  return false;
}
