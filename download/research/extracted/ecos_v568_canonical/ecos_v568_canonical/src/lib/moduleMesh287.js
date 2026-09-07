'use strict';
/**
 * src/lib/moduleMesh287.js — ECOS V287 (Phase P175) — the coordination "nervous system"
 *
 * ECOS accumulated 370+ capability modules that mostly do not know about each
 * other. This turns that mass into ONE communicating intelligence:
 *
 *   1. CapabilityGraph287 — STATICALLY indexes every lib module's exported symbols
 *      (no require(), so zero side effects / open handles / boot risk), classifying
 *      each as class | function | constant, with version + derived tags.
 *   2. search287 / IntentRouter287 — natural-language intent → ranked capabilities,
 *      so the chat/agent layer routes to an existing module instead of hardcoding.
 *   3. MessageBus287 — audited publish/subscribe (with wildcard topics + bounded
 *      history) so modules can react to each other = smart automatic communication.
 *
 * Inspired by MCP capability catalogs, service-discovery, and event-mesh patterns.
 * Pure + dependency-free (R6 — fs/path builtins only); version-suffixed (…287).
 *
 * @version 287.0.0
 */

const fs = require('fs');
const path = require('path');

const MESH_VERSION_287 = '287.0.0';
const BUS_HISTORY_MAX_287 = 500;

// ── token / tag helpers ──────────────────────────────────────────────────────
function _splitTokens287(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')   // camelCase → camel Case
    .replace(/[_\-.]/g, ' ')
    .replace(/\d+/g, ' ')                        // drop version digits
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1);
}
function _classify287(sym) {
  if (/^[A-Z][A-Z0-9_]+$/.test(sym)) return 'constant';
  if (/^[A-Z]/.test(sym)) return 'class';
  return 'function';
}
function _versionOf287(moduleName) {
  const m = String(moduleName).match(/(\d{2,4})(?:\.js)?$/);
  return m ? parseInt(m[1], 10) : null;
}

// Statically extract exported symbol names from a module's source (no require).
function _extractExports287(src) {
  const names = new Set();
  // module.exports = { A, B, c: ..., D };
  for (const block of src.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)) {
    for (const part of block[1].split(',')) {
      const key = part.split(':')[0].trim().replace(/['"]/g, '');
      if (/^[A-Za-z_$][\w$]*$/.test(key)) names.add(key);
    }
  }
  // module.exports.Foo = ... ; exports.Foo = ...
  for (const m of src.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  return [...names];
}

// ── Capability graph ─────────────────────────────────────────────────────────
class CapabilityGraph287 {
  constructor() { this.capabilities = []; this.byModule = new Map(); this.builtAt = null; }

  /** Statically scan one or more directories of *.js modules. */
  build(dirs) {
    this.capabilities = []; this.byModule = new Map();
    const list = Array.isArray(dirs) ? dirs : [dirs];
    for (const dir of list) {
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.endsWith('.test.js')); }
      catch (_) { continue; }
      for (const file of files) {
        let src = '';
        try { src = fs.readFileSync(path.join(dir, file), 'utf8'); } catch (_) { continue; }
        const moduleName = file.replace(/\.js$/, '');
        const version = _versionOf287(moduleName);
        const moduleTags = _splitTokens287(moduleName);
        const syms = _extractExports287(src);
        const entry = { module: moduleName, version, dir, symbols: [] };
        for (const sym of syms) {
          const tags = [...new Set([..._splitTokens287(sym), ...moduleTags])];
          const cap = { id: `${moduleName}.${sym}`, symbol: sym, module: moduleName, version,
            kind: _classify287(sym), tags };
          this.capabilities.push(cap);
          entry.symbols.push(sym);
        }
        this.byModule.set(moduleName, entry);
      }
    }
    this.builtAt = new Date().toISOString();
    return this;
  }

  /** Rank capabilities by token overlap with the query (cheap semantic-ish match). */
  search(query, limit = 12) {
    const q = new Set(_splitTokens287(query));
    if (q.size === 0) return [];
    const scored = [];
    for (const cap of this.capabilities) {
      let score = 0;
      for (const t of cap.tags) if (q.has(t)) score += 1;
      // small boost when the symbol name itself overlaps
      for (const t of _splitTokens287(cap.symbol)) if (q.has(t)) score += 0.5;
      if (score > 0) scored.push({ ...cap, score: Math.round(score * 100) / 100 });
    }
    scored.sort((a, b) => b.score - a.score || (b.version || 0) - (a.version || 0));
    return scored.slice(0, limit);
  }

  /**
   * Collapse capabilities that are the same base symbol across versions to the
   * single newest version (e.g. creditReserve266/267/268.X → only the 268 one),
   * so routing points at the CURRENT implementation, not stale duplicates.
   */
  latest(caps) {
    const pool = caps || this.capabilities;
    const best = new Map(); // base-key -> cap with highest version
    for (const c of pool) {
      const baseSym = c.symbol.replace(/\d+$/, '');
      const baseMod = c.module.replace(/\d+$/, '');
      const key = `${baseMod}.${baseSym}`;
      const cur = best.get(key);
      if (!cur || (c.version || 0) > (cur.version || 0)) best.set(key, c);
    }
    return [...best.values()];
  }

  /** search() then collapse to newest version per capability. */
  searchLatest(query, limit = 12) {
    return this.latest(this.search(query, limit * 4)).slice(0, limit);
  }

  /** How many stale duplicate capabilities exist (an organize/health signal). */
  duplicationReport() {
    const total = this.capabilities.length;
    const latest = this.latest().length;
    return { total, distinctLatest: latest, staleDuplicates: total - latest };
  }

  stats() {
    const byKind = {};
    for (const c of this.capabilities) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
    return { modules: this.byModule.size, capabilities: this.capabilities.length, byKind,
      duplication: this.duplicationReport(), builtAt: this.builtAt };
  }
}

// ── Intent router ──────────────────────────────────────────────────────────—
class IntentRouter287 {
  constructor(graph) { this.graph = graph; }
  /** intent → a routing plan: best match + alternatives + confidence (no auto-exec). */
  route(intent, limit = 5) {
    const matches = this.graph.searchLatest(intent, limit);
    const top = matches[0] || null;
    const maxScore = top ? top.score : 0;
    const confidence = maxScore <= 0 ? 0 : Math.min(1, maxScore / (new Set(_splitTokens287(intent)).size || 1));
    return {
      intent,
      matched: matches.length > 0,
      best: top,
      alternatives: matches.slice(1),
      confidence: Math.round(confidence * 100) / 100,
      // routing is advisory; actual invocation must still pass the V240 interlock
      note: 'advisory routing only; invoke via the safety-gated dispatcher',
    };
  }
}

// ── Message bus (audited pub/sub for inter-module choreography) ───────────────
class MessageBus287 {
  constructor(opts = {}) {
    this.handlers = new Map();      // topic -> Set<fn>
    this.history = [];
    this.audit = typeof opts.audit === 'function' ? opts.audit : () => {};
    this.now = typeof opts.now === 'function' ? opts.now : Date.now;
  }
  subscribe(topic, handler) {
    if (typeof handler !== 'function') throw new Error('handler must be a function');
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic).add(handler);
    return () => { const s = this.handlers.get(topic); if (s) s.delete(handler); };
  }
  _matches(sub, topic) {
    if (sub === topic || sub === '*') return true;
    if (sub.endsWith('.*')) return topic.startsWith(sub.slice(0, -1)); // 'a.*' matches 'a.b'
    return false;
  }
  publish(topic, payload) {
    const msg = { topic, payload, at: new Date(this.now()).toISOString() };
    this.history.push(msg);
    if (this.history.length > BUS_HISTORY_MAX_287) this.history.shift();
    let delivered = 0;
    for (const [sub, set] of this.handlers.entries()) {
      if (this._matches(sub, topic)) {
        for (const fn of set) { try { fn(msg); delivered++; } catch (_) { /* isolate handler errors */ } }
      }
    }
    try { this.audit({ action: 'mesh_publish', topic, delivered }); } catch (_) {}
    return { topic, delivered };
  }
  topics() { return [...this.handlers.keys()]; }
  recent(n = 20) { return this.history.slice(-n); }
}

// ── Default singleton mesh (lazy-built) ──────────────────────────────────────
let _defaultGraph287 = null;
function defaultCapabilityGraph287(dirs) {
  if (!_defaultGraph287) { _defaultGraph287 = new CapabilityGraph287(); if (dirs) _defaultGraph287.build(dirs); }
  return _defaultGraph287;
}

module.exports = {
  MESH_VERSION_287, BUS_HISTORY_MAX_287,
  CapabilityGraph287, IntentRouter287, MessageBus287,
  defaultCapabilityGraph287,
  _splitTokens287, _classify287, _extractExports287, _versionOf287,
};
