/**
 * src/dashboard/dashboard.ts — Tenant Dashboard v1 (roadmap cycle 13).
 * ONE self-contained HTML page (zero dependencies, inline CSS/JS) served by the sovereign server
 * at GET /dashboard. Read-only. Pulls from the EXISTING APIs (transparency/chain, balances,
 * passports, escrow, track-record) — no new data paths, no write surface.
 *
 * v102 — Dashboard auth:
 *   The input accepts either a plain tenant-id (dev/demo) or a tfa_… API key (production).
 *   Detection: value.startsWith("tfa_") → sends x-api-key header (server resolves tenantId).
 *   Otherwise falls back to x-tenant-id (backward compat). The server-side resolveTenantId()
 *   already handles both; this is purely a client-side header-routing change.
 */

const CSS = `
:root{--bg:#0b1020;--card:#141a31;--ink:#e8ecff;--mut:#93a0c8;--ok:#3ddc97;--warn:#ffb454;--bad:#ff6b81;--line:#26304f}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,Segoe UI,Arial;background:var(--bg);color:var(--ink)}
header{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:center;flex-wrap:wrap}
header h1{font-size:18px;margin:0}header .sub{color:var(--mut);font-size:13px}
input,button{font:inherit;border-radius:8px;border:1px solid var(--line);background:#0e1430;color:var(--ink);padding:8px 10px}
button{cursor:pointer;background:#1d2a55}button:hover{background:#27366b}
main{padding:20px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));max-width:1280px;margin:auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.card h2{margin:0 0 10px;font-size:15px;color:var(--mut);font-weight:600;letter-spacing:.4px;text-transform:uppercase}
.kpi{font-size:30px;font-weight:700}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}
th{color:var(--mut);font-weight:600}.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;border:1px solid var(--line)}
.pill.released{color:var(--ok)}.pill.funded{color:var(--warn)}.pill.disputed,.pill.refunded{color:var(--bad)}.pill.created{color:var(--mut)}
.muted{color:var(--mut)}.score{font-size:42px;font-weight:800}
.auth-hint{font-size:11px;color:var(--mut);margin-top:2px}
footer{padding:14px 22px;color:var(--mut);font-size:12px;text-align:center}
`.trim();

// The inline JS is built as a regular TS string (no template-literal nesting) to keep
// escaping unambiguous. Single quotes used throughout to avoid \" confusion.
const JS = `
var $=function(id){return document.getElementById(id)};

// Auth header routing (v102): tfa_… key → x-api-key; plain id → x-tenant-id (dev compat).
function authHeaders(){
  var v=($('tenant').value||'').trim()||'demo';
  if(v.indexOf('tfa_')===0){
    $('authHint').textContent='mode: API key (tfa_\u2026)';
    return{'x-api-key':v};
  }
  $('authHint').textContent='mode: tenant-id (dev)';
  return{'x-tenant-id':v};
}

var api=function(p){return fetch(p,{headers:authHeaders()}).then(function(r){return r.json()}).catch(function(){return null})};

$('tenant').addEventListener('input',function(){authHeaders();loadPlan();});

// Plan badge: fetch GET /api/tenants and show free/pro badge.
async function loadPlan(){
  var r=await api('/api/tenants');
  var plan=r&&r.plan;
  var el=$('planBadge');
  if(plan){el.textContent=plan.toUpperCase();el.className='plan-badge '+plan;}
  else{el.textContent='';el.className='plan-badge';}
}

async function loadAll(){
  var chain=await api('/api/transparency/chain');
  var recs=(chain&&(chain.data&&chain.data.records||chain.records||chain.data))||[];
  var verified=chain&&(chain.data&&chain.data.verified!==undefined?chain.data.verified:chain.verified);
  $('chainCount').textContent=Array.isArray(recs)?recs.length:0;
  $('chainState').textContent=verified===false?'BROKEN':'VERIFIED';
  $('chainState').className='kpi '+(verified===false?'bad':'ok');
  $('chainOk').textContent=verified===false?'FAILED':'intact';
  var bal=await api('/api/transparency/balances');
  var accounts=(bal&&(bal.data&&bal.data.accounts||bal.accounts))||[];
  $('balRows').innerHTML=accounts.map(function(a){return'<tr><td class="mono">'+a.id+'</td><td>'+(a.ownerId||'')+'</td><td>'+(a.type||'')+'</td><td class="mono">'+(a.balance!==undefined?a.balance:'')+'</td></tr>'}).join('')||'<tr><td colspan="4" class="muted">no accounts yet</td></tr>';
  var pp=await api('/api/transparency/passports');
  var plist=(pp&&(pp.data&&pp.data.passports||pp.passports||pp.data))||[];
  $('passportCount').textContent=Array.isArray(plist)?plist.length:0;
  var esc=await api('/api/escrow');
  var list=(esc&&(esc.data&&esc.data.agreements||esc.agreements||esc.data))||[];
  var arr=Array.isArray(list)?list:[];
  $('escrowCount').textContent=arr.length;
  $('escrowSettled').textContent=arr.filter(function(e){return e.state==='released'}).length;
  $('escrowFunded').textContent=arr.filter(function(e){return e.state==='funded'}).length;
  $('escrowDisputed').textContent=arr.filter(function(e){return e.state==='disputed'}).length;
  $('escRows').innerHTML=arr.map(function(e){return'<tr><td class="mono">'+e.id+'</td><td>'+(e.opportunityId||'')+'</td><td class="mono">'+(e.amount!==undefined?e.amount:'')+'</td><td><span class="pill '+e.state+'">'+e.state+'</span></td><td>'+(e.fundedBy||'\u2014')+'</td></tr>'}).join('')||'<tr><td colspan="5" class="muted">no escrows yet</td></tr>';
}
  // Track-records table: derive identities from escrow payerAccountId/workerAccountId,
  // then load their track records and render a summary table.
  var ids=[];
  arr.forEach(function(e){
    if(e.payerAccountId&&ids.indexOf(e.payerAccountId)<0)ids.push(e.payerAccountId);
    if(e.workerAccountId&&ids.indexOf(e.workerAccountId)<0)ids.push(e.workerAccountId);
  });
  if(ids.length===0){
    $('trRows').innerHTML='<tr><td colspan="5" class="muted">no escrows yet — track records appear here once participants have activity</td></tr>';
  } else {
    var rows=await Promise.all(ids.map(async function(id){
      var r=await api('/api/track-record/'+encodeURIComponent(id));
      var d=r&&(r.data||r);
      if(!d||typeof d.score!=='number')return null;
      var cls=d.score>=60?'ok':d.score<45?'bad':'warn';
      return'<tr><td class="mono">'+id+'</td><td class="'+cls+'" style="font-weight:700">'+d.score+'</td><td>'+(d.settledAsWorker||0)+' / '+(d.settledAsFunder||0)+'</td><td>'+(d.refunded||0)+' / '+(d.denied||0)+'</td><td class="mono">'+(d.settledVolume||0)+' \u03bc\u00a2</td></tr>';
    }));
    $('trRows').innerHTML=rows.filter(Boolean).join('')||'<tr><td colspan="5" class="muted">no records yet</td></tr>';
  }
}
async function loadRecord(){
  var id=($('identity').value||'').trim(); if(!id)return;
  var r=await api('/api/track-record/'+encodeURIComponent(id));
  var d=r&&(r.data||r); if(!d||typeof d.score!=='number'){$('trScore').textContent='?';return;}
  $('trScore').textContent=d.score; $('trScore').className='score '+(d.score>=60?'ok':d.score<45?'bad':'warn');
  $('trStats').textContent='settled(worker '+d.settledAsWorker+', funder '+d.settledAsFunder+') \u00b7 refunded '+d.refunded+' \u00b7 denied '+d.denied+' \u00b7 volume '+d.settledVolume+' \u03bc\u00a2';
  $('trExplain').innerHTML=(d.explanation||[]).map(function(e){return'<li>'+e+'</li>'}).join('');
}
loadAll();loadPlan();
`.trim();

export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>TFA \u2014 Tenant Dashboard</title>
<style>${CSS}</style></head><body>
<header>
  <h1>TFA \u2014 Accountable Autonomy</h1>
  <span class="sub">Tenant Dashboard \u00b7 read-only \u00b7 everything below is derived from the signed chain</span>
  <span style="flex:1"></span>
  <div>
    <input id="tenant" placeholder="tenant-id or tfa_\u2026 API key" value="demo" style="width:240px"/>
    <div class="auth-hint" id="authHint">mode: tenant-id (dev)</div>
  </div>
  <span id="planBadge" class="plan-badge"></span>
  <button onclick="loadAll();loadPlan()">Load</button>
</header>
<main>
  <div class="card"><h2>Trust Chain</h2><div class="kpi" id="chainState">\u2014</div>
    <div class="muted"><span id="chainCount">0</span> signed records \u00b7 integrity <span id="chainOk">unknown</span></div></div>
  <div class="card"><h2>Escrows</h2><div class="kpi" id="escrowCount">\u2014</div>
    <div class="muted">settled <span id="escrowSettled">0</span> \u00b7 in-flight <span id="escrowFunded">0</span> \u00b7 disputed <span id="escrowDisputed">0</span></div></div>
  <div class="card"><h2>Passports issued</h2><div class="kpi" id="passportCount">\u2014</div>
    <div class="muted">portable proofs anyone can verify offline</div></div>
  <div class="card" style="grid-column:1/-1"><h2>Balances (\u03bc\u00a2)</h2>
    <table><thead><tr><th>Account</th><th>Owner</th><th>Type</th><th>Balance \u03bc\u00a2</th></tr></thead><tbody id="balRows"></tbody></table></div>
  <div class="card" style="grid-column:1/-1"><h2>Escrow agreements</h2>
    <table><thead><tr><th>ID</th><th>Opportunity</th><th>Amount \u03bc\u00a2</th><th>State</th><th>Funded by</th></tr></thead><tbody id="escRows"></tbody></table></div>
  <div class="card" style="grid-column:1/-1"><h2>Track-record summary (all participants)</h2>
    <table><thead><tr><th>Identity</th><th>Score</th><th>Settled (worker / funder)</th><th>Refunded / Denied</th><th>Volume</th></tr></thead><tbody id="trRows"><tr><td colspan="5" class="muted">loading\u2026</td></tr></tbody></table></div>
  <div class="card" style="grid-column:1/-1"><h2>Track-record lookup (trust price discovery)</h2>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <input id="identity" placeholder="identity id (e.g. alice)"/><button onclick="loadRecord()">Check trust</button>
      <span class="score" id="trScore"></span><span class="muted" id="trStats"></span></div>
    <ul id="trExplain" class="muted"></ul></div>
</main>
<footer>Served by the sovereign kernel \u00b7 no external scripts \u00b7 data = your tenant only \u00b7
  Auth: enter a <code>tfa_\u2026</code> API key (from <code>POST /api/auth/api-keys</code>) for production,
  or a plain tenant-id for dev/demo.</footer>
<script>${JS}</script></body></html>`;
}
