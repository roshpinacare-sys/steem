/**
 * lib/workspaceRealTimeFeed.js — V158
 * =====================================
 * Workspace Real-Time Task Feed
 * מאזין לשינויים ב-WorkspaceTaskService ומשדר לclient דרך AdminWsHub pattern
 *
 * Pattern: identical to lib/adminWsHub.js but scoped to workspace task events
 *
 * [V158-TASK-08] — Workspace Real-Time Task Feed
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — לא נגענו
 */

'use strict';

const EventEmitter = require('events');

// ── WorkspaceFeedHub ─────────────────────────────────────────────────────────
class WorkspaceFeedHub extends EventEmitter {
  constructor({ logger = null } = {}) {
    super();
    /** @type {Map<string, {ws: object, workspaceId: string, subscribedAt: string}>} */
    this._clients   = new Map();
    this._log       = logger || { info: () => {}, warn: () => {} };
    this._version   = 'V158';
    this._eventCount = 0;
  }

  // ── subscribe / unsubscribe ─────────────────────────────────────────────
  subscribe(clientId, ws, workspaceId) {
    this._clients.set(clientId, {
      ws,
      workspaceId,
      subscribedAt: new Date().toISOString(),
    });
    this._log.info({ clientId, workspaceId }, '[workspaceFeed] client subscribed');
  }

  unsubscribe(clientId) {
    const c = this._clients.get(clientId);
    if (c) {
      this._log.info({ clientId, workspaceId: c.workspaceId }, '[workspaceFeed] client unsubscribed');
      this._clients.delete(clientId);
    }
  }

  // ── broadcast event to all subscribers of a workspace ───────────────────
  broadcast(workspaceId, eventType, data) {
    this._eventCount++;
    const payload = JSON.stringify({
      type:        eventType,
      workspaceId,
      data,
      ts:          new Date().toISOString(),
      feedVersion: this._version,
    });

    let sent = 0;
    for (const [clientId, client] of this._clients) {
      if (client.workspaceId !== workspaceId) continue;
      try {
        if (client.ws && client.ws.readyState === 1 /* OPEN */) {
          client.ws.send(payload);
          sent++;
        } else {
          this._clients.delete(clientId);
        }
      } catch (err) {
        this._log.warn({ err: err.message, clientId }, '[workspaceFeed] send failed, removing client');
        this._clients.delete(clientId);
      }
    }
    return sent;
  }

  // ── task event helpers ───────────────────────────────────────────────────
  emitTaskCreated(workspaceId, task)  { return this.broadcast(workspaceId, 'task.created',  task); }
  emitTaskUpdated(workspaceId, task)  { return this.broadcast(workspaceId, 'task.updated',  task); }
  emitTaskDeleted(workspaceId, taskId){ return this.broadcast(workspaceId, 'task.deleted',  { taskId }); }
  emitTaskAssigned(workspaceId, task) { return this.broadcast(workspaceId, 'task.assigned', task); }
  emitCommentAdded(workspaceId, comment) { return this.broadcast(workspaceId, 'task.comment_added', comment); }

  // ── stats ────────────────────────────────────────────────────────────────
  stats() {
    const byWorkspace = {};
    for (const client of this._clients.values()) {
      byWorkspace[client.workspaceId] = (byWorkspace[client.workspaceId] || 0) + 1;
    }
    return {
      totalClients: this._clients.size,
      byWorkspace,
      eventCount:   this._eventCount,
      version:      this._version,
    };
  }
}

// ── WorkspaceSSEFeed: SSE-based fallback (no WS needed) ─────────────────────
// Sends Server-Sent Events to browser clients subscribed per workspace
class WorkspaceSSEFeed {
  constructor({ logger = null } = {}) {
    /** @type {Map<string, {res: object, workspaceId: string, connectedAt: string}>} */
    this._clients   = new Map();
    this._log       = logger || { info: () => {}, warn: () => {} };
    this._version   = 'V158';
    this._eventCount = 0;
  }

  // ── register SSE client ─────────────────────────────────────────────────
  addClient(clientId, res, workspaceId) {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', workspaceId, version: this._version })}\n\n`);
    this._clients.set(clientId, { res, workspaceId, connectedAt: new Date().toISOString() });
    this._log.info({ clientId, workspaceId }, '[workspaceSSE] SSE client connected');
  }

  removeClient(clientId) {
    this._clients.delete(clientId);
  }

  // ── send event to all SSE clients of a workspace ────────────────────────
  send(workspaceId, eventType, data) {
    this._eventCount++;
    const payload = JSON.stringify({ type: eventType, workspaceId, data, ts: new Date().toISOString() });
    let sent = 0;
    for (const [cid, client] of this._clients) {
      if (client.workspaceId !== workspaceId) continue;
      try {
        client.res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
        sent++;
      } catch (_) {
        this._clients.delete(cid);
      }
    }
    return sent;
  }

  emitTaskCreated(workspaceId, task)   { return this.send(workspaceId, 'task.created',  task); }
  emitTaskUpdated(workspaceId, task)   { return this.send(workspaceId, 'task.updated',  task); }
  emitTaskDeleted(workspaceId, taskId) { return this.send(workspaceId, 'task.deleted',  { taskId }); }
  emitTaskAssigned(workspaceId, task)  { return this.send(workspaceId, 'task.assigned', task); }
  emitCommentAdded(workspaceId, c)     { return this.send(workspaceId, 'task.comment_added', c); }

  stats() {
    const byWorkspace = {};
    for (const client of this._clients.values()) {
      byWorkspace[client.workspaceId] = (byWorkspace[client.workspaceId] || 0) + 1;
    }
    return { totalClients: this._clients.size, byWorkspace, eventCount: this._eventCount, version: this._version };
  }
}

// Singletons
const defaultWorkspaceFeedHub  = new WorkspaceFeedHub();
const defaultWorkspaceSSEFeed  = new WorkspaceSSEFeed();

module.exports = {
  WorkspaceFeedHub,
  WorkspaceSSEFeed,
  defaultWorkspaceFeedHub,
  defaultWorkspaceSSEFeed,
};
