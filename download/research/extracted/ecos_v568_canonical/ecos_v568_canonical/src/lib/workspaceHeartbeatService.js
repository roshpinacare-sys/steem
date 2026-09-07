'use strict';
  /**
   * lib/workspaceHeartbeatService.js — ECOS V178
   * Workspace WebSocket-presence heartbeat tracker.
   *
   * Tracks which workspaces have active clients, when their last ping arrived,
   * and broadcasts synthetic "presence" events so downstream services can detect
   * idle workspaces without hitting the DB.
   *
   * Design:
   *  - Pure in-memory store (Map keyed by workspaceId).
   *  - Zero external dependencies — uses only Node.js built-ins.
   *  - Stale heartbeats (> staleTtlMs with no ping) are removed by a
   *    background sweep that fires every sweepIntervalMs.
   *  - An optional presenceCallback(workspaceId, event) hook lets the server
   *    broadcast presence events over WebSocket without coupling this module
   *    to the WS implementation.
   *
   * @version 178.0.0
   */

  const DEFAULT_STALE_TTL_MS    = 60_000;   // 60 s — heartbeat considered stale
  const DEFAULT_SWEEP_INTERVAL  = 30_000;   // 30 s — cleanup sweep cadence
  const DEFAULT_PING_INTERVAL   = 15_000;   // 15 s — recommended client ping interval

  class WorkspaceHeartbeatService {
    /**
     * @param {object}   opts
     * @param {number}   [opts.staleTtlMs=60000]      ms after last ping before stale
     * @param {number}   [opts.sweepIntervalMs=30000]  ms between cleanup sweeps
     * @param {number}   [opts.pingIntervalMs=15000]   recommended ping interval (metadata only)
     * @param {function} [opts.presenceCallback]       fn(workspaceId, event) called on state change
     */
    constructor(opts = {}) {
      this._staleTtlMs   = opts.staleTtlMs    ?? DEFAULT_STALE_TTL_MS;
      this._sweepMs      = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL;
      this._pingMs       = opts.pingIntervalMs  ?? DEFAULT_PING_INTERVAL;
      this._onPresence   = typeof opts.presenceCallback === 'function'
        ? opts.presenceCallback : null;

      /** @type {Map<string, { lastPing: Date, userId: string|null, meta: object, pingCount: number }>} */
      this._buckets = new Map();

      this._totalPings   = 0;
      this._totalEvictions = 0;

      // Background sweep (unref so it doesn't keep the process alive in tests)
      this._sweepTimer = setInterval(() => this._sweep(), this._sweepMs);
      if (this._sweepTimer.unref) this._sweepTimer.unref();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Record a heartbeat ping from a client.
     * @param {string} workspaceId
     * @param {object} [opts]
     * @param {string} [opts.userId]   authenticated user (optional)
     * @param {object} [opts.meta]     arbitrary client metadata
     * @returns {{ workspaceId, lastPing, userId, pingCount, pingIntervalMs }}
     */
    ping(workspaceId, opts = {}) {
      if (!workspaceId || typeof workspaceId !== 'string') {
        throw new HeartbeatValidationError('workspaceId must be a non-empty string');
      }
      const isNew = !this._buckets.has(workspaceId);
      const bucket = this._buckets.get(workspaceId) || { pingCount: 0, userId: null, meta: {} };
      bucket.lastPing  = new Date();
      bucket.userId    = opts.userId ?? bucket.userId;
      bucket.meta      = opts.meta   ?? bucket.meta;
      bucket.pingCount += 1;
      this._buckets.set(workspaceId, bucket);
      this._totalPings++;

      if (isNew && this._onPresence) {
        try { this._onPresence(workspaceId, { type: 'connected', workspaceId, at: bucket.lastPing }); }
        catch (_) { /* swallow */ }
      }

      return this._snapshot(workspaceId, bucket);
    }

    /**
     * Explicitly unregister a workspace (client disconnect).
     * @param {string} workspaceId
     * @returns {{ removed: boolean }}
     */
    disconnect(workspaceId) {
      const had = this._buckets.has(workspaceId);
      if (had) {
        this._buckets.delete(workspaceId);
        if (this._onPresence) {
          try { this._onPresence(workspaceId, { type: 'disconnected', workspaceId, at: new Date() }); }
          catch (_) { /* swallow */ }
        }
      }
      return { removed: had, workspaceId };
    }

    /**
     * Get current heartbeat status for a workspace.
     * @param {string} workspaceId
     * @returns {object|null}  null if no active heartbeat
     */
    getStatus(workspaceId) {
      const bucket = this._buckets.get(workspaceId);
      if (!bucket) return null;
      return this._snapshot(workspaceId, bucket);
    }

    /**
     * List all active workspaces (not yet stale).
     * @returns {Array<object>}
     */
    listActive() {
      const now = Date.now();
      const out = [];
      for (const [wsId, bucket] of this._buckets) {
        if ((now - bucket.lastPing.getTime()) < this._staleTtlMs) {
          out.push(this._snapshot(wsId, bucket));
        }
      }
      return out;
    }

    /**
     * Aggregate statistics.
     * @returns {{ activeWorkspaces, totalPings, totalEvictions, staleTtlMs, sweepIntervalMs }}
     */
    stats() {
      const now = Date.now();
      let active = 0;
      for (const [, b] of this._buckets) {
        if ((now - b.lastPing.getTime()) < this._staleTtlMs) active++;
      }
      return {
        activeWorkspaces: active,
        trackedWorkspaces: this._buckets.size,
        totalPings:        this._totalPings,
        totalEvictions:    this._totalEvictions,
        staleTtlMs:        this._staleTtlMs,
        sweepIntervalMs:   this._sweepMs,
        pingIntervalMs:    this._pingMs,
      };
    }

    /** Stop the background sweep (call in tests to avoid open handles). */
    shutdown() {
      clearInterval(this._sweepTimer);
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _snapshot(workspaceId, bucket) {
      const now = Date.now();
      const ageMs = now - bucket.lastPing.getTime();
      return {
        workspaceId,
        lastPing:      bucket.lastPing,
        userId:        bucket.userId,
        meta:          bucket.meta,
        pingCount:     bucket.pingCount,
        ageMs,
        isStale:       ageMs >= this._staleTtlMs,
        pingIntervalMs: this._pingMs,
      };
    }

    _sweep() {
      const now = Date.now();
      for (const [wsId, bucket] of this._buckets) {
        if ((now - bucket.lastPing.getTime()) >= this._staleTtlMs) {
          this._buckets.delete(wsId);
          this._totalEvictions++;
          if (this._onPresence) {
            try { this._onPresence(wsId, { type: 'evicted', workspaceId: wsId, at: new Date() }); }
            catch (_) { /* swallow */ }
          }
        }
      }
    }
  }

  class HeartbeatValidationError extends Error {
    constructor(msg) { super(msg); this.name = 'HeartbeatValidationError'; this.statusCode = 400; }
  }

  const defaultHeartbeatService = new WorkspaceHeartbeatService();

  module.exports = {
    WorkspaceHeartbeatService,
    HeartbeatValidationError,
    defaultHeartbeatService,
    DEFAULT_STALE_TTL_MS,
    DEFAULT_PING_INTERVAL,
  };
  