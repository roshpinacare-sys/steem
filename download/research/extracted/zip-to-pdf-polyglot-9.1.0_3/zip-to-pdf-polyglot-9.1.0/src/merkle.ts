// src/lib/polyglot/merkle.ts
//
// v2.5: Merkle integrity tree over file content hashes. The root is stored in
// the manifest; an agent can recompute it from the extracted files and compare
// to verify integrity WITHOUT trusting the extractor. This makes the PDF a
// self-verifying artifact — "trust but verify" without a trusted third party.

import { sha256HexSync } from "./bytes";

/** Compute the SHA-256 of a file's bytes (hex). */
export function fileHash(bytes: Uint8Array): string {
  return sha256HexSync(bytes);
}

/**
 * Build a Merkle tree over a list of (name, hash) pairs. Returns the root hash
 * (hex). The tree is built by:
 *   1. Sort the leaves by name (deterministic).
 *   2. Leaf = SHA-256(name + ":" + hash).
 *   3. Internal = SHA-256(left + right). If odd, duplicate the last.
 *   4. Root = the single remaining hash.
 * The root is independent of file ORDER in the archive (we sort by name), so
 * two archives with the same files in different orders produce the same root.
 */
export function merkleRoot(leaves: { name: string; hash: string }[]): string {
  if (leaves.length === 0) return sha256HexSync(new Uint8Array(0)); // empty root
  const sorted = [...leaves].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let level: string[] = sorted.map((l) => sha256HexSync(strToBytes(l.name + ":" + l.hash)));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i]; // duplicate last if odd
      next.push(sha256HexSync(concat(hexToBytes(left), hexToBytes(right))));
    }
    level = next;
  }
  return level[0];
}

/** Verify: given extracted files + a claimed root, recompute and compare. */
export function verifyMerkle(
  files: { name: string; bytes: Uint8Array }[],
  claimedRoot: string
): boolean {
  const leaves = files
    .filter((f) => !f.name.endsWith("/"))
    .map((f) => ({ name: f.name, hash: fileHash(f.bytes) }));
  const computed = merkleRoot(leaves);
  return computed === claimedRoot;
}

// --- helpers (local to avoid import cycle) ---
const te = new TextEncoder();
function strToBytes(s: string): Uint8Array {
  return te.encode(s);
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
