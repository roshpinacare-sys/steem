'use strict';
/**
 * src/lib/rollbackRehearsalScheduler434.js — ECOS V434
 *
 * Feature 3: Rollback rehearsal scheduler
 * Periodic automated dry-runs. Builds on rollbackDryRun433.
 *
 * @version 434.0.0
 */

const ROLLBACK_REHEARSAL_SCHEDULER_VERSION434 = '434.0.0';

const _rehearsalState434 = {
  scheduled: false,
  intervalMs: 0,
  runs: 0,
  lastRunAt: null,
  lastResults: [],
};

let _timer434 = null;

function rehearse434(rotationIds, history) {
  let dr;
  try { dr = require('./rollbackDryRun433.js'); } catch (_) { dr = null; }
  const results = (rotationIds || []).map(id =>
    dr ? dr.dryRunRollback433(id, history) : { ok: false, rotationId: id, error: 'dryRun unavailable' }
  );
  _rehearsalState434.runs += 1;
  _rehearsalState434.lastRunAt = new Date().toISOString();
  _rehearsalState434.lastResults = results;
  return { ok: true, count: results.length, results };
}

function schedule434(intervalMs, fetchFn) {
  if (_timer434) clearInterval(_timer434);
  _rehearsalState434.scheduled = true;
  _rehearsalState434.intervalMs = intervalMs;
  if (process.env.NODE_ENV === 'test') return { ok: true, scheduled: true, intervalMs };
  _timer434 = setInterval(() => {
    try {
      const { rotationIds, history } = (fetchFn && fetchFn()) || {};
      rehearse434(rotationIds || [], history || []);
    } catch (_) {}
  }, intervalMs);
  return { ok: true, scheduled: true, intervalMs };
}

function stop434() {
  if (_timer434) clearInterval(_timer434);
  _timer434 = null;
  _rehearsalState434.scheduled = false;
  return { ok: true, stopped: true };
}

function wireRollbackRehearsalScheduler434(app, opts, auditLog) {
  const BASE434 = '/api/v1/solvency/tower/auth/keys/bulk/rotate/rollback/dryrun/rehearse';

  app.post(BASE434, (req, res) => {
    const { rotationIds, history } = req.body || {};
    res.json(rehearse434(rotationIds, history));
  });

  app.post(BASE434 + '/schedule', (req, res) => {
    const { intervalMs } = req.body || {};
    res.json(schedule434(intervalMs || 3600000, null));
  });

  app.post(BASE434 + '/stop', (req, res) => res.json(stop434()));

  app.get(BASE434 + '/status', (req, res) => {
    res.json({ version: ROLLBACK_REHEARSAL_SCHEDULER_VERSION434, ..._rehearsalState434 });
  });
}

module.exports = {
  ROLLBACK_REHEARSAL_SCHEDULER_VERSION434,
  rehearse434,
  schedule434,
  stop434,
  wireRollbackRehearsalScheduler434,
  _rehearsalState434,
};
