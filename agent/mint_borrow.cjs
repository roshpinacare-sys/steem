#!/usr/bin/env node
/**
 * mint_borrow.cjs — Task 52: המפעל לווה-דלק לעצמו ומטביע (plan-B: חלון-אחד).
 *
 * חומות נמדדו (חי):
 *   (1) claim_account = 6.000072T RC קבוע לכל-חשבון (סבסוד-היווצרות היומי)
 *   (2) available להאצלה = vesting − delegated_out − max_rc_creation_adjustment
 *       (headcorner: 1,571,453 vests = 971 SP "עתודת-יצירה" נעולים — תגלית)
 *   (3) האצלה מעניקה mana מלא/מיידי (probe wic: +100 SP → +80.8G mana, 100%)
 *   (4) עקומת maxRC ≈ 83G רצפה + 1.214e-10 × vests² (התאמה 3-נקודות ±25%)
 *   (5) delegate-to-0 מוחק את כל-ההאצלה — לא דלתא (לקח wic: הדלק נמחק והוחזר)
 *
 * הרצף (plan-B):
 *   A. הקפאת דלק-חיילים (10× delegate 0 — זמני, txids נרשמים) — משחרר 808,240 vests
 *   B. הלוואה 6,985,000 vests → creator (cashmachine)
 *   C. poll: maxRC ≥ CLAIM_WALL(6.0001T) && mana ≥ CLAIM_WALL
 *   D. claim (factory_v2 --claim --creator) → טיקט על-השרשרת
 *   E. mint (factory_v2 --mint --creator --name hcnova2 --sp 0.5) — עשוי להיכשל-RC בכנות
 *      (הטיקט שורד על-השרשרת — מימוש מאוחר אפשרי בלי-אוצר)
 *   F. החזרת ההלוואה לבסיס (לא לאפס!) + שחרור-דלק חזרה ל-10 החיילים
 *   G. topup 45 SP מהאוצר → hcnova2 · אימות-סופי · תיעוד
 *
 * תוצאה → mint_borrow_result.json. ברירת-מחדל --dry.
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/mint_borrow.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const steem = require('steem');

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(__dirname);

const OPERATOR = (process.env.AGENT_ACCOUNT || '').toLowerCase();
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const RPCS = ['https://api.steemit.com', 'https://api.steem.fans', 'https://api.justyy.com', 'https://steem.61bts.com'];

const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: OPERATOR });
const DRY = GATE.dry;
const LIVE = GATE.live;
announceGate(GATE);

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const CREATOR = String(argOf('--creator', 'cashmachine')).toLowerCase();
const NAME = argOf('--name', 'hcnova2');
const SOLDIER_FUEL_VESTS = '80824.000000 VESTS';       // דלק-בסיס לחייל (fuel_line)
const BORROW_VESTS = argOf('--vests', '6908000.000000') + ' VESTS';
const CLAIM_WALL = parseFloat(argOf('--wall', '6.0001e12'));
const TREASURY_TOPUP_SP = parseFloat(argOf('--topup', '45'));
const HARAN_BOOST_VESTS = argOf('--haran-vests', '383000'); // haran מלווה מהעצמי-שלו (לא-מהדלק) — חוצה את החומה עם מרווח

const SOLDIERS = ['cashmachine', 'haran', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet']
  .filter((s) => s !== CREATOR);

const log = (m) => console.log('[' + new Date().toISOString() + '] mint-borrow: ' + m);
const RESULT_PATH = path.join(__dirname, 'mint_borrow_result.json');

function record(fields) {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8')); } catch (_) { /* first */ }
  const out = Object.assign({}, prev, fields, { at: new Date().toISOString() });
  out.history = prev.history || [];
  if (fields.historyEntry) out.history.push(Object.assign({ at: new Date().toISOString() }, fields.historyEntry));
  delete out.historyEntry;
  fs.writeFileSync(RESULT_PATH, JSON.stringify(out, null, 2) + '\n');
}

/* ── RPC מרוץ-צמתים ── */
function rpcV4(url, body) {
  const u = new URL(url); const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 }, (res) => {
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
async function getAccount(name) {
  const r = await raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[name]], id: 1 });
  return r && r[0] ? r[0] : null;
}
async function getRc(name) {
  const r = await raceRpc({ jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [name] }, id: 1 });
  const row = r && r.rc_accounts && r.rc_accounts[0];
  return row ? { max: parseFloat(row.max_rc), mana: parseFloat(row.rc_manabar.current_mana) } : null;
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
const crypto = require('crypto');
async function broadcast(tx, wif) {
  const signed = steem.auth.signTransaction(tx, [wif]);
  await rpcV4(RPCS[0], { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 3 });
  return signed.id || crypto.createHash('sha256').update(JSON.stringify(signed)).digest('hex');
}
const G = (n) => (n / 1e12).toFixed(3) + 'T';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function delegate(delegatee, vests) {
  const dgp = await raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 2 });
  const txid = await broadcast(makeTx(dgp, [['delegate_vesting_shares', { delegator: OPERATOR, delegatee, vesting_shares: vests }]]), ACTIVE_WIF);
  return String(txid);
}

function activeWifFor(account) {
  const acc = String(account).toLowerCase();
  if (acc === OPERATOR) return ACTIVE_WIF;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const row = (v.accounts || []).find((a) => String(a.username).toLowerCase() === acc);
    if (row && row.keys && row.keys.active && row.keys.active.wif) return row.keys.active.wif;
  } catch (_) { /* אין כספת */ }
  return '';
}

async function delegateAs(delegator, delegatee, vests, wif) {
  const dgp = await raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 2 });
  const txid = await broadcast(makeTx(dgp, [['delegate_vesting_shares', { delegator, delegatee, vesting_shares: vests }]]), wif);
  return String(txid);
}

(async () => {
  log('mode=' + (LIVE ? 'LIVE' : DRY ? 'DRY' : 'PLAN') + ' · creator=@' + CREATOR + ' · name=@' + NAME + ' · borrow=' + BORROW_VESTS + ' · wall=' + G(CLAIM_WALL) + ' · soldiers frozen=' + SOLDIERS.length);

  /* guards */
  if (!ACTIVE_WIF) return log('FATAL: no ACTIVE_WIF');
  const creatorRow = (() => { try { const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8')); return (v.accounts || []).find((a) => String(a.username).toLowerCase() === CREATOR); } catch (_) { return null; } })();
  if (!creatorRow || !creatorRow.keys || !creatorRow.keys.active) return log('FATAL: @' + CREATOR + ' active key not in vault');
  const exists = await getAccount(NAME);
  if (exists) return log('FATAL: @' + NAME + ' already exists');
  const creatorAcc = await getAccount(CREATOR);
  const baseReceived = creatorAcc ? parseFloat(creatorAcc.received_vesting_shares) : 0;
  const treasBefore = await getRc(OPERATOR);
  const creatorBefore = await getRc(CREATOR);
  if (!treasBefore || !creatorBefore) return log('FATAL: rc read failed');
  log('pre: treasury max=' + G(treasBefore.max) + ' (' + (100 * treasBefore.mana / treasBefore.max).toFixed(1) + '%) · creator max=' + G(creatorBefore.max) + ' · creator baseReceived=' + baseReceived.toFixed(3));
  record({ mode: LIVE ? 'live' : 'dry', creator: CREATOR, name: NAME, borrowVests: BORROW_VESTS, claimWall: CLAIM_WALL });

  if (!LIVE) {
    log('[DRY] would: freeze ' + SOLDIERS.length + ' soldiers → borrow ' + BORROW_VESTS + ' → poll ≥ ' + G(CLAIM_WALL) + ' → claim → mint → restore fuel+baseline → topup ' + TREASURY_TOPUP_SP + ' SP');
    return;
  }

  const st = { frozen: [], haranBoost: null, borrowTxid: null, claim: null, mint: null, returned: false, restored: [] };
  try {
    /* A. הקפאת דלק-חיילים (זמנית) */
    for (const s of SOLDIERS) {
      const txid = await delegate(s, '0.000000 VESTS');
      st.frozen.push({ soldier: s, txid });
      log('FROZE fuel of @' + s + ' txid=' + txid.slice(0, 12) + '…');
      await sleep(2500);
    }
    record({ historyEntry: { step: 'freeze', count: st.frozen.length, txids: st.frozen.map((f) => f.txid) } });

    /* A2. החייל-העשיר מלווה מהעצמי-שלו (הפלגה הדרגתית אם נתקל בעתודת-יצירה) */
    const haranWif = activeWifFor('haran');
    if (haranWif && HARAN_BOOST_VESTS > 0) {
      const haranAcc = await getAccount('haran');
      const haranOwn = haranAcc ? parseFloat(haranAcc.vesting_shares) : 0;
      const want = Math.min(HARAN_BOOST_VESTS, Math.max(0, Math.floor(haranOwn * 0.995)));
      let boosted = 0;
      for (const attempt of [want, Math.floor(want * 0.8), Math.floor(want * 0.5), Math.floor(want * 0.3)]) {
        if (attempt < 10000) break;
        try {
          const txid = await delegateAs('haran', CREATOR, attempt.toFixed(6) + ' VESTS', haranWif);
          st.haranBoost = { txid, vests: attempt };
          boosted = attempt;
          log('HARAN BOOST txid=' + txid.slice(0, 12) + '… · ' + attempt + ' vests (own) → @' + CREATOR);
          break;
        } catch (e) {
          log('haran boost ' + attempt + ' rejected: ' + String((e && e.message) || e).slice(0, 90));
        }
      }
      if (!boosted) log('haran boost unavailable — continuing with treasury borrow only');
      await sleep(5000);
    }

    /* B. הלוואה */
    st.borrowTxid = await delegate(CREATOR, BORROW_VESTS);
    log('BORROW txid=' + st.borrowTxid.slice(0, 16) + '… · ' + BORROW_VESTS + ' → @' + CREATOR);
    await sleep(6000);

    /* C. poll חומת-התביעה */
    let creatorRc = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      creatorRc = await getRc(CREATOR);
      if (creatorRc && creatorRc.max >= CLAIM_WALL && creatorRc.mana >= CLAIM_WALL) break;
      await sleep(5000);
    }
    if (!creatorRc || creatorRc.max < CLAIM_WALL || creatorRc.mana < CLAIM_WALL) {
      log('WALL NOT CROSSED: max=' + (creatorRc ? G(creatorRc.max) : '?') + ' mana=' + (creatorRc ? G(creatorRc.mana) : '?') + ' — curve measured at this scale; undoing everything');
      record({ historyEntry: { step: 'wall-not-crossed', creatorMax: creatorRc ? creatorRc.max : null, creatorMana: creatorRc ? creatorRc.mana : null } });
      throw new Error('wall-not-crossed');
    }
    log('WALL CROSSED (measured): creator max=' + G(creatorRc.max) + ' · mana=' + G(creatorRc.mana));

    /* D. claim */
    const claimRun = spawnSync('node', [path.join(__dirname, 'factory_v2.cjs'), '--claim', '--creator', CREATOR], { encoding: 'utf8', timeout: 120000 });
    console.log((claimRun.stdout || '').trim());
    if (claimRun.stderr) console.error((claimRun.stderr || '').trim());
    try { const fr = JSON.parse(fs.readFileSync(path.join(__dirname, 'factory_v2_result.json'), 'utf8')); st.claim = (fr.actions || []).filter((a) => a.type === 'claim').pop(); } catch (_) { /* noop */ }
    if (!st.claim || st.claim.error) {
      log('claim FAILED: ' + (st.claim && st.claim.error ? st.claim.error.slice(0, 140) : 'no result') + ' — undoing');
      throw new Error('claim-failed');
    }
    log('claim OK: tickets=' + st.claim.tickets + ' · rcCost≈' + (st.claim.rcCostG ? st.claim.rcCostG.toFixed(2) + 'G' : 'n/a'));

    /* E. mint — מיד אחרי התביעה (הטיקט שורד גם אם ה-create נכשל-RC) */
    const mintRun = spawnSync('node', [path.join(__dirname, 'factory_v2.cjs'), '--mint', '--creator', CREATOR, '--name', NAME, '--sp', '0.5'], { encoding: 'utf8', timeout: 180000 });
    console.log((mintRun.stdout || '').trim());
    if (mintRun.stderr) console.error((mintRun.stderr || '').trim());
    try { const fr = JSON.parse(fs.readFileSync(path.join(__dirname, 'factory_v2_result.json'), 'utf8')); st.mint = (fr.actions || []).filter((a) => a.type === 'mint' && a.name === NAME).pop(); } catch (_) { /* noop */ }
    log('mint: ' + (st.mint ? (st.mint.verified ? 'VERIFIED ✓ txid=' + String(st.mint.txid).slice(0, 16) + '…' : 'unverified — ticket survives') : 'no result'));
  } catch (e) {
    log('UNWIND: ' + String((e && e.message) || e).slice(0, 160));
  }

  /* F. החזרת-הכל: הלוואה → בסיס · דלק → חיילים · עצמי-חרן → חרן */
  try {
    const back = await delegate(CREATOR, baseReceived.toFixed(6) + ' VESTS');
    st.returned = true;
    log('RETURN borrow→baseline(' + baseReceived.toFixed(3) + ' vests) txid=' + back.slice(0, 16) + '…');
  } catch (e) { log('RETURN FAILED: ' + String((e && e.message) || e).slice(0, 120)); }
  if (st.haranBoost) {
    try {
      const haranWif = activeWifFor('haran');
      const txid = await delegateAs('haran', CREATOR, '0.000000 VESTS', haranWif);
      log('HARAN BOOST returned txid=' + txid.slice(0, 12) + '…');
    } catch (e) { log('HARAN BOOST return FAILED: ' + String((e && e.message) || e).slice(0, 100)); }
  }
  for (const s of SOLDIERS) {
    try {
      const txid = await delegate(s, SOLDIER_FUEL_VESTS);
      st.restored.push({ soldier: s, txid });
      log('RESTORED fuel to @' + s + ' txid=' + txid.slice(0, 12) + '…');
    } catch (e) { log('RESTORE @' + s + ' FAILED: ' + String((e && e.message) || e).slice(0, 100)); }
  }

  /* G. topup + אימות-סופי */
  let topupTxid = null;
  if (st.mint && st.mint.verified && TREASURY_TOPUP_SP > 0) {
    try {
      const dgp = await raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 2 });
      const per = parseFloat(dgp.total_vesting_shares) / parseFloat(dgp.total_vesting_fund_steem);
      topupTxid = await delegate(NAME, (TREASURY_TOPUP_SP * per).toFixed(6) + ' VESTS');
      log('TOPUP ' + TREASURY_TOPUP_SP + ' SP → @' + NAME + ' txid=' + String(topupTxid).slice(0, 16) + '…');
    } catch (e) { log('TOPUP FAILED (non-fatal): ' + String((e && e.message) || e).slice(0, 120)); }
  }
  await sleep(6000);
  const fresh = await getAccount(NAME);
  const treasAfter = await getRc(OPERATOR);
  const creatorAfter = await getRc(CREATOR);
  const out = {
    status: st.mint && st.mint.verified ? 'minted' : st.claim && st.claim.tickets ? 'claimed-ticket-held' : (st.claim ? 'claim-failed' : 'wall-not-crossed'),
    creator: CREATOR, name: NAME,
    frozenCount: st.frozen.length, restoredCount: st.restored.length,
    haranBoost: st.haranBoost,
    borrowTxid: st.borrowTxid, returnDone: st.returned,
    claim: st.claim ? { txid: st.claim.txid, tickets: st.claim.tickets, rcCostG: st.claim.rcCostG } : null,
    mint: st.mint ? { txid: st.mint.txid, verified: st.mint.verified, receivedSp: st.mint.receivedSp } : null,
    topupTxid,
    measured: {
      creatorMaxDuringBorrow: st.borrowTxid ? (await Promise.resolve(null), null) : null,
      treasuryMaxBefore: treasBefore.max, treasuryMaxAfter: treasAfter ? treasAfter.max : null,
      creatorMaxAfter: creatorAfter ? creatorAfter.max : null,
    },
    chainProof: fresh ? { created: fresh.created, ownerAnchor: (fresh.owner.account_auths || []).some((a) => a[0] === OPERATOR), receivedVests: fresh.received_vesting_shares } : null,
  };
  record(out);
  log('RESULT: ' + out.status + ' · @' + NAME + (fresh ? ' exists created=' + fresh.created : ' not-created (ticket-held if claimed)') + ' · frozen/restored=' + out.frozenCount + '/' + out.restoredCount);
})().catch((e) => { log('fatal: ' + String((e && e.message) || e).slice(0, 300)); record({ status: 'fatal', error: String((e && e.message) || e).slice(0, 300) }); process.exit(1); });
