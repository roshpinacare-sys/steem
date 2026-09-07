'use strict';
/**
 * lib/ttlCursorRegistry383.js — ECOS V383 (Phase P271)
 *
 * DIRECTION 3: Persisted registry TTL eviction.
 *
 * createTtlCursorRegistry383(opts) adds per-entry TTL support to cursor
 * registry: entries older than ttlMs are automatically evicted on get and
 * periodically on flush, preventing unbounded growth of the persisted file.
 *
 * Exports:
 *   TTL_CURSOR_REGISTRY_VERSION_383
 *   TTL_CURSOR_REGISTRY_SCHEMA_383
 *   DEFAULT_TTL_MS_383
 *   createTtlCursorRegistry383(opts)
 *     — same API as createPersistedCursorRegistry382 plus:
 *         evictExpired(), getStats()
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl [V383-T03]
 *           GET  /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/:name
 *           DELETE /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/:name
 *
 * Pure (R3 no new npm deps — uses only built-in `fs`). All new identifiers end with 383 (R2).
 * Sacred untouched (R1). V361..V382 preserved (R6).
 *
 * @version 383.0.0
 */

const fs   = require('fs');
const path = require('path');
const CC380 = require('./comparatorHistoryCursor380.js');

const TTL_CURSOR_REGISTRY_VERSION_383 = '383.0.0';
const TTL_CURSOR_REGISTRY_SCHEMA_383  = 'ecos.integrity.mission.proof.index.comparator.history.cursor.registry.ttl/v383';
const DEFAULT_TTL_MS_383              = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_PERSIST_TTL_FILE_383    = path.join(
  (typeof process !== 'undefined' && process.env.ECOS_CURSOR_REGISTRY_DIR) || '/tmp',
  'ecos_ttl_cursor_registry_383.json'
);

/**
 * Create a TTL-aware file-backed cursor registry.
 *
 * @param {{
 *   maxEntries?: number,
 *   ttlMs?: number,           — per-entry TTL in ms (default 24h); 0 = no TTL
 *   filePath?: string,
 *   ephemeral?: boolean,
 * }} [opts]
 */
function createTtlCursorRegistry383(opts) {
  const o         = opts || {};
  const ephemeral = !!o.ephemeral;
  const filePath  = ephemeral ? null : (o.filePath || DEFAULT_PERSIST_TTL_FILE_383);
  const maxEntries = (typeof o.maxEntries === 'number' && o.maxEntries > 0) ? o.maxEntries : 1000;
  const ttlMs      = (typeof o.ttlMs === 'number' && o.ttlMs >= 0) ? o.ttlMs : DEFAULT_TTL_MS_383;

  // Internal store: name → { cursor, setAt (ISO), meta, decoded }
  const _store383 = new Map();

  function _isExpired383(entry, nowMs) {
    if (ttlMs === 0) return false;
    const setAtMs = entry.setAt ? new Date(entry.setAt).getTime() : 0;
    return (nowMs - setAtMs) > ttlMs;
  }

  function _now383() { return Date.now(); }

  // ─── Persistence helpers ──────────────────────────────────────────────────

  function load383() {
    if (ephemeral || !filePath) return { ok: true, loaded: 0 };
    try {
      if (!fs.existsSync(filePath)) return { ok: true, loaded: 0 };
      const raw  = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.entries)) {
        return { ok: false, error: 'invalid persist file: missing entries array', loaded: 0 };
      }
      const nowMs = _now383();
      let loaded = 0;
      for (const entry of data.entries) {
        if (!entry || !entry.name || !entry.cursor) continue;
        // Skip already-expired entries on load
        if (ttlMs > 0 && entry.setAt && (nowMs - new Date(entry.setAt).getTime()) > ttlMs) continue;
        const decoded = CC380.decodeCursor380(entry.cursor);
        if (!decoded) continue;
        _store383.set(entry.name, { cursor: entry.cursor, setAt: entry.setAt, meta: entry.meta || null, decoded });
        loaded++;
      }
      return { ok: true, loaded };
    } catch (e) {
      return { ok: false, error: 'load failed: ' + e.message, loaded: 0 };
    }
  }

  function flush383() {
    if (ephemeral || !filePath) return { ok: true, written: 0 };
    // Evict expired entries before flushing
    evictExpired383();
    try {
      const entries = [];
      for (const [name, entry] of _store383.entries()) {
        entries.push({ name, cursor: entry.cursor, setAt: entry.setAt, meta: entry.meta });
      }
      const data = {
        schema:    TTL_CURSOR_REGISTRY_SCHEMA_383,
        version:   TTL_CURSOR_REGISTRY_VERSION_383,
        ttlMs,
        flushedAt: new Date().toISOString(),
        entries,
      };
      const tmp = filePath + '.tmp383';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, filePath);
      return { ok: true, written: entries.length };
    } catch (e) {
      return { ok: false, error: 'flush failed: ' + e.message, written: 0 };
    }
  }

  // ─── Core API ─────────────────────────────────────────────────────────────

  function set383(name, cursor, meta) {
    if (!name || typeof name !== 'string') {
      return { ok: false, error: 'name is required and must be a string', schema: TTL_CURSOR_REGISTRY_SCHEMA_383, version: TTL_CURSOR_REGISTRY_VERSION_383 };
    }
    if (typeof cursor !== 'string') {
      return { ok: false, error: 'cursor must be a string', schema: TTL_CURSOR_REGISTRY_SCHEMA_383, version: TTL_CURSOR_REGISTRY_VERSION_383 };
    }
    const decoded = CC380.decodeCursor380(cursor);
    if (!decoded) {
      return { ok: false, error: 'cursor token is not a valid V380 cursor', schema: TTL_CURSOR_REGISTRY_SCHEMA_383, version: TTL_CURSOR_REGISTRY_VERSION_383 };
    }
    // Evict oldest if at capacity (and not updating existing)
    if (!_store383.has(name) && _store383.size >= maxEntries) {
      const oldest = _store383.keys().next().value;
      _store383.delete(oldest);
    }
    const setAt = new Date().toISOString();
    _store383.set(name, { cursor, setAt, meta: meta || null, decoded });
    flush383();
    return { ok: true, schema: TTL_CURSOR_REGISTRY_SCHEMA_383, version: TTL_CURSOR_REGISTRY_VERSION_383, name, cursor, setAt };
  }

  function get383(name) {
    const nowMs = _now383();
    const entry = _store383.get(name) || null;
    if (entry && _isExpired383(entry, nowMs)) {
      _store383.delete(name);
      flush383();
      return { ok: false, schema: TTL_CURSOR_REGISTRY_SCHEMA_383, version: TTL_CURSOR_REGISTRY_VERSION_383, name, cursor: null, setAt: null, meta: null, decoded: null, expired: true };
    }
    return {
      ok:      entry !== null,
      schema:  TTL_CURSOR_REGISTRY_SCHEMA_383,
      version: TTL_CURSOR_REGISTRY_VERSION_383,
      name,
      cursor:  entry ? entry.cursor  : null,
      setAt:   entry ? entry.setAt   : null,
      meta:    entry ? entry.meta    : null,
      decoded: entry ? entry.decoded : null,
      expired: false,
    };
  }

  function has383(name) {
    const nowMs = _now383();
    const entry = _store383.get(name);
    if (!entry) return false;
    if (_isExpired383(entry, nowMs)) { _store383.delete(name); return false; }
    return true;
  }

  function delete383(name) {
    const deleted = _store383.delete(name);
    if (deleted) flush383();
    return deleted;
  }

  function clear383() {
    const count = _store383.size;
    _store383.clear();
    flush383();
    return count;
  }

  function list383() {
    const nowMs = _now383();
    const result = [];
    for (const [name, entry] of _store383.entries()) {
      if (_isExpired383(entry, nowMs)) continue;
      result.push({ name, cursor: entry.cursor, setAt: entry.setAt, meta: entry.meta });
    }
    return result;
  }

  function size383() {
    const nowMs = _now383();
    let count = 0;
    for (const [, entry] of _store383.entries()) {
      if (!_isExpired383(entry, nowMs)) count++;
    }
    return count;
  }

  /**
   * Evict all expired entries from the in-memory store.
   * @returns {{ evicted: number }}
   */
  function evictExpired383() {
    const nowMs   = _now383();
    let evicted = 0;
    for (const [name, entry] of _store383.entries()) {
      if (_isExpired383(entry, nowMs)) { _store383.delete(name); evicted++; }
    }
    return { evicted };
  }

  /**
   * Return stats about the registry.
   */
  function getStats383() {
    const nowMs  = _now383();
    let live = 0, expired = 0;
    for (const [, entry] of _store383.entries()) {
      if (_isExpired383(entry, nowMs)) expired++;
      else live++;
    }
    return {
      ok: true,
      schema:  TTL_CURSOR_REGISTRY_SCHEMA_383,
      version: TTL_CURSOR_REGISTRY_VERSION_383,
      totalStored: _store383.size,
      liveEntries: live,
      expiredEntries: expired,
      ttlMs,
      maxEntries,
      filePath,
    };
  }

  // Auto-load on init
  load383();

  return {
    set:          set383,
    get:          get383,
    has:          has383,
    delete:       delete383,
    clear:        clear383,
    list:         list383,
    size:         size383,
    load:         load383,
    flush:        flush383,
    evictExpired: evictExpired383,
    getStats:     getStats383,
    filePath,
    ttlMs,
    schema:  TTL_CURSOR_REGISTRY_SCHEMA_383,
    version: TTL_CURSOR_REGISTRY_VERSION_383,
  };
}

module.exports = {
  TTL_CURSOR_REGISTRY_VERSION_383,
  TTL_CURSOR_REGISTRY_SCHEMA_383,
  DEFAULT_TTL_MS_383,
  createTtlCursorRegistry383,
};
