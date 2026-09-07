'use strict';
/**
 * lib/economicHealthMonitor208.js — ECOS V208 (Phase P97)
 *
 * Research source: FTX/Alameda, Terra/LUNA, Celsius, 3AC, Colony/Build Finance autopsy.
 * Core lesson: ALL major collapses had visible early warning signals that were measured
 * nowhere. This module makes the invisible visible — real-time red-flag monitoring.
 *
 * THE 4 RED FLAGS (directly from research, with exact thresholds):
 *
 *  1. REPUTATION INFLATION INDEX (RII) > 2.5 over 14 days
 *     → Hollow tasks flooding in, Sybil bots creating fake reputation (STEPN/Axie pattern)
 *     Source: "מחקר אסטרטגי" section 3, Checklist item 1 (Faucet/Sink ratio)
 *
 *  2. GINI COEFFICIENT OF REPUTATION > 0.75
 *     → >75% of voting power in <5% of accounts → governance capture risk
 *     Source: Build Finance attack, Olympus DAO governance collapse
 *
 *  3. HOLLOW TASK COMPLETION RATE > 0.30 (30%)
 *     → Tasks auto-approved in <15s without peer review → Sybil bots draining protocol
 *     Source: Coordinape collusion pattern, Gitcoin Passport failures
 *
 *  4. TREASURY LIQUIDITY RATIO < 0.50 (50%)
 *     → Less than 50% of treasury in USDC/ETH → Celsius scenario
 *     Source: Celsius Network $5B collapse, 3AC illiquid collateral failure
 *
 * STATUS LEVELS:
 *   'healthy'  — no red flags
 *   'warning'  — 1-2 red flags (approaching thresholds) or mild breaches
 *   'critical' — 2+ hard red flags breached (immediate action required)
 *
 * Pure module — no DB, no side effects.
 * @version 208.0.0
 */

// ── Thresholds (from research) ───────────────────────────────────────────────

const THRESHOLDS_208 = {
  RII_RED:         2.5,   // Reputation Inflation Index hard red flag
  RII_WARNING:     1.8,   // Soft warning
  GINI_RED:        0.75,  // Gini coefficient hard red flag
  GINI_WARNING:    0.60,  // Soft warning
  HOLLOW_RED:      0.30,  // Hollow task rate hard red flag (30%)
  HOLLOW_WARNING:  0.15,  // Soft warning (15%)
  LIQUIDITY_RED:   0.50,  // Treasury liquidity ratio hard red flag (<50%)
  LIQUIDITY_WARN:  0.65,  // Soft warning (<65%)
};

// ── Error class ──────────────────────────────────────────────────────────────

class EconomicHealthError208 extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'EconomicHealthError208';
    this.code = 'ECONOMIC_HEALTH_ERROR';
    this.statusCode = 400;
  }
}

// ── Metric 1: Reputation Inflation Index ─────────────────────────────────────

/**
 * Compute Reputation Inflation Index from daily buckets.
 * RII = Σ(reputation created) / Σ(reputation decayed) over window.
 *
 * @param {{ created: number, decayed: number, date?: string }[]} buckets
 * @returns {MetricResult208}
 */
function computeRII208(buckets) {
  if (!Array.isArray(buckets)) throw new EconomicHealthError208('buckets must be array');
  let totalCreated = 0, totalDecayed = 0;
  for (const b of buckets) {
    if (!b || typeof b !== 'object') continue;
    totalCreated += Math.max(0, Number(b.created) || 0);
    totalDecayed += Math.max(0, Number(b.decayed) || 0);
  }
  const rii = totalDecayed > 0 ? totalCreated / totalDecayed : (totalCreated > 0 ? Infinity : 1.0);
  const riiFinite = Number.isFinite(rii) ? r4(rii) : null;
  const level = !Number.isFinite(rii) || rii > THRESHOLDS_208.RII_RED ? 'critical'
    : rii > THRESHOLDS_208.RII_WARNING ? 'warning' : 'healthy';

  return {
    metric: 'reputation_inflation_index',
    value: riiFinite,
    infinite: !Number.isFinite(rii),
    level,
    redFlag: level === 'critical',
    thresholds: { warning: THRESHOLDS_208.RII_WARNING, red: THRESHOLDS_208.RII_RED },
    detail: { totalCreated: r4(totalCreated), totalDecayed: r4(totalDecayed), buckets: buckets.length },
    interpretation: !Number.isFinite(rii)
      ? 'No decay recorded — reputation only inflating. Possible day-0 or decay engine not running.'
      : rii > THRESHOLDS_208.RII_RED
      ? `RII ${riiFinite}x — reputation created far exceeds decay. Hollow task flooding or Sybil bots suspected. (STEPN/Axie pattern)`
      : rii > THRESHOLDS_208.RII_WARNING
      ? `RII ${riiFinite}x — approaching red flag threshold. Monitor hollow task rate.`
      : `RII ${riiFinite}x — balanced reputation economy.`,
    researchSource: 'STEPN/Axie Infinity collapse — Faucet/Sink ratio analysis',
  };
}

// ── Metric 2: Gini Coefficient ────────────────────────────────────────────────

/**
 * Compute Gini coefficient for reputation distribution.
 * Gini = 0 → perfect equality. Gini = 1 → one account holds all reputation.
 *
 * @param {number[]} reputationValues — effective (post-decay) reputation per account
 * @returns {MetricResult208}
 */
function computeGini208(reputationValues) {
  if (!Array.isArray(reputationValues) || reputationValues.length === 0) {
    throw new EconomicHealthError208('reputationValues must be a non-empty array');
  }
  const sorted = reputationValues.map(v => Math.max(0, Number(v) || 0)).sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((s, v) => s + v, 0);
  let gini = 0;
  if (total > 0) {
    let weightedSum = 0;
    for (let i = 0; i < n; i++) weightedSum += (2 * (i + 1) - n - 1) * sorted[i];
    gini = Math.max(0, Math.min(1, weightedSum / (n * total)));
  }
  const level = gini > THRESHOLDS_208.GINI_RED ? 'critical'
    : gini > THRESHOLDS_208.GINI_WARNING ? 'warning' : 'healthy';

  // Top 5% concentration
  const top5pctIdx = Math.floor(n * 0.95);
  const top5pctTotal = sorted.slice(top5pctIdx).reduce((s, v) => s + v, 0);
  const top5pctShare = total > 0 ? r4(top5pctTotal / total) : 0;

  return {
    metric: 'gini_coefficient',
    value: r4(gini),
    level,
    redFlag: level === 'critical',
    thresholds: { warning: THRESHOLDS_208.GINI_WARNING, red: THRESHOLDS_208.GINI_RED },
    detail: { n, totalReputation: r4(total), top5pctShare, top5pctThreshold: 0.75 },
    interpretation: gini > THRESHOLDS_208.GINI_RED
      ? `Gini ${r4(gini)} — top 5% hold ${(top5pctShare * 100).toFixed(1)}% of reputation. Governance capture risk. (Build Finance pattern)`
      : gini > THRESHOLDS_208.GINI_WARNING
      ? `Gini ${r4(gini)} — moderate concentration. Watch for coordinated voting blocks.`
      : `Gini ${r4(gini)} — healthy reputation distribution.`,
    researchSource: 'Build Finance governance attack — single actor exploited low quorum',
  };
}

// ── Metric 3: Hollow Task Completion Rate ────────────────────────────────────

/**
 * Compute hollow task completion rate.
 * Hollow = auto-approved in <15 seconds without peer review.
 *
 * @param {{ completedMs?: number, hadPeerReview?: boolean, autoApproved?: boolean }[]} tasks
 * @returns {MetricResult208}
 */
function computeHollowTaskRate208(tasks) {
  if (!Array.isArray(tasks)) throw new EconomicHealthError208('tasks must be array');
  if (tasks.length === 0) {
    return {
      metric: 'hollow_task_rate',
      value: 0, level: 'healthy', redFlag: false,
      thresholds: { warning: THRESHOLDS_208.HOLLOW_WARNING, red: THRESHOLDS_208.HOLLOW_RED },
      detail: { total: 0, hollow: 0, rate: 0 },
      interpretation: 'No tasks in window — cannot assess.',
      researchSource: 'Coordinape collusion / Gitcoin Sybil attack patterns',
    };
  }
  let hollow = 0;
  for (const t of tasks) {
    if (!t || typeof t !== 'object') continue;
    const fast = typeof t.completedMs === 'number' && t.completedMs < 15_000;
    const noReview = !t.hadPeerReview;
    const auto = t.autoApproved !== false; // if not explicitly false, counts
    if (fast && noReview && auto) hollow++;
  }
  const rate = tasks.length > 0 ? hollow / tasks.length : 0;
  const level = rate > THRESHOLDS_208.HOLLOW_RED ? 'critical'
    : rate > THRESHOLDS_208.HOLLOW_WARNING ? 'warning' : 'healthy';

  return {
    metric: 'hollow_task_rate',
    value: r4(rate),
    level,
    redFlag: level === 'critical',
    thresholds: { warning: THRESHOLDS_208.HOLLOW_WARNING, red: THRESHOLDS_208.HOLLOW_RED },
    detail: { total: tasks.length, hollow, rate: r4(rate), hollowCriteria: '<15s + no peer review + auto-approved' },
    interpretation: rate > THRESHOLDS_208.HOLLOW_RED
      ? `${(rate * 100).toFixed(1)}% hollow tasks — likely Sybil bot activity. Drain attack in progress. (Coordinape pattern)`
      : rate > THRESHOLDS_208.HOLLOW_WARNING
      ? `${(rate * 100).toFixed(1)}% hollow tasks — elevated. Check for gaming of streak/XP system.`
      : `${(rate * 100).toFixed(1)}% hollow tasks — within normal range.`,
    researchSource: 'Coordinape circle-voting / Gitcoin Sybil — fast auto-approve exploit pattern',
  };
}

// ── Metric 4: Treasury Liquidity Ratio ───────────────────────────────────────

/**
 * Compute treasury liquidity ratio.
 * Ratio = (USDC + ETH) / totalAssets
 * < 0.50 = Celsius scenario (can't meet obligations when price drops).
 *
 * @param {{ usdc?: number, eth?: number, ethPriceUsd?: number, protocolToken?: number, protocolTokenPriceUsd?: number, other?: number }} treasury
 * @returns {MetricResult208}
 */
function computeTreasuryLiquidity208(treasury) {
  if (!treasury || typeof treasury !== 'object') {
    throw new EconomicHealthError208('treasury must be an object');
  }
  const usdc = Math.max(0, Number(treasury.usdc) || 0);
  const eth = Math.max(0, Number(treasury.eth) || 0);
  const ethPrice = Math.max(0, Number(treasury.ethPriceUsd) || 0);
  const ethUsd = eth * ethPrice;
  const protocolToken = Math.max(0, Number(treasury.protocolToken) || 0);
  const tokenPrice = Math.max(0, Number(treasury.protocolTokenPriceUsd) || 0);
  const tokenUsd = protocolToken * tokenPrice;
  const other = Math.max(0, Number(treasury.other) || 0);
  const liquidAssets = usdc + ethUsd;
  const totalAssets = liquidAssets + tokenUsd + other;
  const ratio = totalAssets > 0 ? liquidAssets / totalAssets : 1.0; // If empty, not illiquid
  const level = ratio < THRESHOLDS_208.LIQUIDITY_RED ? 'critical'
    : ratio < THRESHOLDS_208.LIQUIDITY_WARN ? 'warning' : 'healthy';

  return {
    metric: 'treasury_liquidity_ratio',
    value: r4(ratio),
    level,
    redFlag: level === 'critical',
    thresholds: { warning: THRESHOLDS_208.LIQUIDITY_WARN, red: THRESHOLDS_208.LIQUIDITY_RED },
    detail: {
      liquidAssets: r4(liquidAssets),
      totalAssets: r4(totalAssets),
      breakdown: { usdc: r4(usdc), ethUsd: r4(ethUsd), protocolTokenUsd: r4(tokenUsd), other: r4(other) },
    },
    interpretation: ratio < THRESHOLDS_208.LIQUIDITY_RED
      ? `Only ${(ratio * 100).toFixed(1)}% of treasury in liquid assets. Cannot meet obligations in a downturn. (Celsius pattern — $5B collapse)`
      : ratio < THRESHOLDS_208.LIQUIDITY_WARN
      ? `${(ratio * 100).toFixed(1)}% liquid — approaching critical threshold. Reduce protocol token exposure.`
      : `${(ratio * 100).toFixed(1)}% liquid assets — treasury in healthy position.`,
    researchSource: 'Celsius Network + 3AC — illiquid collateral mismatch causing $5B+ collapse',
  };
}

// ── Master health check ───────────────────────────────────────────────────────

/**
 * Run all 4 health checks and return a unified report.
 *
 * @param {Object} params
 * @param {{ created: number, decayed: number }[]} params.riiBuckets
 * @param {number[]}   params.reputationValues
 * @param {Object[]}   params.recentTasks
 * @param {Object}     params.treasury
 * @param {string}     [params.asOfDate]
 * @returns {EconomicHealthReport208}
 */
function computeEconomicHealth208(params = {}) {
  const { riiBuckets = [], reputationValues = [], recentTasks = [], treasury = {}, asOfDate } = params;
  const results = {};
  const errors = {};

  // Run each metric independently so one failure doesn't kill the rest
  try { results.rii       = computeRII208(riiBuckets); }            catch (e) { errors.rii = e.message; }
  try { results.gini      = computeGini208(reputationValues); }     catch (e) { errors.gini = e.message; }
  try { results.hollow    = computeHollowTaskRate208(recentTasks); } catch (e) { errors.hollow = e.message; }
  try { results.liquidity = computeTreasuryLiquidity208(treasury); } catch (e) { errors.liquidity = e.message; }

  const allMetrics = Object.values(results);
  const criticalCount = allMetrics.filter(m => m.level === 'critical').length;
  const warningCount  = allMetrics.filter(m => m.level === 'warning').length;
  const redFlags      = allMetrics.filter(m => m.redFlag).map(m => m.metric);

  const overallStatus = criticalCount >= 2 ? 'critical'
    : criticalCount === 1 || warningCount >= 2 ? 'warning' : 'healthy';

  const actionRequired = [];
  if (results.rii?.level === 'critical')      actionRequired.push('Run Sybil audit — enable peer review gate for all tasks immediately');
  if (results.gini?.level === 'critical')     actionRequired.push('Governance lock: require ≥65% quorum on all treasury proposals');
  if (results.hollow?.level === 'critical')   actionRequired.push('Activate HITL gate — pause automated task approvals pending review');
  if (results.liquidity?.level === 'critical') actionRequired.push('Treasury rebalance: convert protocol token to USDC until ratio >50%');

  return {
    status: overallStatus,
    computedAt: asOfDate || new Date().toISOString(),
    summary: {
      overallStatus,
      criticalCount,
      warningCount,
      healthyCount: allMetrics.length - criticalCount - warningCount,
      redFlags,
      actionRequired,
    },
    metrics: results,
    errors: Object.keys(errors).length ? errors : undefined,
    thresholds: THRESHOLDS_208,
    ecosVersion: 'V208',
    researchBasis: 'FTX/Terra/Celsius/3AC/Colony/Build Finance failure autopsy — ECOS V208 research synthesis',
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function r4(n) { return Math.round(n * 10000) / 10000; }

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  computeEconomicHealth208,
  computeRII208,
  computeGini208,
  computeHollowTaskRate208,
  computeTreasuryLiquidity208,
  EconomicHealthError208,
  THRESHOLDS_208,
};
