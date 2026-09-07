'use strict';
/**
 * lib/workspaceBroadcastService.js — ECOS V179
 * Workspace fan-out broadcast registry.
 *
 * Keeps a per-workspace registry of connected clients and pushes a message to
 * all of them, returning a per-client delivery result. Clients are duck-typed:
 * any object with a `send(payload)` method works (a real WebSocket, an SSE
 * writer, or a mock in tests), so this module is fully unit-testable without a
 * live socket and carries zero external dependencies (R6).
 *
 * @version 179.0.0
 */

const crypto = require('crypto');

const MAX_MESSAGE_BYTES = 64 * 1024; // 64 KB per broadcast payload

class BroadcastValidationError extends Error {
  constructor(msg) { super(msg); this.name = 'BroadcastValidationError'; this.code = 'BROADCAST_VALIDATION'; this.statusCode = 400; }
}

class WorkspaceBroadcastService {
  constructor(opts = {}) {
    this._log = opts.logger || { info() {}, warn() {}, error() {} };
    // workspaceId -> Map<clientId, client>
    this._clients = new Map();
    this._totalBroadcasts = 0;
    this._totalDelivered  = 0;
  }
  setLogger(log) { this._log = log; }

  /**
   * Register a client under a workspace. Returns the assigned clientId.
   * @param {string} workspaceId
   * @param {{ id?:string, send:Function }} client
   */
  register(workspaceId, client) {
    if (!workspaceId) throw new BroadcastValidationError('workspaceId is required');
    if (!client || typeof client.send !== 'function') throw new BroadcastValidationError('client must expose a send() function');
    const clientId = client.id || `cl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    if (!this._clients.has(workspaceId)) this._clients.set(workspaceId, new Map());
    this._clients.get(workspaceId).set(clientId, client);
    return clientId;
  }

  /** Unregister a client. Returns true if it existed. */
  unregister(workspaceId, clientId) {
    const m = this._clients.get(workspaceId);
    if (!m) return false;
    const existed = m.delete(clientId);
    if (m.size === 0) this._clients.delete(workspaceId);
    return existed;
  }

  /** Number of clients currently registered for a workspace. */
  clientCount(workspaceId) {
    const m = this._clients.get(workspaceId);
    return m ? m.size : 0;
  }

  listClientIds(workspaceId) {
    const m = this._clients.get(workspaceId);
    return m ? [...m.keys()] : [];
  }

  /**
   * Broadcast a message to every client of a workspace.
   * @param {string} workspaceId
   * @param {any} message
   * @param {{ type?:string, senderId?:string }} [opts]
   * @returns {{ workspaceId, messageId, total, delivered, failed, results }}
   */
  broadcast(workspaceId, message, opts = {}) {
    if (!workspaceId) throw new BroadcastValidationError('workspaceId is required');
    if (message === undefined || message === null || message === '') {
      throw new BroadcastValidationError('message is required');
    }
    const encoded = typeof message === 'string' ? message : JSON.stringify(message);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_MESSAGE_BYTES) {
      throw new BroadcastValidationError(`message exceeds ${MAX_MESSAGE_BYTES} bytes`);
    }

    const messageId = `bc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const envelope = {
      messageId,
      type: opts.type || 'broadcast',
      senderId: opts.senderId || null,
      workspaceId,
      sentAt: new Date().toISOString(),
      payload: message,
    };

    const m = this._clients.get(workspaceId);
    const results = [];
    if (m) {
      for (const [clientId, client] of m) {
        try { client.send(envelope); results.push({ clientId, ok: true }); }
        catch (e) { results.push({ clientId, ok: false, error: e && e.message ? e.message : String(e) }); }
      }
    }
    const delivered = results.filter(r => r.ok).length;
    this._totalBroadcasts++;
    this._totalDelivered += delivered;
    this._log.info && this._log.info({ component: 'broadcast', workspaceId, messageId, delivered, failed: results.length - delivered }, 'workspace broadcast');
    return { workspaceId, messageId, total: results.length, delivered, failed: results.length - delivered, results };
  }

  stats() {
    let totalClients = 0;
    for (const m of this._clients.values()) totalClients += m.size;
    return {
      activeWorkspaces: this._clients.size,
      totalClients,
      totalBroadcasts: this._totalBroadcasts,
      totalDelivered:  this._totalDelivered,
      maxMessageBytes: MAX_MESSAGE_BYTES,
    };
  }
}

const defaultBroadcastService = new WorkspaceBroadcastService();

module.exports = {
  WorkspaceBroadcastService,
  BroadcastValidationError,
  defaultBroadcastService,
  MAX_MESSAGE_BYTES,
};
