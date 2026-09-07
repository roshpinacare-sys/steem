'use strict';
/**
 * src/lib/auditBloom268.js — Audit-chain Bloom-style lookup index (V268)
 *
 * V268 additions over V266:
 *   - persistenceAdapter interface validation at construction time
 *   - Performance telemetry: `.getPerf268()` with p50/p95/p99 add/query latencies
 *   - `checkPersistenceHealth268()`: probe adapter availability
 *
 * PROGRAM 07: Audit Chain Expansion.
 * Zero new npm deps. Identifiers end with 268.
 */

const crypto = require('node:crypto');

const BLOOM_BITS_268 = 65_536;
const BLOOM_HASHES_268 = 5;

function _hashIndexes268(value, bits = BLOOM_BITS_268, hashes = BLOOM_HASHES_268) {
  const raw = String(value || '');
  const out = [];
  for (let i = 0; i < hashes; i++) {
    const h = crypto.createHash('sha256').update(`${i}:${raw}`).digest();
    out.push(h.readUInt32BE(0) % bits);
  }
  return out;
}

function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

class AuditBloom268 {
  constructor(opts = {}) {
    this._logger = opts.logger || console;
    this._auditLog = opts.auditLog || null;
    this._logAdapter268 = opts.logAdapter || null;
    // V268: validate persistenceAdapter interface
    if (opts.persistenceAdapter !== null && opts.persistenceAdapter !== undefined) {
      if (typeof opts.persistenceAdapter.loadBloomState !== 'function') {
        throw new Error('auditBloom268: persistenceAdapter must implement loadBloomState()');
      }
      if (typeof opts.persistenceAdapter.saveBloomState !== 'function') {
        throw new Error('auditBloom268: persistenceAdapter must implement saveBloomState(state)');
      }
    }
    this._persistenceAdapter = opts.persistenceAdapter || null;
    this._bits268 = Number(opts.bits || BLOOM_BITS_268);
    this._hashes268 = Number(opts.hashes || BLOOM_HASHES_268);
    if (this._persistenceAdapter?.loadBloomState) {
      const loadedState = this._persistenceAdapter.loadBloomState();
      this._bytes268 = Buffer.from(loadedState.bitsetBase64 || "", "base64");
      if (!this._bytes268.length) this._bytes268 = Buffer.alloc(Math.ceil(this._bits268 / 8));
      this._exact268 = new Set(loadedState.exactKeys || []);
      this._events268 = Array.isArray(loadedState.events) ? loadedState.events : [];
    } else {
      this._bytes268 = Buffer.alloc(Math.ceil(this._bits268 / 8));
      this._exact268 = new Set();
      this._events268 = [];
    }
    this._stats268 = { added: 0, queries: 0, positives: 0, negatives: 0 };
    // V268: perf tracking
    this._perf268 = { latencies: [] };
  }

  addEvent268(event) {
    const _t0 = Date.now();
    const key = this._eventKey268(event);
    for (const idx of _hashIndexes268(key, this._bits268, this._hashes268)) this._setBit268(idx);
    this._exact268.add(key);
    this._events268.push({ key, event, ts: new Date().toISOString() });
    if (this._events268.length > 50_000) this._events268.shift();
    this._stats268.added++;
    this._log268("AUDIT_BLOOM_ADD", { key });
    if (this._persistenceAdapter?.saveBloomState) {
      this._persistenceAdapter.saveBloomState(this.exportSnapshot268());
    }
    this._recordLatency268(_t0);
    return { ok: true, key, indexes: _hashIndexes268(key, this._bits268, this._hashes268) };
  }

  addReceiptStep268(missionId, step) {
    const key = `${missionId}:${step?.stepType || 'UNKNOWN'}:${step?.hash || ''}`;
    return this.addEvent268({ kind: 'receipt_step', missionId, stepType: step?.stepType, hash: step?.hash, key });
  }

  has268(value) {
    const key = this._eventKey268(value);
    this._stats268.queries++;
    const maybe = _hashIndexes268(key, this._bits268, this._hashes268).every(idx => this._getBit268(idx));
    if (maybe) this._stats268.positives++; else this._stats268.negatives++;
    return { maybe, exact: this._exact268.has(key), key };
  }

  explain268(value) {
    const key = this._eventKey268(value);
    const indexes = _hashIndexes268(key, this._bits268, this._hashes268);
    const bits = indexes.map(idx => ({ idx, set: this._getBit268(idx) }));
    const result = this.has268(key);
    return { ...result, indexes, bits };
  }

  exportSnapshot268() {
    const snapshot = {
      version: '268',
      bits: this._bits268,
      hashes: this._hashes268,
      bitsetBase64: this._bytes268.toString('base64'),
      exactKeys: Array.from(this._exact268),
      events: this._events268.slice(-500),
      stats: this.getStats268(),
    };
    if (this._persistenceAdapter?.saveBloomState) {
      this._persistenceAdapter.saveBloomState(snapshot);
    }
    return snapshot;
  }

  importSnapshot268(snapshot = {}) {
    if (this._persistenceAdapter?.loadBloomState) {
      const loadedState = this._persistenceAdapter.loadBloomState();
      this._bits268 = Number(loadedState.bits || this._bits268);
      this._hashes268 = Number(loadedState.hashes || this._hashes268);
      this._bytes268 = Buffer.from(loadedState.bitsetBase64 || '', 'base64');
      if (!this._bytes268.length) this._bytes268 = Buffer.alloc(Math.ceil(this._bits268 / 8));
      this._exact268 = new Set(loadedState.exactKeys || []);
      this._events268 = Array.isArray(loadedState.events) ? loadedState.events : [];
      return { ok: true, keys: this._exact268.size, bytes: this._bytes268.length };
    } else {
      if (snapshot.version && snapshot.version !== '268') throw new Error('auditBloom268: incompatible snapshot version');
      this._bits268 = Number(snapshot.bits || this._bits268);
      this._hashes268 = Number(snapshot.hashes || this._hashes268);
      this._bytes268 = Buffer.from(snapshot.bitsetBase64 || '', 'base64');
      if (!this._bytes268.length) this._bytes268 = Buffer.alloc(Math.ceil(this._bits268 / 8));
      this._exact268 = new Set(snapshot.exactKeys || []);
      this._events268 = Array.isArray(snapshot.events) ? snapshot.events : [];
      return { ok: true, keys: this._exact268.size, bytes: this._bytes268.length };
    }
  }

  getStats268() {
    return {
      version: '268',
      bits: this._bits268,
      hashes: this._hashes268,
      exactKeys: this._exact268.size,
      recentEvents: this._events268.length,
      ...this._stats268,
    };
  }

  /** V268: Performance telemetry */
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  /** V268: Check persistence adapter health */
  checkPersistenceHealth268() {
    if (!this._persistenceAdapter) return { ok: true, adapter: 'in-memory', note: 'No external adapter injected' };
    const hasLoad = typeof this._persistenceAdapter.loadBloomState === 'function';
    const hasSave = typeof this._persistenceAdapter.saveBloomState === 'function';
    return { ok: hasLoad && hasSave, adapter: 'external', hasLoad, hasSave };
  }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  _eventKey268(event) {
    if (typeof event === 'string') return event;
    if (event?.key) return String(event.key);
    if (event?.hash) return String(event.hash);
    return crypto.createHash('sha256').update(JSON.stringify(event || {})).digest('hex');
  }

  _setBit268(idx) { this._bytes268[Math.floor(idx / 8)] |= (1 << (idx % 8)); }
  _getBit268(idx) { return (this._bytes268[Math.floor(idx / 8)] & (1 << (idx % 8))) !== 0; }
  _log268(event, data) { if (this._auditLog?.append) { try { this._auditLog.append({ event, ...data, ts: new Date().toISOString(), _v: '268' }); } catch (_) {} } }
}

const defaultAuditBloom268 = new AuditBloom268();

module.exports = {
  AuditBloom268,
  defaultAuditBloom268,
  BLOOM_BITS_268,
  BLOOM_HASHES_268,
};
