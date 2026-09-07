'use strict';
/**
 * lib/sweepDiffPaginatorSession389.js — ECOS V389 (Phase P277)
 *
 * DIRECTION 3: Sweep diff paginator session.
 *
 * createSweepDiffPaginatorSession389(opts) combines paginateTtlSweepHistoryDiff388
 * with createPersistedCursorRegistry382 so a caller can resume a
 * sweep-history-diff pagination session by name across server restarts,
 * mirroring createAlertDiffPaginatorSession387 for the sweep-diff surface.
 * Exposes nextPage/prevPage/resetSession/getSessionCursor/listSessions API.
 *
 * Exports:
 *   SWEEP_DIFF_PAGINATOR_SESSION_VERSION_389
 *   SWEEP_DIFF_PAGINATOR_SESSION_SCHEMA_389
 *   createSweepDiffPaginatorSession389(opts)
 *     — returns a session manager:
 *         nextPage(name, diff, pageOpts),
 *         prevPage(name, diff, pageOpts),
 *         resetSession(name),
 *         getSessionCursor(name),
 *         listSessions(),
 *         registry
 *
 * Endpoints:
 *   POST /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/sweep/history/diff/session/next  [V389-T03a]
 *   POST /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/sweep/history/diff/session/prev  [V389-T03b]
 *   GET  /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/sweep/history/diff/session/:name [V389-T03c]
 *   DELETE /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/sweep/history/diff/session/:name [V389-T03d]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 389 (R2).
 * Sacred untouched (R1). V361..V388 preserved (R6).
 *
 * @version 389.0.0
 */

const TSP388 = require('./ttlSweepHistoryDiffPaginator388.js');
const PCR382 = require('./persistedCursorRegistry382.js');

const SWEEP_DIFF_PAGINATOR_SESSION_VERSION_389 = '389.0.0';
const SWEEP_DIFF_PAGINATOR_SESSION_SCHEMA_389  =
  'ecos.integrity.mission.proof.index.comparator.history.cursor.registry.ttl.sweep.history.diff.paginator.session/v389';

/**
 * Create a sweep-history-diff paginator session manager backed by a persisted cursor registry.
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
function createSweepDiffPaginatorSession389(opts) {
  const o = opts || {};
  const defaultPageLimit = (typeof o.defaultPageLimit === 'number' && o.defaultPageLimit > 0)
    ? o.defaultPageLimit
    : TSP388.DEFAULT_SWEEP_DIFF_PAGE_LIMIT_388;

  const registry = PCR382.createPersistedCursorRegistry382({
    filePath:   o.filePath,
    ephemeral:  o.ephemeral !== undefined ? o.ephemeral : undefined,
    maxEntries: o.maxSessions,
  });

  /**
   * Fetch the next page of a named sweep-diff session.
   * On first call the session starts at the beginning; subsequent calls resume
   * from the last nextCursor stored in the registry.
   *
   * @param {string} name — session identifier
   * @param {object|{ histA, histB }} diff — pre-built diff or { histA, histB }
   * @param {{ limit?: number, includeInBoth?: boolean }} [pageOpts]
   */
  function nextPage389(name, diff, pageOpts) {
    const po    = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    const entry  = registry.get(name);
    const cursor = entry.ok ? entry.cursor : null;

    const result = TSP388.paginateTtlSweepHistoryDiff388(diff, {
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
      schema:      SWEEP_DIFF_PAGINATOR_SESSION_SCHEMA_389,
      version:     SWEEP_DIFF_PAGINATOR_SESSION_VERSION_389,
    };
  }

  /**
   * Fetch the previous page of a named sweep-diff session.
   *
   * @param {string} name
   * @param {object|{ histA, histB }} diff
   * @param {{ limit?: number, includeInBoth?: boolean }} [pageOpts]
   */
  function prevPage389(name, diff, pageOpts) {
    const po    = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    const entry  = registry.get(name);
    const cursor = entry.ok ? entry.cursor : null;

    const current = TSP388.paginateTtlSweepHistoryDiff388(diff, {
      cursor,
      limit,
      includeInBoth: po.includeInBoth !== false,
    });

    if (!current.ok) {
      return {
        ...current,
        sessionName: name,
        schema:  SWEEP_DIFF_PAGINATOR_SESSION_SCHEMA_389,
        version: SWEEP_DIFF_PAGINATOR_SESSION_VERSION_389,
      };
    }

    const prevCursor = current.prevCursor;
    if (!prevCursor) {
      return {
        ...current,
        sessionName: name,
        atStart: true,
        schema:  SWEEP_DIFF_PAGINATOR_SESSION_SCHEMA_389,
        version: SWEEP_DIFF_PAGINATOR_SESSION_VERSION_389,
      };
    }

    const result = TSP388.paginateTtlSweepHistoryDiff388(diff, {
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
      schema:  SWEEP_DIFF_PAGINATOR_SESSION_SCHEMA_389,
      version: SWEEP_DIFF_PAGINATOR_SESSION_VERSION_389,
    };
  }

  /**
   * Reset a named session (delete its stored cursor).
   * @param {string} name
   * @returns {boolean}
   */
  function resetSession389(name) {
    return registry.delete(name);
  }

  /**
   * Get the current cursor position for a named session.
   * @param {string} name
   * @returns {{ ok, cursor, startIndex, setAt }}
   */
  function getSessionCursor389(name) {
    const entry   = registry.get(name);
    const decoded = entry.ok ? TSP388.decodeSweepDiffCursor388(entry.cursor) : null;
    return {
      ok:         entry.ok,
      cursor:     entry.cursor,
      startIndex: decoded ? decoded.stepIndex : null,
      setAt:      entry.setAt,
      schema:     SWEEP_DIFF_PAGINATOR_SESSION_SCHEMA_389,
      version:    SWEEP_DIFF_PAGINATOR_SESSION_VERSION_389,
    };
  }

  /**
   * List all active sessions.
   */
  function listSessions389() {
    return registry.list();
  }

  return {
    nextPage:         nextPage389,
    prevPage:         prevPage389,
    resetSession:     resetSession389,
    getSessionCursor: getSessionCursor389,
    listSessions:     listSessions389,
    registry,
    schema:  SWEEP_DIFF_PAGINATOR_SESSION_SCHEMA_389,
    version: SWEEP_DIFF_PAGINATOR_SESSION_VERSION_389,
  };
}

module.exports = {
  SWEEP_DIFF_PAGINATOR_SESSION_VERSION_389,
  SWEEP_DIFF_PAGINATOR_SESSION_SCHEMA_389,
  createSweepDiffPaginatorSession389,
};
