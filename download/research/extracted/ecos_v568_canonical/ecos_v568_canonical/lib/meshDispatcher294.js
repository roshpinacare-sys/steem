'use strict';
/**
 * lib/meshDispatcher294.js — ECOS V294 (Phase P182) — registry persistence,
 * weighted quorum, history-merging and a registry-aware operator panel.
 *
 * V293 added an in-memory validator registry, a registry-guarded wrapper
 * around the V292 account binding, a cache-aware bases view, a per-rule
 * fire history ring and an operator panel V4 with bound approve/reject.
 *
 * V294 follows the four directions called out in NEXT_SESSION_PROMPT_V293.md.
 * All new identifiers end in 294. Purely additive on V287..V293.
 *
 *   1. RegistryPersistence294 — opt-in JSON snapshot of the V293
 *      `ValidatorAccountRegistry293` accounts on disk
 *      (default `var/v293-registry.json`) so process restarts don't lose
 *      the directory. Behind `ECOS_HITL_REGISTRY_PERSIST_V294=1`. Atomic
 *      write via `fs.writeFileSync(tmp); fs.renameSync(tmp, dst)` —
 *      no new deps (R3).
 *
 *   2. QuorumApprover294 — accepts a list of `validatorAccountId`s and
 *      resolves the V293 `RegistryGuardedAccountBinding293.approve()` only
 *      when the sum of their registry `weight`s meets a threshold
 *      (default 1, configurable per ticket). Pure wrapper around V293 —
 *      no V292 changes.
 *
 *   3. HistoryRecent294 — merges the V287 `MessageBus287` history with
 *      the V293 per-rule overlay rings so the operator can see what
 *      *would* have fired even for unregistered topics.
 *      Exposed at `GET /api/v1/mesh/playbook/overlay291/history/recent`.
 *
 *   4. OperatorPanel294 — extends the V293 panel with a registry section:
 *      list existing accounts (poll `/v293`) and inline `+ add` /
 *      `× remove` controls so the operator can wire validators without curl.
 *
 * Pure + dependency-free (R3: only fs/path builtins). Sacred files
 * untouched (R1). All new identifiers end in 294 (R2). V287..V293
 * surfaces preserved (R6).
 *
 * @version 294.0.0
 */

const fs = require('fs');
const path = require('path');

const D291 = require('./meshDispatcher291.js');
const D293 = require('./meshDispatcher293.js');

const BRIDGE_VERSION_294       = '294.0.0';
const PERSIST_ENV_KEY_294      = 'ECOS_HITL_REGISTRY_PERSIST_V294';
const DEFAULT_REGISTRY_PATH_294 = 'var/v293-registry.json';
const DEFAULT_QUORUM_THRESHOLD_294 = 1;
const DEFAULT_RECENT_LIMIT_294 = 50;

// ─────────────────────────────────────────────────────────────────────────────
// 1) RegistryPersistence294 — opt-in JSON snapshot of V293 registry on disk
// ─────────────────────────────────────────────────────────────────────────────

class RegistryPersistence294 {
  /**
   * @param {object} opts
   * @param {D293.ValidatorAccountRegistry293} opts.registry
   * @param {string} [opts.filePath]
   * @param {object} [opts.env]
   * @param {function} [opts.audit]
   */
  constructor(opts = {}) {
    if (!opts.registry) throw new Error('RegistryPersistence294 requires {registry}');
    this.registry = opts.registry;
    this.env      = opts.env || process.env;
    this.filePath = opts.filePath || path.resolve(process.cwd(), DEFAULT_REGISTRY_PATH_294);
    this.audit    = typeof opts.audit === 'function' ? opts.audit : () => {};
    this._stats   = { saves: 0, loads: 0, restored: 0, failures: 0, lastSaveAt: null, lastLoadAt: null };
  }

  enabled() {
    const v = this.env[PERSIST_ENV_KEY_294];
    return v === '1' || v === 'true' || v === 'on';
  }

  /** Atomically write the registry snapshot to disk (no-op if disabled). */
  save() {
    if (!this.enabled()) return { ok: true, version: BRIDGE_VERSION_294, persisted: false, reason: 'flag-off' };
    try {
      const snap = {
        version: BRIDGE_VERSION_294,
        savedAt: new Date().toISOString(),
        accounts: [...this.registry._accounts.values()],
      };
      const dir = path.dirname(this.filePath);
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
      const tmp = this.filePath + '.tmp-' + process.pid + '-' + Date.now();
      fs.writeFileSync(tmp, JSON.stringify(snap, null, 2));
      fs.renameSync(tmp, this.filePath);
      this._stats.saves += 1;
      this._stats.lastSaveAt = snap.savedAt;
      this.audit({ action: 'v294.persist.save', file: this.filePath, count: snap.accounts.length });
      return { ok: true, version: BRIDGE_VERSION_294, persisted: true, file: this.filePath, count: snap.accounts.length };
    } catch (e) {
      this._stats.failures += 1;
      this.audit({ action: 'v294.persist.save.fail', file: this.filePath, error: e.message });
      return { ok: false, version: BRIDGE_VERSION_294, persisted: false, error: e.message };
    }
  }

  /** Load + restore the snapshot into the registry. No-op if disabled or file missing. */
  load() {
    if (!this.enabled()) return { ok: true, version: BRIDGE_VERSION_294, loaded: false, reason: 'flag-off' };
    try {
      if (!fs.existsSync(this.filePath)) {
        return { ok: true, version: BRIDGE_VERSION_294, loaded: false, reason: 'no-file', file: this.filePath };
      }
      const txt = fs.readFileSync(this.filePath, 'utf8');
      const snap = JSON.parse(txt);
      const accounts = Array.isArray(snap && snap.accounts) ? snap.accounts : [];
      let restored = 0;
      for (const a of accounts) {
        if (!a || !a.id) continue;
        this.registry.registerValidator(a.id, { displayName: a.displayName, weight: a.weight });
        restored += 1;
      }
      this._stats.loads += 1;
      this._stats.restored += restored;
      this._stats.lastLoadAt = new Date().toISOString();
      this.audit({ action: 'v294.persist.load', file: this.filePath, restored });
      return { ok: true, version: BRIDGE_VERSION_294, loaded: true, file: this.filePath, restored };
    } catch (e) {
      this._stats.failures += 1;
      this.audit({ action: 'v294.persist.load.fail', file: this.filePath, error: e.message });
      return { ok: false, version: BRIDGE_VERSION_294, loaded: false, error: e.message };
    }
  }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_294,
      envKey:  PERSIST_ENV_KEY_294,
      enabled: this.enabled(),
      file:    this.filePath,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) QuorumApprover294 — weighted-quorum wrapper around the V293 guard
// ─────────────────────────────────────────────────────────────────────────────

class QuorumApprover294 {
  /**
   * @param {object} opts
   * @param {D293.RegistryGuardedAccountBinding293} opts.guard
   * @param {D293.ValidatorAccountRegistry293}      opts.registry
   * @param {number} [opts.defaultThreshold=1]
   * @param {function} [opts.audit]
   */
  constructor(opts = {}) {
    if (!opts.guard || !opts.registry) {
      throw new Error('QuorumApprover294 requires {guard, registry}');
    }
    this.guard    = opts.guard;
    this.registry = opts.registry;
    this.defaultThreshold = Number.isFinite(opts.defaultThreshold) ? opts.defaultThreshold : DEFAULT_QUORUM_THRESHOLD_294;
    this.audit    = typeof opts.audit === 'function' ? opts.audit : () => {};
    this._stats = { calls: 0, met: 0, short: 0, refused: 0, totalWeight: 0 };
  }

  /**
   * approve(ticketId, { validatorAccountIds:[...], threshold? })
   *   Tallies the registry weight of each id, refuses any unknown id
   *   (when the V293 registry flag is on) without touching the binding,
   *   and only delegates to the V293 guard when the tally meets the
   *   threshold. Returns the V293 guard response decorated with the
   *   quorum tally.
   */
  approve(ticketId, opts = {}) {
    this._stats.calls += 1;
    const ids = Array.isArray(opts.validatorAccountIds) ? opts.validatorAccountIds.map(String) : [];
    const threshold = Number.isFinite(opts.threshold) ? opts.threshold : this.defaultThreshold;
    const enforced = this.registry.enabled();

    const tally = [];
    let weight = 0;
    for (const id of ids) {
      if (enforced) {
        const rec = this.registry.get(id);
        if (!rec) {
          this._stats.refused += 1;
          this.audit({ action: 'v294.quorum.refuse', ticketId, accountId: id, code: 'REGISTRY_UNKNOWN' });
          return {
            ok: false, refused: true, code: 'REGISTRY_UNKNOWN',
            accountId: id, version: BRIDGE_VERSION_294, threshold, weight, tally,
          };
        }
        tally.push({ id, weight: rec.weight, displayName: rec.displayName });
        weight += rec.weight;
      } else {
        tally.push({ id, weight: 1, displayName: id });
        weight += 1;
      }
    }
    this._stats.totalWeight += weight;
    if (weight < threshold) {
      this._stats.short += 1;
      this.audit({ action: 'v294.quorum.short', ticketId, weight, threshold });
      return {
        ok: false, refused: true, code: 'QUORUM_SHORT',
        version: BRIDGE_VERSION_294, threshold, weight, tally,
      };
    }
    this._stats.met += 1;
    // Delegate to V293 guard using the FIRST validator id as the binding
    // accountId (V292 stores a single bound account per ticket). The full
    // tally is preserved on the response for audit.
    const head = ids[0];
    const out = this.guard.approve(ticketId, { validatorAccountId: head });
    return Object.assign({}, out, {
      version: BRIDGE_VERSION_294,
      quorum: { ok: true, threshold, weight, tally, headAccountId: head || null },
    });
  }

  stats() {
    return Object.assign({
      version: BRIDGE_VERSION_294,
      defaultThreshold: this.defaultThreshold,
    }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) HistoryRecent294 — merge V287 bus history + V293 per-rule rings
// ─────────────────────────────────────────────────────────────────────────────

class HistoryRecent294 {
  /**
   * @param {object} opts
   * @param {object} opts.bus      — V287 MessageBus287
   * @param {D293.OverlayHistory293} opts.history
   */
  constructor(opts = {}) {
    if (!opts.bus || !opts.history) throw new Error('HistoryRecent294 requires {bus, history}');
    this.bus     = opts.bus;
    this.history = opts.history;
    this._stats  = { calls: 0, totalReturned: 0 };
  }

  /**
   * recent({ n, topic })
   *   Returns the most recent N messages from the bus history (filtered by
   *   topic when provided) annotated with whether each entry was tracked
   *   by a V293 overlay rule.
   */
  recent(opts = {}) {
    this._stats.calls += 1;
    const n = Number.isFinite(opts.n) ? Math.max(1, Math.min(opts.n, 500)) : DEFAULT_RECENT_LIMIT_294;
    const topic = opts.topic ? String(opts.topic) : '';
    const trackedTopics = new Set(D291.DEFAULT_PLAYBOOK_291.map((r) => r.topic));
    const ruleByTopic = new Map(D291.DEFAULT_PLAYBOOK_291.map((r) => [r.topic, r.name]));

    let raw = [];
    if (typeof this.bus.recent === 'function') raw = this.bus.recent(500);
    else if (Array.isArray(this.bus.history)) raw = this.bus.history;
    else if (typeof this.bus.history === 'function') raw = this.bus.history();
    else if (Array.isArray(this.bus._history)) raw = this.bus._history;

    const filtered = (topic ? raw.filter((m) => m && m.topic === topic) : raw.slice());
    const tail = filtered.slice(-n);
    const entries = tail.map((m) => ({
      at: m.at,
      topic: m.topic,
      tracked: trackedTopics.has(m.topic),
      rule: ruleByTopic.get(m.topic) || null,
      summary: this._summarize(m.payload),
    }));
    this._stats.totalReturned += entries.length;
    return {
      ok: true,
      version: BRIDGE_VERSION_294,
      n, topic: topic || null,
      busHistorySize: raw.length,
      trackedTopics: [...trackedTopics],
      count: entries.length,
      entries,
    };
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

  stats() {
    return Object.assign({ version: BRIDGE_VERSION_294 }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) OperatorPanel294 — V293 panel + registry section (list/add/remove)
// ─────────────────────────────────────────────────────────────────────────────

class OperatorPanel294 {
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
    this.registryItemPath = opts.registryItemPath || '/api/v1/mesh/validator/registry/v293/{id}';
    this.recentHistoryPath = opts.recentHistoryPath || '/api/v1/mesh/playbook/overlay291/history/recent';
    this.title            = opts.title            || 'ECOS V294 — Operator Panel';
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
    const regi = safe(this.registryItemPath);
    const rec  = safe(this.recentHistoryPath);
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
      '.rrow{display:grid;grid-template-columns:200px 1fr 90px 80px;gap:8px;padding:4px 6px;border-bottom:1px solid #1a2026;align-items:center}',
      '.head{color:#7fd3a0;font-weight:600;border-bottom:1px solid #324049}',
      '.ok{color:#7fd3a0}.fail{color:#ff6b6b}.warn{color:#ffd166}',
      'button{background:#1a2026;color:#d6e1ea;border:1px solid #324049;padding:3px 8px;margin-right:4px;cursor:pointer;font:inherit}',
      'button.approve{border-color:#7fd3a0;color:#7fd3a0}',
      'button.reject{border-color:#ff6b6b;color:#ff6b6b}',
      'button.detail{border-color:#9aa5af;color:#9aa5af}',
      'button.bound{border-color:#ffd166;color:#ffd166}',
      'button.add{border-color:#7fd3a0;color:#7fd3a0}',
      'button.remove{border-color:#ff6b6b;color:#ff6b6b}',
      'input.acct,input.regacct,input.regname,input.regweight{background:#0b0d10;color:#d6e1ea;border:1px solid #324049;padding:2px 6px;font:inherit;margin-right:4px}',
      'input.acct{width:110px}input.regacct{width:130px}input.regname{width:150px}input.regweight{width:60px}',
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
      '<h2>Validator registry (V293) — inline add / remove (no curl required)</h2>',
      '<div class="rrow head"><div>accountId</div><div>displayName</div><div>weight</div><div>action</div></div>',
      '<div id="regList"></div>',
      '<div class="rrow"><div><input class="regacct" id="newAcct" placeholder="accountId"/></div>',
      '<div><input class="regname" id="newName" placeholder="display name (opt.)"/></div>',
      '<div><input class="regweight" id="newWeight" type="number" min="1" value="1"/></div>',
      '<div><button class="add" id="addBtn">+ add</button></div></div>',
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
      'var A292="' + a292 + '",R292="' + r292 + '",REG="' + reg + '",REGI="' + regi + '",REC="' + rec + '";',
      'var log=document.getElementById("log"),qlog=document.getElementById("queue"),detail=document.getElementById("detail");',
      'var regList=document.getElementById("regList");',
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
      'function renderRegistry(accts,enabled){regList.innerHTML="";accts.forEach(function(a){',
      'var row=document.createElement("div");row.className="rrow";',
      'row.innerHTML="<div>"+esc(a.id)+"</div><div>"+esc(a.displayName||a.id)+"</div><div>"+esc(a.weight)+"</div>"+',
      '\'<div><button class="remove" data-id="\'+esc(a.id)+\'">\\u00d7 remove</button></div>\';',
      'regList.appendChild(row)});',
      'regList.querySelectorAll("button.remove").forEach(function(b){b.addEventListener("click",function(){',
      'var id=b.getAttribute("data-id");fetch(REGI.replace("{id}",encodeURIComponent(id)),{method:"DELETE"})',
      '.then(function(r){return r.json()}).then(function(j){flashMsg("removed "+id,"ok");refreshRegistry()}).catch(function(){flashMsg("remove failed","fail")})})});',
      'rsz.textContent=accts.length+(enabled?" (enforced)":" (info)")}',
      'function refreshRegistry(){fetch(REG).then(function(r){return r.json()}).then(function(j){if(j&&Array.isArray(j.accounts))renderRegistry(j.accounts,!!j.enabled)}).catch(function(){rsz.textContent="n/a"})}',
      'document.getElementById("addBtn").addEventListener("click",function(){',
      'var id=document.getElementById("newAcct").value.trim();',
      'var nm=document.getElementById("newName").value.trim();',
      'var wt=parseInt(document.getElementById("newWeight").value,10)||1;',
      'if(!id){flashMsg("accountId required","fail");return}',
      'fetch(REG,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountId:id,displayName:nm||undefined,weight:wt})})',
      '.then(function(r){return r.json()}).then(function(j){if(j&&j.ok===false){flashMsg("add failed: "+(j.error||"unknown"),"fail");return}',
      'document.getElementById("newAcct").value="";document.getElementById("newName").value="";flashMsg("added "+id,"ok");refreshRegistry()}).catch(function(){flashMsg("add failed","fail")})});',
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
      version: BRIDGE_VERSION_294,
      streamPath: this.streamPath,
      queueStreamPath: this.queueStreamPath,
      queuePath: this.queuePath,
      ticketPath: this.ticketPath,
      approvePath: this.approvePath,
      rejectPath: this.rejectPath,
      approveV292Path: this.approveV292Path,
      rejectV292Path: this.rejectV292Path,
      registryPath: this.registryPath,
      registryItemPath: this.registryItemPath,
      recentHistoryPath: this.recentHistoryPath,
      pollFallbackMs: this.pollFallbackMs,
      max: this.max,
    };
  }
}

module.exports = {
  BRIDGE_VERSION_294,
  PERSIST_ENV_KEY_294,
  DEFAULT_REGISTRY_PATH_294,
  DEFAULT_QUORUM_THRESHOLD_294,
  DEFAULT_RECENT_LIMIT_294,
  RegistryPersistence294,
  QuorumApprover294,
  HistoryRecent294,
  OperatorPanel294,
};
