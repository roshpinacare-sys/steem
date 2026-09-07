'use strict';
/**
 * src/lib/automationScheduler257.js — ECOS V257 (Phase P153)
 *
 * Supersedes automationScheduler256. Key upgrades:
 *   P153-B  Persistent scheduler state — on start257(), reload previous scheduler
 *           configuration from snapshotEngine so scheduled automations survive
 *           server reboots without a manual /start call.
 *   P153-C  Full 5-field cron support — delegates to cronParser257.parseCronExpression257
 *           for any expression not matched by the legacy V256 shortcuts. The legacy
 *           shorthand patterns (intervalMs:NNN, @every NNN, STAR/N STAR STAR STAR STAR, 0 STAR/H STAR STAR STAR)
 *           still work unchanged.
 *
 * Design:
 *   - Pure in-memory, no npm deps (R6).
 *   - All new identifiers suffixed with 257.
 *   - snapshotEngine is optional — if absent, persistence is skipped (graceful degradation).
 *   - setInterval / clearInterval injectable for tests.
 *
 * Exports:
 *   createAutomationScheduler257(opts) → scheduler instance
 *   SCHEDULER_MAX_AUTOMATIONS_257      → 100
 *   SchedulerError257
 *   parseCronOrInterval257(source)     → { type:'interval'|'cron', intervalMs, expr? } | null
 *
 * @version 257.0.0
 */

const { parseCronExpression257, nextCronFireMs257 } = require('./cronParser257.js');

const SCHEDULER_MAX_AUTOMATIONS_257 = 100;
const SCHEDULER_SNAPSHOT_KEY_257    = 'scheduler257_config';

class SchedulerError257 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'SchedulerError257';
    this.code = code || 'SCHEDULER_ERROR';
    this.statusCode = 400;
  }
}

// ── Source parser ─────────────────────────────────────────────────────────────

/**
 * Parse a recipe source string into a usable schedule descriptor.
 *
 * Returns:
 *   { type:'interval', intervalMs }        — simple repeating interval
 *   { type:'cron',    expr, intervalMs }   — cron expression + estimated interval
 *   null                                   — not parseable
 *
 * @param {string} source
 * @returns {{ type:string, intervalMs:number, expr?:string }|null}
 */
function parseCronOrInterval257(source) {
  if (!source || typeof source !== 'string') return null;

  // ── Legacy V256 patterns (preserved verbatim) ────────────────────────────

  // intervalMs:NNN
  const im = source.match(/\bintervalMs:(\d+)\b/);
  if (im) {
    const ms = parseInt(im[1], 10);
    if (ms >= 1000) return { type: 'interval', intervalMs: ms };
  }

  // @every NNN
  const ev = source.match(/@every\s+(\d+)/);
  if (ev) {
    const ms = parseInt(ev[1], 10);
    if (ms >= 1000) return { type: 'interval', intervalMs: ms };
  }

  // Simple cron shortcuts from V256 (still handled for back-compat):
  const cronMin = source.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (cronMin) {
    const mins = parseInt(cronMin[1], 10);
    if (mins >= 1) return { type: 'interval', intervalMs: mins * 60 * 1000 };
  }

  const cronHr = source.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (cronHr) {
    const hrs = parseInt(cronHr[1], 10);
    if (hrs >= 1) return { type: 'interval', intervalMs: hrs * 60 * 60 * 1000 };
  }

  // ── Full 5-field cron (P153-C) ────────────────────────────────────────────
  // Try to extract a 5-field cron token from the source string.
  // Supports expressions embedded anywhere in source (e.g. "cron: 0 9 * * 1-5")
  const cronMatch = source.match(/(?:^|cron[:\s]+?)(\S+\s+\S+\s+\S+\s+\S+\s+\S+\s*$)/i);
  if (cronMatch) {
    const expr = cronMatch[1].trim();
    const parsed = parseCronExpression257(expr);
    if (parsed.ok) {
      // Estimate next fire time for reference (scheduler uses setTimeout per tick)
      const nextMs = nextCronFireMs257(expr) || 60 * 1000;
      return { type: 'cron', expr, intervalMs: nextMs };
    }
  }

  // Last attempt: treat the whole trimmed string as a bare cron expression
  const trimmed = source.trim();
  if (trimmed.split(/\s+/).length === 5) {
    const parsed = parseCronExpression257(trimmed);
    if (parsed.ok) {
      const nextMs = nextCronFireMs257(trimmed) || 60 * 1000;
      return { type: 'cron', expr: trimmed, intervalMs: nextMs };
    }
  }

  return null;
}

// ── Scheduler factory ─────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {object}   opts.catalog254        - automationCatalog254 instance (.get, .list, .register)
 * @param {object}   opts.toolCatalog237    - ToolCatalog237 instance (.getRunner237)
 * @param {function} opts.triggerIntake255  - triggerIntake255(opts) → Promise
 * @param {object}   [opts.snapshotEngine]  - optional snapshotEngine for persistent state
 * @param {object}   [opts.ctx]             - default ctx forwarded to each run
 * @param {function} [opts.audit]           - audit(ev) callback
 * @param {object}   [opts.timers]          - injectable { setInterval, clearInterval, setTimeout, clearTimeout }
 * @returns {object}  scheduler instance with start257/stop257/listScheduled257/stats257
 */
function createAutomationScheduler257(opts = {}) {
  const { catalog254, toolCatalog237, triggerIntake255, ctx = {}, audit = () => {} } = opts;
  const snap257   = opts.snapshotEngine || null;
  const timers257 = opts.timers || { setInterval, clearInterval, setTimeout, clearTimeout };

  if (!catalog254 || typeof catalog254.list !== 'function')
    throw new SchedulerError257('catalog254 required', 'NO_CATALOG');
  if (!triggerIntake255 || typeof triggerIntake255 !== 'function')
    throw new SchedulerError257('triggerIntake255 required', 'NO_TRIGGER_FN');

  // Map: automationId → entry257
  const _scheduled257 = new Map();
  let _running257 = false;

  // ── Persistence helpers ──────────────────────────────────────────────────

  function _saveState257() {
    if (!snap257 || typeof snap257.setExtra !== 'function') return;
    try {
      const state = [..._scheduled257.values()].map(e => ({
        automationId: e.automationId,
        descriptor:   e.descriptor,
        name:         e.name,
        lastRunAt:    e.lastRunAt,
        runCount:     e.runCount,
      }));
      snap257.setExtra(SCHEDULER_SNAPSHOT_KEY_257, state);
    } catch (_) {}
  }

  function _loadState257() {
    if (!snap257 || typeof snap257.getExtra !== 'function') return [];
    try {
      return snap257.getExtra(SCHEDULER_SNAPSHOT_KEY_257) || [];
    } catch (_) { return []; }
  }

  // ── Scheduling internals ─────────────────────────────────────────────────

  /**
   * Schedule a single automation using either setInterval (for fixed intervals)
   * or recursive setTimeout (for cron expressions, recalculated each tick).
   */
  function _scheduleOne257(automationId, descriptor, name, lastRunAt, runCount) {
    if (_scheduled257.size >= SCHEDULER_MAX_AUTOMATIONS_257) return false;

    const entry257 = {
      automationId,
      descriptor,
      name,
      intervalMs:  descriptor.intervalMs,
      nextRunAt:   null,
      lastRunAt:   lastRunAt || null,
      runCount:    runCount  || 0,
      error:       null,
      handle:      null,
      isCron:      descriptor.type === 'cron',
    };

    let _tickRunning257 = false;
    const _tick257 = async () => {
      // Guard: prevent re-entrant calls (e.g. when fake timers fire synchronously)
      if (_tickRunning257) return;
      _tickRunning257 = true;

      entry257.lastRunAt = new Date().toISOString();
      entry257.runCount++;

      // Recalculate next fire for cron entries
      if (entry257.isCron) {
        const nextMs = nextCronFireMs257(descriptor.expr);
        entry257.nextRunAt = nextMs != null
          ? new Date(Date.now() + nextMs).toISOString()
          : null;
        // Re-schedule only if scheduler is still running
        if (_running257 && nextMs != null) {
          entry257.handle = timers257.setTimeout(_tick257, nextMs);
        }
      } else {
        entry257.nextRunAt = new Date(Date.now() + descriptor.intervalMs).toISOString();
      }

      try {
        await triggerIntake255({
          catalog:     catalog254,
          toolCatalog: toolCatalog237,
          triggerType: 'schedule',
          ctx:         { ...ctx, schedulerRunId257: automationId + '-' + Date.now() },
          audit,
        });
        entry257.error = null;
        audit({ action: 'scheduler_tick257', automationId, runCount: entry257.runCount, type: descriptor.type });
        _saveState257();
      } catch (e) {
        entry257.error = e.message;
        audit({ action: 'scheduler_tick_error257', automationId, error: e.message });
      } finally {
        _tickRunning257 = false;
      }
    };

    if (descriptor.type === 'cron') {
      const nextMs = nextCronFireMs257(descriptor.expr);
      if (nextMs == null) return false;
      entry257.nextRunAt = new Date(Date.now() + nextMs).toISOString();
      entry257.handle    = timers257.setTimeout(_tick257, nextMs);
    } else {
      entry257.nextRunAt = new Date(Date.now() + descriptor.intervalMs).toISOString();
      entry257.handle    = timers257.setInterval(_tick257, descriptor.intervalMs);
    }

    _scheduled257.set(automationId, entry257);
    return true;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Start the scheduler.
   * 1. Try to reload persisted state from snapshotEngine.
   * 2. Load current `schedule` automations from catalog.
   * 3. Merge — persisted run stats preserved, new entries added.
   */
  function start257() {
    if (_running257) return { ok: false, reason: 'already_running' };
    _running257 = true;

    // Reload persisted state
    const persisted257 = _loadState257();
    const persistedMap = new Map(persisted257.map(e => [e.automationId, e]));

    const scheduleItems = catalog254.list({ trigger: 'schedule' });

    let loaded257 = 0, skipped257 = 0, restored257 = 0;

    for (const item of scheduleItems) {
      if (_scheduled257.size >= SCHEDULER_MAX_AUTOMATIONS_257) { skipped257++; continue; }

      const descriptor = parseCronOrInterval257(item.source || '');
      if (!descriptor) { skipped257++; continue; }

      const prev = persistedMap.get(item.id);
      const ok = _scheduleOne257(item.id, descriptor, item.name,
        prev ? prev.lastRunAt : null,
        prev ? prev.runCount  : 0,
      );

      if (ok) {
        if (prev) restored257++;
        else loaded257++;
      } else {
        skipped257++;
      }
    }

    audit({ action: 'scheduler_started257', loaded: loaded257, restored: restored257, skipped: skipped257 });
    return { ok: true, loaded: loaded257, restored: restored257, skipped: skipped257 };
  }

  /** Stop all scheduled intervals/timeouts. */
  function stop257() {
    for (const entry of _scheduled257.values()) {
      if (entry.handle != null) {
        if (entry.isCron) timers257.clearTimeout(entry.handle);
        else              timers257.clearInterval(entry.handle);
        entry.handle = null;
      }
    }
    _running257 = false;
    _saveState257();
    audit({ action: 'scheduler_stopped257', count: _scheduled257.size });
    return { ok: true, stopped: _scheduled257.size };
  }

  /** List current scheduled automations and their state. */
  function listScheduled257() {
    return [..._scheduled257.values()].map(e => ({
      automationId: e.automationId,
      name:         e.name,
      type:         e.isCron ? 'cron' : 'interval',
      expr:         e.isCron ? e.descriptor.expr : undefined,
      intervalMs:   e.intervalMs,
      nextRunAt:    e.nextRunAt,
      lastRunAt:    e.lastRunAt,
      runCount:     e.runCount,
      error:        e.error,
      active:       e.handle != null,
    }));
  }

  /** Stats snapshot. */
  function stats257() {
    return {
      running:    _running257,
      scheduled:  _scheduled257.size,
      maxAllowed: SCHEDULER_MAX_AUTOMATIONS_257,
      entries:    listScheduled257(),
    };
  }

  return { start257, stop257, listScheduled257, stats257, parseCronOrInterval257 };
}

module.exports = {
  createAutomationScheduler257,
  SCHEDULER_MAX_AUTOMATIONS_257,
  SchedulerError257,
  parseCronOrInterval257,
};
