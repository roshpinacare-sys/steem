'use strict';
/**
 * rollupDiffApi425.js — ECOS V425 Feature 5
 * Exposes endpoint comparing two daily/hourly rollup buckets, showing
 * intent share drift and latency change.
 * R1: sacred files untouched. R2: all identifiers end in 425. R3: no new npm deps.
 */

const ROLLUP_DIFF_VERSION425 = '425.0.0';

/**
 * diffRollupBuckets425(bucketA, bucketB) — computes per-intent share drift
 * and latency delta between two rollup buckets.
 *
 * @param {{intents: Object, totalCount: number, p95Latency?: number, avgLatency?: number}} bucketA
 * @param {{intents: Object, totalCount: number, p95Latency?: number, avgLatency?: number}} bucketB
 * @returns {Object} diff result
 */
function diffRollupBuckets425(bucketA, bucketB) {
  if (!bucketA || !bucketB) throw new Error('Both bucketA and bucketB are required');

  const totalA = bucketA.totalCount || 1;
  const totalB = bucketB.totalCount || 1;

  const intentsA = bucketA.intents || {};
  const intentsB = bucketB.intents || {};

  const allIntents = new Set([...Object.keys(intentsA), ...Object.keys(intentsB)]);
  const intentDiffs = {};

  for (const intent of allIntents) {
    const countA = intentsA[intent] || 0;
    const countB = intentsB[intent] || 0;
    const shareA = countA / totalA;
    const shareB = countB / totalB;
    const shareDrift = shareB - shareA;
    intentDiffs[intent] = {
      countA,
      countB,
      shareA: parseFloat(shareA.toFixed(4)),
      shareB: parseFloat(shareB.toFixed(4)),
      shareDrift: parseFloat(shareDrift.toFixed(4)),
      shareDriftPct: parseFloat((shareDrift * 100).toFixed(2)),
      direction: shareDrift > 0 ? 'up' : shareDrift < 0 ? 'down' : 'flat',
    };
  }

  const latencyA = bucketA.p95Latency || bucketA.avgLatency || 0;
  const latencyB = bucketB.p95Latency || bucketB.avgLatency || 0;
  const latencyDelta = latencyB - latencyA;
  const latencyDeltaPct = latencyA > 0 ? ((latencyDelta / latencyA) * 100) : 0;

  const totalCountDelta = totalB - totalA;

  return {
    ok: true,
    version: ROLLUP_DIFF_VERSION425,
    summary: {
      totalCountA: totalA,
      totalCountB: totalB,
      totalCountDelta,
      latencyA: parseFloat(latencyA.toFixed(2)),
      latencyB: parseFloat(latencyB.toFixed(2)),
      latencyDelta: parseFloat(latencyDelta.toFixed(2)),
      latencyDeltaPct: parseFloat(latencyDeltaPct.toFixed(2)),
      intentCount: allIntents.size,
    },
    intentDiffs,
  };
}

/**
 * findBucket425(rollupStore, granularity, key) — locate a bucket by key
 * ('YYYY-MM-DD' for daily, 'YYYY-MM-DDTHH' for hourly).
 */
function findBucket425(rollupStore, granularity, key) {
  const map = granularity === 'hourly' ? rollupStore.hourly : rollupStore.daily;
  if (!map) return null;
  if (map instanceof Map) return map.get(key) || null;
  return map[key] || null;
}

/**
 * wireRollupDiffApi425(app, rollupStore424) — mounts diff endpoints.
 * rollupStore424 is the _rollupStore424 or an equivalent with .hourly/.daily Maps.
 */
function wireRollupDiffApi425(app, rollupStore424) {
  /* GET /api/v1/chat/route/telemetry/rollup/diff
   * Query params: granularity=daily|hourly, keyA=..., keyB=...
   */
  app.get('/api/v1/chat/route/telemetry/rollup/diff', (req, res) => {
    try {
      const { granularity = 'daily', keyA, keyB } = req.query;
      if (!keyA || !keyB) {
        return res.status(400).json({ ok: false, error: 'keyA and keyB required', ecosVersion: 'V425' });
      }
      if (!['daily', 'hourly'].includes(granularity)) {
        return res.status(400).json({ ok: false, error: 'granularity must be daily or hourly', ecosVersion: 'V425' });
      }

      let store = rollupStore424;
      if (!store || (!store.hourly && !store.daily)) {
        return res.status(503).json({ ok: false, error: 'rollup store unavailable', ecosVersion: 'V425' });
      }

      const bA = findBucket425(store, granularity, keyA);
      const bB = findBucket425(store, granularity, keyB);

      if (!bA) return res.status(404).json({ ok: false, error: `bucket not found: ${keyA}`, ecosVersion: 'V425' });
      if (!bB) return res.status(404).json({ ok: false, error: `bucket not found: ${keyB}`, ecosVersion: 'V425' });

      const diff = diffRollupBuckets425(bA, bB);
      res.json({ ok: true, ecosVersion: 'V425', granularity, keyA, keyB, ...diff });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });

  /* POST /api/v1/chat/route/telemetry/rollup/diff — accepts buckets directly in body */
  app.post('/api/v1/chat/route/telemetry/rollup/diff', (req, res) => {
    try {
      const { bucketA, bucketB, granularity = 'daily', keyA, keyB } = req.body || {};

      // If buckets provided inline, diff them directly
      if (bucketA && bucketB) {
        const diff = diffRollupBuckets425(bucketA, bucketB);
        return res.json({ ok: true, ecosVersion: 'V425', granularity, keyA, keyB, ...diff });
      }

      // Fall back to store lookup
      if (!keyA || !keyB) {
        return res.status(400).json({ ok: false, error: 'bucketA+bucketB or keyA+keyB required', ecosVersion: 'V425' });
      }
      const store = rollupStore424;
      if (!store) return res.status(503).json({ ok: false, error: 'rollup store unavailable', ecosVersion: 'V425' });

      const bA = findBucket425(store, granularity, keyA);
      const bB = findBucket425(store, granularity, keyB);
      if (!bA) return res.status(404).json({ ok: false, error: `bucket not found: ${keyA}`, ecosVersion: 'V425' });
      if (!bB) return res.status(404).json({ ok: false, error: `bucket not found: ${keyB}`, ecosVersion: 'V425' });

      const diff = diffRollupBuckets425(bA, bB);
      res.json({ ok: true, ecosVersion: 'V425', granularity, keyA, keyB, ...diff });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });

  /* GET /api/v1/chat/route/telemetry/rollup/diff/available — list available bucket keys */
  app.get('/api/v1/chat/route/telemetry/rollup/diff/available', (req, res) => {
    try {
      const store = rollupStore424;
      if (!store) return res.status(503).json({ ok: false, error: 'rollup store unavailable', ecosVersion: 'V425' });
      const granularity = req.query.granularity || 'daily';
      const map = granularity === 'hourly' ? store.hourly : store.daily;
      const keys = map instanceof Map ? [...map.keys()].sort() : Object.keys(map || {}).sort();
      res.json({ ok: true, ecosVersion: 'V425', granularity, count: keys.length, keys });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });
}

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    diffRollupBuckets425,
    findBucket425,
    wireRollupDiffApi425,
    ROLLUP_DIFF_VERSION425,
  };
} else {
  module.exports = {
    diffRollupBuckets425,
    findBucket425,
    wireRollupDiffApi425,
    ROLLUP_DIFF_VERSION425,
  };
}
