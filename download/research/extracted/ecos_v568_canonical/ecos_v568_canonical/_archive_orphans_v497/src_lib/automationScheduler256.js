'use strict';
/**
 * src/lib/automationScheduler256.js — ECOS V256 (Phase P152)
 *
 * Simple in-memory cron-like scheduler for the automation catalog.
 * Reads `schedule` automations from catalog254, parses a `cron` or `intervalMs`
 * from recipe.source metadata, and calls triggerIntake255 automatically.
 * Max 100 scheduled automations.
 *
 * Design:
 *   - Pure in-memory, no npm deps (R6).
 *   - Uses setInterval / clearInterval internally — injectable for testing.
 *   - Stores next-run timestamps per automationId.
 *   - Simple cron parser: supports "*/N * * * *" (every N minutes),
 *     "0 */H * * *" (every H hours), and "@every <ms>" shorthand.
 *   - listScheduled256() returns current schedule state.
 *   - stop256() cancels all intervals.
 *
 * @version 256.0.0
 */

const SCHEDULER_MAX_AUTOMATIONS_256 = 100;

class SchedulerError256 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'SchedulerError256';
    this.code = code || 'SCHEDULER_ERROR';
    this.statusCode = 400;
  }
}

/**
 * Parse a cron string or intervalMs from a recipe source string.
 * Supported patterns:
 *   - `intervalMs:30000`  → 30 seconds
 *   - `@every 30000`      → 30 seconds
 *   - `*/5 * * * *`       → every 5 minutes (300000ms)
 *   - `0 */2 * * *`       → every 2 hours (7200000ms)
 *
 * @param {string} source
 * @returns {number|null}  interval in milliseconds, or null if not parseable
 */
function _parseIntervalMs256(source) {
  if (!source || typeof source !== 'string') return null;

  // intervalMs:NNN
  const im = source.match(/\bintervalMs:(\d+)\b/);
  if (im) {
    const ms = parseInt(im[1], 10);
    return ms >= 1000 ? ms : null;
  }

  // @every NNN
  const ev = source.match(/@every\s+(\d+)/);
  if (ev) {
    const ms = parseInt(ev[1], 10);
    return ms >= 1000 ? ms : null;
  }

  // Simple cron: */N * * * *  (every N minutes)
  const cronMin = source.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (cronMin) {
    const mins = parseInt(cronMin[1], 10);
    return mins >= 1 ? mins * 60 * 1000 : null;
  }

  // Simple cron: 0 */H * * *  (every H hours)
  const cronHr = source.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (cronHr) {
    const hrs = parseInt(cronHr[1], 10);
    return hrs >= 1 ? hrs * 60 * 60 * 1000 : null;
  }

  return null;
}

/**
 * Create an AutomationScheduler256 instance.
 *
 * @param {object} opts
 * @param {object}   opts.catalog254      - automationCatalog254 instance
 * @param {object}   opts.toolCatalog237  - ToolCatalog237 instance
 * @param {function} opts.triggerIntake255 - triggerIntake255 function from automationRunner255
 * @param {object}   [opts.ctx]           - default ctx forwarded to each run
 * @param {function} [opts.audit]         - audit(ev) callback
 * @param {object}   [opts.timers]        - injectable { setInterval, clearInterval } for testing
 * @returns {object}  scheduler instance
 */
function createAutomationScheduler256(opts = {}) {
  const { catalog254, toolCatalog237, triggerIntake255, ctx = {}, audit = () => {} } = opts;
  const timers256 = opts.timers || { setInterval, clearInterval };

  if (!catalog254 || typeof catalog254.list !== 'function') throw new SchedulerError256('catalog254 required', 'NO_CATALOG');
  if (!triggerIntake255 || typeof triggerIntake255 !== 'function') throw new SchedulerError256('triggerIntake255 required', 'NO_TRIGGER_FN');

  // Map: automationId → { intervalMs, nextRunAt, lastRunAt, runCount, handle }
  const _scheduled256 = new Map();
  let _running256 = false;

  /**
   * Load all `schedule` automations from catalog and start intervals.
   * Idempotent: existing schedules are replaced if source changed.
   */
  function start256() {
    if (_running256) return { ok: false, reason: 'already_running' };
    _running256 = true;

    const scheduleItems = catalog254.list({ trigger: 'schedule' });

    let loaded256 = 0;
    let skipped256 = 0;

    for (const item of scheduleItems) {
      if (_scheduled256.size >= SCHEDULER_MAX_AUTOMATIONS_256) { skipped256++; continue; }

      const intervalMs = _parseIntervalMs256(item.source || '');
      if (!intervalMs) { skipped256++; continue; }

      const entry256 = {
        automationId: item.id,
        name: item.name,
        intervalMs,
        nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
        lastRunAt: null,
        runCount: 0,
        error: null,
        handle: null,
      };

      entry256.handle = timers256.setInterval(async () => {
        entry256.lastRunAt = new Date().toISOString();
        entry256.runCount++;
        entry256.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
        try {
          await triggerIntake255({
            catalog: catalog254,
            toolCatalog: toolCatalog237,
            triggerType: 'schedule',
            ctx: { ...ctx, schedulerRunId256: item.id + '-' + Date.now() },
            audit,
          });
          entry256.error = null;
          audit({ action: 'scheduler_tick256', automationId: item.id, runCount: entry256.runCount });
        } catch (e) {
          entry256.error = e.message;
          audit({ action: 'scheduler_tick_error256', automationId: item.id, error: e.message });
        }
      }, intervalMs);

      _scheduled256.set(item.id, entry256);
      loaded256++;
    }

    audit({ action: 'scheduler_started256', loaded: loaded256, skipped: skipped256 });
    return { ok: true, loaded: loaded256, skipped: skipped256 };
  }

  /**
   * Stop all scheduled intervals.
   */
  function stop256() {
    for (const entry of _scheduled256.values()) {
      if (entry.handle != null) {
        timers256.clearInterval(entry.handle);
        entry.handle = null;
      }
    }
    _running256 = false;
    audit({ action: 'scheduler_stopped256', count: _scheduled256.size });
    return { ok: true, stopped: _scheduled256.size };
  }

  /**
   * List current scheduled automations and their state.
   * @returns {Array<{automationId, name, intervalMs, nextRunAt, lastRunAt, runCount, error}>}
   */
  function listScheduled256() {
    return [..._scheduled256.values()].map(e => ({
      automationId: e.automationId,
      name:         e.name,
      intervalMs:   e.intervalMs,
      nextRunAt:    e.nextRunAt,
      lastRunAt:    e.lastRunAt,
      runCount:     e.runCount,
      error:        e.error,
      active:       e.handle != null,
    }));
  }

  /**
   * Stats snapshot.
   */
  function stats256() {
    return {
      running: _running256,
      scheduled: _scheduled256.size,
      maxAllowed: SCHEDULER_MAX_AUTOMATIONS_256,
      entries: listScheduled256(),
    };
  }

  return { start256, stop256, listScheduled256, stats256, _parseIntervalMs256 };
}

module.exports = {
  createAutomationScheduler256,
  SCHEDULER_MAX_AUTOMATIONS_256,
  SchedulerError256,
  _parseIntervalMs256,
};
