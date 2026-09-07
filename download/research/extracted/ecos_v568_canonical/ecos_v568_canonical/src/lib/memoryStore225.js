// ============================================================
// src/lib/memoryStore225.js — Project & User Memory (P118)
// V225 / Stage 7 helper. Two scopes:
//   • 'project'  → mem://<key>          (keyed by projectId)
//   • 'user'     → mem://~user/<key>    (keyed by userId)
//
// API: get/set/del/list with FIFO eviction once over cap. Each
// scope keeps its own Map keyed by `${scopeId}|${key}`.
//
// Identifiers end in 225. No npm deps.
// ============================================================
'use strict';

const MEMORY_MAX_PER_SCOPE_225 = 500;
const MEMORY_VALUE_MAX_BYTES_225 = 64 * 1024;

const _memoryProject225 = new Map();
const _memoryUser225    = new Map();

function _pickStore225(scope) {
  if (scope === 'project') return _memoryProject225;
  if (scope === 'user')    return _memoryUser225;
  throw new Error('MEMORY_225: scope must be "project" or "user"');
}

function _composeKey225(scopeId, key) {
  if (!scopeId || typeof scopeId !== 'string') throw new Error('MEMORY_225: scopeId required');
  if (!key || typeof key !== 'string')          throw new Error('MEMORY_225: key required');
  if (key.length > 256)                         throw new Error('MEMORY_225: key too long');
  return `${scopeId}|${key}`;
}

function _evict225(store) {
  while (store.size > MEMORY_MAX_PER_SCOPE_225) {
    const firstKey = store.keys().next().value;
    if (firstKey === undefined) break;
    store.delete(firstKey);
  }
}

function setMemory225({ scope, scopeId, key, value, type = 'preference' }) {
  const store = _pickStore225(scope);
  const k = _composeKey225(scopeId, key);
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  if (Buffer.byteLength(v, 'utf8') > MEMORY_VALUE_MAX_BYTES_225) {
    return { ok: false, error: 'TOO_LARGE', code: 'TOO_LARGE_225' };
  }
  store.delete(k); // re-insert so eviction order reflects recency
  store.set(k, { scope, scopeId, key, value: v, type, updatedAt: Date.now() });
  _evict225(store);
  return { ok: true, scope, scopeId, key, type, bytes: Buffer.byteLength(v, 'utf8') };
}

function getMemory225({ scope, scopeId, key }) {
  const store = _pickStore225(scope);
  const k = _composeKey225(scopeId, key);
  const item = store.get(k);
  if (!item) return { ok: false, error: 'NOT_FOUND', code: 'NOT_FOUND_225' };
  return { ok: true, ...item };
}

function delMemory225({ scope, scopeId, key }) {
  const store = _pickStore225(scope);
  const k = _composeKey225(scopeId, key);
  const had = store.delete(k);
  return { ok: had, scope, scopeId, key };
}

function listMemory225({ scope, scopeId, type, limit }) {
  const store = _pickStore225(scope);
  const prefix = `${scopeId}|`;
  const out = [];
  for (const [k, v] of store.entries()) {
    if (!k.startsWith(prefix)) continue;
    if (type && v.type !== type) continue;
    out.push(v);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  const cap = typeof limit === 'number' && limit > 0 ? limit : 100;
  return { ok: true, scope, scopeId, count: out.length, items: out.slice(0, cap) };
}

function _resetMemory225() { _memoryProject225.clear(); _memoryUser225.clear(); }

module.exports = {
  MEMORY_MAX_PER_SCOPE_225,
  MEMORY_VALUE_MAX_BYTES_225,
  _memoryProject225,
  _memoryUser225,
  setMemory225, getMemory225, delMemory225, listMemory225,
  _resetMemory225,
};
