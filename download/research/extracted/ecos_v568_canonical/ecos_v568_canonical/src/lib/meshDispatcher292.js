'use strict';
/**
 * lib/meshDispatcher292.js — ECOS V292 (Phase P180) — validator-aware mesh follow-ups
 *
 * V291 wired the V290 HitlBridge290 ticket queue into the real hitlGate
 * (flag-gated), added a hitl.* choreography overlay, exposed dispatch by
 * <base>, and shipped an operator panel with inline approve/reject buttons.
 *
 * V292 follows the four directions called out in NEXT_SESSION_PROMPT_V291.md.
 * All new identifiers end in 292. Purely additive on V287..V291.
 *
 *   1. ValidatorAccountBinding292 — when the V291 bridge is in real-validator
 *      mode AND `ECOS_HITL_VALIDATOR_ACCOUNT_V292=1`, lets the operator pass
 *      a `validatorAccountId` to approve()/reject() so the real HITL path
 *      (not AUTO_FLOW) drives `hitlGate.resolveApproval`. Without the flag
 *      (or without an accountId), behaviour is unchanged from V291 — the
 *      bridge still uses AUTO_FLOW so deploys without validator accounts
 *      keep working.
 *
 *   2. ResolverCacheInvalidator292 — the V290 `LatestAliasResolver290` caches
 *      forever in-process; V292 exposes an explicit `invalidate(base?)` that
 *      resets the cache so newly-materialised `<base>Latest289.js` aliases
 *      become visible without a restart.
 *
 *   3. OverlayMetrics292 — reads fire-counts for each `DEFAULT_PLAYBOOK_291`
 *      rule out of the V288 choreography engine and aggregates them with the
 *      raw overlay listing so the API can answer "how many times has each
 *      overlay rule fired since boot".
 *
 *   4. OperatorPanel292 — extends the V291 panel with a per-ticket detail
 *      view (capability + args + status + linked validator approvalId) and
 *      an SSE subscription on the HITL queue (instead of polling), wired
 *      through the V289 stream multiplexer. Still no bundler, still no npm dep.
 *
 * Pure + dependency-free (R3: only fs/path). Sacred files untouched (R1).
 * All new identifiers end in 292 (R2). V287..V291 surfaces preserved (R6).
 *
 * @version 292.0.0
 */

const fs = require('fs');
const path = require('path');

const D290 = require('./meshDispatcher290.js');
const D291 = require('./meshDispatcher291.js');

const BRIDGE_VERSION_292   = '292.0.0';
const ACCOUNT_ENV_KEY_292  = 'ECOS_HITL_VALIDATOR_ACCOUNT_V292';

// ─────────────────────────────────────────────────────────────────────────────
// 1) ValidatorAccountBinding292 — opt-in real-HITL routing
// ─────────────────────────────────────────────────────────────────────────────

class ValidatorAccountBinding292 {
  /**
   * @param {object} opts
   * @param {D291.HitlValidatorBridge291} opts.validator — V291 bridge instance
   * @param {object} [opts.env]
   * @param {function} [opts.audit]
   */
  constructor(opts = {}) {
    if (!opts.validator) throw new Error('ValidatorAccountBinding292 requires {validator}');
    this.validator = opts.validator;
    this.env       = opts.env || process.env;
    this.audit     = typeof opts.audit === 'function' ? opts.audit : () => {};
    this._stats = { approves: 0, rejects: 0, accountBound: 0, autoFlow: 0 };
  }

  /** True iff opted into per-account HITL AND the V291 bridge is itself
   *  enabled (real validator mode + a wired hitlGate). */
  enabled() {
    const v = this.env[ACCOUNT_ENV_KEY_292];
    return !!this.validator.enabled() && (v === '1' || v === 'true' || v === 'on');
  }

  /** Approve, optionally with a real validator account. When the flag is on
   *  AND opts.validatorAccountId is non-empty, we pass it down to hitlGate
   *  via the V291 bridge and turn AUTO_FLOW off. Otherwise behaviour matches
   *  V291 (AUTO_FLOW=true). */
  approve(ticketId, opts = {}) {
    this._stats.approves += 1;
    const bound = this.enabled() && !!opts.validatorAccountId;
    if (bound) {
      this._stats.accountBound += 1;
      this.audit({ action: 'v292.account.approve', ticketId, validatorAccountId: opts.validatorAccountId });
    } else {
      this._stats.autoFlow += 1;
    }
    // The V291 bridge.approve uses autoFlow:true unconditionally. To preserve
    // backwards compatibility, account-bound calls go through a lightweight
    // wrapper that swaps autoFlow off when a real accountId is supplied.
    const result = bound
      ? this._approveBound(ticketId, opts)
      : this.validator.approve(ticketId, opts);
    return Object.assign({ accountBound: bound, version: BRIDGE_VERSION_292 }, result);
  }

  reject(ticketId, opts = {}) {
    this._stats.rejects += 1;
    const bound = this.enabled() && !!opts.validatorAccountId;
    if (bound) {
      this._stats.accountBound += 1;
      this.audit({ action: 'v292.account.reject', ticketId, validatorAccountId: opts.validatorAccountId });
    } else {
      this._stats.autoFlow += 1;
    }
    const result = bound
      ? this._rejectBound(ticketId, opts)
      : this.validator.reject(ticketId, opts);
    return Object.assign({ accountBound: bound, version: BRIDGE_VERSION_292 }, result);
  }

  // ── internals ──

  _approveBound(ticketId, opts) {
    const bridgeOut = this.validator.bridge.approve(ticketId, opts);
    const approvalId = this.validator.approvalIdFor(ticketId);
    if (!approvalId || !this.validator.hitlGate) return bridgeOut;
    try {
      this.validator.hitlGate.resolveApproval(approvalId, {
        autoFlow: false,
        decision: 'approve',
        validatorAccountId: opts.validatorAccountId,
        note: opts.note || 'v292 account-bound approve',
      });
      return Object.assign({ validatorApprovalId: approvalId, validatorAccountId: opts.validatorAccountId }, bridgeOut);
    } catch (e) {
      return Object.assign({ validatorApprovalId: approvalId, validatorError: e.message }, bridgeOut);
    }
  }

  _rejectBound(ticketId, opts) {
    const bridgeOut = this.validator.bridge.reject(ticketId, opts);
    const approvalId = this.validator.approvalIdFor(ticketId);
    if (!approvalId || !this.validator.hitlGate) return bridgeOut;
    try {
      this.validator.hitlGate.resolveApproval(approvalId, {
        autoFlow: false,
        decision: 'reject',
        validatorAccountId: opts.validatorAccountId,
        note: opts.note || 'v292 account-bound reject',
      });
      return Object.assign({ validatorApprovalId: approvalId, validatorAccountId: opts.validatorAccountId }, bridgeOut);
    } catch (e) {
      return Object.assign({ validatorApprovalId: approvalId, validatorError: e.message }, bridgeOut);
    }
  }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_292,
      enabled: this.enabled(),
      envKey:  ACCOUNT_ENV_KEY_292,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) ResolverCacheInvalidator292 — explicit cache reset for V290 resolver
// ─────────────────────────────────────────────────────────────────────────────

class ResolverCacheInvalidator292 {
  /**
   * @param {object} opts
   * @param {D290.LatestAliasResolver290} opts.resolver
   */
  constructor(opts = {}) {
    if (!opts.resolver) throw new Error('ResolverCacheInvalidator292 requires {resolver}');
    this.resolver = opts.resolver;
    this._stats = { fullInvalidations: 0, baseInvalidations: 0, lastAt: null };
  }

  /** Reset the cache. When `base` is non-empty, evict only that key;
   *  otherwise clear the whole cache. Returns {ok, removed, size}. */
  invalidate(base) {
    const cache = this.resolver._cache;
    if (!cache || typeof cache.clear !== 'function') {
      return { ok: false, error: 'resolver cache not introspectable', version: BRIDGE_VERSION_292 };
    }
    if (base) {
      const had = cache.has(String(base));
      if (had) cache.delete(String(base));
      this._stats.baseInvalidations += 1;
      this._stats.lastAt = new Date().toISOString();
      return { ok: true, mode: 'base', base: String(base), removed: had ? 1 : 0, size: cache.size, version: BRIDGE_VERSION_292 };
    }
    const removed = cache.size;
    cache.clear();
    this._stats.fullInvalidations += 1;
    this._stats.lastAt = new Date().toISOString();
    return { ok: true, mode: 'full', removed, size: cache.size, version: BRIDGE_VERSION_292 };
  }

  /** Inspect the current cache contents (debug-only — keys + via). */
  peek() {
    const cache = this.resolver._cache;
    const entries = [];
    if (cache && typeof cache.forEach === 'function') {
      cache.forEach((v, k) => entries.push({ base: k, ok: !!v.ok, via: v.via || null, module: v.module || null }));
    }
    return { ok: true, size: entries.length, entries, version: BRIDGE_VERSION_292 };
  }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_292,
      size: (this.resolver._cache && this.resolver._cache.size) || 0,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) OverlayMetrics292 — fire-counts for the V291 overlay rules
// ─────────────────────────────────────────────────────────────────────────────

class OverlayMetrics292 {
  /**
   * @param {object} opts
   * @param {D291.PlaybookOverlay291} opts.overlay
   * @param {object} opts.choreo — V288 ChoreographyEngine288
   */
  constructor(opts = {}) {
    if (!opts.overlay || !opts.choreo) {
      throw new Error('OverlayMetrics292 requires {overlay, choreo}');
    }
    this.overlay = opts.overlay;
    this.choreo  = opts.choreo;
  }

  /** Return per-rule fire counts (runs, lastAt) for the V291 overlay rules,
   *  enriched with the V291 seeded/skipped metadata. */
  metrics() {
    const list = this.overlay.list();
    const rules = D291.DEFAULT_PLAYBOOK_291.map((rule) => {
      const live = this.choreo.rules && this.choreo.rules.get
        ? this.choreo.rules.get(rule.name) : null;
      const seededRec = list.seeded.find((s) => s.name === rule.name) || null;
      const skippedRec = list.skipped.find((s) => s.name === rule.name) || null;
      return {
        name: rule.name,
        topic: rule.topic,
        registered: !!live,
        capabilityId: live ? live.capabilityId : (seededRec ? seededRec.capabilityId : null),
        runs: live ? (live.runs | 0) : 0,
        lastAt: live ? (live.lastAt || null) : null,
        skipped: skippedRec ? skippedRec.reason : null,
      };
    });
    const total = rules.reduce((acc, r) => acc + r.runs, 0);
    return {
      ok: true,
      version: BRIDGE_VERSION_292,
      totalRuns: total,
      ruleCount: rules.length,
      registered: rules.filter((r) => r.registered).length,
      rules,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) OperatorPanel292 — V291 panel + per-ticket detail view + SSE queue
// ─────────────────────────────────────────────────────────────────────────────

class OperatorPanel292 {
  /**
   * @param {object} [opts]
   * @param {string} [opts.streamPath='/api/v1/mesh/dispatch/stream']
   * @param {string} [opts.queueStreamPath='/api/v1/mesh/hitl/queue/stream']
   * @param {string} [opts.queuePath='/api/v1/mesh/hitl/queue']
   * @param {string} [opts.ticketPath='/api/v1/mesh/hitl/{id}']
   * @param {string} [opts.approvePath='/api/v1/mesh/hitl/{id}/approve']
   * @param {string} [opts.rejectPath='/api/v1/mesh/hitl/{id}/reject']
   * @param {string} [opts.title='ECOS V292 — Operator Panel']
   * @param {number} [opts.pollFallbackMs=5000]
   * @param {number} [opts.max=200]
   */
  constructor(opts = {}) {
    this.streamPath      = opts.streamPath      || '/api/v1/mesh/dispatch/stream';
    this.queueStreamPath = opts.queueStreamPath || '/api/v1/mesh/hitl/queue/stream';
    this.queuePath       = opts.queuePath       || '/api/v1/mesh/hitl/queue';
    this.ticketPath      = opts.ticketPath      || '/api/v1/mesh/hitl/{id}';
    this.approvePath     = opts.approvePath     || '/api/v1/mesh/hitl/{id}/approve';
    this.rejectPath      = opts.rejectPath      || '/api/v1/mesh/hitl/{id}/reject';
    this.title           = opts.title           || 'ECOS V292 — Operator Panel';
    this.pollFallbackMs  = Number.isFinite(opts.pollFallbackMs) ? opts.pollFallbackMs : 5000;
    this.max             = Number.isFinite(opts.max) ? opts.max : 200;
  }

  renderHtml() {
    const safe = (s) => String(s).replace(/[<>&"]/g, '');
    const t  = safe(this.title);
    const sp = safe(this.streamPath);
    const qs = safe(this.queueStreamPath);
    const qp = safe(this.queuePath);
    const tp = safe(this.ticketPath);
    const ap = safe(this.approvePath);
    const rp = safe(this.rejectPath);
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
      '.qrow{display:grid;grid-template-columns:220px 90px 1fr 200px;gap:8px;padding:4px 6px;border-bottom:1px solid #1a2026;align-items:center}',
      '.head{color:#7fd3a0;font-weight:600;border-bottom:1px solid #324049}',
      '.ok{color:#7fd3a0}.fail{color:#ff6b6b}.warn{color:#ffd166}',
      'button{background:#1a2026;color:#d6e1ea;border:1px solid #324049;padding:3px 8px;margin-right:4px;cursor:pointer;font:inherit}',
      'button.approve{border-color:#7fd3a0;color:#7fd3a0}',
      'button.reject{border-color:#ff6b6b;color:#ff6b6b}',
      'button.detail{border-color:#9aa5af;color:#9aa5af}',
      '.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:8px;color:#9aa5af}',
      '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff6b6b;margin-right:6px;vertical-align:middle}',
      '.dot.live{background:#7fd3a0}',
      '#detail{background:#11161b;border:1px solid #324049;padding:10px;margin-top:8px;display:none;white-space:pre-wrap}',
      '#detail.show{display:block}',
      '</style></head><body>',
      '<h1>' + t + '</h1>',
      '<div class="toolbar"><span><span id="status" class="dot"></span><span id="statusText">connecting&hellip;</span></span>',
      '<span>queue: <span id="qStatus">poll</span></span>',
      '<span>events: <span id="count">0</span></span>',
      '<span>refusals: <span id="refusals" class="warn">0</span></span>',
      '<span>verify-failed: <span id="vfail" class="fail">0</span></span>',
      '<span>pending: <span id="pending" class="warn">0</span></span></div>',
      '<h2>HITL queue (SSE + ' + fallback + 'ms fallback poll)</h2>',
      '<div class="qrow head"><div>ticketId</div><div>status</div><div>capability</div><div>actions</div></div>',
      '<div id="queue"></div>',
      '<pre id="detail"></pre>',
      '<h2>Dispatch stream</h2>',
      '<div class="row head"><div>at</div><div>ok</div><div>code</div><div>capabilityId / error</div></div>',
      '<div id="log"></div>',
      '<script>(function(){',
      'var MAX=' + max + ',FALLBACK=' + fallback + ';',
      'var QP="' + qp + '",AP="' + ap + '",RP="' + rp + '",TP="' + tp + '",QS="' + qs + '";',
      'var log=document.getElementById("log"),qlog=document.getElementById("queue"),detail=document.getElementById("detail");',
      'var st=document.getElementById("status"),sx=document.getElementById("statusText"),qst=document.getElementById("qStatus");',
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
      'function showDetail(id){var u=TP.replace("{id}",encodeURIComponent(id));',
      'fetch(u).then(function(r){return r.json()}).then(function(j){detail.textContent=JSON.stringify(j,null,2);detail.classList.add("show")}).catch(function(){})}',
      'function renderQueue(tickets){qlog.innerHTML="";var pend=0;tickets.forEach(function(t){if(t.status==="pending")pend++;',
      'var row=document.createElement("div");row.className="qrow";',
      'var cap=(t.request&&t.request.capabilityId)||"";',
      'var btns=t.status==="pending"?(\'<button class="approve" data-id="\'+esc(t.id)+\'" data-k="approve">approve</button><button class="reject" data-id="\'+esc(t.id)+\'" data-k="reject">reject</button><button class="detail" data-id="\'+esc(t.id)+\'" data-k="detail">detail</button>\'):(\'<button class="detail" data-id="\'+esc(t.id)+\'" data-k="detail">detail</button> \'+esc(t.status));',
      'row.innerHTML="<div>"+esc(t.id)+"</div><div>"+esc(t.status)+"</div><div>"+esc(cap)+"</div><div>"+btns+"</div>";',
      'qlog.appendChild(row)});pn.textContent=pend;',
      'qlog.querySelectorAll("button").forEach(function(b){b.addEventListener("click",function(){var k=b.getAttribute("data-k");if(k==="detail")showDetail(b.getAttribute("data-id"));else decide(b.getAttribute("data-id"),k)})})}',
      'function refreshQueue(){fetch(QP).then(function(r){return r.json()}).then(function(j){if(j&&j.tickets)renderQueue(j.tickets)}).catch(function(){})}',
      'refreshQueue();',
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
      version: BRIDGE_VERSION_292,
      streamPath: this.streamPath,
      queueStreamPath: this.queueStreamPath,
      queuePath: this.queuePath,
      ticketPath: this.ticketPath,
      approvePath: this.approvePath,
      rejectPath: this.rejectPath,
      pollFallbackMs: this.pollFallbackMs,
      max: this.max,
    };
  }
}

module.exports = {
  BRIDGE_VERSION_292,
  ACCOUNT_ENV_KEY_292,
  ValidatorAccountBinding292,
  ResolverCacheInvalidator292,
  OverlayMetrics292,
  OperatorPanel292,
};
