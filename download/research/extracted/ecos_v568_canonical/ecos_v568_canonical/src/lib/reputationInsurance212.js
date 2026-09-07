/**
   * reputationInsurance212.js — Reputation Decay Insurance Market (V212)
   * Sacred files untouched. Zero new npm deps.
   */
  'use strict';
  const _policies212 = new Map();
  const INSURANCE_RATE_PER_DAY_212 = 0.001;
  const INSURANCE_MAX_DAYS_212     = 30;
  const INSURANCE_MIN_DAYS_212     = 1;
  const INSURANCE_MIN_REP_212      = 500;
  const INSURANCE_MAX_POLICIES_212 = 5000;
  function _insErr212(msg, code, status) { const e = new Error(msg); e.code = code; e.statusCode = status || 400; return e; }
  function purchaseInsurance212(workspaceId, body) {
    if (!workspaceId) throw _insErr212('workspaceId required', 'INS_MISSING_WS');
    const { workspaceRep, durationDays, purchaserId } = body || {};
    const rep = Number(workspaceRep) || 0; const days = Number(durationDays) || 0;
    if (!purchaserId) throw _insErr212('purchaserId required', 'INS_MISSING_PURCHASER');
    if (rep < INSURANCE_MIN_REP_212) throw _insErr212(`workspaceRep must be >= ${INSURANCE_MIN_REP_212} to qualify`, 'INS_INSUFFICIENT_REP');
    if (days < INSURANCE_MIN_DAYS_212 || days > INSURANCE_MAX_DAYS_212) throw _insErr212(`durationDays must be ${INSURANCE_MIN_DAYS_212}–${INSURANCE_MAX_DAYS_212}`, 'INS_BAD_DURATION');
    const existing = _policies212.get(workspaceId);
    if (existing && !existing.expired && new Date(existing.coverageEndsAt).getTime() > Date.now()) throw _insErr212('Active policy already exists for workspace', 'INS_ACTIVE_EXISTS');
    if (_policies212.size >= INSURANCE_MAX_POLICIES_212) throw _insErr212('Policy registry full', 'INS_CAPACITY', 503);
    const fee = Math.round(INSURANCE_RATE_PER_DAY_212 * days * rep * 100) / 100;
    const now = new Date();
    const coverageEndsAt = new Date(now.getTime() + days * 86400_000).toISOString();
    const policyId = 'ins212_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    _policies212.set(workspaceId, { policyId, workspaceId, purchaserId, workspaceRep: rep, durationDays: days, fee, purchasedAt: now.toISOString(), coverageEndsAt, expired: false });
    return { ok: true, policyId, workspaceId, fee, durationDays: days, coverageEndsAt };
  }
  function getInsurance212(workspaceId) {
    const policy = _policies212.get(workspaceId);
    if (!policy) throw _insErr212('No policy found for workspace ' + workspaceId, 'INS_NOT_FOUND', 404);
    return { ok: true, policy: { ...policy, active: !policy.expired && new Date(policy.coverageEndsAt).getTime() > Date.now() } };
  }
  function cancelInsurance212(workspaceId, body) {
    const { cancellerId } = body || {};
    if (!cancellerId) throw _insErr212('cancellerId required', 'INS_MISSING_CANCELLER');
    const policy = _policies212.get(workspaceId);
    if (!policy) throw _insErr212('No policy found', 'INS_NOT_FOUND', 404);
    if (policy.expired) throw _insErr212('Policy already expired/cancelled', 'INS_ALREADY_EXPIRED');
    policy.expired = true; policy.cancelledBy = cancellerId; policy.cancelledAt = new Date().toISOString();
    return { ok: true, policyId: policy.policyId, workspaceId, cancelledAt: policy.cancelledAt };
  }
  function isInsured212(workspaceId) {
    const policy = _policies212.get(workspaceId);
    return !!(policy && !policy.expired && new Date(policy.coverageEndsAt).getTime() > Date.now());
  }
  module.exports = { purchaseInsurance212, getInsurance212, cancelInsurance212, isInsured212, _policies212, INSURANCE_RATE_PER_DAY_212, INSURANCE_MAX_DAYS_212, INSURANCE_MIN_REP_212 };
  