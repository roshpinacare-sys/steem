'use strict';

/**
 * ECOS Task Escalation Engine — V101
 * =====================================
 * Automatically escalates HITL_QUEUE tasks that breach their SLA deadline.
 *
 * Escalation flow:
 *   1. Background timer polls slaTracker.getOverdue() every CHECK_INTERVAL_MS
 *   2. For each overdue mission not yet escalated, records an escalation entry
 *   3. Fires onEscalate callback (used to notify via webhooks + broadcast via SSE)
 *   4. Marks the mission as escalated in slaTracker so it is not re-escalated
 *
 * Escalation reasons:
 *   sla_breach   — SLA deadline passed (default)
 *   manual       — manually triggered via POST /api/v1/escalations
 */

const ESCALATION_REASONS = {
  SLA_BREACH: 'sla_breach',
  MANUAL:     'manual',
};

class TaskEscalation {
  /**
   * @param {import('./slaTracker').SlaTracker} slaTracker
   * @param {object} [opts]
   * @param {number}   [opts.checkIntervalMs=60000]  How often to scan for overdue tasks
   * @param {Function} [opts.onEscalate]             Callback(escalationRecord) on each new escalation
   */
  constructor(slaTracker, opts = {}) {
    if (!slaTracker) throw new Error('slaTracker is required');
    this._sla             = slaTracker;
    this._checkIntervalMs = opts.checkIntervalMs ?? 60_000;
    this._onEscalate      = opts.onEscalate ?? (() => {});
    this._escalations     = new Map();   // missionId → escalationRecord
    this._timer           = null;
    this._log             = { info: () => {}, warn: () => {}, error: () => {} };
  }

  setLogger(logger) {
    this._log = logger;
  }

  /**
   * Start the background escalation sweep.
   */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._sweep(), this._checkIntervalMs);
    // Unref so it won't keep Node alive in tests
    if (this._timer.unref) this._timer.unref();
    this._log.info({ component: 'taskEscalation' }, '[Escalation] Background sweep started');
  }

  /**
   * Stop the background sweep (for clean shutdown / test teardown).
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Internal sweep — called on timer tick.
   */
  _sweep() {
    try {
      const overdue = this._sla.getOverdue();
      for (const slaStatus of overdue) {
        if (slaStatus.escalated) continue;
        this._escalate(slaStatus.missionId, ESCALATION_REASONS.SLA_BREACH, {
          priceUsd:  slaStatus.priceUsd,
          tierLabel: slaStatus.tierLabel,
          overdueSince: slaStatus.deadline,
        });
      }
    } catch (err) {
      this._log.error({ component: 'taskEscalation' }, '[Escalation] Sweep error:', err.message);
    }
  }

  /**
   * Escalate a mission — records entry, marks SLA tracker, fires callback.
   * @param {string} missionId
   * @param {string} [reason]
   * @param {object} [meta]
   * @returns {object} escalationRecord
   */
  _escalate(missionId, reason = ESCALATION_REASONS.SLA_BREACH, meta = {}) {
    const record = {
      missionId,
      reason,
      meta,
      escalatedAt: new Date().toISOString(),
    };
    this._escalations.set(missionId, record);
    this._sla.markEscalated(missionId);

    this._log.warn(
      { component: 'taskEscalation', missionId, reason },
      '[Escalation] Mission escalated'
    );

    try {
      this._onEscalate(record);
    } catch (cbErr) {
      this._log.error(
        { component: 'taskEscalation', missionId },
        '[Escalation] onEscalate callback error:', cbErr.message
      );
    }

    return record;
  }

  /**
   * Manually escalate a mission (e.g. via POST /api/v1/escalations).
   * @param {string} missionId
   * @param {string} [note]
   * @returns {object} escalationRecord
   */
  escalate(missionId, note) {
    if (!missionId) throw new Error('missionId is required');
    if (this._escalations.has(missionId)) {
      return this._escalations.get(missionId);
    }
    return this._escalate(missionId, ESCALATION_REASONS.MANUAL, { note: note || null });
  }

  /**
   * List all escalation records.
   * @param {number} [limit]
   * @param {string} [cursor]  — missionId cursor for pagination
   * @returns {{ escalations, hasMore, cursor }}
   */
  list(limit = 50, cursor = null) {
    let all = Array.from(this._escalations.values())
      .sort((a, b) => new Date(b.escalatedAt) - new Date(a.escalatedAt));

    if (cursor) {
      const idx = all.findIndex(e => e.missionId === cursor);
      if (idx !== -1) all = all.slice(idx + 1);
    }

    const safe = Math.max(1, Math.min(limit, 200));
    const page = all.slice(0, safe);
    return {
      escalations: page,
      hasMore:     all.length > safe,
      cursor:      page.length > 0 ? page[page.length - 1].missionId : null,
      total:       this._escalations.size,
    };
  }

  /**
   * Get a single escalation record.
   * @param {string} missionId
   */
  get(missionId) {
    return this._escalations.get(missionId) || null;
  }

  /**
   * Total number of escalations (for health / stats).
   */
  get count() {
    return this._escalations.size;
  }
}

module.exports = { TaskEscalation, ESCALATION_REASONS };
