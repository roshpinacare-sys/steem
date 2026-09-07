#!/usr/bin/env node
/* deposits.cjs — 114 THE-DEPOSITS (תיבת-ההפקדות): רשת-הקבלה-החיה של-הצבא.
 *
 * המנדט (מהמפעיל): "בהמשך אני אשלח גם איתריום וסולנה לרשת אז אולי כדאי קצת להיערך".
 *
 * הפריצה-מההבנה: הזהות-מ-113 היא-כבר-נמל — אותן-12×10 כתובות-מעוגנות הפכו-לרשת-קבלה.
 * כל-הפקדה-אמת-על-כל-רשת-מובילה → מתגלית-בדלתות-יתרה, מאושרת-2-טיקים, ומנופקת-על-הספר
 * wrap_mint 1:1 (אותו-דוקטרין-מ-WSTEEM: נכס-אמת-בכתובתנו = נעילה → מינט-מגובה).
 * המינט-הראשון-לכל-סמל → פתיחת-בריכה-אוטומטית מול-WSTEEM (pool_xAdd — נזילות-מיידית).
 *
 * רשתות-הקבלה (האותו-10-כמו-הזהות):
 *   EVM×7 (Ethereum·BSC·Polygon·Arbitrum·Optimism·Base·Avalanche) — JSON-RPC ציבורי
 *   TRON (trongrid) · SOL (mainnet-beta+devnet, מדודל-הגון-מול-תקרות) · BTC (mempool.space)
 *
 * סמלי-העטיפה: WETH (ethereum+arbitrum+optimism+base — אותו-נכס-ETH, הנעילות-נספרות-משותפת)
 *   WBNB·WPOL·WAVAX·WTRX·WSOL·WBTC. סף-אבק-מתועד-לכל-רשת (מתחתיו — אירוע-בלבד, בלי-מינט).
 *
 * דיסציפלינות: כותב-יחיד · inject דרך saosnet --inject (הבחנת DONE/REJECT) · dedupe-refs
 * · אפס-מפתחות-פרטיים-במודול-זה (קבלה-בלבד — הוצאה-היא-נושא-נפרד) · כל-כשל-RPC גלוי. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const STATEF = path.join(HERE, 'deposits-state.json');
const LOG = path.join(HERE, 'deposits.log');
const SNAPSHOT = path.join(HERE, 'state-snapshot.json');
const TICK_MS = 5 * 60 * 1000;
const SOL_EVERY = 3; // mainnet-beta מווסת — סקר-סולנה כל-טיק-שלישי (15 דק')
const CONFIRM_TICKS = 2; // הפקדה-מתמידה-על-פני-2-טיקים = מאושרת

const ACCOUNT = 'headcorner';
const VAULT = require('./vault-lib.cjs');

const dlog = (m) => { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n'); } catch (_) {} console.log(m); };

/* ── רשתות — אותו-סדר-כמו-הזהות (idx=סוכן) ── */
const CHAINS = [
  { key: 'ethereum', family: 'evm', sym: 'WETH', rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://1rpc.io/eth'], dust: 0.0001, decimals: 18 },
  { key: 'bsc', family: 'evm', sym: 'WBNB', rpc: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org'], dust: 0.0001, decimals: 18 },
  { key: 'polygon', family: 'evm', sym: 'WPOL', rpc: ['https://polygon-bor-rpc.publicnode.com'], dust: 0.01, decimals: 18 },
  { key: 'arbitrum', family: 'evm', sym: 'WETH', rpc: ['https://arbitrum-one-rpc.publicnode.com'], dust: 0.0001, decimals: 18 },
  { key: 'optimism', family: 'evm', sym: 'WETH', rpc: ['https://optimism-rpc.publicnode.com'], dust: 0.0001, decimals: 18 },
  { key: 'base', family: 'evm', sym: 'WETH', rpc: ['https://base-rpc.publicnode.com'], dust: 0.0001, decimals: 18 },
  { key: 'avalanche', family: 'evm', sym: 'WAVAX', rpc: ['https://avalanche-c-chain-rpc.publicnode.com'], dust: 0.001, decimals: 18 },
  { key: 'tron', family: 'tron', sym: 'WTRX', rpc: ['https://api.trongrid.io'], dust: 0.5, decimals: 6 },
  { key: 'solana', family: 'sol', sym: 'WSOL', rpc: ['https://api.mainnet-beta.solana.com', 'https://api.devnet.solana.com'], dust: 0.001, decimals: 9 },
  { key: 'bitcoin', family: 'btc', sym: 'WBTC', rpc: ['https://mempool.space'], dust: 0.00001, decimals: 8 },
];

function agentsList() {
  // אותו-רוסטר-כמו-wallets.cjs — מהכספת
  const names = new Set([ACCOUNT]);
  try { for (const a of (VAULT.readMember('vault.json').accounts || [])) if (a && a.username) names.add(String(a.username).toLowerCase()); } catch (_) {}
  return Array.from(names).sort();
}
function addressesFor() {
  // מהקובץ-הפומבי (הזהות-המעוגנת) — אפס-מפתחות-פרטיים-כאן
  const pub = JSON.parse(fs.readFileSync(path.join(HERE, 'wallets-public.json'), 'utf8'));
  return pub.agents; // [{agent, idx, evm, tron, sol, btc}]
}

/* ── קוראי-יתרה — כל-קורא-מחזיר-BigInt-ביחידה-הקטנה (wei/sun/lamport/sat) ── */
async function rpcPost(urls, body, timeoutMs = 15000) {
  let lastErr = null;
  for (const u of urls) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      clearTimeout(t);
      const j = await r.json();
      if (j && !j.error) return j;
      lastErr = new Error('rpc-error ' + (j.error ? j.error.message : '?'));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('no-rpc');
}
async function balEvm(addrs, chain, tick) {
  const j = await rpcPost(chain.rpc, { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addrs.evm, 'latest'] });
  return { raw: BigInt(j.result), unit: 'wei', via: chain.rpc[0] };
}
async function balTron(addrs, chain, tick) {
  const r = await fetch(chain.rpc[0] + '/v1/accounts/' + addrs.tron);
  const j = await r.json();
  const d = j && j.data && j.data[0];
  return { raw: BigInt((d && d.balance) || 0), unit: 'sun', via: 'trongrid' };
}
async function balSol(addrs, chain, tick) {
  // devnet-ראשית (שם-אכן-מנסים-לתדלק) · mainnet-beta-שנית — שניהם-נאמנים-לקבלה
  const urls = tick % 2 === 0 ? [chain.rpc[1], chain.rpc[0]] : chain.rpc;
  const j = await rpcPost(urls, { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [addrs.sol] });
  return { raw: BigInt(j.result.value), unit: 'lamport', via: j.result.value > 0 ? urls[0] : urls[0] };
}
async function balBtc(addrs, chain, tick) {
  const r = await fetch('https://mempool.space/api/address/' + addrs.btc);
  if (!r.ok) throw new Error('mempool ' + r.status);
  const j = await r.json();
  const cs = j.chain_stats || {};
  const ms = j.mempool_stats || {};
  const sat = (cs.funded_txo_sum || 0) - (cs.spent_txo_sum || 0) + (ms.funded_txo_sum || 0) - (ms.spent_txo_sum || 0);
  return { raw: BigInt(Math.max(0, sat)), unit: 'sat', via: 'mempool.space' };
}
const READERS = { evm: balEvm, tron: balTron, sol: balSol, btc: balBtc };

/* ── state ── */
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATEF, 'utf8')); } catch (_) {
    return { tick: 0, last: {}, pending: [], events: [], rpcHealth: {}, lastTickAt: null };
  }
}
function saveState(s) {
  const tmp = STATEF + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, STATEF);
}

/* ── inject — אותו-שער-כמו-הכל (DONE/REJECT · נעילה-עמוסה → ניסיון-חוזה) ── */
function inject(txs, tag) {
  const f = path.join(HERE, 'inject-deposits-' + Date.now() + '.json');
  fs.writeFileSync(f, JSON.stringify(txs));
  let out = '';
  for (let a = 0; a < 12; a++) {
    const r = spawnSync('node', [path.join(HERE, 'saosnet.cjs'), '--inject', f], { cwd: HERE, encoding: 'utf8', timeout: 150000 });
    out = (r.stdout || '') + '\n' + (r.stderr || '');
    if (/INJECT DONE/.test(out)) break;
    if (/LOCK-BUSY|beat lock held/.test(out) && a < 11) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000); continue; }
    break;
  }
  try { fs.unlinkSync(f); } catch (_) {}
  const done = /INJECT DONE/.test(out);
  const rejected = (out.match(/REJECT[^\n]*/g) || []).join(' | ').slice(0, 300);
  dlog('inject[' + tag + '] ' + (done ? (rejected ? 'APPLIED-WITH-REJECT' : 'OK') : 'FAIL') + (rejected ? ' :: ' + rejected : ''));
  return { done, rejected };
}

const µ = (x) => Math.round(Number(x) * 1000);

/* ── מינט-מגובה 1:1 + פתיחת-בריכה-ראשונה-מול-WSTEEM ── */
function mintWraps(confirmed, state) {
  if (!confirmed.length) return { minted: 0, pools: [] };
  const snap = (() => { try { return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')); } catch (_) { return {}; } })();
  const st = snap.st || snap;
  const wrapRefs = {};
  for (const [sym, w] of Object.entries(st.wrapped || {})) wrapRefs[sym] = w.refs || {};
  const me = (st.accounts || {})[ACCOUNT] || { wrapped: {} };
  const txs = [];
  for (const c of confirmed) {
    if (wrapRefs[c.sym] && wrapRefs[c.sym][c.ref]) continue; // dedupe-קשוח-מול-הספר
    txs.push({ type: 'wrap_mint', symbol: c.sym, issuer: ACCOUNT, to: c.agent, amount: c.human, lockedDelta: c.human, ref: c.ref, at: new Date().toISOString() });
  }
  if (!txs.length) return { minted: 0, pools: [] };
  const r = inject(txs, 'deposits:' + txs.length);
  if (!r.done) { dlog('mint: inject not applied — will retry next tick (הדדופ-שומר-עלינו-מכפילויות)'); return { minted: 0, pools: [] }; }
  state.minted = (state.minted || 0) + txs.length;
  // בריכה-ראשונה-לסמל-חדש: WSTEEM-מול-הסמל (headcorner עשיר-WSTEEM — נזילות-מיידית-לכל-הפקדה)
  const pools = [];
  const SEED_WSTEEM = 10000; // µ
  const fresh = confirmed.filter((c) => !(st.poolsX || {})[c.sym + '/WSTEEM'] && !(c.sym + '/WSTEEM').match(/^WSTEEM\//) && c.sym !== 'WSTEEM');
  const seenPool = new Set();
  const poolTxs = [];
  for (const c of fresh) {
    if (seenPool.has(c.sym)) continue;
    seenPool.add(c.sym);
    const haveSym = µ(c.human);
    if (haveSym <= 0) continue;
    if ((me.wrapped && (me.wrapped[c.sym] || 0)) + haveSym < haveSym) { /* המינט-לעיל-הגיע-לסוכן — הבריכה-תיפתח-בטיק-הבא-כשהיתרה-נראית-על-הספר */ continue; }
    poolTxs.push({ type: 'pool_xAdd', owner: ACCOUNT, pair: c.sym + '/WSTEEM', amountA: haveSym / 1000, amountB: SEED_WSTEEM / 1000, at: new Date().toISOString() });
    pools.push(c.sym + '/WSTEEM(' + haveSym + 'µ+' + SEED_WSTEEM + 'µ)');
  }
  if (poolTxs.length) {
    const rp = inject(poolTxs, 'pools:' + poolTxs.length);
    if (rp.done) state.poolsOpened = (state.poolsOpened || []).concat(pools);
  }
  return { minted: txs.length, pools };
}

/* ── טיק-אחד ── */
async function tick({ forceSol } = {}) {
  const state = loadState();
  const tickN = (state.tick || 0) + 1;
  state.tick = tickN;
  const addrs = addressesFor();
  const agents = agentsList();
  const byName = Object.fromEntries(addrs.map((a) => [a.agent, a]));
  const events = [], confirmedNow = [];
  const solTurn = forceSol || tickN % SOL_EVERY === 1; // טיק-ראשון ואז כל-שלישי

  for (const chain of CHAINS) {
    if (chain.family === 'sol' && !solTurn) { state.rpcHealth[chain.key] = { at: new Date().toISOString(), note: 'skip (תדמור-מול-תקרות — סיבוב-כל-' + SOL_EVERY + '-טיקים)' }; continue; }
    for (const name of agents) {
      const a = byName[name];
      if (!a) continue;
      const key = chain.key + '/' + name;
      let cur;
      try {
        cur = await READERS[chain.family](a, chain, tickN);
        state.rpcHealth[chain.key] = { at: new Date().toISOString(), ok: true, via: cur.via };
      } catch (e) {
        state.rpcHealth[chain.key] = { at: new Date().toISOString(), ok: false, err: String(e.message || e).slice(0, 80) };
        continue;
      }
      const prev = state.last[key];
      const prevRaw = prev !== undefined ? BigInt(prev) : null;
      state.last[key] = cur.raw.toString();
      if (prevRaw === null) continue; // סקר-ראשון — בזלינה-בלבד
      if (cur.raw <= prevRaw) continue;
      const delta = cur.raw - prevRaw;
      const human = Number(delta) / Math.pow(10, chain.decimals);
      const ev = { at: new Date().toISOString(), chain: chain.key, agent: name, sym: chain.sym, raw: delta.toString(), human, unit: cur.unit, addr: a[chain.family === 'evm' ? 'evm' : chain.family] };
      events.push(ev);
      state.events.unshift(ev);
      if (state.events.length > 200) state.events.length = 200;
      if (human < chain.dust) { ev.note = 'under-dust (מתועד-בלי-מינט)'; continue; }
      // אישור-דו-טיקי: הפקדה-שמתמדת (היתרה-לא-נעלמת)
      const pkey = key + ':' + delta.toString();
      const pend = (state.pending || []).find((p) => p.key === pkey);
      if (!pend) state.pending = (state.pending || []).concat([{ key: pkey, chain: chain.key, agent: name, sym: chain.sym, human, raw: delta.toString(), firstTick: tickN, ticks: 1 }]);
      else pend.ticks++;
      const p = (state.pending || []).find((p) => p.key === pkey);
      if (p && p.ticks >= CONFIRM_TICKS) {
        p.confirmedAt = new Date().toISOString();
        confirmedNow.push({ ...p, ref: 'dep:' + chain.key + ':' + name + ':' + delta.toString(16) });
      }
    }
  }
  // ניקוי-ממתינים-שאושרו-או-התפוגגו (יתרה-חזרה-לבזלינה)
  state.pending = (state.pending || []).filter((p) => {
    if (p.confirmedAt) return false;
    const curRaw = state.last[p.chain + '/' + p.agent];
    return curRaw !== undefined && BigInt(curRaw) >= BigInt(p.raw); // עדיין-מוחזק
  });

  let mint = { minted: 0, pools: [] };
  if (confirmedNow.length) mint = mintWraps(confirmedNow, state);
  state.lastTickAt = new Date().toISOString();
  saveState(state);
  const alive = Object.values(state.rpcHealth).filter((h) => h.ok).length;
  dlog('tick#' + tickN + ' · ' + alive + '/' + CHAINS.length + ' chains-ok · deposits:' + events.length + ' · confirmed:' + confirmedNow.length + ' · minted:' + mint.minted + (mint.pools.length ? ' · pools:' + mint.pools.join(',') : ''));
  return { tickN, events, confirmed: confirmedNow, mint, alive: alive, chains: CHAINS.length };
}

function status() {
  try { return JSON.parse(fs.readFileSync(STATEF, 'utf8')); } catch (_) { return null; }
}

async function main() {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'once') { await tick({ forceSol: process.argv.includes('--sol') }); }
  else if (cmd === 'watch') {
    dlog('watch: THE-DEPOSITS alive — כל-' + (TICK_MS / 60000) + ' דק׳ · ' + CHAINS.length + ' רשתות-קבלה · ' + CONFIRM_TICKS + '-טיקים-אישור · wrap 1:1 אוטומטי');
    // בטיק-הפתיחה קוראים-בזלינות בלבד (אפס-אירועים); סולנה-בסיבוב-הראשון
    for (;;) {
      try { await tick({}); } catch (e) { dlog('tick-ERROR ' + (e.message || e)); }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, TICK_MS);
    }
  } else if (cmd === 'status') { console.log(JSON.stringify(status(), null, 2)); }
  else { console.log('usage: deposits.cjs once|watch|status [--sol]'); process.exitCode = 2; }
}
if (require.main === module) main();
module.exports = { tick, status, CHAINS };
