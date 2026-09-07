'use strict';
/**
 * lib/identityCommitmentChain393.js — ECOS V393 (Phase P281) — Identity Commitment Proof Chain
 *
 * Direction 4 (V393): Build a tamper-evident linked chain from all
 * identity_action_log_commitment_event_type_392 audit entries, mirroring
 * buildKeyRotationManifestChain381 for the identity-commitment surface.
 *
 * V392's identityRegistry flush appends an identity_action_log_commitment_event_type_392
 * audit entry containing a sha256 commitment over the registry snapshot. V393 assembles
 * these commitments into a linked chain: each node hashes the prior commitment,
 * so the chain is tamper-evident from genesis to head.
 *
 * Exports:
 *   createIdentityCommitmentChain393(opts)
 *     — { buildIdentityCommitmentChain393, verifyIdentityCommitmentChain393, stats393 }
 *
 * Pure JS, Node built-ins only (R3). All identifiers end with 393 (R2).
 * Sacred files untouched (R1). V361–V392 preserved (R6).
 *
 * @version 393.0.0
 */

const crypto = require('crypto');

const IDENTITY_COMMITMENT_CHAIN_VERSION_393  = '393.0.0';
const IDENTITY_COMMITMENT_CHAIN_SCHEMA_393   = 'ecos.sovereign.identity.commitment.chain/v393';
const IDENTITY_COMMITMENT_BUILD_EVENT_393    = 'identity_commitment_chain_build_event_type_393';

// The V392 event type we aggregate
const IDENTITY_COMMITMENT_SOURCE_TYPE_392    = 'identity_action_log_commitment_event_type_392';

// Genesis sentinel (zeroed 32 bytes, hex)
const GENESIS_PRIOR_HASH_393 = '0'.repeat(64);

class IdentityCommitmentChainError393 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name  = 'IdentityCommitmentChainError393';
    this.code  = code || 'COMMITMENT_CHAIN_ERROR';
    this.statusCode = 400;
  }
}

const _sha256hex = (input) =>
  crypto.createHash('sha256').update(typeof input === 'string' ? input : JSON.stringify(input)).digest('hex');

/**
 * Create an identity commitment chain builder.
 *
 * @param {object} opts
 * @param {object}   opts.auditLog   — audit log instance
 * @param {function} [opts.audit]    — (type, payload) => void  (to append build events to sacred log)
 * @param {object}   [opts.logger]
 */
function createIdentityCommitmentChain393(opts = {}) {
  if (!opts.auditLog) {
    throw new IdentityCommitmentChainError393(
      'identityCommitmentChain393: opts.auditLog required',
      'BAD_CONFIG'
    );
  }

  const auditLog = opts.auditLog;
  const audit    = typeof opts.audit === 'function' ? opts.audit : null;
  const _stats393 = { builds: 0, verifications: 0, nodesLinked: 0 };

  /**
   * Read commitment entries from the audit log.
   * @returns {Array<{ commitment, ts, payload }>}
   */
  function _readCommitmentEntries393() {
    let allEntries = [];
    try {
      if (typeof auditLog.readAll === 'function') {
        allEntries = auditLog.readAll();
      } else if (typeof auditLog.entries === 'function') {
        allEntries = [...auditLog.entries()];
      } else if (typeof auditLog.getAll === 'function') {
        allEntries = auditLog.getAll();
      } else if (auditLog._entries && Array.isArray(auditLog._entries)) {
        allEntries = auditLog._entries;
      } else if (auditLog._log && Array.isArray(auditLog._log)) {
        allEntries = auditLog._log;
      } else {
        for (const e of auditLog) { allEntries.push(e); }
      }
    } catch (e) {
      throw new IdentityCommitmentChainError393(`auditLog read failed: ${e.message}`, 'AUDIT_READ_FAILED');
    }

    const commitments = [];
    for (const entry of allEntries) {
      const type    = entry.type    || entry.eventType;
      const payload = entry.payload || entry.data || {};
      const ts      = entry.ts || entry.timestamp || entry.createdAt || null;

      if (type !== IDENTITY_COMMITMENT_SOURCE_TYPE_392) continue;

      // commitment may be in payload.commitment or payload.sha256 or payload.hash
      const commitment = payload.commitment || payload.sha256 || payload.hash || null;

      commitments.push({ commitment, ts, payload });
    }

    // sort by ts ascending (genesis first)
    commitments.sort((a, b) => {
      if (!a.ts && !b.ts) return 0;
      if (!a.ts) return 1;
      if (!b.ts) return -1;
      return new Date(a.ts).getTime() - new Date(b.ts).getTime();
    });

    return commitments;
  }

  /**
   * Build the linked commitment chain from all V392 flush events.
   *
   * Each chain node:
   * {
   *   index:      number        (0-based)
   *   ts:         string|null
   *   commitment: string|null   (the raw sha256 commitment from V392 flush)
   *   priorHash:  string        (sha256 of the prior node's nodeHash; GENESIS for index 0)
   *   nodeHash:   string        (sha256 of { index, commitment, priorHash, ts })
   *   payload:    object        (original audit log payload)
   * }
   *
   * @param {object} [opts2]
   * @param {boolean} [opts2.includePayloads] — include raw payloads in output (default true)
   * @returns {{ ok: true, chain, headHash, genesisHash, length, version }}
   */
  function buildIdentityCommitmentChain393(opts2 = {}) {
    const includePayloads = opts2.includePayloads !== false;

    const entries = _readCommitmentEntries393();

    const chain = [];
    let priorHash = GENESIS_PRIOR_HASH_393;

    for (let i = 0; i < entries.length; i++) {
      const { commitment, ts, payload } = entries[i];

      const nodeInput = {
        index:      i,
        commitment: commitment || null,
        priorHash,
        ts:         ts || null,
      };
      const nodeHash = _sha256hex(JSON.stringify(nodeInput));

      const node = {
        index:      i,
        ts:         ts || null,
        commitment: commitment || null,
        priorHash,
        nodeHash,
      };
      if (includePayloads) node.payload = payload;

      chain.push(node);
      priorHash = nodeHash;
    }

    const headHash    = chain.length > 0 ? chain[chain.length - 1].nodeHash : GENESIS_PRIOR_HASH_393;
    const genesisHash = chain.length > 0 ? chain[0].nodeHash                : GENESIS_PRIOR_HASH_393;

    _stats393.builds++;
    _stats393.nodesLinked += chain.length;

    if (audit) {
      try {
        audit(IDENTITY_COMMITMENT_BUILD_EVENT_393, {
          length: chain.length, headHash, ts: new Date().toISOString(),
        });
      } catch (_) {}
    }

    return {
      ok: true,
      chain,
      headHash,
      genesisHash,
      length: chain.length,
      version: IDENTITY_COMMITMENT_CHAIN_VERSION_393,
    };
  }

  /**
   * Verify the integrity of a previously built chain.
   * Recomputes every nodeHash and checks priorHash linkage.
   *
   * @param {Array}  chain    — chain array from buildIdentityCommitmentChain393
   * @returns {{ ok: true, valid, broken?, brokenAt? }}
   */
  function verifyIdentityCommitmentChain393(chain) {
    if (!Array.isArray(chain)) {
      throw new IdentityCommitmentChainError393('chain must be an array', 'BAD_CHAIN');
    }

    _stats393.verifications++;

    if (chain.length === 0) return { ok: true, valid: true, length: 0, version: IDENTITY_COMMITMENT_CHAIN_VERSION_393 };

    let priorHash = GENESIS_PRIOR_HASH_393;

    for (let i = 0; i < chain.length; i++) {
      const node = chain[i];

      // Check priorHash linkage
      if (node.priorHash !== priorHash) {
        return {
          ok: true, valid: false,
          broken: 'priorHash_mismatch',
          brokenAt: i,
          expected: priorHash,
          got: node.priorHash,
          version: IDENTITY_COMMITMENT_CHAIN_VERSION_393,
        };
      }

      // Recompute nodeHash
      const nodeInput = {
        index:      node.index,
        commitment: node.commitment || null,
        priorHash:  node.priorHash,
        ts:         node.ts        || null,
      };
      const expected = _sha256hex(JSON.stringify(nodeInput));

      if (node.nodeHash !== expected) {
        return {
          ok: true, valid: false,
          broken: 'nodeHash_mismatch',
          brokenAt: i,
          expected,
          got: node.nodeHash,
          version: IDENTITY_COMMITMENT_CHAIN_VERSION_393,
        };
      }

      priorHash = node.nodeHash;
    }

    return {
      ok: true, valid: true,
      length: chain.length,
      headHash: chain[chain.length - 1].nodeHash,
      version: IDENTITY_COMMITMENT_CHAIN_VERSION_393,
    };
  }

  function stats393() {
    return { ..._stats393, version: IDENTITY_COMMITMENT_CHAIN_VERSION_393 };
  }

  return {
    buildIdentityCommitmentChain393,
    verifyIdentityCommitmentChain393,
    stats393,
    IDENTITY_COMMITMENT_CHAIN_VERSION_393,
    IDENTITY_COMMITMENT_CHAIN_SCHEMA_393,
    IDENTITY_COMMITMENT_SOURCE_TYPE_392,
    GENESIS_PRIOR_HASH_393,
  };
}

module.exports = {
  createIdentityCommitmentChain393,
  IDENTITY_COMMITMENT_CHAIN_VERSION_393,
  IDENTITY_COMMITMENT_CHAIN_SCHEMA_393,
  IDENTITY_COMMITMENT_BUILD_EVENT_393,
  IDENTITY_COMMITMENT_SOURCE_TYPE_392,
  GENESIS_PRIOR_HASH_393,
  IdentityCommitmentChainError393,
};
