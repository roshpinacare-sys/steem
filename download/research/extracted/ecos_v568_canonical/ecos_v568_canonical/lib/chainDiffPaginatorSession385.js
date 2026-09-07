'use strict';
/**
 * lib/chainDiffPaginatorSession385.js — ECOS V385 (Phase P273)
 *
 * DIRECTION 2: Chain report diff pagination session.
 *
 * createChainDiffPaginatorSession385(opts) combines paginateChainReportDiff384
 * with createPersistedCursorRegistry382 so a caller can resume a
 * chain-report-diff pagination session by name across server restarts,
 * mirroring the V383 createDiffPaginatorSession383 pattern for the
 * chain-diff surface.
 *
 * Exports:
 *   CHAIN_DIFF_PAGINATOR_SESSION_VERSION_385
 *   CHAIN_DIFF_PAGINATOR_SESSION_SCHEMA_385
 *   createChainDiffPaginatorSession385(opts)
 *     — returns a session manager:
 *         nextPage(name, diff, pageOpts),
 *         prevPage(name, diff, pageOpts),
 *         resetSession(name),
 *         getSessionCursor(name),
 *         listSessions(),
 *         registry
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/key-rotation/manifest/chain/report/diff/session/next [V385-T02a]
 *           POST /api/v1/missions/proof-index/snapshot/key-rotation/manifest/chain/report/diff/session/prev [V385-T02b]
 *           GET  /api/v1/missions/proof-index/snapshot/key-rotation/manifest/chain/report/diff/session/:name [V385-T02c]
 *           DELETE /api/v1/missions/proof-index/snapshot/key-rotation/manifest/chain/report/diff/session/:name [V385-T02d]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 385 (R2).
 * Sacred untouched (R1). V361..V384 preserved (R6).
 *
 * @version 385.0.0
 */

const CRP384 = require('./chainReportDiffPaginator384.js');
const PCR382 = require('./persistedCursorRegistry382.js');

const CHAIN_DIFF_PAGINATOR_SESSION_VERSION_385 = '385.0.0';
const CHAIN_DIFF_PAGINATOR_SESSION_SCHEMA_385  =
  'ecos.integrity.mission.proof.index.snapshot.signing.key.rotation.chain.report.diff.paginator.session/v385';

/**
 * Create a chain-report-diff paginator session manager backed by a persisted cursor registry.
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
function createChainDiffPaginatorSession385(opts) {
  const o = opts || {};
  const defaultPageLimit = (typeof o.defaultPageLimit === 'number' && o.defaultPageLimit > 0)
    ? o.defaultPageLimit
    : CRP384.DEFAULT_CHAIN_DIFF_PAGE_LIMIT_384;

  const registry = PCR382.createPersistedCursorRegistry382({
    filePath:   o.filePath,
    ephemeral:  o.ephemeral !== undefined ? o.ephemeral : undefined,
    maxEntries: o.maxSessions,
  });

  /**
   * Fetch the next page of a named chain-diff session.
   * On first call the session starts at the beginning; subsequent calls resume
   * from the last nextCursor stored in the registry.
   *
   * @param {string} name — session identifier
   * @param {object} diff — pre-built diffKeyRotationChainReports383 result or { reportA, reportB }
   * @param {{ limit?: number, includeUnchanged?: boolean }} [pageOpts]
   */
  function nextPage385(name, diff, pageOpts) {
    const po    = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    const entry  = registry.get(name);
    const cursor = entry.ok ? entry.cursor : null;

    const result = CRP384.paginateChainReportDiff384(diff, {
      cursor,
      limit,
      includeUnchanged: po.includeUnchanged !== false,
    });

    if (result.ok && result.nextCursor) {
      registry.set(name, result.nextCursor, { sessionName: name, direction: 'next' });
    }

    return {
      ...result,
      sessionName: name,
      resumedFrom: cursor,
      schema:      CHAIN_DIFF_PAGINATOR_SESSION_SCHEMA_385,
      version:     CHAIN_DIFF_PAGINATOR_SESSION_VERSION_385,
    };
  }

  /**
   * Fetch the previous page of a named chain-diff session.
   *
   * @param {string} name
   * @param {object} diff
   * @param {{ limit?: number, includeUnchanged?: boolean }} [pageOpts]
   */
  function prevPage385(name, diff, pageOpts) {
    const po    = pageOpts || {};
    const limit = po.limit || defaultPageLimit;

    const entry  = registry.get(name);
    const cursor = entry.ok ? entry.cursor : null;

    const current = CRP384.paginateChainReportDiff384(diff, {
      cursor,
      limit,
      includeUnchanged: po.includeUnchanged !== false,
    });

    if (!current.ok) {
      return {
        ...current,
        sessionName: name,
        schema:  CHAIN_DIFF_PAGINATOR_SESSION_SCHEMA_385,
        version: CHAIN_DIFF_PAGINATOR_SESSION_VERSION_385,
      };
    }

    const prevCursor = current.prevCursor;
    if (!prevCursor) {
      return {
        ...current,
        sessionName: name,
        atStart: true,
        schema:  CHAIN_DIFF_PAGINATOR_SESSION_SCHEMA_385,
        version: CHAIN_DIFF_PAGINATOR_SESSION_VERSION_385,
      };
    }

    const result = CRP384.paginateChainReportDiff384(diff, {
      cursor: prevCursor,
      limit,
      includeUnchanged: po.includeUnchanged !== false,
    });

    if (result.ok) {
      registry.set(name, prevCursor, { sessionName: name, direction: 'prev' });
    }

    return {
      ...result,
      sessionName: name,
      schema:  CHAIN_DIFF_PAGINATOR_SESSION_SCHEMA_385,
      version: CHAIN_DIFF_PAGINATOR_SESSION_VERSION_385,
    };
  }

  /**
   * Reset a named session (delete its stored cursor).
   * @param {string} name
   * @returns {boolean}
   */
  function resetSession385(name) {
    return registry.delete(name);
  }

  /**
   * Get the current cursor position for a named session.
   * @param {string} name
   * @returns {{ ok, cursor, startIndex, setAt }}
   */
  function getSessionCursor385(name) {
    const entry   = registry.get(name);
    const decoded = entry.decoded || null;
    return {
      ok:         entry.ok,
      cursor:     entry.cursor,
      startIndex: decoded ? decoded.stepIndex : null,
      setAt:      entry.setAt,
      schema:     CHAIN_DIFF_PAGINATOR_SESSION_SCHEMA_385,
      version:    CHAIN_DIFF_PAGINATOR_SESSION_VERSION_385,
    };
  }

  /**
   * List all active sessions.
   */
  function listSessions385() {
    return registry.list();
  }

  return {
    nextPage:         nextPage385,
    prevPage:         prevPage385,
    resetSession:     resetSession385,
    getSessionCursor: getSessionCursor385,
    listSessions:     listSessions385,
    registry,
    schema:  CHAIN_DIFF_PAGINATOR_SESSION_SCHEMA_385,
    version: CHAIN_DIFF_PAGINATOR_SESSION_VERSION_385,
  };
}

module.exports = {
  CHAIN_DIFF_PAGINATOR_SESSION_VERSION_385,
  CHAIN_DIFF_PAGINATOR_SESSION_SCHEMA_385,
  createChainDiffPaginatorSession385,
};
