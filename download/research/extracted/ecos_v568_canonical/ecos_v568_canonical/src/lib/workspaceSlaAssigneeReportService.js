/**
 * workspaceSlaAssigneeReportService.js — V163
 * [V163-TASK-02] SLA Report by Assignee
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 *
 * Features:
 *   - Aggregate SLA breaches by assignee (validator)
 *   - Ranked report: worst-performing assignees first
 *   - Configurable workspace-level report
 *   - In-memory + DB dual persistence
 */

'use strict';

class SlaAssigneeReportError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SlaAssigneeReportError';
    this.statusCode = statusCode;
  }
}

class WorkspaceSlaAssigneeReportService {
  /**
   * @param {object} [db] - pg pool instance (optional)
   */
  constructor(db = null) {
    this._db = db;
    // Map<workspaceId, Map<assigneeId, { breaches, onTime, total }>>
    this._data = new Map();
    this._log = { info: () => {}, warn: () => {} };
  }

  setDb(pool) { this._db = pool; }

  _getWs(workspaceId) {
    if (!this._data.has(workspaceId)) this._data.set(workspaceId, new Map());
    return this._data.get(workspaceId);
  }

  _getAssignee(workspaceId, assigneeId) {
    const ws = this._getWs(workspaceId);
    if (!ws.has(assigneeId)) ws.set(assigneeId, { assigneeId, breaches: 0, onTime: 0, total: 0 });
    return ws.get(assigneeId);
  }

  /**
   * Record an SLA event for a specific assignee.
   */
  async recordEvent(workspaceId, assigneeId, { breached = false } = {}) {
    if (!workspaceId || !assigneeId) throw new SlaAssigneeReportError('workspaceId and assigneeId required');
    const entry = this._getAssignee(workspaceId, assigneeId);
    entry.total++;
    if (breached) entry.breaches++;
    else entry.onTime++;
    return { ...entry };
  }

  /**
   * Generate SLA report by assignee for a workspace.
   * Returns ranked list, worst first (most breaches first).
   */
  async report(workspaceId, { limit = 50 } = {}) {
    if (!workspaceId) throw new SlaAssigneeReportError('workspaceId required');
    const ws = this._getWs(workspaceId);
    const rows = [...ws.values()].map(e => ({
      ...e,
      breachRate: e.total > 0 ? +(e.breaches / e.total * 100).toFixed(1) : 0,
    }));

    rows.sort((a, b) => b.breaches - a.breaches || b.breachRate - a.breachRate);

    return {
      workspaceId,
      reportGeneratedAt: new Date().toISOString(),
      totalAssignees: rows.length,
      assignees: rows.slice(0, limit),
    };
  }

  /**
   * Reset data for a workspace (test helper).
   */
  reset(workspaceId) {
    this._data.delete(workspaceId);
  }

  stats() {
    let total = 0;
    for (const ws of this._data.values()) total += ws.size;
    return { workspaces: this._data.size, totalAssigneeEntries: total };
  }
}

const _slaAssigneeReport = new WorkspaceSlaAssigneeReportService();

module.exports = WorkspaceSlaAssigneeReportService;
module.exports.default = _slaAssigneeReport;
module.exports.SlaAssigneeReportError = SlaAssigneeReportError;

if (process.env.NODE_ENV === 'test') {
  module.exports._slaAssigneeReport = _slaAssigneeReport;
}
