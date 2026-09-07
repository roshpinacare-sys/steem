'use strict';
/**
 * src/lib/solvencyInclusionRelay405.js — ECOS V405 (Phase P293) —
 * Solvency Inclusion-Proof Relay.
 *
 * Thin relay that stores V403 inclusion proofs keyed by (attestationHash,
 * userId) so users can re-fetch their offline proof against a published
 * attestation without re-running the (expensive) full tree build. The relay
 * verifies each proof against the supplied liability root before accepting
 * it (fail-closed). Pure storage, no key material.
 *
 * No new npm deps (R3). Sacred read-only (R1). Identifiers end in 405 (R2).
 *
 * @version 405.0.0
 */

const path = require('path');
const S403 = require(path.join(__dirname, 'proofOfSolvency403.js'));

const INCLUSION_RELAY_VERSION_405 = '405.0.0';

function createSolvencyInclusionRelay405(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  // key = attestationHash + '|' + userId  →  { proof, storedAt }
  const store = new Map();
  const byAttestation = new Map(); // attestationHash -> Set<userId>

  function _key(attestationHash, userId) { return String(attestationHash) + '|' + String(userId); }

  function storeProof405({ attestationHash, liabilityRoot, userId, proof }) {
    if (!attestationHash || !liabilityRoot || !userId || !proof) {
      throw new Error('attestationHash, liabilityRoot, userId, proof required');
    }
    const v = S403.verifyInclusion403(proof, liabilityRoot);
    if (!v || v.valid !== true) {
      return { ok: false, error: 'inclusion proof failed verification', code: 'BAD_PROOF_405' };
    }
    const k = _key(attestationHash, userId);
    store.set(k, { proof, storedAt: now(), liabilityRoot });
    if (!byAttestation.has(attestationHash)) byAttestation.set(attestationHash, new Set());
    byAttestation.get(attestationHash).add(userId);
    return { ok: true, key: k };
  }

  function fetchProof405({ attestationHash, userId }) {
    const k = _key(attestationHash, userId);
    const rec = store.get(k);
    if (!rec) return { ok: false, error: 'not found', code: 'NOT_FOUND_405' };
    return { ok: true, proof: rec.proof, liabilityRoot: rec.liabilityRoot, storedAt: rec.storedAt };
  }

  function listUsers405(attestationHash) {
    const s = byAttestation.get(attestationHash);
    return s ? Array.from(s.values()) : [];
  }

  function purgeAttestation405(attestationHash) {
    const s = byAttestation.get(attestationHash);
    if (!s) return { ok: true, removed: 0 };
    let removed = 0;
    for (const userId of s) { if (store.delete(_key(attestationHash, userId))) removed++; }
    byAttestation.delete(attestationHash);
    return { ok: true, removed };
  }

  function stats405() {
    return { totalProofs: store.size, attestations: byAttestation.size };
  }

  return { storeProof405, fetchProof405, listUsers405, purgeAttestation405, stats405 };
}

module.exports = {
  INCLUSION_RELAY_VERSION_405,
  createSolvencyInclusionRelay405,
};
