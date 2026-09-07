/**
 * frontend/visual-regression/snapshot.ts
 *
 * Snapshot store + comparator for the zero-dep visual-regression harness.
 * Storage is plain JSON on disk under __snapshots__/<group>.snap.json —
 * no binary format, human-reviewable in a diff. Uses only node:fs and
 * node:crypto (built-ins) — zero runtime dependencies.
 *
 * Fail-closed: a missing snapshot file is treated as "no golden" (every
 * case reported as `added`), never as a silent pass. A corrupt snapshot
 * file throws rather than being treated as empty.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SnapshotCase, SnapshotFile, SnapshotEntry, DiffResult } from "./types.ts";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Read a stored snapshot file. Returns null if it doesn't exist (no golden yet). */
export function readSnapshot(filePath: string): SnapshotFile | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`readSnapshot: corrupt snapshot file ${filePath}: ${(err as Error).message}`);
  }
  if (
    parsed == null ||
    typeof parsed !== "object" ||
    (parsed as SnapshotFile).version !== 1 ||
    typeof (parsed as SnapshotFile).group !== "string" ||
    typeof (parsed as SnapshotFile).entries !== "object"
  ) {
    throw new Error(`readSnapshot: malformed snapshot shape in ${filePath}`);
  }
  return parsed as SnapshotFile;
}

/** Write cases as the new golden snapshot file (used by --update mode only). */
export function writeSnapshot(filePath: string, group: string, cases: SnapshotCase[]): void {
  const entries: Record<string, SnapshotEntry> = {};
  for (const c of cases) {
    entries[c.name] = { html: c.html, hash: sha256(c.html) };
  }
  const file: SnapshotFile = { version: 1, group, entries };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(file, null, 2) + "\n", "utf8");
}

/**
 * Compare live cases against a stored snapshot file.
 * Fail-closed: if the file is missing, every case is `added` (never silently matched).
 * Efficiency: hashes each live case once and short-circuits the string compare —
 * on a hash match we skip the (more expensive) full string diff entirely.
 */
export function diffAgainstSnapshot(filePath: string, group: string, cases: SnapshotCase[]): DiffResult {
  const stored = readSnapshot(filePath);
  const matched: string[] = [];
  const changed: { name: string; expected: string; actual: string }[] = [];
  const added: string[] = [];
  const seen = new Set<string>();

  for (const c of cases) {
    seen.add(c.name);
    const golden = stored?.entries[c.name];
    if (!golden) {
      added.push(c.name);
      continue;
    }
    const liveHash = sha256(c.html);
    if (liveHash === golden.hash) {
      matched.push(c.name);
    } else {
      changed.push({ name: c.name, expected: golden.html, actual: c.html });
    }
  }

  const removed: string[] = stored ? Object.keys(stored.entries).filter((n) => !seen.has(n)) : [];

  return { group, matched, changed, added, removed };
}
