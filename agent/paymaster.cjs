#!/usr/bin/env node
/**
 * paymaster.cjs — Task 62: מנוע-PAYMASTER ריבוני (המשאלה של המפעיל, מילולית).
 *
 * "החוזה שלנו ישלם גז ועמלות על חשבוננו — עסקה בשרשרת אחרת שדורשת עמלות
 *  וגז תוכל לאמת דרך הגז שהחוזה שלנו משלם"
 *
 * על Graphene (Steem/Hive) החוק הפרוטוקולרי: RC נגבה מהסמכויות הנדרשות —
 * ולכן ה-PAYMASTER שלנו משלם בשתי-שכבות אמיתיות:
 *   (1) RELAY — לקוח חותם בתהליך-משלו (בלי תשתית, בלי צומת, בלי ספריה
 *        בצד-השרת) → הממסר מאמת מול get_required_signatures ומשדר כמות-שהיא.
 *        הלקוח משלם רק את ה-RC הזול של החתימה; המערכת סיפקה תשתית+שידור.
 *   (2) FUEL — כשהלקוח רעב-אנרגיה, האוצר שלנו משלם בפועל: האצת VESTS
 *        (active) שמגדילה max_rc של הלקוח מיד — הגז הוא שלנו, נמדד חי.
 *        (מוכח ב-Task 58: 1M RC ל-VEST)
 *
 * שימוש:
 *   node paymaster.cjs --relay          # meta-tx חי: חתימת-לקוח → אימות → שידור-ממסר
 *   node paymaster.cjs --fuel           # סבב-תדלוק חי לחייל הרעב ביותר ב-Hive
 *   node paymaster.cjs --memo-biz       # מסחר-ממו חי: הזמנה→תמחור→מילוי→קבלה מוצפנת
 *
 * סודות: כל החתימות מקומיות; שום מפתח לא נע/נרשם/נשלח.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const steem = require('steem');
// owner directive 2026-10-04 (STASIS): sign-time brake — every broadcast re-checks the breaker (stale-process lesson)
const capGate = require('./lib/capital_gate.cjs');
function stasisStop(tool) {
  try { return !!capGate.stasisHalt(tool); } catch (e) { console.log('[CAPITAL-GATE] ' + tool + ' — gate module error, lane halts fail-closed: ' + String((e && e.message) || e).slice(0, 80)); return true; }
}
const { Client, PrivateKey } = require('@hiveio/dhive');

const OUT_RELAY = path.join(__dirname, 'paymaster_relay.json');
const OUT_FUEL = path.join(__dirname, 'paymaster_fuel.json');
const OUT_MEMO = path.join(__dirname, 'memo_biz.json');
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';

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
const ENV = loadDotEnv(__dirname);
const TREASURY = (process.env.AGENT_ACCOUNT || ENV.AGENT_ACCOUNT || '').trim();
if (!TREASURY) { console.error('usage: AGENT_ACCOUNT=<account> (in agent/.env) — node agent/paymaster.cjs — no default acting account (8-b · docs/117o-KEY-INCIDENT.md)'); process.exit(1); }
const POSTING_WIF = process.env.POSTING_WIF || ENV.POSTING_WIF || '';
const ACTIVE_WIF = process.env.ACTIVE_WIF || ENV.ACTIVE_WIF || '';

const vault = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
const ARMY = (vault.accounts || []).filter((a) => a && a.username);

function rpc(urlStr, method, params, timeoutMs = 25000) {
  const u = new URL(urlStr);
  const payload = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.error) return reject(new Error(typeof j.error === 'string' ? j.error : (j.error.message || JSON.stringify(j.error).slice(0, 120))));
            resolve(j.result);
          } catch (_) { reject(new Error('bad rpc: ' + data.slice(0, 90))); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
const STEEM_NODES = ['https://api.justyy.com', 'https://api.steemit.com', 'https://steemapi.boylikegirl.club', 'https://steem.61bts.com']; // steemit.com: broadcast broken server-side (lexical cast) — justyy first
const HIVE_NODES = ['https://api.openhive.network', 'https://hive-api.arcange.eu', 'https://api.hive.blog'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function firstNode(chain, method, params, timeoutMs = 25000) {
  const nodes = chain === 'hive' ? HIVE_NODES : STEEM_NODES;
  let lastErr;
  for (const node of nodes) {
    try { return { node, result: await rpc(node, method, params, timeoutMs) }; } catch (e) { lastErr = e; if (process.env.PM_DEBUG) console.error('  [' + chain + '→' + new URL(node).hostname + ' ' + method + '] ' + String((e && e.message) || e).slice(0, 80)); }
  }
  throw lastErr;
}

async function rcPct(chain, account) {
  const { result: raw } = await firstNode(chain, 'rc_api.find_rc_accounts', { accounts: [account] });
  const r = raw && raw.rc_accounts && raw.rc_accounts[0];
  if (!r) return null;
  const max = Number(r.max_rc), mana = Number(r.rc_manabar.current_mana);
  return { max, mana, pct: (mana / max) * 100 };
}

/* ---------- עסקה חתומה מקומית (צד-הלקוח) ---------- */
async function clientSignTx(chain, clientName, clientWif, ops, ttlSec = 60) {
  const { node, result: props } = await firstNode(chain, 'condenser_api.get_dynamic_global_properties', []);
  const refBlockNum = props.head_block_number & 0xffff;
  // תגלית-62: ה-prefix הנכון = 4 בייטים (4..8) מה-head_block_id בקריאה LITTLE-ENDIAN
  // (parseInt BE — כפי ש-steem-js עושה למראית-עין — נדחה: tapos exception)
  const refBlockPrefix = Buffer.from(props.head_block_id, 'hex').readUInt32LE(4);
  // תגלית-62: fc time_point_sec מקבל בדיוק "YYYY-MM-DDTHH:MM:SS" — בלי Z! (עם Z = lexical-cast שגיאה בכל הצמתים)
  const trx = {
    ref_block_num: refBlockNum,
    ref_block_prefix: refBlockPrefix,
    expiration: new Date(Date.now() + ttlSec * 1000).toISOString().slice(0, 19),
    operations: ops,
    extensions: [],
  };
  const sig = (() => {
    // תגלית-62: חתימה לפי chain_id של השרשרת — Steem=0×0000…, Hive=0xbeeab0de…
    const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
    const STEEM_CHAIN_ID = '0000000000000000000000000000000000000000000000000000000000000000';
    steem.config.set('chain_id', chain === 'hive' ? HIVE_CHAIN_ID : STEEM_CHAIN_ID);
    try { return steem.auth.signTransaction(trx, [clientWif]); } finally { steem.config.set('chain_id', STEEM_CHAIN_ID); }
  })();
  trx.signatures = sig.signatures;
  return trx;
}

/* ---------- שידור-ממסר: עסקה חתומה-מראש, בלי מפתחות בצד-הממסר ----------
 * תגלית-62: condenser_api.broadcast_transaction שבור-שרת בכל הצמתים (lexical
 * cast); המסילה-החיה שעובדת = network_broadcast_api.broadcast_transaction_synchronous
 * (בדיוק מה ש-steem-js עצמו שולח) — מחזיר גם את ה-txid מיד. */
async function relayBroadcast(chain, signedTrx) {
  const { result } = await firstNode(chain, 'call', ['network_broadcast_api', 'broadcast_transaction_synchronous', [signedTrx]], 30000);
  return result; // { id, block_num, trx_num, expired }
}

async function getTx(chain, txid) {
  try {
    const { result } = await firstNode(chain, 'condenser_api.get_transaction', [txid]);
    return result;
  } catch (_) {
    return null;
  }
}

/* ================================================================
 * --relay : meta-tx חי על Steem ו-Hive
 * ================================================================ */
async function relayDemo() {
  if (!POSTING_WIF) throw new Error('no POSTING_WIF (treasury env)');
  const results = { at: new Date().toISOString(), relayer: TREASURY, chains: {} };
  // בחירת-לקוח לפי-שרשרת:
  //  · Steem → חייל בריא עם מפתח-משלו (cashmachine) — חתימה עצמאית מלאה
  //  · Hive  → @ynet (operator-delegated, עוגן-חילוף headcorner:1) —
  //    הלקוח שבידו אפס מפתחות; הסמכות חתומה על-ידי המערכת; הגז נגבה ממנו (נמדד)
  const pick = {
    steem: ARMY.find((a) => a.mode !== 'operator-delegated' && a.keys && a.keys.posting && a.keys.posting.wif),
    hive: ARMY.find((a) => a.mode === 'operator-delegated') || ARMY[0],
  };

  for (const chain of ['steem', 'hive']) {
    const client = pick[chain];
    const anchorSigned = chain === 'hive' && client.mode === 'operator-delegated';
    const clientWif = anchorSigned ? POSTING_WIF : client.keys.posting.wif;
    if (!client) { results.chains[chain] = { relayed: false, why: 'no client' }; continue; }
    results.client = results.client || {}; results.client[chain] = client.username;
    try {
    const before = await rcPct(chain, client.username);
    const relayerBefore = await rcPct(chain, TREASURY);

    const payload = { protocol: 'saos-pm/v1', t: 'relay-test', client: client.username, anchorSigned, v: 62, nonce: crypto.randomBytes(6).toString('hex'), ts: new Date().toISOString() };
    const op = ['custom_json', {
      required_auths: [],
      required_posting_auths: [client.username],
      id: 'saos_pm',
      json: JSON.stringify(payload),
    }];
    // צד-הלקוח: חתימה מלאה מקומית (מפתח-הלקוח, או סמכות-מואצלת ל-ynet)
    const signed = await clientSignTx(chain, client.username, clientWif, [op]);

    // אימות-ממסר: סמכות-הלקוח מהשרשרת — מפתח-שלו (key_auths) או עוגן-מפעיל (account_auths)
    const clientPub = steem.auth.wifToPublic(clientWif);
    const [acctRow] = (await firstNode(chain, 'condenser_api.get_accounts', [[client.username]])).result;
    const keyAuths = (acctRow && acctRow.posting && acctRow.posting.key_auths || []).map((k) => k[0]);
    const accAuths = (acctRow && acctRow.posting && acctRow.posting.account_auths || []).map((k) => k[0]);
    const covered = anchorSigned ? accAuths.includes(TREASURY) : keyAuths.includes(clientPub);

    // שידור-ממסר: אפס מפתחות בצד-הממסר — רק העסקה-החתומה; txid מוחזר ישירות
    const bc = await relayBroadcast(chain, signed);
    const directTxid = bc && bc.id;
    await sleep(6000); // עד-הפיכה — אז get_transaction/history מסכימים
    // ראייה עצמאית: re-fetch מלא או איתור-נונס בהיסטוריית-הלקוח
    let txid = directTxid, txBlock = bc ? bc.block_num : null;
    let historyFound = false, txOp = null;
    let entries = [];
    try {
      const hist = (await firstNode(chain, 'condenser_api.get_account_history', [client.username, -1, 5])).result;
      entries = Array.isArray(hist) ? hist : (hist.history || []);
    } catch (_) { /* node without account_history plugin — the direct txid stands */ }
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] && entries[i][1];
      if (!e) continue;
      const o = e.op; const t = o && (Array.isArray(o) ? o[0] : String(o.type || '').replace(/_operation$/, ''));
      const v = o && (Array.isArray(o) ? o[1] : o.value);
      if (t === 'custom_json' && v && v.id === 'saos_pm' && String(v.json).includes(payload.nonce)) {
        txid = e.trx_id; txBlock = e.block; txOp = v; historyFound = true; break;
      }
    }
    const tx = txid ? await getTx(chain, txid) : null;
    const after = txid ? await rcPct(chain, client.username) : null;
    let verifiedOnNode = historyFound;
    if (tx && tx.operations && tx.operations.length) {
      const o0 = tx.operations[0];
      const t0 = Array.isArray(o0) ? o0[0] : String((o0 && o0.type) || '').replace(/_operation$/, '');
      const v0 = Array.isArray(o0) ? o0[1] : (o0 && o0.value);
      if (t0 === 'custom_json' && v0 && v0.id === 'saos_pm' && String(v0.json).includes(payload.nonce)) verifiedOnNode = true;
    }
    results.chains[chain] = {
      relayed: !!txid,
      client: client.username,
      anchorSigned,
      txid, block: txBlock,
      signatureCovered: covered,
      signaturesCount: (signed.signatures || []).length,
      verifiedOnNode,
      clientRcBeforePct: before ? +before.pct.toFixed(3) : null,
      clientRcAfterPct: after ? +after.pct.toFixed(3) : null,
      clientRcDeltaPct: before && after ? +(after.pct - before.pct).toFixed(4) : null,
      relayerRcPct: relayerBefore ? +relayerBefore.pct.toFixed(3) : null,
      nonce: payload.nonce,
    };
    } catch (e) { results.chains[chain] = { relayed: false, why: String((e && e.message) || e).slice(0, 110) }; if (process.env.PM_DEBUG) console.error('chain ' + chain + ' failed: ' + e.message); }
  }
  fs.writeFileSync(OUT_RELAY, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
  return results;
}

/* ================================================================
 * --fuel : סבב-תדלוק חי — האוצר משלם גז בפועל (האצת VESTS על Hive)
 * ================================================================ */
async function fuelCycle(dry = false, targetArg = null, vestsArg = null) {
  if (!ACTIVE_WIF) throw new Error('no ACTIVE_WIF (treasury env)');
  const hive = new Client([HIVE_RPC]);
  // לקוח רעב-אנרגיה על Hive (או יעד-מפורש — המסלול המלא: תדלוק→ממסר)
  const names = ARMY.map((a) => a.username);
  const rcs = await rpc(HIVE_RPC, 'rc_api.find_rc_accounts', { accounts: names.concat([TREASURY]) });
  const rows = (rcs.rc_accounts || []).map((r) => ({
    account: r.account,
    max: Number(r.max_rc),
    mana: Number(r.rc_manabar.current_mana),
  }));
  const treasury = rows.find((r) => r.account === TREASURY);
  const hungriest = targetArg
    ? rows.find((r) => r.account === targetArg.toLowerCase())
    : rows.filter((r) => r.account !== TREASURY).sort((a, b) => a.mana / a.max - b.mana / b.max)[0];
  if (!hungriest) throw new Error('fuel target not found: ' + targetArg);
  const hungerPct = (hungriest.mana / hungriest.max) * 100;
  const treasuryPct = (treasury.mana / treasury.max) * 100;
  const VESTS = vestsArg ? parseInt(vestsArg, 10) : 3000;
  // תגלית-62: האוצר-עצמו יכול להיות חנוק-RC על Hive (חומה-28) — אז בריאות-הצי משלמת:
  // המשלם = החייל הבריר-האנרגיה עם מפתח-active (מסילת-התדלוק האמיתית של המערכת)
  let payerAccount = TREASURY, payerWif = ACTIVE_WIF;
  {
    const soldiers = ARMY.filter((a) => a.mode !== 'operator-delegated' && a.keys && a.keys.active && a.keys.active.wif && a.username !== hungriest.account);
    if (soldiers.length) {
      const sRcs = await rpc(HIVE_RPC, 'rc_api.find_rc_accounts', { accounts: soldiers.map((a) => a.username) });
      const sRows = (sRcs.rc_accounts || []).map((r) => ({ account: r.account, max: Number(r.max_rc), mana: Number(r.rc_manabar.current_mana) }));
      const best = sRows.sort((a, b) => b.mana - a.mana)[0];
      if (best && best.mana > treasury.mana * 2) {
        payerAccount = best.account;
        payerWif = soldiers.find((a) => a.username === best.account).keys.active.wif;
      }
    }
  }
  const out = {
    at: new Date().toISOString(), chain: 'hive', dry,
    payer: { account: payerAccount, isTreasury: payerAccount === TREASURY },
    treasury: { account: TREASURY, rcPct: +treasuryPct.toFixed(2) },
    client: { account: hungriest.account, rcBeforePct: +hungerPct.toFixed(2), maxRcBefore: hungriest.max },
    vestsPlanned: VESTS,
  };
  if (dry) { fs.writeFileSync(OUT_FUEL, JSON.stringify(out, null, 2) + '\n'); console.log(JSON.stringify(out, null, 2)); return out; }

  const [acc] = await hive.database.getAccounts([payerAccount]);
  const delegated = acc.delegated_vesting_shares; // string '123.456789 VESTS'
  const [dNum, dCur] = String(delegated).split(' ');
  const newDel = (parseFloat(dNum) + VESTS).toFixed(6) + ' ' + dCur;
  const ops = [['delegate_vesting_shares', { delegator: payerAccount, delegatee: hungriest.account, vesting_shares: newDel }]];
  if (stasisStop('paymaster:fuel')) { out.stasis = 'HALTED — capital lane closed (capital gate 2026-10-04)'; fs.writeFileSync(OUT_FUEL, JSON.stringify(out, null, 2) + '\n'); return out; } // sign-time brake
  const conf = await hive.broadcast.sendOperations(ops, PrivateKey.fromString(payerWif));
  out.txid = conf && conf.id ? conf.id : (conf && conf.transaction && conf.transaction.id) || null;
  await sleep(2000);
  const after = await rpc(HIVE_RPC, 'rc_api.find_rc_accounts', { accounts: [hungriest.account] });
  const row = after.rc_accounts[0];
  out.client.maxRcAfter = Number(row.max_rc);
  out.client.rcAfterPct = +((Number(row.rc_manabar.current_mana) / Number(row.max_rc)) * 100).toFixed(2);
  out.client.maxRcDelta = out.client.maxRcAfter - out.client.maxRcBefore;
  out.verified = out.client.maxRcDelta > 0;
  fs.writeFileSync(OUT_FUEL, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
  return out;
}

async function findInHistory(chain, account, matcher) {
  // get_transaction דורש account_history_api שחסר בחלק מהצמתים; ההיסטוריה עצמה
  // זמינה ב-steemit — מאתרים את הפעולה לפי-תוכן (ממו/נונס) ומחזירים {trx_id, block}
  const hist = (await firstNode(chain, 'condenser_api.get_account_history', [account, -1, 40])).result;
  const entries = Array.isArray(hist) ? hist : (hist.history || []);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] && entries[i][1];
    if (!e) continue;
    const o = e.op; const t = o && (Array.isArray(o) ? o[0] : String(o.type || '').replace(/_operation$/, ''));
    const v = o && (Array.isArray(o) ? o[1] : o.value);
    if (t === 'transfer' && v && matcher(v)) return { txid: e.trx_id, block: e.block, op: v };
  }
  return null;
}

/* ================================================================
 * --memo-biz : ערך ממו חי — הזמנה→תמחור→מילוי→קבלה מוצפנת
 * ================================================================ */
async function memoBiz() {
  if (!ACTIVE_WIF) throw new Error('no ACTIVE_WIF (treasury env)');
  const customer = ARMY.find((a) => a.mode !== 'operator-delegated' && a.keys && a.keys.active && a.keys.active.wif);
  if (!customer) throw new Error('no customer soldier with active key');
  const out = { at: new Date().toISOString(), customer: customer.username, treasury: TREASURY, steps: {} };

  // 1) הזמנה דרך ממו — transfer ציבורי עם memo-פקודה (הממו הוא ההזמנה)
  const qty = 1;
  const orderMemo = 'saos:buy:SAOS:' + qty;
  if (stasisStop('paymaster:memo-biz')) return out; // sign-time brake (owner 2026-10-04)
  const c1 = await steem.broadcast.sendAsync({
    operations: [['transfer', { from: customer.username, to: TREASURY, amount: '0.001 STEEM', memo: orderMemo }]],
    extensions: [],
  }, [customer.keys.active.wif]);
  out.steps.order = { txid: c1.id, memo: orderMemo };
  await sleep(4000);

  // 2) אימות-קבלה מהשרשרת (account_history) + תמחור מהבריכה שלנו
  const found1 = await findInHistory('steem', TREASURY, (v) => v.from === customer.username && v.memo === orderMemo && v.to === TREASURY);
  out.steps.order.verifiedOnChain = !!(found1 && found1.op.amount === '0.001 STEEM');
  out.steps.order.block = found1 ? found1.block : null;
  // תמחור: רצפת-פירעון מכשיר-ההמרה (SBD→STEEM) — העוגן של הכלכלה שלנו
  const feed = (await firstNode('steem', 'condenser_api.get_current_median_history_price', [])).result;
  const rate = parseFloat(feed.base) / parseFloat(feed.quote); // SBD→STEEM
  out.pricing = { anchor: 'internal_median_feed', base: feed.base, quote: feed.quote, rate: +rate.toFixed(3) };

  // 3) מילוי + קבלה: עסקת-העברה עם ממו-קבלה גלוי
  const receiptMemo = 'saos:receipt:' + c1.id.slice(0, 16) + ' qty=' + qty;
  if (stasisStop('paymaster:memo-biz')) return out; // sign-time brake (owner 2026-10-04)
  const c2 = await steem.broadcast.sendAsync({
    operations: [['transfer', { from: TREASURY, to: customer.username, amount: '0.001 STEEM', memo: receiptMemo }]],
    extensions: [],
  }, [ACTIVE_WIF]);
  out.steps.fill = { txid: c2.id, memo: receiptMemo };

  // 4) קבלה מוצפנת (פרטיות-מסחר): ממו-ECDH אוצר→לקוח
  const enc = steem.memo.encode(ENV.MEMO_WIF || process.env.MEMO_WIF || '', customer.keys.memo ? customer.keys.memo.pub : '', '#' + JSON.stringify({ order: c1.id, fill: c2.id, qty, rate: out.pricing.rate, ts: new Date().toISOString() }));
  out.steps.encryptedReceipt = { attempted: true, sent: false };
  if (out.steps.encryptedReceipt.attempted && (ENV.MEMO_WIF || process.env.MEMO_WIF) && customer.keys.memo && customer.keys.memo.pub) {
    try {
      if (stasisStop('paymaster:memo-biz')) return out; // sign-time brake (owner 2026-10-04)
      const c3 = await steem.broadcast.sendAsync({
        operations: [['transfer', { from: TREASURY, to: customer.username, amount: '0.001 STEEM', memo: enc }]],
        extensions: [],
      }, [ACTIVE_WIF]);
      out.steps.encryptedReceipt.sent = true;
      out.steps.encryptedReceipt.txid = c3.id;
      // הלקוח מפענח מצדו — הוכחת-פרטיות
      const dec = steem.memo.decode(customer.keys.memo.wif, enc);
      out.steps.encryptedReceipt.decryptedOk = dec.startsWith('#') && dec.includes(c2.id.slice(0, 16));
      out.steps.encryptedReceipt.decrypted = JSON.parse(dec.slice(1));
    } catch (e) {
      out.steps.encryptedReceipt.why = String((e && e.message) || e).slice(0, 90);
    }
  }
  out.steps.fill.verifiedOnChain = false;
  await sleep(4000);
  let tx2 = null;
  try { tx2 = await findInHistory('steem', customer.username, (v) => v.from === TREASURY && v.memo === receiptMemo); } catch (_) { }
  if (tx2) out.steps.fill.verifiedOnChain = true, out.steps.fill.block = tx2.block;
  fs.writeFileSync(OUT_MEMO, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
  return out;
}

/* ================================================================
 * --memo-biz-sov : 94 — מחזור-עסקה ריבוני-מלא — אפס-STEEM-נז (המשאלה של המפעיל:
 * "תמיד פתרונות ריבוניים — בלי לשלם עמלה ועדיין ליישם את המטרות")
 *   הזמנה  → custom_json saos_pm (posting, אפס-מטבע-נז)
 *   תשלום  → SAOS על הספר-הריבוני שלנו (פס-המשימות — transfer, אפס-עמלה)
 *   קבלה   → custom_json saos_pm receipt
 *   קבלה-מוצפנת → custom_json עם ECDH-blob (פרטיות בלי transfer)
 * ניבוי-מדידה (CHL-1): כל-צעד מכריז-מראש ונמדד מול-השרשרת/הספר.
 * ================================================================ */
async function memoBizSov() {
  if (!POSTING_WIF) throw new Error('no POSTING_WIF (treasury env)');
  const customer = ARMY.find((a) => a.mode !== 'operator-delegated' && a.keys && a.keys.posting && a.keys.posting.wif);
  if (!customer) throw new Error('no customer soldier with posting key');
  const nonce = crypto.randomBytes(6).toString('hex');
  const qty = 1;
  const out = { at: new Date().toISOString(), mode: 'memo-biz-sov', customer: customer.username, treasury: TREASURY, steemMoved: '0.000', steps: {} };

  // 1) הזמנה — custom_json בלבד (המטבע לא זז בכלל)
  const orderPayload = { t: 'order', v: 94, n: nonce, sku: 'SAOS', qty, note: 'sovereign-zero-fee' };
  const c1 = await new Promise((resolve, reject) => {
    steem.broadcast.customJson(customer.keys.posting.wif, [], [customer.username], 'saos_pm', JSON.stringify(orderPayload), (e, r) => (e ? reject(e) : resolve(r)));
  });
  out.steps.order = { txid: c1.id, carrier: 'custom_json', steemMoved: '0.000' };
  await sleep(5000);

  // 2) אימות-קבלה מהשרשרת + תמחור מהפיד (כמו-במסילה-הישנה — אבל בלי-תשלום)
  let found1 = null;
  const hist = await firstNode('steem', 'condenser_api.get_account_history', [customer.username, -1, 10]);
  const entries = Array.isArray(hist.result) ? hist.result : (hist.result.history || []);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] && entries[i][1];
    const o = e && e.op; const t = o && (Array.isArray(o) ? o[0] : String(o.type || '').replace(/_operation$/, ''));
    const v = o && (Array.isArray(o) ? o[1] : o.value);
    if (t === 'custom_json' && v && v.id === 'saos_pm' && String(v.json).includes(nonce)) { found1 = { txid: e.trx_id, block: e.block }; break; }
  }
  out.steps.order.verifiedOnChain = !!found1;
  out.steps.order.block = found1 ? found1.block : null;
  const feed = (await firstNode('steem', 'condenser_api.get_current_median_history_price', [])).result;
  const rate = parseFloat(feed.base) / parseFloat(feed.quote);
  out.pricing = { anchor: 'internal_median_feed', rate: +rate.toFixed(3) };

  // 3) מילוי-ריבוני: SAOS נשלח-על-הספר-שלנו (פס-המשימות — transfer אוצר→לקוח, אפס-עמלה)
  const payAmt = 0.05; // SAOS
  const pfPath = path.join(__dirname, 'chaintalk_pending.json');
  const pf = JSON.parse(fs.readFileSync(pfPath, 'utf8'));
  pf.missions = pf.missions || [];
  const mid = 'pm94:' + nonce;
  pf.missions.push({ id: mid, status: 'pending', issuedAt: new Date().toISOString(), issuer: TREASURY, ops: [{ type: 'transfer', from: TREASURY, to: customer.username, amount: payAmt, ref: 'pm94:' + nonce }] });
  fs.writeFileSync(pfPath, JSON.stringify(pf, null, 2) + '\n');
  out.steps.fill = { carrier: 'SAOS-NET mission-bus', amount: payAmt + ' SAOS', mission: mid, steemMoved: '0.000' };

  // 4) קבלה-גלויה — custom_json (אפס-מטבע)
  const receiptPayload = { t: 'receipt', v: 94, order: nonce, qty, fill: mid, rate: out.pricing.rate };
  const c2 = await new Promise((resolve, reject) => {
    steem.broadcast.customJson(POSTING_WIF, [], [TREASURY], 'saos_pm', JSON.stringify(receiptPayload), (e, r) => (e ? reject(e) : resolve(r)));
  });
  out.steps.receipt = { txid: c2.id, carrier: 'custom_json', steemMoved: '0.000' };

  // 5) קבלה-מוצפנת — ECDH-blob בתוך custom_json (פרטיות בלי transfer)
  if ((ENV.MEMO_WIF || process.env.MEMO_WIF) && customer.keys.memo && customer.keys.memo.pub) {
    try {
      const enc = steem.memo.encode(ENV.MEMO_WIF || process.env.MEMO_WIF, customer.keys.memo.pub, '#' + JSON.stringify({ order: nonce, fill: mid, qty, rate: out.pricing.rate, ts: new Date().toISOString() }));
      const encPayload = { t: 'receipt-enc', v: 94, n: nonce, blob: enc };
      const c3 = await new Promise((resolve, reject) => {
        steem.broadcast.customJson(POSTING_WIF, [], [TREASURY], 'saos_pm', JSON.stringify(encPayload), (e, r) => (e ? reject(e) : resolve(r)));
      });
      const dec = steem.memo.decode(customer.keys.memo.wif, enc);
      out.steps.encryptedReceipt = { txid: c3.id, carrier: 'custom_json+ECDH', decryptedOk: dec.startsWith('#') && dec.includes(nonce), steemMoved: '0.000' };
    } catch (e) { out.steps.encryptedReceipt = { attempted: true, why: String((e && e.message) || e).slice(0, 90) }; }
  }
  fs.writeFileSync(path.join(__dirname, 'memo_biz_sov.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
  return out;
}

async function main() {
  const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
  const GATE = resolveLiveGate(process.argv);
  announceGate(GATE);
  const DRY = GATE.dry;
  const dryAbort = (what) => console.log('[DRY] LIVE-GATE — ' + what + ' broadcasts real ops — run with the live gate (see DAEMONS.md)');
  const mode = process.argv[2] || '--relay';
  if (mode === '--relay') { if (DRY) return dryAbort('relay demo'); return relayDemo(); }
  if (mode === '--fuel') return fuelCycle(DRY, (process.argv[process.argv.indexOf('--target') + 1] || null), (process.argv[process.argv.indexOf('--vests') + 1] || null));
  if (mode === '--memo-biz') { if (DRY) return dryAbort('memo-biz'); return memoBiz(); }
  if (mode === '--memo-biz-sov') { if (DRY) return dryAbort('memo-biz-sov'); return memoBizSov(); }
  if (mode === '--fuel-policy') {
    // הלולאה: תדלוק אוטומטי רק כשלקוח רעב והאוצר בריא
    const r = await fuelCycle(true);
    return { decided: r.client.rcBeforePct < 25 && r.treasury.rcPct > 50 ? 'fuel' : 'skip', r };
  }
  throw new Error('unknown mode ' + mode);
}

module.exports = { relayDemo, fuelCycle, memoBiz };
if (require.main === module) {
  main().then((r) => process.exit(0)).catch((e) => { console.error('paymaster fatal:', e.message); process.exit(1); });
}
