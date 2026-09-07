'use strict';
/**
 * src/lib/digestScheduler281.js — ECOS Digest Schedule Engine (V281)
 *
 * V281 adds scheduled digest + notification cycles on top of V280:
 *   - registerDigestSchedule281(name, opts) — schedule a recurring digest+notify cycle
 *   - deregisterDigestSchedule281(name)      — remove a schedule
 *   - pauseSchedule281(name)                 — pause without removing
 *   - resumeSchedule281(name)                — resume a paused schedule
 *   - getSchedules281()                      — list all schedules + status
 *   - getScheduleHistory281(opts)            — past run records (capped at 200)
 *   - getStatus281()                         — runtime status
 *   - checkDigestSchedulerHealth281()        — health check
 *   - shutdown281()                          — clear all timers
 *
 * Iron rules: zero new npm deps. All identifiers end in 281. Sacred files untouched.
 */

const crypto = require('node:crypto');

const SCHEDULER_VERSION_281         = '281';
const SCHEDULER_HISTORY_MAX_281     = 200;
const SCHEDULER_SSE_MAX_CLIENTS_281 = 200;
const SCHEDULER_SSE_HEARTBEAT_MS_281 = 30_000;
const SCHEDULER_MIN_INTERVAL_MS_281 = 5_000;

// SSE event names
const SCHED_EVENT_RUN_START_281     = 'SCHEDULE_RUN_START';
const SCHED_EVENT_RUN_COMPLETE_281  = 'SCHEDULE_RUN_COMPLETE';
const SCHED_EVENT_RUN_FAILED_281    = 'SCHEDULE_RUN_FAILED';
const SCHED_EVENT_REGISTERED_281    = 'SCHEDULE_REGISTERED';
const SCHED_EVENT_REMOVED_281       = 'SCHEDULE_REMOVED';
const SCHED_EVENT_PAUSED_281        = 'SCHEDULE_PAUSED';
const SCHED_EVENT_RESUMED_281       = 'SCHEDULE_RESUMED';

// Severity ordering
const SEVERITY_ORDER_281 = { INFO: 0, WARNING: 1, CRITICAL: 2 };

class DigestScheduler281 {
  /**
   * @param {object} opts
   * @param {object} [opts.alertDigest]        — alertDigest279 instance (generateAlertDigest279)
   * @param {object} [opts.notificationChannel] — notificationChannel280 instance (notifyDigest280)
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    this._logger281              = opts.logger              || console;
    this._alertDigest281         = opts.alertDigest         || null;
    this._notificationChannel281 = opts.notificationChannel || null;

    // Schedule registry: Map<name, scheduleConfig>
    this._schedules281 = new Map();

    // Run history (capped at 200)
    this._history281 = [];

    // Timer handles: Map<name, timerHandle>
    this._timers281 = new Map();

    // SSE clients: Map<clientId, res>
    this._sseClients281 = new Map();

    // Heartbeat timer
    this._heartbeatTimer281 = null;

    // Perf ring buffer (last 1000 latencies)
    this._perfLatencies281 = [];
  }

  // ── Schedule Registry ─────────────────────────────────────────────────────

  /**
   * Register a new digest schedule.
   *
   * @param {string} name — unique schedule name
   * @param {object} opts
   * @param {number} opts.intervalMs       — run interval in ms (min 5000)
   * @param {string[]} [opts.channels]     — channel names to notify (empty = all)
   * @param {string} [opts.period]         — digest period label (default: 'scheduled')
   * @param {boolean} [opts.includeResolved] — include resolved alerts in digest (default: false)
   * @param {boolean} [opts.force]         — bypass channel filters on notify (default: false)
   * @param {boolean} [opts.runImmediately] — run once immediately on register (default: false)
   * @returns {{ ok, name, intervalMs, channels, period, paused, registeredAt, version }}
   */
  registerDigestSchedule281(name, opts = {}) {
    const _t0 = Date.now();
    if (!name || typeof name !== 'string')
      return { ok: false, error: 'name must be a non-empty string', version: SCHEDULER_VERSION_281 };

    const intervalMs = Number(opts.intervalMs);
    if (!intervalMs || intervalMs < SCHEDULER_MIN_INTERVAL_MS_281)
      return { ok: false, error: `intervalMs must be >= ${SCHEDULER_MIN_INTERVAL_MS_281}`, version: SCHEDULER_VERSION_281 };

    if (this._schedules281.has(name))
      return { ok: false, error: `schedule '${name}' already registered`, version: SCHEDULER_VERSION_281 };

    const schedule = {
      name,
      intervalMs,
      channels:        Array.isArray(opts.channels) ? opts.channels : [],
      period:          opts.period           || 'scheduled',
      includeResolved: !!opts.includeResolved,
      force:           !!opts.force,
      paused:          false,
      registeredAt:    new Date().toISOString(),
      lastRun:         null,
      runCount:        0,
      failCount:       0,
    };

    this._schedules281.set(name, schedule);
    this._startTimer281(name, intervalMs);

    if (opts.runImmediately) {
      setImmediate(() => this._runSchedule281(name).catch(() => {}));
    }

    this._broadcastSse281({ type: SCHED_EVENT_REGISTERED_281, name, intervalMs, ts: new Date().toISOString() });
    this._recordPerf281(Date.now() - _t0);

    return {
      ok:              true,
      name,
      intervalMs,
      channels:        schedule.channels,
      period:          schedule.period,
      includeResolved: schedule.includeResolved,
      force:           schedule.force,
      paused:          false,
      registeredAt:    schedule.registeredAt,
      version:         SCHEDULER_VERSION_281,
    };
  }

  /**
   * Remove a registered schedule and cancel its timer.
   * @param {string} name
   * @returns {{ ok, name, version }}
   */
  deregisterDigestSchedule281(name) {
    if (!this._schedules281.has(name))
      return { ok: false, error: `schedule '${name}' not found`, version: SCHEDULER_VERSION_281 };

    this._clearTimer281(name);
    this._schedules281.delete(name);
    this._broadcastSse281({ type: SCHED_EVENT_REMOVED_281, name, ts: new Date().toISOString() });

    return { ok: true, name, version: SCHEDULER_VERSION_281 };
  }

  /**
   * Pause a running schedule (timer cancelled; config preserved).
   * @param {string} name
   * @returns {{ ok, name, paused, version }}
   */
  pauseSchedule281(name) {
    const schedule = this._schedules281.get(name);
    if (!schedule)
      return { ok: false, error: `schedule '${name}' not found`, version: SCHEDULER_VERSION_281 };
    if (schedule.paused)
      return { ok: false, error: `schedule '${name}' is already paused`, version: SCHEDULER_VERSION_281 };

    this._clearTimer281(name);
    schedule.paused = true;
    this._broadcastSse281({ type: SCHED_EVENT_PAUSED_281, name, ts: new Date().toISOString() });

    return { ok: true, name, paused: true, version: SCHEDULER_VERSION_281 };
  }

  /**
   * Resume a paused schedule.
   * @param {string} name
   * @returns {{ ok, name, paused, version }}
   */
  resumeSchedule281(name) {
    const schedule = this._schedules281.get(name);
    if (!schedule)
      return { ok: false, error: `schedule '${name}' not found`, version: SCHEDULER_VERSION_281 };
    if (!schedule.paused)
      return { ok: false, error: `schedule '${name}' is not paused`, version: SCHEDULER_VERSION_281 };

    schedule.paused = false;
    this._startTimer281(name, schedule.intervalMs);
    this._broadcastSse281({ type: SCHED_EVENT_RESUMED_281, name, ts: new Date().toISOString() });

    return { ok: true, name, paused: false, version: SCHEDULER_VERSION_281 };
  }

  /**
   * List all registered schedules.
   * @returns {{ ok, schedules, total, version }}
   */
  getSchedules281() {
    const schedules = [];
    for (const s of this._schedules281.values()) {
      schedules.push({ ...s });
    }
    return { ok: true, schedules, total: schedules.length, version: SCHEDULER_VERSION_281 };
  }

  /**
   * Get past run records.
   * @param {object} [opts]
   * @param {string} [opts.since]    — ISO timestamp; only records after this
   * @param {number} [opts.limit]    — max results (default 20)
   * @param {string} [opts.schedule] — filter by schedule name
   * @returns {{ ok, runs, total, version }}
   */
  getScheduleHistory281(opts = {}) {
    const since    = opts.since    ? new Date(opts.since).getTime() : 0;
    const limit    = Math.min(Number(opts.limit) || 20, SCHEDULER_HISTORY_MAX_281);
    const nameFilter = opts.schedule || null;

    let runs = this._history281;
    if (since)      runs = runs.filter(r => new Date(r.ts).getTime() > since);
    if (nameFilter) runs = runs.filter(r => r.name === nameFilter);
    runs = runs.slice(-limit);

    return { ok: true, runs, total: runs.length, version: SCHEDULER_VERSION_281 };
  }

  /**
   * Runtime status.
   * @returns {{ ok, version, activeSchedules, pausedSchedules, totalRuns, sseClients }}
   */
  getStatus281() {
    let active = 0, paused = 0;
    for (const s of this._schedules281.values()) {
      s.paused ? paused++ : active++;
    }
    return {
      ok:               true,
      version:          SCHEDULER_VERSION_281,
      activeSchedules:  active,
      pausedSchedules:  paused,
      totalRuns:        this._history281.length,
      sseClients:       this._sseClients281.size,
    };
  }

  /**
   * Health check.
   */
  checkDigestSchedulerHealth281() {
    return {
      ok:               true,
      version:          SCHEDULER_VERSION_281,
      activeSchedules:  [...this._schedules281.values()].filter(s => !s.paused).length,
      pausedSchedules:  [...this._schedules281.values()].filter(s => s.paused).length,
      totalRuns:        this._history281.length,
      pendingTimers:    this._timers281.size,
      sseClients:       this._sseClients281.size,
    };
  }

  /**
   * Perf percentiles from the ring buffer.
   */
  getPerf281() {
    const lats = this._perfLatencies281.slice().sort((a, b) => a - b);
    const count = lats.length;
    if (!count) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const p = (pct) => lats[Math.floor((pct / 100) * count)] || 0;
    return { p50: p(50), p95: p(95), p99: p(99), count };
  }

  // ── SSE ───────────────────────────────────────────────────────────────────

  /**
   * Add an SSE client (Express res object).
   * @param {object} res
   * @returns {string|null} clientId or null if at max
   */
  addScheduleSseClient281(res) {
    if (this._sseClients281.size >= SCHEDULER_SSE_MAX_CLIENTS_281) {
      res.status(503).json({ ok: false, error: 'SSE client limit reached', version: SCHEDULER_VERSION_281 });
      return null;
    }
    const clientId = crypto.randomUUID();
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    // Send current schedules as initial event
    const scheduleList = [];
    for (const s of this._schedules281.values()) scheduleList.push({ ...s });
    res.write(`data: ${JSON.stringify({ type: 'schedules', schedules: scheduleList, version: SCHEDULER_VERSION_281 })}\n\n`);

    this._sseClients281.set(clientId, res);
    this._ensureHeartbeat281();
    return clientId;
  }

  /**
   * Remove an SSE client by ID.
   * @param {string} clientId
   */
  removeScheduleSseClient281(clientId) {
    const res = this._sseClients281.get(clientId);
    if (res) {
      try { res.end(); } catch (_) {}
      this._sseClients281.delete(clientId);
    }
    if (this._sseClients281.size === 0) this._stopHeartbeat281();
  }

  /**
   * Clear all timers, close all SSE clients, stop heartbeat.
   */
  shutdown281() {
    for (const name of this._timers281.keys()) this._clearTimer281(name);
    this._stopHeartbeat281();
    for (const [id] of this._sseClients281) this.removeScheduleSseClient281(id);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _startTimer281(name, intervalMs) {
    this._clearTimer281(name);
    const handle = setInterval(() => this._runSchedule281(name).catch(() => {}), intervalMs);
    if (handle.unref) handle.unref();
    this._timers281.set(name, handle);
  }

  _clearTimer281(name) {
    const handle = this._timers281.get(name);
    if (handle) { clearInterval(handle); this._timers281.delete(name); }
  }

  async _runSchedule281(name) {
    const schedule = this._schedules281.get(name);
    if (!schedule || schedule.paused) return;

    const runId = crypto.randomUUID();
    const runTs = new Date().toISOString();
    const _t0   = Date.now();

    this._broadcastSse281({ type: SCHED_EVENT_RUN_START_281, name, runId, ts: runTs });

    let digestResult = null;
    let notifyResult = null;
    let error = null;

    try {
      if (!this._alertDigest281) throw new Error('alertDigest not wired');
      digestResult = this._alertDigest281.generateAlertDigest279({
        period:          schedule.period,
        includeResolved: schedule.includeResolved,
      });

      if (this._notificationChannel281) {
        notifyResult = await this._notificationChannel281.notifyDigest280(digestResult, {
          force: schedule.force,
        });
      }

      schedule.lastRun = runTs;
      schedule.runCount++;

      const record = {
        runId, name, ts: runTs, ok: true,
        digestId:  digestResult?.digestId || null,
        attempted: notifyResult?.attempted || 0,
        delivered: notifyResult?.delivered || 0,
        failed:    notifyResult?.failed    || 0,
        durationMs: Date.now() - _t0,
      };
      this._pushHistory281(record);
      this._recordPerf281(record.durationMs);
      this._broadcastSse281({ type: SCHED_EVENT_RUN_COMPLETE_281, name, runId, ...record });

    } catch (err) {
      error = err.message;
      schedule.failCount++;

      const record = { runId, name, ts: runTs, ok: false, error, durationMs: Date.now() - _t0 };
      this._pushHistory281(record);
      this._broadcastSse281({ type: SCHED_EVENT_RUN_FAILED_281, name, runId, error, ts: runTs });
    }
  }

  _pushHistory281(record) {
    this._history281.push(record);
    if (this._history281.length > SCHEDULER_HISTORY_MAX_281) {
      this._history281 = this._history281.slice(-SCHEDULER_HISTORY_MAX_281);
    }
  }

  _broadcastSse281(payload) {
    if (this._sseClients281.size === 0) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const [id, res] of this._sseClients281) {
      try { res.write(data); }
      catch (_) { this._sseClients281.delete(id); }
    }
  }

  _ensureHeartbeat281() {
    if (this._heartbeatTimer281) return;
    this._heartbeatTimer281 = setInterval(() => {
      this._broadcastSse281({ type: 'heartbeat', ts: new Date().toISOString(), version: SCHEDULER_VERSION_281 });
    }, SCHEDULER_SSE_HEARTBEAT_MS_281);
    if (this._heartbeatTimer281.unref) this._heartbeatTimer281.unref();
  }

  _stopHeartbeat281() {
    if (this._heartbeatTimer281) {
      clearInterval(this._heartbeatTimer281);
      this._heartbeatTimer281 = null;
    }
  }

  _recordPerf281(latencyMs) {
    this._perfLatencies281.push(latencyMs);
    if (this._perfLatencies281.length > 1000) this._perfLatencies281.shift();
  }
}

module.exports = { DigestScheduler281, SCHEDULER_VERSION_281 };
