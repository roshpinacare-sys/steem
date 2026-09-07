'use strict';
  /**
   * trendAggregation427.js — ECOS V427 Feature 1
   * Aggregates multiple trend analysis results into a rolling weekly/monthly
   * summary with configurable time window parameter.
   * R1: sacred files untouched. R2: all identifiers end in 427. R3: no new npm deps.
   */

  const { createHash } = require('crypto');

  const TREND_AGGREGATION_VERSION427 = '427.0.0';
  const MAX_AGGREGATION_STORE427 = 1000;
  const MAX_AGGREGATION_LOG427 = 500;

  const _aggregationStore427 = {
    analyses: [],          // stored trend analysis results
    summaries: [],         // computed rolling summaries
    log: [],
    stats: {
      analysesStored: 0,
      summariesComputed: 0,
      version: TREND_AGGREGATION_VERSION427,
    },
  };

  function _appendAggLog427(entry) {
    if (_aggregationStore427.log.length >= MAX_AGGREGATION_LOG427) _aggregationStore427.log.shift();
    _aggregationStore427.log.push(entry);
  }

  /**
   * storeAnalysis427(analysis) — store a trend analysis result for later aggregation.
   */
  function storeAnalysis427(analysis, auditLog = null) {
    if (!analysis || typeof analysis !== 'object') throw new Error('analysis must be an object');
    if (!analysis.intentShifts || typeof analysis.intentShifts !== 'object') {
      throw new Error('analysis.intentShifts required');
    }

    const record = {
      analysisId427: createHash('sha256')
        .update(JSON.stringify(analysis.intentShifts) + Date.now())
        .digest('hex').slice(0, 16),
      ts: analysis.toTs || new Date().toISOString(),
      fromTs: analysis.fromTs || null,
      toTs: analysis.toTs || new Date().toISOString(),
      intentShifts: analysis.intentShifts,
      emerging: analysis.emerging || [],
      declining: analysis.declining || [],
      intentCount: analysis.intentCount || Object.keys(analysis.intentShifts).length,
      storedAt: new Date().toISOString(),
    };

    _aggregationStore427.analyses.push(record);
    if (_aggregationStore427.analyses.length > MAX_AGGREGATION_STORE427) {
      _aggregationStore427.analyses.shift();
    }
    _aggregationStore427.stats.analysesStored++;

    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('trend_analysis_stored427', { analysisId427: record.analysisId427 });
    }
    return { ok: true, analysisId427: record.analysisId427, ts: record.storedAt };
  }

  /**
   * aggregateTrends427(opts) — compute rolling summary over analyses within a time window.
   * opts: { windowMs?, label?, fromTs?, toTs? }
   */
  function aggregateTrends427(opts = {}, auditLog = null) {
    let analyses = [..._aggregationStore427.analyses];

    // Apply time window filter
    if (opts.windowMs) {
      const cutoff = Date.now() - parseInt(opts.windowMs, 10);
      analyses = analyses.filter(a => new Date(a.storedAt).getTime() >= cutoff);
    }
    if (opts.fromTs) {
      const from = new Date(opts.fromTs).getTime();
      analyses = analyses.filter(a => new Date(a.storedAt).getTime() >= from);
    }
    if (opts.toTs) {
      const to = new Date(opts.toTs).getTime();
      analyses = analyses.filter(a => new Date(a.storedAt).getTime() <= to);
    }

    if (analyses.length === 0) {
      return {
        ok: true,
        version: TREND_AGGREGATION_VERSION427,
        analysisCount: 0,
        message: 'No analyses found in window',
        summary: null,
      };
    }

    // Aggregate: per-intent average shift, frequency, and direction count
    const intentMap = {};
    for (const a of analyses) {
      for (const [intent, data] of Object.entries(a.intentShifts || {})) {
        if (!intentMap[intent]) {
          intentMap[intent] = { shiftSum: 0, count: 0, risingCount: 0, decliningCount: 0, stableCount: 0, shareASum: 0, shareBSum: 0 };
        }
        intentMap[intent].shiftSum += data.shift || 0;
        intentMap[intent].count++;
        intentMap[intent].shareASum += data.shareA || 0;
        intentMap[intent].shareBSum += data.shareB || 0;
        if (data.trend === 'rising') intentMap[intent].risingCount++;
        else if (data.trend === 'declining') intentMap[intent].decliningCount++;
        else intentMap[intent].stableCount++;
      }
    }

    const intentSummaries = {};
    for (const [intent, agg] of Object.entries(intentMap)) {
      const avgShift = agg.count > 0 ? agg.shiftSum / agg.count : 0;
      const dominantTrend = agg.risingCount > agg.decliningCount
        ? (agg.risingCount > agg.stableCount ? 'rising' : 'stable')
        : (agg.decliningCount > agg.stableCount ? 'declining' : 'stable');
      intentSummaries[intent] = {
        avgShift: parseFloat(avgShift.toFixed(4)),
        avgShiftPct: parseFloat((avgShift * 100).toFixed(2)),
        occurrences: agg.count,
        avgShareA: parseFloat((agg.shareASum / agg.count).toFixed(4)),
        avgShareB: parseFloat((agg.shareBSum / agg.count).toFixed(4)),
        risingCount: agg.risingCount,
        decliningCount: agg.decliningCount,
        stableCount: agg.stableCount,
        dominantTrend,
      };
    }

    const topEmerging427 = Object.entries(intentSummaries)
      .filter(([, v]) => v.dominantTrend === 'rising')
      .sort((a, b) => b[1].avgShift - a[1].avgShift)
      .map(([k]) => k);

    const topDeclining427 = Object.entries(intentSummaries)
      .filter(([, v]) => v.dominantTrend === 'declining')
      .sort((a, b) => a[1].avgShift - b[1].avgShift)
      .map(([k]) => k);

    const summaryId427 = createHash('sha256')
      .update(JSON.stringify(intentSummaries) + Date.now())
      .digest('hex').slice(0, 16);

    const summary = {
      summaryId427,
      generatedAt427: new Date().toISOString(),
      analysisCount: analyses.length,
      intentCount: Object.keys(intentSummaries).length,
      intentSummaries,
      topEmerging427,
      topDeclining427,
      windowMs: opts.windowMs || null,
      fromTs: analyses[0]?.storedAt || null,
      toTs: analyses[analyses.length - 1]?.storedAt || null,
      version: TREND_AGGREGATION_VERSION427,
    };

    _aggregationStore427.summaries.push(summary);
    if (_aggregationStore427.summaries.length > 200) _aggregationStore427.summaries.shift();
    _aggregationStore427.stats.summariesComputed++;

    _appendAggLog427({ event: 'trend_aggregated427', summaryId427, analysisCount: analyses.length, ts: new Date().toISOString() });

    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('trend_aggregated427', { summaryId427, analysisCount: analyses.length });
    }

    return { ok: true, ...summary };
  }

  /**
   * getStoredAnalyses427(opts) — retrieve stored analyses with optional time window filter.
   */
  function getStoredAnalyses427(opts = {}) {
    let analyses = [..._aggregationStore427.analyses];
    if (opts.windowMs) {
      const cutoff = Date.now() - parseInt(opts.windowMs, 10);
      analyses = analyses.filter(a => new Date(a.storedAt).getTime() >= cutoff);
    }
    const limit = parseInt(opts.limit, 10) || 50;
    return analyses.slice(-limit);
  }

  function getAggregationStats427() {
    return {
      version: TREND_AGGREGATION_VERSION427,
      analysesStored: _aggregationStore427.analyses.length,
      summariesComputed: _aggregationStore427.summaries.length,
      stats: { ..._aggregationStore427.stats },
      recentLog: _aggregationStore427.log.slice(-10),
    };
  }

  function resetAggregationStore427(auditLog = null) {
    _aggregationStore427.analyses.length = 0;
    _aggregationStore427.summaries.length = 0;
    _aggregationStore427.log.length = 0;
    _aggregationStore427.stats.analysesStored = 0;
    _aggregationStore427.stats.summariesComputed = 0;
    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('trend_aggregation_reset427', { ts: new Date().toISOString() });
    }
    return { ok: true, reset: true };
  }

  function wireTrendAggregation427(app, auditLog = null) {
    /* GET /api/v1/chat/route/telemetry/dashboard/trend/aggregate */
    app.get('/api/v1/chat/route/telemetry/dashboard/trend/aggregate', (req, res) => {
      try {
        const result = aggregateTrends427(req.query, auditLog);
        res.json({ ok: true, ecosVersion: 'V427', ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* POST /api/v1/chat/route/telemetry/dashboard/trend/aggregate/compute */
    app.post('/api/v1/chat/route/telemetry/dashboard/trend/aggregate/compute', (req, res) => {
      try {
        const { analysis, windowMs, fromTs, toTs } = req.body || {};
        if (analysis) storeAnalysis427(analysis, auditLog);
        const result = aggregateTrends427({ windowMs, fromTs, toTs }, auditLog);
        res.json({ ok: true, ecosVersion: 'V427', ...result });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* GET /api/v1/chat/route/telemetry/dashboard/trend/aggregate/stats */
    app.get('/api/v1/chat/route/telemetry/dashboard/trend/aggregate/stats', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V427', ...getAggregationStats427() });
    });

    /* POST /api/v1/chat/route/telemetry/dashboard/trend/aggregate/reset */
    app.post('/api/v1/chat/route/telemetry/dashboard/trend/aggregate/reset', (_req, res) => {
      const result = resetAggregationStore427(auditLog);
      res.json({ ok: true, ecosVersion: 'V427', ...result });
    });
  }

  if (process.env.NODE_ENV === 'test') {
    module.exports = {
      storeAnalysis427,
      aggregateTrends427,
      getStoredAnalyses427,
      getAggregationStats427,
      resetAggregationStore427,
      wireTrendAggregation427,
      TREND_AGGREGATION_VERSION427,
      _aggregationStore427,
    };
  } else {
    module.exports = {
      storeAnalysis427,
      aggregateTrends427,
      getStoredAnalyses427,
      getAggregationStats427,
      resetAggregationStore427,
      wireTrendAggregation427,
      TREND_AGGREGATION_VERSION427,
    };
  }
  