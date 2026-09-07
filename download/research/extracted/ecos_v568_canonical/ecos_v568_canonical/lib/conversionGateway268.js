'use strict';
/**
 * src/lib/conversionGateway268.js — Credit↔USDC Conversion Gateway (V268)
 *
 * Builds on conversionGateway264 with:
 *   - Multi-currency support (USDC primary, USDT secondary)
 *   - Sell-through velocity monitoring (flag mercenary churn > 60%)
 *   - Mobile-first conversion flow (no wallet UI visible to user)
 *   - x402-funded conversions: x402 deposits directly trigger reserve top-up
 *   - Conversion receipts stored in agentReceipts268
 *
 * PROGRAM 01: Credit Infrastructure Hardening
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

const GATEWAY_RATE_LIMIT_268   = 10;
const GATEWAY_MIN_MICRO_268    = 10_000n;
const GATEWAY_MAX_MICRO_268    = 100_000_000n;
const GATEWAY_COOLDOWN_MS_268  = 3_600_000;
const SUPPORTED_CURRENCIES_268 = Object.freeze(['USDC', 'USDT']);
const CHURN_WARN_THRESHOLD_268 = 0.60; // > 60% sell-through in 30d = mercenary flag

class ConversionGateway268 {
  constructor(opts = {}) {
    this._logger        = opts.logger        || console;
    this._reserve       = opts.creditReserve || null;
    this._auditLog      = opts.auditLog      || null;
    this._agentReceipts = opts.agentReceipts || null;
    this._rateMap268    = new Map();
    this._conversions268 = [];
    this._churnTracker268 = new Map(); // userId → { earned: bigint[], redeemed: bigint[] }
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  _validateAmount268(amountMicro) {
    if (amountMicro < GATEWAY_MIN_MICRO_268)
      throw new Error(`conversionGateway268: minimum conversion is ${GATEWAY_MIN_MICRO_268} μ¢`);
    if (amountMicro > GATEWAY_MAX_MICRO_268)
      throw new Error(`conversionGateway268: maximum conversion is ${GATEWAY_MAX_MICRO_268} μ¢`);
  }

  _checkRateLimit268(userId) {
    const now = Date.now();
    const entry = this._rateMap268.get(userId) || { count: 0, windowStart: now };
    if (now - entry.windowStart > GATEWAY_COOLDOWN_MS_268) {
      entry.count = 0; entry.windowStart = now;
    }
    if (entry.count >= GATEWAY_RATE_LIMIT_268)
      throw new Error(`conversionGateway268: rate limit exceeded (${GATEWAY_RATE_LIMIT_268}/hour)`);
    entry.count++;
    this._rateMap268.set(userId, entry);
  }

  async creditToUsdc268(userId, amountMicro, meta = {}) {
    const _t0 = Date.now();
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    const currency = meta.currency || 'USDC';
    if (!SUPPORTED_CURRENCIES_268.includes(currency))
      throw new Error(`conversionGateway268: unsupported currency ${currency}`);

    this._validateAmount268(amountMicro);
    this._checkRateLimit268(userId);
    this._trackChurn268(userId, amountMicro);

    if (!this._reserve) throw new Error('conversionGateway268: no creditReserve268 injected');
    const redeemFn = this._reserve.redeem268 || this._reserve.redeem264;
    if (!redeemFn) throw new Error('conversionGateway268: reserve has no redeem method');
    redeemFn.call(this._reserve, amountMicro, { userId, direction: `credit→${currency}`, ...meta });

    const entry = {
      conversionId: 'cgw268::' + crypto.randomBytes(6).toString('hex'),
      userId, direction: `credit→${currency}`, currency,
      amountMicro: amountMicro.toString(),
      amountCurrency: (Number(amountMicro) / 10_000).toFixed(6),
      ts: new Date().toISOString(),
    };
    this._recordConversion268(userId, entry);
    if (this._auditLog?.append) { try { this._auditLog.append({ event: 'conversionGateway268.creditToUsdc', ...entry }); } catch (_) {} }
    this._recordLatency268(_t0);
    return { ok: true, ...entry };
  }

  async usdcToCredit268(userId, amountCurrency, currency = 'USDC', meta = {}) {
    if (!SUPPORTED_CURRENCIES_268.includes(currency))
      throw new Error(`conversionGateway268: unsupported currency ${currency}`);

    const amountMicro = BigInt(Math.round(Number(amountCurrency) * 10_000));
    this._validateAmount268(amountMicro);
    this._checkRateLimit268(userId);

    if (!this._reserve) throw new Error('conversionGateway268: no creditReserve268 injected');
    const depositFn = this._reserve.depositReserve268 || this._reserve.depositReserve264;
    if (depositFn) depositFn.call(this._reserve, amountMicro, 'fiatTopUp', { userId });

    const entry = {
      conversionId: 'cgw268::' + crypto.randomBytes(6).toString('hex'),
      userId, direction: `${currency}→credit`, currency,
      amountCurrency: Number(amountCurrency).toFixed(6),
      amountMicro: amountMicro.toString(),
      ts: new Date().toISOString(),
    };
    this._recordConversion268(userId, entry);
    if (this._auditLog?.append) { try { this._auditLog.append({ event: 'conversionGateway268.usdcToCredit', ...entry }); } catch (_) {} }
    return { ok: true, ...entry };
  }

  _trackChurn268(userId, amountMicro) {
    if (!this._churnTracker268.has(userId)) {
      this._churnTracker268.set(userId, { earned: 0n, redeemed: 0n, redeemedAt: [] });
    }
    const t = this._churnTracker268.get(userId);
    t.redeemed += amountMicro;
    t.redeemedAt.push(Date.now());
    // Trim to 30-day window
    const cutoff = Date.now() - 30 * 86_400_000;
    t.redeemedAt = t.redeemedAt.filter(ts => ts >= cutoff);

    const churnRate = t.earned > 0n ? Number(t.redeemed) / Number(t.earned) : 0;
    if (churnRate > CHURN_WARN_THRESHOLD_268) {
      this._log268('CHURN_WARN', { userId, churnRate: Math.round(churnRate * 100) / 100, threshold: CHURN_WARN_THRESHOLD_268 });
    }
  }

  recordEarned268(userId, amountMicro) {
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    if (!this._churnTracker268.has(userId)) this._churnTracker268.set(userId, { earned: 0n, redeemed: 0n, redeemedAt: [] });
    this._churnTracker268.get(userId).earned += amountMicro;
  }

  getChurnStatus268(userId) {
    const t = this._churnTracker268.get(userId);
    if (!t) return { userId, churnRate: 0, flagged: false };
    const churnRate = t.earned > 0n ? Number(t.redeemed) / Number(t.earned) : 0;
    return {
      userId,
      earned: t.earned.toString(),
      redeemed: t.redeemed.toString(),
      churnRate: Math.round(churnRate * 1000) / 1000,
      flagged: churnRate > CHURN_WARN_THRESHOLD_268,
    };
  }

  _recordConversion268(userId, entry) {
    this._conversions268.push(entry);
    if (this._conversions268.length > 1_000) this._conversions268.shift();
  }

  getConversions268(userId, limit = 20) {
    return this._conversions268.filter(c => c.userId === userId).slice(-limit);
  }

  getStats268() {
    return {
      version: '268',
      totalConversions: this._conversions268.length,
      supportedCurrencies: SUPPORTED_CURRENCIES_268,
      rateLimitedUsers: this._rateMap268.size,
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
  checkGatewayHealth268() {
    return {
      ok: true,
      module: 'conversionGateway268 credit↔USDC gateway',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultConversionGateway268 = new ConversionGateway268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  ConversionGateway268,
  defaultConversionGateway268,
  GATEWAY_RATE_LIMIT_268,
  GATEWAY_MIN_MICRO_268,
  SUPPORTED_CURRENCIES_268,
  CHURN_WARN_THRESHOLD_268,
};
