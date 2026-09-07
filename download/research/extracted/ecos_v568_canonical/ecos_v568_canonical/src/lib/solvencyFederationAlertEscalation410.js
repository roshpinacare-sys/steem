'use strict';
/**
 * src/lib/solvencyFederationAlertEscalation410.js — ECOS V410 (Phase P298) —
 * Dispute Alert Severity Escalation.
 *
 * Reads the V409 dispute-alert stream and assigns each alert a severity
 * tier (info / warn / critical) based on configurable thresholds, then
 * appends the escalated record to a deterministic, append-only log so
 * an operator can route by severity without re-deriving levels.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 410 (R2).
 *
 * @version 410.0.0
 */

const ALERT_ESCALATION_VERSION_410 = '410.0.0';

const TIERS_410 = ['info', 'warn', 'critical'];

function createSolvencyFederationAlertEscalation410(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const warnAt = Number.isFinite(opts.warnAt) ? Math.max(1, opts.warnAt | 0) : 3;
  const criticalAt = Number.isFinite(opts.criticalAt)
    ? Math.max(warnAt + 1, opts.criticalAt | 0)
    : 8;
  const maxRecords = Number.isFinite(opts.maxRecords)
    ? Math.max(16, opts.maxRecords | 0)
    : 2048;

  const records = []; // { seq, ts, alertSeq, operatorId, count, tier }
  const seenAlertSeqs = new Set();
  let nextSeq = 1;
  let totalEscalations = 0;
  const byTier = { info: 0, warn: 0, critical: 0 };

  function _tierFor(count) {
    if (count >= criticalAt) return 'critical';
    if (count >= warnAt) return 'warn';
    return 'info';
  }

  function escalate410(alert409) {
    if (!alert409 || typeof alert409.list409 !== 'function') {
      throw new Error('alert409 required');
    }
    const all = alert409.list409();
    const ts = now();
    const created = [];
    for (const a of all) {
      if (seenAlertSeqs.has(a.seq)) continue;
      seenAlertSeqs.add(a.seq);
      const tier = _tierFor(a.count);
      const rec = {
        seq: nextSeq++,
        ts,
        alertSeq: a.seq,
        operatorId: a.operatorId,
        count: a.count,
        tier,
      };
      records.push(rec);
      while (records.length > maxRecords) records.shift();
      byTier[tier]++;
      totalEscalations++;
      created.push(rec);
    }
    return { ok: true, escalatedAt: ts, created };
  }

  function list410(limit, tier) {
    let out = records;
    if (tier && TIERS_410.indexOf(tier) >= 0) {
      out = out.filter((r) => r.tier === tier);
    }
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : out.length;
    return out.slice(-n).map((r) => Object.assign({}, r));
  }

  function stats410() {
    return {
      records: records.length,
      nextSeq,
      totalEscalations,
      byTier: Object.assign({}, byTier),
      warnAt,
      criticalAt,
    };
  }

  return { escalate410, list410, stats410, TIERS_410 };
}

module.exports = {
  ALERT_ESCALATION_VERSION_410,
  TIERS_410,
  createSolvencyFederationAlertEscalation410,
};
