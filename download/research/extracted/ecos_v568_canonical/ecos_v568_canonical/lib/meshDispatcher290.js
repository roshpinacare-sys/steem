'use strict';
/**
 * lib/meshDispatcher290.js — ECOS V290 (Phase P178) — operator-grade mesh
 *
 * V289 made any capability — read OR mutating — callable from one guarded
 * entry-point (interlock + safe-invoker + verifier + AP2 receipts), shipped
 * a default playbook so the V288 choreo engine is value-on-boot, materialised
 * "latest" alias modules for stale duplicates, and streamed dispatch events
 * over SSE.
 *
 * V290 closes the remaining four loops the V289 next-session prompt called
 * out — all of them on top of the V289 guarded mesh, purely additive:
 *
 *   1. HitlBridge290 — wires the V289 `GuardedDispatcher289` `REQUIRE_HITL`
 *      outcome to a real operator-facing approval queue. A guarded call that
 *      classifies as destructive becomes a pending bridge ticket; the operator
 *      `approve(id)` resolution re-invokes the same capability via the
 *      mutating SafeInvoker288 (interlock bypass is explicit and audited),
 *      `reject(id)` records the refusal. Self-contained: does not depend on
 *      `hitlGate.js`'s billing path, so it works in any deploy.
 *
 *   2. PlaybookAutoseed290 — env-gated auto-seed of the V289
 *      `DefaultPlaybook289` so a fresh boot wakes up with choreography already
 *      wired (`ECOS_PLAYBOOK_AUTOSEED_V290=1`). Adds `diff()` so an operator
 *      can preview the seed against the currently registered rules without
 *      mutating anything.
 *
 *   3. LatestAliasResolver290 — a thin, read-only resolver that lets callers
 *      ask "what's the latest implementation of `<base>`?" once and let the
 *      V289 consolidation aliases (`<base>Latest289`) answer. Falls back to
 *      the highest-version member from the V287 capability graph when the
 *      alias has not been materialised yet. Pure, never mutates.
 *
 *   4. OperatorStreamPanel290 — a tiny zero-dependency operator HTML panel
 *      that subscribes to `/api/v1/mesh/dispatch/stream` and surfaces guarded
 *      refusals + verification failures in real time. Rendered by a single
 *      `renderHtml()` call so it ships as a string — no template engine, no
 *      bundler, no npm dep.
 *
 * Pure + dependency-free (R6: only fs/path builtins). Sacred files untouched
 * (R1). All new identifiers end in 290 (R2). V287 + V288 + V289 surfaces are
 * preserved untouched (R6).
 *
 * @version 290.0.0
 */

const fs = require('fs');
const path = require('path');

const D288 = require('./meshDispatcher288.js');
const D289 = require('./meshDispatcher289.js');
const Mesh287 = require('./moduleMesh287.js');

const BRIDGE_VERSION_290    = '290.0.0';
const BRIDGE_RING_MAX_290   = 500;
const AUTOSEED_ENV_KEY_290  = 'ECOS_PLAYBOOK_AUTOSEED_V290';
const ALIAS_SUFFIX_290      = 'Latest289'; // V290 consumes V289 aliases.

// ─────────────────────────────────────────────────────────────────────────────
// 1) HitlBridge290 — operator approval queue for guarded REQUIRE_HITL outcomes
// ─────────────────────────────────────────────────────────────────────────────

const HITL_STATUS_290 = Object.freeze({
  PENDING:  'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

class HitlBridge290 {
  /**
   * @param {object} opts
   * @param {object} opts.guarded — a V289 GuardedDispatcher289 instance
   * @param {string[]} [opts.libDirs]
   * @param {function} [opts.audit]
   */
  constructor(opts = {}) {
    if (!opts.guarded) throw new Error('HitlBridge290 requires {guarded}');
    this.guarded = opts.guarded;
    this.libDirs = Array.isArray(opts.libDirs) && opts.libDirs.length
      ? opts.libDirs : [path.resolve(__dirname)];
    // A dedicated mutating invoker so approvals can re-run destructive verbs
    // without re-triggering the interlock REQUIRE_HITL outcome.
    this.mutating = opts.mutatingInvoker
      || new D288.SafeInvoker288({ libDirs: this.libDirs, allowMutating: true });
    this.audit = typeof opts.audit === 'function' ? opts.audit : () => {};
    /** @type {Map<string,object>} ticketId -> ticket */
    this._tickets = new Map();
    /** @type {string[]} insertion-order list of ticketIds (FIFO) */
    this._order = [];
    this._stats = { created: 0, approved: 0, rejected: 0, expired: 0 };
  }

  /** Submit a guarded request through the bridge. If the guarded path returns
   *  REQUIRE_HITL, the request is enqueued and a pending ticket is returned.
   *  Otherwise the guarded outcome flows through unchanged. */
  submit(req = {}) {
    const out = this.guarded.dispatch(req);
    if (out.ok || out.code !== 'REQUIRE_HITL') return Object.assign({ bridged: false }, out);
    const id = 'hitl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const ticket = {
      id,
      status: HITL_STATUS_290.PENDING,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      request: {
        capabilityId: req.capabilityId,
        args: Array.isArray(req.args) ? req.args.slice() : [],
        tool: req.tool || null,
        intent: req.intent || null,
        userId: req.userId || null,
      },
      decision: out.decision || null,
      reasons: out.reasons || [],
      lastResult: null,
    };
    this._tickets.set(id, ticket);
    this._order.push(id);
    if (this._order.length > BRIDGE_RING_MAX_290) {
      const drop = this._order.shift();
      const t = this._tickets.get(drop);
      if (t && t.status === HITL_STATUS_290.PENDING) {
        t.status = HITL_STATUS_290.PENDING; // kept, but ring is full
      } else {
        this._tickets.delete(drop);
      }
    }
    this._stats.created += 1;
    this.audit({ action: 'hitl.created', ticketId: id, capabilityId: req.capabilityId });
    return { ok: false, bridged: true, code: 'REQUIRE_HITL', ticketId: id, ticket };
  }

  /** Operator approves: re-run the request through the mutating invoker
   *  (interlock bypass is explicit and audited via the ticket trail). */
  approve(ticketId, opts = {}) {
    const t = this._tickets.get(String(ticketId || ''));
    if (!t) return { ok: false, code: 'NOT_FOUND', error: 'ticket not found' };
    if (t.status !== HITL_STATUS_290.PENDING) {
      return { ok: false, code: 'ALREADY_RESOLVED', status: t.status, ticketId };
    }
    let invokeOk = true, invokeError = null, result = null, latencyMs = 0;
    try {
      const r = this.mutating.invoke(t.request.capabilityId, t.request.args);
      result = (r && Object.prototype.hasOwnProperty.call(r, 'result')) ? r.result : r && r.value;
      latencyMs = (r && r.latencyMs) || 0;
    } catch (e) {
      invokeOk = false;
      invokeError = e.message;
    }
    t.status = HITL_STATUS_290.APPROVED;
    t.resolvedAt = new Date().toISOString();
    t.approver = opts.approver || null;
    t.note = opts.note || null;
    t.lastResult = { ok: invokeOk, error: invokeError, latencyMs };
    this._stats.approved += 1;
    this.audit({ action: 'hitl.approved', ticketId, capabilityId: t.request.capabilityId, ok: invokeOk });
    return { ok: invokeOk, ticketId, status: t.status, result, error: invokeError, latencyMs };
  }

  /** Operator rejects: mark the ticket REJECTED and record the reason. */
  reject(ticketId, opts = {}) {
    const t = this._tickets.get(String(ticketId || ''));
    if (!t) return { ok: false, code: 'NOT_FOUND', error: 'ticket not found' };
    if (t.status !== HITL_STATUS_290.PENDING) {
      return { ok: false, code: 'ALREADY_RESOLVED', status: t.status, ticketId };
    }
    t.status = HITL_STATUS_290.REJECTED;
    t.resolvedAt = new Date().toISOString();
    t.rejector = opts.rejector || null;
    t.note = opts.note || null;
    this._stats.rejected += 1;
    this.audit({ action: 'hitl.rejected', ticketId, capabilityId: t.request.capabilityId });
    return { ok: true, ticketId, status: t.status };
  }

  get(ticketId) {
    const t = this._tickets.get(String(ticketId || ''));
    return t ? Object.assign({}, t) : null;
  }

  list(filter = {}) {
    const status = filter.status || null;
    const out = [];
    for (const id of this._order) {
      const t = this._tickets.get(id);
      if (!t) continue;
      if (status && t.status !== status) continue;
      out.push(Object.assign({}, t));
    }
    return out;
  }

  stats() {
    let pending = 0;
    for (const id of this._order) {
      const t = this._tickets.get(id);
      if (t && t.status === HITL_STATUS_290.PENDING) pending += 1;
    }
    return Object.assign({ version: BRIDGE_VERSION_290, pending }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PlaybookAutoseed290 — env-gated auto-seed + diff vs current rules
// ─────────────────────────────────────────────────────────────────────────────

class PlaybookAutoseed290 {
  /**
   * @param {object} opts
   * @param {object} opts.playbook  — V289 DefaultPlaybook289 instance
   * @param {object} opts.choreo    — V288 ChoreographyEngine288 instance
   * @param {object} [opts.env]     — defaults to process.env
   */
  constructor(opts = {}) {
    if (!opts.playbook || !opts.choreo) {
      throw new Error('PlaybookAutoseed290 requires {playbook, choreo}');
    }
    this.playbook = opts.playbook;
    this.choreo = opts.choreo;
    this.env = opts.env || process.env;
    this.lastBoot = null;
  }

  /** True iff the operator opted into auto-seed for this deploy. */
  enabled() {
    const v = this.env[AUTOSEED_ENV_KEY_290];
    return v === '1' || v === 'true' || v === 'on';
  }

  /** Dry-run: compute what seeding would add vs what's already registered. */
  diff() {
    const registered = new Map();
    for (const r of this.choreo.list()) registered.set(r.name, r);
    const list = this.playbook.list();
    const wouldSeed = [];
    const alreadyRegistered = [];
    const wouldSkip = [];
    for (const rule of list.rules) {
      const matches = this.playbook.graph.searchLatest(rule.query, 1);
      const best = matches[0];
      if (!best) { wouldSkip.push({ name: rule.name, reason: 'no matching capability' }); continue; }
      if (!D288._isSafeSymbol288(best.symbol)) {
        wouldSkip.push({ name: rule.name, reason: 'best match not safe: ' + best.id }); continue;
      }
      if (registered.has(rule.name)) {
        alreadyRegistered.push({ name: rule.name, current: registered.get(rule.name).capabilityId, would: best.id });
      } else {
        wouldSeed.push({ name: rule.name, topic: rule.topic, capabilityId: best.id });
      }
    }
    return {
      ok: true,
      enabled: this.enabled(),
      envKey: AUTOSEED_ENV_KEY_290,
      wouldSeed,
      alreadyRegistered,
      wouldSkip,
      version: BRIDGE_VERSION_290,
    };
  }

  /** If enabled, seed on boot. Idempotent: rules already present are left alone. */
  bootIfEnabled() {
    if (!this.enabled()) {
      this.lastBoot = { ok: true, enabled: false, seeded: [], skipped: [], at: new Date().toISOString() };
      return this.lastBoot;
    }
    const seed = this.playbook.seed();
    this.lastBoot = {
      ok: !!seed.ok, enabled: true,
      seeded: seed.seeded, skipped: seed.skipped,
      at: new Date().toISOString(),
      version: BRIDGE_VERSION_290,
    };
    return this.lastBoot;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) LatestAliasResolver290 — read-only "latest impl of <base>" lookup
// ─────────────────────────────────────────────────────────────────────────────

class LatestAliasResolver290 {
  /**
   * @param {object} opts
   * @param {object} opts.graph   — V287 CapabilityGraph287 instance
   * @param {string} [opts.libDir]
   */
  constructor(opts = {}) {
    if (!opts.graph) throw new Error('LatestAliasResolver290 requires {graph}');
    this.graph = opts.graph;
    this.libDir = opts.libDir || path.resolve(__dirname);
    this._cache = new Map();
  }

  /** Strip trailing version digits to get the base module name. */
  static baseOf290(moduleName) {
    return String(moduleName || '').replace(/\d+$/, '');
  }

  /**
   * Resolve "<base>" to {module, version, via}.
   *   via='alias'  — V289 consolidation alias `<base>Latest289.js` exists on disk
   *   via='graph'  — fell back to highest-version member from the V287 graph
   *   via=null     — nothing matched
   */
  resolve(base) {
    const b = String(base || '');
    if (!b) return { ok: false, error: 'base required' };
    if (this._cache.has(b)) return this._cache.get(b);
    const aliasFile = path.join(this.libDir, b + ALIAS_SUFFIX_290 + '.js');
    if (fs.existsSync(aliasFile)) {
      const ans = { ok: true, base: b, module: b + ALIAS_SUFFIX_290, aliasFile, via: 'alias', version: null };
      this._cache.set(b, ans);
      return ans;
    }
    // Fall back to the V287 graph.
    let best = null;
    for (const cap of this.graph.capabilities) {
      const cb = LatestAliasResolver290.baseOf290(cap.module);
      if (cb !== b) continue;
      if (!best || (cap.version || 0) > (best.version || 0)) {
        best = { module: cap.module, version: cap.version || 0 };
      }
    }
    if (!best) {
      const ans = { ok: false, base: b, via: null, error: 'no capability matches base' };
      this._cache.set(b, ans);
      return ans;
    }
    const ans = { ok: true, base: b, module: best.module, version: best.version, via: 'graph' };
    this._cache.set(b, ans);
    return ans;
  }

  /** List every base that has at least one capability in the graph. */
  bases() {
    const set = new Set();
    for (const cap of this.graph.capabilities) {
      set.add(LatestAliasResolver290.baseOf290(cap.module));
    }
    return [...set].sort();
  }

  stats() {
    let aliasCount = 0, graphCount = 0;
    for (const b of this.bases()) {
      const r = this.resolve(b);
      if (!r.ok) continue;
      if (r.via === 'alias') aliasCount += 1; else graphCount += 1;
    }
    return { version: BRIDGE_VERSION_290, bases: this.bases().length, aliasCount, graphCount };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) OperatorStreamPanel290 — zero-dep HTML panel over the SSE dispatch stream
// ─────────────────────────────────────────────────────────────────────────────

class OperatorStreamPanel290 {
  /**
   * @param {object} [opts]
   * @param {string} [opts.streamPath='/api/v1/mesh/dispatch/stream']
   * @param {string} [opts.title='ECOS V290 — Operator Stream']
   * @param {number} [opts.max=200]   — max rows to render before trimming
   */
  constructor(opts = {}) {
    this.streamPath = opts.streamPath || '/api/v1/mesh/dispatch/stream';
    this.title = opts.title || 'ECOS V290 — Operator Stream';
    this.max = Number.isFinite(opts.max) ? opts.max : 200;
  }

  /** Render a self-contained operator panel. Pure HTML+inline JS; no deps. */
  renderHtml() {
    const safeTitle = String(this.title).replace(/[<>&]/g, '');
    const safePath = String(this.streamPath).replace(/["<>]/g, '');
    const max = this.max | 0;
    return [
      '<!doctype html>',
      '<html lang="en"><head><meta charset="utf-8">',
      '<title>' + safeTitle + '</title>',
      '<style>',
      'body{font:13px ui-monospace,Menlo,Consolas,monospace;background:#0b0d10;color:#d6e1ea;margin:0;padding:16px}',
      'h1{font-size:14px;font-weight:600;margin:0 0 12px;color:#7fd3a0}',
      '.row{display:grid;grid-template-columns:170px 90px 120px 1fr;gap:8px;padding:4px 6px;border-bottom:1px solid #1a2026}',
      '.row.head{color:#7fd3a0;font-weight:600;border-bottom:1px solid #324049}',
      '.ok{color:#7fd3a0}.fail{color:#ff6b6b}.warn{color:#ffd166}',
      '.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:8px;color:#9aa5af}',
      '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff6b6b;margin-right:6px;vertical-align:middle}',
      '.dot.live{background:#7fd3a0}',
      '</style></head><body>',
      '<h1>' + safeTitle + '</h1>',
      '<div class="toolbar"><span><span id="status" class="dot"></span><span id="statusText">connecting…</span></span>',
      '<span>events: <span id="count">0</span></span>',
      '<span>refusals: <span id="refusals" class="warn">0</span></span>',
      '<span>verify-failed: <span id="vfail" class="fail">0</span></span></div>',
      '<div class="row head"><div>at</div><div>ok</div><div>code</div><div>capabilityId / error</div></div>',
      '<div id="log"></div>',
      '<script>(function(){',
      'var MAX=' + max + ';',
      'var log=document.getElementById("log");',
      'var st=document.getElementById("status"),sx=document.getElementById("statusText");',
      'var c=document.getElementById("count"),rf=document.getElementById("refusals"),vf=document.getElementById("vfail");',
      'var n=0,refs=0,vfails=0;',
      'function add(e){n++;c.textContent=n;',
      'if(!e.ok){refs++;rf.textContent=refs}',
      'if(e.code==="VERIFY_FAILED"||(e.verification&&e.verification.verified===false)){vfails++;vf.textContent=vfails}',
      'var row=document.createElement("div");row.className="row";',
      'row.innerHTML=\'<div>\'+(e.at||"")+\'</div><div class="\'+(e.ok?"ok":"fail")+\'">\'+(e.ok?"ok":"fail")+\'</div><div>\'+(e.code||"")+\'</div><div>\'+((e.capabilityId||"")+(e.error?(" — "+e.error):""))+\'</div>\';',
      'log.insertBefore(row,log.firstChild);',
      'while(log.children.length>MAX)log.removeChild(log.lastChild)}',
      'try{var es=new EventSource("' + safePath + '");',
      'es.addEventListener("open",function(){st.className="dot live";sx.textContent="live"});',
      'es.addEventListener("mesh.dispatched",function(ev){try{add(JSON.parse(ev.data))}catch(_){}});',
      'es.addEventListener("error",function(){st.className="dot";sx.textContent="reconnecting…"});',
      '}catch(e){sx.textContent="SSE unavailable: "+e.message}',
      '})();</script>',
      '</body></html>',
    ].join('\n');
  }

  stats() {
    return { version: BRIDGE_VERSION_290, streamPath: this.streamPath, max: this.max };
  }
}

module.exports = {
  BRIDGE_VERSION_290,
  BRIDGE_RING_MAX_290,
  AUTOSEED_ENV_KEY_290,
  ALIAS_SUFFIX_290,
  HITL_STATUS_290,
  HitlBridge290,
  PlaybookAutoseed290,
  LatestAliasResolver290,
  OperatorStreamPanel290,
};
