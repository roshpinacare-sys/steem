'use strict';
/**
 * lib/meshDispatcher296.js — ECOS V296 (Phase P184) — quorum policy
 * persistence, decision rationale capture, live SSE activity stream and
 * operator panel V7 (split-pane: V295 quorum controls + live feed).
 *
 * V295 introduced QuorumPolicy295 (per-capability threshold resolver),
 * SignedRegistryPersistence295 (sha256-checked snapshot of the V293
 * registry), QuorumActivityFeed295 (bounded ring of recent quorum
 * decisions) and OperatorPanel295 (quorum tab with polled feed).
 *
 * V296 follows the four directions called out in NEXT_SESSION_PROMPT_V295.md.
 * All new identifiers end in 296. Purely additive on V287..V295.
 *
 *   1. QuorumPolicyPersistence296 — atomic sha256-signed JSON snapshot of
 *      QuorumPolicy295.perCapability (+ default / readOnly / destructive
 *      thresholds) so per-capability overrides survive restart. Behind
 *      ECOS_HITL_QUORUM_POLICY_PERSIST_V296=1.
 *
 *   2. QuorumActivityStream296 — synchronous pub/sub. Subscribers receive
 *      every PolicyQuorumApprover295 / ReasonedPolicyQuorumApprover296
 *      decision as it lands; used by the SSE endpoint and panel V7.
 *
 *   3. ReasonedPolicyQuorumApprover296 — wraps PolicyQuorumApprover295 so
 *      an operator can attach a short `reason` string to every approve
 *      call; surfaces it on the feed entry and the live stream payload.
 *
 *   4. OperatorPanel296 — V7 split-pane. Left: V295 quorum tab (reused
 *      controls + new "operator reason" input). Right: live activity
 *      stream (EventSource on the V296 SSE endpoint, falls back to V295
 *      polling when SSE is unavailable). Links back to V295 panel V6.
 *
 * Pure + dependency-free (R3: only fs/crypto/path builtins).
 * Sacred files untouched (R1). All new identifiers end in 296 (R2).
 * V287..V295 surfaces preserved (R6).
 *
 * @version 296.0.0
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const D295 = require('./meshDispatcher295.js');

const BRIDGE_VERSION_296             = '296.0.0';
const POLICY_PERSIST_ENV_KEY_296     = 'ECOS_HITL_QUORUM_POLICY_PERSIST_V296';
const DEFAULT_POLICY_PATH_296        = 'var/v296-quorum-policy.json';
const DEFAULT_STREAM_MAX_LISTENERS_296 = 64;
const MAX_REASON_LEN_296             = 240;

// ─────────────────────────────────────────────────────────────────────────────
// 1) QuorumPolicyPersistence296 — sha256-signed snapshot of QuorumPolicy295
// ─────────────────────────────────────────────────────────────────────────────

class QuorumPolicyPersistence296 {
  /**
   * @param {object} opts
   * @param {D295.QuorumPolicy295} opts.policy
   * @param {string}  [opts.filePath]
   * @param {object}  [opts.env]
   * @param {function}[opts.audit]
   */
  constructor(opts = {}) {
    if (!opts.policy) throw new Error('QuorumPolicyPersistence296 requires {policy}');
    this.policy   = opts.policy;
    this.filePath = opts.filePath || DEFAULT_POLICY_PATH_296;
    this.env      = opts.env || process.env;
    this.audit    = typeof opts.audit === 'function' ? opts.audit : () => {};
    this._stats   = { saves: 0, loads: 0, mismatches: 0, missingSig: 0, failures: 0 };
  }

  enabled() {
    const v = this.env[POLICY_PERSIST_ENV_KEY_296];
    return v === '1' || v === 'true' || v === 'on';
  }

  _payload() {
    return {
      version: BRIDGE_VERSION_296,
      savedAt: new Date().toISOString(),
      defaultThreshold:     this.policy.defaultThreshold,
      readOnlyThreshold:    this.policy.readOnlyThreshold,
      destructiveThreshold: this.policy.destructiveThreshold,
      perCapability:        Object.assign({}, this.policy.perCapability || {}),
    };
  }

  _hash(snapshot) {
    // Hash everything except sha256 itself so the field can be appended.
    const canon = JSON.stringify({
      version: snapshot.version,
      defaultThreshold:     snapshot.defaultThreshold,
      readOnlyThreshold:    snapshot.readOnlyThreshold,
      destructiveThreshold: snapshot.destructiveThreshold,
      perCapability:        snapshot.perCapability,
    });
    return crypto.createHash('sha256').update(canon).digest('hex');
  }

  save() {
    if (!this.enabled()) {
      return { ok: true, version: BRIDGE_VERSION_296, persisted: false, reason: 'flag-off' };
    }
    try {
      const snap = this._payload();
      snap.sha256 = this._hash(snap);
      const dir = path.dirname(this.filePath);
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = this.filePath + '.tmp-' + process.pid + '-' + Date.now();
      fs.writeFileSync(tmp, JSON.stringify(snap, null, 2));
      fs.renameSync(tmp, this.filePath);
      this._stats.saves += 1;
      this.audit({ action: 'v296.policy.save', file: this.filePath, sha256: snap.sha256 });
      return {
        ok: true, version: BRIDGE_VERSION_296, persisted: true,
        file: this.filePath, sha256: snap.sha256,
        perCapabilityCount: Object.keys(snap.perCapability).length,
      };
    } catch (e) {
      this._stats.failures += 1;
      this.audit({ action: 'v296.policy.save.fail', error: e.message });
      return { ok: false, version: BRIDGE_VERSION_296, persisted: false, error: e.message };
    }
  }

  load() {
    if (!this.enabled()) {
      return { ok: true, version: BRIDGE_VERSION_296, loaded: false, reason: 'flag-off' };
    }
    try {
      if (!fs.existsSync(this.filePath)) {
        return { ok: true, version: BRIDGE_VERSION_296, loaded: false, reason: 'no-file', file: this.filePath };
      }
      const raw  = fs.readFileSync(this.filePath, 'utf8');
      const snap = JSON.parse(raw);
      if (!snap || typeof snap.sha256 !== 'string') {
        this._stats.missingSig += 1;
        this.audit({ action: 'v296.policy.load.missingSig', file: this.filePath });
        return { ok: false, version: BRIDGE_VERSION_296, loaded: false, code: 'MISSING_SIGNATURE', file: this.filePath };
      }
      const actual = this._hash(snap);
      if (actual !== snap.sha256) {
        this._stats.mismatches += 1;
        this.audit({ action: 'v296.policy.load.mismatch', file: this.filePath, expected: snap.sha256, actual });
        return { ok: false, version: BRIDGE_VERSION_296, loaded: false, code: 'SIGNATURE_MISMATCH', file: this.filePath };
      }
      // Restore into the live policy (replace perCapability + scalar thresholds).
      if (Number.isFinite(snap.defaultThreshold))     this.policy.defaultThreshold     = snap.defaultThreshold;
      if (Number.isFinite(snap.readOnlyThreshold))    this.policy.readOnlyThreshold    = snap.readOnlyThreshold;
      if (Number.isFinite(snap.destructiveThreshold)) this.policy.destructiveThreshold = snap.destructiveThreshold;
      this.policy.perCapability = Object.assign({}, snap.perCapability || {});
      this._stats.loads += 1;
      this.audit({ action: 'v296.policy.load', file: this.filePath, sha256: actual,
        perCapabilityCount: Object.keys(this.policy.perCapability).length });
      return {
        ok: true, version: BRIDGE_VERSION_296, loaded: true, file: this.filePath,
        sha256: actual, perCapabilityCount: Object.keys(this.policy.perCapability).length,
      };
    } catch (e) {
      this._stats.failures += 1;
      this.audit({ action: 'v296.policy.load.fail', error: e.message });
      return { ok: false, version: BRIDGE_VERSION_296, loaded: false, error: e.message };
    }
  }

  stats() {
    return Object.assign({
      version:  BRIDGE_VERSION_296,
      envKey:   POLICY_PERSIST_ENV_KEY_296,
      enabled:  this.enabled(),
      filePath: this.filePath,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) QuorumActivityStream296 — synchronous pub/sub for SSE listeners
// ─────────────────────────────────────────────────────────────────────────────

class QuorumActivityStream296 {
  constructor(opts = {}) {
    this.maxListeners = Number.isFinite(opts.maxListeners)
      ? Math.max(1, Math.min(opts.maxListeners, 4096))
      : DEFAULT_STREAM_MAX_LISTENERS_296;
    this._handlers = new Set();
    this._stats    = { published: 0, subscribes: 0, unsubscribes: 0, rejected: 0, errors: 0 };
  }

  /**
   * subscribe(handler) → unsubscribe()
   *   handler(entry) is invoked synchronously for every publish().
   *   Returns a no-arg disposer.
   */
  subscribe(handler) {
    if (typeof handler !== 'function') return () => {};
    if (this._handlers.size >= this.maxListeners) {
      this._stats.rejected += 1;
      return () => {};
    }
    this._handlers.add(handler);
    this._stats.subscribes += 1;
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this._handlers.delete(handler);
      this._stats.unsubscribes += 1;
    };
  }

  publish(entry) {
    this._stats.published += 1;
    for (const h of this._handlers) {
      try { h(entry); } catch (_) { this._stats.errors += 1; }
    }
    return { ok: true, listeners: this._handlers.size };
  }

  listenerCount() { return this._handlers.size; }

  stats() {
    return Object.assign({
      version:      BRIDGE_VERSION_296,
      maxListeners: this.maxListeners,
      listeners:    this._handlers.size,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) ReasonedPolicyQuorumApprover296 — V295 approver + operator reason + SSE
// ─────────────────────────────────────────────────────────────────────────────

function _sanitizeReason296(s) {
  if (s == null) return null;
  let v = String(s).replace(/[\r\n\t]+/g, ' ').trim();
  if (!v) return null;
  if (v.length > MAX_REASON_LEN_296) v = v.slice(0, MAX_REASON_LEN_296);
  return v;
}

class ReasonedPolicyQuorumApprover296 {
  /**
   * @param {object} opts
   * @param {D295.PolicyQuorumApprover295} opts.inner
   * @param {QuorumActivityStream296}      [opts.stream]
   * @param {D295.QuorumActivityFeed295}   [opts.feed]    — optional separate v296 feed
   * @param {function}                     [opts.audit]
   */
  constructor(opts = {}) {
    if (!opts.inner) throw new Error('ReasonedPolicyQuorumApprover296 requires {inner}');
    this.inner  = opts.inner;
    this.stream = opts.stream || null;
    this.feed   = opts.feed   || null;
    this.audit  = typeof opts.audit === 'function' ? opts.audit : () => {};
    this._stats = { calls: 0, withReason: 0, withoutReason: 0, met: 0, short: 0, refused: 0 };
  }

  approve(ticketId, opts = {}) {
    this._stats.calls += 1;
    const reason = _sanitizeReason296(opts.reason);
    if (reason) this._stats.withReason += 1; else this._stats.withoutReason += 1;

    const out = this.inner.approve(ticketId, {
      validatorAccountIds: opts.validatorAccountIds,
      capabilityId:        opts.capabilityId,
      destructive:         opts.destructive,
      readOnly:            opts.readOnly,
      threshold:           opts.threshold,
    });

    const decision = (out && out.refused === true) ? (out.code === 'REGISTRY_UNKNOWN' ? 'refused' : 'short') : 'met';
    if (decision === 'met')       this._stats.met += 1;
    else if (decision === 'refused') this._stats.refused += 1;
    else                              this._stats.short += 1;

    const entry = {
      at:        new Date().toISOString(),
      ticketId:  ticketId || null,
      decision,
      code:      (out && out.code) || null,
      weight:    (out && (out.quorum ? out.quorum.weight : out.weight)) || 0,
      threshold: (out && out.policy && Number.isFinite(out.policy.threshold)) ? out.policy.threshold : null,
      tally:     (out && (out.quorum ? out.quorum.tally : out.tally)) || [],
      policy:    (out && out.policy) ? {
        reason:       out.policy.reason,
        capabilityId: out.policy.capabilityId || null,
      } : null,
      operatorReason: reason,
    };
    if (this.feed)   { try { this.feed.record(Object.assign({}, entry, { policy: Object.assign({}, entry.policy, { operatorReason: reason }) })); } catch (_) {} }
    if (this.stream) { this.stream.publish(entry); }
    this.audit({ action: 'v296.reasoned.quorum', ticketId, decision, reason });
    return Object.assign({}, out, {
      version: BRIDGE_VERSION_296,
      operatorReason: reason,
    });
  }

  stats() {
    return Object.assign({ version: BRIDGE_VERSION_296 }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) OperatorPanel296 — V7 split-pane (V295 controls + live SSE stream)
// ─────────────────────────────────────────────────────────────────────────────

class OperatorPanel296 {
  constructor(opts = {}) {
    this.title             = opts.title             || 'ECOS V296 — Operator Panel';
    this.registryPath      = opts.registryPath      || '/api/v1/mesh/validator/registry/v293';
    this.quorumApprovePath = opts.quorumApprovePath || '/api/v1/mesh/validator/{id}/quorum-approve/v296';
    this.quorumRecentPath  = opts.quorumRecentPath  || '/api/v1/mesh/validator/quorum/recent/v295';
    this.quorumStreamPath  = opts.quorumStreamPath  || '/api/v1/mesh/validator/quorum/stream/v296';
    this.panel295Path      = opts.panel295Path      || '/api/v1/mesh/operator/panel/v295';
    this.pollMs            = Number.isFinite(opts.pollMs) ? opts.pollMs : 5000;
    this.max               = Number.isFinite(opts.max) ? opts.max : 200;
  }

  renderHtml() {
    const safe = (s) => String(s).replace(/[<>&"]/g, '');
    const t    = safe(this.title);
    const reg  = safe(this.registryPath);
    const qa   = safe(this.quorumApprovePath);
    const qr   = safe(this.quorumRecentPath);
    const qs   = safe(this.quorumStreamPath);
    const p295 = safe(this.panel295Path);
    const poll = this.pollMs | 0;
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
      'input.tid{width:100%;box-sizing:border-box}input.thr{width:60px}input.cap{width:100%;box-sizing:border-box}',
      'textarea.reason{width:100%;box-sizing:border-box;min-height:48px;resize:vertical}',
      'select.vsel{width:100%;height:88px}',
      'a{color:#7fd3a0}',
      '#out{background:#0b0d10;border:1px solid #324049;padding:10px;margin-top:8px;white-space:pre-wrap;min-height:1em;max-height:200px;overflow:auto}',
      '#flash{margin-top:6px;color:#ffd166;min-height:1em}',
      '#stream-status{font-size:11px;color:#9aa5af}',
      '</style></head><body>',
      '<h1>' + t + '</h1>',
      '<div>V296 split-pane (V295 controls + live SSE stream). V295 panel still at <a href="' + p295 + '">' + p295 + '</a></div>',
      '<div class="split">',
      // LEFT pane — V295 quorum controls + V296 operator reason
      '<div class="pane">',
      '<h2>Quorum approve (V296 — policy + reason)</h2>',
      '<div>ticketId<br/><input class="tid" id="ticketId" placeholder="ticketId"/></div>',
      '<div style="margin-top:6px">validators (multi-select)<br/><select class="vsel" id="vsel" multiple></select></div>',
      '<div style="margin-top:6px">capabilityId (optional)<br/><input class="cap" id="capId" placeholder="capabilityId"/></div>',
      '<div style="margin-top:6px">',
      '<label><input type="checkbox" id="destructive"/> destructive</label> ',
      '<label><input type="checkbox" id="readOnly"/> read-only</label>',
      '</div>',
      '<div style="margin-top:6px">threshold (override)<br/><input class="thr" id="thr" type="number" min="1" placeholder="thr"/></div>',
      '<div style="margin-top:6px">operator reason (optional, ≤' + MAX_REASON_LEN_296 + ' chars)<br/>',
      '<textarea class="reason" id="reason" maxlength="' + MAX_REASON_LEN_296 + '" placeholder="why is this approval being granted?"></textarea></div>',
      '<div style="margin-top:6px"><button class="go" id="goBtn">approve</button></div>',
      '<div id="flash"></div>',
      '<pre id="out"></pre>',
      '</div>',
      // RIGHT pane — live SSE stream of activity
      '<div class="pane">',
      '<h2>Live quorum stream <span id="stream-status">(connecting…)</span></h2>',
      '<div class="row head"><div>at</div><div>decision</div><div>weight</div><div>thr</div><div>ticket / reason</div></div>',
      '<div id="feed"></div>',
      '</div>',
      '</div>',
      '<script>(function(){',
      'var REG="' + reg + '",QA="' + qa + '",QR="' + qr + '",QS="' + qs + '",MAX=' + max + ',POLL=' + poll + ';',
      'var vsel=document.getElementById("vsel"),out=document.getElementById("out"),feed=document.getElementById("feed"),flash=document.getElementById("flash"),sstat=document.getElementById("stream-status");',
      'var entries=[];',
      'function esc(s){return String(s==null?"":s).replace(/[<>&"]/g,function(x){return"&#"+x.charCodeAt(0)+";"})}',
      'function flashMsg(m,cls){flash.textContent=m;flash.className=cls||"warn";setTimeout(function(){if(flash.textContent===m)flash.textContent=""},4000)}',
      'function loadValidators(){fetch(REG).then(function(r){return r.json()}).then(function(j){',
      'vsel.innerHTML="";(j.accounts||[]).forEach(function(a){var o=document.createElement("option");o.value=a.id;o.textContent=a.id+" ("+(a.displayName||a.id)+", w="+a.weight+")";vsel.appendChild(o)})}).catch(function(){})}',
      'function selected(){var r=[];for(var i=0;i<vsel.options.length;i++)if(vsel.options[i].selected)r.push(vsel.options[i].value);return r}',
      'document.getElementById("goBtn").addEventListener("click",function(){',
      'var ids=selected();if(!ids.length){flashMsg("select at least one validator","fail");return}',
      'var tid=document.getElementById("ticketId").value.trim();if(!tid){flashMsg("ticketId required","fail");return}',
      'var thr=parseInt(document.getElementById("thr").value,10);',
      'var body={validatorAccountIds:ids};',
      'if(Number.isFinite(thr))body.threshold=thr;',
      'var capId=document.getElementById("capId").value.trim();if(capId)body.capabilityId=capId;',
      'if(document.getElementById("destructive").checked)body.destructive=true;',
      'if(document.getElementById("readOnly").checked)body.readOnly=true;',
      'var reason=document.getElementById("reason").value.trim();if(reason)body.reason=reason;',
      'fetch(QA.replace("{id}",encodeURIComponent(tid)),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})',
      '.then(function(r){return r.json()}).then(function(j){out.textContent=JSON.stringify(j,null,2)}).catch(function(e){flashMsg("error: "+e.message,"fail")})});',
      'function pushEntry(e){entries.unshift(e);if(entries.length>MAX)entries.length=MAX;render()}',
      'function render(){feed.innerHTML="";entries.forEach(function(e){',
      'var row=document.createElement("div");row.className="row";',
      'var cls=e.decision==="met"?"ok":"fail";',
      'var pol=e.policy?(e.policy.reason+(e.policy.capabilityId?(" / "+e.policy.capabilityId):"")):"-";',
      'var rsn=e.operatorReason?(" — \\u201c"+e.operatorReason+"\\u201d"):"";',
      'row.innerHTML="<div>"+esc(e.at)+"</div><div class=\\""+cls+"\\">"+esc(e.decision)+(e.code?" ("+esc(e.code)+")":"")+"</div><div>"+esc(e.weight)+"</div><div>"+esc(e.threshold||"")+"</div><div>"+esc((e.ticketId||"")+" — "+pol+rsn)+"</div>";',
      'feed.appendChild(row)})}',
      'function pollFallback(){sstat.textContent="(polling fallback)";setInterval(function(){fetch(QR).then(function(r){return r.json()}).then(function(j){if(j&&Array.isArray(j.entries)){entries=j.entries.slice(0,MAX);render()}}).catch(function(){})},POLL)}',
      'function connectSSE(){if(typeof EventSource!=="function"){pollFallback();return}',
      'try{var es=new EventSource(QS);es.onopen=function(){sstat.textContent="(live)"};',
      'es.onmessage=function(ev){try{var e=JSON.parse(ev.data);if(e&&e.ticketId!==undefined)pushEntry(e)}catch(_){}}',
      'es.onerror=function(){sstat.textContent="(reconnecting…)"};}catch(_){pollFallback()}}',
      'loadValidators();connectSSE();setInterval(loadValidators,POLL*2);',
      '})();</script>',
      '</body></html>',
    ].join('\n');
  }

  stats() {
    return {
      version:           BRIDGE_VERSION_296,
      registryPath:      this.registryPath,
      quorumApprovePath: this.quorumApprovePath,
      quorumRecentPath:  this.quorumRecentPath,
      quorumStreamPath:  this.quorumStreamPath,
      panel295Path:      this.panel295Path,
      pollMs:            this.pollMs,
      max:               this.max,
    };
  }
}

module.exports = {
  BRIDGE_VERSION_296,
  POLICY_PERSIST_ENV_KEY_296,
  DEFAULT_POLICY_PATH_296,
  DEFAULT_STREAM_MAX_LISTENERS_296,
  MAX_REASON_LEN_296,
  QuorumPolicyPersistence296,
  QuorumActivityStream296,
  ReasonedPolicyQuorumApprover296,
  OperatorPanel296,
};
