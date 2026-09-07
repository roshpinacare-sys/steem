'use strict';
/**
 * lib/identityEconomyGate392.js — ECOS V392 (Phase P280) — Identity-Economy Gate
 *
 * Direction 1 (V392): Require a valid signed V391 sovereign-identity claim for economic
 * actions — credit transfer, reward issuance, receipt creation. Before this, any actor
 * who knew an account id could act as it. This closes impersonation at the money layer.
 *
 * Pattern: wraps a SovereignIdentityVM391 instance and exposes a single
 *   requireIdentityAuth392(actorId, claim, signature, rawPubkey) → { ok, identity }
 * that resolves before any economic action is allowed.
 *
 * Every AUTHORISED call is appended to the sacred audit log (type:
 * 'identity_economy_auth_event_type_392') so the auth chain is tamper-evident.
 *
 * @version 392.0.0
 * @see AI_PROTOCOL_V392 R2: all identifiers end with 392
 */

const IDENTITY_ECONOMY_GATE_VERSION_392 = '392.0.0';
const IDENTITY_ECONOMY_GATE_EVENT_TYPE_392 = 'identity_economy_auth_event_type_392';
const IDENTITY_ECONOMY_GATE_REJECT_TYPE_392 = 'identity_economy_reject_event_type_392';

class IdentityEconomyGateError392 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'IdentityEconomyGateError392';
    this.code = code || 'GATE_ERROR';
    this.statusCode = 403;
  }
}

/**
 * Gate that enforces identity ownership before economic actions.
 *
 * @param {object} opts
 * @param {object}   opts.identityVM    — SovereignIdentityVM391 instance (required)
 * @param {function} [opts.audit]       — (type, payload) => void; appended to sacred audit log
 * @param {object}   [opts.logger]      — pino/console-compatible logger
 */
function createIdentityEconomyGate392(opts = {}) {
  if (!opts.identityVM || typeof opts.identityVM.execute !== 'function' || typeof opts.identityVM.status !== 'function') {
    throw new IdentityEconomyGateError392(
      'identityEconomyGate392: opts.identityVM must be a SovereignIdentityVM391 instance',
      'BAD_CONFIG'
    );
  }
  const vm    = opts.identityVM;
  const audit = typeof opts.audit === 'function' ? opts.audit : null;
  const log   = opts.logger || console;

  const _stats392 = { total: 0, authorised: 0, rejected: 0 };

  /**
   * Verify that `actorId` owns an active sovereign identity AND that the provided
   * signed claim is valid for this identity. Rejects if the identity is unknown,
   * revoked, or if the signature is invalid.
   *
   * @param {string}        actorId     — the account id making the economic action
   * @param {object}        claim       — signed identity claim { id, nonce, action }
   * @param {string|Buffer} signature   — 64-byte ed25519 signature (hex or Buffer)
   * @param {string}        [rawPubkey] — only needed on 'create'; resolved from registry otherwise
   * @param {string}        [actionTag] — human-readable label of the economic action being gated
   * @returns {{ ok: true, identity: object, actorId: string }} on success
   * @throws {IdentityEconomyGateError392} on failure
   */
  function requireIdentityAuth392(actorId, claim, signature, rawPubkey, actionTag) {
    _stats392.total++;
    const tag = actionTag || 'economic_action';

    // 1. actorId must match the claim's id (anti-impersonation)
    if (!actorId || typeof actorId !== 'string') {
      _stats392.rejected++;
      if (audit) { try { audit(IDENTITY_ECONOMY_GATE_REJECT_TYPE_392, { reason: 'NO_ACTOR_ID', tag }); } catch (_) {} }
      throw new IdentityEconomyGateError392('actorId is required', 'NO_ACTOR_ID');
    }
    if (!claim || claim.id !== actorId) {
      _stats392.rejected++;
      if (audit) { try { audit(IDENTITY_ECONOMY_GATE_REJECT_TYPE_392, { reason: 'ID_MISMATCH', actorId, claimId: claim && claim.id, tag }); } catch (_) {} }
      throw new IdentityEconomyGateError392(
        `identityEconomyGate392: claim.id (${claim && claim.id}) must equal actorId (${actorId})`,
        'ID_MISMATCH'
      );
    }

    // 2. Identity must exist and be active (not revoked)
    const status = vm.status(actorId);
    if (!status.exists) {
      _stats392.rejected++;
      if (audit) { try { audit(IDENTITY_ECONOMY_GATE_REJECT_TYPE_392, { reason: 'UNKNOWN_IDENTITY', actorId, tag }); } catch (_) {} }
      throw new IdentityEconomyGateError392(
        `identityEconomyGate392: identity ${actorId} does not exist — register first`,
        'UNKNOWN_IDENTITY'
      );
    }
    if (status.revoked) {
      _stats392.rejected++;
      if (audit) { try { audit(IDENTITY_ECONOMY_GATE_REJECT_TYPE_392, { reason: 'REVOKED_IDENTITY', actorId, tag }); } catch (_) {} }
      throw new IdentityEconomyGateError392(
        `identityEconomyGate392: identity ${actorId} is revoked`,
        'REVOKED_IDENTITY'
      );
    }

    // 3. Execute the claim through the VM (validates signature, nonce, semanticRoot)
    let result;
    try {
      result = vm.execute(claim, signature, rawPubkey);
    } catch (e) {
      _stats392.rejected++;
      if (audit) { try { audit(IDENTITY_ECONOMY_GATE_REJECT_TYPE_392, { reason: e.code || 'VM_REJECT', actorId, tag, error: e.message }); } catch (_) {} }
      const gateErr = new IdentityEconomyGateError392(
        `identityEconomyGate392: claim verification failed — ${e.message}`,
        e.code || 'CLAIM_INVALID'
      );
      throw gateErr;
    }

    // 4. Authorised — audit-log the successful gate passage
    _stats392.authorised++;
    if (audit) {
      try {
        audit(IDENTITY_ECONOMY_GATE_EVENT_TYPE_392, {
          actorId,
          tag,
          claimNonce: claim.nonce,
          claimActionType: (claim.action && claim.action.type) || 'unknown',
          ts: new Date().toISOString(),
        });
      } catch (_) {}
    }

    return { ok: true, identity: vm.status(actorId), actorId };
  }

  /** Stats snapshot for the summary endpoint */
  function stats392() {
    return { ..._stats392, version: IDENTITY_ECONOMY_GATE_VERSION_392 };
  }

  return {
    requireIdentityAuth392,
    stats392,
    IDENTITY_ECONOMY_GATE_VERSION_392,
    IDENTITY_ECONOMY_GATE_EVENT_TYPE_392,
  };
}

module.exports = {
  createIdentityEconomyGate392,
  IDENTITY_ECONOMY_GATE_VERSION_392,
  IDENTITY_ECONOMY_GATE_EVENT_TYPE_392,
  IDENTITY_ECONOMY_GATE_REJECT_TYPE_392,
  IdentityEconomyGateError392,
};
