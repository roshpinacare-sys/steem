#!/usr/bin/env node
/**
 * soldier_mint_paid.cjs — מטבעת-הזהויות בנתיב-התשלום (R44 custody rung).
 *
 * למה הכלי הזה קיים: דור-hcsoldier1-3 (2026-09-29 19:21Z) נולד בסקריפט-חד-פעמי
 * שמפתחותיו לא שרדו שום-שכבת-שמירה — אומת בסריקה-מלאה (768 גזירות, דיסק, git,
 * סודות-Actions, שתי כספאות) והוכרז LOST-NO-CUSTODY. factory_v2 לא יכול למלא
 * את התפקיד כיוון שהוא חי על create_claimed_account (טיקטים — ול-headcorner
 * אין RC לתביעה). הנתיב-המדוד: account_create בתשלום account_creation_fee.
 *
 * מה הכלי עושה — אותם חוקי-ברזל של factory_v2:
 *   1. מפתחות דטרמיניסטיים: sha256(account+role+FACTORY_MASTER) → WIF —
 *      נגזרים לנצח מהמאסטר + שם-החשבון (אותה מתמטיקה שאומתה 4/4 מול-השרשרת).
 *   2. עוגן-חילוץ: headcorner כ-account_auth בסמכות-owner (threshold 1) —
 *      סיבוב-מפתחות תמידי גם אם משהו אבד.
 *   3. גיבוי-כפול: keys/vault.json (tier factory-v2-paid) + keys/<name>.json — 0600.
 *   4. אימות-על-השרשרת אחרי-השידור (owner-anchor + pubs) — קבלה ללא סודות.
 *   5. שער-חי: --live + HE_LIVE_CONFIRM=<account> + AGENT_ACCOUNT — כמו כל הבית.
 *
 * Usage:
 *   AGENT_ACCOUNT=headcorner node agent/soldier_mint_paid.cjs --mint --name hcsoldier4
 *   AGENT_ACCOUNT=headcorner HE_LIVE_CONFIRM=headcorner node agent/soldier_mint_paid.cjs --mint --name hcsoldier4 --live
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dhive = require('@hiveio/dhive');
// owner directive 2026-10-04 (STASIS): sign-time brake — every broadcast re-checks the breaker (stale-process lesson)
const capGate = require('./lib/capital_gate.cjs');
function stasisStop(tool) {
  try { return !!capGate.stasisHalt(tool); } catch (e) { console.log('[CAPITAL-GATE] ' + tool + ' — gate module error, lane halts fail-closed: ' + String((e && e.message) || e).slice(0, 80)); return true; }
}

/* ── .env ── */
function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq <= 0) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv(__dirname);

const OPERATOR = (process.env.AGENT_ACCOUNT || '').toLowerCase();
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const FACTORY_MASTER = process.env.FACTORY_MASTER || '';
const NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://api.steem.fans'];
const STEEM_CHAIN_ID = '0'.repeat(64); // שרשרת-STEEM — הזהות כולה אפסים (נמדד ב-keyrotate)
const client = new dhive.Client(NODES, { chainId: STEEM_CHAIN_ID, addressPrefix: 'STM' });

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const hasFlag = (n) => process.argv.includes(n);
const DRY = !(hasFlag('--live') && process.env.HE_LIVE_CONFIRM === OPERATOR && OPERATOR);
const log = (m) => console.log('[' + new Date().toISOString() + '] soldier-mint-paid: ' + m);
const RESULT_PATH = path.join(__dirname, 'soldier_mint_paid_result.json');

if (!OPERATOR) { console.error('usage: AGENT_ACCOUNT=<account> node agent/soldier_mint_paid.cjs — no default acting account'); process.exit(1); }
if (!DRY && !ACTIVE_WIF) { console.error('live: ACTIVE_WIF missing in .env'); process.exit(1); }
if (!DRY && !FACTORY_MASTER) { console.error('live: FACTORY_MASTER missing — refuse random birth'); process.exit(1); }

function record(entry) {
  let prev = { actions: [] };
  try { prev = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8')); } catch (_) {}
  prev.actions.push(Object.assign({ at: new Date().toISOString() }, entry));
  fs.writeFileSync(RESULT_PATH, JSON.stringify(prev, null, 2) + '\n');
}

function recordResult() { /* compatibility no-op */ }

/* ── גזירה דטרמיניסטית — sha256(account+role+master), זהה ל-factory_v2 ── */
function deriveKeys(name) {
  if (!FACTORY_MASTER) throw new Error('no FACTORY_MASTER');
  const out = {};
  for (const role of ['owner', 'active', 'posting', 'memo']) {
    const priv = dhive.PrivateKey.fromSeed(name + role + FACTORY_MASTER);
    out[role] = { wif: priv.toString(), pub: priv.createPublic('STM').toString() };
  }
  return out;
}

const auth = (pub, accountAuths) => ({
  weight_threshold: 1,
  account_auths: accountAuths || [],
  key_auths: [[pub, 1]],
});

async function chainFee() {
  const props = await client.database.getChainProperties();
  return String(props.account_creation_fee || '3.000 STEEM');
}

async function getAccount(name) {
  try { return (await client.database.getAccounts([name]))[0] || null; } catch (_) { return null; }
}

function vaultUpsert(entry) {
  const p = path.join(__dirname, 'keys', 'vault.json');
  let v = { accounts: [] };
  try { v = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  if (!Array.isArray(v.accounts)) v.accounts = [];
  const u = String(entry.username).toLowerCase();
  v.accounts = v.accounts.filter((a) => !a || String(a.username).toLowerCase() !== u);
  v.accounts.push(entry);
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
  try { fs.chmodSync(p, 0o600); } catch (_) {}
}

function keyFileWrite(name, keys, meta) {
  const p = path.join(__dirname, 'keys', name + '.json');
  fs.writeFileSync(p, JSON.stringify(Object.assign({ name, createdAt: new Date().toISOString(), keys }, meta), null, 2));
  try { fs.chmodSync(p, 0o600); } catch (_) {}
}

/* --mint --name <n> [--creator <acc>=OPERATOR] */
async function modeMint(name) {
  if (!/^[a-z][a-z0-9-]{2,15}$/.test(name)) return log('mint: bad account name ' + name);
  const creator = (argOf('--creator', OPERATOR) || OPERATOR).toLowerCase();
  if (creator !== OPERATOR) return log('mint: creator must be the acting account (' + OPERATOR + ') in the paid path');
  const exists = await getAccount(name);
  if (exists) return log('mint: name taken — @' + name);
  const keys = deriveKeys(name);
  log('mint: deterministic keys (re-derivable from FACTORY_MASTER forever) · pubs ' +
    Object.values(keys).map((k) => k.pub.slice(3, 9) + '…').join(' '));
  // עוגן-חילוץ: המפעיל בתוך סמכות-owner (threshold 1 — או המפתח או האופרטור)
  const ownerAuth = { weight_threshold: 1, account_auths: [[OPERATOR, 1]], key_auths: [[keys.owner.pub, 1]] };
  const fee = await chainFee();
  log('mint: fee measured ' + fee + ' (account_create paid path)');
  const op = ['account_create', {
    fee, creator, new_account_name: name,
    owner: ownerAuth, active: auth(keys.active.pub), posting: auth(keys.posting.pub),
    memo_key: keys.memo.pub, json_metadata: '',
  }];
  if (DRY) { log('[DRY] would mint @' + name + ' (creator @' + creator + ') · rescue-anchor=' + OPERATOR + ' · deterministic keys · fee ' + fee); return record({ type: 'mint', name, creator, dry: true, fee, rescueAnchor: OPERATOR }); }
  if (stasisStop('soldier-mint-paid')) return log('STASIS-HALT — capital lane closed (capital gate 2026-10-04) — nothing broadcast'); // sign-time brake
  const pk = dhive.PrivateKey.fromString(ACTIVE_WIF);
  const txid = await client.broadcast.sendOperations([op], pk).then((r) => (r && r.transaction_id) || 'sent');
  log('mint BROADCAST txid=' + String(txid).slice(0, 16) + '…');
  // אימות-על-השרשרת
  await new Promise((r) => setTimeout(r, 4000));
  const fresh = await getAccount(name);
  const ownerOk = !!(fresh && (fresh.owner.account_auths || []).some((a) => a[0] === OPERATOR));
  const activeOk = !!(fresh && (fresh.active.key_auths || []).some(([k]) => k === keys.active.pub));
  const postingOk = !!(fresh && (fresh.posting.key_auths || []).some(([k]) => k === keys.posting.pub));
  const verified = !!fresh && ownerOk && activeOk && postingOk;
  log('mint VERIFY: @' + name + ' created=' + (fresh ? fresh.created : 'MISSING') +
    ' · rescueAnchor=' + (ownerOk ? 'YES' : 'NO') + ' · active=' + (activeOk ? 'MATCH' : 'MISS') + ' · posting=' + (postingOk ? 'MATCH' : 'MISS'));
  // גיבוי-כפול: כספת + קובץ-מפתח
  vaultUpsert({
    username: name, tier: 'factory-v2-paid', mode: 'factory-v2',
    keys, chains: ['steem'],
    addedAt: new Date().toISOString(), syncedAt: new Date().toISOString(),
    meta: { creator, txid: String(txid), deterministic: true, keyMode: 'factory-deterministic-paid', rescueAnchor: OPERATOR, derivedFrom: 'FACTORY_MASTER', fee },
  });
  keyFileWrite(name, keys, { meta: { creator, txid: String(txid), gen: 2, keyMode: 'factory-deterministic-paid' } });
  log('backups: vault.json (tier factory-v2-paid) + keys/' + name + '.json — 0600, git-ignored');
  record({ type: 'mint', name, creator, txid: String(txid), fee, verified, rescueAnchor: ownerOk, created: fresh ? fresh.created : null });
  if (!verified) process.exit(2);
}

(async () => {
  if (hasFlag('--mint')) { await modeMint(argOf('--name', '')); return; }
  console.log('usage: --mint --name <account> [--live]');
})().then(() => recordResult()).catch((e) => { console.error('ERROR:', String((e && (e.message || e))).slice(0, 300)); process.exit(1); });
