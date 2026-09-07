#!/usr/bin/env node
/**
 * factory_v2.cjs — דור-שני של מפעל-הזהויות (Task 48).
 *
 * מה השתנה מ-factory_create.cjs (הלקחים מ-hcnova1):
 *   1. מפתחות דטרמיניסטיים — WIF נגזר מ-FACTORY_MASTER (agent/.env, git-ignored)
 *      לפי הגזירה המתועדת של השרשרת: sha256(name+role+master) → WIF.
 *      המפתחות אף-פעם לא "אובדים": מספיק ה-master + שם-החשבון כדי לשחזר.
 *      זו אותה גזירה של /api/ops/vault/master — כלומר אפשר לחבר את הבוט
 *      מחדש ב-UI ע"י הדבקת FACTORY_MASTER בכספת.
 *   2. עוגן-חילוץ בסמכות-ה-owner — headcorner יושב כ-account_auth בתוך
 *      סמכות-ה-owner של הבוט (threshold 1). אם המפתחות אבדו/נפרצו —
 *      headcorner יכול לחתום account_update ולסובב את כל המפתחות.
 *   3. גיבוי-כספת — הזהות נרשמת גם ב-keys/vault.json (tier 'factory-v2')
 *      מעבר לקובץ agent/keys/<name>.json. שני מיקומים, אף-אחד לא נופל.
 *   4. שחזור-הקצבה (--reclaim) — בוט-זומבי (מפתחות אבדו) לא ממשיך לחטוף
 *      SP: ההקצבה מוחזרת לאוצר (delegation=0, חזרה אחרי 7 ימי-צינון).
 *   5. חתימת-חייל (--creator <soldier>) — הקמה עצמית: מפתח-חייל חותם
 *      claim_account + create_claimed_account + הקצבה משלו. הצבא מתרבה.
 *   6. פעימה ריבונית ראשונה (--ping) — הבוט רושם את עצמו על אוטובוס-ה-saos
 *      במפתח-הפרסום שלו (custom_json) — המעשה הריבוני הראשון על-השרשרת.
 *
 * Usage:
 *   node factory_v2.cjs --reclaim hcnova1
 *   node factory_v2.cjs --claim --creator haran
 *   node factory_v2.cjs --mint --creator haran --name hcnova2 --sp 0.5 --topup 4.5 [--dry]
 *   node factory_v2.cjs --topup --name hcnova2 --sp 4.5
 *   node factory_v2.cjs --ping --name hcnova2
 *   node factory_v2.cjs --derive --name hcnova2          (הדפסת pubs בלבד — בלי סודות)
 *
 * חוק-ברזל: כל החתימות מקומיות; ה-WIFs לעולם לא בלוג ולא ב-git.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const steem = require('steem');

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

const OPERATOR = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const OWNER_WIF = process.env.OWNER_WIF || '';
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const FACTORY_MASTER = process.env.FACTORY_MASTER || '';
const RPCS = ['https://api.steemit.com', 'https://api.steem.fans', 'https://api.justyy.com', 'https://steem.61bts.com'];

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const hasFlag = (n) => process.argv.includes(n);
const DRY = hasFlag('--dry');
const log = (m) => console.log('[' + new Date().toISOString() + '] factory-v2: ' + m);

const RESULT_PATH = path.join(__dirname, 'factory_v2_result.json');
function record(action) {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8')); } catch (_) { /* ראשון */ }
  const out = { at: new Date().toISOString(), actions: prev.actions || [], fleet: prev.fleet || [] };
  out.actions.push(Object.assign({ at: new Date().toISOString() }, action));
  if (action.fleet) out.fleet = action.fleet;
  fs.writeFileSync(RESULT_PATH, JSON.stringify(out, null, 2) + '\n');
}

/* ── RPC (מרוץ-צמתים, v4 ישיר) ── */
function rpcV4(url, body) {
  const u = new URL(url); const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = require('https').request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message || 'rpc error')); resolve(j.result); }
        catch (_) { reject(new Error('bad rpc: ' + d.slice(0, 120))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    req.write(payload); req.end();
  });
}
async function raceRpc(body) {
  const rs = await Promise.allSettled(RPCS.map((u) => rpcV4(u, body).catch(() => null)));
  for (const r of rs) if (r.status === 'fulfilled' && r.value) return r.value;
  throw new Error('all RPCs failed');
}

/* ── גזירה דטרמיניסטית — אותה מתמטיקה כמו הכספת (steem.auth.getPrivateKeys) ──
 * Task 59: masterOverride — כשאין FACTORY_MASTER ב-.env (נמחק באירוע-ה-wipe),
 * ה-mint לא מת: מומצא מאסטר-אקראי-לחשבון, נשמר מקומית (vault+keyfile) והחשבון
 * עדיין נולד עם עוגן-חילוץ headcorner ב-owner — לעולם לא זומבי. */
function deriveKeys(name, masterOverride) {
  const master = masterOverride || FACTORY_MASTER;
  if (!master) throw new Error('no FACTORY_MASTER and no override — cannot derive keys');
  const roles = ['owner', 'active', 'posting', 'memo'];
  const wifs = steem.auth.getPrivateKeys(name, master, roles);
  const out = {};
  for (const r of roles) {
    const wif = wifs[r];
    if (!steem.auth.isWif(wif)) throw new Error('derived invalid WIF for ' + r);
    out[r] = { wif, pub: steem.auth.wifToPublic(wif) };
  }
  return out;
}

const auth = (pub, accountAuths) => ({
  weight_threshold: 1,
  account_auths: accountAuths || [],
  key_auths: [[pub, 1]],
});

/* ── מפתח-active לפי-חשבון: הראשי מ-.env, חיילים מ-הכספת ── */
function activeWifFor(account) {
  const acc = String(account).toLowerCase();
  if (acc === OPERATOR) return ACTIVE_WIF;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const row = (v.accounts || []).find((a) => a && String(a.username).toLowerCase() === acc);
    if (row && row.keys && row.keys.active && row.keys.active.wif) return row.keys.active.wif;
  } catch (_) { /* אין כספת */ }
  return '';
}

function loadVestProps() { return raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 2 }); }
async function vestsForSp(sp) {
  const dgp = await loadVestProps();
  const per = parseFloat(dgp.total_vesting_shares) / parseFloat(dgp.total_vesting_fund_steem);
  return { vests: (sp * per).toFixed(6) + ' VESTS', per: Math.round(per) };
}
async function getAccount(name) {
  const r = await raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[name]], id: 1 });
  return r && r[0] ? r[0] : null;
}
async function getRcMana(name) {
  const r = await raceRpc({ jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [name] }, id: 1 });
  const row = r && r.rc_accounts && r.rc_accounts[0];
  return row ? { max: parseFloat(row.max_rc), mana: parseFloat(row.rc_manabar.current_mana), lastUpdate: row.rc_manabar.last_update_time } : null;
}
function txidOf(signed) {
  return (signed && signed.id) || crypto.createHash('sha256').update(JSON.stringify(signed)).digest('hex');
}
async function broadcast(tx, wif) {
  const signed = steem.auth.signTransaction(tx, [wif]);
  await rpcV4(RPCS[0], { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 3 });
  return txidOf(signed);
}
function makeTx(dgp, ops) {
  return {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: ops,
    extensions: [],
  };
}

/* ── גיבוי-כספת: דוחף/מעדכן רשומה tier 'factory-v2' ── */
function vaultUpsert(entry) {
  const p = path.join(__dirname, 'keys', 'vault.json');
  let v = { accounts: [] };
  try { v = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { /* כספת חדשה */ }
  if (!Array.isArray(v.accounts)) v.accounts = [];
  const u = String(entry.username).toLowerCase();
  v.accounts = v.accounts.filter((a) => !a || String(a.username).toLowerCase() !== u);
  v.accounts.push(entry);
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
  try { fs.chmodSync(p, 0o600); } catch (_) { /* windows */ }
}

/* ── גם קובץ-מפתח נפרד (תאימות ל-loadArmyAccounts tier 'factory') ── */
function keyFileWrite(name, keys, meta) {
  const p = path.join(__dirname, 'keys', name + '.json');
  fs.writeFileSync(p, JSON.stringify(Object.assign({ name, createdAt: new Date().toISOString(), keys }, meta), null, 2));
  try { fs.chmodSync(p, 0o600); } catch (_) { /* windows */ }
}

/* ══════════════════ MODES ══════════════════ */

/* --reclaim <name> : החזרת הקצבה מזומבי לאוצר */
async function modeReclaim(name) {
  if (!ACTIVE_WIF) return log('no ACTIVE_WIF — reclaim requires operator active authority');
  const [acc] = [await getAccount(name)];
  if (!acc) return log('reclaim: @' + name + ' not found on-chain');
  const received = acc.received_vesting_shares || '0.000000 VESTS';
  if (parseFloat(received) === 0) {
    log('reclaim: @' + name + ' holds 0 delegated vests — nothing to reclaim (already returned)');
    return record({ type: 'reclaim', name, amount: received, note: 'nothing to reclaim' });
  }
  log('reclaim: @' + name + ' holds delegated ' + received + ' — undelegating to treasury');
  if (DRY) { log('[DRY] would undelegate ' + received + ' from @' + name); return record({ type: 'reclaim', name, amount: received, dry: true }); }
  const dgp = await loadVestProps();
  const txid = await broadcast(makeTx(dgp, [['delegate_vesting_shares', { delegator: OPERATOR, delegatee: name, vesting_shares: '0.000000 VESTS' }]]), ACTIVE_WIF);
  log('reclaim BROADCAST txid=' + txid.slice(0, 16) + '… (vests return after 7d warmup)');
  await new Promise((r) => setTimeout(r, 4000));
  const fresh = await getAccount(name);
  const after = fresh ? fresh.received_vesting_shares : '?';
  const verified = fresh && parseFloat(after) === 0;
  log('reclaim VERIFY: @' + name + ' received_vesting now ' + after + (verified ? ' ✓' : ' (pending)'));
  record({ type: 'reclaim', name, amount: received, txid, verified });
}

/* --claim --creator <acc> : תביעת טיקט-חשבון (מדידת עלות-RC חיה) */
async function modeClaim(creator) {
  const wif = activeWifFor(creator);
  if (!wif) return log('claim: no active key for @' + creator + ' (operator .env או כספת)');
  const before = await getRcMana(creator);
  log('claim: @' + creator + ' mana before ' + (before ? (before.mana / 1e9).toFixed(2) + 'G' : '?') + ' · max ' + (before ? (before.max / 1e9).toFixed(2) + 'G' : '?'));
  if (DRY) { log('[DRY] would claim_account by @' + creator); return record({ type: 'claim', creator, dry: true }); }
  const dgp = await loadVestProps();
  try {
    const txid = await broadcast(makeTx(dgp, [['claim_account', { creator, fee: '0.000 STEEM' }]]), wif);
    await new Promise((r) => setTimeout(r, 4000));
    const acc = await getAccount(creator);
    const after = await getRcMana(creator);
    const tickets = acc ? acc.pending_claimed_accounts : null;
    const cost = before && after ? Math.max(0, before.mana - (after.mana + (Date.now() / 1000 - after.lastUpdate) * (after.max / (5 * 86400)))) : null;
    log('claim OK txid=' + txid.slice(0, 16) + '… · tickets=' + tickets + ' · rcCost≈' + (cost ? (cost / 1e9).toFixed(2) + 'G' : 'n/a (regen-caveat)'));
    record({ type: 'claim', creator, txid, tickets, rcCostG: cost ? cost / 1e9 : null });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 200);
    log('claim FAILED (measured): ' + msg);
    record({ type: 'claim', creator, error: msg });
  }
}

/* --mint --creator <acc> --name <n> [--sp S] [--topup S2] */
async function modeMint(creator, name, sp, topup) {
  if (!/^[a-z][a-z0-9-]{2,15}$/.test(name)) return log('mint: bad account name ' + name);
  const wif = activeWifFor(creator);
  if (!wif) return log('mint: no active key for @' + creator);
  const exists = await getAccount(name);
  if (exists) return log('mint: name taken — @' + name);
  // Task 59 — key-source fallback: deterministic (factory master) → random-anchored
  let accountMaster = null;
  let keyMode = 'factory-deterministic';
  if (!FACTORY_MASTER) {
    accountMaster = crypto.randomBytes(32).toString('hex');
    keyMode = 'factory-random-anchored';
    log('mint: FACTORY_MASTER missing — random-anchored mode (keys random, stored machine-local, rescue-anchor guarantees recovery)');
  }
  const keys = deriveKeys(name, accountMaster);
  log('mint: keys ' + keyMode + ' (re-derivable from master' + (accountMaster ? '-per-account stored locally' : ' forever') + ') · pubs ' +
    Object.values(keys).map((k) => k.pub.slice(3, 9) + '…').join(' '));
  // עוגן-חילוץ: headcorner בתוך סמכות-owner של הבוט (threshold 1 — או המפתח או האופרטור)
  const ownerAuth = { weight_threshold: 1, account_auths: [[OPERATOR, 1]], key_auths: [[keys.owner.pub, 1]] };
  const child = { weight_threshold: 1, account_auths: [], key_auths: [] };
  const endow = await vestsForSp(sp);
  log('mint: endowment ' + sp + ' SP from @' + creator + ' = ' + endow.vests + ' (ratio ' + endow.per + ' VESTS/SP)' + (topup ? ' · top-up ' + topup + ' SP from @' + OPERATOR : ''));
  const dgp = await loadVestProps();
  const ops = [
    ['create_claimed_account', {
      creator, new_account_name: name,
      owner: ownerAuth, active: auth(keys.active.pub), posting: auth(keys.posting.pub),
      memo_key: keys.memo.pub, json_metadata: '',
    }],
    ['delegate_vesting_shares', { delegator: creator, delegatee: name, vesting_shares: endow.vests }],
  ];
  if (DRY) { log('[DRY] would mint @' + name + ' (creator @' + creator + ') · rescue-anchor=' + OPERATOR + ' · deterministic keys'); return record({ type: 'mint', name, creator, dry: true, rescueAnchor: OPERATOR }); }
  const txid = await broadcast(makeTx(dgp, ops), wif);
  log('mint BROADCAST txid=' + txid.slice(0, 16) + '…');
  let topupTxid = null;
  if (topup && parseFloat(topup) > 0) {
    try {
      const t = await vestsForSp(parseFloat(topup));
      const dgp2 = await loadVestProps();
      topupTxid = await broadcast(makeTx(dgp2, [['delegate_vesting_shares', { delegator: OPERATOR, delegatee: name, vesting_shares: t.vests }]]), ACTIVE_WIF);
      log('top-up BROADCAST txid=' + topupTxid.slice(0, 16) + '…');
    } catch (e) { log('top-up FAILED (non-fatal): ' + String((e && e.message) || e).slice(0, 120)); }
  }
  // גיבוי-כפול: כספת + קובץ-מפתח
  vaultUpsert({
    username: name, tier: 'factory-v2', mode: 'factory-v2',
    keys, chains: ['steem'],
    addedAt: new Date().toISOString(), syncedAt: new Date().toISOString(),
    meta: { creator, txid, topupTxid, endowmentSp: sp, topupSp: topup || 0, deterministic: !accountMaster, keyMode, accountMaster: accountMaster || undefined, rescueAnchor: OPERATOR, derivedFrom: accountMaster ? 'random-anchored' : 'FACTORY_MASTER' },
  });
  keyFileWrite(name, keys, { meta: { creator, txid, gen: 2, keyMode, accountMaster: accountMaster || undefined } });
  log('backups: vault.json (tier factory-v2) + keys/' + name + '.json — 0600, git-ignored');
  // אימות-על-השרשרת
  await new Promise((r) => setTimeout(r, 4000));
  const fresh = await getAccount(name);
  const rc = await getRcMana(name);
  const ownerOk = fresh && (fresh.owner.account_auths || []).some((a) => a[0] === OPERATOR);
  const received = fresh ? parseFloat(fresh.received_vesting_shares) : 0;
  const verified = !!fresh && ownerOk && received > 0;
  log('mint VERIFY: @' + name + ' created=' + (fresh ? fresh.created : 'MISSING') +
    ' · rescueAnchor=' + (ownerOk ? 'YES' : 'NO') + ' · received=' + received.toFixed(3) + ' SP' +
    ' · RC max=' + (rc ? (rc.max / 1e9).toFixed(2) + 'G' : '?') + (verified ? ' ✓' : ''));
  let fleet = null;
  try {
    const prev = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8'));
    fleet = Array.from(new Set([...(prev.fleet || []), name]));
  } catch (_) { fleet = [name]; }
  record({ type: 'mint', name, creator, txid, topupTxid, verified, receivedSp: received, rcMaxG: rc ? rc.max / 1e9 : null, fleet });
  // המעשה הריבוני הראשון — מיד אחרי לידה מאומתת
  if (verified) {
    try { await modePing(name); } catch (_) { /* הפינג ירוץ בפעימה הבאה */ }
  }
  return verified;
}

/* --ping --name <n> : המעשה הריבוני הראשון — רישום-עצמי על אוטובוס-ה-saos */
async function modePing(name) {
  const p = path.join(__dirname, 'keys', name + '.json');
  let keys = null;
  try {
    const kf = JSON.parse(fs.readFileSync(p, 'utf8'));
    keys = kf.keys;
  } catch (_) {
    // נגזרת מה-master — החוזק של דור-שני: גם בלי קובץ, המפתחות נשחזרים
    keys = deriveKeys(name);
  }
  if (!keys || !keys.posting) return log('ping: no posting key for @' + name);
  const seq = Math.floor(Date.now() / 1000);
  const payload = { t: 'fleet_ping', gen: 2, bot: name, seq, at: new Date().toISOString(), v: 'factory-v2' };
  const dgp = await loadVestProps();
  if (DRY) { log('[DRY] would ping fleet from @' + name); return record({ type: 'ping', name, dry: true }); }
  const txid = await broadcast(makeTx(dgp, [['custom_json', {
    required_posting_auths: [name], required_active_auths: [],
    id: 'saos', json: JSON.stringify(payload),
  }]]), keys.posting.wif);
  log('fleet-ping BROADCAST by @' + name + ' txid=' + txid.slice(0, 16) + '…');
  await new Promise((r) => setTimeout(r, 4000));
  const h = await raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [[name, -1, 10]], id: 1 });
  const found = (h || []).some(([, op]) => op && op.op && op.op[0] === 'custom_json' && op.op[1].id === 'saos');
  log('ping VERIFY: ' + (found ? 'on-chain history ✓' : 'history pending (node-lag)'));
  record({ type: 'ping', name, txid, verified: found });
}

/* --derive --name <n> : הדפסת pubs (הוכחת-שחזור בלי סודות) */
async function modeDerive(name) {
  const keys = deriveKeys(name);
  const on = await getAccount(name);
  const onPubs = on ? {
    owner: (on.owner.key_auths[0] || [])[0],
    active: (on.active.key_auths[0] || [])[0],
    posting: (on.posting.key_auths[0] || [])[0],
    memo: on.memo_key,
  } : null;
  const match = onPubs ? Object.fromEntries(Object.keys(onPubs).map((r) => [r, onPubs[r] === keys[r].pub])) : null;
  log('derive: ' + JSON.stringify(Object.fromEntries(Object.keys(keys).map((r) => [r, keys[r].pub.slice(3, 12) + '…']))));
  if (onPubs) {
    log('derive vs on-chain: ' + JSON.stringify(match));
    const all = Object.values(match).every(Boolean);
    log('RE-DERIVATION ' + (all ? 'VERIFIED ✓ — המפתחות לא אובדים לעולם' : 'MISMATCH — בדוק FACTORY_MASTER'));
    record({ type: 'derive', name, match, allMatch: all });
  }
}

(async () => {
  const name = argOf('--name', argOf('--reclaim', null));
  if (hasFlag('--reclaim')) return modeReclaim(argOf('--reclaim', ''));
  if (hasFlag('--claim')) return modeClaim(argOf('--creator', OPERATOR));
  if (hasFlag('--mint')) return modeMint(argOf('--creator', OPERATOR), argOf('--name', ''), parseFloat(argOf('--sp', '0.5')), argOf('--topup', '0'));
  if (hasFlag('--topup')) return modeTopup(argOf('--name', ''), parseFloat(argOf('--sp', '0')));
  if (hasFlag('--ping')) return modePing(argOf('--name', ''));
  if (hasFlag('--derive')) return modeDerive(argOf('--name', ''));
  log('nothing to do — pass --reclaim | --claim | --mint | --topup | --ping | --derive');
})().catch((e) => { log('fatal: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });

/* --topup --name <n> --sp S : תוספת-הקצבה מהאוצר */
async function modeTopup(name, sp) {
  if (!ACTIVE_WIF) return log('topup: no ACTIVE_WIF');
  if (!(sp > 0)) return log('topup: --sp must be > 0');
  if (DRY) { log('[DRY] would top-up @' + name + ' with ' + sp + ' SP'); return record({ type: 'topup', name, sp, dry: true }); }
  const t = await vestsForSp(sp);
  const dgp = await loadVestProps();
  const txid = await broadcast(makeTx(dgp, [['delegate_vesting_shares', { delegator: OPERATOR, delegatee: name, vesting_shares: t.vests }]]), ACTIVE_WIF);
  log('top-up BROADCAST txid=' + txid.slice(0, 16) + '…');
  await new Promise((r) => setTimeout(r, 4000));
  const fresh = await getAccount(name);
  const received = fresh ? parseFloat(fresh.received_vesting_shares) : 0;
  log('top-up VERIFY: @' + name + ' received_vesting=' + received.toFixed(3) + ' SP');
  record({ type: 'topup', name, sp, txid, receivedSp: received });
}
