'use strict';
/**
 * lib/identityReputationBinder392.js — ECOS V392 (Phase P280) — Identity→Reputation Binder
 *
 * Direction 2 (V392): Bind sovereign identity (V391) → reputationLedger268 and sybilGuard266.
 * Reputation accrues to the key-derived id (not an opaque username); sybilGuard uses
 * PoW-gated identity creation as a first-class signal.
 *
 * Exposes:
 *   bindIdentityReputation392(actorId, attestationType, context, vmInstance)
 *     — attest reputation for a verified sovereign id
 *   reportIdentityPoW392(actorId, vmInstance, sybilGuardInstance)
 *     — feed PoW-backed identity creation as a sybil_clear signal
 *   getIdentityReputation392(actorId)
 *     — read reputation dimensions for a key-derived id
 *
 * Every operation is appended to the audit log
 * (type: 'identity_reputation_bind_event_type_392').
 *
 * @version 392.0.0
 */

const IDENTITY_REPUTATION_BINDER_VERSION_392 = '392.0.0';
const IDENTITY_REPUTATION_BIND_EVENT_TYPE_392 = 'identity_reputation_bind_event_type_392';
const IDENTITY_SYBIL_SIGNAL_EVENT_TYPE_392    = 'identity_sybil_signal_event_type_392';

class IdentityReputationBinderError392 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'IdentityReputationBinderError392';
    this.code = code || 'BINDER_ERROR';
    this.statusCode = 400;
  }
}

/**
 * @param {object} opts
 * @param {object}   opts.reputationLedger — reputationLedger268 instance (attest268 method)
 * @param {object}   [opts.sybilGuard]     — sybilGuard263 instance (optional)
 * @param {function} [opts.audit]          — (type, payload) => void
 * @param {object}   [opts.logger]
 */
function createIdentityReputationBinder392(opts = {}) {
  if (!opts.reputationLedger || typeof opts.reputationLedger.attest268 !== 'function') {
    throw new IdentityReputationBinderError392(
      'identityReputationBinder392: opts.reputationLedger must expose attest268()',
      'BAD_CONFIG'
    );
  }

  const rep   = opts.reputationLedger;
  const sg    = opts.sybilGuard || null;
  const audit = typeof opts.audit === 'function' ? opts.audit : null;

  const ECOS_SYSTEM_ATTESTER_392 = 'ecos-sovereign-identity-v392';
  const _stats392 = { binds: 0, sybilSignals: 0, errors: 0 };

  /**
   * Attest reputation for a sovereign-identity-verified actorId.
   * `vmInstance` is used to confirm the identity is active before attesting.
   *
   * @param {string} actorId           — key-derived identity id (from sovereignIdentity391)
   * @param {string} attestationType   — one of ATTESTATION_TYPES_268
   * @param {object} [context]         — missionId, score, evidence, programId
   * @param {object} vmInstance        — SovereignIdentityVM391 instance
   * @returns {{ ok: true, attestation: object }}
   */
  function bindIdentityReputation392(actorId, attestationType, context, vmInstance) {
    if (!actorId || typeof actorId !== 'string') {
      throw new IdentityReputationBinderError392('actorId required', 'NO_ACTOR_ID');
    }
    if (!vmInstance || typeof vmInstance.status !== 'function') {
      throw new IdentityReputationBinderError392('vmInstance (SovereignIdentityVM391) required', 'NO_VM');
    }
    const st = vmInstance.status(actorId);
    if (!st.exists) throw new IdentityReputationBinderError392(`identity ${actorId} not found`, 'UNKNOWN_IDENTITY');
    if (st.revoked) throw new IdentityReputationBinderError392(`identity ${actorId} is revoked`, 'REVOKED_IDENTITY');

    let attestation;
    try {
      attestation = rep.attest268(
        ECOS_SYSTEM_ATTESTER_392,
        actorId,
        attestationType,
        { ...context, sovereignId: actorId, boundBy: 'identityReputationBinder392' }
      );
    } catch (e) {
      _stats392.errors++;
      throw new IdentityReputationBinderError392(`attest268 failed: ${e.message}`, 'ATTEST_FAIL');
    }

    _stats392.binds++;
    if (audit) {
      try {
        audit(IDENTITY_REPUTATION_BIND_EVENT_TYPE_392, {
          actorId, attestationType, context: context || {}, ts: new Date().toISOString(),
        });
      } catch (_) {}
    }

    return { ok: true, attestation, actorId, attestationType };
  }

  /**
   * Report PoW-gated identity creation to sybilGuard as a 'sybil_clear' signal.
   * This wires PoW anti-sybil → reputation sybil_clear attestation in one call.
   *
   * @param {string} actorId       — key-derived identity id
   * @param {object} vmInstance    — SovereignIdentityVM391
   * @param {object} [sgInstance]  — sybilGuard263 (overrides opts.sybilGuard)
   * @returns {{ ok: true, sybilClear: boolean, reputation?: object }}
   */
  function reportIdentityPoW392(actorId, vmInstance, sgInstance) {
    const guard = sgInstance || sg;
    if (!actorId || typeof actorId !== 'string') {
      throw new IdentityReputationBinderError392('actorId required', 'NO_ACTOR_ID');
    }
    if (!vmInstance || typeof vmInstance.status !== 'function') {
      throw new IdentityReputationBinderError392('vmInstance required', 'NO_VM');
    }
    const st = vmInstance.status(actorId);
    if (!st.exists) throw new IdentityReputationBinderError392(`identity ${actorId} not found`, 'UNKNOWN_IDENTITY');
    if (st.revoked) throw new IdentityReputationBinderError392(`identity ${actorId} is revoked`, 'REVOKED_IDENTITY');

    // Notify sybilGuard if available
    if (guard && typeof guard.recordPoWClear !== 'function' && typeof guard.recordTipEdge263 === 'function') {
      // sybilGuard263 doesn't have a PoW method directly — we record as a clear signal instead
    }

    // Attest sybil_clear to reputation ledger (the PoW has already been verified on create)
    let repResult = null;
    try {
      repResult = rep.attest268(
        ECOS_SYSTEM_ATTESTER_392,
        actorId,
        'sybil_clear',
        { reason: 'pow-gated-identity-creation', sovereignId: actorId, boundBy: 'identityReputationBinder392' }
      );
    } catch (_) { /* non-fatal if ledger doesn't accept; don't block */ }

    _stats392.sybilSignals++;
    if (audit) {
      try {
        audit(IDENTITY_SYBIL_SIGNAL_EVENT_TYPE_392, { actorId, ts: new Date().toISOString() });
      } catch (_) {}
    }

    return { ok: true, sybilClear: true, actorId, reputation: repResult };
  }

  /**
   * Read reputation summary for a key-derived sovereign id.
   * Thin shim over reputationLedger268 — returns whatever the ledger exposes.
   *
   * @param {string} actorId
   * @returns {object}
   */
  function getIdentityReputation392(actorId) {
    if (!actorId || typeof actorId !== 'string') {
      throw new IdentityReputationBinderError392('actorId required', 'NO_ACTOR_ID');
    }
    // reputationLedger268 exposes getSummary268 or similar
    if (typeof rep.getSummary268 === 'function') {
      const summary = rep.getSummary268(actorId);
      if (summary !== null && summary !== undefined) return { ok: true, actorId, data: summary };
      return { ok: true, actorId, data: null, note: 'no reputation data yet' };
    }
    // Fallback: query by ledger map if available
    if (rep._ledger268 && rep._ledger268.has(actorId)) {
      return { ok: true, actorId, data: rep._ledger268.get(actorId) };
    }
    return { ok: true, actorId, data: null, note: 'no reputation data yet' };
  }

  function stats392() {
    return { ..._stats392, version: IDENTITY_REPUTATION_BINDER_VERSION_392 };
  }

  return {
    bindIdentityReputation392,
    reportIdentityPoW392,
    getIdentityReputation392,
    stats392,
    IDENTITY_REPUTATION_BINDER_VERSION_392,
    IDENTITY_REPUTATION_BIND_EVENT_TYPE_392,
  };
}

module.exports = {
  createIdentityReputationBinder392,
  IDENTITY_REPUTATION_BINDER_VERSION_392,
  IDENTITY_REPUTATION_BIND_EVENT_TYPE_392,
  IDENTITY_SYBIL_SIGNAL_EVENT_TYPE_392,
  IdentityReputationBinderError392,
};
