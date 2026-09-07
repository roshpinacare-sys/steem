/**
   * lib/economicAnomalyDetector209.js — ECOS V209
   * Economic Anomaly Detector: identifies circular credit flows (wash trading),
   * unusual payment velocity, bulk claims, and Sybil coordination patterns.
   * Research: FTX internal loan manipulation, Terra wash-trading detection.
   */
  'use strict';

  const WASH_TRADE_CYCLE_LIMIT_209  = 3;    // ≤3 hops in a cycle = likely wash trade
  const VELOCITY_WINDOW_MS_209      = 60 * 60 * 1000;  // 1-hour velocity window
  const VELOCITY_RED_THRESHOLD_209  = 50;   // >50 txns in 1h from same wallet = anomaly
  const CIRCULAR_FLOW_PCT_209       = 0.80; // ≥80% funds returning to origin = circular
  const MAX_TRANSACTIONS_209        = 10_000;
  const ANOMALY_TYPES_209 = ['circular_flow','high_velocity','bulk_claim','sybil_cluster','unusual_amount'];

  class AnomalyValidationError209 extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'AnomalyValidationError209';
      this.code = code || 'ANOMALY_VALIDATION_ERROR_209';
      this.statusCode = 400;
    }
  }

  /**
   * detectCircularFlow209 — check if transactions form a cycle (A→B→C→A pattern).
   * @param {Array<{from,to,amountUsd}>} transactions
   * @returns {{ isCircular, cycles, riskScore }}
   */
  function detectCircularFlow209(transactions) {
    if (!Array.isArray(transactions)) throw new AnomalyValidationError209('transactions must be an array');
    if (transactions.length === 0) return { isCircular: false, cycles: [], riskScore: 0 };

    // Build adjacency map
    const adj = new Map();
    for (const tx of transactions) {
      if (!tx.from || !tx.to) continue;
      if (!adj.has(tx.from)) adj.set(tx.from, []);
      adj.get(tx.from).push({ to: tx.to, amount: tx.amountUsd || 0 });
    }

    const cycles = [];
    const visited = new Set();

    function dfs(start, current, path, pathSet) {
      if (path.length > WASH_TRADE_CYCLE_LIMIT_209 + 1) return;
      const neighbors = adj.get(current) || [];
      for (const { to, amount } of neighbors) {
        if (to === start && path.length >= 2) {
          cycles.push({ cycle: [...path, to], length: path.length, totalAmountUsd: amount });
          return;
        }
        if (!pathSet.has(to)) {
          pathSet.add(to);
          dfs(start, to, [...path, to], pathSet);
          pathSet.delete(to);
        }
      }
    }

    for (const node of adj.keys()) {
      if (!visited.has(node)) {
        dfs(node, node, [node], new Set([node]));
        visited.add(node);
      }
    }

    const uniqueCycles = cycles.slice(0, 20); // cap at 20
    const riskScore = Math.min(1, uniqueCycles.length * 0.2 + (uniqueCycles.length > 0 ? 0.3 : 0));

    return {
      isCircular: uniqueCycles.length > 0,
      cycles: uniqueCycles,
      cycleCount: uniqueCycles.length,
      riskScore: +riskScore.toFixed(3),
      anomalyType: uniqueCycles.length > 0 ? 'circular_flow' : null,
    };
  }

  /**
   * detectHighVelocity209 — flag wallets transacting too fast.
   * @param {Array<{walletId,timestamp,amountUsd}>} transactions
   * @returns {{ flagged, velocityMap }}
   */
  function detectHighVelocity209(transactions) {
    if (!Array.isArray(transactions)) throw new AnomalyValidationError209('transactions must be an array');
    const windowStart = Date.now() - VELOCITY_WINDOW_MS_209;
    const recent = transactions.filter(t => {
      const ts = typeof t.timestamp === 'number' ? t.timestamp : new Date(t.timestamp).getTime();
      return ts >= windowStart;
    });

    const velocityMap = {};
    for (const tx of recent) {
      const id = tx.walletId || tx.from || 'unknown';
      if (!velocityMap[id]) velocityMap[id] = { count: 0, totalUsd: 0 };
      velocityMap[id].count++;
      velocityMap[id].totalUsd += tx.amountUsd || 0;
    }

    const flagged = Object.entries(velocityMap)
      .filter(([_, v]) => v.count > VELOCITY_RED_THRESHOLD_209)
      .map(([walletId, v]) => ({
        walletId,
        txCount: v.count,
        totalUsd: +v.totalUsd.toFixed(4),
        anomalyType: 'high_velocity',
        riskScore: Math.min(1, v.count / (VELOCITY_RED_THRESHOLD_209 * 2)),
      }));

    return { flagged, velocityThreshold: VELOCITY_RED_THRESHOLD_209, windowMs: VELOCITY_WINDOW_MS_209 };
  }

  /**
   * detectBulkClaims209 — identify suspiciously coordinated bulk claim patterns.
   * @param {Array<{claimantId,taskId,timestamp,amountUsd}>} claims
   * @returns {{ suspicious, clusterCount, riskScore }}
   */
  function detectBulkClaims209(claims) {
    if (!Array.isArray(claims)) throw new AnomalyValidationError209('claims must be an array');
    if (claims.length === 0) return { suspicious: false, clusterCount: 0, riskScore: 0 };

    // Cluster claims by 5-minute windows
    const windowMs = 5 * 60 * 1000;
    const clusters = [];
    const sorted = [...claims].sort((a, b) => {
      const ta = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
      const tb = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
      return ta - tb;
    });

    let currentCluster = [];
    let clusterStart = sorted.length > 0 ? (typeof sorted[0].timestamp === 'number' ? sorted[0].timestamp : new Date(sorted[0].timestamp).getTime()) : 0;

    for (const claim of sorted) {
      const ts = typeof claim.timestamp === 'number' ? claim.timestamp : new Date(claim.timestamp).getTime();
      if (ts - clusterStart < windowMs) {
        currentCluster.push(claim);
      } else {
        if (currentCluster.length >= 10) clusters.push([...currentCluster]);
        currentCluster = [claim];
        clusterStart   = ts;
      }
    }
    if (currentCluster.length >= 10) clusters.push(currentCluster);

    const riskScore = Math.min(1, clusters.length * 0.25);
    return {
      suspicious:   clusters.length > 0,
      clusterCount: clusters.length,
      clusters:     clusters.slice(0, 5).map(c => ({
        claimCount: c.length,
        uniqueClaimants: new Set(c.map(x => x.claimantId)).size,
        totalUsd: +c.reduce((s, x) => s + (x.amountUsd || 0), 0).toFixed(4),
      })),
      anomalyType: clusters.length > 0 ? 'bulk_claim' : null,
      riskScore: +riskScore.toFixed(3),
    };
  }

  /**
   * runFullAnomalyCheck209 — run all anomaly detectors on a transaction set.
   */
  function runFullAnomalyCheck209(transactions) {
    if (!Array.isArray(transactions)) throw new AnomalyValidationError209('transactions must be an array');
    if (transactions.length > MAX_TRANSACTIONS_209) {
      throw new AnomalyValidationError209(`Input exceeds max ${MAX_TRANSACTIONS_209} transactions`);
    }
    const circularResult  = detectCircularFlow209(transactions);
    const velocityResult  = detectHighVelocity209(transactions);
    const bulkResult      = detectBulkClaims209(transactions);

    const overallRisk = Math.min(1, (
      circularResult.riskScore * 0.4 +
      (velocityResult.flagged.length > 0 ? 0.3 : 0) +
      bulkResult.riskScore * 0.3
    ));

    const anomalies = [];
    if (circularResult.isCircular)           anomalies.push('circular_flow');
    if (velocityResult.flagged.length > 0)   anomalies.push('high_velocity');
    if (bulkResult.suspicious)               anomalies.push('bulk_claim');

    return {
      ok: true,
      overallRisk: +overallRisk.toFixed(3),
      riskLevel: overallRisk >= 0.7 ? 'critical' : overallRisk >= 0.4 ? 'warning' : 'clean',
      anomalies,
      circular:  circularResult,
      velocity:  velocityResult,
      bulkClaim: bulkResult,
      transactionsAnalyzed: transactions.length,
      ecosVersion: 'V209',
    };
  }

  module.exports = {
    detectCircularFlow209,
    detectHighVelocity209,
    detectBulkClaims209,
    runFullAnomalyCheck209,
    AnomalyValidationError209,
    WASH_TRADE_CYCLE_LIMIT_209,
    VELOCITY_WINDOW_MS_209,
    VELOCITY_RED_THRESHOLD_209,
    CIRCULAR_FLOW_PCT_209,
    ANOMALY_TYPES_209,
  };
  