'use strict';
/**
 * src/lib/userProtection401.js — ECOS V401 (Phase P289) — User Protection / Circuit Breakers
 *
 * THE #1 PILOT-READINESS PRIORITY (from the boss research): protect users from
 * losing money. Every studied collapse (Celsius, Terra, BitConnect) hurt users
 * most at the exit. The research's prescription, implemented here:
 *   • Per-window RATE LIMITS on mint / redeem / withdraw (throttle abnormal outflows).
 *   • Per-user EXPOSURE CAPS (a user cannot over-deposit beyond a published ceiling).
 *   • COOL-DOWNS between large actions (blunt panic loops and drain scripts).
 *   • SOFT-PAUSE, not total freeze — the explicit anti-Celsius design: under stress
 *     NEW exposure (mint/deposit) fails CLOSED, but a user can ALWAYS withdraw up to
 *     their normal per-window quota. Users are never trapped.
 *   • TRANSPARENCY: every decision returns the remaining quota, so the UI can show it
 *     ("withdrawals: 63% of hourly limit available") and it never feels like a trap.
 *
 * This is a GUARD layer (like the V240 safety interlock): economic call-sites consult
 * it before mutating. It NEVER modifies the sacred ledger/audit — it wraps them and
 * records protection events to the audit log. Pure JS, no new deps (R3/R6). …401.
 *
 * @version 401.0.0
 */

const PROTECT_VERSION_401 = '401.0.0';
const DECISION_401 = { ALLOW: 'allow', DENY: 'deny', THROTTLE: 'throttle' };

const DEFAULTS_401 = {
  windowMs: 60 * 60 * 1000,           // 1 hour rolling window
  globalMintCapPerWindow: 100_000_0000n,   // global new-exposure cap per window (μ¢)
  globalOutflowCapPerWindow: 100_000_0000n, // global outflow cap per window (μ¢) → soft-pause trigger
  perUserExposureCap: 10_000_0000n,    // max a single user may hold/deposit (μ¢) — pilot ceiling
  perUserOutflowPerWindow: 5_000_0000n, // a user's ALWAYS-allowed normal exit quota per window (μ¢)
  largeActionThreshold: 2_000_0000n,   // actions at/above this are "large" → cool-down applies (μ¢)
  coolDownMs: 5 * 60 * 1000,           // 5 min between a user's large actions
};

class ProtectionError401 extends Error {
  constructor(msg, code) { super(msg); this.name = 'ProtectionError401'; this.code = code || 'PROTECTION_ERROR'; this.statusCode = 429; }
}
function _big401(v) { try { return typeof v === 'bigint' ? v : BigInt(v); } catch (_) { throw new ProtectionError401('amount must be an integer (μ¢)', 'BAD_AMOUNT'); } }

class CircuitBreaker401 {
  /** @param {object} cfg overrides of DEFAULTS_401  @param {{audit?:fn, now?:fn}} hooks */
  constructor(cfg = {}, hooks = {}) {
    this.cfg = Object.assign({}, DEFAULTS_401, cfg);
    // Coerce the μ¢ amount fields to BigInt so a caller passing Numbers can't crash arithmetic.
    for (const k of ['globalMintCapPerWindow', 'globalOutflowCapPerWindow', 'perUserExposureCap', 'perUserOutflowPerWindow', 'largeActionThreshold']) {
      if (this.cfg[k] != null && typeof this.cfg[k] !== 'bigint') this.cfg[k] = BigInt(Math.trunc(Number(this.cfg[k])));
    }
    this.now = typeof hooks.now === 'function' ? hooks.now : Date.now;
    this.audit = typeof hooks.audit === 'function' ? hooks.audit : null;
    this._mintEvents = [];                 // {ts, amount}
    this._outflowEvents = [];              // {ts, amount}
    this._userOutflow = new Map();         // userId -> [{ts, amount}]
    this._userExposure = new Map();        // userId -> bigint (current held/deposited)
    this._lastLargeAction = new Map();     // userId -> ts
    this._manualSoftPause = false;
  }

  _prune(list, cutoff) { while (list.length && list[0].ts < cutoff) list.shift(); return list; }
  _sum(list) { let s = 0n; for (const e of list) s += e.amount; return s; }
  _windowCutoff() { return this.now() - this.cfg.windowMs; }

  _globalOutflowInWindow() { return this._sum(this._prune(this._outflowEvents, this._windowCutoff())); }
  _globalMintInWindow() { return this._sum(this._prune(this._mintEvents, this._windowCutoff())); }
  _userOutflowInWindow(userId) {
    const list = this._userOutflow.get(userId) || [];
    return this._sum(this._prune(list, this._windowCutoff()));
  }

  /** Is the system in soft-pause? (manual, or global outflow cap exceeded) */
  isSoftPaused() { return this._manualSoftPause || this._globalOutflowInWindow() >= this.cfg.globalOutflowCapPerWindow; }

  /**
   * Check a MINT / deposit (NEW exposure). Fails CLOSED under stress — we never let a
   * user take on more exposure than the published ceiling, and never exceed the global
   * new-exposure cap. This protects users from over-committing.
   */
  checkMint(userId, amount) {
    const amt = _big401(amount);
    if (amt <= 0n) throw new ProtectionError401('amount must be > 0', 'BAD_AMOUNT');
    const exposure = this._userExposure.get(userId) || 0n;
    const remainingUser = this.cfg.perUserExposureCap - exposure;
    const remainingGlobal = this.cfg.globalMintCapPerWindow - this._globalMintInWindow();

    if (this._manualSoftPause) return this._decide(false, DECISION_401.DENY, 'new exposure paused (soft-pause)', { remainingUserExposure: remainingUser, code: 'SOFT_PAUSED' });
    if (amt > remainingUser) return this._decide(false, DECISION_401.DENY, 'exceeds per-user exposure cap', { remainingUserExposure: remainingUser, code: 'USER_EXPOSURE_CAP' });
    if (amt > remainingGlobal) return this._decide(false, DECISION_401.DENY, 'global new-exposure window cap reached', { remainingGlobalWindow: remainingGlobal, code: 'GLOBAL_MINT_CAP' });
    if (this._isInCoolDown(userId, amt)) return this._decide(false, DECISION_401.DENY, 'cool-down active between large actions', { code: 'COOL_DOWN' });
    return this._decide(true, DECISION_401.ALLOW, 'within limits', { remainingUserExposure: remainingUser - amt, remainingGlobalWindow: remainingGlobal - amt });
  }

  /**
   * Check a WITHDRAW / redeem (OUTFLOW). ANTI-CELSIUS: a user can ALWAYS withdraw up to
   * their normal per-window quota, even during a soft-pause. Only amounts ABOVE the
   * normal quota are throttled when the system is under stress. Users are never trapped.
   */
  checkWithdraw(userId, amount) {
    const amt = _big401(amount);
    if (amt <= 0n) throw new ProtectionError401('amount must be > 0', 'BAD_AMOUNT');
    const usedUser = this._userOutflowInWindow(userId);
    const normalQuota = this.cfg.perUserOutflowPerWindow - usedUser; // always-allowed exit room
    const softPaused = this.isSoftPaused();

    // Within the user's normal quota → ALWAYS allowed (the exit guarantee).
    if (amt <= (normalQuota < 0n ? 0n : normalQuota)) {
      return this._decide(true, DECISION_401.ALLOW, softPaused ? 'within normal exit quota (system soft-paused)' : 'within normal quota',
        { remainingUserQuota: normalQuota - amt, softPaused });
    }
    // Above normal quota: if soft-paused or it would breach the global outflow cap → THROTTLE
    // (allow only up to the normal quota now; the rest after the window / unpause). Not a freeze.
    const wouldBreachGlobal = (this._globalOutflowInWindow() + amt) > this.cfg.globalOutflowCapPerWindow;
    if (softPaused || wouldBreachGlobal) {
      return this._decide(false, DECISION_401.THROTTLE,
        'above normal quota while system is protecting outflows — withdraw up to your remaining quota now, the rest opens as the window clears',
        { remainingUserQuota: normalQuota < 0n ? 0n : normalQuota, softPaused: true, code: 'THROTTLED' });
    }
    if (this._isInCoolDown(userId, amt)) return this._decide(false, DECISION_401.THROTTLE, 'cool-down active between large actions', { remainingUserQuota: normalQuota < 0n ? 0n : normalQuota, code: 'COOL_DOWN' });
    // Above normal quota but system healthy → allowed (large withdrawal in calm conditions)
    return this._decide(true, DECISION_401.ALLOW, 'above normal quota, system healthy', { remainingUserQuota: 0n, softPaused: false });
  }

  _isInCoolDown(userId, amt) {
    if (amt < this.cfg.largeActionThreshold) return false;
    const last = this._lastLargeAction.get(userId);
    return last != null && (this.now() - last) < this.cfg.coolDownMs;
  }

  // ── commit hooks (call AFTER the ledger mutation succeeds) ──
  recordMint(userId, amount) {
    const amt = _big401(amount); const ts = this.now();
    this._mintEvents.push({ ts, amount: amt });
    this._userExposure.set(userId, (this._userExposure.get(userId) || 0n) + amt);
    if (amt >= this.cfg.largeActionThreshold) this._lastLargeAction.set(userId, ts);
  }
  recordWithdraw(userId, amount) {
    const amt = _big401(amount); const ts = this.now();
    this._outflowEvents.push({ ts, amount: amt });
    const list = this._userOutflow.get(userId) || []; list.push({ ts, amount: amt }); this._userOutflow.set(userId, list);
    const exp = this._userExposure.get(userId) || 0n; this._userExposure.set(userId, exp > amt ? exp - amt : 0n);
    if (amt >= this.cfg.largeActionThreshold) this._lastLargeAction.set(userId, ts);
    if (this.isSoftPaused() && this.audit) { try { this.audit('protection.soft_pause_active', { globalOutflow: this._globalOutflowInWindow().toString() }); } catch (_) {} }
  }

  softPause(reason) { this._manualSoftPause = true; if (this.audit) { try { this.audit('protection.manual_soft_pause', { reason: reason || 'admin' }); } catch (_) {} } return { softPaused: true }; }
  unpause() { this._manualSoftPause = false; if (this.audit) { try { this.audit('protection.unpause', {}); } catch (_) {} } return { softPaused: false }; }

  /** Transparent status — safe to show users. */
  status() {
    return {
      softPaused: this.isSoftPaused(), manualSoftPause: this._manualSoftPause,
      windowMs: this.cfg.windowMs,
      globalOutflowUsed: this._globalOutflowInWindow().toString(),
      globalOutflowCap: this.cfg.globalOutflowCapPerWindow.toString(),
      globalMintUsed: this._globalMintInWindow().toString(),
      globalMintCap: this.cfg.globalMintCapPerWindow.toString(),
      perUserExposureCap: this.cfg.perUserExposureCap.toString(),
      perUserOutflowPerWindow: this.cfg.perUserOutflowPerWindow.toString(),
    };
  }
  userStatus(userId) {
    const usedUser = this._userOutflowInWindow(userId);
    const normalQuota = this.cfg.perUserOutflowPerWindow - usedUser;
    return {
      exposure: (this._userExposure.get(userId) || 0n).toString(),
      remainingExposureRoom: (this.cfg.perUserExposureCap - (this._userExposure.get(userId) || 0n)).toString(),
      normalExitQuotaRemaining: (normalQuota < 0n ? 0n : normalQuota).toString(),
      inCoolDown: this._isInCoolDown(userId, this.cfg.largeActionThreshold),
    };
  }

  _decide(allowed, decision, reason, extra = {}) {
    const out = { allowed, decision, reason, version: PROTECT_VERSION_401 };
    for (const k of Object.keys(extra)) out[k] = typeof extra[k] === 'bigint' ? extra[k].toString() : extra[k];
    if (!allowed && this.audit) { try { this.audit('protection.blocked', { decision, reason: out.code || reason }); } catch (_) {} }
    return out;
  }
}

let _defaultBreaker401 = null;
function defaultCircuitBreaker401(cfg, hooks) { if (!_defaultBreaker401) _defaultBreaker401 = new CircuitBreaker401(cfg, hooks); return _defaultBreaker401; }

module.exports = {
  PROTECT_VERSION_401, DECISION_401, DEFAULTS_401, ProtectionError401,
  CircuitBreaker401, defaultCircuitBreaker401,
};
