/**
 * inclusionProof.js — ECOS V122
 * ===============================
 * Merkle Mountain Range (MMR) — append-only accumulator for audit chain
 * membership proofs.
 *
 * Allows any external verifier to prove that a given transaction hash
 * was included in the chain WITHOUT replaying the entire ledger.
 *
 * Algorithm: Gustave's MMR (per MMR specification, Peter Todd 2013 / OpenTimestamps)
 *   - Peaks array: one hash per "mountain" (power-of-2 sized tree)
 *   - Append: add leaf, merge adjacent equal-height peaks
 *   - Root (bagging): H(peakN || H(peakN-1 || ... H(peak1 || peak0)...))
 *   - Proof: sibling path from leaf to peak, then list of other peaks
 *
 * [V122-P13-01] Initial implementation
 */

'use strict';

const crypto = require('node:crypto');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(a, b) {
  const h = crypto.createHash('sha256');
  if (b !== undefined) {
    // Internal node: hash(left || right)
    h.update(Buffer.from(a, 'hex'));
    h.update(Buffer.from(b, 'hex'));
  } else {
    // Leaf: hash(data)
    h.update(Buffer.isBuffer(a) ? a : Buffer.from(a, 'utf8'));
  }
  return h.digest('hex');
}

// ── MerkleMountainRange ───────────────────────────────────────────────────────

class MerkleMountainRange {
  constructor() {
    // _peaks[i] = {hash, height, leafCount}
    this._peaks = [];
    // _leafHashes: for proof generation
    this._leafHashes = [];
    // total leaf count
    this._size = 0;
  }

  /**
   * Append a new leaf.
   * @param {string|Buffer} data — the raw data to hash as leaf
   * @returns {{ leafIndex: number, leafHash: string }} 
   */
  append(data) {
    const leafHash = sha256(data);
    const leafIndex = this._size;
    this._leafHashes.push(leafHash);
    this._size++;

    // Insert as height-0 peak, then merge adjacent equal-height peaks
    let newPeak = { hash: leafHash, height: 0, leafStart: leafIndex, leafEnd: leafIndex };
    while (this._peaks.length > 0) {
      const top = this._peaks[this._peaks.length - 1];
      if (top.height !== newPeak.height) break;
      this._peaks.pop();
      const merged = {
        hash: sha256(top.hash, newPeak.hash),
        height: top.height + 1,
        leafStart: top.leafStart,
        leafEnd: newPeak.leafEnd,
      };
      newPeak = merged;
    }
    this._peaks.push(newPeak);

    return { leafIndex, leafHash };
  }

  /**
   * Bag all peaks into a single root hash.
   * Right-fold: root = H(peakN-1 || H(peakN-2 || ... H(peak1 || peak0)...))
   * Returns null if no leaves appended yet.
   */
  root() {
    if (this._peaks.length === 0) return null;
    // Start from rightmost peak, fold left
    let acc = this._peaks[this._peaks.length - 1].hash;
    for (let i = this._peaks.length - 2; i >= 0; i--) {
      acc = sha256(this._peaks[i].hash, acc);
    }
    return acc;
  }

  /**
   * Generate an inclusion proof for a leaf at index `leafIndex`.
   * Proof format:
   * {
   *   leafIndex: number,
   *   leafHash:  string,
   *   peakIndex: number,   // which peak contains this leaf
   *   siblings:  string[], // sibling hashes from leaf to peak root
   *   peaks:     string[], // all peak hashes (for bagging verification)
   *   root:      string,
   *   size:      number,   // total leaf count at proof time
   * }
   */
  generateProof(leafIndex) {
    if (leafIndex < 0 || leafIndex >= this._size) {
      throw new RangeError(`leafIndex ${leafIndex} out of range [0, ${this._size - 1}]`);
    }

    const leafHash = this._leafHashes[leafIndex];

    // Find which peak contains this leaf
    const peakIndex = this._peaks.findIndex(
      p => p.leafStart <= leafIndex && leafIndex <= p.leafEnd
    );
    if (peakIndex === -1) throw new Error('Internal MMR error: leaf not in any peak');

    const peak = this._peaks[peakIndex];

    // Rebuild the subtree for this peak to extract sibling path
    const siblings = this._extractSiblings(peak, leafIndex);

    return {
      leafIndex,
      leafHash,
      peakIndex,
      // position of the leaf WITHIN its peak subtree — verifyProof needs this to know
      // each sibling's left/right order. Was missing, so any leaf not at position 0
      // failed verification (sibling ordering defaulted to 0). This is the fix.
      posInPeak: leafIndex - peak.leafStart,
      siblings,
      peaks: this._peaks.map(p => p.hash),
      root: this.root(),
      size: this._size,
    };
  }

  /**
   * Verify an inclusion proof (static — no instance needed).
   * @param {object} proof — as returned by generateProof()
   * @returns {{ valid: boolean, reason?: string }}
   */
  static verifyProof(proof) {
    try {
      const { leafIndex, leafHash, peakIndex, siblings, peaks } = proof;

      // Reconstruct peak hash from leaf + siblings
      let current = leafHash;
      // We need the position within the peak subtree to know left/right order.
      // The peak covers leafStart..leafEnd (2^height leaves).
      // We encode position as a bit path from the siblings length.
      const peakHeight = siblings.length;
      const peakLeafCount = 1 << peakHeight; // 2^height

      // Find leafStart for this peak: we don't store it in proof, but we can
      // derive it from peakIndex and peaks structure.
      // Actually, we do need a position indicator. We encode it via the leaf's
      // position within the peak (0-indexed within that mountain).
      // The proof must include leafPosInPeak for this to work independently.
      // Since generateProof includes it implicitly via the sibling path direction,
      // we recover it from the proof.posInPeak field.
      const pos = proof.posInPeak !== undefined ? proof.posInPeak : 0;
      let bitPos = pos;
      for (let i = 0; i < siblings.length; i++) {
        const sibling = siblings[i];
        if (bitPos & 1) {
          current = sha256(sibling, current); // sibling is left
        } else {
          current = sha256(current, sibling); // sibling is right
        }
        bitPos >>= 1;
      }

      // current should equal peaks[peakIndex]
      if (current !== peaks[peakIndex]) {
        return { valid: false, reason: 'peak hash mismatch' };
      }

      // Bag peaks and compare root
      if (peaks.length === 0) return { valid: false, reason: 'empty peaks' };
      let acc = peaks[peaks.length - 1];
      for (let i = peaks.length - 2; i >= 0; i--) {
        acc = sha256(peaks[i], acc);
      }
      if (acc !== proof.root) {
        return { valid: false, reason: 'root hash mismatch after bagging' };
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, reason: err.message };
    }
  }

  /**
   * Serialise to plain object for storage.
   */
  toJSON() {
    return {
      version: 1,
      size: this._size,
      peaks: this._peaks.map(p => ({
        hash: p.hash,
        height: p.height,
        leafStart: p.leafStart,
        leafEnd: p.leafEnd,
      })),
      leafHashes: this._leafHashes,
    };
  }

  /**
   * Restore from serialised object.
   */
  static fromJSON(obj) {
    const mmr = new MerkleMountainRange();
    mmr._size = obj.size;
    mmr._peaks = obj.peaks;
    mmr._leafHashes = obj.leafHashes;
    return mmr;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _extractSiblings(peak, targetLeafIndex) {
    const siblings = [];
    if (peak.height === 0) return siblings; // leaf is the peak itself

    // Reconstruct the subtree's leaves
    const leaves = this._leafHashes.slice(peak.leafStart, peak.leafEnd + 1);
    const posInPeak = targetLeafIndex - peak.leafStart;

    // Build full binary tree layer by layer, record siblings
    let layer = [...leaves];
    let pos = posInPeak;
    while (layer.length > 1) {
      const sibling = (pos % 2 === 0) ? layer[pos + 1] : layer[pos - 1];
      siblings.push(sibling || null); // null if odd (shouldn't happen in complete MMR)
      const nextLayer = [];
      for (let i = 0; i < layer.length; i += 2) {
        nextLayer.push(sha256(layer[i], layer[i + 1] || layer[i]));
      }
      layer = nextLayer;
      pos = Math.floor(pos / 2);
    }
    return siblings;
  }

  /**
   * Stats summary.
   */
  stats() {
    return {
      size: this._size,
      peakCount: this._peaks.length,
      peakHeights: this._peaks.map(p => p.height),
      root: this.root(),
    };
  }
}

// ── Default singleton ─────────────────────────────────────────────────────────

const defaultMMR = new MerkleMountainRange();

module.exports = {
  MerkleMountainRange,
  defaultMMR,
  // expose hash helper for tests
  _sha256: sha256,
};
