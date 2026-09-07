'use strict';
/**
 * src/lib/embeddedWallet268.js — Embedded Wallet Abstraction (V268)
 *
 * V268 additions over V266:
 *   - custodyProvider interface validation at construction time
 *   - Performance telemetry: `.getPerf268()` with p50/p95/p99 latencies
 *   - Security hardening: userId input sanitization, rate-limit guard on createWallet
 *   - `checkCustodyHealth268()`: probe custodyProvider availability
 *
 * PROGRAM 16: Embedded Wallet Layer.
 * Zero new npm deps. Identifiers end with 268.
 */

const crypto = require('node:crypto');

const WALLET_PROVIDERS_268 = Object.freeze(['email', 'telegram', 'external', 'custodial_stub']);
const WALLET_RISK_268 = Object.freeze({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high', LOCKED: 'locked' });
const WALLET_CREATE_RATE_MS_268 = 100; // minimum ms between creates per userId

function _safeHash268(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

class EmbeddedWallet268 {
  constructor(opts = {}) {
    this._logger = opts.logger || console;
    this._auditLog = opts.auditLog || null;
    this._logAdapter268 = opts.logAdapter || null;
    // V268: validate custodyProvider interface
    if (opts.custodyProvider !== null && opts.custodyProvider !== undefined) {
      if (typeof opts.custodyProvider.createWallet !== 'function') {
        throw new Error('embeddedWallet268: custodyProvider must implement createWallet(userId, provider, identity, opts)');
      }
      if (typeof opts.custodyProvider.linkExternal !== 'function') {
        throw new Error('embeddedWallet268: custodyProvider must implement linkExternal(userId, externalAddress, opts)');
      }
    }
    this._custodyProvider = opts.custodyProvider || null;
    this._wallets268 = new Map();
    this._userIndex268 = new Map();
    this._providerHealth268 = new Map(WALLET_PROVIDERS_268.map(p => [p, { ok: true, checkedAt: new Date().toISOString() }]));
    this._stats268 = { created: 0, linked: 0, resolved: 0, riskFlags: 0 };
    // V268: perf + rate-limit tracking
    this._perf268 = { latencies: [] };
    this._lastCreate268 = new Map(); // userId → lastCreateMs
  }

  createWallet268(userId, provider = 'email', identity = '', opts = {}) {
    if (!userId) throw new Error('embeddedWallet268: userId required');
    // V268: security - sanitize userId
    if (typeof userId !== 'string' || userId.length > 256) throw new Error('embeddedWallet268: invalid userId');
    // V268: rate-limit guard
    const now = Date.now();
    const last = this._lastCreate268.get(userId) || 0;
    if (now - last < WALLET_CREATE_RATE_MS_268 && !opts.forceNew) {
      throw new Error('embeddedWallet268: create rate limit exceeded');
    }
    this._lastCreate268.set(userId, now);
    const _t0 = now;
    if (!WALLET_PROVIDERS_268.includes(provider)) throw new Error(`embeddedWallet268: unsupported provider ${provider}`);
    const existing = this.resolveWallet268(userId, { silent: true });
    if (existing?.walletId && !opts.forceNew) return { ok: true, existing: true, wallet: existing };
    let walletId, address;
    if (this._custodyProvider?.createWallet) {
      const externalWallet = this._custodyProvider.createWallet(userId, provider, identity, opts);
      walletId = externalWallet.walletId;
      address = externalWallet.walletAddress; // Assuming custodyProvider returns walletAddress
    } else {
      walletId = `wallet268::${crypto.randomBytes(8).toString('hex')}`;
      address = `ecos_${provider}_${_safeHash268(`${userId}:${provider}:${identity}:${Date.now()}`).slice(0, 40)}`;
    }
    const wallet = {
      walletId,
      userId,
      provider,
      address,
      identityHash: _safeHash268(identity || userId),
      externalAddress: opts.externalAddress || null,
      createdAt: new Date().toISOString(),
      linkedAt: null,
      status: 'active',
      risk: WALLET_RISK_268.LOW,
      riskReasons: [],
      metadata: opts.metadata || {},
    };
    this._wallets268.set(walletId, wallet);
    this._userIndex268.set(userId, walletId);
    this._stats268.created++;
    this._log268('WALLET_CREATE', { walletId, userId, provider });
    this._recordLatency268(_t0);
    return { ok: true, wallet: this._public268(wallet) };
  }

  linkExternal268(userId, externalAddress, opts = {}) {
    let created;
    if (this._custodyProvider?.linkExternal) {
      const externalLink = this._custodyProvider.linkExternal(userId, externalAddress, opts);
      created = { ok: true, wallet: externalLink }; // Assume externalLink returns a wallet-like object
    } else {
      created = this.createWallet268(userId, 'external', externalAddress, { ...opts, externalAddress, forceNew: opts.forceNew });
    }
    const wallet = this._wallets268.get(created.wallet.walletId || created.wallet.id);
    if (wallet) wallet.linkedAt = new Date().toISOString();
    this._stats268.linked++;
    return { ok: true, wallet: wallet ? this._public268(wallet) : created.wallet };
  }

  resolveWallet268(userId, opts = {}) {
    const walletId = this._userIndex268.get(userId);
    if (!walletId) return null;
    const wallet = this._wallets268.get(walletId);
    if (!wallet) return null;
    if (!opts.silent) this._stats268.resolved++;
    return this._public268(wallet);
  }

  markRisk268(walletIdOrUserId, risk = WALLET_RISK_268.MEDIUM, reason = 'manual_review') {
    const wallet = this._wallets268.get(walletIdOrUserId) || this._wallets268.get(this._userIndex268.get(walletIdOrUserId));
    if (!wallet) throw new Error('embeddedWallet268: wallet not found');
    wallet.risk = risk;
    wallet.riskReasons.push({ reason, ts: new Date().toISOString() });
    if (risk === WALLET_RISK_268.LOCKED) wallet.status = 'locked';
    this._stats268.riskFlags++;
    this._log268('WALLET_RISK', { walletId: wallet.walletId, risk, reason });
    return { ok: true, wallet: this._public268(wallet) };
  }

  getMobileWallet268(userId) {
    const w = this.resolveWallet268(userId, { silent: true });
    if (!w) return null;
    return { v: '268', uid: userId, wid: w.walletId, p: w.provider, a: w.address.slice(0, 14), st: w.status, r: w.risk, cryptoWords: false };
  }

  getProviderHealth268() { return Object.fromEntries(this._providerHealth268); }

  getStats268() {
    return { version: '268', wallets: this._wallets268.size, providers: WALLET_PROVIDERS_268.length, ...this._stats268 };
  }

  /** V268: Performance telemetry */
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  /** V268: Check custody provider health */
  checkCustodyHealth268() {
    if (!this._custodyProvider) return { ok: true, provider: 'stub', note: 'No external provider injected' };
    const hasCreate = typeof this._custodyProvider.createWallet === 'function';
    const hasLink   = typeof this._custodyProvider.linkExternal === 'function';
    return { ok: hasCreate && hasLink, provider: 'external', hasCreate, hasLink };
  }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  _public268(wallet) {
    return {
      walletId: wallet.walletId,
      userId: wallet.userId,
      provider: wallet.provider,
      address: wallet.address,
      externalAddress: wallet.externalAddress,
      createdAt: wallet.createdAt,
      linkedAt: wallet.linkedAt,
      status: wallet.status,
      risk: wallet.risk,
      riskReasons: wallet.riskReasons.slice(-5),
      metadata: wallet.metadata,
      nonCustodialClaim: wallet.provider === 'external',
      cryptoFreeCopy: true,
    };
  }

  _log268(event, data) { if (this._auditLog?.append) { try { this._auditLog.append({ event, ...data, ts: new Date().toISOString(), _v: '268' }); } catch (_) {} } }
}

const defaultEmbeddedWallet268 = new EmbeddedWallet268();

module.exports = {
  EmbeddedWallet268,
  defaultEmbeddedWallet268,
  WALLET_PROVIDERS_268,
  WALLET_RISK_268,
};
