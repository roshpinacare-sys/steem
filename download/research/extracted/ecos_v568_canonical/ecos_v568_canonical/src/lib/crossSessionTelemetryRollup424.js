'use strict';
/**
 * crossSessionTelemetryRollup424.js — ECOS V424 Feature 5
 * Periodic background job rolling up intent telemetry into hourly/daily aggregates
 * for long-term trend analysis.
 * R1: sacred. R2: identifiers end in 424. R3: no new npm deps.
 */

const _rollupStore424 = {
  hourly: new Map(),   // 'YYYY-MM-DDTHH' → { intents: {}, totalCount: 0, p95Latency: 0 }
  daily: new Map(),    // 'YYYY-MM-DD' → { intents: {}, totalCount: 0, avgLatency: 0 }
  lastRollup: null,
  rollupCount: 0,
  rollupIntervalHandle: null,
};

const MAX_HOURLY_BUCKETS424 = 168;   // 7 days
const MAX_DAILY_BUCKETS424 = 90;     // 3 months

function getHourlyKey424(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}T${String(d.getUTCHours()).padStart(2,'0')}`;
}

function getDailyKey424(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function computeP95424(latencies) {
  if (!latencies || latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function rollupEntries424(entries = []) {
  for (const entry of entries) {
    const ts = entry.ts || Date.now();
    const intent = entry.intent || 'unknown';
    const latency = entry.latencyMs || 0;

    // Hourly
    const hKey = getHourlyKey424(ts);
    if (!_rollupStore424.hourly.has(hKey)) {
      _rollupStore424.hourly.set(hKey, { intents: {}, totalCount: 0, latencies: [], p95Latency: 0 });
    }
    const hBucket = _rollupStore424.hourly.get(hKey);
    hBucket.intents[intent] = (hBucket.intents[intent] || 0) + 1;
    hBucket.totalCount++;
    hBucket.latencies.push(latency);
    hBucket.p95Latency = computeP95424(hBucket.latencies);

    // Daily
    const dKey = getDailyKey424(ts);
    if (!_rollupStore424.daily.has(dKey)) {
      _rollupStore424.daily.set(dKey, { intents: {}, totalCount: 0, latencies: [], avgLatency: 0 });
    }
    const dBucket = _rollupStore424.daily.get(dKey);
    dBucket.intents[intent] = (dBucket.intents[intent] || 0) + 1;
    dBucket.totalCount++;
    dBucket.latencies.push(latency);
    dBucket.avgLatency = dBucket.latencies.reduce((a, b) => a + b, 0) / dBucket.latencies.length;
  }

  // Prune old buckets
  const hourlyKeys = [..._rollupStore424.hourly.keys()].sort();
  while (hourlyKeys.length > MAX_HOURLY_BUCKETS424) {
    _rollupStore424.hourly.delete(hourlyKeys.shift());
  }
  const dailyKeys = [..._rollupStore424.daily.keys()].sort();
  while (dailyKeys.length > MAX_DAILY_BUCKETS424) {
    _rollupStore424.daily.delete(dailyKeys.shift());
  }

  _rollupStore424.lastRollup = new Date().toISOString();
  _rollupStore424.rollupCount++;
  return { ok: true, processed: entries.length };
}

function startRollupJob424(telemetry423Instance, intervalMs = 3600000) {
  if (_rollupStore424.rollupIntervalHandle) return { ok: false, error: 'already running' };
  _rollupStore424.rollupIntervalHandle = setInterval(() => {
    try {
      let entries = [];
      if (telemetry423Instance && typeof telemetry423Instance.getRecent === 'function') {
        const r = telemetry423Instance.getRecent(1000);
        entries = r.entries || r || [];
      }
      rollupEntries424(entries);
    } catch (_) { /* no-op */ }
  }, intervalMs);
  return { ok: true, intervalMs };
}

function stopRollupJob424() {
  if (_rollupStore424.rollupIntervalHandle) {
    clearInterval(_rollupStore424.rollupIntervalHandle);
    _rollupStore424.rollupIntervalHandle = null;
    return { ok: true, stopped: true };
  }
  return { ok: true, stopped: false };
}

function getRollupSummary424() {
  const hourlyArr = [..._rollupStore424.hourly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucket]) => ({
      key,
      totalCount: bucket.totalCount,
      p95Latency: bucket.p95Latency,
      intents: bucket.intents,
    }));
  const dailyArr = [..._rollupStore424.daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucket]) => ({
      key,
      totalCount: bucket.totalCount,
      avgLatency: parseFloat(bucket.avgLatency.toFixed(2)),
      intents: bucket.intents,
    }));
  return {
    lastRollup: _rollupStore424.lastRollup,
    rollupCount: _rollupStore424.rollupCount,
    hourlyBuckets: hourlyArr.length,
    dailyBuckets: dailyArr.length,
    hourly: hourlyArr.slice(-24),
    daily: dailyArr.slice(-30),
    isRunning: !!_rollupStore424.rollupIntervalHandle,
  };
}

function wireCrossSessionTelemetryRollup424(app, telemetry423Instance) {
  /* POST /api/v1/chat/route/telemetry/rollup/run */
  app.post('/api/v1/chat/route/telemetry/rollup/run', (req, res) => {
    const entries = req.body?.entries || [];
    const result = rollupEntries424(entries);
    res.json(result);
  });

  /* POST /api/v1/chat/route/telemetry/rollup/start */
  app.post('/api/v1/chat/route/telemetry/rollup/start', (req, res) => {
    const intervalMs = parseInt(req.body?.intervalMs, 10) || 3600000;
    const result = startRollupJob424(telemetry423Instance, intervalMs);
    res.json(result);
  });

  /* POST /api/v1/chat/route/telemetry/rollup/stop */
  app.post('/api/v1/chat/route/telemetry/rollup/stop', (req, res) => {
    res.json(stopRollupJob424());
  });

  /* GET /api/v1/chat/route/telemetry/rollup/summary */
  app.get('/api/v1/chat/route/telemetry/rollup/summary', (req, res) => {
    res.json({ ok: true, ...getRollupSummary424() });
  });

  /* GET /api/v1/chat/route/telemetry/rollup/hourly */
  app.get('/api/v1/chat/route/telemetry/rollup/hourly', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 24, 168);
    const summary = getRollupSummary424();
    res.json({ ok: true, buckets: summary.hourly.slice(-limit) });
  });

  /* GET /api/v1/chat/route/telemetry/rollup/daily */
  app.get('/api/v1/chat/route/telemetry/rollup/daily', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 90);
    const summary = getRollupSummary424();
    res.json({ ok: true, buckets: summary.daily.slice(-limit) });
  });
}

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    rollupEntries424,
    startRollupJob424,
    stopRollupJob424,
    getRollupSummary424,
    getHourlyKey424,
    getDailyKey424,
    wireCrossSessionTelemetryRollup424,
    _rollupStore424,
  };
} else {
  module.exports = {
    rollupEntries424,
    startRollupJob424,
    stopRollupJob424,
    getRollupSummary424,
    wireCrossSessionTelemetryRollup424,
  };
}
