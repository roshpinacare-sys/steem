'use strict';
  /**
   * lib/cursorRegistry381.js — ECOS V381 (Phase P269)
   *
   * DIRECTION 3: Cursor registry.
   *
   * createCursorRegistry381() is a lightweight in-memory store that maps named
   * cursor tokens (e.g. by caller ID or session) to their last-known position in
   * a comparator history, enabling server-side cursor management without
   * client-side state.
   *
   * Exports:
   *   CURSOR_REGISTRY_VERSION_381
   *   CURSOR_REGISTRY_SCHEMA_381
   *   createCursorRegistry381(opts)
   *     — returns a registry instance with: set, get, has, delete, clear,
   *         list, size
   *
   * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare/cursor-registry [V381-T03]
   *           GET  /api/v1/missions/proof-index/snapshot/compare/cursor-registry/:name
   *
   * Pure (R3 no new npm deps). All new identifiers end with 381 (R2).
   * Sacred untouched (R1). V361..V380 preserved (R6).
   *
   * @version 381.0.0
   */

  const CC380 = require('./comparatorHistoryCursor380.js');

  const CURSOR_REGISTRY_VERSION_381 = '381.0.0';
  const CURSOR_REGISTRY_SCHEMA_381  = 'ecos.integrity.mission.proof.index.comparator.history.cursor.registry/v381';

  /**
   * Create a cursor registry.
   *
   * @param {{
   *   maxEntries?: number,
   *   defaultTtlMs?: number,
   * }} [opts]
   * @returns {{
   *   set(name: string, cursor: string, meta?: object): { ok: boolean, name: string, cursor: string, setAt: string }
   *   get(name: string): { ok: boolean, name: string, cursor: string|null, setAt: string|null, meta: object|null }
   *   has(name: string): boolean
   *   delete(name: string): boolean
   *   clear(): number
   *   list(): Array<{ name: string, cursor: string, setAt: string, meta: object }>
   *   size(): number
   * }}
   */
  function createCursorRegistry381(opts) {
    const o = opts || {};
    const maxEntries  = (typeof o.maxEntries === 'number' && o.maxEntries > 0) ? o.maxEntries : 1000;

    // Internal store: name → { cursor, setAt, meta }
    const _store381 = new Map();

    /**
     * Store or update the cursor for a named session/caller.
     * @param {string} name — caller/session identifier
     * @param {string} cursor — opaque cursor token (e.g. from encodeCursor380)
     * @param {object} [meta] — optional caller-supplied metadata
     */
    function set381(name, cursor, meta) {
      if (!name || typeof name !== 'string') {
        return { ok: false, error: 'name is required and must be a string', schema: CURSOR_REGISTRY_SCHEMA_381, version: CURSOR_REGISTRY_VERSION_381 };
      }
      if (typeof cursor !== 'string') {
        return { ok: false, error: 'cursor must be a string', schema: CURSOR_REGISTRY_SCHEMA_381, version: CURSOR_REGISTRY_VERSION_381 };
      }
      // Validate the cursor is decodable
      const decoded = CC380.decodeCursor380(cursor);
      if (!decoded) {
        return { ok: false, error: 'cursor token is not a valid V380 cursor', schema: CURSOR_REGISTRY_SCHEMA_381, version: CURSOR_REGISTRY_VERSION_381 };
      }
      // Evict oldest entry if at capacity
      if (!_store381.has(name) && _store381.size >= maxEntries) {
        const oldest = _store381.keys().next().value;
        _store381.delete(oldest);
      }
      const setAt = new Date().toISOString();
      _store381.set(name, { cursor, setAt, meta: meta || null, decoded });
      return { ok: true, schema: CURSOR_REGISTRY_SCHEMA_381, version: CURSOR_REGISTRY_VERSION_381, name, cursor, setAt };
    }

    /**
     * Retrieve the stored cursor for a name.
     * @param {string} name
     */
    function get381(name) {
      const entry = _store381.get(name) || null;
      return {
        ok:     entry !== null,
        schema: CURSOR_REGISTRY_SCHEMA_381,
        version: CURSOR_REGISTRY_VERSION_381,
        name,
        cursor:  entry ? entry.cursor  : null,
        setAt:   entry ? entry.setAt   : null,
        meta:    entry ? entry.meta    : null,
        decoded: entry ? entry.decoded : null,
      };
    }

    /**
     * Check if a name has a stored cursor.
     * @param {string} name
     */
    function has381(name) {
      return _store381.has(name);
    }

    /**
     * Delete the cursor for a name.
     * @param {string} name
     */
    function delete381(name) {
      return _store381.delete(name);
    }

    /**
     * Clear all cursor entries.
     * @returns {number} — count of removed entries
     */
    function clear381() {
      const count = _store381.size;
      _store381.clear();
      return count;
    }

    /**
     * List all stored cursor entries.
     * @returns {Array<{ name, cursor, setAt, meta }>}
     */
    function list381() {
      const result = [];
      for (const [name, entry] of _store381.entries()) {
        result.push({ name, cursor: entry.cursor, setAt: entry.setAt, meta: entry.meta });
      }
      return result;
    }

    /**
     * Return the number of stored cursor entries.
     */
    function size381() {
      return _store381.size;
    }

    return {
      set:    set381,
      get:    get381,
      has:    has381,
      delete: delete381,
      clear:  clear381,
      list:   list381,
      size:   size381,
      schema:  CURSOR_REGISTRY_SCHEMA_381,
      version: CURSOR_REGISTRY_VERSION_381,
    };
  }

  module.exports = {
    CURSOR_REGISTRY_VERSION_381,
    CURSOR_REGISTRY_SCHEMA_381,
    createCursorRegistry381,
  };
  