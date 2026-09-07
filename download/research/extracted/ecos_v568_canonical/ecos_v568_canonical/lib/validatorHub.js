/**
 * ECOS ValidatorHub — WebSocket Real-Time Validator Notification Hub
 * -------------------------------------------------------------------
 * Attaches to the existing HTTP server and broadcasts approval lifecycle
 * events to all connected, authenticated validator clients.
 *
 * [V84] New system. Requires: npm install ws --save
 * [V97] JWT authentication: when VALIDATOR_JWT_SECRET is set and verifyJwt
 *       is provided, connections must supply a valid JWT token.
 *
 * Protocol (JSON messages):
 *   Server → Client:
 *     { type: 'approval.created',  data: approval, ts }
 *     { type: 'approval.resolved', data: approval, ts }
 *     { type: 'queue.snapshot',    data: [approval, …], ts }
 *     { type: 'ping',              data: {},        ts }
 *     { type: 'error',             message: string, ts }  ← [V97]
 *
 *   Client → Server:
 *     { type: 'auth',  validatorId: 'validator::xxx' }    ← legacy / no-token
 *     { type: 'auth',  token: '...' }                     ← [V97] JWT via message
 *     { type: 'pong' }
 *
 * JWT token extraction order (V97):
 *   1. Query string:   ws://host/ws/validator?token=<jwt>
 *   2. Subprotocol:    Sec-WebSocket-Protocol: bearer.<jwt>
 *   3. Auth message:   { type: 'auth', token: '...' } — wait up to 5 s
 *
 * Connection lifecycle:
 *   PRODUCTION (VALIDATOR_JWT_SECRET set + verifyJwt provided):
 *     - Token present on connect → verify immediately, set validatorId
 *     - No token on connect → wait 5 s for auth message, then disconnect
 *     - Invalid token → send { type: 'error', message: 'Unauthorized' } + close
 *   DEV (no secret / no verifyJwt):
 *     - Accept all connections. Legacy { type: 'auth', validatorId } still works.
 *
 * Graceful degradation:
 *   If the 'ws' package is not installed, ValidatorHub cannot be constructed
 *   and the caller should catch the error and set hub = null.
 *
 * Usage in ecos-api-server.js:
 *   hub = new ValidatorHub(server, hitlGate, validatorAuth.verifyJwt);
 */

'use strict';

const { WebSocketServer } = require('ws');

// Auth timeout for JWT mode: 5 seconds
const JWT_AUTH_TIMEOUT_MS = 5000;

class ValidatorHub {
  /**
   * @param {import('http').Server} httpServer  Existing HTTP server to attach to.
   * @param {object|Function|null}  [hitlGateOrOpts]
   *   If an object with getPendingApprovals/log: treated as legacy opts (V84 compat).
   *   If a HitlGate instance: used to get pending approvals.
   *   Pass null to use the third-argument style.
   * @param {Function|null}  [verifyJwtFn]
   *   Optional function(token, secret) → { valid, payload } | { valid: false, reason }.
   *   When provided AND process.env.VALIDATOR_JWT_SECRET is set: JWT auth is enforced.
   *
   * Supported call signatures:
   *   new ValidatorHub(server)                          — V84 compat, no auth
   *   new ValidatorHub(server, opts)                    — V84 compat, opts.getPendingApprovals
   *   new ValidatorHub(server, hitlGate, verifyJwt)     — V97 new style
   */
  constructor(httpServer, hitlGateOrOpts = {}, verifyJwt = null) {
    this._wss = new WebSocketServer({ server: httpServer });
    // Map<WebSocket, string|null>  — socket → validatorId (null until auth)
    this._clients = new Map();

    // ── Resolve opts vs hitlGate ──────────────────────────────────────────────
    if (hitlGateOrOpts && typeof hitlGateOrOpts.listApprovals === 'function') {
      // New style: HitlGate instance passed directly
      this._getPendingApprovals = () => hitlGateOrOpts.listApprovals({ status: 'pending' });
      this._log = null;
    } else {
      // Legacy style: opts object
      const opts = hitlGateOrOpts || {};
      this._getPendingApprovals = opts.getPendingApprovals || (() => []);
      this._log = opts.log || null;
    }

    // ── JWT auth mode ─────────────────────────────────────────────────────────
    // Active when VALIDATOR_JWT_SECRET is set AND a verifyJwt function is provided.
    this._verifyJwt = (typeof verifyJwt === 'function') ? verifyJwt : null;
    this._jwtSecret = process.env.VALIDATOR_JWT_SECRET
      ? process.env.VALIDATOR_JWT_SECRET.trim()
      : null;
    this._jwtAuthEnabled = !!(this._verifyJwt && this._jwtSecret);

    this._wss.on('connection', (ws, req) => this._onConnect(ws, req));
    // Ping every 30 s to keep connections alive
    this._pingTimer = setInterval(() => this._pingAll(), 30000);
  }

  // ── Private: extract JWT token from connection request ───────────────────────
  _extractTokenFromRequest(req) {
    // 1. Query string: ?token=<jwt>
    try {
      const urlStr = 'http://x' + (req.url || '');
      const parsed = new URL(urlStr);
      const t = parsed.searchParams.get('token');
      if (t) return t;
    } catch { /* ignore */ }

    // 2. Subprotocol header: Sec-WebSocket-Protocol: bearer.<jwt>
    const protocols = req.headers['sec-websocket-protocol'] || '';
    for (const proto of protocols.split(',')) {
      const p = proto.trim();
      if (p.startsWith('bearer.')) {
        const t = p.slice('bearer.'.length);
        if (t) return t;
      }
    }

    return null;
  }

  // ── Private: verify a JWT token string ───────────────────────────────────────
  _verifyToken(token) {
    if (!this._verifyJwt || !this._jwtSecret) return null;
    try {
      const result = this._verifyJwt(token, this._jwtSecret);
      if (result && result.valid && result.payload && result.payload.sub) {
        return result.payload.sub; // validatorId = sub claim
      }
    } catch { /* ignore */ }
    return null;
  }

  // ── Private: connection handler ──────────────────────────────────────────────
  _onConnect(ws, req) {
    // Register with null validatorId until client authenticates
    this._clients.set(ws, null);

    if (this._jwtAuthEnabled) {
      // ── PRODUCTION JWT mode ────────────────────────────────────────────────
      const token = this._extractTokenFromRequest(req);

      if (token) {
        // Token present on connect — verify immediately
        const validatorId = this._verifyToken(token);
        if (validatorId) {
          this._clients.set(ws, validatorId);
          if (this._log) {
            this._log.info({ component: 'validatorHub', validatorId }, 'WS JWT auth via URL token');
          }
          const pending = this._getPendingApprovals();
          this._sendTo(ws, 'queue.snapshot', pending);
        } else {
          // Invalid token
          this._sendTo(ws, 'error', { message: 'Unauthorized' });
          ws.close();
          this._clients.delete(ws);
          return;
        }
      } else {
        // No token in URL/headers — wait 5 s for auth message
        const authTimer = setTimeout(() => {
          if (this._clients.get(ws) === null) {
            // Still unauthenticated after timeout
            this._sendTo(ws, 'error', { message: 'Unauthorized' });
            ws.close();
            this._clients.delete(ws);
          }
        }, JWT_AUTH_TIMEOUT_MS);

        // Attach message handler that handles JWT auth message
        ws.once('message', (raw) => {
          clearTimeout(authTimer);
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'auth' && msg.token && typeof msg.token === 'string') {
              const validatorId = this._verifyToken(msg.token);
              if (validatorId) {
                this._clients.set(ws, validatorId);
                if (this._log) {
                  this._log.info({ component: 'validatorHub', validatorId }, 'WS JWT auth via auth message');
                }
                const pending = this._getPendingApprovals();
                this._sendTo(ws, 'queue.snapshot', pending);
                // Attach the standard message handler for subsequent messages
                this._attachMessageHandler(ws);
                return;
              }
            }
            // Invalid or missing token in auth message
            this._sendTo(ws, 'error', { message: 'Unauthorized' });
            ws.close();
            this._clients.delete(ws);
          } catch {
            this._sendTo(ws, 'error', { message: 'Unauthorized' });
            ws.close();
            this._clients.delete(ws);
          }
        });
      }
    }

    if (!this._jwtAuthEnabled) {
      // ── DEV mode — accept all, legacy auth message still works ────────────
      this._attachMessageHandler(ws);
    }

    ws.on('close', () => {
      this._clients.delete(ws);
    });

    ws.on('error', () => {
      try { ws.terminate(); } catch { /* ignore */ }
      this._clients.delete(ws);
    });

    // Send ping on connect so client can auth immediately
    this._sendTo(ws, 'ping', {});
  }

  // ── Private: attach the ongoing message handler to a socket ──────────────────
  _attachMessageHandler(ws) {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'auth') {
          // Legacy: { type: 'auth', validatorId: '...' } — DEV mode only
          if (msg.validatorId && typeof msg.validatorId === 'string' && !this._jwtAuthEnabled) {
            this._clients.set(ws, msg.validatorId);
            if (this._log) {
              this._log.info(
                { component: 'validatorHub', validatorId: msg.validatorId },
                'Validator authenticated via WebSocket'
              );
            }
            const pending = this._getPendingApprovals();
            this._sendTo(ws, 'queue.snapshot', pending);
          }
          // JWT mode: token-based auth in 'auth' message handled in _onConnect
        }
        // pong: silently accepted, no action needed
      } catch {
        // Ignore malformed messages
      }
    });
  }

  // ── Private: send to a single socket ─────────────────────────────────────────
  _sendTo(ws, type, data) {
    try {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify({ type, data, ts: new Date().toISOString() }));
      }
    } catch {
      // Ignore send errors — client may have disconnected
    }
  }

  // ── Private: ping all connected sockets (keeps connection alive) ─────────────
  _pingAll() {
    for (const [ws] of this._clients) {
      this._sendTo(ws, 'ping', {});
    }
  }

  // ── Public: broadcast to all authenticated clients ───────────────────────────
  /**
   * Broadcast a message to every authenticated validator client.
   * @param {string} type   Message type (e.g. 'approval.created')
   * @param {*}      data   Payload to send
   */
  broadcast(type, data) {
    const msg = JSON.stringify({ type, data, ts: new Date().toISOString() });
    for (const [ws, validatorId] of this._clients) {
      if (validatorId === null) continue; // not yet authenticated
      try {
        if (ws.readyState === 1 /* OPEN */) ws.send(msg);
      } catch {
        // Ignore individual send errors
      }
    }
  }

  // ── Public: approval lifecycle hooks ─────────────────────────────────────────
  /**
   * Call when hitlGate.createApproval() returns — broadcasts to all validators.
   * @param {object} approval  The newly created approval record.
   */
  onApprovalCreated(approval) {
    this.broadcast('approval.created', approval);
  }

  /**
   * Call when hitlGate.resolveApproval() returns — broadcasts to all validators.
   * @param {object} approval  The resolved approval record.
   */
  onApprovalResolved(approval) {
    this.broadcast('approval.resolved', approval);
  }

  /**
   * Broadcast a royalty payment notification.
   * @param {string} validatorId
   * @param {bigint|string} rewardMicro
   * @param {string} patchId
   */
  onRoyaltyPaid(validatorId, rewardMicro, patchId) {
    const rewardUsd = (Number(rewardMicro) / 1_000_000).toFixed(6);
    this.broadcast('ROYALTY_PAID', { validatorId, rewardUsd, patchId });
  }

  // ── Public: introspection ─────────────────────────────────────────────────────
  /**
   * Returns the list of currently authenticated validator IDs.
   * Sockets that connected but haven't sent 'auth' are excluded.
   * @returns {string[]}
   */
  connectedValidators() {
    const ids = [];
    for (const [, validatorId] of this._clients) {
      if (validatorId !== null) ids.push(validatorId);
    }
    return ids;
  }

  /**
   * Total connected sockets (authenticated + unauthenticated).
   * @returns {number}
   */
  totalConnections() {
    return this._clients.size;
  }

  // ── Public: shutdown ──────────────────────────────────────────────────────────
  /**
   * Gracefully shut down the hub (stops ping timer, closes WS server).
   * @returns {Promise<void>}
   */
  close() {
    clearInterval(this._pingTimer);
    return new Promise((resolve) => {
      this._wss.close(() => resolve());
    });
  }
}

module.exports = { ValidatorHub };
