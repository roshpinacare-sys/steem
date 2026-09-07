'use strict';
/**
 * lib/restoreHistorySession388.js — ECOS V388 (Phase P276)
 *
 * DIRECTION 4: Restore history projection session.
 *
 * createRestoreHistorySession388(opts) combines getRestoreHistory387 with
 * createPersistedCursorRegistry382 for offset-resumable restore-history reads
 * by name across server restarts, mirroring createAlertDiffPaginatorSession387
 * for the restore-history surface.
 *
 * Exports:
 *   RESTORE_HISTORY_SESSION_VERSION_388
 *   RESTORE_HISTORY_SESSION_SCHEMA_388
 *   createRestoreHistorySession388(opts)
 *     — returns a session manager:
 *         nextPage(name, ctx, pageOpts),
 *         prevPage(name, ctx, pageOpts),
 *         resetSession(name),
 *         getSessionCursor(name),
 *         listSessions(),
 *         registry
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/session/next [V388-T04a]
 *           POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/session/prev [V388-T04b]
 *           GET  /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/session/:name [V388-T04c]
 *           DELETE /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/session/:name [V388-T04d]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 388 (R2).
 * Sacred untouched (R1). V361..V387 preserved (R6).
 *
 * @version 388.0.0
 */

const RHP387 = require('./restoreHistoryProjection387.js');
const PCR382 = require('./persistedCursorRegistry382.js');

const RESTORE_HISTORY_SESSION_VERSION_388 = '388.0.0';
const RESTORE_HISTORY_SESSION_SCHEMA_388  =
  'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.paginator.session.restore.history.session/v388';

const DEFAULT_RESTORE_PAGE_LIMIT_388 = 20;

/**
 * Encode an opaque cursor token for the restore history session paginator.
 * Uses `stepIndex` (= offset) to satisfy cursorRegistry381 V380 validation.
 * @param {number} offset
 * @param {string|null} [ts]
 * @returns {string}
 */
function encodeRestoreSessionCursor388(offset, ts) {
  return Buffer.from(
    JSON.stringify({ v: 1, stepIndex: Math.floor(offset), ts: ts || null }),
    'utf8'
  ).toString('base64');
}

/**
 * Decode a cursor token. Returns null if the token is invalid.
 * @param {string} token
 * @returns {{ offset: number, ts: string|null }|null}
 */
function decodeRestoreSessionCursor388(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const obj = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    // Accept both stepIndex (primary, for registry compat) and offset (legacy)
    if (obj && typeof obj.stepIndex === 'number' && obj.stepIndex >= 0) {
      return { offset: obj.stepIndex, ts: obj.ts || null };
    }
    if (obj && typeof obj.offset === 'number' && obj.offset >= 0) {
      return { offset: obj.offset, ts: obj.ts || null };
    }
  } catch (_) {}
  return null;
}

/**
 * Create a restore-history pagination session manager backed by a persisted
 * cursor registry.
 *
 * @param {{
 *   filePath?: string,
 *   ephemeral?: boolean,
 *   maxSessions?: number,
 *   defaultPageLimit?: number,
 *   sinceTs?: string,
 * }} [opts]
 * @returns {{
 *   nextPage(name, ctx, pageOpts?): object,
 *   prevPage(name, ctx, pageOpts?): object,
 *   resetSession(name): boolean,
 *   getSessionCursor(name): { ok, cursor, offset, setAt },
 *   listSessions(): Array<{ name, cursor, setAt }>,
 *   registry: object,
 *   schema: string,
 *   version: string,
 * }}
 */
function createRestoreHistorySession388(opts) {
  const o = opts || {};
  const defaultPageLimit = (typeof o.defaultPageLimit === 'number' && o.defaultPageLimit > 0)
    ? o.defaultPageLimit
    : DEFAULT_RESTORE_PAGE_LIMIT_388;

  const registry = PCR382.createPersistedCursorRegistry382({
    filePath:   o.filePath,
    ephemeral:  o.ephemeral !== undefined ? o.ephemeral : undefined,
    maxEntries: o.maxSessions,
  });

  /**
   * Fetch the next page of restore history for a named session.
   * On first call the session starts at offset 0; subsequent calls resume
   * from the last cursor stored in the registry.
   *
   * @param {string} name — session identifier
   * @param {{ auditLog: object }} ctx — context for getRestoreHistory387
   * @param {{ limit?: number, sinceTs?: string }} [pageOpts]
   */
  function nextPage388(name, ctx, pageOpts) {
    const po    = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    const entry   = registry.get(name);
    let offset    = 0;

    if (entry.ok && entry.cursor) {
      const decoded = decodeRestoreSessionCursor388(entry.cursor);
      if (decoded) offset = decoded.offset;
    }

    const result = RHP387.getRestoreHistory387(ctx, {
      limit,
      offset,
      sinceTs: po.sinceTs || o.sinceTs,
    });

    if (!result.ok) {
      return {
        ...result,
        sessionName:  name,
        schema:       RESTORE_HISTORY_SESSION_SCHEMA_388,
        version:      RESTORE_HISTORY_SESSION_VERSION_388,
      };
    }

    const nextOffset = offset + result.restores.length;
    const hasNext    = nextOffset < result.totalRestores;
    const hasPrev    = offset > 0;
    const ts         = new Date().toISOString();

    const nextCursor    = hasNext ? encodeRestoreSessionCursor388(nextOffset, ts) : null;
    const prevCursor    = hasPrev ? encodeRestoreSessionCursor388(Math.max(0, offset - limit), ts) : null;
    const currentCursor = encodeRestoreSessionCursor388(offset, ts);

    if (nextCursor) {
      registry.set(name, nextCursor, { sessionName: name, direction: 'next' });
    }

    return {
      ...result,
      sessionName:    name,
      resumedFrom:    entry.ok ? entry.cursor : null,
      startIndex:     offset,
      pageSize:       result.restores.length,
      cursor:         currentCursor,
      nextCursor,
      prevCursor,
      schema:         RESTORE_HISTORY_SESSION_SCHEMA_388,
      version:        RESTORE_HISTORY_SESSION_VERSION_388,
    };
  }

  /**
   * Fetch the previous page of restore history for a named session.
   *
   * @param {string} name
   * @param {{ auditLog: object }} ctx
   * @param {{ limit?: number, sinceTs?: string }} [pageOpts]
   */
  function prevPage388(name, ctx, pageOpts) {
    const po    = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    const entry   = registry.get(name);
    let offset    = 0;

    if (entry.ok && entry.cursor) {
      const decoded = decodeRestoreSessionCursor388(entry.cursor);
      if (decoded) offset = decoded.offset;
    }

    if (offset === 0) {
      const result = RHP387.getRestoreHistory387(ctx, {
        limit,
        offset: 0,
        sinceTs: po.sinceTs || o.sinceTs,
      });
      return {
        ...result,
        sessionName: name,
        atStart:     true,
        startIndex:  0,
        pageSize:    result.ok ? result.restores.length : 0,
        cursor:      encodeRestoreSessionCursor388(0, new Date().toISOString()),
        nextCursor:  null,
        prevCursor:  null,
        schema:      RESTORE_HISTORY_SESSION_SCHEMA_388,
        version:     RESTORE_HISTORY_SESSION_VERSION_388,
      };
    }

    const prevOffset = Math.max(0, offset - limit);
    const result = RHP387.getRestoreHistory387(ctx, {
      limit,
      offset: prevOffset,
      sinceTs: po.sinceTs || o.sinceTs,
    });

    if (!result.ok) {
      return {
        ...result,
        sessionName: name,
        schema:      RESTORE_HISTORY_SESSION_SCHEMA_388,
        version:     RESTORE_HISTORY_SESSION_VERSION_388,
      };
    }

    const ts = new Date().toISOString();
    const prevCursor = encodeRestoreSessionCursor388(prevOffset, ts);

    registry.set(name, prevCursor, { sessionName: name, direction: 'prev' });

    const hasPrev = prevOffset > 0;
    const hasNext = (prevOffset + result.restores.length) < result.totalRestores;

    return {
      ...result,
      sessionName:    name,
      startIndex:     prevOffset,
      pageSize:       result.restores.length,
      cursor:         prevCursor,
      nextCursor:     hasNext ? encodeRestoreSessionCursor388(prevOffset + result.restores.length, ts) : null,
      prevCursor:     hasPrev ? encodeRestoreSessionCursor388(Math.max(0, prevOffset - limit), ts) : null,
      schema:         RESTORE_HISTORY_SESSION_SCHEMA_388,
      version:        RESTORE_HISTORY_SESSION_VERSION_388,
    };
  }

  /**
   * Reset a named session (delete its stored cursor).
   * @param {string} name
   * @returns {boolean}
   */
  function resetSession388(name) {
    return registry.delete(name);
  }

  /**
   * Get the current cursor position for a named session.
   * @param {string} name
   * @returns {{ ok, cursor, offset, setAt }}
   */
  function getSessionCursor388(name) {
    const entry   = registry.get(name);
    const decoded = entry.ok ? decodeRestoreSessionCursor388(entry.cursor) : null;
    return {
      ok:      entry.ok,
      cursor:  entry.cursor,
      offset:  decoded ? decoded.offset : null,
      setAt:   entry.setAt,
      schema:  RESTORE_HISTORY_SESSION_SCHEMA_388,
      version: RESTORE_HISTORY_SESSION_VERSION_388,
    };
  }

  /**
   * List all active sessions.
   */
  function listSessions388() {
    return registry.list();
  }

  return {
    nextPage:         nextPage388,
    prevPage:         prevPage388,
    resetSession:     resetSession388,
    getSessionCursor: getSessionCursor388,
    listSessions:     listSessions388,
    registry,
    schema:  RESTORE_HISTORY_SESSION_SCHEMA_388,
    version: RESTORE_HISTORY_SESSION_VERSION_388,
  };
}

module.exports = {
  RESTORE_HISTORY_SESSION_VERSION_388,
  RESTORE_HISTORY_SESSION_SCHEMA_388,
  DEFAULT_RESTORE_PAGE_LIMIT_388,
  encodeRestoreSessionCursor388,
  decodeRestoreSessionCursor388,
  createRestoreHistorySession388,
};
