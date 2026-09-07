'use strict';
/**
 * lib/meshDispatcher291.js — ECOS V291 (Phase P179) — operator-mesh follow-ups
 *
 * V290 made the V289 guarded mesh operator-actionable: REQUIRE_HITL outcomes
 * queue as real bridge tickets, the default playbook can auto-seed on boot,
 * callers can ask "latest impl of <base>" once, and a zero-dep HTML panel
 * surfaces guarded refusals + verification failures over SSE.
 *
 * V291 follows the four directions called out in NEXT_SESSION_PROMPT_V290.md.
 * All new identifiers end in 291. Purely additive on V287..V290.
 *
 *   1. HitlValidatorBridge291 — opt-in bridge between the V290 HitlBridge290
 *      ticket queue and the real `hitlGate.js` validator economics. Behind a
 *      flag (`ECOS_HITL_REAL_VALIDATOR_V291=1`). When the flag is off, or the
 *      gate / required fields are missing, calls fall through to the V290
 *      bridge unchanged. When on and a gate is provided, `submit()` also
 *      creates a `hitlGate.createApproval` record so destructive guarded calls
 *      can flow through the real 40/40/20 validator split. `approve()` /
 *      `reject()` mirror the operator decision into `hitlGate.resolveApproval`
 *      (AUTO_FLOW so the bridge stays self-sufficient when no human validator
 *      account is wired).
 *
 *   2. PlaybookOverlay291 — additive overlay (`DEFAULT_PLAYBOOK_291`) that
 *      teaches the choreography engine to react to the new bridge events
 *      (`hitl.created`, `hitl.approved`, `hitl.rejected`) without hand-wired
 *      glue. Composes with the V289 `DEFAULT_PLAYBOOK_289` — never replaces it.
 *
 *   3. ResolverDispatch291 — opt-in dispatch wrapper that lets callers request
 *      a capability by `<base>` (e.g. `creditReserve`) and resolves to a
 *      concrete version via V290's `LatestAliasResolver290`. Behind a per-call
 *      `{ byBase:true }` flag; without it, dispatch is unchanged.
 *
 *   4. OperatorPanel291 — extends V290's zero-dep operator panel with the
 *      bridge queue: polls `/api/v1/mesh/hitl/queue` every 2 s, renders
 *      pending tickets, and exposes inline approve / reject buttons that POST
 *      to the V290 endpoints. Still no bundler, still no npm dep.
 *
 * Pure + dependency-free (R6: only fs/path builtins). Sacred files untouched
 * (R1). All new identifiers end in 291 (R2). V287..V290 surfaces preserved
 * untouched (R6).
 *
 * @version 291.0.0
 */

const fs = require('fs');
const path = require('path');

const D288 = require('./meshDispatcher288.js');
const D289 = require('./meshDispatcher289.js');
const D290 = require('./meshDispatcher290.js');

const BRIDGE_VERSION_291    = '291.0.0';
const VALIDATOR_ENV_KEY_291 = 'ECOS_HITL_REAL_VALIDATOR_V291';
const DEFAULT_PRICE_USD_291 = '0.00';
const DEFAULT_MISSION_291   = 'mesh-bridge-v291';
const DEFAULT_CLIENT_291    = 'mesh-bridge-client-v291';

// ─────────────────────────────────────────────────────────────────────────────
// 1) HitlValidatorBridge291 — wires V290 bridge tickets into hitlGate
// ─────────────────────────────────────────────────────────────────────────────

class HitlValidatorBridge291 {
  /**
   * @param {object} opts
   * @param {object} opts.bridge        — V290 HitlBridge290 instance (required)
   * @param {object} [opts.hitlGate]    — real hitlGate.js instance (optional)
   * @param {object} [opts.env]         — defaults to process.env
   * @param {function} [opts.audit]
   */
  constructor(opts = {}) {
    if (!opts.bridge) throw new Error('HitlValidatorBridge291 requires {bridge}');
    this.bridge   = opts.bridge;
    this.hitlGate = opts.hitlGate || null;
    this.env      = opts.env || process.env;
    this.audit    = typeof opts.audit === 'function' ? opts.audit : () => {};
    /** ticketId -> approvalId */
    this._approvalByTicket = new Map();
    this._stats = { submitted: 0, gated: 0, fallback: 0, approved: 0, rejected: 0, gateErrors: 0 };
  }

  /** True iff the operator opted into real-validator economics. */
  enabled() {
    const v = this.env[VALIDATOR_ENV_KEY_291];
    return !!(this.hitlGate) && (v === '1' || v === 'true' || v === 'on');
  }

  /** Submit a guarded request. Always flows through the V290 bridge first.
   *  When the bridge produces a REQUIRE_HITL ticket AND real-validator mode
   *  is on, also create a `hitlGate.createApproval` record and stamp the
   *  approvalId onto the response. Self-contained: failures in the real gate
   *  never break the bridge ticket. */
  submit(req = {}) {
    this._stats.submitted += 1;
    const out = this.bridge.submit(req);
    if (!out.bridged || out.code !== 'REQUIRE_HITL') {
      this._stats.fallback += 1;
      return Object.assign({ validatorGated: false }, out);
    }
    if (!this.enabled()) {
      this._stats.fallback += 1;
      return Object.assign({ validatorGated: false }, out);
    }
    try {
      const approval = this.hitlGate.createApproval({
        missionId:       req.missionId       || DEFAULT_MISSION_291,
        clientAccountId: req.clientAccountId || DEFAULT_CLIENT_291,
        priceUsd:        req.priceUsd        || DEFAULT_PRICE_USD_291,
        aiOutput:        { capabilityId: req.capabilityId, args: req.args || [] },
        context:         { source: 'meshDispatcher291', ticketId: out.ticketId, tool: req.tool || null },
        confidence:      typeof req.confidence === 'number' ? req.confidence : null,
      });
      this._approvalByTicket.set(out.ticketId, approval.id);
      this._stats.gated += 1;
      this.audit({ action: 'validator.bridged', ticketId: out.ticketId, approvalId: approval.id });
      return Object.assign({ validatorGated: true, approvalId: approval.id }, out);
    } catch (e) {
      this._stats.gateErrors += 1;
      this.audit({ action: 'validator.error', ticketId: out.ticketId, error: e.message });
      return Object.assign({ validatorGated: false, validatorError: e.message }, out);
    }
  }

  /** Approve via the V290 bridge AND (if gated) resolve the linked approval
   *  through hitlGate. AUTO_FLOW is used so no human validator account is
   *  required for the bridge to function. */
  approve(ticketId, opts = {}) {
    const result = this.bridge.approve(ticketId, opts);
    const approvalId = this._approvalByTicket.get(String(ticketId || ''));
    if (approvalId && this.hitlGate) {
      try {
        this.hitlGate.resolveApproval(approvalId, {
          autoFlow: true, decision: 'approve', note: opts.note || 'bridge approve v291',
        });
        this._stats.approved += 1;
        this.audit({ action: 'validator.approved', ticketId, approvalId });
        return Object.assign({ validatorApprovalId: approvalId }, result);
      } catch (e) {
        this._stats.gateErrors += 1;
        this.audit({ action: 'validator.approveError', ticketId, approvalId, error: e.message });
        return Object.assign({ validatorApprovalId: approvalId, validatorError: e.message }, result);
      }
    }
    return result;
  }

  reject(ticketId, opts = {}) {
    const result = this.bridge.reject(ticketId, opts);
    const approvalId = this._approvalByTicket.get(String(ticketId || ''));
    if (approvalId && this.hitlGate) {
      try {
        this.hitlGate.resolveApproval(approvalId, {
          autoFlow: true, decision: 'reject', note: opts.note || 'bridge reject v291',
        });
        this._stats.rejected += 1;
        this.audit({ action: 'validator.rejected', ticketId, approvalId });
        return Object.assign({ validatorApprovalId: approvalId }, result);
      } catch (e) {
        this._stats.gateErrors += 1;
        return Object.assign({ validatorApprovalId: approvalId, validatorError: e.message }, result);
      }
    }
    return result;
  }

  /** Lookup the linked validator approvalId for a bridge ticket. */
  approvalIdFor(ticketId) {
    return this._approvalByTicket.get(String(ticketId || '')) || null;
  }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_291,
      enabled: this.enabled(),
      envKey:  VALIDATOR_ENV_KEY_291,
      linked:  this._approvalByTicket.size,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PlaybookOverlay291 — additive choreo rules for bridge events
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PLAYBOOK_291 = Object.freeze([
  { name: 'on-hitl-created',  topic: 'hitl.created',  query: 'alert digest status' },
  { name: 'on-hitl-approved', topic: 'hitl.approved', query: 'mesh stats summary' },
  { name: 'on-hitl-rejected', topic: 'hitl.rejected', query: 'alert digest status' },
]);

class PlaybookOverlay291 {
  /**
   * @param {object} opts
   * @param {object} opts.choreo  — V288 ChoreographyEngine288
   * @param {object} opts.graph   — V287 CapabilityGraph287
   */
  constructor(opts = {}) {
    if (!opts.choreo || !opts.graph) {
      throw new Error('PlaybookOverlay291 requires {choreo, graph}');
    }
    this.choreo = opts.choreo;
    this.graph  = opts.graph;
    this.seeded = [];
    this.skipped = [];
  }

  /** Seed the overlay rules. Idempotent: already-registered names are skipped. */
  seed() {
    this.seeded = [];
    this.skipped = [];
    const registered = new Set(this.choreo.list().map((r) => r.name));
    for (const rule of DEFAULT_PLAYBOOK_291) {
      if (registered.has(rule.name)) {
        this.skipped.push({ name: rule.name, topic: rule.topic, reason: 'already registered' });
        continue;
      }
      const matches = this.graph.searchLatest(rule.query, 1);
      const best = matches[0];
      if (!best) {
        this.skipped.push({ name: rule.name, topic: rule.topic, reason: 'no matching capability' });
        continue;
      }
      if (!D288._isSafeSymbol288(best.symbol)) {
        this.skipped.push({ name: rule.name, topic: rule.topic, reason: 'best match not safe: ' + best.id });
        continue;
      }
      try {
        this.choreo.register(rule.name, rule.topic, best.id);
        this.seeded.push({ name: rule.name, topic: rule.topic, capabilityId: best.id });
      } catch (e) {
        this.skipped.push({ name: rule.name, topic: rule.topic, reason: e.message });
      }
    }
    return { ok: true, version: BRIDGE_VERSION_291,
      seeded: this.seeded.slice(), skipped: this.skipped.slice() };
  }

  list() {
    return { rules: DEFAULT_PLAYBOOK_291.slice(),
      seeded: this.seeded.slice(), skipped: this.skipped.slice(),
      version: BRIDGE_VERSION_291 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) ResolverDispatch291 — dispatch by <base> via the V290 alias resolver
// ─────────────────────────────────────────────────────────────────────────────

class ResolverDispatch291 {
  /**
   * @param {object} opts
   * @param {object} opts.dispatcher  — V288 MeshDispatcher288 instance
   * @param {object} opts.resolver    — V290 LatestAliasResolver290 instance
   * @param {object} opts.graph       — V287 CapabilityGraph287 instance
   */
  constructor(opts = {}) {
    if (!opts.dispatcher || !opts.resolver || !opts.graph) {
      throw new Error('ResolverDispatch291 requires {dispatcher, resolver, graph}');
    }
    this.dispatcher = opts.dispatcher;
    this.resolver   = opts.resolver;
    this.graph      = opts.graph;
    this._stats = { resolved: 0, missed: 0, dispatched: 0 };
  }

  /** Resolve a `<base>` request to a concrete `module.symbol` capabilityId.
   *  When `symbol` is provided, the resolver picks the module and the caller
   *  picks the symbol on it. When omitted, we resolve only the module and let
   *  the caller pass a fully-qualified capabilityId. */
  resolveCapabilityId(base, symbol) {
    const r = this.resolver.resolve(base);
    if (!r.ok) { this._stats.missed += 1; return { ok: false, error: r.error || 'unresolved', via: r.via || null }; }
    this._stats.resolved += 1;
    if (!symbol) return { ok: true, module: r.module, via: r.via, capabilityId: null };
    return { ok: true, module: r.module, via: r.via, capabilityId: r.module + '.' + symbol };
  }

  /** Dispatch by base. Caller passes {byBase:true, base, symbol, args, ...}. */
  dispatch(req = {}) {
    if (!req.byBase) {
      // Pass-through: behave like the underlying dispatcher.
      return this.dispatcher.dispatch(req);
    }
    const res = this.resolveCapabilityId(req.base, req.symbol);
    if (!res.ok) return { ok: false, code: 'RESOLVE_MISS', error: res.error };
    if (!res.capabilityId) return { ok: false, code: 'SYMBOL_REQUIRED', module: res.module, via: res.via };
    const out = this.dispatcher.dispatch(Object.assign({}, req, {
      capabilityId: res.capabilityId,
      byBase: false,
    }));
    this._stats.dispatched += 1;
    return Object.assign({}, out, { resolvedFrom: req.base, via: res.via, capabilityId: res.capabilityId });
  }

  stats() {
    return Object.assign({ version: BRIDGE_VERSION_291 }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) OperatorPanel291 — V290 panel + HITL queue with inline approve/reject
// ─────────────────────────────────────────────────────────────────────────────

class OperatorPanel291 {
  /**
   * @param {object} [opts]
   * @param {string} [opts.streamPath='/api/v1/mesh/dispatch/stream']
   * @param {string} [opts.queuePath='/api/v1/mesh/hitl/queue']
   * @param {string} [opts.approvePath='/api/v1/mesh/hitl/{id}/approve']
   * @param {string} [opts.rejectPath='/api/v1/mesh/hitl/{id}/reject']
   * @param {string} [opts.title='ECOS V291 — Operator Panel']
   * @param {number} [opts.pollMs=2000]
   * @param {number} [opts.max=200]
   */
  constructor(opts = {}) {
    this.streamPath  = opts.streamPath  || '/api/v1/mesh/dispatch/stream';
    this.queuePath   = opts.queuePath   || '/api/v1/mesh/hitl/queue';
    this.approvePath = opts.approvePath || '/api/v1/mesh/hitl/{id}/approve';
    this.rejectPath  = opts.rejectPath  || '/api/v1/mesh/hitl/{id}/reject';
    this.title       = opts.title       || 'ECOS V291 — Operator Panel';
    this.pollMs      = Number.isFinite(opts.pollMs) ? opts.pollMs : 2000;
    this.max         = Number.isFinite(opts.max) ? opts.max : 200;
  }

  renderHtml() {
    const safe = (s) => String(s).replace(/[<>&"]/g, '');
    const t  = safe(this.title);
    const sp = safe(this.streamPath);
    const qp = safe(this.queuePath);
    const ap = safe(this.approvePath);
    const rp = safe(this.rejectPath);
    const max = this.max | 0;
    const pollMs = this.pollMs | 0;
    return [
      '<!doctype html>',
      '<html lang="en"><head><meta charset="utf-8">',
      '<title>' + t + '</title>',
      '<style>',
      'body{font:13px ui-monospace,Menlo,Consolas,monospace;background:#0b0d10;color:#d6e1ea;margin:0;padding:16px}',
      'h1{font-size:14px;font-weight:600;margin:0 0 12px;color:#7fd3a0}',
      'h2{font-size:13px;font-weight:600;margin:18px 0 6px;color:#9aa5af}',
      '.row{display:grid;grid-template-columns:170px 90px 120px 1fr;gap:8px;padding:4px 6px;border-bottom:1px solid #1a2026}',
      '.qrow{display:grid;grid-template-columns:220px 90px 1fr 160px;gap:8px;padding:4px 6px;border-bottom:1px solid #1a2026;align-items:center}',
      '.head{color:#7fd3a0;font-weight:600;border-bottom:1px solid #324049}',
      '.ok{color:#7fd3a0}.fail{color:#ff6b6b}.warn{color:#ffd166}',
      'button{background:#1a2026;color:#d6e1ea;border:1px solid #324049;padding:3px 8px;margin-right:4px;cursor:pointer;font:inherit}',
      'button.approve{border-color:#7fd3a0;color:#7fd3a0}',
      'button.reject{border-color:#ff6b6b;color:#ff6b6b}',
      '.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:8px;color:#9aa5af}',
      '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff6b6b;margin-right:6px;vertical-align:middle}',
      '.dot.live{background:#7fd3a0}',
      '</style></head><body>',
      '<h1>' + t + '</h1>',
      '<div class="toolbar"><span><span id="status" class="dot"></span><span id="statusText">connecting&hellip;</span></span>',
      '<span>events: <span id="count">0</span></span>',
      '<span>refusals: <span id="refusals" class="warn">0</span></span>',
      '<span>verify-failed: <span id="vfail" class="fail">0</span></span>',
      '<span>pending: <span id="pending" class="warn">0</span></span></div>',
      '<h2>HITL queue (poll ' + pollMs + 'ms)</h2>',
      '<div class="qrow head"><div>ticketId</div><div>status</div><div>capability</div><div>actions</div></div>',
      '<div id="queue"></div>',
      '<h2>Dispatch stream</h2>',
      '<div class="row head"><div>at</div><div>ok</div><div>code</div><div>capabilityId / error</div></div>',
      '<div id="log"></div>',
      '<script>(function(){',
      'var MAX=' + max + ',POLL=' + pollMs + ';',
      'var QP="' + qp + '",AP="' + ap + '",RP="' + rp + '";',
      'var log=document.getElementById("log"),qlog=document.getElementById("queue");',
      'var st=document.getElementById("status"),sx=document.getElementById("statusText");',
      'var c=document.getElementById("count"),rf=document.getElementById("refusals"),vf=document.getElementById("vfail"),pn=document.getElementById("pending");',
      'var n=0,refs=0,vfails=0;',
      'function esc(s){return String(s==null?"":s).replace(/[<>&"]/g,function(x){return"&#"+x.charCodeAt(0)+";"})}',
      'function add(e){n++;c.textContent=n;',
      'if(!e.ok){refs++;rf.textContent=refs}',
      'if(e.code==="VERIFY_FAILED"||(e.verification&&e.verification.verified===false)){vfails++;vf.textContent=vfails}',
      'var row=document.createElement("div");row.className="row";',
      'row.innerHTML="<div>"+esc(e.at)+"</div><div class=\\""+(e.ok?"ok":"fail")+"\\">"+(e.ok?"ok":"fail")+"</div><div>"+esc(e.code)+"</div><div>"+esc((e.capabilityId||"")+(e.error?(" \\u2014 "+e.error):""))+"</div>";',
      'log.insertBefore(row,log.firstChild);',
      'while(log.children.length>MAX)log.removeChild(log.lastChild)}',
      'function decide(id,kind){var u=(kind==="approve"?AP:RP).replace("{id}",encodeURIComponent(id));',
      'fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(function(){refreshQueue()}).catch(function(){})}',
      'function renderQueue(tickets){qlog.innerHTML="";var pend=0;tickets.forEach(function(t){if(t.status==="pending")pend++;',
      'var row=document.createElement("div");row.className="qrow";',
      'var cap=(t.request&&t.request.capabilityId)||"";',
      'var btns=t.status==="pending"?(\'<button class="approve" data-id="\'+esc(t.id)+\'" data-k="approve">approve</button><button class="reject" data-id="\'+esc(t.id)+\'" data-k="reject">reject</button>\'):esc(t.status);',
      'row.innerHTML="<div>"+esc(t.id)+"</div><div>"+esc(t.status)+"</div><div>"+esc(cap)+"</div><div>"+btns+"</div>";',
      'qlog.appendChild(row)});pn.textContent=pend;',
      'qlog.querySelectorAll("button").forEach(function(b){b.addEventListener("click",function(){decide(b.getAttribute("data-id"),b.getAttribute("data-k"))})})}',
      'function refreshQueue(){fetch(QP).then(function(r){return r.json()}).then(function(j){if(j&&j.tickets)renderQueue(j.tickets)}).catch(function(){})}',
      'refreshQueue();setInterval(refreshQueue,POLL);',
      'try{var es=new EventSource("' + sp + '");',
      'es.addEventListener("open",function(){st.className="dot live";sx.textContent="live"});',
      'es.addEventListener("mesh.dispatched",function(ev){try{add(JSON.parse(ev.data))}catch(_){}});',
      'es.addEventListener("error",function(){st.className="dot";sx.textContent="reconnecting\\u2026"});',
      '}catch(e){sx.textContent="SSE unavailable: "+e.message}',
      '})();</script>',
      '</body></html>',
    ].join('\n');
  }

  stats() {
    return {
      version: BRIDGE_VERSION_291,
      streamPath: this.streamPath, queuePath: this.queuePath,
      approvePath: this.approvePath, rejectPath: this.rejectPath,
      pollMs: this.pollMs, max: this.max,
    };
  }
}

module.exports = {
  BRIDGE_VERSION_291,
  VALIDATOR_ENV_KEY_291,
  DEFAULT_PRICE_USD_291,
  DEFAULT_MISSION_291,
  DEFAULT_CLIENT_291,
  DEFAULT_PLAYBOOK_291,
  HitlValidatorBridge291,
  PlaybookOverlay291,
  ResolverDispatch291,
  OperatorPanel291,
};
