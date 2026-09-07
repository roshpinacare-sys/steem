'use strict';
/**
 * lib/persistedCursorRegistry382.js — ECOS V382 (Phase P270)
 *
 * DIRECTION 3: Cursor registry persistence adapter.
 *
 * createPersistedCursorRegistry382(opts) wraps createCursorRegistry381 with
 * file-backed persistence: JSON file flush on set/delete, load on init, so
 * cursor positions survive server restarts.
 *
 * Exports:
 *   PERSISTED_CURSOR_REGISTRY_VERSION_382
 *   PERSISTED_CURSOR_REGISTRY_SCHEMA_382
 *   createPersistedCursorRegistry382(opts)
 *     — returns the same registry API as createCursorRegistry381 plus:
 *         load(), flush(), filePath
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare/cursor-registry/persisted [V382-T03]
 *           GET  /api/v1/missions/proof-index/snapshot/compare/cursor-registry/persisted/:name
 *           DELETE /api/v1/missions/proof-index/snapshot/compare/cursor-registry/persisted/:name
 *
 * Pure (R3 no new npm deps — uses only built-in `fs`). All new identifiers end with 382 (R2).
 * Sacred untouched (R1). V361..V381 preserved (R6).
 *
 * @version 382.0.0
 */

const fs  = require('fs');
const path = require('path');
const CR381 = require('./cursorRegistry381.js');

const PERSISTED_CURSOR_REGISTRY_VERSION_382 = '382.0.0';
const PERSISTED_CURSOR_REGISTRY_SCHEMA_382  = 'ecos.integrity.mission.proof.index.comparator.history.cursor.registry.persisted/v382';
const DEFAULT_PERSIST_FILE_382 = path.join(
  (typeof process !== 'undefined' && process.env.ECOS_CURSOR_REGISTRY_DIR) || '/tmp',
  'ecos_cursor_registry_382.json'
);

/**
 * Create a file-backed cursor registry.
 *
 * @param {{
 *   maxEntries?: number,
 *   filePath?: string,
 *   ephemeral?: boolean,   — if true, no file I/O (for tests)
 * }} [opts]
 * @returns {{
 *   set(name, cursor, meta?): object
 *   get(name): object
 *   has(name): boolean
 *   delete(name): boolean
 *   clear(): number
 *   list(): Array<{ name, cursor, setAt, meta }>
 *   size(): number
 *   load(): { ok: boolean, loaded: number }
 *   flush(): { ok: boolean, written: number }
 *   filePath: string|null
 *   schema: string
 *   version: string
 * }}
 */
function createPersistedCursorRegistry382(opts) {
  const o          = opts || {};
  const ephemeral  = !!o.ephemeral;
  const filePath   = ephemeral ? null : (o.filePath || DEFAULT_PERSIST_FILE_382);
  const inner      = CR381.createCursorRegistry381({ maxEntries: o.maxEntries });

  /**
   * Load persisted entries from the JSON file into the in-memory registry.
   * Silently no-ops if the file does not exist or cannot be parsed.
   * @returns {{ ok: boolean, loaded: number, error?: string }}
   */
  function load382() {
    if (ephemeral || !filePath) return { ok: true, loaded: 0 };
    try {
      if (!fs.existsSync(filePath)) return { ok: true, loaded: 0 };
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.entries)) {
        return { ok: false, error: 'invalid persist file: missing entries array', loaded: 0 };
      }
      let loaded = 0;
      for (const entry of data.entries) {
        if (entry && entry.name && entry.cursor) {
          const r = inner.set(entry.name, entry.cursor, entry.meta || null);
          if (r.ok) loaded++;
        }
      }
      return { ok: true, loaded };
    } catch (e) {
      return { ok: false, error: 'load failed: ' + e.message, loaded: 0 };
    }
  }

  /**
   * Flush the current in-memory registry to the JSON file atomically
   * (write to .tmp then rename).
   * @returns {{ ok: boolean, written: number, error?: string }}
   */
  function flush382() {
    if (ephemeral || !filePath) return { ok: true, written: 0 };
    try {
      const entries = inner.list();
      const data = {
        schema:    PERSISTED_CURSOR_REGISTRY_SCHEMA_382,
        version:   PERSISTED_CURSOR_REGISTRY_VERSION_382,
        flushedAt: new Date().toISOString(),
        entries,
      };
      const tmp = filePath + '.tmp382';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, filePath);
      return { ok: true, written: entries.length };
    } catch (e) {
      return { ok: false, error: 'flush failed: ' + e.message, written: 0 };
    }
  }

  // Auto-load on init
  load382();

  // Wrap set and delete to trigger flush
  function set382(name, cursor, meta) {
    const result = inner.set(name, cursor, meta);
    if (result.ok) flush382();
    return { ...result, schema: PERSISTED_CURSOR_REGISTRY_SCHEMA_382, version: PERSISTED_CURSOR_REGISTRY_VERSION_382 };
  }

  function delete382(name) {
    const deleted = inner.delete(name);
    if (deleted) flush382();
    return deleted;
  }

  function clear382() {
    const count = inner.clear();
    flush382();
    return count;
  }

  return {
    set:     set382,
    get:     inner.get,
    has:     inner.has,
    delete:  delete382,
    clear:   clear382,
    list:    inner.list,
    size:    inner.size,
    load:    load382,
    flush:   flush382,
    filePath,
    schema:  PERSISTED_CURSOR_REGISTRY_SCHEMA_382,
    version: PERSISTED_CURSOR_REGISTRY_VERSION_382,
  };
}

module.exports = {
  PERSISTED_CURSOR_REGISTRY_VERSION_382,
  PERSISTED_CURSOR_REGISTRY_SCHEMA_382,
  DEFAULT_PERSIST_FILE_382,
  createPersistedCursorRegistry382,
};
