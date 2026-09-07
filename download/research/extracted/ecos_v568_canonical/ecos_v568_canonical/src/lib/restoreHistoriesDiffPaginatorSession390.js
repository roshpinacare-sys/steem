'use strict';
/**
 * lib/restoreHistoriesDiffPaginatorSession390.js — ECOS V390 (Phase P278)
 *
 * DIRECTION 1: Restore histories diff paginator session.
 *
 * createRestoreHistoriesDiffPaginatorSession390(opts) combines
 * paginateRestoreHistoriesDiff389 with createPersistedCursorRegistry382
 * so a caller can resume a restore-histories-diff pagination session by name
 * across server restarts, mirroring createSweepDiffPaginatorSession389 for the
 * restore-histories-diff surface. Exposes
 * nextPage/prevPage/resetSession/getSessionCursor/listSessions API.
 *
 * Exports:
 *   RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_VERSION_390
 *   RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_SCHEMA_390
 *   createRestoreHistoriesDiffPaginatorSession390(opts)
 *     — returns a session manager:
 *         nextPage(name, diff, pageOpts),
 *         prevPage(name, diff, pageOpts),
 *         resetSession(name),
 *         getSessionCursor(name),
 *         listSessions(),
 *         registry
 *
 * Endpoints:
 *   POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/diff/session/next  [V390-T01a]
 *   POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/diff/session/prev  [V390-T01b]
 *   GET  /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/diff/session/:name [V390-T01c]
 *   DELETE /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/diff/session/:name [V390-T01d]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 390 (R2).
 * Sacred untouched (R1). V361..V389 preserved (R6).
 *
 * @version 390.0.0
 */

const RHDP389 = require('./restoreHistoriesDiffPaginator389.js');
const PCR382  = require('./persistedCursorRegistry382.js');

const RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_VERSION_390 = '390.0.0';
const RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_SCHEMA_390  =
  'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.session.restore.history.diff.paginator.session/v390';

/**
 * Create a restore-histories-diff paginator session manager backed by a
 * persisted cursor registry.
 *
 * @param {{
 *   filePath?: string,
 *   ephemeral?: boolean,
 *   maxSessions?: number,
 *   defaultPageLimit?: number,
 * }} [opts]
 * @returns {{
 *   nextPage(name, diff, pageOpts?): object,
 *   prevPage(name, diff, pageOpts?): object,
 *   resetSession(name): boolean,
 *   getSessionCursor(name): { ok, cursor, startIndex, setAt },
 *   listSessions(): Array<{ name, cursor, setAt }>,
 *   registry: object,
 *   schema: string,
 *   version: string,
 * }}
 */
function createRestoreHistoriesDiffPaginatorSession390(opts) {
  const o = opts || {};
  const defaultPageLimit = (typeof o.defaultPageLimit === 'number' && o.defaultPageLimit > 0)
    ? o.defaultPageLimit
    : RHDP389.DEFAULT_RESTORE_DIFF_PAGE_LIMIT_389;

  const registry = PCR382.createPersistedCursorRegistry382({
    filePath:   o.filePath,
    ephemeral:  o.ephemeral !== undefined ? o.ephemeral : undefined,
    maxEntries: o.maxSessions,
  });

  /**
   * Fetch the next page of a named restore-histories-diff session.
   * On first call the session starts at the beginning; subsequent calls resume
   * from the last nextCursor stored in the registry.
   *
   * @param {string} name — session identifier
   * @param {object|{ histA, histB }} diff — pre-built diff or { histA, histB }
   * @param {{ limit?: number, includeInBoth?: boolean }} [pageOpts]
   */
  function nextPage390(name, diff, pageOpts) {
    const po    = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    const entry  = registry.get(name);
    const cursor = entry.ok ? entry.cursor : null;

    const result = RHDP389.paginateRestoreHistoriesDiff389(diff, {
      cursor,
      limit,
      includeInBoth: po.includeInBoth !== false,
    });

    if (result.ok && result.nextCursor) {
      registry.set(name, result.nextCursor, { sessionName: name, direction: 'next' });
    }

    return {
      ...result,
      sessionName: name,
      resumedFrom: cursor,
      schema:      RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_SCHEMA_390,
      version:     RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_VERSION_390,
    };
  }

  /**
   * Fetch the previous page of a named restore-histories-diff session.
   *
   * @param {string} name
   * @param {object|{ histA, histB }} diff
   * @param {{ limit?: number, includeInBoth?: boolean }} [pageOpts]
   */
  function prevPage390(name, diff, pageOpts) {
    const po    = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    const entry  = registry.get(name);
    const cursor = entry.ok ? entry.cursor : null;

    const current = RHDP389.paginateRestoreHistoriesDiff389(diff, {
      cursor,
      limit,
      includeInBoth: po.includeInBoth !== false,
    });

    if (!current.ok) {
      return {
        ...current,
        sessionName: name,
        schema:  RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_SCHEMA_390,
        version: RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_VERSION_390,
      };
    }

    const prevCursor = current.prevCursor;
    if (!prevCursor) {
      return {
        ...current,
        sessionName: name,
        atStart: true,
        schema:  RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_SCHEMA_390,
        version: RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_VERSION_390,
      };
    }

    const result = RHDP389.paginateRestoreHistoriesDiff389(diff, {
      cursor: prevCursor,
      limit,
      includeInBoth: po.includeInBoth !== false,
    });

    if (result.ok) {
      registry.set(name, prevCursor, { sessionName: name, direction: 'prev' });
    }

    return {
      ...result,
      sessionName: name,
      schema:  RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_SCHEMA_390,
      version: RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_VERSION_390,
    };
  }

  /**
   * Reset a named session (delete its stored cursor).
   * @param {string} name
   * @returns {boolean}
   */
  function resetSession390(name) {
    return registry.delete(name);
  }

  /**
   * Get the current cursor position for a named session.
   * @param {string} name
   * @returns {{ ok, cursor, startIndex, setAt }}
   */
  function getSessionCursor390(name) {
    const entry   = registry.get(name);
    const decoded = entry.ok ? RHDP389.decodeRestoreDiffCursor389(entry.cursor) : null;
    return {
      ok:         entry.ok,
      cursor:     entry.cursor,
      startIndex: decoded ? decoded.stepIndex : null,
      setAt:      entry.setAt,
      schema:     RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_SCHEMA_390,
      version:    RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_VERSION_390,
    };
  }

  /**
   * List all active sessions.
   */
  function listSessions390() {
    return registry.list();
  }

  return {
    nextPage:         nextPage390,
    prevPage:         prevPage390,
    resetSession:     resetSession390,
    getSessionCursor: getSessionCursor390,
    listSessions:     listSessions390,
    registry,
    schema:  RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_SCHEMA_390,
    version: RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_VERSION_390,
  };
}

module.exports = {
  RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_VERSION_390,
  RESTORE_HISTORIES_DIFF_PAGINATOR_SESSION_SCHEMA_390,
  createRestoreHistoriesDiffPaginatorSession390,
};
