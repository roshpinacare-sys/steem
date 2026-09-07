'use strict';
/**
 * src/lib/anomalyTrendCorrelation428.js — ECOS V428
 *
 * Feature 4: Anomaly Trend Correlation
 * Correlates anomaly detection events with trend analysis snapshots from the
 * same time window; exposes correlation score as GET endpoint.
 *
 * Functions:
 *   configureAnomalyTrendCorrelation428(opts)     — set timeWindowMs, minCorrelationScore
 *   correlateAnomalyWithTrend428(anomalyResult, trendResult) — compute correlation score
 *   storeCorrelation428(correlationResult)        — store correlation record
 *   getCorrelations428(opts)                      — list stored correlations with filters
 *   getCorrelationStats428()                      — stats + config
 *   getCorrelationLog428(limit)                   — event log
 *   wireAnomalyTrendCorrelation428(app, opts, auditLog) — registers HTTP endpoints
 *
 * Endpoints: ATCORR01–ATCORR04 (4 endpoints)
 *
 * @version 428.0.0
 * R1: Sacred untouched. R2: All identifiers end in 428. R3: No new npm deps.
 */

const crypto = require('crypto');

const ANOMALY_TREND_CORRELATION_VERSION428 = '428.0.0';
const DEFAULT_TIME_WINDOW_MS428 = 3600000; // 1 hour

const _correlationState428 = {
  timeWindowMs:        DEFAULT_TIME_WINDOW_MS428,
  minCorrelationScore: 0.0,
  correlations:        [],
  log:                 [],
  stats: {
    totalCorrelations:  0,
    highCorrelations:   0,  // score >= 0.7
    mediumCorrelations: 0,  // score 0.3–0.69
    lowCorrelations:    0,  // score < 0.3
  },
};

// ─── helpers ────────────────────────────────────────────────────────────────

function _corrLog428(event, data) {
  const entry = { ts: new Date().toISOString(), event, ...data };
  _correlationState428.log.push(entry);
  if (_correlationState428.log.length > 300) _correlationState428.log.shift();
}

/**
 * Extract intent set from anomaly detections.
 */
function _anomalyIntents428(anomalyResult) {
  const intents = new Set();
  const detections = anomalyResult.detections || [];
  for (const det of detections) {
    const anomalies = det.anomalies || [];
    for (const a of anomalies) {
      if (a.intent) intents.add(a.intent);
    }
  }
  return intents;
}

/**
 * Extract intent set from trend analysis intentShifts.
 */
function _trendIntents428(trendResult) {
  const intents = new Set();
  const shifts = trendResult.intentShifts || {};
  for (const k of Object.keys(shifts)) intents.add(k);
  return intents;
}

/**
 * Compute Jaccard similarity between two Sets.
 */
function _jaccardSimilarity428(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1.0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Configure anomaly-trend correlation.
 * @param {object} opts - { timeWindowMs, minCorrelationScore }
 */
function configureAnomalyTrendCorrelation428(opts) {
  const o = opts || {};
  if (o.timeWindowMs !== undefined) {
    if (typeof o.timeWindowMs !== 'number' || o.timeWindowMs < 0) {
      throw new Error('anomalyTrendCorrelation428: timeWindowMs must be a non-negative number');
    }
    _correlationState428.timeWindowMs = o.timeWindowMs;
  }
  if (o.minCorrelationScore !== undefined) {
    if (typeof o.minCorrelationScore !== 'number' || o.minCorrelationScore < 0 || o.minCorrelationScore > 1) {
      throw new Error('anomalyTrendCorrelation428: minCorrelationScore must be between 0 and 1');
    }
    _correlationState428.minCorrelationScore = o.minCorrelationScore;
  }
  _corrLog428('configured428', { timeWindowMs: _correlationState428.timeWindowMs, minCorrelationScore: _correlationState428.minCorrelationScore });
  return { ok: true, timeWindowMs: _correlationState428.timeWindowMs, minCorrelationScore: _correlationState428.minCorrelationScore };
}

/**
 * Correlate an anomaly scan result with a trend analysis result.
 * Both must be from the same time window (checked via timestamps if present).
 *
 * Correlation score is computed as:
 *   - Jaccard similarity of affected intents (0–1)
 *   - Weighted by anomaly severity (high=1.0, medium=0.6, low=0.3)
 *   - Normalized to [0, 1]
 *
 * @param {object} anomalyResult - output of scanAllBuckets426 / scanAndAlert427
 * @param {object} trendResult   - output of analyzeTrend426 / aggregateTrends427
 * @returns {{ ok, correlationId428, score, intentsInCommon, anomalyIntents, trendIntents, withinWindow, detail }}
 */
function correlateAnomalyWithTrend428(anomalyResult, trendResult) {
  if (!anomalyResult || typeof anomalyResult !== 'object') {
    throw new Error('anomalyTrendCorrelation428: anomalyResult must be an object');
  }
  if (!trendResult || typeof trendResult !== 'object') {
    throw new Error('anomalyTrendCorrelation428: trendResult must be an object');
  }

  const correlationId428 = 'corr428_' + crypto.randomBytes(8).toString('hex');
  const correlatedAt = new Date().toISOString();

  // Extract intents
  const anomalyIntents = _anomalyIntents428(anomalyResult);
  const trendIntents   = _trendIntents428(trendResult);

  // Jaccard similarity
  const jaccardScore = _jaccardSimilarity428(anomalyIntents, trendIntents);

  // Severity weighting: compute average severity weight from anomaly detections
  let severityWeight = 0.5; // default neutral
  const allAnomalies = [];
  for (const det of (anomalyResult.detections || [])) {
    for (const a of (det.anomalies || [])) allAnomalies.push(a);
  }
  if (allAnomalies.length > 0) {
    const weightSum = allAnomalies.reduce((sum, a) => {
      if (a.severity === 'high')   return sum + 1.0;
      if (a.severity === 'medium') return sum + 0.6;
      return sum + 0.3;
    }, 0);
    severityWeight = weightSum / allAnomalies.length;
  }

  // Combined score: weighted average of jaccard + severity
  const score = Math.min(1, (jaccardScore * 0.6 + severityWeight * 0.4));

  // Check time window
  let withinWindow = true;
  const anomalyTs = anomalyResult.scannedAt || anomalyResult.ts || null;
  const trendTs   = trendResult.computedAt || trendResult.toTs || null;
  if (anomalyTs && trendTs) {
    const diff = Math.abs(new Date(anomalyTs).getTime() - new Date(trendTs).getTime());
    withinWindow = diff <= _correlationState428.timeWindowMs;
  }

  const intentsInCommon = [...anomalyIntents].filter(i => trendIntents.has(i));

  const result = {
    ok: true,
    correlationId428,
    correlatedAt,
    score: Math.round(score * 10000) / 10000,
    withinWindow,
    intentsInCommon,
    anomalyIntents: [...anomalyIntents],
    trendIntents:   [...trendIntents],
    jaccardScore:   Math.round(jaccardScore * 10000) / 10000,
    severityWeight: Math.round(severityWeight * 10000) / 10000,
    totalAnomalies: anomalyResult.totalAnomalies || allAnomalies.length,
    detail: {
      anomalyGranularity: anomalyResult.granularity || null,
      trendWindow: trendResult.windowMs || null,
    },
  };

  return result;
}

/**
 * Store a correlation result in memory.
 * @param {object} correlationResult - output of correlateAnomalyWithTrend428
 */
function storeCorrelation428(correlationResult) {
  if (!correlationResult || !correlationResult.correlationId428) {
    throw new Error('anomalyTrendCorrelation428: correlationResult must have correlationId428');
  }

  _correlationState428.correlations.push(correlationResult);
  if (_correlationState428.correlations.length > 500) _correlationState428.correlations.shift();

  _correlationState428.stats.totalCorrelations++;
  const s = correlationResult.score || 0;
  if (s >= 0.7)      _correlationState428.stats.highCorrelations++;
  else if (s >= 0.3) _correlationState428.stats.mediumCorrelations++;
  else               _correlationState428.stats.lowCorrelations++;

  _corrLog428('stored428', { correlationId428: correlationResult.correlationId428, score: correlationResult.score });
  return { ok: true, correlationId428: correlationResult.correlationId428 };
}

/**
 * Get stored correlations with optional filters.
 * @param {object} opts - { minScore, fromTs, toTs, limit }
 */
function getCorrelations428(opts) {
  const o = opts || {};
  let results = _correlationState428.correlations.slice();

  if (typeof o.minScore === 'number') {
    results = results.filter(c => (c.score || 0) >= o.minScore);
  }
  if (o.fromTs) {
    const from = new Date(o.fromTs).getTime();
    results = results.filter(c => new Date(c.correlatedAt || 0).getTime() >= from);
  }
  if (o.toTs) {
    const to = new Date(o.toTs).getTime();
    results = results.filter(c => new Date(c.correlatedAt || 0).getTime() <= to);
  }
  if (o.limit) results = results.slice(-o.limit);

  return results;
}

/**
 * Get correlation statistics.
 */
function getCorrelationStats428() {
  return {
    version: ANOMALY_TREND_CORRELATION_VERSION428,
    timeWindowMs: _correlationState428.timeWindowMs,
    minCorrelationScore: _correlationState428.minCorrelationScore,
    storedCount: _correlationState428.correlations.length,
    stats: { ..._correlationState428.stats },
  };
}

/**
 * Get correlation event log.
 * @param {number} [limit=50]
 */
function getCorrelationLog428(limit) {
  const n = (typeof limit === 'number' && limit > 0) ? limit : 50;
  return _correlationState428.log.slice(-n);
}

// ─── wire ────────────────────────────────────────────────────────────────────

/**
 * Wire HTTP endpoints for anomaly-trend correlation.
 * ATCORR01 POST /api/v1/chat/route/telemetry/rollup/anomalies/correlate
 * ATCORR02 GET  /api/v1/chat/route/telemetry/rollup/anomalies/correlate
 * ATCORR03 GET  /api/v1/chat/route/telemetry/rollup/anomalies/correlate/stats
 * ATCORR04 POST /api/v1/chat/route/telemetry/rollup/anomalies/correlate/configure
 */
function wireAnomalyTrendCorrelation428(app, opts, auditLog) {
  const o = opts || {};
  if (o.timeWindowMs !== undefined || o.minCorrelationScore !== undefined) {
    configureAnomalyTrendCorrelation428(o);
  }

  const BASE428 = '/api/v1/chat/route/telemetry/rollup/anomalies/correlate';

  // ATCORR01 — correlate + store
  app.post(BASE428, (req, res) => {
    try {
      const body = req.body || {};
      const anomalyResult = body.anomalyResult;
      const trendResult   = body.trendResult;
      if (!anomalyResult || !trendResult) {
        return res.status(400).json({ ok: false, error: 'anomalyResult and trendResult required' });
      }
      const corrResult = correlateAnomalyWithTrend428(anomalyResult, trendResult);
      storeCorrelation428(corrResult);
      if (auditLog && typeof auditLog.append === 'function') {
        try { auditLog.append({ type: 'anomaly_trend_corr428', correlationId428: corrResult.correlationId428, score: corrResult.score }); } catch (_) {}
      }
      res.json(corrResult);
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // ATCORR02 — list stored correlations
  app.get(BASE428, (req, res) => {
    try {
      const { minScore, fromTs, toTs, limit } = req.query;
      const results = getCorrelations428({
        minScore: minScore ? parseFloat(minScore) : undefined,
        fromTs: fromTs || null,
        toTs: toTs || null,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      res.json({ ok: true, count: results.length, correlations: results });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ATCORR03 — stats
  app.get(BASE428 + '/stats', (req, res) => {
    try {
      res.json(getCorrelationStats428());
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ATCORR04 — configure
  app.post(BASE428 + '/configure', (req, res) => {
    try {
      const body = req.body || {};
      const result = configureAnomalyTrendCorrelation428(body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });
}

// ─── exports ─────────────────────────────────────────────────────────────────

module.exports = {
  ANOMALY_TREND_CORRELATION_VERSION428,
  DEFAULT_TIME_WINDOW_MS428,
  _correlationState428,
  configureAnomalyTrendCorrelation428,
  correlateAnomalyWithTrend428,
  storeCorrelation428,
  getCorrelations428,
  getCorrelationStats428,
  getCorrelationLog428,
  wireAnomalyTrendCorrelation428,
};
