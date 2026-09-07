'use strict';
/**
 * lib/crossChainAutoHeal376.js — ECOS V376 (Phase P264)
 *
 * DIRECTION 2: Cross-chain quarantine auto-clear on consistency.
 *
 * When POST /proof/cross-chain-verify-and-quarantine detects `consistent`
 * (no anomaly) AND the quarantine was tripped by a prior bridge call
 * (i.e. tagged with `source375`), this module automatically calls
 * `clearQuarantine363` — self-healing without operator action.
 *
 * Exports:
 *   AUTO_HEAL_VERSION_376            — '376.0.0'
 *   AUTO_HEAL_SCHEMA_376             — schema tag
 *   AUTO_HEAL_OPERATOR_376           — synthetic operator id used by auto-clear
 *   AUTO_HEAL_CLEARED_TYPE_376       — audit event type
 *   maybeSelfHealQuarantine376(ctx, verifyResult, opts)
 *     — If quarantine is tripped AND it was tripped by source375 AND
 *       verifyResult.anomaly is falsy (consistent), auto-clears quarantine.
 *       Returns { action, cleared, version }.
 *   buildCrossChainVerifyAutoHeal376(proof, snapshot, ctx, opts)
 *     — full pipeline: verify → maybe trip (via V375 bridge) → maybe auto-clear.
 *
 * Pure (R3). All new identifiers end with 376 (R2). Sacred untouched (R1).
 * V361..V375 preserved (R6).
 *
 * @version 376.0.0
 */

const LB363  = require('./economicIntegrityLoadBearing363.js');
const CCQB   = require('./crossChainQuarantineBridge375.js');

const AUTO_HEAL_VERSION_376      = '376.0.0';
const AUTO_HEAL_SCHEMA_376       = 'ecos.integrity.cross_chain.auto_heal/v376';
const AUTO_HEAL_OPERATOR_376     = 'system:auto-heal-376';
const AUTO_HEAL_CLEARED_TYPE_376 = 'integrity.cross_chain_quarantine_auto_cleared376';

/**
 * If quarantine is currently tripped, the trip event carries a `source375`
 * tag (meaning it was tripped by the V375 bridge — not by a human operator
 * or the V363 auto-quarantine), AND the latest cross-chain verify result
 * shows no anomaly, auto-clear the quarantine.
 *
 * @param {{ auditLog: object }} ctx
 * @param {{ anomaly: boolean }} verifyResult
 * @param {{ operator?: string }} [opts]
 * @returns {{ action: string, cleared: boolean, reason?: string, version: string }}
 */
function maybeSelfHealQuarantine376(ctx, verifyResult, opts) {
  const c  = ctx || {};
  const al = c.auditLog;
  if (!al || typeof al.entries !== 'function') {
    return { action: 'no-auditlog', cleared: false, version: AUTO_HEAL_VERSION_376 };
  }

  // If there is an anomaly, do nothing — let the quarantine stay.
  if (verifyResult && verifyResult.anomaly) {
    return { action: 'anomaly-present', cleared: false, version: AUTO_HEAL_VERSION_376 };
  }

  // Check whether quarantine is tripped.
  const status = LB363.quarantineStatus363(c);
  if (!status.tripped) {
    return { action: 'not-tripped', cleared: false, version: AUTO_HEAL_VERSION_376 };
  }

  // Only auto-clear if the trip came from the V375 bridge (tagged source375).
  // Find the last tripped event and check for source375.
  const entries = al.entries ? al.entries() : [];
  let lastTrip  = null;
  for (const e of entries) {
    if (e.type === LB363.QUARANTINE_TRIPPED_TYPE_363) lastTrip = e;
  }
  // AuditLog stores payload in .payload (not .data)
  const tripPayload = (lastTrip && (lastTrip.payload || lastTrip.data)) || {};
  const isSource375 = typeof tripPayload.source375 === 'string' &&
    tripPayload.source375.includes('375');

  if (!isSource375) {
    return {
      action:  'not-source375',
      cleared: false,
      reason:  'quarantine was not tripped by cross-chain bridge V375; operator clear required',
      version: AUTO_HEAL_VERSION_376,
    };
  }

  // Auto-clear.
  const operator = (opts && opts.operator) || AUTO_HEAL_OPERATOR_376;
  const clearResult = LB363.clearQuarantine363(c, {
    operator,
    reason: AUTO_HEAL_SCHEMA_376 + ': cross-chain consistency confirmed; auto-cleared by V376',
  });

  if (!clearResult.cleared && !clearResult.alreadyClear) {
    return {
      action:  'clear-failed',
      cleared: false,
      error:   clearResult.error || 'clearQuarantine363 returned cleared:false',
      version: AUTO_HEAL_VERSION_376,
    };
  }

  // Emit a 376-specific audit event for observability.
  try {
    al.append(AUTO_HEAL_CLEARED_TYPE_376, {
      operator,
      reason:   AUTO_HEAL_SCHEMA_376,
      version:  AUTO_HEAL_VERSION_376,
      ts:       new Date().toISOString(),
    });
  } catch (_) { /* non-fatal */ }

  return {
    action:   'auto-cleared',
    cleared:  true,
    operator,
    version:  AUTO_HEAL_VERSION_376,
  };
}

/**
 * Full pipeline: run V375 verify+quarantine, then maybe auto-clear.
 *
 * @param {object} proof
 * @param {object} snapshot
 * @param {{ auditLog: object, hashFn?: Function, canonicalize?: Function }} ctx
 * @param {object} [opts]
 * @returns {{ verification: object, quarantine: object, autoHeal: object, version: string }}
 */
function buildCrossChainVerifyAutoHeal376(proof, snapshot, ctx, opts) {
  const c = ctx || {};

  // Step 1: verify + maybe trip quarantine (V375)
  const { verification, quarantine } = CCQB.buildCrossChainVerifyAndQuarantine375(
    proof, snapshot, c, opts
  );

  // Step 2: maybe auto-clear (V376)
  const autoHeal = maybeSelfHealQuarantine376(c, verification, opts);

  return {
    verification,
    quarantine,
    autoHeal,
    version: AUTO_HEAL_VERSION_376,
  };
}

module.exports = {
  AUTO_HEAL_VERSION_376,
  AUTO_HEAL_SCHEMA_376,
  AUTO_HEAL_OPERATOR_376,
  AUTO_HEAL_CLEARED_TYPE_376,
  maybeSelfHealQuarantine376,
  buildCrossChainVerifyAutoHeal376,
};
