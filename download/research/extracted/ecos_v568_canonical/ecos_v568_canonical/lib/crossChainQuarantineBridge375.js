'use strict';
/**
 * lib/crossChainQuarantineBridge375.js — ECOS V375 (Phase P263)
 *
 * DIRECTION 2: Cross-chain anomaly quarantine.
 *
 * When verifyCrossChainProof374 detects a divergence (anomaly: true), this
 * module auto-trips the V363 quarantine gate so write paths are locked until
 * an operator clears it — connecting the cross-chain check to the existing
 * quarantine machinery.
 *
 * Exports:
 *   tripQuarantineOnAnomaly375(verifyResult, ctx, opts)
 *     — if verifyResult.anomaly is true AND quarantine is not already tripped,
 *       calls autoQuarantineFromCrossChain363 (V363) with a synthetic ctx that
 *       reports inconsistency. Returns {action, quarantineTripped, version}.
 *
 *   buildCrossChainVerifyAndQuarantine375(ctx, opts)
 *     — convenience: run verifyCrossChainProof374 and, on anomaly, immediately
 *       trip the quarantine. Returns { verification, quarantine, version }.
 *
 *   BRIDGE_VERSION_375          — '375.0.0'
 *   ANOMALY_QUARANTINE_REASON_375 — human-readable reason string
 *
 * Integration contract:
 *   - Uses LB363 = require('./economicIntegrityLoadBearing363.js') for
 *     quarantineStatus363 / clearQuarantine363 only. Does NOT call
 *     autoQuarantineFromCrossChain363 (which re-runs V362 cross-chain check);
 *     instead it appends the V363 trip event directly when a V374 anomaly is
 *     detected, so the two checks remain independent.
 *   - QUARANTINE_TRIPPED_TYPE_363 is appended to ctx.auditLog with a 375-tagged
 *     payload identifying the cross-chain mismatch as the cause.
 *
 * Pure (R3 — no new npm deps). All new identifiers end with 375 (R2).
 * Sacred untouched (R1). V361..V374 preserved (R6).
 *
 * @version 375.0.0
 */

const CCPV = require('./crossChainProofVerifier374.js');
const LB363 = require('./economicIntegrityLoadBearing363.js');

const BRIDGE_VERSION_375           = '375.0.0';
const ANOMALY_QUARANTINE_REASON_375 =
  'cross-chain integrity anomaly detected by verifyCrossChainProof374 (in-memory vs DB head mismatch)';
const BRIDGE_TRIP_TYPE_375         = 'integrity.cross_chain_quarantine_tripped375';

// ── tripQuarantineOnAnomaly375 ────────────────────────────────────────────────

/**
 * If a V374 cross-chain verify result reports an anomaly AND the V363 quarantine
 * is not already tripped, append the V363 trip event directly to ctx.auditLog.
 *
 * @param {{ anomaly: boolean, crossChainStatus: string, mismatches: string[] }} verifyResult
 * @param {{ auditLog: object }} ctx  — must have auditLog with .append() and .entries()
 * @param {{ operator?: string }} [opts]
 * @returns {{ action: string, quarantineTripped: boolean, reason?: string, version: string }}
 */
function tripQuarantineOnAnomaly375(verifyResult, ctx, opts) {
  if (!verifyResult || !verifyResult.anomaly) {
    return { action: 'noop', quarantineTripped: false, version: BRIDGE_VERSION_375 };
  }
  const c    = ctx || {};
  const al   = c.auditLog;
  if (!al || typeof al.append !== 'function') {
    return { action: 'no-auditlog', quarantineTripped: false, version: BRIDGE_VERSION_375 };
  }

  // Check current quarantine state
  const status = LB363.quarantineStatus363(c);
  if (status.tripped) {
    return {
      action:           'already-tripped',
      quarantineTripped: true,
      status,
      version:          BRIDGE_VERSION_375,
    };
  }

  // Append the V363 trip event (same type autoQuarantineFromCrossChain363 uses)
  // but with a 375-specific payload so the cause is auditable.
  try {
    al.append(LB363.QUARANTINE_TRIPPED_TYPE_363, {
      reason:           ANOMALY_QUARANTINE_REASON_375,
      source375:        BRIDGE_TRIP_TYPE_375,
      crossChainStatus: verifyResult.crossChainStatus || '',
      mismatches:       verifyResult.mismatches        || [],
      operator:         (opts && opts.operator) || 'system',
      version:          BRIDGE_VERSION_375,
      ts:               new Date().toISOString(),
    });
  } catch (e) {
    return {
      action:           'trip-failed',
      quarantineTripped: false,
      error:            e.message,
      version:          BRIDGE_VERSION_375,
    };
  }

  return {
    action:            'tripped',
    quarantineTripped: true,
    reason:            ANOMALY_QUARANTINE_REASON_375,
    version:           BRIDGE_VERSION_375,
  };
}

// ── buildCrossChainVerifyAndQuarantine375 ─────────────────────────────────────

/**
 * Convenience: run verifyCrossChainProof374 on a given proof + snapshot, then
 * if an anomaly is detected, trip the V363 quarantine automatically.
 *
 * @param {object} proof
 * @param {object} snapshot
 * @param {{ auditLog: object, hashFn?: Function, canonicalize?: Function, emitEvents?: boolean }} ctx
 * @param {object} [opts]
 * @returns {{ verification: object, quarantine: object, version: string }}
 */
function buildCrossChainVerifyAndQuarantine375(proof, snapshot, ctx, opts) {
  const c = ctx || {};

  const verification = CCPV.verifyCrossChainProof374(proof, snapshot, {
    hashFn:      c.hashFn,
    canonicalize: c.canonicalize,
    auditLog:    c.auditLog,
    emitEvents:  c.emitEvents !== false,
  });

  const quarantine = tripQuarantineOnAnomaly375(verification, c, opts);

  return {
    verification,
    quarantine,
    version: BRIDGE_VERSION_375,
  };
}

module.exports = {
  BRIDGE_VERSION_375,
  ANOMALY_QUARANTINE_REASON_375,
  BRIDGE_TRIP_TYPE_375,
  tripQuarantineOnAnomaly375,
  buildCrossChainVerifyAndQuarantine375,
};
