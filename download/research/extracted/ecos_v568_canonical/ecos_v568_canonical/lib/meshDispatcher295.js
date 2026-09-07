'use strict';
/**
 * lib/meshDispatcher295.js — ECOS V295 (Phase P183) — per-ticket quorum
 * policies, signed registry snapshots, quorum activity feed and operator
 * panel V6 (quorum tab).
 *
 * V294 introduced opt-in JSON persistence of the V293 registry, a weighted
 * quorum wrapper around the V293 guarded binding, a merged recent-history
 * view and an operator panel with inline add/remove for validators.
 *
 * V295 follows the four directions called out in NEXT_SESSION_PROMPT_V294.md.
 * All new identifiers end in 295. Purely additive on V287..V294.
 *
 *   1. QuorumPolicy295 — resolves the quorum threshold per ticket from a
 *      capability-class map (destructive / readOnly / default). Pure
 *      wrapper around QuorumApprover294 — no V292/V293 changes.
 *
 *   2. SignedRegistryPersistence295 — appends a sha256 of the accounts
 *      payload to the on-disk snapshot and refuses load() on mismatch.
 *      Behind ECOS_HITL_REGISTRY_SIGNED_V295=1. Delegates the actual
 *      atomic write to V294. No new deps (crypto builtin).
 *
 *   3. QuorumActivityFeed295 — captures the last N QuorumApprover294
 *      decisions (met / short / refused) so the operator panel can show
 *      a quorum activity log.
 *
 *   4. OperatorPanel295 — extends the V294 panel with a quorum tab:
 *      multi-select validators, threshold input, POST to the V295
 *      quorum-approve endpoint, render returned tally + activity feed.
 *
 * Pure + dependency-free (R3: only fs/crypto/path builtins).
 * Sacred files untouched (R1). All new identifiers end in 295 (R2).
 * V287..V294 surfaces preserved (R6).
 *
 * @version 295.0.0
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const D294 = require('./meshDispatcher294.js');

const BRIDGE_VERSION_295            = '295.0.0';
const SIGNED_ENV_KEY_295            = 'ECOS_HITL_REGISTRY_SIGNED_V295';
const DEFAULT_FEED_CAPACITY_295     = 200;
const DEFAULT_DESTRUCTIVE_THRESHOLD_295 = 3;
const DEFAULT_READONLY_THRESHOLD_295    = 1;
const DEFAULT_THRESHOLD_295         = 1;

// ─────────────────────────────────────────────────────────────────────────────
// 1) QuorumPolicy295 — per-ticket threshold resolver (capability classes)
// ─────────────────────────────────────────────────────────────────────────────

class QuorumPolicy295 {
  /**
   * @param {object} [opts]
   * @param {number} [opts.destructiveThreshold=3]
   * @param {number} [opts.readOnlyThreshold=1]
   * @param {number} [opts.defaultThreshold=1]
   * @param {object} [opts.perCapability]  — { '<capabilityId>': number }
   */
  constructor(opts = {}) {
    this.destructiveThreshold = Number.isFinite(opts.destructiveThreshold)
      ? opts.destructiveThreshold : DEFAULT_DESTRUCTIVE_THRESHOLD_295;
    this.readOnlyThreshold    = Number.isFinite(opts.readOnlyThreshold)
      ? opts.readOnlyThreshold    : DEFAULT_READONLY_THRESHOLD_295;
    this.defaultThreshold     = Number.isFinite(opts.defaultThreshold)
      ? opts.defaultThreshold     : DEFAULT_THRESHOLD_295;
    this.perCapability = Object.assign({}, opts.perCapability || {});
    this._stats = { calls: 0, destructive: 0, readOnly: 0, perCap: 0, fallback: 0 };
  }

  /**
   * resolve({ capabilityId, destructive, readOnly })
   *   Priority:
   *     1) explicit per-capability override
   *     2) destructive=true → destructiveThreshold
   *     3) readOnly=true   → readOnlyThreshold
   *     4) defaultThreshold
   */
  resolve(descriptor = {}) {
    this._stats.calls += 1;
    const capId = descriptor.capabilityId ? String(descriptor.capabilityId) : null;
    if (capId && Object.prototype.hasOwnProperty.call(this.perCapability, capId)) {
      this._stats.perCap += 1;
      const v = this.perCapability[capId];
      return { threshold: Number.isFinite(v) ? v : this.defaultThreshold, reason: 'per-capability', capabilityId: capId };
    }
    if (descriptor.destructive === true) {
      this._stats.destructive += 1;
      return { threshold: this.destructiveThreshold, reason: 'destructive', capabilityId: capId };
    }
    if (descriptor.readOnly === true) {
      this._stats.readOnly += 1;
      return { threshold: this.readOnlyThreshold, reason: 'read-only', capabilityId: capId };
    }
    this._stats.fallback += 1;
    return { threshold: this.defaultThreshold, reason: 'default', capabilityId: capId };
  }

  setPerCapability(capabilityId, threshold) {
    if (!capabilityId) return false;
    if (!Number.isFinite(threshold)) return false;
    this.perCapability[String(capabilityId)] = threshold;
    return true;
  }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_295,
      destructiveThreshold: this.destructiveThreshold,
      readOnlyThreshold:    this.readOnlyThreshold,
      defaultThreshold:     this.defaultThreshold,
      perCapabilityCount:   Object.keys(this.perCapability).length,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) SignedRegistryPersistence295 — sha256-checked wrapper around V294
// ─────────────────────────────────────────────────────────────────────────────

class SignedRegistryPersistence295 {
  /**
   * @param {object} opts
   * @param {D294.RegistryPersistence294} opts.persistence
   * @param {object} [opts.env]
   * @param {function} [opts.audit]
   */
  constructor(opts = {}) {
    if (!opts.persistence) throw new Error('SignedRegistryPersistence295 requires {persistence}');
    this.persistence = opts.persistence;
    this.env   = opts.env || process.env;
    this.audit = typeof opts.audit === 'function' ? opts.audit : () => {};
    this._stats = { saves: 0, loads: 0, mismatches: 0, missingSig: 0, failures: 0 };
  }

  enabled() {
    const v = this.env[SIGNED_ENV_KEY_295];
    return v === '1' || v === 'true' || v === 'on';
  }

  _hash(accounts) {
    const canon = JSON.stringify(accounts);
    return crypto.createHash('sha256').update(canon).digest('hex');
  }

  /**
   * save()
   *   Delegates to V294 for the atomic write, then re-reads the file and
   *   re-writes it (atomically) with an appended `sha256` field.
   *   No-op when V294 is disabled; the signed-mode field is `signed:false`
   *   when SIGNED_ENV_KEY_295 is off.
   */
  save() {
    const inner = this.persistence.save();
    if (!inner || inner.persisted !== true) {
      return Object.assign({}, inner, { version: BRIDGE_VERSION_295, signed: false });
    }
    if (!this.enabled()) {
      return Object.assign({}, inner, { version: BRIDGE_VERSION_295, signed: false, reason: 'flag-off' });
    }
    try {
      const file = inner.file || this.persistence.filePath;
      const raw  = fs.readFileSync(file, 'utf8');
      const snap = JSON.parse(raw);
      const sig  = this._hash(snap.accounts || []);
      snap.sha256 = sig;
      snap.signedVersion = BRIDGE_VERSION_295;
      const tmp = file + '.tmp-sig-' + process.pid + '-' + Date.now();
      fs.writeFileSync(tmp, JSON.stringify(snap, null, 2));
      fs.renameSync(tmp, file);
      this._stats.saves += 1;
      this.audit({ action: 'v295.sign.save', file, sha256: sig });
      return Object.assign({}, inner, {
        version: BRIDGE_VERSION_295, signed: true, sha256: sig, file,
      });
    } catch (e) {
      this._stats.failures += 1;
      this.audit({ action: 'v295.sign.save.fail', error: e.message });
      return { ok: false, version: BRIDGE_VERSION_295, signed: false, error: e.message };
    }
  }

  /**
   * load()
   *   When signed mode is on:
   *     - refuses if the file lacks `sha256`
   *     - refuses if the computed sha256 does not match
   *     - on success, delegates to V294 to restore into the registry.
   *   When signed mode is off, delegates straight to V294.
   */
  load() {
    if (!this.enabled()) {
      const out = this.persistence.load();
      return Object.assign({}, out, { version: BRIDGE_VERSION_295, signed: false });
    }
    try {
      const file = this.persistence.filePath;
      if (!fs.existsSync(file)) {
        return { ok: true, version: BRIDGE_VERSION_295, signed: true, loaded: false, reason: 'no-file', file };
      }
      const raw  = fs.readFileSync(file, 'utf8');
      const snap = JSON.parse(raw);
      const accounts = Array.isArray(snap && snap.accounts) ? snap.accounts : [];
      if (!snap || typeof snap.sha256 !== 'string') {
        this._stats.missingSig += 1;
        this.audit({ action: 'v295.sign.load.missingSig', file });
        return { ok: false, version: BRIDGE_VERSION_295, signed: true, loaded: false, code: 'MISSING_SIGNATURE', file };
      }
      const actual = this._hash(accounts);
      if (actual !== snap.sha256) {
        this._stats.mismatches += 1;
        this.audit({ action: 'v295.sign.load.mismatch', file, expected: snap.sha256, actual });
        return { ok: false, version: BRIDGE_VERSION_295, signed: true, loaded: false, code: 'SIGNATURE_MISMATCH', file };
      }
      const out = this.persistence.load();
      this._stats.loads += 1;
      this.audit({ action: 'v295.sign.load', file, sha256: actual, restored: out && out.restored });
      return Object.assign({}, out, { version: BRIDGE_VERSION_295, signed: true, sha256: actual });
    } catch (e) {
      this._stats.failures += 1;
      this.audit({ action: 'v295.sign.load.fail', error: e.message });
      return { ok: false, version: BRIDGE_VERSION_295, signed: true, loaded: false, error: e.message };
    }
  }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_295,
      envKey:  SIGNED_ENV_KEY_295,
      enabled: this.enabled(),
      inner:   typeof this.persistence.stats === 'function' ? this.persistence.stats() : null,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) QuorumActivityFeed295 — bounded ring of recent quorum decisions
// ─────────────────────────────────────────────────────────────────────────────

class QuorumActivityFeed295 {
  /**
   * @param {object} [opts]
   * @param {number} [opts.capacity=200]
   */
  constructor(opts = {}) {
    this.capacity = Number.isFinite(opts.capacity) ? Math.max(1, Math.min(opts.capacity, 5000)) : DEFAULT_FEED_CAPACITY_295;
    this._ring = [];
    this._stats = { records: 0, met: 0, short: 0, refused: 0 };
  }

  /**
   * record({ ticketId, decision, code?, weight, threshold, tally, policy? })
   */
  record(entry = {}) {
    const out = {
      at: new Date().toISOString(),
      ticketId:  entry.ticketId  || null,
      decision:  entry.decision  || (entry.met ? 'met' : (entry.code === 'REGISTRY_UNKNOWN' ? 'refused' : 'short')),
      code:      entry.code || null,
      weight:    Number.isFinite(entry.weight) ? entry.weight : 0,
      threshold: Number.isFinite(entry.threshold) ? entry.threshold : null,
      tally:     Array.isArray(entry.tally) ? entry.tally : [],
      policy:    entry.policy || null,
    };
    this._ring.push(out);
    if (this._ring.length > this.capacity) this._ring.splice(0, this._ring.length - this.capacity);
    this._stats.records += 1;
    if (out.decision === 'met') this._stats.met += 1;
    else if (out.decision === 'refused') this._stats.refused += 1;
    else this._stats.short += 1;
    return out;
  }

  recent(opts = {}) {
    const n = Number.isFinite(opts.n) ? Math.max(1, Math.min(opts.n, this.capacity)) : this.capacity;
    const tail = this._ring.slice(-n);
    return {
      ok: true,
      version: BRIDGE_VERSION_295,
      n, capacity: this.capacity,
      count: tail.length,
      entries: tail.slice().reverse(),
    };
  }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_295,
      capacity: this.capacity,
      size:     this._ring.length,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) PolicyQuorumApprover295 — combines QuorumPolicy295 + V294 approver + feed
// ─────────────────────────────────────────────────────────────────────────────

class PolicyQuorumApprover295 {
  /**
   * @param {object} opts
   * @param {D294.QuorumApprover294} opts.approver
   * @param {QuorumPolicy295}         opts.policy
   * @param {QuorumActivityFeed295}   [opts.feed]
   * @param {function} [opts.audit]
   */
  constructor(opts = {}) {
    if (!opts.approver || !opts.policy) {
      throw new Error('PolicyQuorumApprover295 requires {approver, policy}');
    }
    this.approver = opts.approver;
    this.policy   = opts.policy;
    this.feed     = opts.feed || null;
    this.audit    = typeof opts.audit === 'function' ? opts.audit : () => {};
    this._stats   = { calls: 0, met: 0, short: 0, refused: 0 };
  }

  /**
   * approve(ticketId, { validatorAccountIds, capabilityId?, destructive?, readOnly?, threshold? })
   *   When `threshold` is provided it overrides the policy. Otherwise the
   *   policy resolves the threshold from the capability descriptor.
   */
  approve(ticketId, opts = {}) {
    this._stats.calls += 1;
    const policyResult = this.policy.resolve({
      capabilityId: opts.capabilityId,
      destructive:  opts.destructive,
      readOnly:     opts.readOnly,
    });
    const threshold = Number.isFinite(opts.threshold) ? opts.threshold : policyResult.threshold;
    const ids = Array.isArray(opts.validatorAccountIds) ? opts.validatorAccountIds : [];
    const out = this.approver.approve(ticketId, { validatorAccountIds: ids, threshold });

    const decision = (out && out.ok === false && out.code === 'REGISTRY_UNKNOWN') ? 'refused'
                    : (out && out.ok === false && out.code === 'QUORUM_SHORT')    ? 'short'
                    : 'met';
    if (decision === 'met')      this._stats.met += 1;
    else if (decision === 'refused') this._stats.refused += 1;
    else                              this._stats.short += 1;

    if (this.feed) {
      this.feed.record({
        ticketId,
        decision,
        code: out && out.code,
        weight: (out && (out.quorum ? out.quorum.weight : out.weight)) || 0,
        threshold,
        tally: (out && (out.quorum ? out.quorum.tally : out.tally)) || [],
        policy: { reason: policyResult.reason, capabilityId: policyResult.capabilityId },
      });
    }
    this.audit({ action: 'v295.policy.quorum', ticketId, decision, threshold, reason: policyResult.reason });
    return Object.assign({}, out, {
      version: BRIDGE_VERSION_295,
      policy: { reason: policyResult.reason, threshold, capabilityId: policyResult.capabilityId || null },
    });
  }

  stats() {
    return Object.assign({ version: BRIDGE_VERSION_295 }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) OperatorPanel295 — V294 panel + quorum tab
// ─────────────────────────────────────────────────────────────────────────────

class OperatorPanel295 {
  constructor(opts = {}) {
    this.title              = opts.title              || 'ECOS V295 — Operator Panel';
    this.registryPath       = opts.registryPath       || '/api/v1/mesh/validator/registry/v293';
    this.quorumApprovePath  = opts.quorumApprovePath  || '/api/v1/mesh/validator/{id}/quorum-approve/v295';
    this.quorumRecentPath   = opts.quorumRecentPath   || '/api/v1/mesh/validator/quorum/recent/v295';
    this.queuePath          = opts.queuePath          || '/api/v1/mesh/hitl/queue';
    this.panel294Path       = opts.panel294Path       || '/api/v1/mesh/operator/panel/v294';
    this.pollMs             = Number.isFinite(opts.pollMs) ? opts.pollMs : 5000;
    this.max                = Number.isFinite(opts.max) ? opts.max : 100;
  }

  renderHtml() {
    const safe = (s) => String(s).replace(/[<>&"]/g, '');
    const t    = safe(this.title);
    const reg  = safe(this.registryPath);
    const qa   = safe(this.quorumApprovePath);
    const qr   = safe(this.quorumRecentPath);
    const qp   = safe(this.queuePath);
    const p294 = safe(this.panel294Path);
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
      '.row{display:grid;grid-template-columns:160px 90px 80px 80px 1fr;gap:8px;padding:4px 6px;border-bottom:1px solid #1a2026}',
      '.qrow{display:grid;grid-template-columns:200px 1fr 220px;gap:8px;padding:4px 6px;border-bottom:1px solid #1a2026;align-items:center}',
      '.head{color:#7fd3a0;font-weight:600;border-bottom:1px solid #324049}',
      '.ok{color:#7fd3a0}.fail{color:#ff6b6b}.warn{color:#ffd166}',
      'button{background:#1a2026;color:#d6e1ea;border:1px solid #324049;padding:3px 8px;margin-right:4px;cursor:pointer;font:inherit}',
      'button.go{border-color:#7fd3a0;color:#7fd3a0}',
      'input,select{background:#0b0d10;color:#d6e1ea;border:1px solid #324049;padding:2px 6px;font:inherit;margin-right:4px}',
      'input.tid{width:200px}input.thr{width:60px}input.cap{width:240px}',
      'select.vsel{min-width:160px;height:80px}',
      'a{color:#7fd3a0}',
      '#out{background:#11161b;border:1px solid #324049;padding:10px;margin-top:8px;white-space:pre-wrap;min-height:1em}',
      '#flash{margin-top:6px;color:#ffd166;min-height:1em}',
      '</style></head><body>',
      '<h1>' + t + '</h1>',
      '<div>V295 quorum tab — V294 panel still available at <a href="' + p294 + '">' + p294 + '</a></div>',
      '<h2>Quorum approve (V295 — policy-resolved threshold)</h2>',
      '<div class="qrow"><div>ticketId</div><div>validators (multi-select)</div><div>policy / threshold</div></div>',
      '<div class="qrow">',
      '<div><input class="tid" id="ticketId" placeholder="ticketId"/></div>',
      '<div><select class="vsel" id="vsel" multiple></select></div>',
      '<div>',
      '<input class="cap" id="capId" placeholder="capabilityId (optional)"/><br/>',
      '<label><input type="checkbox" id="destructive"/> destructive</label> ',
      '<label><input type="checkbox" id="readOnly"/> read-only</label><br/>',
      '<input class="thr" id="thr" type="number" min="1" placeholder="threshold"/>',
      '<button class="go" id="goBtn">approve</button>',
      '</div></div>',
      '<div id="flash"></div>',
      '<pre id="out"></pre>',
      '<h2>Recent quorum decisions</h2>',
      '<div class="row head"><div>at</div><div>decision</div><div>weight</div><div>thr</div><div>ticket / policy</div></div>',
      '<div id="feed"></div>',
      '<script>(function(){',
      'var REG="' + reg + '",QA="' + qa + '",QR="' + qr + '",MAX=' + max + ',POLL=' + poll + ';',
      'var vsel=document.getElementById("vsel"),out=document.getElementById("out"),feed=document.getElementById("feed"),flash=document.getElementById("flash");',
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
      'fetch(QA.replace("{id}",encodeURIComponent(tid)),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})',
      '.then(function(r){return r.json()}).then(function(j){out.textContent=JSON.stringify(j,null,2);refreshFeed()}).catch(function(e){flashMsg("error: "+e.message,"fail")})});',
      'function renderFeed(entries){feed.innerHTML="";entries.slice(0,MAX).forEach(function(e){',
      'var row=document.createElement("div");row.className="row";',
      'var cls=e.decision==="met"?"ok":"fail";',
      'var pol=e.policy?(e.policy.reason+(e.policy.capabilityId?(" / "+e.policy.capabilityId):"")):"-";',
      'row.innerHTML="<div>"+esc(e.at)+"</div><div class=\\""+cls+"\\">"+esc(e.decision)+(e.code?" ("+esc(e.code)+")":"")+"</div><div>"+esc(e.weight)+"</div><div>"+esc(e.threshold||"")+"</div><div>"+esc((e.ticketId||"")+" — "+pol)+"</div>";',
      'feed.appendChild(row)})}',
      'function refreshFeed(){fetch(QR).then(function(r){return r.json()}).then(function(j){if(j&&Array.isArray(j.entries))renderFeed(j.entries)}).catch(function(){})}',
      'loadValidators();refreshFeed();setInterval(loadValidators,POLL*2);setInterval(refreshFeed,POLL);',
      '})();</script>',
      '</body></html>',
    ].join('\n');
  }

  stats() {
    return {
      version: BRIDGE_VERSION_295,
      registryPath: this.registryPath,
      quorumApprovePath: this.quorumApprovePath,
      quorumRecentPath: this.quorumRecentPath,
      queuePath: this.queuePath,
      panel294Path: this.panel294Path,
      pollMs: this.pollMs,
      max: this.max,
    };
  }
}

module.exports = {
  BRIDGE_VERSION_295,
  SIGNED_ENV_KEY_295,
  DEFAULT_FEED_CAPACITY_295,
  DEFAULT_DESTRUCTIVE_THRESHOLD_295,
  DEFAULT_READONLY_THRESHOLD_295,
  DEFAULT_THRESHOLD_295,
  QuorumPolicy295,
  SignedRegistryPersistence295,
  QuorumActivityFeed295,
  PolicyQuorumApprover295,
  OperatorPanel295,
};
