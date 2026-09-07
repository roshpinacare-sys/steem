'use strict';
  /**
   * ECOS SLA Tracker — V104
   * Adopted from reference/v101-experimental-libs/slaTracker.js
   * Tracks per-mission SLA deadlines for HITL_QUEUE tasks.
   *
   * SLA tiers (by task price):
   *   < $1.00   → 24-hour deadline
   *   $1.00–$5  → 4-hour deadline
   *   > $5.00   → 1-hour deadline
   */
  const SLA_TIERS = [
    { maxUsd: 1.00, ttlMs: 24 * 3600 * 1000, label: '24h' },
    { maxUsd: 5.00, ttlMs:  4 * 3600 * 1000, label: '4h'  },
    { maxUsd: Infinity, ttlMs: 1 * 3600 * 1000, label: '1h' },
  ];

  class SlaTracker {
    constructor() {
      this._missions = new Map();
      this._log = { info: () => {}, warn: () => {}, error: () => {} };
    }
    setLogger(logger) { if (logger && typeof logger.info === 'function') this._log = logger; }

    _getTier(priceUsd) {
      const price = parseFloat(priceUsd) || 0;
      for (const tier of SLA_TIERS) {
        if (price <= tier.maxUsd) return tier;
      }
      return SLA_TIERS[SLA_TIERS.length - 1];
    }

    register(missionId, priceUsd, createdAt) {
      if (!missionId) throw new Error('missionId is required');
      const tier      = this._getTier(priceUsd);
      const createdTs = createdAt ? new Date(createdAt).getTime() : Date.now();
      const deadline  = new Date(createdTs + tier.ttlMs).toISOString();
      this._missions.set(missionId, {
        missionId, priceUsd: parseFloat(priceUsd) || 0,
        createdAt: new Date(createdTs).toISOString(),
        deadline, ttlMs: tier.ttlMs, tierLabel: tier.label,
        resolvedAt: null, escalated: false,
      });
      this._log.info({ component: 'slaTracker', missionId, tier: tier.label, deadline }, '[SLA] registered');
      return { missionId, deadline, ttlMs: tier.ttlMs, tier: tier.label };
    }

    resolve(missionId, resolvedAt) {
      const m = this._missions.get(missionId);
      if (!m) return null;
      m.resolvedAt = resolvedAt ? new Date(resolvedAt).toISOString() : new Date().toISOString();
      return m;
    }

    status(missionId, now) {
      const m = this._missions.get(missionId);
      if (!m) return null;
      if (m.resolvedAt) return { ...m, status: 'resolved' };
      const nowTs      = now ? new Date(now).getTime() : Date.now();
      const deadlineTs = new Date(m.deadline).getTime();
      const remaining  = deadlineTs - nowTs;
      const total      = m.ttlMs;
      if (nowTs > deadlineTs) return { ...m, status: 'overdue',  remaining: 0 };
      if (remaining / total < 0.20) return { ...m, status: 'warning', remaining };
      return { ...m, status: 'ok', remaining };
    }

    getOverdue(now) {
      const nowTs = now ? new Date(now).getTime() : Date.now();
      const result = [];
      for (const m of this._missions.values()) {
        if (m.resolvedAt) continue;
        if (new Date(m.deadline).getTime() < nowTs) result.push({ ...m, status: 'overdue' });
      }
      return result;
    }

    markEscalated(missionId) {
      const m = this._missions.get(missionId);
      if (m) m.escalated = true;
      return !!m;
    }

    getAll() { return Array.from(this._missions.values()); }
    size()   { return this._missions.size; }
  }

  const defaultSlaTracker = new SlaTracker();
  module.exports = { SlaTracker, defaultSlaTracker, SLA_TIERS };
  