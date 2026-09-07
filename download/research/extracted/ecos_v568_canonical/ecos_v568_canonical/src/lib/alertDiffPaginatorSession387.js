'use strict';
/**
 * lib/alertDiffPaginatorSession387.js — ECOS V387 (Phase P275)
 *
 * DIRECTION 4: Alert diff paginator session.
 *
 * createAlertDiffPaginatorSession387(opts) combines paginateAlertHistoryDiff386
 * with createPersistedCursorRegistry382 so a caller can resume an
 * alert-history-diff pagination session by name across server restarts,
 * mirroring createChainDiffPaginatorSession385 for the alert-diff surface.
 *
 * Exports:
 *   ALERT_DIFF_PAGINATOR_SESSION_VERSION_387
 *   ALERT_DIFF_PAGINATOR_SESSION_SCHEMA_387
 *   createAlertDiffPaginatorSession387(opts)
 *     — returns a session manager:
 *         nextPage(name, diff, pageOpts),
 *         prevPage(name, diff, pageOpts),
 *         resetSession(name),
 *         getSessionCursor(name),
 *         listSessions(),
 *         registry
 *
 * Endpoint: POST /api/v1/integrity/auto-heal/quota/reset/rate/alert/history/diff/session/next [V387-T04a]
 *           POST /api/v1/integrity/auto-heal/quota/reset/rate/alert/history/diff/session/prev [V387-T04b]
 *           GET  /api/v1/integrity/auto-heal/quota/reset/rate/alert/history/diff/session/:name [V387-T04c]
 *           DELETE /api/v1/integrity/auto-heal/quota/reset/rate/alert/history/diff/session/:name [V387-T04d]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 387 (R2).
 * Sacred untouched (R1). V361..V386 preserved (R6).
 *
 * @version 387.0.0
 */

const ADP386 = require('./alertHistoryDiffPaginator386.js');
const PCR382 = require('./persistedCursorRegistry382.js');

const ALERT_DIFF_PAGINATOR_SESSION_VERSION_387 = '387.0.0';
const ALERT_DIFF_PAGINATOR_SESSION_SCHEMA_387  =
  'ecos.integrity.cross_chain.auto_heal.quota.reset.rate.alert.history.diff.paginator.session/v387';

/**
 * Create an alert-history-diff paginator session manager backed by a persisted cursor registry.
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
function createAlertDiffPaginatorSession387(opts) {
  const o = opts || {};
  const defaultPageLimit = (typeof o.defaultPageLimit === 'number' && o.defaultPageLimit > 0)
    ? o.defaultPageLimit
    : ADP386.DEFAULT_ALERT_DIFF_PAGE_LIMIT_386;

  const registry = PCR382.createPersistedCursorRegistry382({
    filePath:   o.filePath,
    ephemeral:  o.ephemeral !== undefined ? o.ephemeral : undefined,
    maxEntries: o.maxSessions,
  });

  /**
   * Fetch the next page of a named alert-diff session.
   * On first call the session starts at the beginning; subsequent calls resume
   * from the last nextCursor stored in the registry.
   *
   * @param {string} name — session identifier
   * @param {object|{ histA, histB }} diff — pre-built paginateAlertHistoryDiff386 diff or { histA, histB }
   * @param {{ limit?: number, includeInBoth?: boolean }} [pageOpts]
   */
  function nextPage387(name, diff, pageOpts) {
    const po    = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    const entry  = registry.get(name);
    const cursor = entry.ok ? entry.cursor : null;

    const result = ADP386.paginateAlertHistoryDiff386(diff, {
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
      schema:      ALERT_DIFF_PAGINATOR_SESSION_SCHEMA_387,
      version:     ALERT_DIFF_PAGINATOR_SESSION_VERSION_387,
    };
  }

  /**
   * Fetch the previous page of a named alert-diff session.
   *
   * @param {string} name
   * @param {object|{ histA, histB }} diff
   * @param {{ limit?: number, includeInBoth?: boolean }} [pageOpts]
   */
  function prevPage387(name, diff, pageOpts) {
    const po    = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    const entry  = registry.get(name);
    const cursor = entry.ok ? entry.cursor : null;

    const current = ADP386.paginateAlertHistoryDiff386(diff, {
      cursor,
      limit,
      includeInBoth: po.includeInBoth !== false,
    });

    if (!current.ok) {
      return {
        ...current,
        sessionName: name,
        schema:  ALERT_DIFF_PAGINATOR_SESSION_SCHEMA_387,
        version: ALERT_DIFF_PAGINATOR_SESSION_VERSION_387,
      };
    }

    const prevCursor = current.prevCursor;
    if (!prevCursor) {
      return {
        ...current,
        sessionName: name,
        atStart: true,
        schema:  ALERT_DIFF_PAGINATOR_SESSION_SCHEMA_387,
        version: ALERT_DIFF_PAGINATOR_SESSION_VERSION_387,
      };
    }

    const result = ADP386.paginateAlertHistoryDiff386(diff, {
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
      schema:  ALERT_DIFF_PAGINATOR_SESSION_SCHEMA_387,
      version: ALERT_DIFF_PAGINATOR_SESSION_VERSION_387,
    };
  }

  /**
   * Reset a named session (delete its stored cursor).
   * @param {string} name
   * @returns {boolean}
   */
  function resetSession387(name) {
    return registry.delete(name);
  }

  /**
   * Get the current cursor position for a named session.
   * @param {string} name
   * @returns {{ ok, cursor, startIndex, setAt }}
   */
  function getSessionCursor387(name) {
    const entry   = registry.get(name);
    const decoded = entry.ok ? ADP386.decodeAlertDiffCursor386(entry.cursor) : null;
    return {
      ok:         entry.ok,
      cursor:     entry.cursor,
      startIndex: decoded ? decoded.stepIndex : null,
      setAt:      entry.setAt,
      schema:     ALERT_DIFF_PAGINATOR_SESSION_SCHEMA_387,
      version:    ALERT_DIFF_PAGINATOR_SESSION_VERSION_387,
    };
  }

  /**
   * List all active sessions.
   */
  function listSessions387() {
    return registry.list();
  }

  return {
    nextPage:         nextPage387,
    prevPage:         prevPage387,
    resetSession:     resetSession387,
    getSessionCursor: getSessionCursor387,
    listSessions:     listSessions387,
    registry,
    schema:  ALERT_DIFF_PAGINATOR_SESSION_SCHEMA_387,
    version: ALERT_DIFF_PAGINATOR_SESSION_VERSION_387,
  };
}

module.exports = {
  ALERT_DIFF_PAGINATOR_SESSION_VERSION_387,
  ALERT_DIFF_PAGINATOR_SESSION_SCHEMA_387,
  createAlertDiffPaginatorSession387,
};
