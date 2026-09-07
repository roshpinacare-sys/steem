// src/lib/polyglot/merge.ts
//
// v3.3: CONFLICT RESOLUTION FOR BRANCHING DELTAS.
//
// When two agents produce conflicting deltas against the same base (the
// branching case), the system should auto-merge (like git merge) or report
// conflicts. This module implements the merge engine — it sits on TOP of the
// frozen delta protocol (src/lib/polyglot/delta.ts) and never modifies it.
//
// Merge rules (mirrors git's file-level merge):
//   1. If the two deltas touch DIFFERENT files → auto-merge (apply both).
//   2. If both deltas touch the SAME file:
//      a. If both produce identical result bytes → auto-merge (no conflict).
//      b. If results differ → CONFLICT.
//   3. If one delta deletes a file and the other modifies it → CONFLICT.
//   4. If one delta adds a file and the other adds the same path with
//      different content → CONFLICT. (Same content → auto-merge.)
//   5. If both deltas delete the same file → auto-merge (delete).
//
// The merged file set is returned only when there are zero conflicts. When
// conflicts exist, the caller may resolve them with resolveConflict() using a
// strategy ("ours" | "theirs" | "both" | "manual" + content) and rebuild.

import { sha256HexSync } from "./bytes";
import { crc32 } from "./zip-writer";
import type { DeltaStream, DeltaEntry } from "./types";
import type { FileEntry } from "./delta";

/** A single action a delta takes on a file. */
export type DeltaAction = "add" | "modify" | "delete" | "unchanged";

/** The resolved bytes for a delta's action on a path (null = deleted). */
interface ResolvedAction {
  action: Exclude<DeltaAction, "unchanged">;
  bytes: Uint8Array | null; // null for delete
  sha: string; // "" for delete
}

/** A conflict between two deltas on the same path. */
export interface MergeConflict {
  /** The file path that both deltas touched. */
  path: string;
  /** What delta A did to the path. */
  actionA: DeltaAction;
  /** What delta B did to the path. */
  actionB: DeltaAction;
  /** Base64 content from delta A (for add/modify). Omitted for delete. */
  contentA?: string;
  /** Base64 content from delta B (for add/modify). Omitted for delete. */
  contentB?: string;
  /** SHA-256 of delta A's result (empty for delete). */
  shaA?: string;
  /** SHA-256 of delta B's result (empty for delete). */
  shaB?: string;
}

/** A resolution strategy for a conflict. */
export interface ConflictResolution {
  strategy: "ours" | "theirs" | "both" | "manual";
  /** Required for strategy="manual". Base64 content to use. */
  content?: string;
}

/** The result of merging two deltas against a base. */
export interface MergeResult {
  /** The merged file set, or null if there are unresolved conflicts. */
  merged: FileEntry[] | null;
  /** The list of conflicts (empty if auto-merge fully succeeded). */
  conflicts: MergeConflict[];
  /** Number of paths that were auto-merged (different files + identical-result same-file). */
  autoResolved: number;
}

/** Convert a Uint8Array to a base64 string. */
function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[]
    );
  }
  return btoa(s);
}

/** Convert a base64 string to a Uint8Array. */
function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Resolve a single delta entry into the action + resulting bytes.
 * Returns null bytes for "delete" actions.
 */
function resolveEntry(entry: DeltaEntry): ResolvedAction {
  if (entry.action === "delete") {
    return { action: "delete", bytes: null, sha: "" };
  }
  if (!entry.content) {
    throw new Error(`Delta entry ${entry.path}: ${entry.action} missing content`);
  }
  const bytes = base64ToBytes(entry.content);
  // Integrity: CRC32 + SHA-256.
  const computedCrc = crc32(bytes);
  if (computedCrc !== entry.crc32) {
    throw new Error(
      `Delta integrity failure: ${entry.path} CRC32 mismatch (expected ${entry.crc32}, got ${computedCrc})`
    );
  }
  const computedSha = sha256HexSync(bytes);
  if (computedSha !== entry.sha256) {
    throw new Error(
      `Delta integrity failure: ${entry.path} SHA-256 mismatch`
    );
  }
  return { action: entry.action, bytes, sha: computedSha };
}

/**
 * Merge two deltas against a base file set.
 *
 * @param baseFiles  the base file set (extracted from the base PDF)
 * @param deltaA     the first delta (the "ours" side)
 * @param deltaB     the second delta (the "theirs" side)
 * @returns the merge result (merged file set or null + conflicts + autoResolved count)
 */
export function mergeDeltas(
  baseFiles: FileEntry[],
  deltaA: DeltaStream,
  deltaB: DeltaStream
): MergeResult {
  // Build the base map (path → bytes).
  const baseMap = new Map<string, Uint8Array>();
  for (const f of baseFiles) baseMap.set(f.name, f.bytes);

  // Build per-delta entry maps (path → entry).
  const entriesA = new Map<string, DeltaEntry>();
  for (const e of deltaA.entries) entriesA.set(e.path, e);
  const entriesB = new Map<string, DeltaEntry>();
  for (const e of deltaB.entries) entriesB.set(e.path, e);

  // Collect every path touched by either delta.
  const touchedPaths = new Set<string>();
  for (const p of entriesA.keys()) touchedPaths.add(p);
  for (const p of entriesB.keys()) touchedPaths.add(p);

  // Start the merged result with a copy of the base.
  const mergedMap = new Map<string, Uint8Array>();
  for (const f of baseFiles) mergedMap.set(f.name, f.bytes);

  const conflicts: MergeConflict[] = [];
  let autoResolved = 0;

  for (const path of touchedPaths) {
    const entryA = entriesA.get(path);
    const entryB = entriesB.get(path);

    // Resolve each side's action (or "unchanged" if not touched).
    let resA: ResolvedAction | null = null;
    let resB: ResolvedAction | null = null;
    if (entryA) resA = resolveEntry(entryA);
    if (entryB) resB = resolveEntry(entryB);

    const actionA: DeltaAction = resA?.action ?? "unchanged";
    const actionB: DeltaAction = resB?.action ?? "unchanged";

    // Case 1: only A touches this path → apply A.
    if (resA && !resB) {
      if (resA.bytes === null) {
        mergedMap.delete(path);
      } else {
        mergedMap.set(path, resA.bytes);
      }
      autoResolved++;
      continue;
    }

    // Case 2: only B touches this path → apply B.
    if (!resA && resB) {
      if (resB.bytes === null) {
        mergedMap.delete(path);
      } else {
        mergedMap.set(path, resB.bytes);
      }
      autoResolved++;
      continue;
    }

    // Case 3: both touch this path — decide auto-merge vs conflict.
    // (resA and resB are both non-null here.)
    const a = resA as ResolvedAction;
    const b = resB as ResolvedAction;

    // Both delete → auto-merge (delete).
    if (a.action === "delete" && b.action === "delete") {
      mergedMap.delete(path);
      autoResolved++;
      continue;
    }

    // One deletes, the other modifies/adds → CONFLICT.
    if (a.action === "delete" || b.action === "delete") {
      conflicts.push({
        path,
        actionA,
        actionB,
        contentA: a.bytes !== null ? bytesToBase64(a.bytes) : undefined,
        contentB: b.bytes !== null ? bytesToBase64(b.bytes) : undefined,
        shaA: a.sha || undefined,
        shaB: b.sha || undefined,
      });
      continue;
    }

    // Both are add or modify — compare result bytes.
    const sameContent = a.sha === b.sha && a.sha !== "";
    if (sameContent) {
      // Identical result → auto-merge (use either side).
      mergedMap.set(path, a.bytes as Uint8Array);
      autoResolved++;
      continue;
    }

    // Different results → CONFLICT.
    conflicts.push({
      path,
      actionA,
      actionB,
      contentA: a.bytes !== null ? bytesToBase64(a.bytes) : undefined,
      contentB: b.bytes !== null ? bytesToBase64(b.bytes) : undefined,
      shaA: a.sha || undefined,
      shaB: b.sha || undefined,
    });
  }

  // If there are conflicts, return null merged set (caller must resolve).
  const merged: FileEntry[] | null =
    conflicts.length === 0
      ? [...mergedMap.entries()]
          .map(([name, bytes]) => ({ name, bytes }))
          .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
      : null;

  return { merged, conflicts, autoResolved };
}

/**
 * Resolve a single conflict with a resolution strategy.
 *
 * Strategies:
 *   - "ours":   use delta A's result (contentA).
 *   - "theirs": use delta B's result (contentB).
 *   - "both":   union — if both sides have content, concatenate them with a
 *               `\n--- merge ---\n` separator; if one side deletes, keep the
 *               surviving side's content (or delete if both delete).
 *   - "manual": use the caller-provided content (base64-encoded).
 *
 * @param conflict   the conflict to resolve
 * @param resolution the resolution strategy (+ content for "manual")
 * @returns the resolved FileEntry (or a sentinel FileEntry with empty name +
 *          empty bytes to indicate "delete this path")
 */
export function resolveConflict(
  conflict: MergeConflict,
  resolution: ConflictResolution
): FileEntry {
  switch (resolution.strategy) {
    case "ours": {
      if (conflict.contentA === undefined) {
        // A deleted → resolution is "delete".
        return { name: "", bytes: new Uint8Array(0) };
      }
      return { name: conflict.path, bytes: base64ToBytes(conflict.contentA) };
    }
    case "theirs": {
      if (conflict.contentB === undefined) {
        return { name: "", bytes: new Uint8Array(0) };
      }
      return { name: conflict.path, bytes: base64ToBytes(conflict.contentB) };
    }
    case "both": {
      // If both sides have content → concatenate (A first, then B).
      if (conflict.contentA !== undefined && conflict.contentB !== undefined) {
        const aBytes = base64ToBytes(conflict.contentA);
        const bBytes = base64ToBytes(conflict.contentB);
        const sep = new TextEncoder().encode("\n--- merge ---\n");
        const out = new Uint8Array(aBytes.length + sep.length + bBytes.length);
        out.set(aBytes, 0);
        out.set(sep, aBytes.length);
        out.set(bBytes, aBytes.length + sep.length);
        return { name: conflict.path, bytes: out };
      }
      // One side deletes → keep the surviving side.
      if (conflict.contentA !== undefined) {
        return { name: conflict.path, bytes: base64ToBytes(conflict.contentA) };
      }
      if (conflict.contentB !== undefined) {
        return { name: conflict.path, bytes: base64ToBytes(conflict.contentB) };
      }
      // Both delete (shouldn't happen — both-delete is auto-resolved, but
      // defensively treat as delete).
      return { name: "", bytes: new Uint8Array(0) };
    }
    case "manual": {
      if (!resolution.content) {
        throw new Error("manual resolution requires 'content' (base64-encoded)");
      }
      return { name: conflict.path, bytes: base64ToBytes(resolution.content) };
    }
    default:
      throw new Error(`Unknown resolution strategy: ${(resolution as any).strategy}`);
  }
}

/**
 * Apply a list of resolved conflicts to a base file set, producing the final
 * merged file set. Helper for the API layer: it merges the two deltas, then
 * resolves every conflict with the given per-conflict strategy.
 *
 * @param baseFiles  the base file set
 * @param deltaA     the first delta
 * @param deltaB     the second delta
 * @param resolveFor strategy to apply to ALL conflicts ("ours" | "theirs")
 * @returns the final merged file set (always non-null — conflicts are resolved)
 */
export function mergeWithStrategy(
  baseFiles: FileEntry[],
  deltaA: DeltaStream,
  deltaB: DeltaStream,
  resolveFor: "ours" | "theirs"
): { merged: FileEntry[]; conflicts: MergeConflict[]; autoResolved: number } {
  const result = mergeDeltas(baseFiles, deltaA, deltaB);
  if (result.merged) {
    return {
      merged: result.merged,
      conflicts: result.conflicts,
      autoResolved: result.autoResolved,
    };
  }

  // Re-merge from scratch, this time resolving each conflict as we go.
  // We redo the merge because mergeDeltas bailed out before producing a
  // merged set. The simplest correct approach: start from the auto-merged
  // partial state (apply non-conflicting paths) then overlay resolutions.
  const baseMap = new Map<string, Uint8Array>();
  for (const f of baseFiles) baseMap.set(f.name, f.bytes);

  const entriesA = new Map<string, DeltaEntry>();
  for (const e of deltaA.entries) entriesA.set(e.path, e);
  const entriesB = new Map<string, DeltaEntry>();
  for (const e of deltaB.entries) entriesB.set(e.path, e);

  const touchedPaths = new Set<string>();
  for (const p of entriesA.keys()) touchedPaths.add(p);
  for (const p of entriesB.keys()) touchedPaths.add(p);

  // Build a set of conflicted paths for fast lookup.
  const conflictPaths = new Set(result.conflicts.map((c) => c.path));

  const mergedMap = new Map<string, Uint8Array>();
  for (const f of baseFiles) mergedMap.set(f.name, f.bytes);

  for (const path of touchedPaths) {
    if (conflictPaths.has(path)) {
      // Find the conflict + resolve it.
      const c = result.conflicts.find((x) => x.path === path)!;
      const resolved = resolveConflict(c, { strategy: resolveFor });
      if (resolved.name === "") {
        mergedMap.delete(path);
      } else {
        mergedMap.set(path, resolved.bytes);
      }
      continue;
    }
    // Non-conflict path — re-apply (only one side touched it, OR both with
    // identical result).
    const eA = entriesA.get(path);
    const eB = entriesB.get(path);
    if (eA && !eB) {
      const r = resolveEntry(eA);
      if (r.bytes === null) mergedMap.delete(path);
      else mergedMap.set(path, r.bytes);
    } else if (!eA && eB) {
      const r = resolveEntry(eB);
      if (r.bytes === null) mergedMap.delete(path);
      else mergedMap.set(path, r.bytes);
    } else if (eA && eB) {
      // Both touched, identical result — use A.
      const r = resolveEntry(eA);
      if (r.bytes === null) mergedMap.delete(path);
      else mergedMap.set(path, r.bytes);
    }
  }

  const merged: FileEntry[] = [...mergedMap.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));

  return {
    merged,
    conflicts: result.conflicts,
    autoResolved: result.autoResolved,
  };
}
