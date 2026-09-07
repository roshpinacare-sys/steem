/**
 * lib/adminStatsService.js — ECOS V154
 * ─────────────────────────────────────────────────────────────────────────────
 * [V154-ADMIN] Aggregated platform statistics for the Admin Dashboard.
 *
 * All functions are pure / DB-agnostic where possible.
 * DB-backed versions accept an optional pg Pool and fall back to in-memory.
 */
'use strict';

/**
 * Build a stats snapshot from in-memory structures.
 * @param {object} opts
 * @param {object} opts.hitlGate   — HitlGate instance
 * @param {object} opts.ledger     — FiatLedger instance
 * @param {object} opts.auditLog   — AuditLog instance
 * @param {object} opts.rankSystem — UserRankSystem instance (optional)
 * @param {object} opts.pool       — pg.Pool (optional, for DB-backed queries)
 */
async function getPlatformStats({ hitlGate, ledger, auditLog, rankSystem, pool } = {}) {
  // Validator count
  let validatorCount = 0;
  let activeTaskCount = 0;
  let dailyPayoutUsd = 0;

  try {
    if (pool) {
      const [vc, ac, dp] = await Promise.all([
        pool.query("SELECT COUNT(DISTINCT validator_id) AS cnt FROM approvals WHERE created_at > NOW() - INTERVAL '30 days'"),
        pool.query("SELECT COUNT(*) AS cnt FROM approvals WHERE status = 'pending'"),
        pool.query("SELECT COALESCE(SUM(validator_usd),0) AS total FROM approvals WHERE created_at > NOW() - INTERVAL '24 hours' AND status = 'resolved'"),
      ]);
      validatorCount  = parseInt(vc.rows[0]?.cnt  || 0);
      activeTaskCount = parseInt(ac.rows[0]?.cnt  || 0);
      dailyPayoutUsd  = parseFloat(dp.rows[0]?.total || 0);
    } else {
      // In-memory fallback
      const approvals = hitlGate?.listApprovals ? hitlGate.listApprovals() : [];
      validatorCount  = new Set(approvals.map(a => a.validatorId).filter(Boolean)).size;
      activeTaskCount = approvals.filter(a => a.status === 'pending').length;
      dailyPayoutUsd  = approvals
        .filter(a => a.status === 'resolved' && a.resolvedAt && (Date.now() - new Date(a.resolvedAt).getTime()) < 86400000)
        .reduce((sum, a) => sum + parseFloat(a.priceUsd || 0) * 0.4, 0);
    }
  } catch (e) { /* non-fatal */ }

  // Chain stats
  let chainLength = 0;
  let chainIntact = true;
  try {
    const proof = auditLog?.proof ? auditLog.proof() : null;
    if (proof) {
      chainLength = proof.length || (proof.recentHashes?.length) || 0;
      chainIntact = proof.intact !== false;
    }
  } catch (e) { /* non-fatal */ }

  // Rank stats
  let rankStats = { total: 0, byTier: {} };
  try {
    if (rankSystem?.getAllUsers) {
      const users = rankSystem.getAllUsers();
      rankStats.total = users.length;
      for (const u of users) {
        const t = u.tier || 'OBSERVER';
        rankStats.byTier[t] = (rankStats.byTier[t] || 0) + 1;
      }
    }
  } catch (e) { /* non-fatal */ }

  return {
    validatorCount,
    activeTaskCount,
    dailyPayoutUsd: parseFloat(dailyPayoutUsd.toFixed(4)),
    chainLength,
    chainIntact,
    rankStats,
    generatedAt: new Date().toISOString(),
    ecosVersion: 'V154',
  };
}

/**
 * Get the last N audit log entries for the admin event feed.
 */
function getRecentEvents(auditLog, limit = 10) {
  try {
    const all = auditLog?.entries ? auditLog.entries() : (auditLog?.getAll ? auditLog.getAll() : []);
    return [...all].reverse().slice(0, limit).map(e => ({
      hash:      e.hash?.slice(0, 16) || '?',
      type:      e.type   || e.data?.type || 'UNKNOWN',
      missionId: (e.missionId || e.data?.missionId || '').toString().slice(0, 12) || '—',
      ts:        e.timestamp || e.createdAt || null,
      verdict:   e.verdict || e.data?.verdict || null,
    }));
  } catch (e) {
    return [];
  }
}

/**
 * Daily payout breakdown by hour (last 24h).
 * Returns array of { hour: 'HH:00', amount: N }
 */
async function getDailyPayoutBreakdown(pool, hitlGate) {
  const buckets = {};
  for (let h = 0; h < 24; h++) {
    buckets[String(h).padStart(2, '0') + ':00'] = 0;
  }

  try {
    if (pool) {
      const r = await pool.query(
        "SELECT EXTRACT(HOUR FROM resolved_at)::int AS h, SUM(validator_usd) AS amt " +
        "FROM approvals WHERE resolved_at > NOW() - INTERVAL '24 hours' AND status='resolved' " +
        "GROUP BY h ORDER BY h"
      );
      for (const row of r.rows) {
        const key = String(row.h).padStart(2, '0') + ':00';
        buckets[key] = parseFloat(row.amt || 0);
      }
    } else if (hitlGate?.listApprovals) {
      const now = Date.now();
      for (const a of hitlGate.listApprovals()) {
        if (a.status !== 'resolved' || !a.resolvedAt) continue;
        const diff = now - new Date(a.resolvedAt).getTime();
        if (diff > 86400000) continue;
        const h = new Date(a.resolvedAt).getHours();
        const key = String(h).padStart(2, '0') + ':00';
        buckets[key] = (buckets[key] || 0) + parseFloat(a.priceUsd || 0) * 0.4;
      }
    }
  } catch (e) { /* non-fatal */ }

  return Object.entries(buckets).map(([hour, amount]) => ({
    hour,
    amount: parseFloat(amount.toFixed(4)),
  }));
}

/**
 * Summary for the /dashboard page.
 */
async function getDashboardSummary({ hitlGate, auditLog, pool } = {}) {
  const stats = await getPlatformStats({ hitlGate, auditLog, pool });
  let totalTasks = 0;
  let autoFlowRate = 0;

  try {
    if (pool) {
      const r = await pool.query(
        "SELECT COUNT(*) AS total, " +
        "COUNT(*) FILTER (WHERE verdict='AUTO_FLOW') AS auto " +
        "FROM approvals WHERE created_at > NOW() - INTERVAL '7 days'"
      );
      totalTasks   = parseInt(r.rows[0]?.total || 0);
      const auto   = parseInt(r.rows[0]?.auto  || 0);
      autoFlowRate = totalTasks > 0 ? Math.round((auto / totalTasks) * 100) : 0;
    } else if (hitlGate?.listApprovals) {
      const all = hitlGate.listApprovals();
      totalTasks = all.length;
      const auto = all.filter(a => a.verdict === 'AUTO_FLOW').length;
      autoFlowRate = totalTasks > 0 ? Math.round((auto / totalTasks) * 100) : 0;
    }
  } catch (e) { /* non-fatal */ }

  return {
    ...stats,
    totalTasks,
    autoFlowRate,
    weeklyPayoutUsd: parseFloat((stats.dailyPayoutUsd * 7).toFixed(4)),
  };
}

module.exports = {
  getPlatformStats,
  getRecentEvents,
  getDailyPayoutBreakdown,
  getDashboardSummary,
};
