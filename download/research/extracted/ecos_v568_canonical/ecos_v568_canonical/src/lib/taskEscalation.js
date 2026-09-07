'use strict';
  /**
   * ECOS Task Escalation Engine — V104
   * Adopted from reference/v101-experimental-libs/taskEscalation.js
   * Polls SlaTracker for overdue missions, fires onEscalate callback.
   */
  const ESCALATION_REASONS = { SLA_BREACH: 'sla_breach', MANUAL: 'manual' };

  class TaskEscalation {
    constructor(slaTracker, opts = {}) {
      if (!slaTracker) throw new Error('slaTracker is required');
      this._sla             = slaTracker;
      this._checkIntervalMs = opts.checkIntervalMs ?? 60_000;
      this._onEscalate      = opts.onEscalate ?? (() => {});
      this._escalations     = new Map();
      this._timer           = null;
      this._log             = { info: () => {}, warn: () => {}, error: () => {} };
    }

    setLogger(logger) { if (logger && typeof logger.info === 'function') this._log = logger; }

    start() {
      if (this._timer) return;
      this._timer = setInterval(() => this._sweep(), this._checkIntervalMs);
      if (this._timer.unref) this._timer.unref();
      this._log.info({ component: 'taskEscalation' }, '[Escalation] sweep started');
    }

    stop() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    _sweep() {
      try {
        const overdue = this._sla.getOverdue();
        for (const slaStatus of overdue) {
          if (slaStatus.escalated) continue;
          this._escalate(slaStatus.missionId, ESCALATION_REASONS.SLA_BREACH, {
            priceUsd: slaStatus.priceUsd, tierLabel: slaStatus.tierLabel, overdueSince: slaStatus.deadline,
          });
        }
      } catch (err) {
        this._log.error({ component: 'taskEscalation', err: err.message }, '[Escalation] sweep error');
      }
    }

    _escalate(missionId, reason, meta = {}) {
      if (this._escalations.has(missionId)) return null;
      const record = {
        id: `esc::${Date.now()}::${missionId}`,
        missionId, reason,
        escalatedAt: new Date().toISOString(),
        meta,
      };
      this._escalations.set(missionId, record);
      this._sla.markEscalated(missionId);
      try { this._onEscalate(record); } catch { /* caller error — absorb */ }
      this._log.info({ component: 'taskEscalation', missionId, reason }, '[Escalation] escalated');
      return record;
    }

    escalateManual(missionId, meta = {}) {
      return this._escalate(missionId, ESCALATION_REASONS.MANUAL, { ...meta, manual: true });
    }

    getEscalations()       { return Array.from(this._escalations.values()); }
    getEscalation(mId)     { return this._escalations.get(mId) || null; }
    isEscalated(mId)       { return this._escalations.has(mId); }
    count()                { return this._escalations.size; }
  }

  module.exports = { TaskEscalation, ESCALATION_REASONS };
  