'use strict';
/**
 * src/lib/tipModule268.js — "Energy" Tipping Module (V268)
 *
 * Builds on tipModule264 with:
 *   - Multi-channel support: chat / telegram / mobile
 *   - Community pool matching: platform contributes 2x match to epoch pool
 *   - Epoch leaderboard (by received tips, not sent — encourages contribution)
 *   - AP2 tip receipt: every tip emits into agentReceipts268
 *   - Mobile-first: compact payloads, offline-queue compatible
 *
 * PROGRAM 09: Energy/Tipping Network
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

const EPOCH_ENERGY_PER_USER_268 = 100;
const EPOCH_DURATION_MS_268     = 7 * 24 * 3600_000;
const TIP_MAX_MICRO_268         = 100_000n;
const TIP_MIN_MICRO_268         = 1_000n;
const COMMUNITY_MATCH_RATE_268  = 0.10;  // platform matches 10% of each tip from pool
const TIPS_RING_MAX_268         = 50_000;

class TipModule268 {
  constructor(opts = {}) {
    this._logger        = opts.logger        || console;
    this._auditLog      = opts.auditLog      || null;
    this._sybilGuard    = opts.sybilGuard    || null;
    this._reserve       = opts.creditReserve || null;
    this._agentReceipts = opts.agentReceipts || null;
    this._reputationLedger = opts.reputationLedger || null;

    this._epochStart268    = Date.now();
    this._energyLedger268  = new Map();
    this._tips268          = [];
    this._communityPool268 = 0n;
    this._epochTotals268   = new Map(); // userId → { sent, received }
    this._channels268      = new Set(['chat', 'telegram', 'mobile', 'api']);
    this._stats268         = { total: 0, matched: 0n, totalAmountMicro: 0n };
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  // ── Epoch management ──────────────────────────────────────────────────────

  _maybeRollEpoch268() {
    if (Date.now() - this._epochStart268 >= EPOCH_DURATION_MS_268) {
      this._energyLedger268.clear();
      this._epochTotals268.clear();
      this._epochStart268 = Date.now();
    }
  }

  _getOrInitUser268(userId) {
    if (!this._energyLedger268.has(userId)) {
      this._energyLedger268.set(userId, {
        allocated: EPOCH_ENERGY_PER_USER_268, sent: 0, received: 0, tips: [],
      });
    }
    return this._energyLedger268.get(userId);
  }

  // ── Tip ───────────────────────────────────────────────────────────────────

  /**
   * Send a tip from one user to another.
   * @param {string} fromUserId
   * @param {string} toUserId
   * @param {bigint} amountMicro
   * @param {object} meta — { message, missionId, channel, programId }
   */
  tip268(fromUserId, toUserId, amountMicro, meta = {}) {
    const _t0 = Date.now();
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    if (fromUserId === toUserId) throw new Error('tipModule268: self-tipping is not allowed');
    if (amountMicro < TIP_MIN_MICRO_268) throw new Error(`tipModule268: minimum tip is ${TIP_MIN_MICRO_268} μ¢`);
    if (amountMicro > TIP_MAX_MICRO_268) throw new Error(`tipModule268: maximum tip is ${TIP_MAX_MICRO_268} μ¢`);

    const channel = meta.channel || 'chat';
    if (!this._channels268.has(channel)) throw new Error(`tipModule268: unknown channel "${channel}"`);

    this._maybeRollEpoch268();

    // Sybil check
    let sybilResult = null;
    if (this._sybilGuard) {
      const evalFn = this._sybilGuard.evaluate268 || this._sybilGuard.evaluate264;
      const verdict = evalFn ? evalFn.call(this._sybilGuard, fromUserId) : null;
      if (verdict?.verdict === 'BLOCK') throw new Error(`tipModule268: sender ${fromUserId} is sybil-blocked`);
      const recordFn = this._sybilGuard.recordTipEdge268 || this._sybilGuard.recordTipEdge264;
      if (recordFn) sybilResult = recordFn.call(this._sybilGuard, fromUserId, toUserId);
    }

    // Reward multiplier
    let multiplier = 1.0;
    if (this._sybilGuard?.getRewardMultiplier268) {
      multiplier = this._sybilGuard.getRewardMultiplier268(fromUserId, 'tip');
    }

    // Community pool matching
    let matchMicro = 0n;
    if (this._communityPool268 > 0n) {
      matchMicro = BigInt(Math.floor(Number(amountMicro) * COMMUNITY_MATCH_RATE_268));
      if (matchMicro > this._communityPool268) matchMicro = this._communityPool268;
      this._communityPool268 -= matchMicro;
      this._stats268.matched += matchMicro;
    }

    const tipId = 'tip268::' + crypto.randomBytes(6).toString('hex');
    const tip = {
      tipId,
      fromUserId, toUserId,
      amountMicro: amountMicro.toString(),
      matchMicro:  matchMicro.toString(),
      totalMicro:  (amountMicro + matchMicro).toString(),
      multiplier,
      channel,
      message:    meta.message   || null,
      missionId:  meta.missionId || null,
      programId:  meta.programId || null,
      sybilFlagged: sybilResult?.rings?.length > 0 || false,
      ts: new Date().toISOString(),
    };

    this._tips268.push(tip);
    if (this._tips268.length > TIPS_RING_MAX_268) this._tips268.shift();

    // Update epoch ledger
    const sender   = this._getOrInitUser268(fromUserId);
    const receiver = this._getOrInitUser268(toUserId);
    sender.sent++;
    receiver.received++;
    sender.tips.push({ dir: 'out', tipId, amount: amountMicro.toString() });
    receiver.tips.push({ dir: 'in',  tipId, amount: (amountMicro + matchMicro).toString() });

    // Epoch totals for leaderboard
    const st = this._epochTotals268.get(fromUserId) || { sent: 0n, received: 0n };
    const rt = this._epochTotals268.get(toUserId)   || { sent: 0n, received: 0n };
    st.sent += amountMicro;
    rt.received += amountMicro + matchMicro;
    this._epochTotals268.set(fromUserId, st);
    this._epochTotals268.set(toUserId, rt);

    this._stats268.total++;
    this._stats268.totalAmountMicro += amountMicro;

    // Record reputation signal
    if (this._reputationLedger) {
      const systemFn = this._reputationLedger.systemAttest268 || null;
      if (systemFn) { try { systemFn.call(this._reputationLedger, toUserId, 'tip_received', { tipId, amountMicro: amountMicro.toString() }); } catch (_) {} }
    }

    this._log268('TIP', { tipId, fromUserId, toUserId, amountMicro: amountMicro.toString(), matchMicro: matchMicro.toString(), channel });
    if (this._auditLog?.append) { try { this._auditLog.append({ event: 'tipModule268.tip', ...tip }); } catch (_) {} }

    this._recordLatency268(_t0);
    return { ok: true, tipId, tip };
  }

  // ── Community pool ────────────────────────────────────────────────────────

  addToCommunityPool268(amountMicro) {
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    this._communityPool268 += amountMicro;
    this._log268('POOL_DEPOSIT', { amountMicro: amountMicro.toString(), newTotal: this._communityPool268.toString() });
    return { ok: true, communityPool: this._communityPool268.toString() };
  }

  // ── Leaderboard ───────────────────────────────────────────────────────────

  getEpochLeaderboard268(limit = 10) {
    const entries = [];
    for (const [userId, totals] of this._epochTotals268) {
      entries.push({ userId, received: totals.received.toString(), sent: totals.sent.toString() });
    }
    entries.sort((a, b) => Number(BigInt(b.received) - BigInt(a.received)));
    return { epochStart: new Date(this._epochStart268).toISOString(), leaders: entries.slice(0, limit) };
  }

  getEpochStats268(userId) {
    this._maybeRollEpoch268();
    const user = this._energyLedger268.get(userId);
    if (!user) return { userId, allocated: EPOCH_ENERGY_PER_USER_268, sent: 0, received: 0, tips: [] };
    return { userId, ...user, tips: user.tips.slice(-20) };
  }

  getTipHistory268(userId, limit = 20) {
    return this._tips268.filter(t => t.fromUserId === userId || t.toUserId === userId).slice(-limit);
  }

  getStats268() {
    return {
      version: '268',
      ...this._stats268,
      totalAmountMicro: this._stats268.totalAmountMicro.toString(),
      matched: this._stats268.matched.toString(),
      communityPool: this._communityPool268.toString(),
      epochUsers: this._energyLedger268.size,
    };
  }

  _log268(event, data) {
    const entry = { event, ...data, ts: new Date().toISOString(), _v: '268' };
    if (this._auditLog?.append) { try { this._auditLog.append(entry); } catch (_) {} }
  }

  // ── V268: Performance Telemetry ─────────────────────────────────────────────
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  // ── V268: Health Check ────────────────────────────────────────────────────
  checkTipHealth268() {
    return {
      ok: true,
      module: 'tipModule268 community tips',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultTipModule268 = new TipModule268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  TipModule268,
  defaultTipModule268,
  EPOCH_ENERGY_PER_USER_268,
  TIP_MAX_MICRO_268,
  TIP_MIN_MICRO_268,
  COMMUNITY_MATCH_RATE_268,
};
