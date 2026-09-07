#!/usr/bin/env node
/**
 * hive_rc_heal.cjs — Task 103: HP-DELEGATION HEAL (הבראת-RC ריבונית, מדודה)
 *
 * הממצא-המדוד: הצי RC-טבוע על Hive (ראש 0.7% · חיילים 2–5%) — כושר-הנשיאה
 * המדוד של הצי ~86 HE-ops/יום. ה-regen הוא 20%/יום מ-max_rc, ו-max_rc גדל
 * עם-ה-HP (כולל-מואנט). כלי-ההבראה-היחיד-שלא-דורש-קנייה: **הקצאת-HP מהראש
 * לחיילים-הרזים** — מגדיל-את-max_rc שלהם → מגדיל-את-ה-regen-האבסולוטי שלהם
 * → מקצר-את-הדרך-לרצפת-השידור.
 *
 * חוקי-בטיחות (הכל-מדוד, כלום-לא-מוסק):
 *   · שער-ראש: RC% ≥ 12% ויתרה ≥ 600M — ההקצאה-עצמה עולה-RC (active op)
 *   · תקציב-ראש: לא-יורד-מ-6-HP (מ-10.87) — הראש נשאר-הגדול-בצי
 *   · עדות-מנוע: מודדים max_rc לפני/אחרי לכל-נמען — אם-המנוף-חלש (<10%
 *     ל-1.5HP) מסמנים lever-weak ומפסיקים (כנות-מול-ניחוש)
 *   · אידמפוטנטי: בודק delegation-קיים לפני-כל-שידור
 *   · idempotent-state: agent/hive_rc_heal.json — אחרון-שנוסה, מה-נחתם
 *
 * שימוש: node hive_rc_heal.cjs            # משימה-משוערת (gates)
 *        node hive_rc_heal.cjs --dry      # מדידה-בלבד, אפס-שידור
 */
'use strict';
const fs = require('fs');
const path = require('path');
const steem = require('steem');
const HIVE_RC = require('./hive_rc.cjs');
const { grapheneBroadcast } = require('./anchor.cjs');

const AGENT_DIR = __dirname;
const RESULT_PATH = path.join(AGENT_DIR, 'hive_rc_heal.json');
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';

const DRY = process.argv.includes('--dry');
const HEAD_MIN_PCT = 0.12;      // שער-הראש
const HEAD_MIN_AVAIL = 600e6;   // יתרת-בטחון לשידור-ה-active
const HEAD_HP_FLOOR = 6.0;      // רצפת-HP של-הראש
const GIFT_HP = 1.5;            // מתנה-פר-נמען
const MAX_RECIPIENTS = 3;       // תקציב: 4.5HP מתוך 10.87 → ראש 6.37 ≥ רצפה
const LEVER_MIN_PCT = 0.10;     // מנוף-חלש אם max_rc לא-גדל ≥10% ב-1.5HP

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function loadResult() {
  try { return JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8')); } catch (_) { return { runs: [], leverWeak: false }; }
}
function saveResult(r) {
  fs.writeFileSync(RESULT_PATH, JSON.stringify(r, null, 2) + '\n');
}

async function main() {
  const ENV = loadDotEnv(AGENT_DIR);
  const HEAD = (ENV.AGENT_ACCOUNT || 'headcorner').toLowerCase();
  const ACTIVE_WIF = ENV.ACTIVE_WIF || '';
  const res = loadResult();
  res.at = new Date().toISOString();

  // 0) נמענים: חיילי-הכספת (בלי-הראש) — ממוינים לפי-HP-הדק-ביותר
  let names = [];
  try {
    const vault = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'keys', 'vault.json'), 'utf8'));
    names = (vault.accounts || []).map((a) => String(a.username).toLowerCase()).filter((u) => u && u !== HEAD);
  } catch (_) { /* no vault */ }

  const snap = await HIVE_RC.snapshot([HEAD, ...names]);
  const recipients = names
    .filter((n) => snap[n] && snap[n].hp != null)
    .sort((a, b) => snap[a].hp - snap[b].hp)
    .slice(0, MAX_RECIPIENTS);

  const head = snap[HEAD];
  console.log('=== HIVE RC HEAL · ' + res.at + (DRY ? ' · DRY' : '') + ' ===');
  console.log('head @' + HEAD, 'HP', head && head.hp != null ? head.hp.toFixed(2) : '?', '· RC', head ? (head.pct * 100).toFixed(1) + '%' : '?');
  for (const n of recipients) console.log('  candidate @' + n.padEnd(13), 'HP', snap[n].hp.toFixed(2), '· RCmax', Math.round(snap[n].maxRc / 1e9) + 'B', '· RC', (snap[n].pct * 100).toFixed(1) + '%');

  // 1) מנוף-חלש-מהעבר? כנות — לא-חוזרים-לנחש
  if (res.leverWeak) { console.log('STOP: leverWeak=true from previous run — recorded, not guessing'); saveResult(res); return; }
  // 2) שער-הראש
  if (!head || head.pct < HEAD_MIN_PCT || head.avail < HEAD_MIN_AVAIL) {
    const etaH = head ? Math.max(0, Math.round(((HEAD_MIN_PCT - head.pct) * 5 * 86400) / 3600)) : '?';
    console.log('GATE: head RC ' + (head ? (head.pct * 100).toFixed(1) + '%' : '?') + ' < ' + Math.round(HEAD_MIN_PCT * 100) + '% — regen ETA ~' + etaH + 'h (honest, autonomous retry on next run)');
    res.lastGate = { at: res.at, reason: 'head-rc-floor', etaH };
    saveResult(res);
    return;
  }
  // 3) רצפת-HP של-הראש
  if (head.hp == null || head.hp - GIFT_HP * recipients.length < HEAD_HP_FLOOR) {
    console.log('GATE: head HP floor ' + HEAD_HP_FLOOR + ' — budget too thin, honest skip');
    res.lastGate = { at: res.at, reason: 'head-hp-floor' };
    saveResult(res);
    return;
  }
  if (!ACTIVE_WIF && !DRY) { console.log('GATE: ACTIVE_WIF missing — cannot sign delegation'); res.lastGate = { at: res.at, reason: 'no-active-wif' }; saveResult(res); return; }

  // 4) הקצאה-מדודה פר-נמען
  const dgp = await HIVE_RC.snapshot([HEAD]); // ensure fresh (reuse module; vests conversion below)
  let hpPerVest = null;
  try {
    const { rpcV4 } = require('./anchor.cjs');
    const props = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
    hpPerVest = parseFloat(props.total_vesting_fund_hive) / parseFloat(props.total_vesting_shares);
  } catch (_) { /* handled below */ }

  const runs = [];
  for (const n of recipients) {
    const before = (await HIVE_RC.snapshot([n]))[n];
    const existing = await existingDelegation(HEAD, n).catch(() => null);
    const existingHp = existing ? parseFloat(existing.vesting_shares) * (hpPerVest || 0) : 0;
    if (existingHp >= GIFT_HP * 0.98) { console.log('  @' + n + ' already delegated ' + existingHp.toFixed(2) + ' HP — idempotent skip'); runs.push({ at: new Date().toISOString(), recipient: n, skipped: 'already-delegated', existingHp }); continue; }
    if (hpPerVest == null) { console.log('  @' + n + ' — no vests conversion (dgp failed) — skip honestly'); runs.push({ at: new Date().toISOString(), recipient: n, skipped: 'no-vests-conversion' }); continue; }
    const vests = (GIFT_HP / hpPerVest).toFixed(6);
    let txid = null, err = null;
    if (!DRY) {
      try {
        txid = await delegate(HEAD, n, vests + ' VESTS', ACTIVE_WIF);
      } catch (e) { err = String((e && e.message) || e); }
    }
    // עדות-מנוע: max_rc לפני/אחרי (rc_api משקף-delegation-מיד-ב-max_rc)
    await new Promise((r) => setTimeout(r, 2500));
    const after = (await HIVE_RC.snapshot([n]).catch(() => ({})))[n];
    const deltaPct = after && before && before.maxRc ? (after.maxRc - before.maxRc) / before.maxRc : null;
    const run = { at: new Date().toISOString(), recipient: n, vests, hpGift: GIFT_HP, maxRcBefore: before && before.maxRc, maxRcAfter: after && after.maxRc, deltaPct: deltaPct != null ? +deltaPct.toFixed(4) : null, txid, err, dry: DRY };
    runs.push(run);
    console.log('  @' + n + ' ' + (DRY ? '[DRY] ' : '') + 'maxRc ' + Math.round((before && before.maxRc || 0) / 1e9) + 'B → ' + (after ? Math.round(after.maxRc / 1e9) + 'B' : '?') + ' · Δ' + (deltaPct != null ? (deltaPct * 100).toFixed(1) + '%' : '?') + (txid ? ' · txid ' + String(txid).slice(0, 12) + '…' : err ? ' · ERR ' + err.slice(0, 60) : ''));
    if (deltaPct != null && deltaPct < LEVER_MIN_PCT) {
      console.log('LEVER-WEAK: Δ' + (deltaPct * 100).toFixed(1) + '% < ' + Math.round(LEVER_MIN_PCT * 100) + '% for +' + GIFT_HP + 'HP — stopping honestly, no more guessing');
      res.leverWeak = true;
      break;
    }
  }
  res.runs = (res.runs || []).concat(runs).slice(-40);
  res.lastOkAt = runs.some((r) => r.txid) ? new Date().toISOString() : res.lastOkAt;
  saveResult(res);
  console.log(runs.length ? 'runs recorded → ' + RESULT_PATH : 'nothing to do');
}

async function existingDelegation(delegator, delegatee) {
  const { rpcV4 } = require('./anchor.cjs');
  const r = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.list_vesting_delegations', params: [delegator, '', 100], id: 1 });
  return (Array.isArray(r) ? r : []).find((d) => String(d.delegatee).toLowerCase() === delegatee) || null;
}

async function delegate(delegator, delegatee, vestsStr, activeWif) {
  const { rpcV4 } = require('./anchor.cjs');
  const dgp = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [['delegate_vesting_shares', { delegator, delegatee, vesting_shares: vestsStr }]],
    extensions: [],
  };
  const prevChainId = steem.config.get('chain_id');
  steem.config.set('chain_id', HIVE_CHAIN_ID);
  let signed;
  try { signed = steem.auth.signTransaction(tx, [activeWif]); } finally { steem.config.set('chain_id', prevChainId); }
  const result = await grapheneBroadcast(HIVE_RPC, HIVE_CHAIN_ID, tx.operations, activeWif);
  return (result && result.id) || (signed && signed.id) || null;
}

main().catch((e) => { console.error('hive_rc_heal: FATAL ' + ((e && e.message) || e)); process.exit(1); });
