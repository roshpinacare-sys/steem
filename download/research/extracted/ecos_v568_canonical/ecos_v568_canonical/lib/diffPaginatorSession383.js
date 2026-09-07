'use strict';
/**
 * lib/diffPaginatorSession383.js — ECOS V383 (Phase P271)
 *
 * DIRECTION 1: Diff paginator cursor registry integration.
 *
 * createDiffPaginatorSession383(opts) combines paginateAggregatorHistoryDiff382
 * with createPersistedCursorRegistry382 so a caller can resume a diff
 * pagination session by name across server restarts, storing and loading the
 * last cursor automatically.
 *
 * Exports:
 *   DIFF_PAGINATOR_SESSION_VERSION_383
 *   DIFF_PAGINATOR_SESSION_SCHEMA_383
 *   createDiffPaginatorSession383(opts)
 *     — returns a session manager: nextPage(name, diff, pageOpts),
 *         prevPage(name, diff, pageOpts), resetSession(name),
 *         getSessionCursor(name), listSessions(), registry
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session [V383-T01]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 383 (R2).
 * Sacred untouched (R1). V361..V382 preserved (R6).
 *
 * @version 383.0.0
 */

const ADP382 = require('./aggregatorHistoryDiffPaginator382.js');
const PCR382 = require('./persistedCursorRegistry382.js');

const DIFF_PAGINATOR_SESSION_VERSION_383 = '383.0.0';
const DIFF_PAGINATOR_SESSION_SCHEMA_383  = 'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.paginator.session/v383';

/**
 * Create a diff paginator session manager backed by a persisted cursor registry.
 *
 * @param {{
 *   filePath?: string,
 *   ephemeral?: boolean,
 *   maxSessions?: number,
 *   defaultPageLimit?: number,
 * }} [opts]
 * @returns {{
 *   nextPage(name, diff, pageOpts?): object
 *   prevPage(name, diff, pageOpts?): object
 *   resetSession(name): boolean
 *   getSessionCursor(name): { ok, cursor, startIndex }
 *   listSessions(): Array<{ name, cursor, setAt }>
 *   registry: object
 *   schema: string
 *   version: string
 * }}
 */
function createDiffPaginatorSession383(opts) {
  const o = opts || {};
  const defaultPageLimit = (typeof o.defaultPageLimit === 'number' && o.defaultPageLimit > 0)
    ? o.defaultPageLimit
    : ADP382.DEFAULT_AGG_DIFF_PAGE_LIMIT_382;

  const registry = PCR382.createPersistedCursorRegistry382({
    filePath:   o.filePath,
    ephemeral:  o.ephemeral !== false ? o.ephemeral : undefined,
    maxEntries: o.maxSessions,
  });

  /**
   * Fetch the next page of a named diff session.
   * On first call the session starts at the beginning; subsequent calls resume
   * from the last nextCursor stored in the registry.
   *
   * @param {string} name — session identifier
   * @param {object} diff — pre-built diffAggregatorHistories381 result (or { historyA, historyB })
   * @param {{ limit?: number }} [pageOpts]
   */
  function nextPage383(name, diff, pageOpts) {
    const po = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    // Look up existing cursor for this session
    const entry  = registry.get(name);
    const cursor = entry.ok ? entry.cursor : null;

    const result = ADP382.paginateAggregatorHistoryDiff382(diff, { cursor, limit });

    if (result.ok && result.nextCursor) {
      registry.set(name, result.nextCursor, { sessionName: name, direction: 'next' });
    } else if (result.ok && !result.nextCursor) {
      // End of pages — keep the cursor as-is so caller knows where the end was
    }

    return {
      ...result,
      sessionName:   name,
      resumedFrom:   cursor,
      schema:        DIFF_PAGINATOR_SESSION_SCHEMA_383,
      version:       DIFF_PAGINATOR_SESSION_VERSION_383,
    };
  }

  /**
   * Fetch the previous page of a named diff session.
   * Uses prevCursor from the current page derived from the stored cursor.
   *
   * @param {string} name
   * @param {object} diff
   * @param {{ limit?: number }} [pageOpts]
   */
  function prevPage383(name, diff, pageOpts) {
    const po = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    const entry  = registry.get(name);
    const cursor = entry.ok ? entry.cursor : null;

    // Get current page to find prevCursor
    const current = ADP382.paginateAggregatorHistoryDiff382(diff, { cursor, limit });

    if (!current.ok) {
      return {
        ...current,
        sessionName: name,
        schema:  DIFF_PAGINATOR_SESSION_SCHEMA_383,
        version: DIFF_PAGINATOR_SESSION_VERSION_383,
      };
    }

    const prevCursor = current.prevCursor;
    if (!prevCursor) {
      return {
        ...current,
        sessionName: name,
        atStart: true,
        schema:  DIFF_PAGINATOR_SESSION_SCHEMA_383,
        version: DIFF_PAGINATOR_SESSION_VERSION_383,
      };
    }

    const result = ADP382.paginateAggregatorHistoryDiff382(diff, { cursor: prevCursor, limit });

    if (result.ok) {
      // Store the prev cursor so next call continues from here
      const toStore = prevCursor;
      registry.set(name, toStore, { sessionName: name, direction: 'prev' });
    }

    return {
      ...result,
      sessionName: name,
      schema:  DIFF_PAGINATOR_SESSION_SCHEMA_383,
      version: DIFF_PAGINATOR_SESSION_VERSION_383,
    };
  }

  /**
   * Reset a named session (delete its stored cursor).
   * @param {string} name
   * @returns {boolean}
   */
  function resetSession383(name) {
    return registry.delete(name);
  }

  /**
   * Get the current cursor position for a named session.
   * @param {string} name
   * @returns {{ ok, cursor, startIndex }}
   */
  function getSessionCursor383(name) {
    const entry = registry.get(name);
    const decoded = entry.decoded || null;
    return {
      ok:         entry.ok,
      cursor:     entry.cursor,
      startIndex: decoded ? decoded.stepIndex : null,
      setAt:      entry.setAt,
      schema:     DIFF_PAGINATOR_SESSION_SCHEMA_383,
      version:    DIFF_PAGINATOR_SESSION_VERSION_383,
    };
  }

  /**
   * List all active sessions.
   */
  function listSessions383() {
    return registry.list();
  }

  return {
    nextPage:         nextPage383,
    prevPage:         prevPage383,
    resetSession:     resetSession383,
    getSessionCursor: getSessionCursor383,
    listSessions:     listSessions383,
    registry,
    schema:  DIFF_PAGINATOR_SESSION_SCHEMA_383,
    version: DIFF_PAGINATOR_SESSION_VERSION_383,
  };
}

module.exports = {
  DIFF_PAGINATOR_SESSION_VERSION_383,
  DIFF_PAGINATOR_SESSION_SCHEMA_383,
  createDiffPaginatorSession383,
};
