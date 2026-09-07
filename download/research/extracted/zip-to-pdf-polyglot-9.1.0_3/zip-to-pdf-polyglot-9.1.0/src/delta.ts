// src/lib/polyglot/delta.ts
//
// v3.1: THE DELTA PROTOCOL — the write cycle that makes the PDF a live
// execution context. An agent reads the PDF, analyzes the container state,
// generates an atomic change set (DeltaStream), and the host applies it to
// rebuild a NEW PDF with the updated logic. This enables recursive
// self-improvement: each version knows its parent via deltaProvenance.
//
// The delta is key-value mapped: every file path is a key, every updated
// content block is a value. Each entry carries a CRC32 + SHA-256 for integrity.
//
// Two operations:
//   createDelta(baseFiles, resultFiles) → DeltaStream
//     Compares two file sets, produces the minimal delta.
//   applyDelta(baseFiles, delta) → resultFiles
//     Applies the delta to the base, producing the result file set.
//
// The host then calls buildPolyglot(resultFiles) to produce the new PDF.

import { sha256HexSync } from "./bytes";
import { crc32 } from "./zip-writer";
import { merkleRoot, fileHash } from "./merkle";
import type { DeltaStream, DeltaEntry } from "./types";

/** Convert a Uint8Array to a base64 string (for JSON-serializable delta entries). */
function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[]);
  }
  return btoa(s);
}

/** Convert a base64 string back to a Uint8Array. */
function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export interface FileEntry {
  name: string;
  bytes: Uint8Array;
}

/**
 * Create a delta stream by comparing a base file set to a result file set.
 * Produces the minimal atomic change set (add/modify/delete entries) with
 * CRC32 + SHA-256 integrity for every entry.
 *
 * @param baseFiles   the base file set (extracted from the base PDF)
 * @param resultFiles the target file set (the agent's desired new state)
 * @param author      optional: the agent/system that produced this delta
 * @param description optional: human/agent-readable description
 */
export function createDelta(
  baseFiles: FileEntry[],
  resultFiles: FileEntry[],
  author?: string,
  description?: string
): DeltaStream {
  const baseMap = new Map<string, Uint8Array>();
  for (const f of baseFiles) baseMap.set(f.name, f.bytes);

  const resultMap = new Map<string, Uint8Array>();
  for (const f of resultFiles) resultMap.set(f.name, f.bytes);

  const entries: DeltaEntry[] = [];

  // Add + Modify: iterate result files.
  for (const f of resultFiles) {
    const baseBytes = baseMap.get(f.name);
    if (!baseBytes) {
      // Add: new file not in base.
      entries.push({
        path: f.name,
        action: "add",
        content: bytesToBase64(f.bytes),
        crc32: crc32(f.bytes),
        sha256: sha256HexSync(f.bytes),
      });
    } else {
      // Modify: file exists in base, check if content changed.
      const baseSha = sha256HexSync(baseBytes);
      const resultSha = sha256HexSync(f.bytes);
      if (baseSha !== resultSha) {
        entries.push({
          path: f.name,
          action: "modify",
          content: bytesToBase64(f.bytes),
          crc32: crc32(f.bytes),
          oldCrc32: crc32(baseBytes),
          sha256: resultSha,
        });
      }
      // else: unchanged — no entry needed.
    }
  }

  // Delete: files in base but not in result.
  for (const f of baseFiles) {
    if (!resultMap.has(f.name)) {
      entries.push({
        path: f.name,
        action: "delete",
        crc32: 0,
        oldCrc32: crc32(f.bytes),
        sha256: "",
      });
    }
  }

  // Compute Merkle roots for integrity anchoring.
  const baseRoot = merkleRoot(
    baseFiles.filter((f) => !f.name.endsWith("/")).map((f) => ({ name: f.name, hash: fileHash(f.bytes) }))
  );
  const resultRoot = merkleRoot(
    resultFiles.filter((f) => !f.name.endsWith("/")).map((f) => ({ name: f.name, hash: fileHash(f.bytes) }))
  );

  return {
    version: 1,
    baseMerkleRoot: baseRoot,
    resultMerkleRoot: resultRoot,
    entries,
    createdAt: new Date().toISOString(),
    author,
    description,
  };
}

/**
 * Apply a delta stream to a base file set, producing the result file set.
 * Validates CRC32 + SHA-256 for every entry. Throws on integrity failure.
 *
 * @param baseFiles  the base file set (extracted from the base PDF)
 * @param delta      the delta stream to apply
 * @returns the result file set
 * @throws if any CRC32 or SHA-256 check fails, or if a modify/delete targets a
 *         non-existent file
 */
export function applyDelta(baseFiles: FileEntry[], delta: DeltaStream): FileEntry[] {
  // Start with a copy of the base.
  const result = new Map<string, Uint8Array>();
  for (const f of baseFiles) result.set(f.name, f.bytes);

  for (const entry of delta.entries) {
    if (entry.action === "add") {
      if (!entry.content) throw new Error(`Delta entry ${entry.path}: add missing content`);
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
          `Delta integrity failure: ${entry.path} SHA-256 mismatch (expected ${entry.sha256.slice(0, 16)}..., got ${computedSha.slice(0, 16)}...)`
        );
      }
      result.set(entry.path, bytes);
    } else if (entry.action === "modify") {
      if (!entry.content) throw new Error(`Delta entry ${entry.path}: modify missing content`);
      const baseBytes = result.get(entry.path);
      if (!baseBytes) {
        throw new Error(`Delta entry ${entry.path}: modify targets non-existent file`);
      }
      // Verify old CRC if present (base integrity check).
      if (entry.oldCrc32 !== undefined) {
        const baseCrc = crc32(baseBytes);
        if (baseCrc !== entry.oldCrc32) {
          throw new Error(
            `Delta base integrity failure: ${entry.path} old CRC32 mismatch (expected ${entry.oldCrc32}, got ${baseCrc}) — base may have been modified`
          );
        }
      }
      const bytes = base64ToBytes(entry.content);
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
      result.set(entry.path, bytes);
    } else if (entry.action === "delete") {
      const baseBytes = result.get(entry.path);
      if (!baseBytes) {
        throw new Error(`Delta entry ${entry.path}: delete targets non-existent file`);
      }
      if (entry.oldCrc32 !== undefined) {
        const baseCrc = crc32(baseBytes);
        if (baseCrc !== entry.oldCrc32) {
          throw new Error(
            `Delta base integrity failure: ${entry.path} old CRC32 mismatch on delete`
          );
        }
      }
      result.delete(entry.path);
    }
  }

  // Convert back to FileEntry array (sorted by name for determinism).
  return [...result.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Verify that a delta stream is internally consistent: the resultMerkleRoot
 * matches the Merkle root computed from applying the delta to the base.
 *
 * @param baseFiles  the base file set
 * @param delta      the delta stream
 * @returns true if the result Merkle root matches
 */
export function verifyDelta(baseFiles: FileEntry[], delta: DeltaStream): boolean {
  try {
    const resultFiles = applyDelta(baseFiles, delta);
    const computedRoot = merkleRoot(
      resultFiles.filter((f) => !f.name.endsWith("/")).map((f) => ({ name: f.name, hash: fileHash(f.bytes) }))
    );
    return computedRoot === delta.resultMerkleRoot;
  } catch {
    return false;
  }
}

/**
 * Summarize a delta stream for display (without the heavy content payloads).
 */
export function summarizeDelta(delta: DeltaStream): {
  version: number;
  baseMerkleRoot: string;
  resultMerkleRoot: string;
  entryCount: number;
  added: number;
  modified: number;
  deleted: number;
  createdAt: string;
  author?: string;
  description?: string;
  entries: { path: string; action: string; crc32: number; size: number }[];
} {
  return {
    version: delta.version,
    baseMerkleRoot: delta.baseMerkleRoot,
    resultMerkleRoot: delta.resultMerkleRoot,
    entryCount: delta.entries.length,
    added: delta.entries.filter((e) => e.action === "add").length,
    modified: delta.entries.filter((e) => e.action === "modify").length,
    deleted: delta.entries.filter((e) => e.action === "delete").length,
    createdAt: delta.createdAt,
    author: delta.author,
    description: delta.description,
    entries: delta.entries.map((e) => ({
      path: e.path,
      action: e.action,
      crc32: e.crc32,
      size: e.content ? base64ToBytes(e.content).length : 0,
    })),
  };
}
