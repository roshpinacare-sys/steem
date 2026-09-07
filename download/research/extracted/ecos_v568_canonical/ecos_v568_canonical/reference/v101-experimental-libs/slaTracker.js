'use strict';

/**
 * ECOS SLA Tracker — V101
 * ========================
 * Tracks per-mission SLA deadlines for HITL_QUEUE tasks.
 *
 * SLA tiers (by task price):
 *   < $1.00   → 24-hour deadline
 *   $1.00–$5  → 4-hour deadline
 *   > $5.00   → 1-hour deadline
 *
 * Status states:
 *   ok       — within SLA (>20% time remaining)
 *   warning  — SLA approaching (<20% time remaining, not yet breached)
 *   overdue  — SLA breached (deadline passed, not yet resolved)
 *   resolved — mission was resolved before deadline
 */

const SLA_TIERS = [
  { maxUsd: 1.00, ttlMs: 24 * 3600 * 1000, label: '24h' },
  { maxUsd: 5.00, ttlMs:  4 * 3600 * 1000, label: '4h'  },
  { maxUsd: Infinity, ttlMs: 1 * 3600 * 1000, label: '1h' },
];

class SlaTracker {
  constructor() {
    // missionId → { missionId, priceUsd, createdAt, deadline, ttlMs, resolvedAt, status }
    this._missions = new Map();
    this._log = { info: () => {}, warn: () => {}, error: () => {} };
  }

  setLogger(logger) {
    this._log = logger;
  }

  /**
   * Determine SLA tier for a given price.
   * @param {number|string} priceUsd
   * @returns {{ ttlMs: number, label: string }}
   */
  _getTier(priceUsd) {
    const price = parseFloat(priceUsd) || 0;
    for (const tier of SLA_TIERS) {
      if (price <= tier.maxUsd) return tier;
    }
    return SLA_TIERS[SLA_TIERS.length - 1];
  }

  /**
   * Register a HITL_QUEUE mission for SLA tracking.
   * @param {string} missionId
   * @param {number|string} priceUsd
   * @param {Date|string} [createdAt]
   * @returns {{ missionId, deadline, ttlMs, tier }}
   */
  register(missionId, priceUsd, createdAt) {
    if (!missionId) throw new Error('missionId is required');
    const tier      = this._getTier(priceUsd);
    const createdTs = createdAt ? new Date(createdAt).getTime() : Date.now();
    const deadline  = new Date(createdTs + tier.ttlMs).toISOString();

    this._missions.set(missionId, {
      missionId,
      priceUsd:   parseFloat(priceUsd) || 0,
      createdAt:  new Date(createdTs).toISOString(),
      deadline,
      ttlMs:      tier.ttlMs,
      tierLabel:  tier.label,
      resolvedAt: null,
      escalated:  false,
    });

    this._log.info(
      { component: 'slaTracker', missionId, tier: tier.label, deadline },
      '[SLA] Mission registered'
    );

    return { missionId, deadline, ttlMs: tier.ttlMs, tier: tier.label };
  }

  /**
   * Mark a mission as resolved (SLA met if before deadline).
   * @param {string} missionId
   * @param {Date|string} [resolvedAt]
   */
  resolve(missionId, resolvedAt) {
    const record = this._missions.get(missionId);
    if (!record) return;
    record.resolvedAt = resolvedAt ? new Date(resolvedAt).toISOString() : new Date().toISOString();
    this._missions.set(missionId, record);
  }

  /**
   * Mark a mission as escalated.
   * @param {string} missionId
   */
  markEscalated(missionId) {
    const record = this._missions.get(missionId);
    if (!record) return;
    record.escalated = true;
    this._missions.set(missionId, record);
  }

  /**
   * Compute live SLA status for a single mission.
   * @param {string} missionId
   * @returns {object|null}
   */
  getStatus(missionId) {
    const record = this._missions.get(missionId);
    if (!record) return null;
    return this._computeStatus(record);
  }

  _computeStatus(record) {
    const now         = Date.now();
    const deadlineTs  = new Date(record.deadline).getTime();
    const createdTs   = new Date(record.createdAt).getTime();
    const totalMs     = record.ttlMs;
    const msRemaining = deadlineTs - now;
    const elapsedMs   = now - createdTs;

    let status;
    if (record.resolvedAt) {
      status = 'resolved';
    } else if (msRemaining <= 0) {
      status = 'overdue';
    } else if (msRemaining < totalMs * 0.20) {
      status = 'warning';
    } else {
      status = 'ok';
    }

    return {
      missionId:   record.missionId,
      status,
      priceUsd:    record.priceUsd,
      tierLabel:   record.tierLabel,
      createdAt:   record.createdAt,
      deadline:    record.deadline,
      resolvedAt:  record.resolvedAt,
      msRemaining: Math.max(0, msRemaining),
      elapsedMs,
      escalated:   record.escalated,
      slaBreached: msRemaining <= 0 && !record.resolvedAt,
    };
  }

  /**
   * Return all tracked missions filtered by status.
   * @param {'ok'|'warning'|'overdue'|'resolved'|'all'} [filter]
   * @returns {object[]}
   */
  listAll(filter = 'all') {
    const results = [];
    for (const record of this._missions.values()) {
      const status = this._computeStatus(record);
      if (filter === 'all' || status.status === filter) {
        results.push(status);
      }
    }
    return results.sort((a, b) => a.msRemaining - b.msRemaining);
  }

  /**
   * Return SLA compliance summary statistics.
   * @returns {{ total, ok, warning, overdue, resolved, complianceRate }}
   */
  getSummary() {
    const counts = { ok: 0, warning: 0, overdue: 0, resolved: 0 };
    for (const record of this._missions.values()) {
      const { status } = this._computeStatus(record);
      counts[status] = (counts[status] || 0) + 1;
    }
    const total    = this._missions.size;
    const breached = counts.overdue;
    const closed   = counts.resolved;
    const complianceRate = closed > 0
      ? Math.round((closed / (closed + breached)) * 100)
      : 100;

    return { total, ...counts, complianceRate };
  }

  /**
   * Return all missions whose deadline has passed and are not yet resolved.
   * Used by the escalation engine.
   * @returns {object[]}
   */
  getOverdue() {
    return this.listAll('overdue');
  }

  /**
   * Return the raw record map size (for health checks).
   */
  get size() {
    return this._missions.size;
  }
}

module.exports = { SlaTracker };
