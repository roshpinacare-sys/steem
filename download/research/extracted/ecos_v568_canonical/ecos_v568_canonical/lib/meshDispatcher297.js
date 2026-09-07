'use strict';
/**
 * lib/meshDispatcher297.js — ECOS V297 (Phase P185) — reason-indexed
 * activity feed, per-validator quorum stats, opt-in stream/persist auth
 * gate, and operator panel V8 (V296 split-pane + search box).
 *
 * V297 follows the four directions called out in NEXT_SESSION_PROMPT_V296.md.
 * All new identifiers end in 297. Purely additive on V287..V296.
 *
 *   1. ReasonIndexedFeed297       — bounded ring keyed by sanitized
 *                                   operatorReason + decision; searchable.
 *   2. PerValidatorQuorumStats297 — aggregates V296 stream entries by
 *                                   validatorAccountId (from tally).
 *   3. QuorumStreamAuthGate297    — opt-in Bearer-token gate behind
 *                                   ECOS_HITL_QUORUM_STREAM_TOKEN_V297.
 *   4. OperatorPanel297           — V8 split-pane. Extends V296 with a
 *                                   search box bound to ReasonIndexedFeed297.
 *
 * Pure + dependency-free (R3: only crypto builtin via timingSafeEqual).
 * Sacred files untouched (R1). All new identifiers end in 297 (R2).
 * V287..V296 surfaces preserved (R6).
 *
 * @version 297.0.0
 */

const crypto = require('crypto');
const D296   = require('./meshDispatcher296.js');

const BRIDGE_VERSION_297              = '297.0.0';
const STREAM_TOKEN_ENV_KEY_297        = 'ECOS_HITL_QUORUM_STREAM_TOKEN_V297';
const DEFAULT_REASON_FEED_MAX_297     = 500;
const DEFAULT_VALIDATOR_STATS_MAX_297 = 4096;
const MAX_QUERY_LEN_297               = 240;

// ─────────────────────────────────────────────────────────────────────────────
// 1) ReasonIndexedFeed297 — searchable bounded ring of stream entries
// ─────────────────────────────────────────────────────────────────────────────

function _normReason297(s) {
  if (s == null) return '';
  return String(s).toLowerCase();
}

class ReasonIndexedFeed297 {
  constructor(opts = {}) {
    this.max = Number.isFinite(opts.max)
      ? Math.max(1, Math.min(opts.max, 100000))
      : DEFAULT_REASON_FEED_MAX_297;
    this._ring = [];
    this._stats = { ingested: 0, dropped: 0, searches: 0, matched: 0, rejected: 0 };
  }

  // Bound to QuorumActivityStream296.subscribe()
  ingest(entry) {
    if (!entry || typeof entry !== 'object') { this._stats.rejected += 1; return; }
    this._stats.ingested += 1;
    this._ring.push(entry);
    if (this._ring.length > this.max) {
      this._ring.shift();
      this._stats.dropped += 1;
    }
  }

  /**
   * search({q, decision, limit})
   *   q        — substring of operatorReason (case-insensitive, ≤240 chars).
   *   decision — exact match against entry.decision ('met'|'short'|'refused').
   *   limit    — max entries to return (default 50, clamped [1, max]).
   * Returns newest-first.
   */
  search(opts = {}) {
    this._stats.searches += 1;
    let q = typeof opts.q === 'string' ? opts.q.trim() : '';
    if (q.length > MAX_QUERY_LEN_297) q = q.slice(0, MAX_QUERY_LEN_297);
    const qn = _normReason297(q);
    const decision = (opts.decision === 'met' || opts.decision === 'short' || opts.decision === 'refused')
      ? opts.decision : null;
    const limit = Number.isFinite(opts.limit)
      ? Math.max(1, Math.min(opts.limit | 0, this.max))
      : 50;

    const out = [];
    for (let i = this._ring.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this._ring[i];
      if (decision && e.decision !== decision) continue;
      if (qn) {
        const r = _normReason297(e.operatorReason);
        if (r.indexOf(qn) === -1) continue;
      }
      out.push(e);
    }
    this._stats.matched += out.length;
    return { ok: true, version: BRIDGE_VERSION_297, q, decision, limit, count: out.length, entries: out };
  }

  size() { return this._ring.length; }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_297,
      max:     this.max,
      size:    this._ring.length,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PerValidatorQuorumStats297 — aggregate stream entries by validator id
// ─────────────────────────────────────────────────────────────────────────────

class PerValidatorQuorumStats297 {
  constructor(opts = {}) {
    this.max = Number.isFinite(opts.max)
      ? Math.max(1, Math.min(opts.max, 1000000))
      : DEFAULT_VALIDATOR_STATS_MAX_297;
    this._by = new Map(); // validatorAccountId -> { met, short, refused, weight, lastAt }
    this._stats = { ingested: 0, validators: 0, rejected: 0, evicted: 0 };
  }

  ingest(entry) {
    if (!entry || typeof entry !== 'object') { this._stats.rejected += 1; return; }
    const tally = Array.isArray(entry.tally) ? entry.tally : [];
    this._stats.ingested += 1;
    const decision = (entry.decision === 'met' || entry.decision === 'short' || entry.decision === 'refused')
      ? entry.decision : 'short';
    for (const t of tally) {
      if (!t || typeof t.validatorAccountId !== 'string') continue;
      let rec = this._by.get(t.validatorAccountId);
      if (!rec) {
        if (this._by.size >= this.max) {
          // Evict the oldest-by-lastAt entry to stay bounded.
          let oldestKey = null, oldestAt = Infinity;
          for (const [k, v] of this._by) {
            const ts = Date.parse(v.lastAt || '') || 0;
            if (ts < oldestAt) { oldestAt = ts; oldestKey = k; }
          }
          if (oldestKey) { this._by.delete(oldestKey); this._stats.evicted += 1; }
        }
        rec = { met: 0, short: 0, refused: 0, weight: 0, lastAt: null };
        this._by.set(t.validatorAccountId, rec);
      }
      rec[decision] = (rec[decision] || 0) + 1;
      if (Number.isFinite(t.weight)) rec.weight = t.weight;
      rec.lastAt = entry.at || rec.lastAt;
    }
    this._stats.validators = this._by.size;
  }

  byValidator(opts = {}) {
    const limit = Number.isFinite(opts.limit)
      ? Math.max(1, Math.min(opts.limit | 0, this.max))
      : 100;
    const out = [];
    for (const [id, rec] of this._by) {
      out.push(Object.assign({ validatorAccountId: id }, rec,
        { total: (rec.met | 0) + (rec.short | 0) + (rec.refused | 0) }));
    }
    out.sort((a, b) => b.total - a.total);
    return {
      ok: true, version: BRIDGE_VERSION_297,
      count: Math.min(out.length, limit), total: out.length,
      validators: out.slice(0, limit),
    };
  }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_297, max: this.max, tracked: this._by.size,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) QuorumStreamAuthGate297 — opt-in Bearer token gate
// ─────────────────────────────────────────────────────────────────────────────

class QuorumStreamAuthGate297 {
  constructor(opts = {}) {
    this.env     = opts.env || process.env;
    this.envKey  = opts.envKey || STREAM_TOKEN_ENV_KEY_297;
    this._stats  = { checks: 0, allowed: 0, denied: 0, openPass: 0 };
  }

  enabled() {
    const v = this.env[this.envKey];
    return typeof v === 'string' && v.length > 0;
  }

  expectedToken() { return this.env[this.envKey] || null; }

  check(headerValue) {
    this._stats.checks += 1;
    if (!this.enabled()) {
      this._stats.openPass += 1;
      return { ok: true, version: BRIDGE_VERSION_297, allowed: true, reason: 'gate-off' };
    }
    const expected = this.expectedToken();
    const hdr = typeof headerValue === 'string' ? headerValue : '';
    if (!hdr || !/^Bearer\s+/i.test(hdr)) {
      this._stats.denied += 1;
      return { ok: false, version: BRIDGE_VERSION_297, allowed: false, code: 'MISSING_BEARER' };
    }
    const token = hdr.replace(/^Bearer\s+/i, '').trim();
    let match = false;
    try {
      const a = Buffer.from(token);
      const b = Buffer.from(expected);
      match = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (_) { match = false; }
    if (!match) {
      this._stats.denied += 1;
      return { ok: false, version: BRIDGE_VERSION_297, allowed: false, code: 'BAD_TOKEN' };
    }
    this._stats.allowed += 1;
    return { ok: true, version: BRIDGE_VERSION_297, allowed: true };
  }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_297, envKey: this.envKey, enabled: this.enabled(),
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) OperatorPanel297 — V8 split-pane (V296 controls + reason search box)
// ─────────────────────────────────────────────────────────────────────────────

class OperatorPanel297 {
  constructor(opts = {}) {
    this.title             = opts.title             || 'ECOS V297 — Operator Panel';
    this.registryPath      = opts.registryPath      || '/api/v1/mesh/validator/registry/v293';
    this.quorumApprovePath = opts.quorumApprovePath || '/api/v1/mesh/validator/{id}/quorum-approve/v296';
    this.quorumStreamPath  = opts.quorumStreamPath  || '/api/v1/mesh/validator/quorum/stream/v296';
    this.quorumSearchPath  = opts.quorumSearchPath  || '/api/v1/mesh/validator/quorum/search/v297';
    this.byValidatorPath   = opts.byValidatorPath   || '/api/v1/mesh/validator/quorum/by-validator/v297';
    this.panel296Path      = opts.panel296Path      || '/api/v1/mesh/operator/panel/v296';
    this.max               = Number.isFinite(opts.max) ? opts.max : 200;
  }

  renderHtml() {
    const safe = (s) => String(s).replace(/[<>&"]/g, '');
    const t    = safe(this.title);
    const reg  = safe(this.registryPath);
    const qa   = safe(this.quorumApprovePath);
    const qs   = safe(this.quorumStreamPath);
    const qsr  = safe(this.quorumSearchPath);
    const bv   = safe(this.byValidatorPath);
    const p296 = safe(this.panel296Path);
    const max  = this.max | 0;
    return [
      '<!doctype html>',
      '<html lang="en"><head><meta charset="utf-8">',
      '<title>' + t + '</title>',
      '<style>',
      'body{font:13px ui-monospace,Menlo,Consolas,monospace;background:#0b0d10;color:#d6e1ea;margin:0;padding:16px}',
      'h1{font-size:14px;font-weight:600;margin:0 0 12px;color:#7fd3a0}',
      'h2{font-size:13px;font-weight:600;margin:18px 0 6px;color:#9aa5af}',
      '.split{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}',
      '.pane{background:#11161b;border:1px solid #324049;padding:10px;border-radius:4px}',
      '.row{display:grid;grid-template-columns:160px 90px 70px 60px 1fr;gap:6px;padding:4px 6px;border-bottom:1px solid #1a2026;font-size:12px}',
      '.head{color:#7fd3a0;font-weight:600;border-bottom:1px solid #324049}',
      '.ok{color:#7fd3a0}.fail{color:#ff6b6b}.warn{color:#ffd166}',
      'button{background:#1a2026;color:#d6e1ea;border:1px solid #324049;padding:3px 8px;margin-right:4px;cursor:pointer;font:inherit}',
      'button.go{border-color:#7fd3a0;color:#7fd3a0}',
      'input,select,textarea{background:#0b0d10;color:#d6e1ea;border:1px solid #324049;padding:2px 6px;font:inherit;margin-right:4px}',
      'input.q{width:60%;box-sizing:border-box}',
      'a{color:#7fd3a0}',
      '#sstat{font-size:11px;color:#9aa5af}',
      '</style></head><body>',
      '<h1>' + t + '</h1>',
      '<div>V297 split-pane V8 — live SSE stream + reason search. V296 panel still at <a href="' + p296 + '">' + p296 + '</a></div>',
      '<div class="split">',
      // LEFT: live stream
      '<div class="pane">',
      '<h2>Live quorum stream <span id="sstat">(connecting…)</span></h2>',
      '<div class="row head"><div>at</div><div>decision</div><div>weight</div><div>thr</div><div>ticket / reason</div></div>',
      '<div id="feed"></div>',
      '</div>',
      // RIGHT: search box wired to V297 reason-indexed feed
      '<div class="pane">',
      '<h2>Search reason-indexed feed (V297)</h2>',
      '<div>',
      '<input class="q" id="q" placeholder="substring of operator reason"/>',
      '<select id="dec"><option value="">any decision</option><option>met</option><option>short</option><option>refused</option></select>',
      '<button class="go" id="goSearch">search</button>',
      '</div>',
      '<div class="row head"><div>at</div><div>decision</div><div>weight</div><div>thr</div><div>ticket / reason</div></div>',
      '<div id="hits"></div>',
      '</div>',
      '</div>',
      '<script>(function(){',
      'var QS="' + qs + '",QSR="' + qsr + '",MAX=' + max + ';',
      'var feed=document.getElementById("feed"),hits=document.getElementById("hits"),sstat=document.getElementById("sstat");',
      'function esc(s){return String(s==null?"":s).replace(/[<>&"]/g,function(x){return"&#"+x.charCodeAt(0)+";"})}',
      'function row(e){return "<div class=\\"row\\"><div>"+esc(e.at)+"</div><div>"+esc(e.decision)+"</div><div>"+esc(e.weight)+"</div><div>"+esc(e.threshold)+"</div><div>"+esc(e.ticketId||"")+" — "+esc(e.operatorReason||"")+"</div></div>"}',
      'function renderFeed(arr){feed.innerHTML=arr.slice(0,MAX).map(row).join("")}',
      'function renderHits(arr){hits.innerHTML=arr.map(row).join("")}',
      'var live=[];',
      'try{var ev=new EventSource(QS);ev.addEventListener("hello",function(){sstat.textContent="(live)"});ev.onmessage=function(m){try{var e=JSON.parse(m.data);live.unshift(e);renderFeed(live)}catch(_){}};ev.onerror=function(){sstat.textContent="(disconnected)"}}catch(_){sstat.textContent="(unsupported)"}',
      'document.getElementById("goSearch").onclick=function(){',
      'var q=encodeURIComponent(document.getElementById("q").value||"");',
      'var d=encodeURIComponent(document.getElementById("dec").value||"");',
      'fetch(QSR+"?q="+q+"&decision="+d).then(function(r){return r.json()}).then(function(j){renderHits(j.entries||[])}).catch(function(){renderHits([])})',
      '};',
      '})();</script>',
      '</body></html>',
    ].join('\n');
  }

  stats() {
    return {
      version:           BRIDGE_VERSION_297,
      title:             this.title,
      registryPath:      this.registryPath,
      quorumApprovePath: this.quorumApprovePath,
      quorumStreamPath:  this.quorumStreamPath,
      quorumSearchPath:  this.quorumSearchPath,
      byValidatorPath:   this.byValidatorPath,
      panel296Path:      this.panel296Path,
      max:               this.max,
    };
  }
}

module.exports = {
  BRIDGE_VERSION_297,
  STREAM_TOKEN_ENV_KEY_297,
  DEFAULT_REASON_FEED_MAX_297,
  DEFAULT_VALIDATOR_STATS_MAX_297,
  MAX_QUERY_LEN_297,
  ReasonIndexedFeed297,
  PerValidatorQuorumStats297,
  QuorumStreamAuthGate297,
  OperatorPanel297,
};
