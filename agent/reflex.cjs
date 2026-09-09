#!/usr/bin/env node
/**
 * reflex.cjs — Task 54: BLOCK-REFLEX ENGINE (מנוע-רפלקס-בלוק).
 *
 * התשובה ל"תגובות בבלוק בלי עלות-אנרגיה דרך ריבונות":
 *   הפעולה-המקומית (טריגר של האוצר) גוררת באותו-בלוק-כמעט תגובת-צי
 *   חתומה על-ידי כל-החיילים — בלי אף-טוקן נזיל, רק דלק-ריבוני (RC מהאצלות).
 *
 * הסוד-ההנדסי (מה שהשרשרת לא ראתה): **מטח-חתום-מראש** —
 *   כל-התגובות של כל-החיילים נחתמות מקומית לפני-שהטריגר אפילו נשלח.
 *   ברגע-זיהוי-בלוק-הטריגר (סריקת-בלוק, get_transaction לא נחוץ) —
 *   כל-החתימות נשדרות במקביל (~0.5ש׳) → נוחתות בבלוק N+1/N+2.
 *   הרפלקס של הצי מהיר-מהרפלקס-של-אדם: 3-6 שניות, בדיוק-בלוק.
 *
 * מה-נמדד (הכל-על-השרשרת, אפס-סיפורים):
 *   1. trigBlock / trigger txid — סריקת-בלוק מיידית
 *   2. latencyBlocks לכל-חייל = respBlock − trigBlock (יעד: ≤2)
 *   3. עלות-נזילה = 0 (custom_json בלי-כמויות; RC-ריבוני בלבד)
 *   4. RC-לפני/אחרי לכל-חייל → עלות-אנרגיה-מדודה לכל-תגובה
 *   5. מטח רב-סבבי (default 3) → קצב-קבוע בלי-התרוקנות
 *   6. רגל-דו-שרשרתית: digest המטח נעוגן-על-Hive דרך-החייל-הבריא
 *      (ראוטר-צי — טריגר-Steem → תגובה-גם-בשרשרת-השנייה)
 *
 * Usage: node reflex.cjs [--live] [--rounds N] [--dry]
 *   ברירת-מחדל: --dry (בטוח). --live = ירי-אמיתי.
 * Output: reflex_evidence.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const steem = require('steem');

const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const STEEM_RPC = process.env.STEEM_RPC || 'https://api.steemit.com';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const EVIDENCE_PATH = path.join(__dirname, 'reflex_evidence.json');
const EVIDENCE_EXT_PATH = path.join(__dirname, 'reflex_external_evidence.json'); // Task 55 — external events live here (54-proofs read the standard file)

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) || (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(__dirname);

const ACCOUNT = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const POSTING_WIF = process.env.POSTING_WIF || '';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const LIVE = GATE.live;
const DRY = GATE.dry;
announceGate(GATE, log);

// Task 55 — external-event reflex: the fleet responds to ARBITRARY chain events
// (transfers), not only to its own saos triggers. Two modes:
//   drill — the engine SENDS the external event itself (soldier→treasury transfer
//           with the saos drill memo), block-scans for it, and the swarm responds
//           relative to the TRANSFER BLOCK (the purest latency proof).
//   watch — the daemon's transferWatch already detected an incoming transfer;
//           the engine fires a treasury ack as the sync point and the swarm
//           responds ≤2 blocks from the reaction point.
const argVal = (name) => (process.argv.find((a) => a.startsWith(name + '=')) || '').split('=').slice(1).join('=');
const EXTERNAL = process.argv.includes('--external');
const EXT_MODE = argVal('--mode') || 'watch';
const EXT_FROM = argVal('--from');
const EXT_AMOUNT = argVal('--amount');
const EXT_MEMO = argVal('--memo') || 'saos-drill';
const ROUNDS = Math.max(1, Math.min(6, parseInt(process.env.REFLEX_ROUNDS || (process.argv.find((a) => a.startsWith('--rounds')) || '').split('=')[1] || '3', 10) || 3));
const NONCE = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function log(msg) { console.log('[' + new Date().toISOString() + '] reflex: ' + msg); }
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 },
      (res) => { let buf = ''; res.on('data', (d) => (buf += d)); res.on('end', () => { try { const j = JSON.parse(buf); j.error ? reject(new Error(typeof j.error === 'string' ? j.error : (j.error.message || 'rpc'))) : resolve(j.result); } catch (e) { reject(new Error('bad rpc')); } }); }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(payload);
  });
}

/* ---------------- vault ---------------- */
function vaultAccounts() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    return (v.accounts || [])
      .map((a) => ({
        username: String(a.username || '').toLowerCase(),
        posting: a.keys && a.keys.posting && a.keys.posting.wif ? a.keys.posting.wif : null,
      }))
      .filter((a) => a.username && a.posting && a.username !== ACCOUNT);
  } catch (e) {
    log('vault read failed: ' + e.message);
    return [];
  }
}

/* ---------------- signing helpers ---------------- */
async function dgp(rpcUrl) {
  return rpcV4(rpcUrl, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
}
async function broadcast(urlStr, signed) {
  await rpcV4(urlStr, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 2 });
}

/* PRE-SIGNED RESPONSE SWARM — the core trick.
 * חותמים את כל-התגובות עכשיו; payload מתייחס ל-nonce ולזמן-טריגר (לא לבלוק —
 * שעדיין לא ידוע), כך-שהחתימות תקפות 90ש׳ ונשדרות רגע-זיהוי-הבלוק. */
async function preSignSwarm(soldiers, round, nonce, trigTs, ext) {
  const snap = await dgp(STEEM_RPC);
  const out = [];
  for (const s of soldiers) {
    const payload = ext
      ? { t: 'reflex', v: 54, phase: 'resp', r: round, n: nonce, trigTs, by: s.username, ts: new Date().toISOString(), src: 'external', ev: { f: ext.from, a: ext.amount } }
      : { t: 'reflex', v: 54, phase: 'resp', r: round, n: nonce, trigTs, by: s.username, ts: new Date().toISOString() };
    const op = [['custom_json', { required_auths: [], required_posting_auths: [s.username], id: 'saos', json: JSON.stringify(payload) }]];
    try {
      const tx = { ref_block_num: snap.head_block_number & 0xffff, ref_block_prefix: Buffer.from(snap.head_block_id, 'hex').readUInt32LE(4), expiration: new Date(new Date(snap.time + 'Z').getTime() + 90000).toISOString().slice(0, 19), operations: op, extensions: [] };
      const signed = steem.auth.signTransaction(tx, [s.posting]);
      out.push({ soldier: s.username, signed, payload });
    } catch (e) {
      out.push({ soldier: s.username, error: String(e.message || e).slice(0, 80) });
    }
  }
  return out;
}

/* ---------------- block scan ---------------- */
async function scanBlock(b, nonce, phase, round) {
  const blk = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_block', params: [b], id: 4 }).catch(() => null);
  if (!blk || !Array.isArray(blk.transactions)) return null;
  const hits = [];
  for (const t of blk.transactions) {
    for (const [type, v] of t.operations || []) {
      if (type !== 'custom_json' || v.id !== 'saos') continue;
      try {
        const pl = JSON.parse(String(v.json || '{}'));
        if (pl.t === 'reflex' && pl.v === 54 && pl.n === nonce && pl.r === round && pl.phase === phase) {
          const signers = (v.required_posting_auths || []).concat(v.required_auths || []).map((x) => String(x).toLowerCase());
          hits.push({ block: b, txid: t.transaction_id, signer: signers[0] || '?', trigTs: pl.trigTs || null, by: pl.by || null });
        }
      } catch (_) { /* foreign payload */ }
    }
  }
  return hits;
}

/** full vault entry for one account — all roles (external drill needs the ACTIVE key to move funds) */
function vaultAccountFull(username) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const a = (v.accounts || []).find((x) => String(x.username || '').toLowerCase() === String(username).toLowerCase());
    if (!a || !a.keys) return null;
    return {
      username: String(a.username).toLowerCase(),
      posting: a.keys.posting && a.keys.posting.wif,
      active: a.keys.active && a.keys.active.wif,
    };
  } catch (e) { return null; }
}

/** broadcast a real transfer (ACTIVE authority) — creates the external event in drill mode */
async function sendTransfer(sender, amount, memo) {
  const d = await dgp(STEEM_RPC);
  const op = [['transfer', { from: sender.username, to: ACCOUNT, amount, memo: String(memo || '').slice(0, 120) }]];
  const tx = { ref_block_num: d.head_block_number & 0xffff, ref_block_prefix: Buffer.from(d.head_block_id, 'hex').readUInt32LE(4), expiration: new Date(new Date(d.time + 'Z').getTime() + 90000).toISOString().slice(0, 19), operations: op, extensions: [] };
  const signed = steem.auth.signTransaction(tx, [sender.active]);
  await broadcast(STEEM_RPC, signed);
  return { txid: signed.transaction_id || null };
}

/** block-scan for an incoming transfer matching from+amount (the external event IS the trigger) */
async function findTransferTrigger(headAtSend, from, amount) {
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const d = await dgp(STEEM_RPC).catch(() => null);
    const head = d ? d.head_block_number : headAtSend;
    for (let b = headAtSend; b <= Math.min(head, headAtSend + 15); b++) {
      const blk = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_block', params: [b], id: 4 }).catch(() => null);
      if (!blk || !Array.isArray(blk.transactions)) continue;
      for (const t of blk.transactions) {
        for (const [type, v] of t.operations || []) {
          if (type !== 'transfer') continue;
          if (String(v.to || '').toLowerCase() !== ACCOUNT) continue;
          if (String(v.from || '').toLowerCase() !== String(from).toLowerCase()) continue;
          if (amount && String(v.amount || '') !== String(amount)) continue;
          return { block: b, txid: t.transaction_id, detectionMs: Date.now() - t0, headAtDetection: head };
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** EXTERNAL-EVENT MAIN — the fleet reacts to an arbitrary transfer, not to a saos trigger. */
async function externalMain() {
  if (!EXT_FROM || !EXT_AMOUNT) throw new Error('external mode needs --from and --amount');
  if (!/saos/i.test(EXT_MEMO)) throw new Error('external memo must carry the saos tag (internal-storm guard)');
  if (DRY) { log('DRY — external reflex (' + EXT_MODE + ') would react to ' + EXT_AMOUNT + ' from @' + EXT_FROM + ' — nothing broadcast'); return; }
  const soldiers = vaultAccounts();
  if (!soldiers.length) throw new Error('no soldiers with posting keys in vault');
  const ext = { from: EXT_FROM.toLowerCase(), amount: EXT_AMOUNT, memo: EXT_MEMO };
  log('EXTERNAL-REFLEX (' + EXT_MODE + ') — swarm will react to transfer ' + ext.amount + ' from @' + ext.from + ' · nonce=' + NONCE);

  const manaBefore = await rcMapSteem(soldiers.map((s) => s.username).concat([ACCOUNT]));
  const round = 1;
  const roundNonce = NONCE + '-ext';
  const trigTs = new Date().toISOString();

  // 1. PRE-SIGN the swarm — reactions locked BEFORE the external event exists
  const swarm = await preSignSwarm(soldiers, round, roundNonce, trigTs, ext);
  const ready = swarm.filter((x) => x.signed);
  if (!ready.length) throw new Error('pre-sign failed for all soldiers');
  log('swarm PRE-SIGNED ×' + ready.length + ' — locked before the event');

  // 2. the event + sync point
  let extEvent, trigBlock;
  if (EXT_MODE === 'drill') {
    const sender = vaultAccountFull(ext.from);
    if (!sender || !sender.active) throw new Error('no active key in vault for drill sender @' + ext.from);
    const d = await dgp(STEEM_RPC);
    const headAtSend = d.head_block_number;
    const t0 = Date.now();
    await sendTransfer(sender, ext.amount, ext.memo);
    extEvent = { source: 'drill', from: ext.from, amount: ext.amount, memo: ext.memo, headAtSend, sentMs: Date.now() - t0 };
    const trig = await findTransferTrigger(headAtSend, ext.from, ext.amount);
    if (!trig) throw new Error('transfer not found in 15 blocks');
    extEvent = { ...extEvent, block: trig.block, txid: trig.txid, detectedMs: trig.detectionMs };
    trigBlock = trig.block;
    log('external event LIVE: transfer @block ' + trig.block + ' (detection ' + trig.detectionMs + 'ms) — the event IS the trigger');
  } else {
    const d = await dgp(STEEM_RPC);
    const headAtSend = d.head_block_number;
    const ackPayload = { t: 'reflex', v: 54, phase: 'trig', r: round, n: roundNonce, swarm: ready.length, src: 'external', ev: { f: ext.from, a: ext.amount }, ts: trigTs };
    const ackOp = [['custom_json', { required_auths: [], required_posting_auths: [ACCOUNT], id: 'saos', json: JSON.stringify(ackPayload) }]];
    const ackTx = { ref_block_num: headAtSend & 0xffff, ref_block_prefix: Buffer.from(d.head_block_id, 'hex').readUInt32LE(4), expiration: new Date(new Date(d.time + 'Z').getTime() + 90000).toISOString().slice(0, 19), operations: ackOp, extensions: [] };
    await broadcast(STEEM_RPC, steem.auth.signTransaction(ackTx, [POSTING_WIF]));
    const trig = await findTrigger(headAtSend, roundNonce, round);
    if (!trig) throw new Error('ack trigger not found in 15 blocks');
    extEvent = { source: 'transferWatch', from: ext.from, amount: ext.amount, memo: ext.memo, ackBlock: trig.block, ackTxid: trig.txid, detectionMs: trig.detectionMs };
    trigBlock = trig.block;
    log('ack @block ' + trig.block + ' — swarm responds relative to the reaction point');
  }

  // 3. INSTANT RESPONSE — pre-signed swarm parallel broadcast
  const tResp = Date.now();
  const sendResults = await Promise.all(ready.map(async (x) => {
    try { await broadcast(STEEM_RPC, x.signed); return { soldier: x.soldier, sentMs: Date.now() - tResp }; }
    catch (e) { return { soldier: x.soldier, error: String(e.message || e).slice(0, 70) }; }
  }));
  const sentOk = sendResults.filter((x) => !x.error).length;
  log(sentOk + '/' + ready.length + ' responses broadcast in ' + (Date.now() - tResp) + 'ms');

  // 4. collect + latency
  const col = await collectResponses(trigBlock, roundNonce, round, ready.map((x) => x.soldier));
  const latArr = Object.values(col.lat).filter(Boolean).map((v) => v.latencyBlocks);
  const maxLat = latArr.length ? Math.max(...latArr) : null;
  const avgLat = latArr.length ? latArr.reduce((a, b) => a + b, 0) / latArr.length : null;
  log('responses ' + latArr.length + '/' + ready.length + ' · latencyBlocks max=' + maxLat + ' avg=' + (avgLat && avgLat.toFixed(2)));

  // 5. mana + digest → Hive anchor
  await new Promise((r) => setTimeout(r, 2500));
  const manaAfter = await rcMapSteem(soldiers.map((s) => s.username).concat([ACCOUNT]));
  const respTxids = Object.values(col.lat).filter(Boolean).map((v) => v.txid).filter(Boolean);
  const digestSrc = ['v54-ext', NONCE, trigBlock, respTxids.sort().join(',')].join('|');
  const digest = sha256(digestSrc);
  const hiveAnchor = await hiveAnchorDigest(digest, { nonce: NONCE, ext: ext.from, responses: respTxids.length, maxLatencyBlocks: maxLat }).catch((e) => ({ error: String(e.message || e).slice(0, 80) }));

  const evidence = {
    at: new Date().toISOString(),
    live: true,
    nonce: NONCE,
    engine: 'block-reflex v54 — external-event mode',
    externalEvent: extEvent,
    rounds: [{
      round: 1,
      nonce: roundNonce,
      trigger: { block: trigBlock, txid: extEvent.txid || extEvent.ackTxid, detectionMs: extEvent.detectedMs || extEvent.detectionMs || null, headAtSend: extEvent.headAtSend || null },
      swarm: ready.map((x) => x.soldier),
      sendResults,
      responses: col.lat,
      maxLatencyBlocks: maxLat,
      avgLatencyBlocks: avgLat,
    }],
    summary: {
      rounds: 1,
      triggers: [{ r: 1, block: trigBlock, txid: extEvent.txid || extEvent.ackTxid }],
      swarmSize: soldiers.length,
      totalResponses: respTxids.length,
      maxLatencyBlocks: maxLat,
      avgLatencyBlocks: avgLat,
      liquidCost: 0,
      opType: 'custom_json (no amounts — zero liquid by construction)',
      distinctSigners: [...new Set(Object.entries(col.lat).filter(([, v]) => v).map(([k]) => k))].length,
      digest,
      digestSrc,
      hiveAnchor,
      hiveDrill: null,
    },
    manaBefore,
    manaAfter,
    manaDelta: Object.fromEntries(Object.keys(manaAfter).filter((k) => manaBefore[k]).map((k) => [k, +(manaAfter[k].pct - manaBefore[k].pct).toFixed(2)])),
  };
  fs.writeFileSync(EVIDENCE_EXT_PATH, JSON.stringify(evidence, null, 2) + '\n');
  log('EVIDENCE WRITTEN: ' + EVIDENCE_EXT_PATH);
  log('SUMMARY: external-reflex from @' + ext.from + ' ' + ext.amount + ' · responses=' + respTxids.length + ' · maxLatency=' + maxLat + ' blocks · liquidCost=0');
  if (!respTxids.length) process.exit(1);
}

/** poll for the trigger: scan forward from headAtSend until found (≤15 blocks) */
async function findTrigger(headAtSend, nonce, round) {
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const d = await dgp(STEEM_RPC).catch(() => null);
    const head = d ? d.head_block_number : headAtSend;
    for (let b = headAtSend; b <= Math.min(head, headAtSend + 15); b++) {
      const hits = await scanBlock(b, nonce, 'trig', round).catch(() => null);
      if (hits && hits.length) return { ...hits[0], detectionMs: Date.now() - t0, headAtDetection: head };
      if (b - headAtSend > 15 && Date.now() - t0 > 20000) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** collect responses in blocks trigBlock..trigBlock+6, per soldier latency */
async function collectResponses(trigBlock, nonce, round, expected) {
  const lat = new Map(expected.map((s) => [s, null]));
  const raw = [];
  for (let i = 0; i < 30; i++) {
    let done = true;
    for (let off = 0; off <= 6; off++) {
      const b = trigBlock + off;
      const hits = await scanBlock(b, nonce, 'resp', round).catch(() => null);
      for (const h of hits || []) {
        raw.push(h);
        if (lat.has(h.signer) && lat.get(h.signer) === null) lat.set(h.signer, { block: h.block, latencyBlocks: b - trigBlock, txid: h.txid });
      }
    }
    for (const v of lat.values()) if (v === null) done = false;
    if (done) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { lat: Object.fromEntries(lat), raw };
}

/* ---------------- RC (mana) ---------------- */
/** rc_api shape: { account, max_rc (top-level string), rc_manabar:{current_mana, last_update_time} }
 *  mana regenerates over 5 days — recompute to "now" (rc_sovereign lesson). */
function rcParse(a) {
  if (!a) return { pct: 0, max: 0, now: 0 };
  const max = Number(a.max_rc) || 0;
  const stored = Number(a.rc_manabar && a.rc_manabar.current_mana) || 0;
  const lu = Number(a.rc_manabar && a.rc_manabar.last_update_time) || 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const cur = Math.min(max, stored + Math.floor(((nowSec - lu) * max) / (5 * 86400)));
  return { pct: max > 0 ? (cur / max) * 100 : 0, max, now: cur };
}
async function rcMapSteem(names) {
  try {
    const r = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: names }, id: 1 });
    const out = {};
    for (const a of (r && r.rc_accounts) || []) out[a.account] = rcParse(a);
    return out;
  } catch (e) { log('rc_api steem failed: ' + e.message); return {}; }
}
async function rcMapHive(names) {
  try {
    const r = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: names }, id: 1 });
    const out = {};
    for (const a of (r && r.rc_accounts) || []) out[a.account] = rcParse(a);
    return out;
  } catch (e) { return {}; }
}

/* ---------------- Hive anchor (cross-chain reflex leg) ---------------- */
async function hiveAnchorDigest(digest, meta) {
  const soldiers = vaultAccounts();
  const names = soldiers.map((s) => s.username);
  const hrc = await rcMapHive(names);
  const HIVE_OP_COST_RC = 1.2e9; // measured Task 55: a Hive custom_json costs >114M for vest-less accounts — full anchors drained 2.5-4G
  const ordered = soldiers.map((s) => ({ s, pct: (hrc[s.username] && hrc[s.username].pct) || 0, now: (hrc[s.username] && hrc[s.username].now) || 0 })).filter((x) => x.now >= HIVE_OP_COST_RC).sort((x, y) => y.pct - x.pct);
  if (!ordered.length) return { error: 'fleet Hive-RC ration (wall 28): no soldier above 1.2G mana — regen window, anchor deferred' };
  for (const { s, pct } of ordered) {
    try {
      const d = await dgp(HIVE_RPC);
      const payload = { t: 'reflex-anchor', v: 54, n: meta.nonce, digest, rounds: meta.rounds, responses: meta.responses, maxLatencyBlocks: meta.maxLatencyBlocks, ts: new Date().toISOString() };
      const op = [['custom_json', { required_auths: [], required_posting_auths: [s.username], id: 'saos', json: JSON.stringify(payload) }]];
      const tx = { ref_block_num: d.head_block_number & 0xffff, ref_block_prefix: Buffer.from(d.head_block_id, 'hex').readUInt32LE(4), expiration: new Date(new Date(d.time + 'Z').getTime() + 90000).toISOString().slice(0, 19), operations: op, extensions: [] };
      const prev = steem.config.get('chain_id');
      steem.config.set('chain_id', HIVE_CHAIN_ID);
      let signed;
      try { signed = steem.auth.signTransaction(tx, [s.posting]); } finally { steem.config.set('chain_id', prev); }
      await broadcast(HIVE_RPC, signed);
      // Hive visibility via the signer's own history (cascade lesson — fast & reliable)
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const hist = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [s.username, -1, 20], id: 3 }).catch(() => null);
        for (const [, e] of (hist && Array.isArray(hist) ? hist : [])) {
          const op = e && e.op;
          if (!op || op[0] !== 'custom_json' || op[1].id !== 'saos') continue;
          try {
            const pl = JSON.parse(String(op[1].json || '{}'));
            if (pl.t === 'reflex-anchor' && pl.digest === digest) return { account: s.username, rcPct: Math.round(pct), txid: e.trx_id || null, block: e.block || null, verified: !!e.trx_id };
          } catch (_) {}
        }
      }
      return { account: s.username, rcPct: Math.round(pct), txid: null, block: null, verified: false, note: 'broadcast ok, visibility pending' };
    } catch (e) {
      log('hive anchor via @' + s.username + ' failed: ' + String(e.message || e).slice(0, 60) + ' — next soldier');
    }
  }
  return null;
}

/* ---------------- Hive-side reflex (hostless proof) ----------------
 * הרפלקס לא תלוי-ב-Steem בכלל: טריגר של חייל על Hive → תגובות הצי על Hive,
 * נמדד בבלוקים של Hive. הוכחה שהמנוע ריבוני — רץ על כל שרשרת-גרפין. */
async function scanBlockHive(b, nonce, phase) {
  const blk = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_block', params: [b], id: 4 }).catch(() => null);
  if (!blk || !Array.isArray(blk.transactions)) return null;
  const hits = [];
  blk.transactions.forEach((t, i) => {
    for (const op of t.operations || []) {
      const [type, v] = op;
      if (type !== 'custom_json' || v.id !== 'saos') continue;
      try {
        const pl = JSON.parse(String(v.json || '{}'));
        if (pl.t === 'reflex-h' && pl.v === 54 && pl.n === nonce && pl.phase === phase) {
          const signers = (v.required_posting_auths || []).concat(v.required_auths || []).map((x) => String(x).toLowerCase());
          hits.push({ block: b, txid: (blk.transaction_ids && blk.transaction_ids[i]) || t.transaction_id || null, signer: signers[0] || '?' });
        }
      } catch (_) { /* foreign payload */ }
    }
  });
  return hits;
}

async function hiveDrillRound() {
  const soldiers = vaultAccounts();
  if (soldiers.length < 3) return { error: 'not enough soldiers for hive drill' };
  const names = soldiers.map((s) => s.username);
  const hrc = await rcMapHive(names);
  const ordered = soldiers.map((s) => ({ s, pct: (hrc[s.username] && hrc[s.username].pct) || 0 })).sort((x, y) => y.pct - x.pct);
  const trigSoldier = ordered[0].s; // הבריא ביותר יורה את הטריגר
  const responders = ordered.slice(1).map((x) => x.s);
  const n = 'h' + Date.now().toString(36);

  // 1. PRE-SIGN the Hive swarm
  const d = await dgp(HIVE_RPC);
  const headAtSend = d.head_block_number;
  const signed = [];
  for (const s of responders) {
    const payload = { t: 'reflex-h', v: 54, phase: 'resp', n, trigTs: new Date().toISOString(), by: s.username };
    const op = [['custom_json', { required_auths: [], required_posting_auths: [s.username], id: 'saos', json: JSON.stringify(payload) }]];
    const tx = { ref_block_num: d.head_block_number & 0xffff, ref_block_prefix: Buffer.from(d.head_block_id, 'hex').readUInt32LE(4), expiration: new Date(new Date(d.time + 'Z').getTime() + 90000).toISOString().slice(0, 19), operations: op, extensions: [] };
    const prev = steem.config.get('chain_id');
    steem.config.set('chain_id', HIVE_CHAIN_ID);
    try { signed.push({ soldier: s.username, tx: steem.auth.signTransaction(tx, [s.posting]) }); } catch (e) { /* skip */ } finally { steem.config.set('chain_id', prev); }
  }
  if (!signed.length) return { error: 'hive pre-sign failed' };

  // 2. trigger from the healthiest soldier
  const trigPayload = { t: 'reflex-h', v: 54, phase: 'trig', n, swarm: signed.length, ts: new Date().toISOString() };
  const trigOp = [['custom_json', { required_auths: [], required_posting_auths: [trigSoldier.username], id: 'saos', json: JSON.stringify(trigPayload) }]];
  const trigTx = { ref_block_num: d.head_block_number & 0xffff, ref_block_prefix: Buffer.from(d.head_block_id, 'hex').readUInt32LE(4), expiration: new Date(new Date(d.time + 'Z').getTime() + 90000).toISOString().slice(0, 19), operations: trigOp, extensions: [] };
  const prevC = steem.config.get('chain_id');
  steem.config.set('chain_id', HIVE_CHAIN_ID);
  let trigSigned;
  try { trigSigned = steem.auth.signTransaction(trigTx, [trigSoldier.posting]); } finally { steem.config.set('chain_id', prevC); }
  await broadcast(HIVE_RPC, trigSigned);

  // 3. detect trigger block on Hive (block scan)
  let trigBlock = null, trigTxid = null, detectionMs = null;
  const t0 = Date.now();
  for (let i = 0; i < 40 && !trigBlock; i++) {
    const hd = await dgp(HIVE_RPC).catch(() => null);
    const head = hd ? hd.head_block_number : headAtSend;
    for (let b = headAtSend; b <= Math.min(head, headAtSend + 15); b++) {
      const hits = await scanBlockHive(b, n, 'trig').catch(() => null);
      if (hits && hits.length) { trigBlock = b; trigTxid = hits[0].txid; detectionMs = Date.now() - t0; break; }
    }
    if (!trigBlock) await new Promise((r) => setTimeout(r, 500));
  }
  if (!trigBlock) return { error: 'hive trigger not found', nonce: n };

  // 4. fire pre-signed swarm instantly
  const tResp = Date.now();
  await Promise.all(signed.map((x) => broadcast(HIVE_RPC, x.tx).catch(() => null)));

  // 5. collect latency per soldier (Hive blocks)
  const lat = new Map(signed.map((x) => [x.soldier, null]));
  for (let i = 0; i < 24; i++) {
    let done = true;
    for (let off = 0; off <= 6; off++) {
      const hits = await scanBlockHive(trigBlock + off, n, 'resp').catch(() => null);
      for (const h of hits || []) if (lat.has(h.signer) && lat.get(h.signer) === null) lat.set(h.signer, { block: h.block, latencyBlocks: h.block - trigBlock, txid: h.txid });
    }
    for (const v of lat.values()) if (v === null) done = false;
    if (done) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const latArr = [...lat.values()].filter(Boolean).map((v) => v.latencyBlocks);
  const out = {
    triggerBy: trigSoldier.username,
    trigBlock,
    trigTxid,
    detectionMs,
    responses: Object.fromEntries(lat),
    totalResponses: latArr.length,
    maxLatencyBlocks: latArr.length ? Math.max(...latArr) : null,
    avgLatencyBlocks: latArr.length ? latArr.reduce((a, b) => a + b, 0) / latArr.length : null,
    signers: [...lat.keys()].filter((k) => lat.get(k)),
  };
  log('HIVE-DRILL: trigger @blk ' + trigBlock + ' by @' + trigSoldier.username + ' · responses ' + out.totalResponses + '/' + signed.length + ' · maxLatency ' + out.maxLatencyBlocks + ' Hive-blocks — Steem not involved');
  return out;
}

/* ---------------- main drill ---------------- */
async function main() {
  if (EXTERNAL) return externalMain();
  const soldiers = vaultAccounts();
  if (!soldiers.length) throw new Error('no soldiers with posting keys in vault');
  if (!POSTING_WIF && !DRY) throw new Error('POSTING_WIF missing (treasury trigger key)');
  log((DRY ? 'DRY — ' : 'LIVE — ') + 'block-reflex drill · rounds=' + ROUNDS + ' · swarm=' + soldiers.length + ' (' + soldiers.map((s) => s.username).join(',') + ') · nonce=' + NONCE);

  const manaBefore = await rcMapSteem(soldiers.map((s) => s.username).concat([ACCOUNT]));
  if (DRY) {
    log('DRY: would fire ' + ROUNDS + ' trigger rounds, ' + soldiers.length + ' pre-signed responses each, then Hive anchor');
    const ev = { at: new Date().toISOString(), dry: true, rounds: ROUNDS, swarm: soldiers.map((s) => s.username), note: 'dry run — nothing broadcast' };
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(ev, null, 2) + '\n');
    return;
  }

  const rounds = [];
  for (let r = 1; r <= ROUNDS; r++) {
    const roundNonce = NONCE + '-' + r;
    const trigTs = new Date().toISOString();
    // 1. PRE-SIGN the whole swarm (before the trigger is even broadcast)
    const swarm = await preSignSwarm(soldiers, r, roundNonce, trigTs);
    const ready = swarm.filter((x) => x.signed);
    if (!ready.length) throw new Error('pre-sign failed for all soldiers');
    log('round ' + r + '/' + ROUNDS + ': swarm PRE-SIGNED ×' + ready.length + ' in ' + 'ms — reactions locked before the trigger');

    // 2. fire the trigger (treasury posting key)
    const d = await dgp(STEEM_RPC);
    const headAtSend = d.head_block_number;
    const trigPayload = { t: 'reflex', v: 54, phase: 'trig', r, n: roundNonce, swarm: ready.length, ts: trigTs };
    const trigOp = [['custom_json', { required_auths: [], required_posting_auths: [ACCOUNT], id: 'saos', json: JSON.stringify(trigPayload) }]];
    const trigTx = { ref_block_num: headAtSend & 0xffff, ref_block_prefix: Buffer.from(d.head_block_id, 'hex').readUInt32LE(4), expiration: new Date(new Date(d.time + 'Z').getTime() + 90000).toISOString().slice(0, 19), operations: trigOp, extensions: [] };
    const trigSigned = steem.auth.signTransaction(trigTx, [POSTING_WIF]);
    const tFire = Date.now();
    await broadcast(STEEM_RPC, trigSigned);

    // 3. detect trigger block via block-scan (no get_transaction — Task 52 lesson)
    const trig = await findTrigger(headAtSend, roundNonce, r);
    if (!trig) { rounds.push({ round: r, error: 'trigger not found in 15 blocks', nonce: roundNonce }); continue; }
    log('round ' + r + ': trigger @block ' + trig.block + ' (txid ' + String(trig.txid).slice(0, 16) + '…) · detection ' + trig.detectionMs + 'ms · now firing ' + ready.length + ' pre-signed responses');

    // 4. INSTANT RESPONSE — broadcast all pre-signed txs in parallel
    const tResp = Date.now();
    const sendResults = await Promise.all(ready.map(async (x) => {
      try { await broadcast(STEEM_RPC, x.signed); return { soldier: x.soldier, sentMs: Date.now() - tResp }; }
      catch (e) { return { soldier: x.soldier, error: String(e.message || e).slice(0, 70) }; }
    }));
    const sentOk = sendResults.filter((x) => !x.error).length;
    log('round ' + r + ': ' + sentOk + '/' + ready.length + ' responses broadcast in ' + (Date.now() - tResp) + 'ms — racing the next block');

    // 5. collect responses per block → latency in BLOCKS
    const col = await collectResponses(trig.block, roundNonce, r, ready.map((x) => x.soldier));
    const latArr = Object.values(col.lat).filter(Boolean).map((v) => v.latencyBlocks);
    const maxLat = latArr.length ? Math.max(...latArr) : null;
    const avgLat = latArr.length ? latArr.reduce((a, b) => a + b, 0) / latArr.length : null;
    log('round ' + r + ': responses ' + latArr.length + '/' + ready.length + ' · latencyBlocks max=' + maxLat + ' avg=' + (avgLat && avgLat.toFixed(2)));
    rounds.push({
      round: r,
      nonce: roundNonce,
      trigger: { block: trig.block, txid: trig.txid, detectionMs: trig.detectionMs, headAtSend, fireToDetectionMs: Date.now() - tFire },
      swarm: ready.map((x) => x.soldier),
      sendResults,
      responses: col.lat,
      maxLatencyBlocks: maxLat,
      avgLatencyBlocks: avgLat,
    });
  }

  // 6. mana after — RC cost per reflex response (measured, sovereign fuel)
  await new Promise((r) => setTimeout(r, 2500));
  const manaAfter = await rcMapSteem(soldiers.map((s) => s.username).concat([ACCOUNT]));

  // 7. volley digest → Hive anchor (cross-chain reflex)
  const okRounds = rounds.filter((x) => x.trigger && x.responses);
  const allLat = okRounds.flatMap((x) => Object.values(x.responses).filter(Boolean).map((v) => v.latencyBlocks));
  const maxLatencyBlocks = allLat.length ? Math.max(...allLat) : null;
  const totalResponses = okRounds.reduce((a, x) => a + Object.values(x.responses).filter(Boolean).length, 0);
  const digestSrc = ['v54', NONCE, okRounds.length, okRounds.map((x) => x.trigger.block).join('.'), Object.keys(okRounds.flatMap((x) => Object.values(x.responses).filter(Boolean)).reduce((m, v) => ((m[v.txid] = 1), m), {})).sort().join(',')].join('|');
  const digest = sha256(digestSrc);
  log('volley digest ' + digest.slice(0, 16) + '… — anchoring on Hive via fleet router');
  const hiveAnchor = await hiveAnchorDigest(digest, { nonce: NONCE, rounds: okRounds.length, responses: totalResponses, maxLatencyBlocks });

  // 8. HIVE-SIDE DRILL — the same engine, hostless: soldier trigger → soldier swarm, all on Hive.
  log('HIVE-SIDE DRILL — the engine without the host (soldier trigger → soldier swarm, Hive only)');
  let hiveDrill = null;
  try { hiveDrill = await hiveDrillRound(); } catch (e) { hiveDrill = { error: String(e.message || e).slice(0, 80) }; }

  const evidence = {
    at: new Date().toISOString(),
    live: true,
    nonce: NONCE,
    engine: 'block-reflex v54 — pre-signed sovereign swarm',
    rounds,
    summary: {
      rounds: okRounds.length,
      triggers: okRounds.map((x) => ({ r: x.round, block: x.trigger.block, txid: x.trigger.txid })),
      swarmSize: soldiers.length,
      totalResponses,
      maxLatencyBlocks,
      avgLatencyBlocks: allLat.length ? allLat.reduce((a, b) => a + b, 0) / allLat.length : null,
      liquidCost: 0,
      opType: 'custom_json (no amounts — zero liquid by construction)',
      distinctSigners: [...new Set(okRounds.flatMap((x) => Object.entries(x.responses).filter(([, v]) => v).map(([k]) => k)))].length,
      digest,
      digestSrc,
      hiveAnchor,
      hiveDrill,
    },
    manaBefore,
    manaAfter,
    manaDelta: Object.fromEntries(Object.keys(manaAfter).filter((k) => manaBefore[k]).map((k) => [k, +(manaAfter[k].pct - manaBefore[k].pct).toFixed(2)])),
  };
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + '\n');
  log('EVIDENCE WRITTEN: ' + EVIDENCE_PATH);
  const hd = hiveDrill && !hiveDrill.error ? ' · HIVE-DRILL ' + hiveDrill.totalResponses + '×' + hiveDrill.maxLatencyBlocks + 'blk' : '';
  log('SUMMARY: rounds=' + evidence.summary.rounds + ' · responses=' + totalResponses + ' · maxLatency=' + maxLatencyBlocks + ' blocks · signers=' + evidence.summary.distinctSigners + ' · liquidCost=0 · hive=' + (hiveAnchor ? '@' + hiveAnchor.account + (hiveAnchor.verified ? ' verified blk ' + hiveAnchor.block : ' pending') : 'FAILED') + hd);
  if (!okRounds.length || !totalResponses) process.exit(1);
}

main().catch((e) => { log('FATAL: ' + (e.message || e)); process.exit(1); });
