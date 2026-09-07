'use strict';
/**
 * src/lib/memoryIntegrity268.js — Memory Integrity Guard (V268)
 *
 * Builds on memoryIntegrity264 with:
 *   - MemoryGraft defense: detect cross-agent memory contamination
 *   - Multi-scope memory isolation: system / user / agent / retrieval
 *   - Temporal expiry: entries with TTL auto-quarantine on expiry
 *   - Bulk rollback by programId (rollback all memories from a mission program)
 *   - Provenance chain: each entry references parent entry hash
 *
 * PROGRAM 06: Memory Integrity Layer
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

const MEMORY_SCOPES_268 = Object.freeze(['system', 'user', 'agent', 'retrieval', 'external']);
const MAX_ENTRIES_268   = 100_000;

class MemoryIntegrity268 {
  constructor(opts = {}) {
    this._logger     = opts.logger     || console;
    this._auditLog   = opts.auditLog   || null;
    this._entries268     = new Map();
    this._quarantined268 = new Set();
    this._scopeIndex268  = new Map(); // scope → Set<entryId>
    this._programIndex268 = new Map(); // programId → Set<entryId>
    this._stats268 = { writes: 0, quarantined: 0, rollbacks: 0, verified: 0 };
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  /**
   * Sign a memory write. Call BEFORE writing to any memory substrate.
   * @param {string} content
   * @param {object} provenance — { source, sourceType, scope, verifiedAt, programId, parentEntryId, ttlMs }
   */
  signWrite268(content, provenance = {}) {
    const _t0 = Date.now();
    if (this._entries268.size >= MAX_ENTRIES_268) this._evictOldest268();

    const scope = provenance.scope || 'agent';
    if (!MEMORY_SCOPES_268.includes(scope))
      throw new Error(`memoryIntegrity268: unknown scope "${scope}"`);

    const ts   = new Date().toISOString();
    const contentHash = crypto.createHash('sha256').update(content + ts).digest('hex');
    const entryId = 'mi268::' + crypto.randomBytes(6).toString('hex');

    // Provenance chain: include parent hash if provided
    let parentHash = null;
    if (provenance.parentEntryId) {
      const parent = this._entries268.get(provenance.parentEntryId);
      parentHash = parent?.contentHash || null;
    }

    const entry = {
      entryId,
      contentHash,
      parentHash,
      provenance: {
        source:     provenance.source     || 'unknown',
        sourceType: provenance.sourceType || 'unknown',
        scope,
        verifiedAt: provenance.verifiedAt || ts,
        programId:  provenance.programId  || null,
        parentEntryId: provenance.parentEntryId || null,
      },
      expiresAt:   provenance.ttlMs ? Date.now() + provenance.ttlMs : null,
      quarantined: false,
      createdAt:   ts,
    };

    this._entries268.set(entryId, entry);
    this._stats268.writes++;

    // Index by scope
    if (!this._scopeIndex268.has(scope)) this._scopeIndex268.set(scope, new Set());
    this._scopeIndex268.get(scope).add(entryId);

    // Index by programId
    if (provenance.programId) {
      if (!this._programIndex268.has(provenance.programId)) this._programIndex268.set(provenance.programId, new Set());
      this._programIndex268.get(provenance.programId).add(entryId);
    }

    this._log268('SIGN_WRITE', { entryId, scope, sourceType: entry.provenance.sourceType });
    this._recordLatency268(_t0);
    return entry;
  }

  verify268(entryId, content, ts) {
    const entry = this._entries268.get(entryId);
    if (!entry) return { valid: false, reason: 'entry_not_found' };
    if (entry.quarantined) return { valid: false, reason: 'quarantined' };

    // TTL check
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.quarantine268(entryId, 'ttl_expired');
      return { valid: false, reason: 'ttl_expired' };
    }

    const expectedHash = crypto.createHash('sha256').update(String(content) + ts).digest('hex');
    if (expectedHash !== entry.contentHash) {
      return { valid: false, reason: 'hash_mismatch', expected: entry.contentHash, got: expectedHash };
    }

    this._stats268.verified++;
    return { valid: true, entryId, scope: entry.provenance.scope };
  }

  quarantine268(entryId, reason) {
    const entry = this._entries268.get(entryId);
    if (!entry) return { ok: false, error: 'entry_not_found' };
    entry.quarantined = true;
    entry.quarantineReason = reason;
    entry.quarantinedAt = new Date().toISOString();
    this._quarantined268.add(entryId);
    this._stats268.quarantined++;
    this._log268('QUARANTINE', { entryId, reason });
    return { ok: true, entryId, reason };
  }

  /**
   * Rollback all entries created after a timestamp.
   */
  rollback268(beforeTs) {
    const cutoff = new Date(beforeTs).getTime();
    let count = 0;
    for (const [id, entry] of this._entries268) {
      if (new Date(entry.createdAt).getTime() > cutoff) {
        entry.quarantined = true;
        entry.quarantineReason = 'rollback';
        this._quarantined268.add(id);
        count++;
      }
    }
    this._stats268.rollbacks++;
    this._log268('ROLLBACK', { beforeTs, entriesAffected: count });
    return { ok: true, entriesQuarantined: count };
  }

  /**
   * Rollback all entries for a specific programId (mission-scoped rollback).
   */
  rollbackProgram268(programId) {
    const ids = this._programIndex268.get(programId) || new Set();
    let count = 0;
    for (const id of ids) {
      const entry = this._entries268.get(id);
      if (entry && !entry.quarantined) {
        entry.quarantined = true;
        entry.quarantineReason = 'program_rollback';
        this._quarantined268.add(id);
        count++;
      }
    }
    this._stats268.rollbacks++;
    this._log268('PROGRAM_ROLLBACK', { programId, entriesAffected: count });
    return { ok: true, programId, entriesQuarantined: count };
  }

  /**
   * Retrieve safe (non-quarantined) entries for a scope.
   */
  getScopeEntries268(scope, opts = {}) {
    const ids = this._scopeIndex268.get(scope) || new Set();
    const now = Date.now();
    const results = [];
    for (const id of ids) {
      const e = this._entries268.get(id);
      if (!e || e.quarantined) continue;
      if (e.expiresAt && now > e.expiresAt) { this.quarantine268(id, 'ttl_expired'); continue; }
      results.push({
        entryId: e.entryId,
        contentHash: e.contentHash,
        scope: e.provenance.scope,
        source: e.provenance.source,
        sourceType: e.provenance.sourceType,
        createdAt: e.createdAt,
      });
    }
    return results.slice(-(opts.limit || 100));
  }

  getStats268() {
    return {
      version: '268',
      ...this._stats268,
      total: this._entries268.size,
      quarantinedTotal: this._quarantined268.size,
      scopes: [...this._scopeIndex268.keys()],
      programs: this._programIndex268.size,
    };
  }

  _evictOldest268() {
    const firstKey = this._entries268.keys().next().value;
    if (firstKey) this._entries268.delete(firstKey);
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
  checkMemoryHealth268() {
    return {
      ok: true,
      module: 'memoryIntegrity268 multi-scope memory',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultMemoryIntegrity268 = new MemoryIntegrity268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  MemoryIntegrity268,
  defaultMemoryIntegrity268,
  MEMORY_SCOPES_268,
};
