'use strict';
/**
 * src/lib/economicMutationGuard402.js — ECOS V402 (Phase P290) — Economic Mutation Guard
 *
 * Makes money-safety LOAD-BEARING, not merely available. V360/creditReserve gave us
 * the anti-Ponzi reserve invariant, V240 the large-action human gate, V401 the
 * circuit breakers — but a call-site could still mint/withdraw without consulting
 * them. V402 is the SINGLE chokepoint every economic mutation must pass through; it
 * composes all three and returns ALLOW only if ALL pass. Defense-in-depth, fail-closed.
 *
 *   guardMint402     — a NEW-exposure check: (1) V401 per-user/global caps + soft-pause,
 *                      (2) RESERVE INVARIANT — the mint must stay backed
 *                      (outstanding+amount ≤ reserve/peg), else fail-closed,
 *                      (3) V240 — amounts over the large-action threshold need HITL.
 *   guardWithdraw402 — an OUTFLOW check: (1) V401 anti-Celsius exit guarantee +
 *                      throttle, (2) V240 large → HITL. (Reserve invariant never blocks
 *                      a withdrawal — reducing outstanding is always backing-safe.)
 *
 * Each guard returns a decision plus a `commit()` closure the caller invokes AFTER the
 * ledger mutation succeeds, so the breaker's accounting only advances on real success.
 *
 * Pure composition, no new deps (R3/R6). Read-only over sacred. …402.
 *
 * @version 402.0.0
 */

const P401 = require('./userProtection401.js');
const V240 = require('./dangerousToolInterlock240.js');

const GUARD_VERSION_402 = '402.0.0';
const MICROCENTS_PER_USD_402 = 10_000n;          // 10,000 μ¢ = 1 USD (ECOS economy constant)
const LARGE_ACTION_USD_402 = 20;                  // mirrors LARGE_TRANSFER_USD_240

class GuardError402 extends Error {
  constructor(msg, code) { super(msg); this.name = 'GuardError402'; this.code = code || 'GUARD_ERROR'; this.statusCode = 409; }
}
function _big402(v) { try { return typeof v === 'bigint' ? v : BigInt(v); } catch (_) { throw new GuardError402('amount must be integer μ¢', 'BAD_AMOUNT'); } }
function _usdOf402(micro) { return Number(micro) / Number(MICROCENTS_PER_USD_402); }

/**
 * Reserve-invariant check (read-only). Returns {backed, reason} for minting `amountMicro`
 * given a reserve status. Fail-closed: if we cannot determine backing, treat as NOT backed.
 * Accepts {outstandingMicro, reserveMicro} OR {outstanding, reserveBalance, peg}.
 */
function checkReserveBacking402(amountMicro, reserveStatus) {
  const amt = _big402(amountMicro);
  if (!reserveStatus || typeof reserveStatus !== 'object') return { backed: false, reason: 'no reserve status (fail-closed)' };
  let outstandingMicro, reserveMicro;
  try {
    if (reserveStatus.outstandingMicro != null && reserveStatus.reserveMicro != null) {
      outstandingMicro = _big402(reserveStatus.outstandingMicro); reserveMicro = _big402(reserveStatus.reserveMicro);
    } else if (reserveStatus.outstanding != null && reserveStatus.reserveBalance != null) {
      const peg = reserveStatus.peg != null ? _big402(reserveStatus.peg) : MICROCENTS_PER_USD_402;
      outstandingMicro = _big402(reserveStatus.outstanding) * peg; reserveMicro = _big402(reserveStatus.reserveBalance);
    } else { return { backed: false, reason: 'reserve status missing fields (fail-closed)' }; }
  } catch (_) { return { backed: false, reason: 'reserve status unparseable (fail-closed)' }; }
  const backed = (outstandingMicro + amt) <= reserveMicro;
  return { backed, reason: backed ? 'mint stays within reserve backing' : 'mint would exceed reserve backing (anti-Ponzi invariant)',
    outstandingMicro: outstandingMicro.toString(), reserveMicro: reserveMicro.toString() };
}

function _v240Gate402(tool, amountMicro, hitlApproved) {
  const usd = _usdOf402(amountMicro);
  // Primary rule: amounts at/above the large-action threshold need HITL.
  let requiresHitl = usd >= LARGE_ACTION_USD_402;
  // Escalation: honor the V240 classifier if it independently flags this call.
  try {
    const c = V240.classifyToolCall240 ? V240.classifyToolCall240({ tool, amountUsd: usd }) : null;
    if (c && (c.decision === 'require_hitl' || c.requiresHitl === true)) requiresHitl = true;
  } catch (_) {}
  if (requiresHitl && !hitlApproved) return { passed: false, requiresHitl: true, reason: `large action ($${usd}) requires human-in-the-loop approval` };
  return { passed: true, requiresHitl, reason: requiresHitl ? 'HITL approved' : 'below large-action threshold' };
}

function _decision402(allowed, stage, reason, breaker, op, userId, amountMicro, extra = {}) {
  const out = Object.assign({ allowed, stage, reason, op, version: GUARD_VERSION_402 }, extra);
  // commit() advances the breaker's accounting ONLY after the caller's ledger mutation succeeds.
  out.commit = allowed
    ? () => { try { op === 'mint' ? breaker.recordMint(userId, amountMicro) : breaker.recordWithdraw(userId, amountMicro); return true; } catch (_) { return false; } }
    : () => false;
  return out;
}

/**
 * Guard a MINT / new-exposure. ALL of {V401, reserve invariant, V240} must pass.
 * @param {{breaker, userId, amountMicro, reserveStatus, hitlApproved?}} p
 */
function guardMint402(p = {}) {
  const breaker = p.breaker || P401.defaultCircuitBreaker401();
  const userId = p.userId; const amountMicro = _big402(p.amountMicro);
  if (!userId) throw new GuardError402('userId required', 'BAD_ARGS');
  if (amountMicro <= 0n) throw new GuardError402('amount must be > 0', 'BAD_AMOUNT');

  // 1) circuit breakers / caps / soft-pause
  const cb = breaker.checkMint(userId, amountMicro);
  if (!cb.allowed) return _decision402(false, 'circuit_breaker', cb.reason, breaker, 'mint', userId, amountMicro, { code: cb.code, breaker: cb });
  // 2) reserve invariant (anti-Ponzi) — fail-closed
  const rb = checkReserveBacking402(amountMicro, p.reserveStatus);
  if (!rb.backed) return _decision402(false, 'reserve_invariant', rb.reason, breaker, 'mint', userId, amountMicro, { code: 'RESERVE_UNBACKED', reserve: rb });
  // 3) large-action human gate
  const gate = _v240Gate402('credit.mint', amountMicro, p.hitlApproved);
  if (!gate.passed) return _decision402(false, 'hitl', gate.reason, breaker, 'mint', userId, amountMicro, { code: 'REQUIRES_HITL', requiresHitl: true });
  return _decision402(true, 'allowed', 'passed circuit breakers + reserve invariant + HITL gate', breaker, 'mint', userId, amountMicro, { requiresHitl: gate.requiresHitl });
}

/**
 * Guard a WITHDRAW / outflow. V401 (anti-Celsius exit guarantee) + V240 large gate.
 * @param {{breaker, userId, amountMicro, hitlApproved?}} p
 */
function guardWithdraw402(p = {}) {
  const breaker = p.breaker || P401.defaultCircuitBreaker401();
  const userId = p.userId; const amountMicro = _big402(p.amountMicro);
  if (!userId) throw new GuardError402('userId required', 'BAD_ARGS');
  if (amountMicro <= 0n) throw new GuardError402('amount must be > 0', 'BAD_AMOUNT');

  const cb = breaker.checkWithdraw(userId, amountMicro);
  if (!cb.allowed) return _decision402(false, 'circuit_breaker', cb.reason, breaker, 'withdraw', userId, amountMicro, { code: cb.code || 'THROTTLED', decision: cb.decision, remainingUserQuota: cb.remainingUserQuota, softPaused: cb.softPaused });
  const gate = _v240Gate402('credit.withdraw', amountMicro, p.hitlApproved);
  if (!gate.passed) return _decision402(false, 'hitl', gate.reason, breaker, 'withdraw', userId, amountMicro, { code: 'REQUIRES_HITL', requiresHitl: true });
  return _decision402(true, 'allowed', 'within exit guarantee + HITL gate', breaker, 'withdraw', userId, amountMicro, { requiresHitl: gate.requiresHitl });
}

module.exports = {
  GUARD_VERSION_402, MICROCENTS_PER_USD_402, LARGE_ACTION_USD_402, GuardError402,
  checkReserveBacking402, guardMint402, guardWithdraw402,
};
