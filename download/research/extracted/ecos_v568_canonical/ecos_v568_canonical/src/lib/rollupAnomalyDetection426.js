'use strict';
  /**
   * rollupAnomalyDetection426.js — ECOS V426 Feature 4
   * Flags rollup buckets where any intent share drift exceeds a configurable
   * threshold. Exposes GET endpoint + emits audit event.
   * R1: sacred files untouched. R2: all identifiers end in 426. R3: no new npm deps.
   */

  const { createHash } = require('crypto');

  const ROLLUP_ANOMALY_VERSION426 = '426.0.0';
  const DEFAULT_ANOMALY_THRESHOLD426 = 0.15;   // 15% share drift triggers anomaly
  const MAX_ANOMALY_LOG426 = 1000;

  const _anomalyStore426 = {
    detections: [],
    config: {
      threshold: DEFAULT_ANOMALY_THRESHOLD426,
      enabled: true,
    },
    stats: {
      scansRun: 0,
      anomaliesDetected: 0,
      bucketsScanned: 0,
    },
  };

  /**
   * configureAnomalyDetection426(opts) — set threshold, enabled.
   */
  function configureAnomalyDetection426(opts = {}) {
    if (opts.threshold !== undefined) {
      const t = parseFloat(opts.threshold);
      if (isNaN(t) || t < 0 || t > 1) throw new Error('threshold must be between 0 and 1');
      _anomalyStore426.config.threshold = t;
    }
    if (opts.enabled !== undefined) _anomalyStore426.config.enabled = Boolean(opts.enabled);
    return { ok: true, config: { ..._anomalyStore426.config } };
  }

  function _appendAnomalyLog426(entry) {
    if (_anomalyStore426.detections.length >= MAX_ANOMALY_LOG426) _anomalyStore426.detections.shift();
    _anomalyStore426.detections.push(entry);
  }

  /**
   * detectBucketAnomalies426(bucketA, bucketB, label) — compare two rollup buckets
   * and flag intents whose share drift exceeds the configured threshold.
   */
  function detectBucketAnomalies426(bucketA, bucketB, label = null, auditLog = null) {
    if (!bucketA || !bucketB) throw new Error('Both bucketA and bucketB required');

    _anomalyStore426.stats.scansRun++;
    _anomalyStore426.stats.bucketsScanned += 2;

    const totalA = bucketA.totalCount || Math.max(1, Object.values(bucketA.intents || {}).reduce((a, b) => a + b, 0));
    const totalB = bucketB.totalCount || Math.max(1, Object.values(bucketB.intents || {}).reduce((a, b) => a + b, 0));
    const intentsA = bucketA.intents || {};
    const intentsB = bucketB.intents || {};
    const allIntents = new Set([...Object.keys(intentsA), ...Object.keys(intentsB)]);

    const anomalies = [];
    const threshold = _anomalyStore426.config.threshold;

    for (const intent of allIntents) {
      const shareA = (intentsA[intent] || 0) / totalA;
      const shareB = (intentsB[intent] || 0) / totalB;
      const drift = Math.abs(shareB - shareA);
      if (drift >= threshold) {
        anomalies.push({
          intent,
          shareA: parseFloat(shareA.toFixed(4)),
          shareB: parseFloat(shareB.toFixed(4)),
          drift: parseFloat(drift.toFixed(4)),
          driftPct: parseFloat((drift * 100).toFixed(2)),
          direction: shareB > shareA ? 'up' : 'down',
          severity: drift >= threshold * 2 ? 'high' : 'medium',
        });
      }
    }

    const detectionId = createHash('sha256')
      .update(JSON.stringify({ anomalies, label }) + Date.now())
      .digest('hex').slice(0, 16);

    const result = {
      detectionId,
      label: label || null,
      ts: new Date().toISOString(),
      threshold,
      anomalyCount: anomalies.length,
      bucketsScanned: 2,
      anomalies,
      ok: true,
      version: ROLLUP_ANOMALY_VERSION426,
    };

    if (anomalies.length > 0) {
      _anomalyStore426.stats.anomaliesDetected += anomalies.length;
      _appendAnomalyLog426(result);
      if (auditLog && typeof auditLog.log === 'function') {
        auditLog.log('rollup_anomaly_detected426', {
          detectionId,
          anomalyCount: anomalies.length,
          intents: anomalies.map(a => a.intent),
        });
      }
    }

    return result;
  }

  /**
   * scanAllBuckets426(rollupStore, granularity, auditLog) — scan consecutive bucket
   * pairs in the rollup store for anomalies.
   */
  function scanAllBuckets426(rollupStore, granularity = 'daily', auditLog = null) {
    if (!rollupStore) return { ok: false, error: 'rollupStore required' };
    const map = granularity === 'hourly' ? rollupStore.hourly : rollupStore.daily;
    if (!map) return { ok: false, error: 'store has no ' + granularity + ' map' };

    let entries;
    if (map instanceof Map) {
      entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    } else {
      entries = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
    }

    if (entries.length < 2) return { ok: true, scanned: 0, anomalies: [], message: 'Need at least 2 buckets' };

    const allAnomalies = [];
    for (let i = 0; i < entries.length - 1; i++) {
      const [keyA, bA] = entries[i];
      const [keyB, bB] = entries[i + 1];
      const result = detectBucketAnomalies426(bA, bB, keyA + '_vs_' + keyB, auditLog);
      if (result.anomalyCount > 0) allAnomalies.push(result);
    }

    return {
      ok: true,
      granularity,
      scanned: entries.length - 1,
      anomalyGroups: allAnomalies.length,
      totalAnomalies: allAnomalies.reduce((s, r) => s + r.anomalyCount, 0),
      detections: allAnomalies,
      version: ROLLUP_ANOMALY_VERSION426,
    };
  }

  function getAnomalyLog426(limit = 50) {
    return _anomalyStore426.detections.slice(-Math.min(limit, 200));
  }

  function getAnomalyStats426() {
    return {
      version: ROLLUP_ANOMALY_VERSION426,
      config: { ..._anomalyStore426.config },
      stats: { ..._anomalyStore426.stats },
      recentDetections: _anomalyStore426.detections.slice(-10),
    };
  }

  function wireRollupAnomalyDetection426(app, rollupStore426, auditLog = null) {
    /* GET /api/v1/chat/route/telemetry/rollup/anomalies */
    app.get('/api/v1/chat/route/telemetry/rollup/anomalies', (req, res) => {
      try {
        const { granularity = 'daily' } = req.query;
        const store = rollupStore426 || { daily: new Map(), hourly: new Map() };
        const result = scanAllBuckets426(store, granularity, auditLog);
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* POST /api/v1/chat/route/telemetry/rollup/anomalies/detect */
    app.post('/api/v1/chat/route/telemetry/rollup/anomalies/detect', (req, res) => {
      try {
        const { bucketA, bucketB, label } = req.body || {};
        if (!bucketA || !bucketB) {
          return res.status(400).json({ ok: false, error: 'bucketA and bucketB required', ecosVersion: 'V426' });
        }
        const result = detectBucketAnomalies426(bucketA, bucketB, label || null, auditLog);
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* GET /api/v1/chat/route/telemetry/rollup/anomalies/log */
    app.get('/api/v1/chat/route/telemetry/rollup/anomalies/log', (req, res) => {
      const limit = parseInt(req.query.limit, 10) || 50;
      res.json({ ok: true, ecosVersion: 'V426', detections: getAnomalyLog426(limit), count: Math.min(limit, _anomalyStore426.detections.length) });
    });

    /* GET /api/v1/chat/route/telemetry/rollup/anomalies/stats */
    app.get('/api/v1/chat/route/telemetry/rollup/anomalies/stats', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V426', ...getAnomalyStats426() });
    });

    /* POST /api/v1/chat/route/telemetry/rollup/anomalies/configure */
    app.post('/api/v1/chat/route/telemetry/rollup/anomalies/configure', (req, res) => {
      try {
        const result = configureAnomalyDetection426(req.body || {});
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });
  }

  if (process.env.NODE_ENV === 'test') {
    module.exports = {
      configureAnomalyDetection426,
      detectBucketAnomalies426,
      scanAllBuckets426,
      getAnomalyLog426,
      getAnomalyStats426,
      wireRollupAnomalyDetection426,
      ROLLUP_ANOMALY_VERSION426,
      DEFAULT_ANOMALY_THRESHOLD426,
      _anomalyStore426,
    };
  } else {
    module.exports = {
      configureAnomalyDetection426,
      detectBucketAnomalies426,
      scanAllBuckets426,
      getAnomalyLog426,
      getAnomalyStats426,
      wireRollupAnomalyDetection426,
      ROLLUP_ANOMALY_VERSION426,
      DEFAULT_ANOMALY_THRESHOLD426,
    };
  }
  