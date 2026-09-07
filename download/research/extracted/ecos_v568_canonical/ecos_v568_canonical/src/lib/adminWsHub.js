/**
 * lib/adminWsHub.js — ECOS V155
 * ─────────────────────────────────────────────────────────────────────────────
 * [V155-WS-01] Real-Time WebSocket Admin Feed
 *
 * Replaces the 15-second polling in AuditEventFeed with a live WebSocket
 * subscription. Admin clients connect to `/ws/admin` and receive:
 *   - audit.event   — new audit log entries as they are appended
 *   - ai.metrics    — AI metrics snapshot every 30 seconds
 *   - system.status — system health snapshot on connect + on change
 *   - pong          — response to ping
 *
 * Auth: Bearer JWT with `role: 'admin'` claim required.
 * Dev fallback: `?adminToken=<NEXT_PUBLIC_ADMIN_TOKEN>` query param.
 *
 * Design:
 *   - noServer: true — attaches to existing HTTP server via `upgrade` event
 *   - Set<ws> for all admin connections (no per-user map needed)
 *   - broadcast(type, data) — sends to all connected admins
 *   - Non-fatal: all errors logged, never crash the server
 *   - Sacred files (fiatLedger.js, auditLog.js) are NEVER touched
 */
'use strict';

const { WebSocketServer } = require('ws');

const WS_OPEN = 1;
const METRICS_INTERVAL_MS = 30_000; // 30 seconds
// [V157-TASK-04] Connection hardening defaults
const MAX_CONN_PER_IP_PER_MIN = 5;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;   // 10 minutes
const IDLE_REAP_INTERVAL_MS = 60 * 1000;  // sweep every minute
// [V157-TASK-10] System alert threshold (pressureRate is a 0–100 percentage)
const PRESSURE_ALERT_THRESHOLD = 30;

class AdminWsHub {
  /**
   * @param {object} opts
   * @param {Function} [opts.verifyJwt]      - verifyJwt(token, secret) → { valid, payload }
   * @param {object}   [opts.logger]
   * @param {object}   [opts.db]             - Postgres pool (optional, for broadcast log)
   * @param {Function} [opts.getMetrics]     - () => metricsObject (from aiMetricsEngine)
   * @param {Function} [opts.getSystemStatus]- () => statusObject
   */
  constructor(opts = {}) {
    this._verifyJwt       = opts.verifyJwt || null;
    this._logger          = opts.logger || console;
    this._db              = opts.db || null;
    this._getMetrics      = opts.getMetrics || null;
    this._getSystemStatus = opts.getSystemStatus || null;

    // Set of all connected admin WebSocket clients
    this._clients = new Set();
    this._totalBroadcasts  = 0;
    this._totalConnections = 0;

    // [V157-TASK-04] Connection hardening
    this._maxConnPerIpPerMin = opts.maxConnPerIpPerMin || MAX_CONN_PER_IP_PER_MIN;
    this._idleTimeoutMs      = opts.idleTimeoutMs      || IDLE_TIMEOUT_MS;
    this._rateLimit          = new Map(); // ip -> number[] (connect timestamps within window)
    this._totalRejected      = 0;         // rate-limited rejections
    this._totalReaped        = 0;         // idle disconnects
    // [V157-TASK-10] System alert state
    this._pressureThreshold  = opts.pressureAlertThreshold || PRESSURE_ALERT_THRESHOLD;
    this._lastAlertAt        = 0;

    this._wss = new WebSocketServer({ noServer: true });

    this._wss.on('connection', (ws) => {
      this._clients.add(ws);
      this._totalConnections++;
      ws._lastActivity = Date.now(); // [V157-TASK-04] idle tracking
      this._logger.info && this._logger.info(
        { component: 'admin-ws', clients: this._clients.size },
        '[V155-WS] Admin WS client connected'
      );

      // Send current system status on connect
      if (this._getSystemStatus) {
        try {
          this._sendTo(ws, { type: 'system.status', data: this._getSystemStatus(), ts: new Date().toISOString() });
        } catch (_) {}
      }

      // Send current AI metrics on connect
      if (this._getMetrics) {
        try {
          this._sendTo(ws, { type: 'ai.metrics', data: this._getMetrics(), ts: new Date().toISOString() });
        } catch (_) {}
      }

      ws.on('close',   ()  => this._removeClient(ws));
      ws.on('error',   ()  => { try { ws.close(); } catch (_) {} this._removeClient(ws); });
      ws.on('message', (d) => this._handleMessage(ws, d));
    });

    // Periodic AI metrics broadcast
    this._metricsTimer = null;
    this._startMetricsBroadcast();
    // [V157-TASK-04] Idle connection reaper
    this._idleTimer = null;
    this._startIdleReaper();
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────

  _isAdminToken(token) {
    if (!token) return false;
    // Check against NEXT_PUBLIC_ADMIN_TOKEN (dev mode)
    const adminToken = process.env.NEXT_PUBLIC_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
    if (adminToken && token === adminToken) return true;
    // Check JWT with admin role
    if (this._verifyJwt) {
      const secrets = [process.env.JWT_SECRET, process.env.VALIDATOR_JWT_SECRET].filter(Boolean);
      for (const secret of secrets) {
        try {
          const r = this._verifyJwt(token, secret);
          if (r && r.valid && r.payload && r.payload.role === 'admin') return true;
        } catch (_) {}
      }
    }
    return false;
  }

  _extractToken(req, url) {
    const authHeader = req.headers && (req.headers['authorization'] || req.headers['Authorization']);
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const t = authHeader.slice(7).trim();
      if (t) return t;
    }
    return url.searchParams.get('adminToken') || url.searchParams.get('token') || null;
  }

  // ── Upgrade handler ───────────────────────────────────────────────────────────

  handleUpgrade(req, socket, head) {
    let authorized = false;
    try {
      const url   = new URL(req.url, 'http://localhost');
      const token = this._extractToken(req, url);
      authorized  = this._isAdminToken(token);

      // Dev fallback: no JWT configured → allow any connection
      if (!authorized) {
        const jwtConfigured = !!(process.env.JWT_SECRET || process.env.VALIDATOR_JWT_SECRET);
        const adminTokenSet = !!(process.env.NEXT_PUBLIC_ADMIN_TOKEN || process.env.ADMIN_TOKEN);
        if (!jwtConfigured && !adminTokenSet) authorized = true;
      }
    } catch (_) {}

    if (!authorized) {
      try {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
      } catch (_) {}
      return;
    }

    // [V157-TASK-04] Per-IP connection rate limit
    const ip = this._clientIp(req);
    if (!this._checkRateLimit(ip)) {
      this._totalRejected++;
      this._logger.warn && this._logger.warn({ component: 'admin-ws', ip }, '[V157-TASK-04] WS connection rate-limited');
      try {
        socket.write('HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
      } catch (_) {}
      return;
    }

    this._wss.handleUpgrade(req, socket, head, (ws) => {
      this._wss.emit('connection', ws, req);
    });
  }

  // ── Client lifecycle ──────────────────────────────────────────────────────────

  _removeClient(ws) {
    this._clients.delete(ws);
    this._logger.info && this._logger.info(
      { component: 'admin-ws', clients: this._clients.size },
      '[V155-WS] Admin WS client disconnected'
    );
  }

  _handleMessage(ws, data) {
    try {
      ws._lastActivity = Date.now(); // [V157-TASK-04] refresh idle timer
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') {
        this._sendTo(ws, { type: 'pong', ts: new Date().toISOString() });
      }
      if (msg.type === 'request.metrics' && this._getMetrics) {
        this._sendTo(ws, { type: 'ai.metrics', data: this._getMetrics(), ts: new Date().toISOString() });
      }
      if (msg.type === 'request.status' && this._getSystemStatus) {
        this._sendTo(ws, { type: 'system.status', data: this._getSystemStatus(), ts: new Date().toISOString() });
      }
    } catch (_) {}
  }

  _sendTo(ws, payload) {
    try {
      if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(payload));
    } catch (_) {}
  }

  // ── [V157-TASK-04] Connection hardening ─────────────────────────────────────

  _clientIp(req) {
    try {
      const xff = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
      if (xff) return String(xff).split(',')[0].trim();
      return (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || 'unknown';
    } catch (_) { return 'unknown'; }
  }

  /**
   * Returns true if a new connection from `ip` is allowed (and records it),
   * false if it would exceed maxConnPerIpPerMin within the trailing 60s window.
   */
  _checkRateLimit(ip, now = Date.now()) {
    const windowStart = now - 60_000;
    const hits = (this._rateLimit.get(ip) || []).filter(ts => ts > windowStart);
    if (hits.length >= this._maxConnPerIpPerMin) {
      this._rateLimit.set(ip, hits); // keep pruned list
      return false;
    }
    hits.push(now);
    this._rateLimit.set(ip, hits);
    return true;
  }

  /**
   * Close clients idle longer than idleTimeoutMs. Returns the number reaped.
   */
  _reapIdle(now = Date.now()) {
    let reaped = 0;
    for (const ws of this._clients) {
      const last = ws._lastActivity || 0;
      if (now - last > this._idleTimeoutMs) {
        try { ws.close(4000, 'idle timeout'); } catch (_) {}
        this._clients.delete(ws);
        reaped++;
      }
    }
    if (reaped > 0) {
      this._totalReaped += reaped;
      this._logger.info && this._logger.info({ component: 'admin-ws', reaped }, '[V157-TASK-04] Reaped idle WS clients');
    }
    return reaped;
  }

  _startIdleReaper() {
    if (this._idleTimer) return;
    this._idleTimer = setInterval(() => this._reapIdle(), IDLE_REAP_INTERVAL_MS);
    if (this._idleTimer.unref) this._idleTimer.unref();
  }

  stopIdleReaper() {
    if (this._idleTimer) { clearInterval(this._idleTimer); this._idleTimer = null; }
  }

  // ── [V157-TASK-10] System pressure alerts ───────────────────────────────────

  /**
   * Pure: build a system alert payload from a pressure rate (0–100 percentage).
   * Returns null when at/under threshold, otherwise { severity, recommendedAction, pressureRate, threshold }.
   */
  buildPressureAlert(pressureRate) {
    const pr = Number(pressureRate);
    if (!isFinite(pr) || pr <= this._pressureThreshold) return null;
    const severity = pr > 60 ? 'critical' : (pr > 45 ? 'high' : 'elevated');
    const recommendedAction = pr > 60
      ? 'Throttle inbound tasks and engage additional human reviewers immediately.'
      : 'Increase human-in-the-loop review capacity; monitor confidence trend.';
    return { severity, recommendedAction, pressureRate: pr, threshold: this._pressureThreshold };
  }

  /**
   * Check current metrics and, if pressure exceeds threshold, broadcast a
   * `system.alert`. Debounced to at most one alert per 60s. Returns sent count.
   */
  checkPressureAndAlert(metrics, now = Date.now()) {
    if (!metrics) return 0;
    const alert = this.buildPressureAlert(metrics.pressureRate);
    if (!alert) return 0;
    if (now - this._lastAlertAt < 60_000) return 0; // debounce
    this._lastAlertAt = now;
    return this.broadcast('system.alert', { ...alert, taskCount: metrics.taskCount, status: metrics.status });
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────────

  /**
   * Broadcast a message to all connected admin clients.
   * @param {string} type  - event type
   * @param {object} data  - payload
   * @returns {number} sent count
   */
  broadcast(type, data) {
    if (this._clients.size === 0) return 0;
    const payload = JSON.stringify({ type, data, ts: new Date().toISOString() });
    this._totalBroadcasts++;
    let sent = 0;
    const stale = [];
    for (const ws of this._clients) {
      try {
        if (ws.readyState === WS_OPEN) {
          ws.send(payload);
          sent++;
        } else {
          stale.push(ws);
        }
      } catch (_) {
        stale.push(ws);
      }
    }
    for (const ws of stale) this._clients.delete(ws);

    // Log to DB (non-fatal)
    if (this._db && sent > 0) {
      this._db.query(
        'INSERT INTO audit_broadcast_log (event_type, payload, recipient_count) VALUES ($1,$2,$3)',
        [type, JSON.stringify(data), sent]
      ).catch(() => {});
    }

    return sent;
  }

  /**
   * Broadcast a new audit event to all connected admin clients.
   * Called by the AuditLog hook in ecos-api-server.js.
   */
  broadcastAuditEvent(event) {
    if (!event) { this._totalBroadcasts++; return 0; }
    if (this._clients.size === 0) { this._totalBroadcasts++; return 0; }
    return this.broadcast('audit.event', event);
  }

  /**
   * Broadcast AI metrics snapshot to all connected admin clients.
   */
  broadcastMetrics() {
    this._totalBroadcasts++;
    if (!this._getMetrics) return 0;
    try {
      if (this._clients.size === 0) return 0;
      return this.broadcast('ai.metrics', this._getMetrics());
    } catch (_) { return 0; }
  }

  // ── Periodic metrics broadcast ────────────────────────────────────────────────

  _startMetricsBroadcast() {
    if (this._metricsTimer) return;
    this._metricsTimer = setInterval(() => {
      if (this._clients.size > 0) {
        this.broadcastMetrics();
        // [V157-TASK-10] Raise a system alert if AI pressure is too high
        if (this._getMetrics) {
          try { this.checkPressureAndAlert(this._getMetrics()); } catch (_) {}
        }
      }
    }, METRICS_INTERVAL_MS);
    // Don't block process exit
    if (this._metricsTimer.unref) this._metricsTimer.unref();
  }

  stopMetricsBroadcast() {
    if (this._metricsTimer) {
      clearInterval(this._metricsTimer);
      this._metricsTimer = null;
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  connectedClients() {
    return this._clients.size;
  }

  stats() {
    return {
      connectedClients:  this._clients.size,
      totalBroadcasts:   this._totalBroadcasts,
      totalConnections:  this._totalConnections,
      totalRejected:     this._totalRejected,   // [V157-TASK-04] rate-limited
      totalReaped:       this._totalReaped,      // [V157-TASK-04] idle disconnects
      pressureThreshold: this._pressureThreshold, // [V157-TASK-10]
      ecosVersion:       'V155',
    };
  }
}

module.exports = { AdminWsHub };
