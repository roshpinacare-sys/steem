'use strict';
/**
 * monitor/index.js — ECOS lightweight status + SSE monitor server.
 * Reads MONITOR_HTTP_PORT || MONITOR_PORT at require-time. Builtin http only; listener unref'd.
 *   GET /monitor/status → JSON incl. numeric sseClients
 *   GET /monitor/stream → text/event-stream (SSE); tracks sseClients
 *   checkValidatorIdleState(lastResolvedAt, pendingCount) → VALIDATOR_IDLE alert | null
 * Completes what monitor.test.js (V89/V95) expects.
 */
const http = require('node:http');

let sseClients = 0;
const startedAt = Date.now();
const VALIDATOR_IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

// Pure alerting logic — fires only when work is pending AND the validator has been idle too long.
function checkValidatorIdleState(lastResolvedAt, pendingCount) {
  const pending = Number(pendingCount) || 0;
  if (pending <= 0) return null;                       // nothing waiting → not idle-critical
  const last = Number(lastResolvedAt) || 0;
  const idleMs = Date.now() - last;
  if (idleMs <= VALIDATOR_IDLE_THRESHOLD_MS) return null; // resolved recently → fine
  return {
    type: 'VALIDATOR_IDLE',
    value: pending,
    message: `Validator idle ${Math.round(idleMs / 60000)}min. Pending: ${pending}`,
    ts: new Date().toISOString(),
  };
}

const statusServer = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0];
  if (req.method === 'GET' && path === '/monitor/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sseClients, uptimeMs: Date.now() - startedAt, pid: process.pid }));
    return;
  }
  if (req.method === 'GET' && path === '/monitor/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'close' });
    sseClients++;
    res.write(': connected\n\n');
    res.write(`data: ${JSON.stringify({ sseClients, ts: new Date().toISOString() })}\n\n`);
    const onClose = () => {
      sseClients = Math.max(0, sseClients - 1);
      if (!res.writableEnded) res.end();
      if (req.socket && !req.socket.destroyed) req.socket.destroy();
    };
    req.on('close', onClose); req.on('aborted', onClose);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

// Patch close() so server.close(cb) works quickly in tests: destroy all connections first.
// Node ≥18 has closeAllConnections(); for older nodes we fall back to tracking sockets.
const _trackedSockets = new Set();
statusServer.on('connection', sock => {
  _trackedSockets.add(sock);
  sock.once('close', () => _trackedSockets.delete(sock));
});
const _origClose = statusServer.close.bind(statusServer);
statusServer.close = function(cb) {
  if (typeof statusServer.closeAllConnections === 'function') {
    statusServer.closeAllConnections();
  } else {
    for (const s of _trackedSockets) { try { s.destroy(); } catch (_) {} }
  }
  return _origClose(cb);
};

const _port = process.env.MONITOR_HTTP_PORT != null ? Number(process.env.MONITOR_HTTP_PORT)
  : (process.env.MONITOR_PORT != null ? Number(process.env.MONITOR_PORT) : 0);
try { statusServer.listen(_port); if (typeof statusServer.unref === 'function') statusServer.unref(); } catch (_) {}

function setSseClients(n) { sseClients = Number(n) || 0; return sseClients; }
function getSseClients() { return sseClients; }

module.exports = { statusServer, checkValidatorIdleState, setSseClients, getSseClients, VALIDATOR_IDLE_THRESHOLD_MS, get sseClients() { return sseClients; } };
