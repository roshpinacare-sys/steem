'use strict';
/**
 * lib/meshDispatcher293.js — ECOS V293 (Phase P181) — registry-guarded mesh follow-ups
 *
 * V292 added per-validator account binding, resolver-cache invalidation,
 * overlay metrics, and an operator panel with a per-ticket detail view.
 *
 * V293 follows the four directions called out in NEXT_SESSION_PROMPT_V292.md.
 * All new identifiers end in 293. Purely additive on V287..V292.
 *
 *   1. ValidatorAccountRegistry293 — in-memory directory of validator
 *      accounts (`registerValidator(accountId, {displayName, weight})`).
 *      When `ECOS_HITL_VALIDATOR_REGISTRY_V293=1`, the V292 account-bound
 *      approve/reject path must supply a registered `validatorAccountId` or
 *      the call is refused (without the flag the registry is informational).
 *
 *   2. RegistryGuardedAccountBinding293 — thin wrapper around the V292
 *      `ValidatorAccountBinding292` that consults the V293 registry before
 *      calling approve()/reject(). When the registry flag is on AND the
 *      accountId is unknown, the call is refused (ok:false, code REGISTRY_UNKNOWN);
 *      otherwise it falls through to V292 unchanged.
 *
 *   3. BasesView293 — surfaces every resolvable `<base>` from the graph
 *      together with its currently-cached resolver entry (via + module) so
 *      the operator can decide which keys to invalidate.
 *
 *   4. OverlayHistory293 — subscribes to every topic in
 *      `DEFAULT_PLAYBOOK_291` on the V287 MessageBus287 and keeps the last
 *      20 fires per rule (topic, at, payload summary).
 *
 *   5. OperatorPanel293 — extends V292 with a `validatorAccountId` text
 *      input on every pending ticket row and POSTs to the V292
 *      `/api/v1/mesh/validator/:id/{approve,reject}/v292` endpoints so the
 *      real account-bound HITL path is exercised from the panel.
 *
 * Pure + dependency-free (R3: only fs/path). Sacred files untouched (R1).
 * All new identifiers end in 293 (R2). V287..V292 surfaces preserved (R6).
 *
 * @version 293.0.0
 */

const fs = require('fs');
const path = require('path');

const D291 = require('./meshDispatcher291.js');
const D292 = require('./meshDispatcher292.js');

const BRIDGE_VERSION_293  = '293.0.0';
const REGISTRY_ENV_KEY_293 = 'ECOS_HITL_VALIDATOR_REGISTRY_V293';

// ─────────────────────────────────────────────────────────────────────────────
// 1) ValidatorAccountRegistry293 — in-memory validator directory
// ─────────────────────────────────────────────────────────────────────────────

class ValidatorAccountRegistry293 {
  constructor(opts = {}) {
    this.env = opts.env || process.env;
    this.audit = typeof opts.audit === 'function' ? opts.audit : () => {};
    this._accounts = new Map(); // id -> {id, displayName, weight, registeredAt}
    this._stats = { registered: 0, unregistered: 0, lookups: 0, refused: 0 };
  }

  enabled() {
    const v = this.env[REGISTRY_ENV_KEY_293];
    return v === '1' || v === 'true' || v === 'on';
  }

  registerValidator(accountId, meta = {}) {
    const id = String(accountId || '').trim();
    if (!id) throw new Error('ValidatorAccountRegistry293: accountId required');
    const rec = {
      id,
      displayName: String(meta.displayName || id),
      weight: Number.isFinite(meta.weight) ? meta.weight : 1,
      registeredAt: new Date().toISOString(),
    };
    const isNew = !this._accounts.has(id);
    this._accounts.set(id, rec);
    if (isNew) this._stats.registered += 1;
    this.audit({ action: 'v293.registry.register', accountId: id, isNew });
    return Object.assign({ ok: true, isNew, version: BRIDGE_VERSION_293 }, rec);
  }

  unregister(accountId) {
    const id = String(accountId || '');
    const had = this._accounts.delete(id);
    if (had) this._stats.unregistered += 1;
    this.audit({ action: 'v293.registry.unregister', accountId: id, had });
    return { ok: true, removed: had ? 1 : 0, size: this._accounts.size, version: BRIDGE_VERSION_293 };
  }

  has(accountId) { return this._accounts.has(String(accountId || '')); }
  get(accountId) { return this._accounts.get(String(accountId || '')) || null; }

  list() {
    return {
      ok: true,
      version: BRIDGE_VERSION_293,
      enabled: this.enabled(),
      envKey: REGISTRY_ENV_KEY_293,
      size: this._accounts.size,
      accounts: [...this._accounts.values()],
    };
  }

  /** When enabled and accountId is non-empty, asserts the id is registered.
   *  Returns { ok, code?, account? }. */
  check(accountId) {
    this._stats.lookups += 1;
    if (!this.enabled()) return { ok: true, enforced: false };
    if (!accountId) return { ok: true, enforced: true, account: null };
    const rec = this._accounts.get(String(accountId));
    if (!rec) {
      this._stats.refused += 1;
      return { ok: false, enforced: true, code: 'REGISTRY_UNKNOWN', accountId: String(accountId) };
    }
    return { ok: true, enforced: true, account: rec };
  }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_293,
      envKey: REGISTRY_ENV_KEY_293,
      enabled: this.enabled(),
      size: this._accounts.size,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) RegistryGuardedAccountBinding293 — V292 binding + registry pre-check
// ─────────────────────────────────────────────────────────────────────────────

class RegistryGuardedAccountBinding293 {
  /**
   * @param {object} opts
   * @param {D292.ValidatorAccountBinding292} opts.binding
   * @param {ValidatorAccountRegistry293} opts.registry
   * @param {function} [opts.audit]
   */
  constructor(opts = {}) {
    if (!opts.binding || !opts.registry) {
      throw new Error('RegistryGuardedAccountBinding293 requires {binding, registry}');
    }
    this.binding  = opts.binding;
    this.registry = opts.registry;
    this.audit    = typeof opts.audit === 'function' ? opts.audit : () => {};
    this._stats = { approves: 0, rejects: 0, refused: 0, passed: 0 };
  }

  approve(ticketId, opts = {}) {
    this._stats.approves += 1;
    const check = this.registry.check(opts.validatorAccountId);
    if (!check.ok) {
      this._stats.refused += 1;
      this.audit({ action: 'v293.guard.refuse', ticketId, accountId: opts.validatorAccountId, code: check.code });
      return {
        ok: false, code: check.code, refused: true,
        accountId: opts.validatorAccountId || null,
        version: BRIDGE_VERSION_293, enforced: check.enforced,
      };
    }
    this._stats.passed += 1;
    const out = this.binding.approve(ticketId, opts);
    return Object.assign({}, out, {
      registryEnforced: !!check.enforced,
      registryAccount: check.account || null,
      version: BRIDGE_VERSION_293,
    });
  }

  reject(ticketId, opts = {}) {
    this._stats.rejects += 1;
    const check = this.registry.check(opts.validatorAccountId);
    if (!check.ok) {
      this._stats.refused += 1;
      this.audit({ action: 'v293.guard.refuse', ticketId, accountId: opts.validatorAccountId, code: check.code });
      return {
        ok: false, code: check.code, refused: true,
        accountId: opts.validatorAccountId || null,
        version: BRIDGE_VERSION_293, enforced: check.enforced,
      };
    }
    this._stats.passed += 1;
    const out = this.binding.reject(ticketId, opts);
    return Object.assign({}, out, {
      registryEnforced: !!check.enforced,
      registryAccount: check.account || null,
      version: BRIDGE_VERSION_293,
    });
  }

  stats() {
    return Object.assign({ version: BRIDGE_VERSION_293 }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) BasesView293 — every resolvable <base> + cached resolver entry
// ─────────────────────────────────────────────────────────────────────────────

class BasesView293 {
  /**
   * @param {object} opts
   * @param {object} opts.resolver — V290 LatestAliasResolver290
   */
  constructor(opts = {}) {
    if (!opts.resolver) throw new Error('BasesView293 requires {resolver}');
    this.resolver = opts.resolver;
  }

  list() {
    const bases = typeof this.resolver.bases === 'function' ? this.resolver.bases() : [];
    const cache = this.resolver._cache;
    const out = bases.map((base) => {
      const cached = !!(cache && cache.has(base));
      const entry  = cached ? cache.get(base) : null;
      return {
        base,
        cached,
        via:    entry ? (entry.via || null) : null,
        module: entry ? (entry.module || null) : null,
        ok:     entry ? !!entry.ok : null,
      };
    });
    const cachedCount = out.filter((b) => b.cached).length;
    return {
      ok: true,
      version: BRIDGE_VERSION_293,
      count: out.length,
      cached: cachedCount,
      uncached: out.length - cachedCount,
      bases: out,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) OverlayHistory293 — last 20 fires per V291 overlay rule
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_LIMIT_293 = 20;

class OverlayHistory293 {
  /**
   * @param {object} opts
   * @param {object} opts.bus — V287 MessageBus287
   * @param {number} [opts.limit=20]
   */
  constructor(opts = {}) {
    if (!opts.bus) throw new Error('OverlayHistory293 requires {bus}');
    this.bus    = opts.bus;
    this.limit  = Number.isFinite(opts.limit) ? opts.limit : HISTORY_LIMIT_293;
    this._rings = new Map(); // ruleName -> [{at, topic, summary}]
    this._totals = new Map(); // ruleName -> count
    this._unsubs = [];
    this._subscribe();
  }

  _subscribe() {
    for (const rule of D291.DEFAULT_PLAYBOOK_291) {
      this._rings.set(rule.name, []);
      this._totals.set(rule.name, 0);
      const off = this.bus.subscribe(rule.topic, (msg) => this._record(rule.name, msg));
      this._unsubs.push(off);
    }
  }

  _record(ruleName, msg) {
    const ring = this._rings.get(ruleName);
    if (!ring) return;
    ring.push({
      at: msg.at,
      topic: msg.topic,
      summary: this._summarize(msg.payload),
    });
    while (ring.length > this.limit) ring.shift();
    this._totals.set(ruleName, (this._totals.get(ruleName) || 0) + 1);
  }

  _summarize(payload) {
    if (payload == null) return null;
    if (typeof payload !== 'object') return String(payload).slice(0, 200);
    const keys = Object.keys(payload).slice(0, 6);
    const out = {};
    for (const k of keys) {
      const v = payload[k];
      if (v == null) { out[k] = v; continue; }
      if (typeof v === 'object') out[k] = Array.isArray(v) ? ('array(' + v.length + ')') : 'object';
      else out[k] = typeof v === 'string' ? v.slice(0, 80) : v;
    }
    return out;
  }

  history(ruleName) {
    if (ruleName) {
      const ring = this._rings.get(ruleName) || [];
      return {
        ok: true, version: BRIDGE_VERSION_293, rule: ruleName,
        total: this._totals.get(ruleName) || 0,
        size: ring.length, limit: this.limit, entries: ring.slice(),
      };
    }
    const rules = D291.DEFAULT_PLAYBOOK_291.map((r) => {
      const ring = this._rings.get(r.name) || [];
      return {
        name: r.name, topic: r.topic,
        total: this._totals.get(r.name) || 0,
        size: ring.length, entries: ring.slice(),
      };
    });
    const total = rules.reduce((a, r) => a + r.total, 0);
    return { ok: true, version: BRIDGE_VERSION_293, limit: this.limit, totalFires: total, rules };
  }

  dispose() {
    while (this._unsubs.length) { try { this._unsubs.pop()(); } catch (_) {} }
  }

  stats() {
    return {
      version: BRIDGE_VERSION_293,
      limit: this.limit,
      rules: this._rings.size,
      totalFires: [...this._totals.values()].reduce((a, b) => a + b, 0),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) OperatorPanel293 — V292 panel + validator-account-bound approve/reject
// ─────────────────────────────────────────────────────────────────────────────

class OperatorPanel293 {
  constructor(opts = {}) {
    this.streamPath       = opts.streamPath       || '/api/v1/mesh/dispatch/stream';
    this.queueStreamPath  = opts.queueStreamPath  || '/api/v1/mesh/hitl/queue/stream';
    this.queuePath        = opts.queuePath        || '/api/v1/mesh/hitl/queue';
    this.ticketPath       = opts.ticketPath       || '/api/v1/mesh/hitl/{id}';
    this.approvePath      = opts.approvePath      || '/api/v1/mesh/hitl/{id}/approve';
    this.rejectPath       = opts.rejectPath       || '/api/v1/mesh/hitl/{id}/reject';
    this.approveV292Path  = opts.approveV292Path  || '/api/v1/mesh/validator/{id}/approve/v292';
    this.rejectV292Path   = opts.rejectV292Path   || '/api/v1/mesh/validator/{id}/reject/v292';
    this.registryPath     = opts.registryPath     || '/api/v1/mesh/validator/registry/v293';
    this.title            = opts.title            || 'ECOS V293 — Operator Panel';
    this.pollFallbackMs   = Number.isFinite(opts.pollFallbackMs) ? opts.pollFallbackMs : 5000;
    this.max              = Number.isFinite(opts.max) ? opts.max : 200;
  }

  renderHtml() {
    const safe = (s) => String(s).replace(/[<>&"]/g, '');
    const t   = safe(this.title);
    const sp  = safe(this.streamPath);
    const qs  = safe(this.queueStreamPath);
    const qp  = safe(this.queuePath);
    const tp  = safe(this.ticketPath);
    const ap  = safe(this.approvePath);
    const rp  = safe(this.rejectPath);
    const a292 = safe(this.approveV292Path);
    const r292 = safe(this.rejectV292Path);
    const reg  = safe(this.registryPath);
    const max = this.max | 0;
    const fallback = this.pollFallbackMs | 0;
    return [
      '<!doctype html>',
      '<html lang="en"><head><meta charset="utf-8">',
      '<title>' + t + '</title>',
      '<style>',
      'body{font:13px ui-monospace,Menlo,Consolas,monospace;background:#0b0d10;color:#d6e1ea;margin:0;padding:16px}',
      'h1{font-size:14px;font-weight:600;margin:0 0 12px;color:#7fd3a0}',
      'h2{font-size:13px;font-weight:600;margin:18px 0 6px;color:#9aa5af}',
      '.row{display:grid;grid-template-columns:170px 90px 120px 1fr;gap:8px;padding:4px 6px;border-bottom:1px solid #1a2026}',
      '.qrow{display:grid;grid-template-columns:200px 80px 1fr 360px;gap:8px;padding:4px 6px;border-bottom:1px solid #1a2026;align-items:center}',
      '.head{color:#7fd3a0;font-weight:600;border-bottom:1px solid #324049}',
      '.ok{color:#7fd3a0}.fail{color:#ff6b6b}.warn{color:#ffd166}',
      'button{background:#1a2026;color:#d6e1ea;border:1px solid #324049;padding:3px 8px;margin-right:4px;cursor:pointer;font:inherit}',
      'button.approve{border-color:#7fd3a0;color:#7fd3a0}',
      'button.reject{border-color:#ff6b6b;color:#ff6b6b}',
      'button.detail{border-color:#9aa5af;color:#9aa5af}',
      'button.bound{border-color:#ffd166;color:#ffd166}',
      'input.acct{background:#0b0d10;color:#d6e1ea;border:1px solid #324049;padding:2px 6px;font:inherit;width:110px;margin-right:4px}',
      '.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:8px;color:#9aa5af}',
      '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff6b6b;margin-right:6px;vertical-align:middle}',
      '.dot.live{background:#7fd3a0}',
      '#detail{background:#11161b;border:1px solid #324049;padding:10px;margin-top:8px;display:none;white-space:pre-wrap}',
      '#detail.show{display:block}',
      '#flash{margin-top:6px;color:#ffd166;min-height:1em}',
      '</style></head><body>',
      '<h1>' + t + '</h1>',
      '<div class="toolbar"><span><span id="status" class="dot"></span><span id="statusText">connecting&hellip;</span></span>',
      '<span>queue: <span id="qStatus">poll</span></span>',
      '<span>events: <span id="count">0</span></span>',
      '<span>refusals: <span id="refusals" class="warn">0</span></span>',
      '<span>verify-failed: <span id="vfail" class="fail">0</span></span>',
      '<span>pending: <span id="pending" class="warn">0</span></span>',
      '<span>registry: <span id="regSize">?</span></span></div>',
      '<h2>HITL queue (SSE + ' + fallback + 'ms fallback poll) — account-bound actions use V292 endpoints</h2>',
      '<div class="qrow head"><div>ticketId</div><div>status</div><div>capability</div><div>actions</div></div>',
      '<div id="queue"></div>',
      '<div id="flash"></div>',
      '<pre id="detail"></pre>',
      '<h2>Dispatch stream</h2>',
      '<div class="row head"><div>at</div><div>ok</div><div>code</div><div>capabilityId / error</div></div>',
      '<div id="log"></div>',
      '<script>(function(){',
      'var MAX=' + max + ',FALLBACK=' + fallback + ';',
      'var QP="' + qp + '",AP="' + ap + '",RP="' + rp + '",TP="' + tp + '",QS="' + qs + '";',
      'var A292="' + a292 + '",R292="' + r292 + '",REG="' + reg + '";',
      'var log=document.getElementById("log"),qlog=document.getElementById("queue"),detail=document.getElementById("detail");',
      'var st=document.getElementById("status"),sx=document.getElementById("statusText"),qst=document.getElementById("qStatus");',
      'var c=document.getElementById("count"),rf=document.getElementById("refusals"),vf=document.getElementById("vfail"),pn=document.getElementById("pending"),rsz=document.getElementById("regSize"),flash=document.getElementById("flash");',
      'var n=0,refs=0,vfails=0;',
      'function esc(s){return String(s==null?"":s).replace(/[<>&"]/g,function(x){return"&#"+x.charCodeAt(0)+";"})}',
      'function flashMsg(m,cls){flash.textContent=m;flash.className=cls||"warn";setTimeout(function(){if(flash.textContent===m)flash.textContent=""},4000)}',
      'function add(e){n++;c.textContent=n;',
      'if(!e.ok){refs++;rf.textContent=refs}',
      'if(e.code==="VERIFY_FAILED"||(e.verification&&e.verification.verified===false)){vfails++;vf.textContent=vfails}',
      'var row=document.createElement("div");row.className="row";',
      'row.innerHTML="<div>"+esc(e.at)+"</div><div class=\\""+(e.ok?"ok":"fail")+"\\">"+(e.ok?"ok":"fail")+"</div><div>"+esc(e.code)+"</div><div>"+esc((e.capabilityId||"")+(e.error?(" \\u2014 "+e.error):""))+"</div>";',
      'log.insertBefore(row,log.firstChild);',
      'while(log.children.length>MAX)log.removeChild(log.lastChild)}',
      'function decide(id,kind){var u=(kind==="approve"?AP:RP).replace("{id}",encodeURIComponent(id));',
      'fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(function(){refreshQueue()}).catch(function(){})}',
      'function decideBound(id,kind,acct){if(!acct){flashMsg("validatorAccountId required for bound action","fail");return}',
      'var u=(kind==="approve"?A292:R292).replace("{id}",encodeURIComponent(id));',
      'fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({validatorAccountId:acct})})',
      '.then(function(r){return r.json()}).then(function(j){if(j&&j.ok===false)flashMsg("refused: "+(j.code||j.error||"unknown"),"fail");else flashMsg("bound "+kind+" ok ("+acct+")","ok");refreshQueue()}).catch(function(){})}',
      'function showDetail(id){var u=TP.replace("{id}",encodeURIComponent(id));',
      'fetch(u).then(function(r){return r.json()}).then(function(j){detail.textContent=JSON.stringify(j,null,2);detail.classList.add("show")}).catch(function(){})}',
      'function renderQueue(tickets){qlog.innerHTML="";var pend=0;tickets.forEach(function(t){if(t.status==="pending")pend++;',
      'var row=document.createElement("div");row.className="qrow";',
      'var cap=(t.request&&t.request.capabilityId)||"";',
      'var actions;',
      'if(t.status==="pending"){',
      'actions=\'<input class="acct" data-id="\'+esc(t.id)+\'" placeholder="validatorAccountId"/>\'+',
      '\'<button class="approve" data-id="\'+esc(t.id)+\'" data-k="approve">approve</button>\'+',
      '\'<button class="reject" data-id="\'+esc(t.id)+\'" data-k="reject">reject</button>\'+',
      '\'<button class="bound" data-id="\'+esc(t.id)+\'" data-k="bound-approve">bound&nbsp;\\u2713</button>\'+',
      '\'<button class="bound" data-id="\'+esc(t.id)+\'" data-k="bound-reject">bound&nbsp;\\u2717</button>\'+',
      '\'<button class="detail" data-id="\'+esc(t.id)+\'" data-k="detail">detail</button>\';',
      '}else{actions=\'<button class="detail" data-id="\'+esc(t.id)+\'" data-k="detail">detail</button> \'+esc(t.status)}',
      'row.innerHTML="<div>"+esc(t.id)+"</div><div>"+esc(t.status)+"</div><div>"+esc(cap)+"</div><div>"+actions+"</div>";',
      'qlog.appendChild(row)});pn.textContent=pend;',
      'qlog.querySelectorAll("button").forEach(function(b){b.addEventListener("click",function(){',
      'var id=b.getAttribute("data-id"),k=b.getAttribute("data-k");',
      'if(k==="detail"){showDetail(id);return}',
      'if(k==="approve"||k==="reject"){decide(id,k);return}',
      'var input=qlog.querySelector(\'input.acct[data-id="\'+id+\'"]\');',
      'var acct=input?input.value.trim():"";',
      'decideBound(id,k==="bound-approve"?"approve":"reject",acct)})})}',
      'function refreshQueue(){fetch(QP).then(function(r){return r.json()}).then(function(j){if(j&&j.tickets)renderQueue(j.tickets)}).catch(function(){})}',
      'function refreshRegistry(){fetch(REG).then(function(r){return r.json()}).then(function(j){if(j&&typeof j.size==="number")rsz.textContent=j.size+(j.enabled?" (enforced)":" (info)")}).catch(function(){rsz.textContent="n/a"})}',
      'refreshQueue();refreshRegistry();setInterval(refreshRegistry,10000);',
      'try{var qes=new EventSource(QS);qst.textContent="sse";',
      'qes.addEventListener("hitl.queue",function(ev){try{var j=JSON.parse(ev.data);if(j&&j.tickets)renderQueue(j.tickets)}catch(_){}});',
      'qes.addEventListener("error",function(){qst.textContent="poll"});',
      '}catch(_){qst.textContent="poll"}',
      'setInterval(refreshQueue,FALLBACK);',
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
      version: BRIDGE_VERSION_293,
      streamPath: this.streamPath,
      queueStreamPath: this.queueStreamPath,
      queuePath: this.queuePath,
      ticketPath: this.ticketPath,
      approvePath: this.approvePath,
      rejectPath: this.rejectPath,
      approveV292Path: this.approveV292Path,
      rejectV292Path: this.rejectV292Path,
      registryPath: this.registryPath,
      pollFallbackMs: this.pollFallbackMs,
      max: this.max,
    };
  }
}

module.exports = {
  BRIDGE_VERSION_293,
  REGISTRY_ENV_KEY_293,
  HISTORY_LIMIT_293,
  ValidatorAccountRegistry293,
  RegistryGuardedAccountBinding293,
  BasesView293,
  OverlayHistory293,
  OperatorPanel293,
};
