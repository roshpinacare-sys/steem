'use strict';
/**
 * lib/workspaceEventDigestService191.js — ECOS V191 (Phase P80)
 * Pure aggregation/"digest" over a list of workspace events.
 *
 * Reads nothing and stores nothing itself — the caller passes an array of event
 * envelopes (the same shape stored in `_eventLog181`: { messageId, type,
 * senderId, sentAt, payload }). Returns counts by type, top senders, a time
 * range, and an hourly histogram. Pure + zero-dependency (R6) → fully
 * unit-testable without the server or a DB.
 *
 * Identifiers are version-suffixed (…191) to avoid the duplicate-const failure
 * class (BUG-L). @version 191.0.0
 */

const DEFAULT_TOP_SENDERS = 5;

class DigestValidationError191 extends Error {
  constructor(msg) { super(msg); this.name = 'DigestValidationError191'; this.code = 'DIGEST_VALIDATION'; this.statusCode = 400; }
}

class WorkspaceEventDigestService191 {
  constructor(opts = {}) {
    this._log = opts.logger || { info() {}, warn() {}, error() {} };
    this._totalDigests = 0;
  }
  setLogger(log) { this._log = log; }

  /**
   * @param {Array<{type?:string, senderId?:string, sentAt?:string}>} events
   * @param {{ topSenders?:number, type?:string|null }} [opts]
   * @returns {{ total, byType, topSenders, senders, timeRange, hourly }}
   */
  digest(events, opts = {}) {
    if (!Array.isArray(events)) throw new DigestValidationError191('events must be an array');
    const topN = Math.max(1, Math.min(50, parseInt(opts.topSenders, 10) || DEFAULT_TOP_SENDERS));
    const typeFilter = opts.type || null;

    const rows = typeFilter ? events.filter(e => (e && e.type) === typeFilter) : events;

    const byType = {};
    const senderCounts = {};
    const hourly = {};
    let first = null, last = null;

    for (const e of rows) {
      const type = (e && e.type) || 'unknown';
      byType[type] = (byType[type] || 0) + 1;

      const sender = (e && e.senderId) || 'unknown';
      senderCounts[sender] = (senderCounts[sender] || 0) + 1;

      const ts = e && e.sentAt;
      if (ts) {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) {
          const iso = d.toISOString();
          if (first === null || iso < first) first = iso;
          if (last === null || iso > last) last = iso;
          const hourKey = iso.slice(0, 13) + ':00'; // YYYY-MM-DDTHH:00
          hourly[hourKey] = (hourly[hourKey] || 0) + 1;
        }
      }
    }

    const topSenders = Object.entries(senderCounts)
      .map(([senderId, count]) => ({ senderId, count }))
      .sort((a, b) => b.count - a.count || a.senderId.localeCompare(b.senderId))
      .slice(0, topN);

    this._totalDigests++;
    return {
      total: rows.length,
      byType,
      topSenders,
      senders: Object.keys(senderCounts).length,
      timeRange: { first, last },
      hourly,
    };
  }

  stats() { return { totalDigests: this._totalDigests, defaultTopSenders: DEFAULT_TOP_SENDERS }; }
}

const defaultEventDigestService191 = new WorkspaceEventDigestService191();

module.exports = {
  WorkspaceEventDigestService191,
  DigestValidationError191,
  defaultEventDigestService191,
  DEFAULT_TOP_SENDERS,
};
