'use strict';
/**
 * src/lib/proofAttachedReceipts373.js — ECOS V373 (Phase P261)
 *
 * DIRECTION 1: Attach a portable proof to every agentReceipts263 mission,
 * so each completed unit of work ships with a self-verifying integrity proof
 * a client can check offline.
 *
 * Wraps AgentReceipts263: on mission close (recordSplit), issues a
 * portableProof372 over the current ledger/auditLog snapshot and attaches
 * it as `proof373` on the receipt. The proof is also emitted to the audit log
 * as `agentReceipts.mission_proof_issued373`.
 *
 * GET /api/v1/missions/:id/receipt now includes `proof373`.
 * GET /api/v1/missions/:id/receipt/proof returns only the proof (shareable).
 *
 * Pure — no new npm deps (R3). All new identifiers end with 373 (R2).
 * Sacred files untouched (R1). V361..V372 preserved (R6).
 *
 * @version 373.0.0
 */

const { AgentReceipts263 } = require('../lib/agentReceipts263.js');
const PP = require('./portableProof372.js');

const PROOF_ATTACHED_VERSION_373 = '373.0.0';
const MISSION_PROOF_ISSUED_TYPE_373 = 'agentReceipts.mission_proof_issued373';

/**
 * Extends AgentReceipts263 so that when a mission closes (after recordSplit),
 * a portable proof is issued and attached to the receipt.
 *
 * Constructor opts:
 *   ledger        — FiatLedger (for conservation check)
 *   auditLog      — AuditLog (for chain commitment)
 *   reserve       — reserve status (for backing check)
 *   hashFn        — (optional) hash fn from auditLog, for byte-compatibility
 *   canonicalize  — (optional) canon fn from auditLog
 */
class ProofAttachedReceipts373 extends AgentReceipts263 {
  constructor(opts = {}) {
    super(opts);
    this._ledger373     = opts.ledger     || null;
    this._reserve373    = opts.reserve    || null;
    this._hashFn373     = opts.hashFn     || null;
    this._canonicalize373 = opts.canonicalize || null;
    this._proofs373     = new Map(); // missionId → portableProof
  }

  /**
   * Override recordSplit: call super, then issue + attach a portable proof.
   */
  recordSplit263(missionId, split) {
    const result = super.recordSplit263(missionId, split);
    // Receipt is now closed; issue the proof.
    this._issueAndAttachProof373(missionId);
    return result;
  }

  /**
   * Get the portable proof for a closed mission. Returns null if not found.
   */
  getMissionProof373(missionId) {
    return this._proofs373.get(missionId) || null;
  }

  /**
   * Override getReceipt263 to include the proof.
   */
  getReceipt263(missionId) {
    const base = super.getReceipt263(missionId);
    if (!base) return null;
    const proof = this._proofs373.get(missionId) || null;
    return Object.assign({}, base, {
      proof373: proof,
      proofUrl373: `/api/v1/missions/${missionId}/receipt/proof`,
    });
  }

  // ── Internal ────────────────────────────────────────────────────────────

  _issueAndAttachProof373(missionId) {
    try {
      const ctx = {
        ledger:      this._ledger373,
        auditLog:    this._auditLog,
        reserve:     this._reserve373,
        hashFn:      this._hashFn373,
        canonicalize: this._canonicalize373,
      };
      const proof = PP.issuePortableProof372(ctx);
      // Stamp the missionId into the proof and re-derive proofHash to keep proof self-consistent
      const hashFn_ = this._hashFn373 || PP._defaultHash372;
      const canon_  = this._canonicalize373 || PP._defaultCanon372;
      const attachedAt = new Date().toISOString();
      const { proofHash: _oldHash, ...baseBody } = proof;
      const extendedBody = Object.assign({}, baseBody, { missionId373: missionId, attachedAt373: attachedAt });
      const newProofHash = hashFn_(canon_(extendedBody));
      const missionProof = Object.assign({}, extendedBody, { proofHash: newProofHash });
      this._proofs373.set(missionId, missionProof);

      // Emit to audit log so the proof issuance is itself part of the chain
      if (this._auditLog && typeof this._auditLog.append === 'function') {
        try {
          this._auditLog.append(MISSION_PROOF_ISSUED_TYPE_373, {
            missionId,
            proofHash: missionProof.proofHash,
            chainHeadHash: missionProof.chainCommitment && missionProof.chainCommitment.headHash,
            overallIntegrity: missionProof.overallIntegrity,
            ts: missionProof.attachedAt373,
          });
        } catch (_) {}
      }
    } catch (e) {
      // Non-fatal: log but never break mission close
      try { this._log263('PROOF_ERROR', { missionId, error: e.message }); } catch (_) {}
    }
  }
}

module.exports = {
  ProofAttachedReceipts373,
  PROOF_ATTACHED_VERSION_373,
  MISSION_PROOF_ISSUED_TYPE_373,
};
