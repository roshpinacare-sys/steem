// ============================================================
// src/lib/sessionStore225.js — Agent Sessions (P115/P118 support)
// V225 / Stage 4 helper. Ring-buffer (cap 1000, R2-style FIFO
// eviction) of agent sessions, each carrying the message log,
// step counter, and arbitrary metadata.
//
// Identifiers end in 225. No npm deps.
// ============================================================
'use strict';

const AGENT_SESSIONS_MAX_225 = 1000;
const _agentSessions225 = new Map();

function _evictSessions225() {
  while (_agentSessions225.size > AGENT_SESSIONS_MAX_225) {
    const firstKey = _agentSessions225.keys().next().value;
    if (firstKey === undefined) break;
    _agentSessions225.delete(firstKey);
  }
}

function _newSessionId225() {
  const r = Math.floor(Math.random() * 1e9).toString(36);
  return `sess_225_${Date.now().toString(36)}_${r}`;
}

function createSession225(initial) {
  const id = (initial && initial.id) || _newSessionId225();
  const sess = {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: Array.isArray(initial && initial.messages) ? initial.messages.slice() : [],
    steps: 0,
    status: 'idle',
    meta: (initial && initial.meta) || {},
  };
  _agentSessions225.set(id, sess);
  _evictSessions225();
  return sess;
}

function getSession225(id) { return _agentSessions225.get(id) || null; }

function appendMessage225(id, msg) {
  const s = _agentSessions225.get(id);
  if (!s) return null;
  if (!msg || typeof msg.role !== 'string') return s;
  s.messages.push(msg);
  s.updatedAt = Date.now();
  return s;
}

function bumpStep225(id) {
  const s = _agentSessions225.get(id);
  if (!s) return null;
  s.steps += 1;
  s.updatedAt = Date.now();
  return s;
}

function setStatus225(id, status) {
  const s = _agentSessions225.get(id);
  if (!s) return null;
  s.status = String(status);
  s.updatedAt = Date.now();
  return s;
}

function listSessions225(limit) {
  const arr = Array.from(_agentSessions225.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  if (typeof limit === 'number' && limit > 0) return arr.slice(0, limit);
  return arr;
}

function _resetSessions225() { _agentSessions225.clear(); }

module.exports = {
  AGENT_SESSIONS_MAX_225,
  _agentSessions225,
  _newSessionId225,
  createSession225,
  getSession225,
  appendMessage225,
  bumpStep225,
  setStatus225,
  listSessions225,
  _resetSessions225,
};
