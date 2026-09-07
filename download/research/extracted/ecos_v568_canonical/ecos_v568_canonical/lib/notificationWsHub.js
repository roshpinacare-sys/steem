/**
 * notificationWsHub.js — ECOS V138
 * ─────────────────────────────────────────────────────────────────────────────
 * [V137-NB] Real-Time Notification Delivery — WebSocket Channel
 * [V138-ND05] JWT sub-claim binding; Authorization header support
 * [V138-ND01] Delivery log wiring — inserts to notification_delivery_log on push
 *
 * Design:
 *   - `noServer: true` — attaches to existing HTTP server via the `upgrade` event.
 *   - JWT auth: `Authorization: Bearer <jwt>` header (preferred) or `?token=<jwt>`
 *     query param. Dev fallback: `?userId=<id>` when no JWT secret is set.
 *     `sub` claim is the primary userId source; falls back to `userId`/`validatorId`.
 *   - Map<userId, Set<ws>> keeps per-user connections.
 *   - `push(userId, notification)` called by RankNotifier._enqueue().
 *     Writes delivery log rows to `notification_delivery_log` (non-fatal).
 *   - Graceful degradation: if `ws` package unavailable, caller catches and nulls.
 *
 * Sacred files: fiatLedger.js, auditLog.js — NOT touched.
 */

'use strict';

const { WebSocketServer } = require('ws');
const { createHash }      = require('node:crypto');

const WS_OPEN = 1; // ws.OPEN

function _dlId(notifId, userId, channel, ts) {
  return 'dl_' + createHash('sha256')
    .update([notifId, userId, channel, ts, Math.random().toString()].join(':'))
    .digest('hex').slice(0, 20);
}

class NotificationWsHub {
  /**
   * @param {object} opts
   * @param {object}   [opts.rankNotifier]  - RankNotifier instance (for snapshots)
   * @param {Function} [opts.verifyJwt]    - verifyJwt(token, secret) → { valid, payload }
   * @param {object}   [opts.logger]
   * @param {object}   [opts.db]           - Postgres pool for delivery log (optional)
   */
  constructor(opts = {}) {
    this._notifier  = opts.rankNotifier || null;
    this._verifyJwt = opts.verifyJwt || null;
    this._logger    = opts.logger || console;
    this._db        = opts.db || null; // [V138-ND01] DB pool for delivery log

    // Map<userId, Set<WebSocket>>
    this._subscriptions = new Map();

    // noServer mode — caller routes upgrades explicitly
    this._wss = new WebSocketServer({ noServer: true });

    this._wss.on('connection', (ws, req, userId) => {
      this._addClient(userId, ws);

      ws.on('close',   ()  => this._removeClient(userId, ws));
      ws.on('error',   ()  => { try { ws.close(); } catch (_) {} this._removeClient(userId, ws); });
      ws.on('message', (d) => this._handleMessage(ws, userId, d));

      // Push snapshot of 10 most-recent notifications on connect.
      if (this._notifier) {
        try {
          const snap = this._notifier.list(userId, { limit: 10 });
          this._send(ws, { type: 'notification.snapshot', data: snap, ts: new Date().toISOString() });
        } catch (_) {}
      }
    });
  }

  // ── [V138-ND05] JWT extraction helper ────────────────────────────────────────

  /**
   * Extract a JWT token from either:
   *   1. `Authorization: Bearer <token>` header (preferred per RFC 6750)
   *   2. `?token=<jwt>` query parameter (backward compat)
   * Returns null if not found.
   */
  _extractToken(req, url) {
    // 1. Authorization header
    const authHeader = req.headers && (req.headers['authorization'] || req.headers['Authorization']);
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const t = authHeader.slice(7).trim();
      if (t) return t;
    }
    // 2. Query param fallback
    return url.searchParams.get('token') || null;
  }

  /**
   * Resolve userId from a JWT token using the secret.
   * Tries VALIDATOR_JWT_SECRET first, then JWT_SECRET.
   * Returns null if resolution fails.
   * [V138-ND05] Prefers `sub` claim; falls back to `userId`/`validatorId`.
   */
  _resolveUserFromToken(token) {
    if (!this._verifyJwt || !token) return null;
    const secrets = [
      process.env.VALIDATOR_JWT_SECRET,
      process.env.JWT_SECRET,
    ].filter(Boolean);
    for (const secret of secrets) {
      try {
        const r = this._verifyJwt(token, secret);
        if (r && r.valid && r.payload) {
          // [V138-ND05] `sub` is the canonical userId claim per JWT RFC 7519
          const uid = r.payload.sub
            || r.payload.userId
            || r.payload.validatorId
            || null;
          if (uid) return String(uid);
        }
      } catch (_) { /* try next secret */ }
    }
    return null;
  }

  // ── Upgrade handler ───────────────────────────────────────────────────────────

  /**
   * Called from the HTTP server `upgrade` handler for path `/ws/notifications`.
   * [V138-ND05] Resolves userId from JWT (Authorization header or ?token) or
   * dev-mode ?userId fallback. Rejects connections without a valid userId.
   */
  handleUpgrade(req, socket, head) {
    let userId = null;

    try {
      const url   = new URL(req.url, 'http://localhost');
      const token = this._extractToken(req, url);

      // JWT auth (production)
      if (token) {
        userId = this._resolveUserFromToken(token);
      }

      // Dev fallback: ?userId=<id> when no JWT secret configured
      if (!userId) {
        const jwtConfigured = !!(process.env.VALIDATOR_JWT_SECRET || process.env.JWT_SECRET);
        if (!jwtConfigured) {
          userId = url.searchParams.get('userId') || null;
        }
      }
    } catch (_) {}

    if (!userId) {
      try {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
      } catch (_) {}
      return;
    }

    this._wss.handleUpgrade(req, socket, head, (ws) => {
      this._wss.emit('connection', ws, req, userId);
    });
  }

  // ── Client lifecycle ──────────────────────────────────────────────────────────

  _addClient(userId, ws) {
    if (!this._subscriptions.has(userId)) this._subscriptions.set(userId, new Set());
    this._subscriptions.get(userId).add(ws);
    this._logger.info && this._logger.info(
      { component: 'notification-ws', userId, clients: this._subscriptions.get(userId).size },
      '[V137-NB] WS client connected'
    );
  }

  _removeClient(userId, ws) {
    const clients = this._subscriptions.get(userId);
    if (!clients) return;
    clients.delete(ws);
    if (clients.size === 0) this._subscriptions.delete(userId);
    this._logger.info && this._logger.info(
      { component: 'notification-ws', userId },
      '[V137-NB] WS client disconnected'
    );
  }

  _handleMessage(ws, userId, data) {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') {
        this._send(ws, { type: 'pong', ts: new Date().toISOString() });
      }
    } catch (_) {}
  }

  _send(ws, payload) {
    try {
      if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(payload));
    } catch (_) {}
  }

  // ── [V138-ND01] Delivery log insert (fire-and-forget) ─────────────────────────

  _logDelivery(notificationId, userId, channel, success, latencyMs, errorMsg) {
    if (!this._db) return;
    const ts = new Date().toISOString();
    const id = _dlId(notificationId, userId, channel, ts);
    this._db.query(
      `INSERT INTO notification_delivery_log
         (id, notification_id, user_id, channel, success, latency_ms, error_msg, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [id, notificationId || '', userId, channel, success,
       latencyMs != null ? latencyMs : null,
       errorMsg  || null,
       ts]
    ).catch(err =>
      this._logger.warn && this._logger.warn(
        { err: err.message },
        '[V138-ND01] delivery_log insert failed (non-fatal)'
      )
    );
  }

  // ── Subscription management ───────────────────────────────────────────────────

  subscribe(userId, ws) {
    if (!this._subscriptions.has(userId)) this._subscriptions.set(userId, new Set());
    this._subscriptions.get(userId).add(ws);
  }

  unsubscribe(ws) {
    for (const [userId, clients] of this._subscriptions) {
      clients.delete(ws);
      if (clients.size === 0) this._subscriptions.delete(userId);
    }
  }

  // ── Push ─────────────────────────────────────────────────────────────────────

  /**
   * Push a notification to all WebSocket clients subscribed for `userId`.
   * [V138-ND01] Logs each delivery attempt to `notification_delivery_log`.
   * @returns {number} sent count
   */
  push(userId, notification) {
    const clients = this._subscriptions.get(userId);
    if (!clients || clients.size === 0) {
      // [V138-ND01] Log failed (no clients) delivery
      if (notification && notification.id) {
        this._logDelivery(notification.id, userId, 'ws', false, null, 'no_connected_clients');
      }
      return 0;
    }

    const payload = JSON.stringify({
      type: 'notification.new',
      data: notification,
      ts:   new Date().toISOString(),
    });

    let sent = 0;
    const stale = [];
    for (const ws of clients) {
      const t0 = Date.now();
      try {
        if (ws.readyState === WS_OPEN) {
          ws.send(payload);
          const latencyMs = Date.now() - t0;
          sent++;
          // [V138-ND01] Log successful delivery
          if (notification && notification.id) {
            this._logDelivery(notification.id, userId, 'ws', true, latencyMs, null);
          }
        } else {
          stale.push(ws);
          if (notification && notification.id) {
            this._logDelivery(notification.id, userId, 'ws', false, null, 'socket_not_open');
          }
        }
      } catch (err) {
        stale.push(ws);
        if (notification && notification.id) {
          this._logDelivery(notification.id, userId, 'ws', false, null, err.message || 'send_error');
        }
      }
    }
    for (const ws of stale) clients.delete(ws);
    if (clients.size === 0) this._subscriptions.delete(userId);

    return sent;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  connectedUsers() {
    return this._subscriptions.size;
  }

  connectedClients() {
    let n = 0;
    for (const s of this._subscriptions.values()) n += s.size;
    return n;
  }

  stats() {
    return {
      connectedUsers:   this.connectedUsers(),
      connectedClients: this.connectedClients(),
    };
  }
}

module.exports = { NotificationWsHub };
