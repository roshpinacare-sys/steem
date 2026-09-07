'use strict';
  /**
   * dashboardTrendAnalysis426.js — ECOS V426 Feature 1
   * Compares consecutive dashboard render snapshots to surface emerging intent
   * patterns over time (e.g. week-over-week intent share shifts).
   * R1: sacred files untouched. R2: all identifiers end in 426. R3: no new npm deps.
   */

  const { createHash } = require('crypto');

  const DASHBOARD_TREND_VERSION426 = '426.0.0';
  const MAX_TREND_SNAPSHOTS426 = 500;

  const _trendStore426 = {
    snapshots: [],
    stats: {
      snapshotsAdded: 0,
      analysesRun: 0,
      version: DASHBOARD_TREND_VERSION426,
    },
  };

  /**
   * addTrendSnapshot426(snapshot) — record a render snapshot for trend analysis.
   * snapshot: { ts, intents: { [intent]: count }, totalEntries, label? }
   */
  function addTrendSnapshot426(snapshot, auditLog = null) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('snapshot must be an object');
    if (!snapshot.intents || typeof snapshot.intents !== 'object') throw new Error('snapshot.intents required');

    const record = {
      id426: createHash('sha256').update(JSON.stringify(snapshot) + Date.now()).digest('hex').slice(0, 16),
      ts: snapshot.ts || new Date().toISOString(),
      intents: snapshot.intents,
      totalEntries: snapshot.totalEntries || Object.values(snapshot.intents).reduce((a, b) => a + b, 0),
      label: snapshot.label || null,
    };

    _trendStore426.snapshots.push(record);
    if (_trendStore426.snapshots.length > MAX_TREND_SNAPSHOTS426) {
      _trendStore426.snapshots.shift();
    }
    _trendStore426.stats.snapshotsAdded++;

    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('dashboard.trend.snapshot426', { id426: record.id426, ts: record.ts });
    }
    return { ok: true, id426: record.id426, ts: record.ts };
  }

  /**
   * analyzeTrend426(snapshotA, snapshotB) — compute per-intent share shift between two snapshots.
   */
  function analyzeTrend426(snapshotA, snapshotB) {
    if (!snapshotA || !snapshotB) throw new Error('Both snapshotA and snapshotB required');

    const totalA = snapshotA.totalEntries || Object.values(snapshotA.intents || {}).reduce((a, b) => a + b, 1);
    const totalB = snapshotB.totalEntries || Object.values(snapshotB.intents || {}).reduce((a, b) => a + b, 1);

    const intentsA = snapshotA.intents || {};
    const intentsB = snapshotB.intents || {};
    const allIntents = new Set([...Object.keys(intentsA), ...Object.keys(intentsB)]);

    const intentShifts = {};
    for (const intent of allIntents) {
      const countA = intentsA[intent] || 0;
      const countB = intentsB[intent] || 0;
      const shareA = totalA > 0 ? countA / totalA : 0;
      const shareB = totalB > 0 ? countB / totalB : 0;
      const shift = shareB - shareA;
      intentShifts[intent] = {
        countA,
        countB,
        shareA: parseFloat(shareA.toFixed(4)),
        shareB: parseFloat(shareB.toFixed(4)),
        shift: parseFloat(shift.toFixed(4)),
        shiftPct: parseFloat((shift * 100).toFixed(2)),
        trend: shift > 0.01 ? 'rising' : shift < -0.01 ? 'declining' : 'stable',
      };
    }

    const emerging = Object.entries(intentShifts)
      .filter(([, v]) => v.trend === 'rising')
      .sort((a, b) => b[1].shift - a[1].shift)
      .map(([k]) => k);

    const declining = Object.entries(intentShifts)
      .filter(([, v]) => v.trend === 'declining')
      .sort((a, b) => a[1].shift - b[1].shift)
      .map(([k]) => k);

    _trendStore426.stats.analysesRun++;

    return {
      ok: true,
      version: DASHBOARD_TREND_VERSION426,
      fromTs: snapshotA.ts,
      toTs: snapshotB.ts,
      totalCountA: totalA,
      totalCountB: totalB,
      intentShifts,
      emerging,
      declining,
      intentCount: allIntents.size,
    };
  }

  /**
   * getStoredSnapshots426(opts) — retrieve stored snapshots, optionally filtered.
   */
  function getStoredSnapshots426(opts = {}) {
    let snaps = [..._trendStore426.snapshots];
    if (opts.fromTs) {
      const from = new Date(opts.fromTs).getTime();
      snaps = snaps.filter(s => new Date(s.ts).getTime() >= from);
    }
    if (opts.toTs) {
      const to = new Date(opts.toTs).getTime();
      snaps = snaps.filter(s => new Date(s.ts).getTime() <= to);
    }
    if (opts.label) {
      snaps = snaps.filter(s => s.label === opts.label);
    }
    const limit = parseInt(opts.limit, 10) || 50;
    return snaps.slice(-limit);
  }

  /**
   * compareConsecutive426(n) — analyse trend across the last N consecutive snapshots.
   * Returns an array of pairwise diffs.
   */
  function compareConsecutive426(n = 2) {
    const count = Math.max(2, Math.min(parseInt(n, 10) || 2, 50));
    const recent = _trendStore426.snapshots.slice(-count);
    if (recent.length < 2) return { ok: false, error: 'Not enough snapshots', count: recent.length };

    const diffs = [];
    for (let i = 0; i < recent.length - 1; i++) {
      diffs.push(analyzeTrend426(recent[i], recent[i + 1]));
    }
    return { ok: true, version: DASHBOARD_TREND_VERSION426, pairCount: diffs.length, diffs };
  }

  function getTrendStats426() {
    return {
      version: DASHBOARD_TREND_VERSION426,
      snapshotCount: _trendStore426.snapshots.length,
      ..._trendStore426.stats,
    };
  }

  function wireDashboardTrendAnalysis426(app, auditLog = null) {
    /* POST /api/v1/chat/route/telemetry/dashboard/trend/snapshot */
    app.post('/api/v1/chat/route/telemetry/dashboard/trend/snapshot', (req, res) => {
      try {
        const result = addTrendSnapshot426(req.body || {}, auditLog);
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* POST /api/v1/chat/route/telemetry/dashboard/trend/analyze */
    app.post('/api/v1/chat/route/telemetry/dashboard/trend/analyze', (req, res) => {
      try {
        const { snapshotA, snapshotB } = req.body || {};
        if (!snapshotA || !snapshotB) {
          return res.status(400).json({ ok: false, error: 'snapshotA and snapshotB required', ecosVersion: 'V426' });
        }
        const result = analyzeTrend426(snapshotA, snapshotB);
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* GET /api/v1/chat/route/telemetry/dashboard/trend/snapshots */
    app.get('/api/v1/chat/route/telemetry/dashboard/trend/snapshots', (req, res) => {
      try {
        const snaps = getStoredSnapshots426(req.query);
        res.json({ ok: true, ecosVersion: 'V426', count: snaps.length, snapshots: snaps });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* GET /api/v1/chat/route/telemetry/dashboard/trend/consecutive */
    app.get('/api/v1/chat/route/telemetry/dashboard/trend/consecutive', (req, res) => {
      try {
        const result = compareConsecutive426(req.query.n || 2);
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* GET /api/v1/chat/route/telemetry/dashboard/trend/stats */
    app.get('/api/v1/chat/route/telemetry/dashboard/trend/stats', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V426', ...getTrendStats426() });
    });
  }

  if (process.env.NODE_ENV === 'test') {
    module.exports = {
      addTrendSnapshot426,
      analyzeTrend426,
      getStoredSnapshots426,
      compareConsecutive426,
      getTrendStats426,
      wireDashboardTrendAnalysis426,
      DASHBOARD_TREND_VERSION426,
      _trendStore426,
    };
  } else {
    module.exports = {
      addTrendSnapshot426,
      analyzeTrend426,
      getStoredSnapshots426,
      compareConsecutive426,
      getTrendStats426,
      wireDashboardTrendAnalysis426,
      DASHBOARD_TREND_VERSION426,
    };
  }
  