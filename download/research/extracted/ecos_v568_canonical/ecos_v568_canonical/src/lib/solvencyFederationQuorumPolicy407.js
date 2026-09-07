'use strict';
/**
 * src/lib/solvencyFederationQuorumPolicy407.js — ECOS V407 (Phase P295) —
 * Federation Quorum Policy.
 *
 * Layers an explicit N-of-M (and/or ratio-based) quorum policy on top of the
 * V406 cross-operator consensus view. Given a V406 snapshot, evaluates
 * whether the agreement count meets the operator-configured quorum, and
 * surfaces a single deterministic `quorumReached` flag plus an audit-ready
 * decision record.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 407 (R2).
 *
 * @version 407.0.0
 */

const crypto = require('crypto');

const QUORUM_POLICY_VERSION_407 = '407.0.0';
const _sha407 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSolvencyFederationQuorumPolicy407(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

  // Defaults: require at least 1 agreeing participant and a 0.5 ratio.
  let policy = {
    requiredAgreements: Number.isFinite(opts.requiredAgreements) ? Math.max(1, opts.requiredAgreements | 0) : 1,
    requiredRatio: typeof opts.requiredRatio === 'number' ? Math.min(1, Math.max(0, opts.requiredRatio)) : 0.5,
    minParticipants: Number.isFinite(opts.minParticipants) ? Math.max(1, opts.minParticipants | 0) : 1,
  };

  function configure407(next) {
    next = next || {};
    if (Number.isFinite(next.requiredAgreements)) {
      policy.requiredAgreements = Math.max(1, next.requiredAgreements | 0);
    }
    if (typeof next.requiredRatio === 'number') {
      policy.requiredRatio = Math.min(1, Math.max(0, next.requiredRatio));
    }
    if (Number.isFinite(next.minParticipants)) {
      policy.minParticipants = Math.max(1, next.minParticipants | 0);
    }
    return Object.assign({}, policy);
  }

  function getPolicy407() { return Object.assign({}, policy); }

  function evaluate407(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('snapshot required');
    const participants = snapshot.participants | 0;
    const agreeingTotal = snapshot.agreeingTotal | 0;
    const ratio = participants > 0 ? agreeingTotal / participants : 0;
    const hadEnoughParticipants = participants >= policy.minParticipants;
    const meetsCount = agreeingTotal >= policy.requiredAgreements;
    const meetsRatio = ratio >= policy.requiredRatio;
    const quorumReached = hadEnoughParticipants && meetsCount && meetsRatio;
    const decisionBody = {
      ts: now(),
      participants, agreeingTotal, ratio,
      policy: Object.assign({}, policy),
      quorumReached,
      liabilityRoot: snapshot.local ? snapshot.local.liabilityRoot : null,
    };
    decisionBody.decisionHash = _sha407('quorum407|' + JSON.stringify(decisionBody));
    return decisionBody;
  }

  return { configure407, getPolicy407, evaluate407 };
}

module.exports = {
  QUORUM_POLICY_VERSION_407,
  createSolvencyFederationQuorumPolicy407,
};
