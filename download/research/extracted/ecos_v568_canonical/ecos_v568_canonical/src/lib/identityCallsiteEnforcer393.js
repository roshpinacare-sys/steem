'use strict';
/**
 * lib/identityCallsiteEnforcer393.js — ECOS V393 (Phase P281) — Identity Call-Site Enforcement
 *
 * Direction 1 (V393): Enforce the V392 identity gate at existing economic call-sites.
 * V392 added requireIdentityAuth392 as an available gate; V393 makes it non-optional:
 *   • credit transfer calls must pass a signed V391 identity claim
 *   • reward issuance calls must pass a signed V391 identity claim
 * A bypass flag (ECOS_IDENTITY_BYPASS_DAYS env or opts.bypassDays) allows unsigned
 * requests for a configurable migration window (days from V393 epoch).
 *
 * Exports:
 *   createIdentityCallsiteEnforcer393(opts)
 *     — { enforceTransfer393, enforceReward393, bypassActive393, stats393 }
 *
 * Pure JS, Node built-ins only (R3). All identifiers end with 393 (R2).
 * Sacred files untouched (R1). V361–V392 preserved (R6).
 *
 * @version 393.0.0
 */

const IDENTITY_CALLSITE_ENFORCER_VERSION_393  = '393.0.0';
const IDENTITY_CALLSITE_ENFORCER_SCHEMA_393   = 'ecos.sovereign.identity.callsite.enforcer/v393';
const IDENTITY_CALLSITE_ENFORCE_EVENT_393     = 'identity_callsite_enforce_event_type_393';
const IDENTITY_CALLSITE_BYPASS_EVENT_393      = 'identity_callsite_bypass_event_type_393';
const IDENTITY_CALLSITE_REJECT_EVENT_393      = 'identity_callsite_reject_event_type_393';

// V393 epoch: the date this version was cut (ISO string)
// Bypass window = epoch + bypassDays; if now < windowEnd, bypass is active.
const IDENTITY_CALLSITE_EPOCH_393 = '2026-06-03T00:00:00.000Z';

class IdentityCallsiteEnforcerError393 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name  = 'IdentityCallsiteEnforcerError393';
    this.code  = code || 'ENFORCE_ERROR';
    this.statusCode = 403;
  }
}

/**
 * Create the call-site enforcer.
 *
 * @param {object} opts
 * @param {object}   opts.gate              — identityEconomyGate392 instance (requireIdentityAuth392)
 * @param {function} [opts.audit]           — (type, payload) => void
 * @param {object}   [opts.logger]
 * @param {number}   [opts.bypassDays]      — days since epoch to allow unsigned requests (0 = off)
 *                                             Overridden by ECOS_IDENTITY_BYPASS_DAYS env var
 */
function createIdentityCallsiteEnforcer393(opts = {}) {
  if (!opts.gate || typeof opts.gate.requireIdentityAuth392 !== 'function') {
    throw new IdentityCallsiteEnforcerError393(
      'identityCallsiteEnforcer393: opts.gate must expose requireIdentityAuth392()',
      'BAD_CONFIG'
    );
  }

  const gate  = opts.gate;
  const audit = typeof opts.audit === 'function' ? opts.audit : null;
  const log   = opts.logger || console;

  // bypass window: env overrides opts when explicitly set, default 0 (bypass off)
  const _envRaw = process.env.ECOS_IDENTITY_BYPASS_DAYS;
  const _envDays = _envRaw !== undefined ? parseInt(_envRaw, 10) : NaN;
  const _bypassDays = Number.isFinite(_envDays) && _envDays >= 0 ? _envDays
    : (Number.isFinite(opts.bypassDays) && opts.bypassDays >= 0 ? opts.bypassDays : 0);

  const _epoch393 = new Date(IDENTITY_CALLSITE_EPOCH_393).getTime();

  const _stats393 = {
    transfersEnforced:  0,
    transfersBypassed:  0,
    transfersRejected:  0,
    rewardsEnforced:    0,
    rewardsBypassed:    0,
    rewardsRejected:    0,
  };

  /**
   * Returns true if the migration bypass window is currently active.
   * @returns {boolean}
   */
  function bypassActive393() {
    if (_bypassDays <= 0) return false;
    const nowMs = Date.now();
    const windowEnd = _epoch393 + _bypassDays * 24 * 60 * 60 * 1000;
    return nowMs < windowEnd;
  }

  /**
   * Enforce identity gate for a credit-transfer action.
   *
   * @param {string} actorId           — account/actor id
   * @param {object} [claim]           — signed V391 identity claim (may be absent during bypass)
   * @param {string|Buffer} [signature]— claim signature
   * @param {string} [rawPubkey]       — raw ed25519 pubkey hex (for create-path)
   * @returns {{ ok: true, actorId, bypassed?: true, identity? }}
   */
  function enforceTransfer393(actorId, claim, signature, rawPubkey) {
    if (!actorId || typeof actorId !== 'string') {
      throw new IdentityCallsiteEnforcerError393('actorId required for transfer', 'NO_ACTOR_ID');
    }

    // bypass window: allow unsigned if window is active AND claim/sig absent
    if (!claim || !signature) {
      if (bypassActive393()) {
        _stats393.transfersBypassed++;
        if (audit) {
          try {
            audit(IDENTITY_CALLSITE_BYPASS_EVENT_393, {
              action: 'credit_transfer', actorId, reason: 'bypass_window_active', ts: new Date().toISOString(),
            });
          } catch (_) {}
        }
        return { ok: true, actorId, bypassed: true, action: 'credit_transfer' };
      }
      _stats393.transfersRejected++;
      if (audit) {
        try {
          audit(IDENTITY_CALLSITE_REJECT_EVENT_393, {
            action: 'credit_transfer', actorId, reason: 'identity_claim_required', ts: new Date().toISOString(),
          });
        } catch (_) {}
      }
      throw new IdentityCallsiteEnforcerError393(
        'credit transfer requires a signed V391 identity claim (bypass window closed)',
        'IDENTITY_REQUIRED'
      );
    }

    let authResult;
    try {
      authResult = gate.requireIdentityAuth392(actorId, claim, signature, rawPubkey, 'credit_transfer');
    } catch (e) {
      _stats393.transfersRejected++;
      if (audit) {
        try {
          audit(IDENTITY_CALLSITE_REJECT_EVENT_393, {
            action: 'credit_transfer', actorId, reason: e.code || e.message, ts: new Date().toISOString(),
          });
        } catch (_) {}
      }
      throw e; // re-throw original gate error
    }

    _stats393.transfersEnforced++;
    if (audit) {
      try {
        audit(IDENTITY_CALLSITE_ENFORCE_EVENT_393, {
          action: 'credit_transfer', actorId, ts: new Date().toISOString(),
        });
      } catch (_) {}
    }
    return { ok: true, actorId, identity: authResult, action: 'credit_transfer' };
  }

  /**
   * Enforce identity gate for a reward-issuance action.
   *
   * @param {string} actorId
   * @param {object} [claim]
   * @param {string|Buffer} [signature]
   * @param {string} [rawPubkey]
   * @returns {{ ok: true, actorId, bypassed?: true, identity? }}
   */
  function enforceReward393(actorId, claim, signature, rawPubkey) {
    if (!actorId || typeof actorId !== 'string') {
      throw new IdentityCallsiteEnforcerError393('actorId required for reward issuance', 'NO_ACTOR_ID');
    }

    if (!claim || !signature) {
      if (bypassActive393()) {
        _stats393.rewardsBypassed++;
        if (audit) {
          try {
            audit(IDENTITY_CALLSITE_BYPASS_EVENT_393, {
              action: 'reward_issuance', actorId, reason: 'bypass_window_active', ts: new Date().toISOString(),
            });
          } catch (_) {}
        }
        return { ok: true, actorId, bypassed: true, action: 'reward_issuance' };
      }
      _stats393.rewardsRejected++;
      if (audit) {
        try {
          audit(IDENTITY_CALLSITE_REJECT_EVENT_393, {
            action: 'reward_issuance', actorId, reason: 'identity_claim_required', ts: new Date().toISOString(),
          });
        } catch (_) {}
      }
      throw new IdentityCallsiteEnforcerError393(
        'reward issuance requires a signed V391 identity claim (bypass window closed)',
        'IDENTITY_REQUIRED'
      );
    }

    let authResult;
    try {
      authResult = gate.requireIdentityAuth392(actorId, claim, signature, rawPubkey, 'reward_issuance');
    } catch (e) {
      _stats393.rewardsRejected++;
      if (audit) {
        try {
          audit(IDENTITY_CALLSITE_REJECT_EVENT_393, {
            action: 'reward_issuance', actorId, reason: e.code || e.message, ts: new Date().toISOString(),
          });
        } catch (_) {}
      }
      throw e;
    }

    _stats393.rewardsEnforced++;
    if (audit) {
      try {
        audit(IDENTITY_CALLSITE_ENFORCE_EVENT_393, {
          action: 'reward_issuance', actorId, ts: new Date().toISOString(),
        });
      } catch (_) {}
    }
    return { ok: true, actorId, identity: authResult, action: 'reward_issuance' };
  }

  function stats393() {
    return {
      ..._stats393,
      bypassActive: bypassActive393(),
      bypassDays:   _bypassDays,
      epochMs:      _epoch393,
      version:      IDENTITY_CALLSITE_ENFORCER_VERSION_393,
    };
  }

  return {
    enforceTransfer393,
    enforceReward393,
    bypassActive393,
    stats393,
    IDENTITY_CALLSITE_ENFORCER_VERSION_393,
    IDENTITY_CALLSITE_ENFORCE_EVENT_393,
    IDENTITY_CALLSITE_BYPASS_EVENT_393,
    IDENTITY_CALLSITE_REJECT_EVENT_393,
  };
}

module.exports = {
  createIdentityCallsiteEnforcer393,
  IDENTITY_CALLSITE_ENFORCER_VERSION_393,
  IDENTITY_CALLSITE_ENFORCER_SCHEMA_393,
  IDENTITY_CALLSITE_ENFORCE_EVENT_393,
  IDENTITY_CALLSITE_BYPASS_EVENT_393,
  IDENTITY_CALLSITE_REJECT_EVENT_393,
  IDENTITY_CALLSITE_EPOCH_393,
  IdentityCallsiteEnforcerError393,
};
