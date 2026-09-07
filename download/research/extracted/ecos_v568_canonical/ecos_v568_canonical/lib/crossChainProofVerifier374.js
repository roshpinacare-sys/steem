'use strict';
/**
 * src/lib/crossChainProofVerifier374.js — ECOS V374 (Phase P262)
 *
 * DIRECTION 3: Cross-chain proof verification — extend verifyPortableProof373
 * to accept the persisted commitment (from V373-T02) alongside the in-memory
 * one and reject if the two commitments diverge (in-memory vs DB head mismatch
 * = integrity anomaly).
 *
 * Exports:
 *   verifyCrossChainProof374(proof, snapshot, opts)
 *     — pure (async because it may read auditRepo).
 *       Returns { valid, crossChainStatus, checks, mismatches, anomaly? }.
 *
 *   CROSS_CHAIN_VERIFIER_VERSION_374  — '374.0.0'
 *   INTEGRITY_ANOMALY_TYPE_374        — audit log event type for anomalies
 *   CROSS_CHAIN_VERIFIED_TYPE_374     — audit log event type for clean passes
 *
 * Cross-chain contract:
 *   - If proof has NO persistedChainCommitment: cross-chain check is SKIPPED
 *     (backwards-compatible with V372 proofs).
 *   - If proof HAS persistedChainCommitment AND committed:true on both sides:
 *     headHash and length MUST match the in-memory chainCommitment.
 *     Mismatch → anomaly = true, valid = false.
 *   - If persistedChainCommitment.committed is false (DB unavailable):
 *     cross-chain check is SKIPPED (non-fatal, noted in crossChainStatus).
 *
 * Also exports appendIntegrityAnomaly374(auditLog, details) for wiring into
 * server middleware that auto-appends the anomaly event on detection.
 *
 * Pure (R3 — no new npm deps). All new identifiers end with 374 (R2).
 * Sacred untouched (R1). V361..V373 preserved (R6).
 *
 * @version 374.0.0
 */

const { verifyPortableProof373 } = require('../verifier373.js');

const CROSS_CHAIN_VERIFIER_VERSION_374 = '374.0.0';
const INTEGRITY_ANOMALY_TYPE_374       = 'integrity.cross_chain_anomaly374';
const CROSS_CHAIN_VERIFIED_TYPE_374    = 'integrity.cross_chain_verified374';

/**
 * Extend verifyPortableProof373 with cross-chain divergence detection.
 *
 * @param {object} proof       — portable proof (V372 or V373 shape)
 * @param {object} [snapshot]  — audit/ledger snapshot (same as V372/V373)
 * @param {{
 *   hashFn?:      (s:string)=>string,
 *   canonicalize?: (v:any)=>string,
 *   auditLog?:    object,    // AuditLog — to append anomaly/verified events
 *   emitEvents?:  boolean,   // default true — emit to auditLog when provided
 * }} [opts]
 * @returns {{ valid: boolean, crossChainStatus: string, checks: object, mismatches: string[], anomaly: boolean }}
 */
function verifyCrossChainProof374(proof, snapshot, opts) {
  const o = opts || {};
  const snap = snapshot || {};

  // 1. Run the base V373 verification (proofHash + chain + conservation + split)
  const base = verifyPortableProof373(proof, snap, {
    hashFn:      o.hashFn,
    canonicalize: o.canonicalize,
  });

  // 2. Cross-chain check
  let crossChainStatus = 'skipped';
  let anomaly = false;
  const crossChecks = {};

  const inMem    = proof && proof.chainCommitment;
  const persisted = proof && proof.persistedChainCommitment;

  if (!persisted) {
    crossChainStatus = 'no-persisted-commitment (V372 proof — cross-chain check skipped)';
  } else if (!persisted.committed) {
    crossChainStatus = 'persisted-commitment-unavailable (DB was down at proof issuance — skipped)';
  } else if (!inMem || !inMem.committed) {
    crossChainStatus = 'in-memory-commitment-missing (proof malformed — anomaly)';
    anomaly = true;
    crossChecks.headMatch   = false;
    crossChecks.lengthMatch = false;
    base.mismatches.push('cross-chain: in-memory commitment missing or uncommitted');
  } else {
    // Both sides are committed — compare headHash and length
    const headOk   = inMem.headHash === persisted.headHash;
    const lengthOk = inMem.length   === persisted.length;
    crossChecks.headMatch   = headOk;
    crossChecks.lengthMatch = lengthOk;

    if (headOk && lengthOk) {
      crossChainStatus = 'consistent';
    } else {
      anomaly = true;
      crossChainStatus = 'DIVERGED — in-memory vs DB head mismatch = integrity anomaly';
      if (!headOk) base.mismatches.push(
        `cross-chain head mismatch: in-memory=${inMem.headHash} db=${persisted.headHash}`
      );
      if (!lengthOk) base.mismatches.push(
        `cross-chain length mismatch: in-memory=${inMem.length} db=${persisted.length}`
      );
    }
  }

  // 3. Emit to audit log if requested (default: true when auditLog provided)
  const shouldEmit = o.emitEvents !== false && o.auditLog &&
    typeof o.auditLog.append === 'function';
  if (shouldEmit) {
    const eventType = anomaly ? INTEGRITY_ANOMALY_TYPE_374 : CROSS_CHAIN_VERIFIED_TYPE_374;
    try {
      o.auditLog.append(eventType, {
        valid:            base.valid && !anomaly,
        crossChainStatus,
        anomaly,
        proofHash:        proof && proof.proofHash,
        inMemHeadHash:    inMem  && inMem.headHash,
        persistedHeadHash: persisted && persisted.headHash,
        version:          CROSS_CHAIN_VERIFIER_VERSION_374,
        ts:               new Date().toISOString(),
      });
    } catch (_) {} // never break the caller
  }

  const allChecks = Object.assign({}, base.checks, crossChecks);
  const valid = base.valid && !anomaly;

  return {
    valid,
    crossChainStatus,
    anomaly,
    checks:    allChecks,
    mismatches: base.mismatches,
    verifier:  CROSS_CHAIN_VERIFIER_VERSION_374,
  };
}

/**
 * Convenience: append an integrity anomaly event to an audit log.
 * Safe to call from middleware; never throws.
 *
 * @param {object} auditLog  — AuditLog instance
 * @param {object} details   — free-form details to include
 */
function appendIntegrityAnomaly374(auditLog, details) {
  if (!auditLog || typeof auditLog.append !== 'function') return;
  try {
    auditLog.append(INTEGRITY_ANOMALY_TYPE_374, Object.assign({
      version: CROSS_CHAIN_VERIFIER_VERSION_374,
      ts:      new Date().toISOString(),
    }, details));
  } catch (_) {}
}

module.exports = {
  CROSS_CHAIN_VERIFIER_VERSION_374,
  INTEGRITY_ANOMALY_TYPE_374,
  CROSS_CHAIN_VERIFIED_TYPE_374,
  verifyCrossChainProof374,
  appendIntegrityAnomaly374,
};
