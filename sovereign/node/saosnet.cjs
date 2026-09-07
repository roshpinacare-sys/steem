#!/usr/bin/env node
/* saosnet.cjs — SAOS-NET v0 node (Task 68): הצומת של הרשת-שלנו.
 *
 * "לא להחליף את התצוגה עדיין — להכין את השטח בשלבים": זה הצומת.
 *   · --boot --live   ג'נזיס → 12 בלוקים (heartbeat-אימפריה) → צ'קפוינט
 *                     → עיגון-Steem (posting חינם-RC) + עיגון-Hive
 *                     (ראוטר-צי, RC-gated) → 3 הצהרות-ולידטור-חיילים
 *                     במפתחות-שלהם → אימות get_transaction → state.json
 *   · --beat --live   הארכת-שרשרת: בלוק-heartbeat חי → צ'קפוינט כל 12
 *                     → עיגון + הצהרות מסובבות → אימות-פתוחים
 *   · --selftest      וקטורי-הקרנל (determinism מוכח-רץ)
 *   · --show          סיכום-מצב
 *
 * עקרון: המצב של SAOS-NET הוא מתמטיקה מקומית (kernel.cjs); השרשראות
 * המארחות מחזיקות רק ראיות (stateRoot + attests). אין-מפתחות-כאן —
 * החתימה קוראת מ-.env/vault מקומי בלבד, לעולם לא נכתבת ללוג.
 */
'use strict';
const fs = require('fs');
const path = require('path');
// 84 — steem must resolve from ANY checkout shape: the sandbox has it via the
// project root, but a CLOUD checkout only installs agent/ deps → fall back to
// the agent's own node_modules (the drill that found it: cloud takeover run
// 33978041724, beat step MODULE_NOT_FOUND while the attest still landed).
let steem;
try { steem = require('steem'); } catch (_) { steem = require(path.join(__dirname, '..', '..', 'agent', 'node_modules', 'steem')); }
const K = require(path.join(__dirname, '..', 'core', 'kernel.cjs'));

const LIVE = process.argv.includes('--live');
const NODE_DIR = __dirname;
const STATE_FILE = path.join(NODE_DIR, 'state.json');
const CHAIN_FILE = path.join(NODE_DIR, 'chain.json');
const ARCHIVE_FILE = path.join(NODE_DIR, 'chain-archive.jsonl'); // 93 — הספר-המלא (append-only) — הראיה-המלאה ל-replay
const LOG = path.join(NODE_DIR, 'saosnet.log');
const GENESIS_FILE = path.join(__dirname, '..', 'genesis', 'genesis.json');
const AGENT_DIR = path.join(__dirname, '..', '..', 'agent');

const ACCOUNT = 'headcorner';
const NET = 'saos-net/0';
const CHECKPOINT_EVERY = 12;
// W2+93 — עיצוב-הארכיון: chain.json חלון-חם (512) ל-API בלבד; הראיה-המלאה
// ב-chain-archive.jsonl (append-only) — ה-replay (צומת·באצ'ר·API) קורא-מהארכיון.
const MAX_BLOCKS_KEPT = 512;
const STEEM_NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://steem.61bts.com'];
const HIVE_NODES = ['https://api.openhive.network', 'https://api.hive.blog'];
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const LOCAL_API = 'http://127.0.0.1:3000';
// חומות
const ATTESTS_PER_CHECKPOINT = 3;  // quorum v0
/* 112 — מדידה-חיה: cps יורדים כל-~2-4 דקות → ~720/cp-יום × 3 חתימות = ~2160
 * חתימות-נדרשות/יום. החומה-הישנה (3/חייל-יום) = 33 יכולת/יום → נשחקת-תוך-חצי-שעה
 * מה-UTC-יום (נמדד: 0 attests מ-00:33 עד 02:52 — quorum-pending(0/3) דלוק).
 * המתכונת-החדשה: 250/חייל-יום × 11 חיילים = 2750 יכולת ≥ 2160 דרוש (27% רזרבה),
 * ועדיין חומת-אנטי-ספאם אמת. עלות-ה-RC: ~1G/חייל/יום מול 85G מקסימום — שולית.
 * הדלק-עצמו (RC) נשאר-השער-האמיתי; החומה רק מונעת-הצפה (112). */
const ATTESTS_PER_SOLDIER_DAY = 250;
const LOCK_FILE = path.join(NODE_DIR, 'beat.lock'); // סריאליזציה: דמון+ידני לא רצים-במקביל (תגלית-69)
const LOCK_STALE_MS = 10 * 60 * 1000;
// W2 — WEAVE: בקשת-איטום-המרקל (כותב: agent/weave_batch.cjs · קורא+מוחק: הצומת-תחת-הנעילה)
const WEAVE_REQ_FILE = path.join(NODE_DIR, 'weave-request.json');

function readWeaveRequest() {
  try {
    const j = JSON.parse(fs.readFileSync(WEAVE_REQ_FILE, 'utf8'));
    if (j && j.action === 'seal-request' && /^[0-9a-f]{64}$/.test(String(j.root)) && Number.isInteger(Number(j.count))) return j;
  } catch (_) {}
  return null;
}
function clearWeaveRequest() { try { fs.unlinkSync(WEAVE_REQ_FILE); } catch (_) {} }

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const alive = (() => { try { process.kill(info.pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } })();
      if (alive && Date.now() - (info.at || 0) < LOCK_STALE_MS && info.pid !== process.pid) {
        return { ok: false, holder: info };
      }
      /* 98 — מנעול-תפוס-על-ידי-מת-כבר: אימות-חיות-pid (process.kill 0) — הרוג-מחזיק-מנעול
       * משוחרר-מיד (במקום-לחכות-10-דק' stale) — תקלת-הרצה-שנמדדה-חיה (GRID-98). */
      if (!alive) log('beat.lock: holder pid ' + info.pid + ' DEAD — stealing stale lock (liveness-verified)');
    }
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: Date.now() }));
    return { ok: true };
  } catch (_) { return { ok: true }; }
}
function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} }
/* 99 — GRID-99 lock-free network phases: פאזות-רשת-טהורות בפעימה לא-מחזיקות-מנעול —
 * המנוע-התושב (8ש' × 16-סבבים) מקבל-חלונות-אמת-במקום-רעב-מנעול (נמדד: +87-דילוגים/דק').
 * reacquireSpin: הפעימה-משיגה-בחזרה-בסבלנות-מוגבלת — כשל → הפעימה-נסגרת-בכבוד
 * (הרשומות-הרשתיות-יאומתו-בפעימה-הבאה — הכנות-לפני-שלמות-מצב). */
async function reacquireSpin(maxMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const lk = acquireLock();
    if (lk.ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
/* 99 — סנכרון-זנב אחרי-חלון-פתוח: המנוע-התושב עשוי-ליישם-בלוקים-בזמן-שהפעימה-בפאזת-רשת.
 * טוענים-מחדש-ארכיון+חלון (מיזוג-לפי-גובה — שיעור-96), מיישמים-רק-את-הזנב-מעל-הגובה-שלנו,
 * בודקים-המשכיות-hash (בלוק-הבא-חייב-להמשיך-את-הקודם) — מזלג → כשל-כנה. */
function catchUpTail(st, chainState) {
  try {
    const fresh = loadChain();
    const have = new Set(fresh.blocks.map((b) => b.height));
    const full = fresh.blocks.slice();
    try {
      const archLines = fs.readFileSync(ARCHIVE_FILE, 'utf8').trim().split('\n');
      for (let i = 1; i < archLines.length; i++) { try { const b = JSON.parse(archLines[i]); if (b && b.height && !have.has(b.height)) full.push(b); } catch (_) {} }
    } catch (_) {}
    /* 99b-heal: דה-דופ לפי גובה — כפילויות-ארכיון פנימיות היו מוחלות פעמיים ב-CATCH-UP */
    const seenC = new Set();
    const dedupC = [];
    for (const b of full) { if (seenC.has(b.height)) continue; seenC.add(b.height); dedupC.push(b); }
    dedupC.sort((a, b) => a.height - b.height);
    const known = new Set((chainState.blocks || []).map((b) => b.height));
    let applied = 0;
    for (const b of dedupC) {
      if (b.height <= st.meta.height) continue;
      if (b.prevHash && st.meta.lastBlockHash && b.prevHash !== st.meta.lastBlockHash) { log('catchUp FORK at h' + b.height + ' (prevHash mismatch) — honest abort'); return false; }
      if (!known.has(b.height)) { chainState.blocks.push(b); known.add(b.height); }
      for (const tx of (b.txs || [])) K.applyTx(st, tx);
      st.meta.height = b.height;
      st.meta.lastBlockHash = b.hash;
      applied++;
    }
    if (applied) log('beat CATCH-UP +' + applied + ' blocks → h' + st.meta.height + ' (GRID-99 open window)');
    return true;
  } catch (e) { log('catchUp err (honest): ' + String((e && e.message) || e).slice(0, 80)); return false; }
}
/* 99b — מגן-זנב-קובץ לאפנד-ארכיון: ה-TOCTOU שנמדד (1,249 שורות-כפולות) נבע
 * מ-archiveHeight נזכר-בזיכרון-פר-תהליך — מנוע שהופעל עם X מאפנד מחדש בלוקים
 * שהדמון כבר רשם עד Y. האמת היחידה: גובה-השורה-האחרונה בקובץ עצמו (מטמון-גודל). */
let _tailMemo = { size: -1, height: 0 };
function archiveTailHeight() {
  try {
    const stt = fs.statSync(ARCHIVE_FILE);
    if (_tailMemo.size === stt.size) return _tailMemo.height;
    const fd = fs.openSync(ARCHIVE_FILE, 'r');
    const len = Math.min(65536, stt.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, stt.size - len);
    fs.closeSync(fd);
    const ls = buf.toString('utf8').trim().split('\n');
    for (let i = ls.length - 1; i >= 0; i--) {
      try { const b = JSON.parse(ls[i]); if (b && b.height) { _tailMemo = { size: stt.size, height: b.height }; return b.height; } } catch (_) {}
    }
    return 0;
  } catch (_) { return 0; }
}
function appendTail(chainState, nodeSt) {
  try {
    const tailH = archiveTailHeight(); /* אמת-קובץ — לא-זיכרון-תהליך */
    const toAppend = (chainState.blocks || []).filter((b) => b && b.height > tailH).sort((a, b) => a.height - b.height);
    if (!toAppend.length) return 0;
    fs.appendFileSync(ARCHIVE_FILE, toAppend.map((b) => JSON.stringify(b)).join('\n') + '\n');
    nodeSt.archiveHeight = Math.max(nodeSt.archiveHeight || 0, toAppend[toAppend.length - 1].height);
    return toAppend.length;
  } catch (e) { log('appendTail err (honest): ' + String((e && e.message) || e).slice(0, 60)); return 0; }
}
/* 99 — חיוב-זנב-לדיסק לפני-חלון-פתוח: המנוע-מסנכרן-מהארכיון — בלי-זה-הוא-בונה-על-בסיס-ישן-ונוצר-מזלג */
function commitTail(nodeSt, chainState, kernelState) {
  try {
    appendTail(chainState, nodeSt); /* 99b: מגן-זנב-קובץ — אפס-כפילויות */
    /* 111 — כתיבה-אטומית-גם-כאן (הלקח-החי: הקוראים-קלטו-קובץ-בשחיקה-בין-שני-כותבים):
     * writeFileSync ישיר = truncate→write בלי-rename — קורא-באמצע-ראה-גרסה-שקועה. */
    const snapP = path.join(NODE_DIR, 'state-snapshot.json');
    const snapT = snapP + '.t.tmp';
    fs.writeFileSync(snapT, JSON.stringify({ height: kernelState.meta.height, lastBlockHash: kernelState.meta.lastBlockHash, at: new Date().toISOString(), st: kernelState }));
    fs.renameSync(snapT, snapP);
  } catch (e) { log('commitTail err (honest): ' + String((e && e.message) || e).slice(0, 60)); }
}
const RC_GATE_ATTEST = 40;         // % — שער-דלק לחייל-ולידטור
const RC_GATE_HEAD = 15;           // % — שער-דלק לעיגון-אוצר (posting זול)
const RC_GATE_HIVE = 20;           // % — שער-דלק-Hive לחייל-עוגן

function log(msg) {
  const line = '[' + new Date().toISOString() + '] saosnet: ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {}
}
const sha = (s) => require('crypto').createHash('sha256').update(s).digest('hex');

function loadDotEnv(dir) {
  const p = path.join(dir, '.env');
  const out = {};
  try {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
  return out;
}
const ENV = loadDotEnv(AGENT_DIR);

function loadArmyPosting() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'keys', 'vault.json'), 'utf8'));
    return (v.accounts || [])
      .filter((a) => a && a.username && String(a.username).toLowerCase() !== ACCOUNT)
      .map((a) => ({ username: String(a.username).toLowerCase(), postingWif: (a.keys && a.keys.posting && a.keys.posting.wif) || '' }))
      .filter((a) => a.postingWif);
  } catch (_) { return []; }
}

function rpcNode(node, method, params, timeout = 15000) {
  const payload = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  const u = new URL(node);
  return new Promise((resolve, reject) => {
    const req = require('https').request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message || 'rpc')); resolve(j.result); }
        catch (_) { reject(new Error('bad rpc')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    req.write(payload); req.end();
  });
}
const hiveRpcCall = (method, params) => rpcNode(HIVE_NODES[0], method, params, 20000);

async function rcPct(name, node = STEEM_NODES[0]) {
  try {
    const r = await rpcNode(node, 'rc_api.find_rc_accounts', { accounts: [name] });
    const row = r && r.rc_accounts && r.rc_accounts[0];
    if (!row) return 0;
    return (parseFloat(row.rc_manabar.current_mana) / parseFloat(row.max_rc)) * 100;
  } catch (_) { return 0; }
}
async function hiveRcPct(name) {
  try {
    const r = await hiveRpcCall('rc_api.find_rc_accounts', { accounts: [name] });
    const row = r && r.rc_accounts && r.rc_accounts[0];
    if (!row) return 0;
    return (parseFloat(row.rc_manabar.current_mana) / parseFloat(row.max_rc)) * 100;
  } catch (_) { return 0; }
}

/* TASK-89: קריאת-היסטוריית-saos-ops של-חייל-מהמארח-החי (keyless, read-back) —
 * הבסיס-לאימות-עוגני-hive-anchor שנשדרו-בלי-txid (עיכוב-אינדוקס-או-ניתוק-בזמן-שידור) */
async function hiveSaosHistory(account, limit = 1000) {
  const rows = await hiveRpcCall('condenser_api.get_account_history', [account, -1, limit]);
  const out = [];
  for (const row of rows || []) {
    const o = Array.isArray(row) ? row[1] : row;
    if (!o || !o.op || o.op[0] !== 'custom_json') continue;
    if (String((o.op[1] || {}).id || '') !== 'saos') continue;
    let pl;
    try { pl = JSON.parse(String(o.op[1].json || '{}')); } catch (_) { continue; }
    out.push({ trx: o.trx_id || null, block: o.block || null, payload: pl });
  }
  return out;
}

/* אימות-מחוזק: 5 ניסיונות × 3 צמתים × 8ש׳ (תגלית-66: get_transaction עצמו מפגר) */
async function verifyTxid(txid) {
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const node of STEEM_NODES) {
      try {
        const r = await rpcNode(node, 'condenser_api.get_transaction', [txid]);
        if (r && r.transaction_id) return { verified: true, node: new URL(node).hostname, block: r.block || null };
      } catch (_) {}
    }
    if (attempt < 4) await new Promise((res) => setTimeout(res, 8000));
  }
  return { verified: false, node: null, block: null };
}
async function verifyHiveTxid(txid) {
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const node of HIVE_NODES) {
      try {
        const r = await rpcNode(node, 'condenser_api.get_transaction', [txid], 20000);
        if (r && r.transaction_id) return { verified: true, node: new URL(node).hostname, block: r.block || null };
      } catch (_) {}
    }
    if (attempt < 4) await new Promise((res) => setTimeout(res, 8000));
  }
  return { verified: false, node: null, block: null };
}

/* ── פעולות-עיגון על השרשראות המארחות ── */
const netOp = (payload, signer) => ['custom_json', {
  required_auths: [], required_posting_auths: [signer], id: 'saos',
  json: JSON.stringify(Object.assign({ protocol: 'saos:net/v1', time: new Date().toISOString() }, payload)),
}];

async function anchorSteem(payload) {
  // ראש קודם — ואם-האוצר חנוק-דלק: ראוטר-צי (דוקטרינת-53: העיגון-מעולם-לא-נעצר)
  const anchorWith = async (signer, wif) => {
    const conf = await steem.broadcast.sendAsync({ operations: [netOp(Object.assign({}, payload, { anchor_writer: signer }), signer)], extensions: [] }, [wif]);
    return (conf && conf.id) || null;
  };
  const headWif = ENV.POSTING_WIF;
  if (headWif) {
    const rc = await rcPct(ACCOUNT);
    if (rc >= RC_GATE_HEAD) {
      try { return { txid: await anchorWith(ACCOUNT, headWif) }; }
      catch (e) { log('steem-anchor head FAIL: ' + String((e && e.message) || e).slice(0, 90)); }
    } else log('steem-anchor head RC ' + rc.toFixed(0) + '% < ' + RC_GATE_HEAD + '% → fleet fallback');
  }
  const army = loadArmyPosting();
  for (const s of army.slice(0, 4)) {
    const rc = await rcPct(s.username);
    if (rc < RC_GATE_ATTEST) continue;
    try { return { txid: await anchorWith(s.username, s.postingWif), by: s.username }; }
    catch (e) { log('steem-anchor @' + s.username + ' FAIL: ' + String((e && e.message) || e).slice(0, 90)); }
  }
  return { skip: 'no anchor-writer fuel (head+fleet)' };
}

async function anchorHiveViaFleet(payload) {
  const army = loadArmyPosting();
  if (!army.length) return { skip: 'no fleet keys' };
  // רוטציה-סבלנית: 3 מועמדים לפי RC-Hive
  const cand = [];
  for (const s of army) {
    const rc = await hiveRcPct(s.username);
    if (rc >= RC_GATE_HIVE) cand.push({ ...s, rc });
    if (cand.length >= 3) break;
  }
  for (const s of cand) {
    try {
      const dgp = await hiveRpcCall('condenser_api.get_dynamic_global_properties', []);
      const op = ['custom_json', { required_auths: [], required_posting_auths: [s.username], id: 'saos', json: JSON.stringify(Object.assign({ protocol: 'saos:net/v1', time: new Date().toISOString() }, payload, { anchor_writer: s.username })) }];
      const tx = {
        ref_block_num: dgp.head_block_number & 0xffff,
        ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
        expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
        operations: [op], extensions: [],
      };
      const prev = steem.config.get('chain_id');
      let signed;
      try { steem.config.set('chain_id', HIVE_CHAIN_ID); signed = steem.auth.signTransaction(tx, [s.postingWif]); }
      finally { steem.config.set('chain_id', prev); }
      await hiveRpcCall('condenser_api.broadcast_transaction', [signed]);
      return { txid: null, by: s.username, pending: true }; // txid מההיסטוריה-מאוחר (עיכוב-אינדוקס)
    } catch (e) { log('hive-anchor @' + s.username + ' FAIL: ' + String((e && e.message) || e).slice(0, 90)); }
  }
  return { skip: 'no fleet RC above ' + RC_GATE_HIVE + '%' };
}

async function soldierAttest(checkpointHash, height, stateRoot, nodeSt) {
  const army = loadArmyPosting();
  const day = new Date().toISOString().slice(0, 10);
  const budget = nodeSt.attestBudget = nodeSt.attestBudget || {};
  // ROTATION-71 (stage-3 groundwork): רוטציה-צודקת-דטרמיניסטית לפי-סבב —
  // סדר-ההצהרות נגזר-מהגובה (round = height/12) ולא מסדר-הצבא; מי-שנמצא-בתקציב/דלק
  // מדלג-בכנות, הרוטציה עצמה מוכחת-על-השרשרת (payload.round + ה-txids הציבוריים).
  const round = Math.floor(height / CHECKPOINT_EVERY);
  const off = army.length ? round % army.length : 0;
  const rotated = army.slice(off).concat(army.slice(0, off));
  const ordered = [];
  for (const s of rotated) {
    const used = (budget[day] && budget[day][s.username]) || 0;
    if (used >= ATTESTS_PER_SOLDIER_DAY) continue;
    ordered.push(s);
  }
  const fired = [];
  for (const s of ordered) {
    if (fired.length >= ATTESTS_PER_CHECKPOINT) break;
    const rc = await rcPct(s.username);
    if (rc < RC_GATE_ATTEST) { log('attest @' + s.username + ' skip RC ' + rc.toFixed(0) + '%'); continue; }
    const payload = { action: 'attest', net: NET, height, round, checkpointHash, stateRoot, validator: s.username };
    try {
      const conf = await steem.broadcast.sendAsync({ operations: [netOp(payload, s.username)], extensions: [] }, [s.postingWif]);
      const txid = (conf && conf.id) || null;
      fired.push({ validator: s.username, txid, verified: false });
      budget[day] = budget[day] || {}; budget[day][s.username] = (budget[day][s.username] || 0) + 1;
      log('attest ✓ @' + s.username + ' txid=' + txid);
      await new Promise((res) => setTimeout(res, 3400));
    } catch (e) { log('attest @' + s.username + ' FAIL: ' + String((e && e.message) || e).slice(0, 90)); }
  }
  return fired;
}

/* ── 112 — מילוי-אחורה של חתימות מהמארח (התרופה ל-GRID-99-ABORT-אחרי-שידור) ──
 * המדידה-החיה (112): הפעימה משדרת attests ל-STEEM (✓ txid ציבורי) ואז נופלת על
 * מגן-GRID-99 ("lock lost after verify phase" — 20 פעמים היום) בלי-saveAll —
 * הרשומות-מעולם-לא-נחתמות-ב-state.json. אבל-החתימות-עצמן פומביות-וקבועות-על-
 * המארח. הסריקה-הזאת קוראת-אותן-בחזרה (אותו-דפוס דו-מסלול של harvest-rail):
 * get_account_history לכל-חייל → custom_json action=attest → checkpointHash
 * מול-ה-checkpoints הידועים → backfill cp.attests עם-verified=true. כנות-מלאה:
 * זו-קריאה-של-ראיות-ציבוריות, לא-המצאה. dedupe ב-attestSeen-ring. */
async function backfillAttests(nodeSt) {
  const army = loadArmyPosting();
  if (!army.length) return 0;
  const known = new Map();
  for (const c of (nodeSt.checkpoints || []).slice(-64)) if (c.checkpointHash) known.set(c.checkpointHash, c);
  if (!known.size) return 0;
  const seen = nodeSt.attestSeen = nodeSt.attestSeen || {};
  let backfilled = 0;
  for (const s of army) {
    try {
      const hist = await rpcNode(STEEM_NODES[0], 'condenser_api.get_account_history', [s.username, -1, 250]);
      if (!hist) continue;
      for (const row of hist) {
        const op = row && row[1] && row[1].op;
        if (!op || op[0] !== 'custom_json' || op[1].id !== 'saos') continue;
        let pay = null;
        try { pay = JSON.parse(op[1].json); } catch (_) { continue; }
        if (!pay || pay.action !== 'attest' || pay.net !== NET || !pay.checkpointHash) continue;
        const txid = row[1].trx_id;
        if (!txid || seen[txid]) continue;
        seen[txid] = true;
        const cp = known.get(pay.checkpointHash);
        if (!cp) continue;
        cp.attests = cp.attests || [];
        if (cp.attests.some((a) => a.txid === txid)) continue;
        cp.attests.push({ by: pay.validator || s.username, txid, verified: true, node: 'backfill:host-history', backfilled: true });
        backfilled++;
        log('attest-BACKFILL ✓ @' + (pay.validator || s.username) + ' cp h' + cp.height + ' txid=' + txid + ' (ראיה-ציבורית-מהמארח)');
      }
    } catch (_) { continue; }
  }
  const keys = Object.keys(seen);
  if (keys.length > 512) for (const k of keys.slice(0, keys.length - 512)) delete seen[k];
  return backfilled;
}

/* ── STAGE-3 ROTATION (Task 72): ראשים-מתחלפים ──
 * ROSTER-72  — הרוסטר-הקנוני: שמות-החיילים ממוינים (חוק-נגזר-וניתן-לאימות).
 *              ה-digest שלו מפורסם-על-המארח (custom_json action=roster) ונושא
 *              בכל-publication-אקספלורר — צד-שלישי יכול לבדוק את-החוק.
 * PRODUCE-72 — החוק: producer(round) = roster[round mod |roster|],
 *              round = floor(height/12) — נגזר-מהשרשרת, לא מסדר-הצבא.
 *              המפיק-הממונה חותם custom_json (action=produce) על המארח
 *              במפתח-שלו (ראיה-חיה), והשרשרת-הריבונית רושמת op produce
 *              אחד-לסבב (אכיפת-קרנל: dup-round — אין שני ראשים לסבב).
 *              מנדט-שלא-הוכח (אין-מפתח / RC נמוך / שידור-נכשל) = פער-כן-
 *              מתועד — החוק-מעולם-לא-מופר, הסבב-הבא-מביא-ראש-חדש.
 */
const RC_GATE_PRODUCE = 40; // % — שער-דלק לראש-הסבב

function rosterForLaw() {
  return loadArmyPosting().map((s) => s.username).sort();
}
const rosterDigestOf = (roster) => sha(K.canon(roster));

function rotSt(nodeSt) {
  const rot = nodeSt.rot = nodeSt.rot || { rounds: {}, misses: 0, rosterDay: null, rosterPubs: [], roster: null, rosterDigest: null };
  for (const k of Object.keys(rot.rounds)) if (!rot.rounds[k] || Number(k) < (nodeSt.height || 0) / 12 - 48) delete rot.rounds[k];
  return rot;
}

/* ROSTER-72 — פרסום-הרוסטר (יומי-idempotent; כל-שינוי-הרכב = digest-חדש = פרסום-חדש) */
async function rosterPublish(nodeSt) {
  const rot = rotSt(nodeSt);
  const roster = rosterForLaw();
  if (!roster.length) return;
  const digest = rosterDigestOf(roster);
  rot.roster = roster; rot.rosterDigest = digest;
  const day = new Date().toISOString().slice(0, 10);
  if (rot.rosterDay === day && (rot.rosterPubs || []).some((p) => p.digest === digest && p.txid)) return;
  const payload = { action: 'roster', net: NET, roster, digest, time: new Date().toISOString() };
  const res = await anchorSteem(payload);
  if (res.txid) {
    rot.rosterPubs.push({ digest, txid: res.txid, by: res.by || ACCOUNT, verified: false, at: payload.time });
    rot.rosterPubs = rot.rosterPubs.slice(-8);
    rot.rosterDay = day;
    nodeSt.pendingVerifies.push({ txid: res.txid, kind: 'roster-pub', at: payload.time });
    log('roster-pub ✓ |roster|=' + roster.length + ' digest=' + digest.slice(0, 12) + ' txid=' + res.txid);
  } else log('roster-pub SKIP: ' + (res.skip || res.err || '?'));
}

/* PRODUCE-72 — מנדט-הפקה לסבב הנוכחי: החוק בוחר, המפיק חותם-על-המארח,
 * והצומת מחזיר את-הראיה להטמעה בבלוק-ה-heartbeat (אפס-מנדט → null כן). */
async function produceForRound(nodeSt, st, nextHeight) {
  const rot = rotSt(nodeSt);
  const r = Math.floor(nextHeight / CHECKPOINT_EVERY);
  if (st.producers && st.producers[r]) return null;          // כבר-מופק — אכיפת-קרנל
  if (rot.rounds[r]) return null;                            // הסבב-כבר-נוסה (הצלחה/פער)
  const roster = rosterForLaw();
  if (!roster.length) { log('produce r' + r + ' MISS: no-roster'); return null; }
  const mandated = roster[r % roster.length];                // החוק (§12)
  const army = loadArmyPosting();
  const s = army.find((a) => a.username === mandated);
  if (!s) { rot.rounds[r] = { round: r, producer: mandated, height: nextHeight, ref: null, hostTxid: null, verified: false, miss: 'no-key' }; rot.misses++; log('produce r' + r + ' MISS @' + mandated + ' (no-key)'); return null; }
  const rc = await rcPct(s.username);
  if (rc < RC_GATE_PRODUCE) { rot.rounds[r] = { round: r, producer: mandated, height: nextHeight, ref: null, hostTxid: null, verified: false, miss: 'rc-low' }; rot.misses++; log('produce r' + r + ' MISS @' + mandated + ' RC ' + rc.toFixed(0) + '%'); return null; }
  const payload = { action: 'produce', net: NET, round: r, height: nextHeight, producer: mandated, genesisHash: nodeSt.genesisHash, time: new Date().toISOString() };
  try {
    const conf = await steem.broadcast.sendAsync({ operations: [netOp(payload, s.username)], extensions: [] }, [s.postingWif]);
    const txid = (conf && conf.id) || null;
    log('produce ✓ r' + r + ' head=@' + mandated + ' txid=' + txid);
    return { round: r, producer: mandated, height: nextHeight, ref: 'prc:' + r + ':' + (txid || 'pending'), hostTxid: txid };
  } catch (e) {
    rot.rounds[r] = { round: r, producer: mandated, height: nextHeight, ref: null, hostTxid: null, verified: false, miss: 'broadcast-fail' };
    rot.misses++;
    log('produce r' + r + ' @' + mandated + ' FAIL: ' + String((e && e.message) || e).slice(0, 90));
    return null;
  }
}

/* ── מדדי-אימפריה חיים → heartbeat ── */
async function empireDigest() {
  const parts = [];
  try { const d = await (await fetch(LOCAL_API + '/api/ops/sovereign/microdex', { signal: AbortSignal.timeout(20000) })).json(); if (d.state) parts.push('dex-ops=' + d.state.opsToday + '/' + Object.keys(d.state.bySoldier || {}).length + 'soldiers'); } catch (_) {}
  try { const w = await (await fetch(LOCAL_API + '/api/ops/saos/wrapped?username=' + ACCOUNT, { signal: AbortSignal.timeout(30000) })).json(); if (w.fees) parts.push('fees=' + w.fees.totalCaptured + 'STEEM'); } catch (_) {}
  try { const m = await (await fetch(LOCAL_API + '/api/ops/sovereign/case66', { signal: AbortSignal.timeout(20000) })).json(); if (m.commerce) parts.push('sales=' + (m.commerce.sales || 0) + '/rev=' + (m.commerce.revenue || 0)); } catch (_) {}
  if (!parts.length) parts.push('metrics-unavailable');
  return ('h:' + parts.join(' · ')).slice(0, 160);
}

/* ── מצב-צומת ── */
function loadNodeState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) {
    return { netVersion: NET, genesisHash: null, height: 0, stateRoot: null, lastBlockHash: null, beats: 0, checkpoints: [], pendingVerifies: [], verified: [], attestBudget: {}, updatedAt: null };
  }
}
function loadChain() {
  try { return JSON.parse(fs.readFileSync(CHAIN_FILE, 'utf8')); } catch (_) { return { blocks: [], truncated: false }; }
}
function saveAll(st, chainState, kernelState) {
  st.height = kernelState.meta.height;
  st.stateRoot = K.stateRoot(kernelState);
  st.lastBlockHash = kernelState.meta.lastBlockHash || null;
  st.beats = (st.beats || 0) + 1;
  st.updatedAt = new Date().toISOString();
  // STAGE-2 (70): תמצית-הספר-הריבוני לתצוגה (הצומת = הסמכות; ה-API מציג בלבד)
  const liveO = (kernelState.orders || []).filter((o) => o.live);
  st.book = {
    asks: liveO.filter((o) => o.side === 'sell').sort((a, b) => a.price - b.price || a.id - b.id).slice(0, 6).map((o) => ({ id: o.id, owner: o.owner, amount: o.amount / 1000, price: o.price / 1e6 })),
    bids: liveO.filter((o) => o.side === 'buy').sort((a, b) => b.price - a.price || a.id - b.id).slice(0, 6).map((o) => ({ id: o.id, owner: o.owner, amount: o.amount / 1000, price: o.price / 1e6 })),
    trades: kernelState.meta.trades || 0,
    lastPrice: kernelState.meta.lastPrice ? kernelState.meta.lastPrice / 1e6 : null,
    feesµ: (kernelState.fees && kernelState.fees.total) || 0,
    yieldSAOS: (kernelState.meta.yieldTotal || 0) / 1000,
    boundarySteem: ((kernelState.accounts.host || {}).steem || 0) / 1000,
    floatAccounts: Object.entries(kernelState.accounts).filter(([n, a]) => n !== 'host' && (a.saos > 0 || a.steem > 0)).length,
  };
  // 94 — תמצית-נגזרות-עטופות (מוצרי-הדקס): supply/locked ביחידות-מלאות — WTRX = ערך-TRON על-הרשת-שלנו
  // 117 — דיוק-פר-סמל: חלוקה-לפי-bookScale-של-הסמל (µ=1000 מורשת · ננו=1e9 למטבעות-רשת-אמת)
  st.wrappedSummary = Object.fromEntries(
    Object.entries(kernelState.wrapped || {}).map(([sym, w]) => {
      const m = (kernelState.assetMeta || {})[sym];
      const scale = (m && Number.isInteger(m.bookScale) && m.bookScale >= 1) ? m.bookScale : 1000;
      return [sym, { supply: (w.supply || 0) / scale, locked: (w.locked || 0) / scale, holders: Object.values(kernelState.accounts).filter((a) => a.wrapped && a.wrapped[sym] > 0).length }];
    })
  );
  // 95 — תמצית-האצלות (חיבור-כולם לראש @headcorner בלי-לגעת-במפתחות-ראשיים)
  st.delegationsSummary = kernelState.delegations
    ? Object.fromEntries(Object.entries(kernelState.delegations).map(([k, v]) => [k, { scopes: v.scopes, ref: v.ref }]))
    : null;
  // 96 — כלכלת-טרון-העטופה: רישומי-מטבעות (חוזה-אם מאומת) + ציטוטי-מחיר (src+ref חתום)
  st.assetMetaSummary = kernelState.assetMeta || null;
  st.assetPricesSummary = kernelState.assetPrices || null;
  // 97 — מחזיקי-WTRX פר-חשבון (הצי סוחר-על-בריכת-הגשר — המידה-מגיעה-לmicrodex)
  st.wrappedHolders = Object.fromEntries(
    Object.entries(kernelState.accounts)
      .filter(([, a]) => a.wrapped && a.wrapped.WTRX > 0)
      .map(([n, a]) => [n, a.wrapped.WTRX / 1000])
  );
  // 97 — יתרות-צף-ריבוניות פר-חשבון (saos+steem פנויים) — החיילים מתכננים-sfill
  // מול-סולם-האוצר בלי-לבזות-RC על-כשלונות (הקרנל אוכף — המידה מקדימה)
  st.floatBalances = Object.fromEntries(
    Object.entries(kernelState.accounts)
      .filter(([n, a]) => n !== 'host' && (a.saos > 0 || a.steem > 0))
      .map(([n, a]) => [n, { saos: a.saos / 1000, steem: a.steem / 1000 }])
  );
  /* 93 — ארכיון-הספר המלא: chain.json הוא חלון-חם (MAX_BLOCKS_KEPT) ל-API בלבד;
   * הראיה-המלאה-מג'נזיס חיה בארכיון append-only — אף-בלוק-לא-נאבד עוד. */
  try {
    const archH = st.archiveHeight || 0;
    const toAppend = (chainState.blocks || []).filter((b) => b && b.height > archH).sort((a, b) => a.height - b.height);
    if (toAppend.length) {
      if (toAppend[0].height !== archH + 1) log('ARCHIVE GAP: expected h' + (archH + 1) + ' got h' + toAppend[0].height + ' (honest — window slid past unarchived blocks)');
      fs.appendFileSync(ARCHIVE_FILE, toAppend.map((b) => JSON.stringify(b)).join('\n') + '\n');
      st.archiveHeight = toAppend[toAppend.length - 1].height;
    }
  } catch (e) { log('archive append failed (honest): ' + String((e && e.message) || e).slice(0, 80)); }
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
  /* 98 — snapshot-תושב לפעימה-הבאה (replay-מצטבר): המצב-בסוף-הפעימה + גובה + hash.
   * נכתב-אחרי-state.json — אם-הכתיבה-נכשלת, הפעימה-הבאה עושה replay-מלא (כנות).
   * 106 — כתיבה-אטומית (tmp+rename) + גיבוי-קודם (prev): תהליך-שנהרג-באמצע-כתיבה
   * (קריסת-ה-20:05 היום) לא-ישחית-את-ה-snapshot-הטוב-היחיד — זו-הייתה-שער-האמנזיה:
   * snapshot-שחות → replay-מהג'נזיס → דחיות-ops-אחרי-פערי-הארכיון → מצב-רפאים
   * נכתב-חזרה-כ-snapshot. שרשרת-ההחזרה-המלאה (root→snapshot→prev→replay) ב-beat. */
  try {
    const snapPath = path.join(NODE_DIR, 'state-snapshot.json');
    const snapPrev = path.join(NODE_DIR, 'state-snapshot.prev.json');
    const snapTmp = snapPath + '.tmp';
    try { if (fs.existsSync(snapPath)) fs.copyFileSync(snapPath, snapPrev); } catch (_) {}
    fs.writeFileSync(snapTmp, JSON.stringify({ height: kernelState.meta.height, lastBlockHash: kernelState.meta.lastBlockHash, at: new Date().toISOString(), st: kernelState }));
    fs.renameSync(snapTmp, snapPath);
  } catch (_) {}
  if (chainState.blocks.length > MAX_BLOCKS_KEPT) { chainState.blocks = chainState.blocks.slice(-MAX_BLOCKS_KEPT); chainState.truncated = true; }
  fs.writeFileSync(CHAIN_FILE, JSON.stringify(chainState));
}

/* ── CHAINTALK-94: פס-המשימות — שפת-התקשורת בין-הרשתות ──
 * המשימה (agent/chaintalk_pending.json) מכריזה-מראש על-הפעולות-ועל-התגובה-הצפויה;
 * הספר מבצע-ומודד — התוצאה נכתבת-בחזרה לקובץ (applied/err פר-op + גובה).
 * מגנים: רק-המנפיק יכול wrap_mint/transfer/order מהאוצר · עד 12 ops למשימה ·
 * משימה-אחת-לפעימה · refs-ייחודיים (dedup מול-הספר) · סוגים-מותרים בלבד. */
/* 99 — DEX-98-ops על אוטובוס-המשימות: pool_xAdd/pool_xRm (שער-בעלות: רק-האוצר) —
 * זריעת-בריכות-חד-פעמית ואיזון-הון דרך-הספר, בלי-לעקוף-את-הקרנל ובלי-refs-כפולים. */
const MISSION_TYPES = new Set(['wrap_mint', 'wrap_burn', 'wrap_cover', 'wrap_release', 'delegate', 'transfer', 'pay', 'order', 'cancel', 'asset_list', 'asset_price', 'pool_add', 'pool_swap', 'transfer_w', 'pool_addw', 'pool_swapw', 'pool_xAdd', 'pool_xRm', 'pool_rmw']);
/* 105 — השוואת-ערכים-קנונית ל-op (בלי-ref/מטא-זמן): ref מזהה-מופע; הערכים הם-הראיה.
 * שימוש: סימון-already-applied מותנה-בערכים-שווים — השקר-השקט של
 * "already-applied — the book is the truth" על-ref-שקיים-עם-תוכן-אחר — בלתי-אפשרי. */
function opValuesCanon(op) {
  const skip = new Set(['ref', 'at', 'time', 'sig', 'note']);
  const flat = {};
  for (const k of Object.keys(op || {}).sort()) {
    if (skip.has(k)) continue;
    const v = op[k];
    flat[k] = v && typeof v === 'object' ? JSON.stringify(v) : v;
  }
  return JSON.stringify(flat);
}
function collectMissionTxs(seenRefs, bookOpByRef) {
  const out = { id: null, txs: [], mission: null };
  let pf;
  const pfPath = path.join(AGENT_DIR, 'chaintalk_pending.json');
  try { pf = JSON.parse(fs.readFileSync(pfPath, 'utf8')); } catch (e) { log('mission-bus: pending file unreadable (honest): ' + String((e && e.message) || e).slice(0, 60)); return out; }
  const markMission = (m, patch) => {
    try {
      Object.assign(m, patch);
      const cur = JSON.parse(fs.readFileSync(pfPath, 'utf8'));
      const idx = (cur.missions || []).findIndex((x) => x.id === m.id);
      if (idx >= 0) cur.missions[idx] = m;
      fs.writeFileSync(pfPath, JSON.stringify(cur, null, 2) + '\n');
    } catch (_) {}
  };
  // 94-לקח (תבנית LIVE-DEDUP): הספר-החי הוא-האמת — משימה-שכל-ה-refs-שלה-כבר-על-הספר
  // מסומנת already-applied (לא נתקעת pending וחוסמת-את-התור); הראייה = הספר עצמו.
  for (const m of (pf.missions || []).filter((x) => x && x.status === 'pending' && Array.isArray(x.ops))) {
    if (!m.ops.length) { markMission(m, { status: 'rejected', error: 'empty-ops' }); continue; }
    if (m.ops.length > 12) { markMission(m, { status: 'rejected', error: 'too-many-ops (>12)' }); continue; }
    const txs = [];
    for (const op of m.ops) {
      if (!op || !MISSION_TYPES.has(op.type)) continue;
      if (op.type === 'wrap_mint' && String(op.issuer || '').toLowerCase() !== ACCOUNT) continue;
      if (op.type === 'wrap_cover' && String(op.issuer || '').toLowerCase() !== ACCOUNT) continue;
      if (op.type === 'wrap_release' && String(op.issuer || '').toLowerCase() !== ACCOUNT) continue; /* 99b — שחרור-נעולים: מנפיק-בלבד */
      if (op.type === 'delegate' && String(op.issuer || '').toLowerCase() !== ACCOUNT) continue;
      if (op.type === 'asset_list' && String(op.issuer || '').toLowerCase() !== ACCOUNT) continue;
      if (op.type === 'asset_price' && String(op.issuer || '').toLowerCase() !== ACCOUNT) continue;
      if (['transfer', 'pay', 'order', 'cancel'].includes(op.type) && String((op.from || op.owner) || '').toLowerCase() !== ACCOUNT) continue;
      if (op.type === 'pool_add' && String(op.owner || '').toLowerCase() !== ACCOUNT) continue;
      if (op.type === 'pool_xAdd' && String(op.owner || '').toLowerCase() !== ACCOUNT) continue;
      if (op.type === 'pool_xRm' && String(op.owner || '').toLowerCase() !== ACCOUNT) continue;
      if (op.type === 'pool_rmw' && String(op.owner || '').toLowerCase() !== ACCOUNT) continue; /* 102 — בריכת-הגשר: אותו-שער-בעלות */
      if (op.type === 'pool_swap' && String(op.taker || '').toLowerCase() !== ACCOUNT) continue;
      const ref = String(op.ref || '');
      if (!ref || seenRefs.has(ref)) continue;
      seenRefs.add(ref);
      txs.push(op);
    }
    if (!txs.length) {
      const eligible = m.ops.filter((op) => op && MISSION_TYPES.has(op.type));
      /* 105 — LIVE-DEDUP מודע-ערכים: ref-על-הספר + ערכים-שווים = already-applied אמת;
       * ref-על-הספר + ערכים-שונים = ref-conflict (כנה) — לא שקר-שקט; לעולם לא ניישם כפול. */
      const conflict = eligible.some((op) => {
        const ref = String(op.ref || '');
        const onBook = ref && bookOpByRef ? bookOpByRef.get(ref) : null;
        return !!onBook && opValuesCanon(onBook) !== opValuesCanon(op);
      });
      if (conflict) markMission(m, { status: 'ref-conflict', note: 'ref exists on the book with DIFFERENT values — refused to claim already-applied (LIVE-DEDUP values-aware 105)' });
      else markMission(m, eligible.length
        ? { status: 'already-applied', note: 'all refs on the book with equal values (LIVE-DEDUP values-aware — the book is the truth)' }
        : { status: 'rejected', error: 'no-eligible-ops-after-type-guard (honest — the mission rail refuses silent drops)' });
      continue;
    }
    out.id = m.id; out.mission = m; out.txs = txs.slice(0, 12);
    return out;
  }
  return out;
}

/* ── זרימה ראשית ── */
async function boot() {
  log('=== SAOS-NET BOOT · ' + (LIVE ? 'LIVE' : 'DRY') + ' ===');
  if (!fs.existsSync(GENESIS_FILE)) throw new Error('genesis.json missing — run derive-genesis.cjs --live first');
  const genesis = JSON.parse(fs.readFileSync(GENESIS_FILE, 'utf8'));
  const st = K.initFromGenesis(genesis);
  st.meta.issuer = ACCOUNT; // האוצר-החי הוא המנפיק
  const chainState = { blocks: [], truncated: false };
  const nodeSt = loadNodeState();
  nodeSt.genesisHash = genesis.genesisHash;
  /* 93 — סנכרון-ארכיון: גובה-הארכיון הוא-האמת — מונע-אפנד-כפול אחרי-הפעלה-מחדש */
  try {
    const archLines = fs.readFileSync(ARCHIVE_FILE, 'utf8').trim().split('\n');
    for (let i = archLines.length - 1; i >= 0; i--) {
      try { const ab = JSON.parse(archLines[i]); if (ab && ab.height) { nodeSt.archiveHeight = Math.max(nodeSt.archiveHeight || 0, ab.height); break; } } catch (_) { /* שורה-פגומה */ }
    }
  } catch (_) { /* אין-ארכיון-עדיין — ייווצר-ב-saveAll */ }
  log('genesis: ' + genesis.genesisHash.slice(0, 16) + '… · height=' + st.meta.height + ' · supply=' + st.meta.supply / 1000 + ' SAOS');

  // 12 בלוקים של heartbeat — האימפריה נושמת לתוך השרשרת-שלנו
  const digest = await empireDigest();
  const time = new Date().toISOString();
  for (let i = 0; i < CHECKPOINT_EVERY; i++) {
    const { block } = K.buildBlock(st, [{ type: 'heartbeat', note: digest + ' · b' + (i + 1) }], time);
    chainState.blocks.push(block);
  }
  log('blocks 1..' + CHECKPOINT_EVERY + ' built · heartbeat=' + digest.slice(0, 60));

  // צ'קפוינט 12
  const cpRoot = K.stateRoot(st);
  const cp = K.buildCheckpoint(st, ACCOUNT, {});
  const checkpointHash = sha(K.canon({ height: cp.height, blockHash: cp.blockHash, stateRoot: cp.stateRoot }));
  cp.checkpointHash = checkpointHash;
  log('checkpoint @' + cp.height + ' stateRoot=' + cp.stateRoot.slice(0, 16) + '…');

  // הצהרות-חיילים (על-המארח, במפתחות-שלהם) — לפני-הצ'קפוינט-שבמצב (ה-attest-ops ייכנסו בבלוקים-הבאים)
  let attests = [];
  if (LIVE) {
    attests = await soldierAttest(checkpointHash, cp.height, cp.stateRoot, nodeSt);
    // עיגון-Steem
    const anchorPayload = { action: 'checkpoint', net: NET, height: cp.height, blockHash: cp.blockHash, stateRoot: cp.stateRoot, genesisHash: genesis.genesisHash, checkpointHash, quorum: { required: cp.quorum.required }, time };
    const aS = await anchorSteem(anchorPayload);
    if (aS.txid) { cp.anchors.steem = aS.txid; nodeSt.pendingVerifies.push({ txid: aS.txid, kind: 'steem-anchor', at: new Date().toISOString() }); log('steem-anchor ✓ txid=' + aS.txid); }
    else log('steem-anchor SKIP/ERR: ' + (aS.skip || aS.err || '?'));
    // עיגון-Hive (ראוטר-צי)
    const aH = await anchorHiveViaFleet(anchorPayload);
    if (aH.by) { cp.anchors.hive = 'pending:' + aH.by; nodeSt.pendingVerifies.push({ txid: null, kind: 'hive-anchor', by: aH.by, time: payloadTime(anchorPayload), at: new Date().toISOString() }); log('hive-anchor ✓ via @' + aH.by + ' (pending-index)'); }
    else log('hive-anchor SKIP: ' + (aH.skip || aH.err || '?'));
  }

  // attest-ops נכנסים לשרשרת-הריבונית (מראה של ההצהרות-החתומות-על-המארח)
  const t2 = new Date().toISOString();
  for (const a of attests) {
    const { block } = K.buildBlock(st, [{ type: 'attest', validator: a.validator, checkpointHash, time: t2 }], t2);
    chainState.blocks.push(block);
  }
  st.checkpoints.push(cp);
  nodeSt.checkpoints.push({ height: cp.height, stateRoot: cp.stateRoot, checkpointHash, anchors: cp.anchors, attests: attests.map((a) => ({ by: a.validator, txid: a.txid, verified: a.verified })), at: new Date().toISOString() });
  nodeSt.checkpoints = nodeSt.checkpoints.filter((c, i, arr) => i === arr.length - 1 || arr[i + 1].height !== c.height);
  if (nodeSt.checkpoints.length > 64) nodeSt.checkpoints = nodeSt.checkpoints.slice(-64);

  // אימות-פתוחים (anchor-Steem + attests)
  if (LIVE) {
    for (const a of attests) if (a.txid) { const v = await verifyTxid(a.txid); a.verified = v.verified; a.node = v.node; if (v.verified) nodeSt.verified.push(a.txid); else nodeSt.pendingVerifies.push({ txid: a.txid, kind: 'attest', by: a.validator, at: new Date().toISOString() }); }
    const cpRec = nodeSt.checkpoints[nodeSt.checkpoints.length - 1];
    if (cpRec && cpRec.height === cp.height) cpRec.attests = attests.map((a) => ({ by: a.validator, txid: a.txid, verified: a.verified }));
    const pend = [];
    for (const p of nodeSt.pendingVerifies) {
      if (p.txid && p.kind === 'steem-anchor') { const v = await verifyTxid(p.txid); p.verified = v.verified; p.node = v.node; p.block = v.block; if (v.verified) { log('steem-anchor VERIFIED blk=' + v.block + ' @' + v.node); nodeSt.verified.push(p.txid); continue; } }
      pend.push(p);
    }
    nodeSt.pendingVerifies = pend.slice(-16);
  }

  saveAll(nodeSt, chainState, st);
  log('BOOT DONE · height=' + st.meta.height + ' · stateRoot=' + K.stateRoot(st).slice(0, 16) + '… · attests=' + attests.filter((a) => a.verified).length + '/' + attests.length + ' verified');
}

function payloadTime(payload) { return payload && payload.time ? payload.time : null; }

/* ── MIRROR-69: אירועי-אימפריה אמיתיים → טרנזאקציות-ריבוניות ──
 * מקורות: merchant_state (מכירות) · yield_state (תשואות) · microdex_state
 * (pool_add/pool_swap — הסמנטיקה-החד-משמעית). orders/fills לא-מומרים ב-v0
 * (כיוון-ההזמנה-לא-נגזר-מהמחרוזת — כנות-מתועדת במפרט §10). cursors
 * שמורים ב-state.json (השרשרת-הריבונית-עצמה היא-הפנקס: אם-ה-tx-כבר-בבלוק,
 * re-apply-שלו-יזוהה-ע"י-ref-דה-דופ-בסריקה). תקרה 8-mirrors/פעימה.
 */
function collectMirrorTxs(nodeSt, existingRefs) {
  const cur = nodeSt.mirrorCursors = nodeSt.mirrorCursors || { sales: [], yields: [], microdex: [] };
  for (const k of Object.keys(cur)) if (Array.isArray(cur[k])) cur[k] = cur[k].slice(-64);
  const txs = [];
  const counts = { sales: 0, yields: 0, poolAdds: 0, poolSwaps: 0, skipped: 0 };
  const seenRef = new Set();
  const push = (tx, kind, key) => {
    if (seenRef.has(tx.ref) || existingRefs.has(tx.ref)) return; // הפנקס-הכפול: cursors + השרשרת-עצמה
    seenRef.add(tx.ref);
    cur[kind] = cur[kind] || [];
    cur[kind].push(key);
    txs.push(tx);
  };
  try {
    const m = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'merchant_state.json'), 'utf8'));
    for (const s of m.sales || []) {
      if (!s.txid || !s.buyer || !(s.qty > 0)) continue;
      if ((cur.sales || []).includes(s.txid)) continue;
      push({ type: 'transfer', from: ACCOUNT, to: String(s.buyer).toLowerCase(), amount: s.qty, ref: s.txid, mirror: 'sale' }, 'sales', s.txid);
      push({ type: 'steemPay', from: 'host', to: ACCOUNT, amount: s.sent, ref: s.txid + ':pay', mirror: 'sale-revenue' }, 'sales', s.txid + ':pay');
      counts.sales++;
    }
  } catch (_) {}
  try {
    const y = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'yield_state.json'), 'utf8'));
    for (const [acc, p] of Object.entries(y.paid || {})) {
      if (!p || !p.txid || !(p.amt > 0)) continue;
      const key = String(p.txid);
      if ((cur.yields || []).includes(key)) continue;
      push({ type: 'steemPay', from: ACCOUNT, to: 'host', amount: p.amt, ref: key, mirror: 'yield' }, 'yields', key);
      counts.yields++;
    }
  } catch (_) {}
  try {
    const x = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'microdex_state.json'), 'utf8'));
    for (const t of x.txids || []) {
      if (!t.txid || !t.by || !t.why) continue;
      if ((cur.microdex || []).includes(t.txid)) continue;
      const by = String(t.by).toLowerCase();
      let mAdd = String(t.why).match(/^pool_add ([0-9.]+) SAOS/);
      let mSwap = String(t.why).match(/^pool_swap ([0-9.]+) SAOS/);
      // 97 — sfill: חייל ממלא-ישירות הזמנת-סולם-אוצר על-הספר-הריבוני
      // (זהות=חתימת-החייל-על-המארח · הקרנל אוכף: self-trade/יתרות/גבהים)
      let mSFill = String(t.why).match(/^sfill ([0-9.]+) @([0-9.]+) ← headcorner #(\d+)/);
      // 97 — בריכת-הגשר: חיילים סוחרים WTRX↔SAOS (הקרנל אוכף-יתרות — not-holder כנה)
      let mSwapW = String(t.why).match(/^pool_swapw ([0-9.]+) WTRX→SAOS/);
      let mSwapB = String(t.why).match(/^pool_swapw ([0-9.]+) SAOS→WTRX/);
      if (mSFill) {
        push({ type: 'fill', taker: by, orderId: parseInt(mSFill[3], 10), amount: parseFloat(mSFill[1]), ref: t.txid, mirror: 'sovereign-fill' }, 'microdex', t.txid);
        counts.sovereignFills = (counts.sovereignFills || 0) + 1;
      } else if (mAdd) {
        push({ type: 'pool_add', owner: by, amountSaos: parseFloat(mAdd[1]), amountSteem: 0, ref: t.txid, mirror: 'pool_add' }, 'microdex', t.txid);
        counts.poolAdds++;
      } else if (mSwap) {
        push({ type: 'pool_swap', taker: by, side: 'sell_saos', inAmt: parseFloat(mSwap[1]), ref: t.txid, mirror: 'pool_swap' }, 'microdex', t.txid);
        counts.poolSwaps++;
      } else if (mSwapW) {
        push({ type: 'pool_swapw', taker: by, side: 'sell_wtrx', inAmt: parseFloat(mSwapW[1]), ref: t.txid, mirror: 'pool_swapw' }, 'microdex', t.txid);
        counts.poolSwapsW = (counts.poolSwapsW || 0) + 1;
      } else if (mSwapB) {
        push({ type: 'pool_swapw', taker: by, side: 'buy_wtrx', inAmt: parseFloat(mSwapB[1]), ref: t.txid, mirror: 'pool_swapw' }, 'microdex', t.txid);
        counts.poolSwapsW = (counts.poolSwapsW || 0) + 1;
      } else counts.skipped++;
    }
  } catch (_) {}
  return { txs: txs.slice(0, 8), counts, overflow: txs.length > 8 };
}

/* ── STAGE-2 ECONOMY (Task 70): הרשת-הריבונית מארחת-כלכלה, לא רק מראה ──
 * SOVFLO-70  — הצפת-חיילים: יתרות-מארח-מדודות (dex-ledger + STEEM נזיל-חי)
 *              נפתחות-כחשבונות-עבודה-ריבוניים. refs flo:/fls:<acct>:<day> — idempotent-יומי.
 *              steemPay-מ-'host' — חשבון-הגבול נכנס-שלילי (בכוונה: זה-הסמן-של-הזרימה).
 * SOVBOOK-70 — הפרק-המלא של §9-b: order-buy/order-sell/fill שהחיילים חתמו-על-המארח
 *              עכשיו מומרים ל-order/fill ריבוניים (סמכות-החייל מוכחת-txid-מארח;
 *              ביצוע-דטרמיניסטי-בקרנל) + שאלת-עומק-עומדת-של-האוצר מתומחרת-מהמארח
 *              (standing-ask @lastPrice×1.003, ממוחזרת-בסטיה->2%) + מנוע-התאמה
 *              ריבוני (cancel-שחרור → fill — שיפור-מחיר-ל-taker).
 * SOVYIELD-70 — תשואה-ריבונית-יומית ממומנת-עמלות-השרשרת-הריבונית-עצמה
 *              (fees.toTreasury) → מחולקת-למחזיקי-LP לפי-מניות. dup-day-קרנל.
 */
const ECON_CAPS = { floatsPerBeat: 10, ordersPerBeat: 10, fillsPerBeat: 8, matchPairsPerBeat: 8, askAmt: 0.25, askPremium: 1.003, askRecycle: 0.02, fillTol: 0.01, yieldCapµ: 20,
  /* GRID-97 — מנוע-הגריד-הרווחי: סולם-אוצר + ארביטראז ספר↔בריכה + בריכת-גשר */
  ladderLevels: 3, ladderAmt: 0.25, ladderStepBps: 40, ladderRecycleBps: 15,
  arbGapBps: 150, arbMaxSaos: 2, poolSwapMinOut: 1 };

const sovDay = () => new Date().toISOString().slice(0, 10);

/* ראיות-מארח-חיות: יתרות-dex (saos+locked) · מחיר-אחרון (trades[0]) · STEEM נזיל-חי */
async function hostEvidence() {
  const out = { balances: [], lastPrice: null, steem: {} };
  try {
    const d = await (await fetch(LOCAL_API + '/api/ops/saos/dex', { signal: AbortSignal.timeout(20000) })).json();
    out.balances = (d.balances || []).map((b) => ({ account: String(b.account || '').toLowerCase(), saos: Number(b.saos) || 0, locked: Number(b.locked) || 0 }));
    const tr = d.trades || [];
    if (tr.length && Number(tr[0].price) > 0) out.lastPrice = Number(tr[0].price);
  } catch (_) {}
  const names = [...new Set(out.balances.map((b) => b.account).concat(loadArmyPosting().map((s) => s.username)))].filter((n) => n && n !== ACCOUNT);
  if (names.length) {
    try {
      const r = await rpcNode(STEEM_NODES[0], 'condenser_api.get_accounts', [names], 20000);
      for (const a of r || []) out.steem[String(a.name).toLowerCase()] = parseFloat(a.balance) || 0;
    } catch (_) {}
  }
  return out;
}

/* SOVFLO-70 — הצפה-יומית-מראיות-מדודות (refs-על-השרשרת = הפנקס; אין-צורך-בקורסור-יום) */
function collectFloatTxs(nodeSt, seenRefs, host) {
  const txs = [];
  const day = sovDay();
  for (const b of host.balances || []) {
    if (!b.account || b.account === ACCOUNT) continue;
    const amt = Math.round((b.saos + b.locked) * 1000) / 1000;
    if (amt >= 0.001) {
      const ref = 'flo:' + b.account + ':' + day;
      if (!seenRefs.has(ref)) { seenRefs.add(ref); txs.push({ type: 'transfer', from: ACCOUNT, to: b.account, amount: amt, ref, mirror: 'float-saos' }); }
    }
    const liq = host.steem[b.account] || 0;
    const sAmt = Math.floor(liq * 1000) / 1000;
    if (sAmt >= 0.001) {
      const ref = 'fls:' + b.account + ':' + day;
      if (!seenRefs.has(ref)) { seenRefs.add(ref); txs.push({ type: 'steemPay', from: 'host', to: b.account, amount: sAmt, ref, mirror: 'float-steem' }); }
    }
  }
  return txs.slice(0, ECON_CAPS.floatsPerBeat);
}

/* SOVBOOK-70a — הזמנות-חיילים-שנחתמו-על-המארח → order ריבוני (המזהה-הריבוני נרשם-אחרי-החלה) */
function collectOrderTxs(nodeSt, seenRefs) {
  const txs = [];
  const cur = nodeSt.mirrorCursors = nodeSt.mirrorCursors || { sales: [], yields: [], microdex: [] };
  cur.ordersSeen = (cur.ordersSeen || []).slice(-96);
  cur.orders = cur.orders || {};
  try {
    const x = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'microdex_state.json'), 'utf8'));
    for (const t of x.txids || []) {
      if (!t.txid || !t.by || !t.why) continue;
      if ((cur.ordersSeen || []).includes(t.txid) || cur.orders[t.txid] !== undefined) continue;
      const m = String(t.why).match(/^order-(buy|sell) ([0-9.]+) @([0-9.]+)/);
      if (!m) continue;
      cur.ordersSeen.push(t.txid);
      const ref = 'ord:' + t.txid;
      if (seenRefs.has(ref)) continue;
      seenRefs.add(ref);
      txs.push({ type: 'order', owner: String(t.by).toLowerCase(), side: m[1] === 'buy' ? 'buy' : 'sell', amount: parseFloat(m[2]), price: parseFloat(m[3]), ref, mirror: 'host-order', hostTxid: t.txid });
    }
  } catch (_) {}
  return txs.slice(0, ECON_CAPS.ordersPerBeat);
}

/* SOVBOOK-70b — fill-מארח → fill ריבוני נגד-הזמנה-חיה-של-ה-maker (טולרנס 1%, הקטן-קודם). אין-התאמה → דילוג-כן-מסופר */
function findMakerOrder(st, maker, price) {
  if (!maker) return null;
  const pµ = Math.round(price * 1e6);
  let best = null;
  for (const o of st.orders || []) {
    if (!o.live || o.owner !== maker) continue;
    if (Math.abs(o.price - pµ) / pµ > ECON_CAPS.fillTol) continue;
    if (!best || o.id < best.id) best = o;
  }
  return best;
}
function collectFillTxs(nodeSt, seenRefs, st) {
  const txs = [];
  const cur = nodeSt.mirrorCursors = nodeSt.mirrorCursors || {};
  cur.fillsSeen = (cur.fillsSeen || []).slice(-96);
  let skips = 0;
  try {
    const x = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'microdex_state.json'), 'utf8'));
    for (const t of x.txids || []) {
      if (!t.txid || !t.by || !t.why) continue;
      if ((cur.fillsSeen || []).includes(t.txid)) continue;
      const m = String(t.why).match(/^fill ([0-9.]+) @([0-9.]+)/);
      if (!m) continue;
      cur.fillsSeen.push(t.txid);
      const arrow = String(t.why).indexOf('←');
      const maker = arrow >= 0 ? String(t.why).slice(arrow + 1).trim().toLowerCase() : '';
      const ord = findMakerOrder(st, maker, parseFloat(m[2]));
      const taker = String(t.by).toLowerCase();
      if (!ord || ord.owner === taker) { skips++; continue; }
      const ref = 'fil:' + t.txid;
      if (seenRefs.has(ref)) continue;
      seenRefs.add(ref);
      txs.push({ type: 'fill', taker, orderId: ord.id, amount: Math.min(parseFloat(m[1]), ord.amount / 1000), ref, mirror: 'host-fill', hostTxid: t.txid });
    }
  } catch (_) {}
  if (skips) nodeSt.sov = Object.assign(nodeSt.sov || {}, { skips: (nodeSt.sov || {}).skips === undefined ? skips : nodeSt.sov.skips + skips });
  return txs.slice(0, ECON_CAPS.fillsPerBeat);
}

/* SOVBOOK-70c — שאלת-עומק-עומדת-של-האוצר: מתומחרת-מהמארח (lastPrice×1.003), ממוחזרת-בסטיה->2% */
function standingAskTxs(nodeSt, st, seenRefs, host) {
  const txs = [];
  const sov = nodeSt.sov = nodeSt.sov || {};
  const last = host.lastPrice;
  if (!(last > 0)) { sov.askNote = 'no-host-price'; return txs; }
  const target = Math.round(last * ECON_CAPS.askPremium * 1e6);
  const ask = sov.ask = sov.ask || { orderId: null, priceµ: 0 };
  const live = ask.orderId ? (st.orders || []).find((o) => o.id === ask.orderId && o.live) : null;
  if (live && Math.abs(live.price - target) / target <= ECON_CAPS.askRecycle) return txs; // בריאה — נשארת
  if (live) {
    const ref = 'cxlask:' + live.id;
    if (!seenRefs.has(ref)) { seenRefs.add(ref); txs.push({ type: 'cancel', owner: ACCOUNT, orderId: live.id, ref, mirror: 'ask-recycle' }); }
    ask.orderId = null;
  }
  const free = (st.accounts[ACCOUNT] && st.accounts[ACCOUNT].saos) || 0;
  if (!ask.orderId && free >= ECON_CAPS.askAmt * 1000) {
    const seq = (sov.askSeq = (sov.askSeq || 0) + 1);
    txs.push({ type: 'order', owner: ACCOUNT, side: 'sell', amount: ECON_CAPS.askAmt, price: target / 1e6, ref: 'ask:' + sovDay() + ':' + seq, mirror: 'standing-ask' });
  }
  return txs;
}

/* SOVBOOK-70d — מנוע-התאמה-ריבוני: ask×bid שחוצים → cancel-שחרור-של-ה-bid ואז fill-במחיר-ה-ask
 * (ה-taker משלם-מהפנוי-אחרי-השחרור — שיפור-מחיר-אם-ה-bid-היה-גבוה; דטרמיניסטי: מחיר-אז-זמן) */
function matcherTxs(st, beatNo) {
  const txs = [];
  const asks = (st.orders || []).filter((o) => o.live && o.side === 'sell').sort((a, b) => a.price - b.price || a.id - b.id);
  const bids = (st.orders || []).filter((o) => o.live && o.side === 'buy').sort((a, b) => b.price - a.price || a.id - b.id);
  const aRem = new Map(asks.map((o) => [o.id, o.amount]));
  const bRem = new Map(bids.map((o) => [o.id, o.amount]));
  const matchedBid = new Set();
  for (const a of asks) {
    if (txs.length >= ECON_CAPS.matchPairsPerBeat * 2) break;
    if ((aRem.get(a.id) || 0) <= 0) continue;
    for (const b of bids) {
      if (matchedBid.has(b.id) || (bRem.get(b.id) || 0) <= 0 || b.owner === a.owner) continue;
      if (b.price < a.price) break;
      const amt = Math.min(aRem.get(a.id), bRem.get(b.id));
      if (!(amt > 0)) continue;
      txs.push({ type: 'cancel', owner: b.owner, orderId: b.id, ref: 'cxl:' + b.id + ':' + beatNo, mirror: 'match-release' });
      txs.push({ type: 'fill', taker: b.owner, orderId: a.id, amount: amt / 1000, ref: 'mat:' + a.id + ':' + b.id + ':' + beatNo, mirror: 'match' });
      matchedBid.add(b.id);
      aRem.set(a.id, aRem.get(a.id) - amt);
      bRem.set(b.id, 0);
      break; // השאלה-הזו-נצרכה-בפעימה-זו (פשטות-דטרמיניסטית)
    }
  }
  return txs;
}

/* ── GRID-97 — מנוע-הגריד-האוטונומי-הרווחי ────────────────────────────────
 * ההנחיה: "לייצר כמה שיותר עסקאות-גריד אוטומטיות-אוטונומיות ולהוכיח רווח
 * ממשי · כל-עסקה מניבה רווח אמיתי · מושכת נזילות מהגשרים לבריכות שלנו".
 * שלוש-רגליים בכל-פעימה (הכל-רק-נכסי-האוצר — אף-חייל לא נגע):
 *   97a סולם-אוצר 3×3 סביב-מחיר-אמצע משולב (ספר+בריכה) — ספרד-מייקר 0.4%/רמה,
 *       מיחזור-רמות-סטות (אירועי-cancel+order — הספר תמיד סביב-המחיר).
 *   97b ארביטראז ספר↔בריכה: פער >1.5% → החלפה-אחת לכיוון-הזול (תקדים-96:
 *       הפער-הגדול נסגר לטובת-האוצר) — רווח-מתממש כשהספר מתאזן-מחדש.
 *   97c משיכת-גשר (חד-פעמית, ref-יחיד): עודף-כיסוי-WTRX (מדידה-חיה 24.443
 *       מול-היצע 17) נרשם-לאוצר עד-99% כיסוי + זריעת בריכת-הגשר WTRX/SAOS —
 *       נזילות-הגשר נמשכת-ממש לבריכות-שלנו ונסחרת-שם (עמלי-30bps).
 */
function gridMid(st) {
  const last = st.meta.lastPrice ? st.meta.lastPrice / 1e6 : 0;
  const poolPx = (st.pool && st.pool.saos > 0 && st.pool.steem > 0) ? st.pool.steem / st.pool.saos : 0;
  if (last > 0 && poolPx > 0) return (last * 0.5 + poolPx * 0.5);
  return last > 0 ? last : poolPx;
}

function gridLadderTxs(nodeSt, st, seenRefs) {
  const txs = [];
  const mid = gridMid(st);
  if (!(mid > 0)) return txs;
  const L = ECON_CAPS.ladderLevels, amt = ECON_CAPS.ladderAmt;
  const step = ECON_CAPS.ladderStepBps / 10000, tol = ECON_CAPS.ladderRecycleBps / 10000;
  const tre = st.accounts[ACCOUNT] || { saos: 0, steem: 0 };
  const askProtect = nodeSt.sov && nodeSt.sov.ask ? nodeSt.sov.ask.orderId : null; // השאלה-העומדת-ותיקה לא נוגעים
  const myLive = (st.orders || []).filter((o) => o.live && o.owner === ACCOUNT && o.id !== askProtect);
  // 1) מיחזור: הזמנת-אוצר שהתרחקה מכל-רמה-יעד מעבר-הסבילות
  const targets = [];
  for (let k = 1; k <= L; k++) {
    targets.push({ side: 'sell', price: mid * (1 + step * k) });
    targets.push({ side: 'buy', price: mid * (1 - step * k) });
  }
  const cancels = [];
  for (const o of myLive) {
    let bd = Infinity;
    for (const t of targets) {
      if (t.side !== o.side) continue;
      const d = Math.abs(o.price / 1e6 - t.price) / t.price;
      if (d < bd) bd = d;
    }
    if (bd > tol) {
      const ref = 'g97cxl:' + o.id;
      if (!seenRefs.has(ref)) { seenRefs.add(ref); cancels.push({ type: 'cancel', owner: ACCOUNT, orderId: o.id, ref, mirror: 'grid-recycle' }); }
    }
  }
  txs.push(...cancels);
  // 2) רמות-חסרות (אחרי-הביטולים-באותו-בלוק — היתרה-משתחררת ברצף)
  const freeS = (tre.saos || 0), freeT = (tre.steem || 0);
  const cancelledIds = new Set(cancels.map((c) => c.orderId));
  const remaining = myLive.filter((o) => !cancelledIds.has(o.id));
  const hgt = nodeSt.height || 0;
  for (let k = 0; k < targets.length; k++) {
    const t = targets[k];
    if (txs.length >= ECON_CAPS.ordersPerBeat) break; // תקרת-הזמנות-לפעימה
    const px = Math.round(t.price * 1e6) / 1e6;
    if (remaining.some((o) => o.side === t.side && Math.abs(o.price / 1e6 - px) / px <= tol)) continue;
    if (t.side === 'sell') {
      if (freeS < amt * 1000) continue;
      const ref = 'g97a:' + hgt + ':' + k;
      if (seenRefs.has(ref)) continue;
      seenRefs.add(ref);
      txs.push({ type: 'order', owner: ACCOUNT, side: 'sell', amount: amt, price: px, ref, mirror: 'grid-ask' });
    } else {
      const paySteem = Math.ceil(amt * px * 1000);
      if (freeT < paySteem / 1000) continue;
      const ref = 'g97b:' + hgt + ':' + k;
      if (seenRefs.has(ref)) continue;
      seenRefs.add(ref);
      txs.push({ type: 'order', owner: ACCOUNT, side: 'buy', amount: amt, price: px, ref, mirror: 'grid-bid' });
    }
  }
  const g = nodeSt.grid97 = nodeSt.grid97 || {};
  g.ladderPosts = (g.ladderPosts || 0) + txs.filter((t) => t.mirror === 'grid-ask' || t.mirror === 'grid-bid').length;
  g.ladderRecycles = (g.ladderRecycles || 0) + cancels.length;
  g.ladderLive = (st.orders || []).filter((o) => o.live && o.owner === ACCOUNT).length + txs.filter((t) => t.type === 'order' && t.owner === ACCOUNT).length - cancels.length;
  g.mid = mid;
  return txs;
}

function gridArbTxs(nodeSt, st, seenRefs) {
  const txs = [];
  const last = st.meta.lastPrice ? st.meta.lastPrice / 1e6 : 0;
  const poolPx = (st.pool && st.pool.saos > 0 && st.pool.steem > 0) ? st.pool.steem / st.pool.saos : 0;
  if (!(last > 0) || !(poolPx > 0)) return txs;
  const gapBps = Math.round((last - poolPx) / poolPx * 10000);
  const g = nodeSt.grid97 = nodeSt.grid97 || {};
  g.gapBps = gapBps;
  if (Math.abs(gapBps) < ECON_CAPS.arbGapBps) return txs; // הפער-בריא — הספר-והבריכה מאוזנים
  // הפער: last>poolPx → SAOS-זול-בבריכה → קנייה-מהבריכה (buy_saos · קלט=STEEM)
  //        last<poolPx → SAOS-יוקר-בבריכה → מכירה-לבריכה (sell_saos · קלט=SAOS)
  // גודל-מרוסן על-צד-הקלט (זה-מה-נכנס-לבריכה): ≤2% מעומק-הקלט · ≤50% מהיתרה-הפנויה
  const tre = st.accounts[ACCOUNT] || { saos: 0, steem: 0 };
  const side = gapBps > 0 ? 'buy_saos' : 'sell_saos';
  const depthIn = side === 'buy_saos' ? st.pool.steem : st.pool.saos; // צד-הקלט-של-הבריכה (µ)
  const freeIn = side === 'buy_saos' ? Math.floor((tre.steem || 0) * 1000) : Math.floor((tre.saos || 0) * 1000);
  let inAmtµ = Math.min(Math.floor(depthIn * 0.02), Math.floor(freeIn * 0.5));
  if (!(inAmtµ > 0)) return txs;
  const inAmt = inAmtµ / 1000;
  const ref = 'g97arb:' + (nodeSt.height || 0) + ':' + side;
  if (seenRefs.has(ref)) return txs;
  seenRefs.add(ref);
  txs.push({ type: 'pool_swap', taker: ACCOUNT, side, inAmt, ref, mirror: 'grid-arb' });
  g.arbEvents = (g.arbEvents || 0) + 1;
  g.arbLastAt = new Date().toISOString();
  g.arbLastSide = side;
  g.arbLastAmt = inAmt;
  log('grid-arb: gap ' + gapBps + 'bps → ' + side + ' ' + inAmt + ' (תקדים-96: סגירת-פער לטובת-האוצר)');
  return txs;
}

function gridBridgeTxs(nodeSt, st, seenRefs) {
  /* חד-פעמי: משיכת-נזילות-הגשר לבריכות-שלנו (ההנחיה המרכזית).
   * מותנה-אמת: כיסוי-WTRX-מדוד על-הספר > 100.5% · ref-יחיד (idempotent).
   * (1) wrap_mint עודף-עד-99% כיסוי → אוצר (גיבוי-מלא — אף-הנפקה-על-חשבון-עתיד)
   * (2) pool_addw זריעה: 0.2 WTRX + צד-SAOS ביחס-שוק-הבריכה (מציטוט-96 על-הספר) */
  const txs = [];
  const w = st.wrapped && st.wrapped.WTRX;
  if (!w || !(w.locked > 0)) return txs;
  const g = nodeSt.grid97 = nodeSt.grid97 || {};
  const MINT_REF = 'g97:bridge-pull:24443364';
  const cover = w.locked / Math.max(w.supply, 1);
  g.wtrxCover = +(cover * 100).toFixed(2);
  const already = w.refs && w.refs[MINT_REF];
  if (!already && cover > 1.005) {
    const mintµ = Math.floor(0.99 * w.locked - w.supply);
    if (mintµ > 0) {
      const ref = MINT_REF;
      if (!seenRefs.has(ref)) {
        seenRefs.add(ref);
        txs.push({ type: 'wrap_mint', issuer: ACCOUNT, symbol: 'WTRX', to: ACCOUNT, amount: mintµ / 1000, lockedDelta: 0, ref, mirror: 'grid-bridge-mint', note: 'excess-cover bridge-pull (measured ' + (w.locked / 1000) + ' TRX · supply→' + ((w.supply + mintµ) / 1000) + ' · cover→99%)' });
        g.bridgeMintµ = mintµ;
      }
    }
  }
  // זריעת-בריכת-הגשר — פעם-אחת (ref-יחיד), בהמשך-הפעימה-של-אחרי-המינט
  const SEED_REF = 'g97:poolw-seed';
  if (!seenRefs.has(SEED_REF) && !(st.poolW && st.poolW.lpSupply > 0)) {
    const tre = st.accounts[ACCOUNT] || { saos: 0, wrapped: {} };
    const wtrµ = 200; // 0.2 WTRX
    const haveW = Math.floor(tre.wrapped && tre.wrapped.WTRX || 0) + (g.bridgeMintµ || 0);
    if (haveW >= wtrµ) {
      // יחס-שוק: WTRX ב-$ (ציטוט-96) מול-SAOS ב-$ (מחיר-בריכה×מחיר-STEEM) — נעזר-בציטוטים-על-הספר
      const pxW = st.assetPrices && st.assetPrices.WTRX ? st.assetPrices.WTRX.px : 333300000; // nano-$ fallback מהציטוט-החי-האחרון
      const pxSteem = st.assetPrices && st.assetPrices.WSTEEM ? st.assetPrices.WSTEEM.px : 46200000;
      const saosInSteem = gridMid(st); // STEEM ל-SAOS על-הספר-שלנו
      if (saosInSteem > 0) {
        const saosUsd = saosInSteem * pxSteem / 1e9; // $ ל-SAOS
        const wtrxUsd = pxW / 1e9;
        const ratio = wtrxUsd / Math.max(saosUsd, 1e-12); // SAOS לכל-WTRX
        const saosµ = Math.floor(wtrµ * ratio);
        if (saosµ > 0 && (tre.saos || 0) >= saosµ) {
          seenRefs.add(SEED_REF);
          txs.push({ type: 'pool_addw', owner: ACCOUNT, amountSaos: saosµ / 1000, amountWtrx: wtrµ / 1000, ref: SEED_REF, mirror: 'grid-poolw-seed', note: 'bridge-liquidity → our pool (WTRX/SAOS @' + ratio.toFixed(1) + ' SAOS/WTRX)' });
          g.poolwSeed = { wtrx: wtrµ / 1000, saos: saosµ / 1000, ratio: +ratio.toFixed(1) };
        }
      }
    }
  }
  return txs;
}

/* SOVYIELD-70 — תשואה-ריבונית-יומית: נמדדת-מעמלות-השרשרת-הריבונית (fees.toTreasury),
 * מחולקת-למחזיקי-LP לפי-מניות. cap 0.02 SAOS/יום · dup-day-קרנל = idempotent */
function sovereignYieldTx(nodeSt, st, day) {
  const sov = nodeSt.sov = nodeSt.sov || {};
  if (sov.yieldDay === day) return null;
  const feesTr = (st.fees && st.fees.toTreasury) || 0;
  if (!(feesTr > 0)) { sov.yieldNote = 'no-sov-fees-yet'; return null; }
  const tre = st.accounts[ACCOUNT] || { saos: 0 };
  const totalµ = Math.min(ECON_CAPS.yieldCapµ, Math.floor(feesTr / 500), Math.floor(tre.saos / 2000));
  if (!(totalµ > 0)) { sov.yieldNote = 'fees-below-payout-floor'; return null; }
  const lps = Object.entries(st.accounts).filter(([n, a]) => a.lp > 0 && n !== ACCOUNT);
  const lpTotal = lps.reduce((s, [, a]) => s + a.lp, 0);
  if (!(lpTotal > 0)) { sov.yieldNote = 'no-lp-holders'; return null; }
  const payments = [];
  let left = totalµ;
  for (const [n, a] of lps) {
    const p = Math.floor((a.lp * totalµ) / lpTotal);
    if (p >= 1 && left >= p) { payments.push({ account: n, amount: p / 1000 }); left -= p; }
  }
  if (!payments.length) { sov.yieldNote = 'payout-dust'; return null; }
  sov.yieldNote = null;
  return { type: 'yield', from: ACCOUNT, day, payments, mirror: 'sov-yield' };
}

/* סיכום-ספר-ריבוני → heartbeat (הספר-עצמו מדבר) */
function sovDigest(st) {
  const live = (st.orders || []).filter((o) => o.live).length;
  const asks = (st.orders || []).filter((o) => o.live && o.side === 'sell').length;
  const bids = live - asks;
  const last = st.meta.lastPrice ? (st.meta.lastPrice / 1e6).toFixed(6) : '—';
  return ('sov: orders=' + live + '(' + bids + 'b/' + asks + 'a) · trades=' + (st.meta.trades || 0) + ' · last=' + last + ' · yield=' + ((st.meta.yieldTotal || 0) / 1000).toFixed(3) + ' · fees=' + ((st.fees && st.fees.total) || 0) + 'µ').slice(0, 160);
}

/* EXPLORER-71 — תיעוד-הרשת-על-הרשת: publication ציבורי כל-פעימה-שנייה.
 * custom_json (protocol saos:net/v1, action=explorer) עם תמצית-הרשת + digest
 * קריפטוגרפי (sha256 canonical על גוף-התמצית בלי-ה-digest). כל-אחד-על-המארח
 * יכול לעקוב-ולאמת את SAOS-NET בלי-גישה-לשרת — זהו התיעוד-של-הרשת-על-הרשת.
 * ה-publication נרשם ב-state.json ומאומת get_transaction כמו-עיגון. */
async function explorerPublish(nodeSt, st, chainState) {
  const ex = nodeSt.explorer = nodeSt.explorer || { publishes: [], digest: null, at: null };
  ex.publishes = (ex.publishes || []).slice(-24);
  const beatNo = (nodeSt.beats || 0) + 1;
  if (beatNo % 2 !== 0) return; // קצב-צנוע — publication כל-30-דק'
  const live = (st.orders || []).filter((o) => o.live);
  const lastCp = (nodeSt.checkpoints || []).slice(-1)[0] || null;
  const txsTotal = (chainState.blocks || []).reduce((s, b) => s + (b.txs || []).length, 0);
  const core = {
    net: NET,
    height: st.meta.height || 0,
    stateRoot: K.stateRoot(st),
    genesisHash: nodeSt.genesisHash || null,
    supply: (st.meta.supply || 0) / 1000,
    txs: txsTotal,
    accounts: Object.keys(st.accounts || {}).length,
    asks: live.filter((o) => o.side === 'sell').length,
    bids: live.filter((o) => o.side === 'buy').length,
    trades: st.meta.trades || 0,
    lastPrice: st.meta.lastPrice ? st.meta.lastPrice / 1e6 : null,
    feesµ: (st.fees && st.fees.total) || 0,
    yield: (st.meta.yieldTotal || 0) / 1000,
    boundary: ((st.accounts.host || {}).steem || 0) / 1000,
    head: st.meta.lastProducer || null,
    headRound: st.meta.lastProduceRound != null ? st.meta.lastProduceRound : null,
    rosterDigest: (nodeSt.rot || {}).rosterDigest || null,
    cp: lastCp ? { height: lastCp.height, stateRoot: lastCp.stateRoot, steem: lastCp.anchors ? (lastCp.anchors.steem || null) : null } : null,
    time: new Date().toISOString(),
  };
  const digest = sha(K.canon(core));
  const payload = Object.assign({ action: 'explorer' }, core, { digest });
  const res = await anchorSteem(payload);
  if (res.txid) {
    ex.publishes.push({ height: core.height, txid: res.txid, verified: false, digest, by: res.by || ACCOUNT, at: core.time });
    ex.publishes = ex.publishes.slice(-24);
    ex.digest = digest; ex.at = core.time;
    nodeSt.pendingVerifies.push({ txid: res.txid, kind: 'explorer-pub', at: core.time });
    log('explorer-pub ✓ height=' + core.height + ' txid=' + res.txid + ' digest=' + digest.slice(0, 12));
  } else {
    ex.publishes.push({ height: core.height, txid: null, verified: false, skip: res.skip || res.err || 'err', digest, at: core.time });
    ex.publishes = ex.publishes.slice(-24);
    log('explorer-pub SKIP: ' + (res.skip || res.err || '?'));
  }
}

/* STAGE-3 (72): צ'קפוינט-אחרי-כל-שלב-בנייה — תגלית-72: בדיקה-יחידה-בסוף-הפעימה
 * דילגה-על @60 כשבלוקי-כלכלה חצו-את-הגבול (60→61). נקראת אחרי heartbeat/
 * mirror/economy/ask/fills/matcher/yield — idempotent לפי height%12. */
async function maybeCheckpoint(nodeSt, st, chainState, time) {
  if (st.meta.height % CHECKPOINT_EVERY !== 0) return;
  const cp = K.buildCheckpoint(st, ACCOUNT, {});
  const checkpointHash = sha(K.canon({ height: cp.height, blockHash: cp.blockHash, stateRoot: cp.stateRoot }));
  cp.checkpointHash = checkpointHash;
  log('checkpoint @' + cp.height + ' stateRoot=' + cp.stateRoot.slice(0, 16) + '…');
  if (LIVE) {
    const attests = await soldierAttest(checkpointHash, cp.height, cp.stateRoot, nodeSt);
    const t2 = new Date().toISOString();
    for (const a of attests) {
      const { block: ab } = K.buildBlock(st, [{ type: 'attest', validator: a.validator, checkpointHash, time: t2 }], t2);
      chainState.blocks.push(ab);
    }
    const anchorPayload = { action: 'checkpoint', net: NET, height: cp.height, blockHash: cp.blockHash, stateRoot: cp.stateRoot, genesisHash: nodeSt.genesisHash, checkpointHash, quorum: { required: cp.quorum.required }, time };
    const aS = await anchorSteem(anchorPayload);
    if (aS.txid) { cp.anchors.steem = aS.txid; nodeSt.pendingVerifies.push({ txid: aS.txid, kind: 'steem-anchor', at: t2 }); log('steem-anchor ✓ txid=' + aS.txid); }
    else log('steem-anchor SKIP/ERR: ' + (aS.skip || aS.err || '?'));
    const aH = await anchorHiveViaFleet(anchorPayload);
    if (aH.by) { cp.anchors.hive = 'pending:' + aH.by; nodeSt.pendingVerifies.push({ txid: null, kind: 'hive-anchor', by: aH.by, time: anchorPayload.time, at: t2 }); log('hive-anchor ✓ via @' + aH.by); }
    for (const a of attests) if (a.txid) { const v = await verifyTxid(a.txid); a.verified = v.verified; a.node = v.node; if (v.verified) nodeSt.verified.push(a.txid); }
    nodeSt.checkpoints.push({ height: cp.height, stateRoot: cp.stateRoot, checkpointHash, anchors: cp.anchors, attests: attests.map((a) => ({ by: a.validator, txid: a.txid, verified: a.verified })), at: t2 });
  }
  nodeSt.checkpoints = nodeSt.checkpoints.filter((c, i, arr) => i === arr.length - 1 || arr[i + 1].height !== c.height);
  if (nodeSt.checkpoints.length > 64) nodeSt.checkpoints = nodeSt.checkpoints.slice(-64);
}

async function beat() {
  const genesis = JSON.parse(fs.readFileSync(GENESIS_FILE, 'utf8'));
  // שחזור-המצב-מהג'נזיס+בלוקים — הצומת אף-פעם לא סומך על snapshot לבד
  const chainState = loadChain();
  /* 93-fix קריטי: החלון-החם (MAX_BLOCKS_KEPT=512) גרם לצומת-עצמו לשחזר-מצב-חסר
   * (בלוקים-1..6 נשרפו-מהחלון בגובה-519) — השחזור חייב-לרוץ-על-הספר-המלא-מהארכיון. */
  let replayBlocks = chainState.blocks;
  try {
    const archLines = fs.readFileSync(ARCHIVE_FILE, 'utf8').trim().split('\n');
    let full = [];
    for (let i = 1; i < archLines.length; i++) { try { full.push(JSON.parse(archLines[i])); } catch (_) {} }
    if (full.length) {
      /* 96-heal: מיזוג חלון+ארכיון ומיון לפי גובה — הצומת לא סומך על סדר-הקובץ
       * ולא על מקור-יחיד. תקלות-אמת (graft של the-loom שדרס את זנב-הספר 680..692
       * בזמן WRAP-96, וגם guardian-resets) נמחקו בלוקים חיים — עכשיו כל בלוק-חלון
       * שחסר בארכיון חוזר ל-replay, והשידוך מתבצע לפי גובה בלבד. */
      const have = new Set(full.map((b) => b.height));
      for (const wb of chainState.blocks) if (!have.has(wb.height)) full.push(wb);
      /* 99b-heal: דה-דופ לפי גובה — הארכיון נמצא-כפול-בפועל (1,249 שורות-כפולות
       * נמדדו: 1,225 זהות-byte + 24 שונות — סופר-כפול כותב חלונות-חופפים).
       * replay שמיישם כפילויות מסכן כל-op שאינו-מגונן-מקרנל (pool/heartbeat).
       * 109 — last-wins-אחיד (אותו-כיוון כמו-תיקון-הארכיון-וה-inject): העותק-האחרון-
       * שנכתב הוא-הקנוני (ה-HEAL-ממלא-פערים בעותקים-חדשים-יותר). שונויות-נספרות-בכנות. */
      const byHBeat = new Map();
      let dupDropped = 0;
      for (const b of full) {
        if (byHBeat.has(b.height)) dupDropped++;
        byHBeat.set(b.height, b);
      }
      const deduped = [...byHBeat.values()];
      if (dupDropped > 0) log('beat replay archive DEDUP · dropped ' + dupDropped + ' duplicate-height lines (last-wins · 109-uniform)');
      full = deduped;
      full.sort((a, b) => a.height - b.height);
      replayBlocks = full;
    }
  } catch (_) { /* אין-ארכיון — חלון (כנות: אחרי-החלון המצב-חסר-עד-התיקון) */ }
  /* 98 — replay-מצטבר: snapshot תושב בין-פעימות. הצוואר-הבקבוקי-המדוד של-הגריד:
   * replay מלא O(בלוקים) בכל-פעימה הולך-וגדל עם-השרשרת (מיליוני-אירועים/יום =
   * פעימות-איטיות-ומנעול-תפוס). הפתרון-הריבוני: תחילת-פעימה מ-snapshot מאומת
   * (block-hash בגובה-ה-snapshot חייב-להתאים לארכיון) + החלת-בלוקים-חדשים-בלבד.
   * דטרמיניזם-נשמר: אותם-txs-בדיוק מיושמים; כשל-אימות → replay-מלא (כנות). */
  const snapPath = path.join(NODE_DIR, 'state-snapshot.json');
  const snapPrev = path.join(NODE_DIR, 'state-snapshot.prev.json');
  const rootPath = path.join(NODE_DIR, 'state-root.json');
  /* 106 — שרשרת-החזרה: state-root (קו-ההתחלה-השורשי-המקודם) → snapshot → prev →
   * replay-מלא (כנות). כל-שכבה מאומתת מול-בלוק-הארכיון בגובהה (hash-lock) —
   * אותו-מנגנון-אימות שהיה, עכשיו על-שלוש-שכבות-הגנה במקום-אחת.
   * הקריסה-של-היום: snapshot-יחיד-שנשחת → genesis+ארכיון עם-פערים → דחיות →
   * מצב-רפאים. מ-106: המצב-החי-מקודם-לשורש והרשת-לא-מאבדת-ליניאגה-בהפעלה-מחדש. */
  let snap = null;
  const anchorOk = (s) => {
    if (!(s && s.st && Number.isInteger(s.height) && s.height > 0 && s.lastBlockHash)) return false;
    const anchorBlk = replayBlocks.find((b) => b.height === s.height);
    return !!(anchorBlk && anchorBlk.hash === s.lastBlockHash);
  };
  /* 117c — חוק-הדם (bloodline-law): anchor-בגובה-אחד אינו ראיה — התראת-האמנזיה-החיה
   * (היום: דמון-ישן-קרנל בלע tx.raw/raw-pool גידל ליניאגה-שכחה; ה-anchor-בגובה-היחיד
   * אימת אותה והיא ניצחה ב-dedup). תיקון-השורש: ליניאגה מתקבלת רק אם כל-הבלוקים
   * מעל-הסנפשוט בארכיון יוצרים רצף-prevHash אחיד מאחרונת-הסנפשוט ועד-ראש-הארכיון.
   * שבר-אחד = הליניאגה לא ראתה את הארכיון כמות-שהוא → נדחה בכנות → replay-מלא. */
  const bloodlineOk = (s) => {
    let expectHash = s.lastBlockHash;
    const above = replayBlocks.filter((b) => b.height > s.height).sort((a, b) => a.height - b.height);
    for (const b of above) {
      if (b.prevHash !== expectHash) return b.height; // שבר-הדם — הגובה-הכוזב
      expectHash = b.hash;
    }
    return 0; // דם-טהור
  };
  for (const p of [rootPath, snapPath, snapPrev]) {
    try {
      const s = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (anchorOk(s)) {
        const breakAt = bloodlineOk(s);
        if (breakAt) { log('beat restore candidate ' + path.basename(p) + ' REJECTED — bloodline break at h' + breakAt + ' (117c, honest) → full-replay'); continue; }
        snap = s; if (p !== rootPath) log('beat restore from ' + path.basename(p) + ' at h' + s.height); break;
      }
      log('beat restore candidate ' + path.basename(p) + ' REJECTED (anchor hash mismatch at h' + (s && s.height) + ') — honest');
    } catch (_) { /* קובץ-חסר/שחות — השכבה-הבאה בשרשרת */ }
  }
  if (snap) {
    /* 106 — קידום-השורש: כל-מצב-מאומת-חדש-יותר מתקדם ל-state-root.json
     * (אטומית). השורש-מקבל-עדיפות-בכל-הפעלה-מחדש — הליניאגה-החיה-לעולם-לא-נופלת
     * בחזרה-ל-replay-מרעיל. הקידום מתועד-ביומן ומעיד-על-עצמו בגובה+hash. */
    try {
      let cur = null;
      try { cur = JSON.parse(fs.readFileSync(rootPath, 'utf8')); } catch (_) {}
      if (!cur || !Number.isInteger(cur.height) || cur.height < snap.height) {
        const tmp = rootPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ height: snap.height, lastBlockHash: snap.lastBlockHash, promotedAt: new Date().toISOString(), st: snap.st }));
        fs.renameSync(tmp, rootPath);
        log('state-root PROMOTED h' + snap.height + ' (106 — קו-ההתחלה-השורשי-נגד-אמנזיה)');
      }
    } catch (_) {}
  }
  let st;
  if (snap) {
    st = snap.st;
    st.meta.issuer = ACCOUNT;
    let applied = 0;
    for (const b of replayBlocks) {
      if (b.height <= snap.height) continue;
      for (const tx of (b.txs || [])) K.applyTx(st, tx);
      applied++;
    }
    const lastB = replayBlocks[replayBlocks.length - 1];
    st.meta.height = lastB.height;
    st.meta.lastBlockHash = lastB.hash;
    log('beat replay INCREMENTAL from h' + snap.height + ' (+' + applied + ' blocks) — הגריד-נושם');
  } else {
    st = K.initFromGenesis(genesis);
    st.meta.issuer = ACCOUNT;
    for (const b of replayBlocks) for (const tx of b.txs) K.applyTx(st, tx);
  }
  /* 94-תיקון-שורש: הגובה = הגובה-האמיתי-של-הבלוק-האחרון (לא-ספירת-שורות!).
   * הארכיון-עם-פערים (תקופת-ה-heal) גרם ל-length≠height → פעימות-מקבילות בנו
   * בלוקים-בגבהים-מתנגשים ומשימות-אבדו. הגובה מהבלוק-האחרון-עצמו + גילוי-פער-כן. */
  const startHeight = replayBlocks.length ? replayBlocks[replayBlocks.length - 1].height : 0;
  if (replayBlocks.length && startHeight !== replayBlocks.length) {
    log('ARCHIVE HEIGHT-SYNC: last-block height ' + startHeight + ' ≠ lines ' + replayBlocks.length + ' (gaps — honest continuation from ' + startHeight + ')');
  }
  st.meta.height = Math.max(st.meta.height, startHeight);
  st.meta.lastBlockHash = replayBlocks.length ? replayBlocks[replayBlocks.length - 1].hash : null;
  const nodeSt = loadNodeState();
  /* 93 — סנכרון-ארכיון: גובה-הארכיון הוא-האמת — מונע-אפנד-כפול */
  try {
    const archLines = fs.readFileSync(ARCHIVE_FILE, 'utf8').trim().split('\n');
    for (let i = archLines.length - 1; i >= 0; i--) {
      try { const ab = JSON.parse(archLines[i]); if (ab && ab.height) { nodeSt.archiveHeight = Math.max(nodeSt.archiveHeight || 0, ab.height); break; } } catch (_) { /* שורה-פגומה */ }
    }
  } catch (_) { /* אין-ארכיון-עדיין — ייווצר-ב-saveAll */ }
  log('=== SAOS-NET BEAT ' + (nodeSt.beats + 1) + ' · height=' + st.meta.height + ' ===');

  // סריאליזציה — תגלית-69: שני-פעימות-מקבילות (דמון+ידני) מייצרות-אחים.
  // הקבצים-האחרונים-עקביים-פנימית (אומת) אבל-בלוקים-עלולים-ללכת-לאיבוד → נעילה.
  const lk = acquireLock();
  if (!lk.ok) {
    log('BEAT SKIPPED — another beat holds the lock (pid ' + lk.holder.pid + ' from ' + new Date(lk.holder.at).toISOString() + ')');
    return;
  }
  let holds = true; /* 99 — בעלות-מנעול בהיקף-הפונקציה (finally חייב-לראות) */
  try {

  /* 99 — פאזת-רשת-פתוחה: digest+roster+produce לא-נוגעים-בקרנל — המנעול-משוחרר */
  releaseLock(); holds = false;
  const digest = await empireDigest();
  const time = new Date().toISOString();

  // ── STAGE-3 (72): הרוסטר מפורסם (יומי) + מנדט-הפקה לסבב הנוכחי ──
  if (LIVE) await rosterPublish(nodeSt);
  const nextH = st.meta.height + 1;
  const prod = LIVE ? await produceForRound(nodeSt, st, nextH) : null;
  let headNote = '';
  if (prod) headNote = 'head=@' + prod.producer + '(r' + prod.round + ') · ';
  else {
    const rCur = Math.floor(nextH / CHECKPOINT_EVERY);
    const rec = (nodeSt.rot || {}).rounds ? (nodeSt.rot || {}).rounds[rCur] : null;
    if (rec && rec.miss) headNote = 'head-miss r' + rCur + ' @' + rec.producer + '(' + rec.miss + ') · ';
  }

  const hbTxs = [{ type: 'heartbeat', note: (headNote + digest + ' · ' + sovDigest(st)).slice(0, 160) }];
  if (prod) hbTxs.push({ type: 'produce', producer: prod.producer, round: prod.round, ref: prod.ref });
  /* 99 — חזרה-למנעול לפני-נגיעה-בקרנל; סנכרון-זנב (המנוע-התקדם-בחלון) ; כשל → פעימה-נסגרת-בכבוד */
  if (!(await reacquireSpin())) { log('BEAT ABORT — lock lost after open-network phase (GRID-99, honest)'); return; }
  holds = true;
  if (!catchUpTail(st, chainState)) { log('BEAT ABORT — state fork after open-network phase (GRID-99, honest)'); return; }
  const hbRes = K.buildBlock(st, hbTxs, time);
  chainState.blocks.push(hbRes.block);
  if (prod) {
    if (hbRes.results[1] && hbRes.results[1].ok) {
      rotSt(nodeSt).rounds[prod.round] = { round: prod.round, producer: prod.producer, height: hbRes.block.height, ref: prod.ref, hostTxid: prod.hostTxid, verified: false };
      nodeSt.pendingVerifies.push({ txid: prod.hostTxid, kind: 'produce', round: prod.round, at: time });
      log('produce op r' + prod.round + ' ON-CHAIN @' + prod.producer + ' blk=' + hbRes.block.height);
    } else log('produce op r' + prod.round + ' REJECTED: ' + (hbRes.results[1] && hbRes.results[1].err));
  }
  const { block } = hbRes;
  log('block ' + block.height + ' · heartbeat=' + digest.slice(0, 70) + (prod ? ' · head=@' + prod.producer : ''));
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // ── WEAVE-SEAL (W2): איטום-האריגה — בקשת-הבאצ'ר (agent/weave_batch.cjs) ──
  // הבאצ'ר משחזר-בעצמו ומחשב את-השורש-הקנוני מה-stamps-החיים; הצומת (הכותב-היחיד,
  // תחת-הנעילה) מגיש את ה-op. הקרנל מחשב-בעצמו את-השורש — שורש-מזויף/ישן
  // נדחה-מתמטית (root-mismatch/count) והבקשה נבלעת-בכבוד; הבאצ'ר יחשב-מחדש.
  // אחרי-האיטום הצ'קפוינט-הבא (≤12-בלוקים) נושא את-השורש בתוך-ה-stateRoot.
  const wReq = readWeaveRequest();
  if (wReq) {
    nodeSt.weave = nodeSt.weave || { seals: [], requests: 0, rejected: 0 };
    const wTxs = [{ type: 'seal', issuer: ACCOUNT, root: String(wReq.root), count: Number(wReq.count), at: wReq.computedAt || time }];
    const wRes = K.buildBlock(st, wTxs, time);
    chainState.blocks.push(wRes.block);
    const wr = wRes.results[0] || {};
    if (wr.ok) {
      // ה-אמת מהמצב-החי-של-הקרנל אחרי-הבלוק (buildBlock לא-מעביר sealSeq/count ב-results)
      const ls = (st.weave && st.weave.lastSeal) || {};
      const lastS = st.weave && st.weave.seals && st.weave.seals[st.weave.seals.length - 1];
      nodeSt.weave.seals.unshift({ seq: ls.seq || null, root: String(wReq.root), count: ls.count != null ? ls.count : Number(wReq.count), from: (lastS && lastS.from) || null, to: (lastS && lastS.to) || null, height: wRes.block.height, at: wReq.computedAt || time, anchored: null });
      if (nodeSt.weave.seals.length > 32) nodeSt.weave.seals.pop();
      nodeSt.weave.requests = (nodeSt.weave.requests || 0) + 1;
      log('WEAVE-SEAL ✓ seq=' + (ls.seq || '?') + ' · root=' + String(wReq.root).slice(0, 16) + '… · count=' + (ls.count != null ? ls.count : '?') + ' · blk=' + wRes.block.height + ' (next checkpoint carries the root)');
    } else {
      nodeSt.weave.rejected = (nodeSt.weave.rejected || 0) + 1;
      log('WEAVE-SEAL REJECTED: ' + (wr.err || '?') + ' — request consumed honestly; batcher will re-compute on next tick');
    }
    clearWeaveRequest();
    await maybeCheckpoint(nodeSt, st, chainState, time);
  }

  // MIRROR — אירועי-אימפריה חיים → txs-ריבוניים (שלב-1: mirror)
  const seenRefs = new Set();
  /* 105 — ref-איננו-ראיה מתמטית — הוא מזהה-מופע: מפת-ערכים לאימות-values-aware
   * (משימה-שה-ref-שלה-על-הספר עם-ערכים-שונים תסומן ref-conflict, לא already-applied). */
  const bookOpByRef = new Map();
  for (const b of chainState.blocks) for (const t of b.txs) if (t && t.ref) { seenRefs.add(t.ref); if (!bookOpByRef.has(t.ref)) bookOpByRef.set(t.ref, t); }
  const mir = collectMirrorTxs(nodeSt, seenRefs);
  if (mir.txs.length) {
    const mRes = K.buildBlock(st, mir.txs, time);
    chainState.blocks.push(mRes.block);
    const okN = mRes.results.filter((r) => r.ok).length;
    nodeSt.mirror = nodeSt.mirror || { sales: 0, yields: 0, poolAdds: 0, poolSwaps: 0, failed: 0, beats: 0 };
    nodeSt.mirror.sales += mir.counts.sales; nodeSt.mirror.yields += mir.counts.yields;
    nodeSt.mirror.poolAdds += mir.counts.poolAdds; nodeSt.mirror.poolSwaps += mir.counts.poolSwaps;
    nodeSt.mirror.failed += mRes.results.filter((r) => !r.ok).length;
    nodeSt.mirror.beats++;
    log('mirror block ' + mRes.block.height + ' · ' + okN + '/' + mir.txs.length + ' applied (' + JSON.stringify(mir.counts) + ')' + (mir.overflow ? ' · overflow→next-beat' : ''));
  }
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // ── CHAINTALK-94: פס-המשימות — המשימה מכריזה-מראש, הספר מבצע-ומודד, התוצאות נכתבות-בחזרה ──
  {
  const mission = collectMissionTxs(seenRefs, bookOpByRef);
    if (mission.txs.length) {
      const r = K.buildBlock(st, mission.txs, time);
      chainState.blocks.push(r.block);
      const okN = r.results.filter((x) => x.ok).length;
      // כתיבת-התוצאות-בחזרה לפס — המנוע (chaintalk.cjs) קורא-ומשווה-מול-הניבוי
      try {
        const m = mission.mission;
        m.status = okN === mission.txs.length ? 'applied' : (okN > 0 ? 'partial' : 'rejected');
        m.appliedHeight = r.block.height;
        m.appliedAt = new Date().toISOString();
        m.results = mission.txs.map((tx, i) => ({ type: tx.type, ref: tx.ref || null, ok: r.results[i].ok, err: r.results[i].err || null, orderId: r.results[i].orderId || null, filled: r.results[i].filled || null }));
        const pfPath = path.join(AGENT_DIR, 'chaintalk_pending.json');
        const pf = JSON.parse(fs.readFileSync(pfPath, 'utf8'));
        const idx = (pf.missions || []).findIndex((x) => x.id === m.id);
        if (idx >= 0) pf.missions[idx] = m;
        fs.writeFileSync(pfPath, JSON.stringify(pf, null, 2) + '\n');
      } catch (e) { log('mission write-back failed (honest): ' + String((e && e.message) || e).slice(0, 80)); }
      log('mission block ' + r.block.height + ' · ' + okN + '/' + mission.txs.length + ' applied · mission=' + mission.id);
      await maybeCheckpoint(nodeSt, st, chainState, time);
    }
  }

  // ── STAGE-2 ECONOMY (70): SOVFLO + SOVBOOK + SOVYIELD — הרשת-שלנו מארחת-כלכלה-חיה ──
  const sov = nodeSt.sov = nodeSt.sov || { floats: 0, orders: 0, fills: 0, matches: 0, askPosts: 0, yieldDay: null, yieldSAOS: 0, skips: 0 };
  const dayK = sovDay();
  const host = await hostEvidence();

  // (1) SOVFLO-70 הצפה-מראיות + SOVBOOK-70a הזמנות-חיילים-מהמארח → בלוק-אחד
  const ecoTxs = collectFloatTxs(nodeSt, seenRefs, host).concat(collectOrderTxs(nodeSt, seenRefs));
  if (ecoTxs.length) {
    const r = K.buildBlock(st, ecoTxs, time);
    chainState.blocks.push(r.block);
    r.results.forEach((res, i) => {
      const tx = ecoTxs[i];
      if (tx.type === 'order' && tx.mirror === 'host-order' && res.ok && res.orderId && tx.hostTxid) {
        nodeSt.mirrorCursors.orders = nodeSt.mirrorCursors.orders || {};
        nodeSt.mirrorCursors.orders[tx.hostTxid] = res.orderId; // מיפוי-txid-מארח→orderId-ריבוני (ל-fills)
      }
    });
    const flN = ecoTxs.filter((t) => t.mirror === 'float-saos' || t.mirror === 'float-steem').length;
    const orN = ecoTxs.filter((t) => t.mirror === 'host-order').length;
    const okN = r.results.filter((x) => x.ok).length;
    sov.floats += flN; sov.orders += orN;
    log('economy block ' + r.block.height + ' · float+orders ' + okN + '/' + ecoTxs.length + ' (floats ' + flN + ' · orders ' + orN + ')');
  }
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // (2) SOVBOOK-70c שאלת-עומק-עומדת-של-האוצר (מתומחרת-מהמארח)
  const askTxs = standingAskTxs(nodeSt, st, seenRefs, host);
  if (askTxs.length) {
    const r = K.buildBlock(st, askTxs, time);
    chainState.blocks.push(r.block);
    r.results.forEach((res, i) => {
      const tx = askTxs[i];
      if (tx.mirror === 'ask-recycle' && res.ok) { nodeSt.sov.ask = { orderId: null, priceµ: 0 }; log('standing-ask recycled (orderId ' + tx.orderId + ')'); }
      if (tx.mirror === 'standing-ask' && res.ok && res.orderId) {
        nodeSt.sov.ask = { orderId: res.orderId, priceµ: Math.round(tx.price * 1e6) };
        sov.askPosts++;
        log('standing-ask posted id=' + res.orderId + ' @' + tx.price.toFixed(6));
      }
    });
  }
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // (3) SOVBOOK-70b fill-מארח → fill ריבוני (נגד-הזמנות-החיות-כולל-השאלה-שנוצרה-לעיל)
  const fillTxs = collectFillTxs(nodeSt, seenRefs, st);
  if (fillTxs.length) {
    const r = K.buildBlock(st, fillTxs, time);
    chainState.blocks.push(r.block);
    const okN = r.results.filter((x) => x.ok).length;
    sov.fills += okN;
    log('host-fill block ' + r.block.height + ' · ' + okN + '/' + fillTxs.length + ' filled');
  }
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // (4) SOVBOOK-70d מנוע-התאמה-ריבוני (cancel-שחרור → fill)
  const mTxs = matcherTxs(st, (nodeSt.beats || 0) + 1);
  if (mTxs.length) {
    const r = K.buildBlock(st, mTxs, time);
    chainState.blocks.push(r.block);
    const okN = r.results.filter((x) => x.ok && x.type === 'fill').length;
    sov.matches += okN;
    log('match block ' + r.block.height + ' · ' + okN + ' fills / ' + mTxs.length + ' txs');
  }
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // (4b) GRID-97c משיכת-נזילות-הגשר (חד-פעמי: mint-עודף-כיסוי + זריעת בריכת-WTRX/SAOS)
  const brTxs = gridBridgeTxs(nodeSt, st, seenRefs);
  if (brTxs.length) {
    const r = K.buildBlock(st, brTxs, time);
    chainState.blocks.push(r.block);
    const okN = r.results.filter((x) => x.ok).length;
    log('grid-bridge block ' + r.block.height + ' · ' + okN + '/' + brTxs.length + ' applied (' + brTxs.map((t) => t.type).join('+') + ')');
  }
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // (4c) GRID-97a סולם-האוצר 3×3 — מיחזור-רמות-סטות + השלמת-רמות-חסרות
  const ladTxs = gridLadderTxs(nodeSt, st, seenRefs);
  if (ladTxs.length) {
    const r = K.buildBlock(st, ladTxs, time);
    chainState.blocks.push(r.block);
    const okN = r.results.filter((x) => x.ok).length;
    const posts = ladTxs.filter((t) => t.mirror === 'grid-ask' || t.mirror === 'grid-bid').length;
    log('grid-ladder block ' + r.block.height + ' · ' + okN + '/' + ladTxs.length + ' (posts ' + posts + ' · recycles ' + (ladTxs.length - posts) + ')');
  }
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // (4d) GRID-97b ארביטראז ספר↔בריכה — סוגר-פערים לטובת-האוצר (תקדים-96)
  const arbTxs = gridArbTxs(nodeSt, st, seenRefs);
  if (arbTxs.length) {
    const r = K.buildBlock(st, arbTxs, time);
    chainState.blocks.push(r.block);
    const ok = r.results[0].ok;
    if (!ok) log('grid-arb NOT applied: ' + r.results[0].err + ' (כנות — הפער-לא-נסגר בפעימה-זו)');
  }
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // (5) SOVYIELD-70 תשואה-ריבונית-יומית-ממומנת-עמלות-השרשרת-שלנו
  const ytx = sovereignYieldTx(nodeSt, st, dayK);
  if (ytx) {
    const r = K.buildBlock(st, [ytx], time);
    chainState.blocks.push(r.block);
    if (r.results[0].ok) {
      const paidµ = ytx.payments.reduce((s, p) => s + Math.round(p.amount * 1000), 0);
      sov.yieldDay = dayK;
      sov.yieldSAOS = +(((sov.yieldSAOS || 0) + paidµ / 1000).toFixed(3));
      log('sov-yield block ' + r.block.height + ' · paid ' + paidµ / 1000 + ' SAOS → ' + ytx.payments.length + ' LP holders');
    } else log('sov-yield FAIL: ' + r.results[0].err);
  }

  // STAGE-3 (72) תגלית: בדיקת-צ'קפוינט-יחידה-בסוף-הפעימה דילגה-על @60 —
  // בלוקי-כלכלה חצו-את-הגבול (60→61) לפני-הבדיקה. מעכשיו: maybeCheckpoint
  // אחרי-כל-שלב-בנייה — הצ'קפוינט-לא-תלוי-במזל-של-גבהים.
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // ── GRID-97 יומן-רווח: הכל-נמדד-מהספר-עצמו — עמלות-אוצר/LP היום · טריידים ·
  // סוופים · סולם-חי · פער-ספר↔בריכה · נזילות-גשר-באוצר · בריכת-WTRX/SAOS ──
  {
    const g = nodeSt.grid97 = nodeSt.grid97 || {};
    if (g.day !== dayK) {
      g.day = dayK;
      g.feesTrBaseµ = (st.fees && st.fees.toTreasury) || 0;
      g.feesLpBaseµ = (st.fees && st.fees.toLp) || 0;
      g.tradesBase = st.meta.trades || 0;
      g.swapsBase = (st.meta.swaps || 0) + (st.meta.swapsW || 0);
      g.ladderPosts = 0; g.ladderRecycles = 0; g.arbEvents = 0;
    }
    g.feesTrTodayµ = Math.max(0, ((st.fees && st.fees.toTreasury) || 0) - (g.feesTrBaseµ || 0));
    g.feesLpTodayµ = Math.max(0, ((st.fees && st.fees.toLp) || 0) - (g.feesLpBaseµ || 0));
    g.feesTotalµ = (st.fees && st.fees.total) || 0;
    g.tradesToday = Math.max(0, (st.meta.trades || 0) - (g.tradesBase || 0));
    g.swapsToday = Math.max(0, ((st.meta.swaps || 0) + (st.meta.swapsW || 0)) - (g.swapsBase || 0));
    g.treasuryWtrx = (((st.accounts[ACCOUNT] || {}).wrapped || {}).WTRX || 0) / 1000;
    g.treasurySaos = ((st.accounts[ACCOUNT] || {}).saos || 0) / 1000;
    g.poolW = st.poolW ? { saos: st.poolW.saos / 1000, wtrx: st.poolW.wtrx / 1000, lp: st.poolW.lpSupply / 1000, feeBps: st.poolW.feeBps } : null;
    g.pool = { saos: st.pool.saos / 1000, steem: st.pool.steem / 1000, feeBps: st.pool.feeBps };
    g.height = st.meta.height || 0;
    g.at = new Date().toISOString();
  }

  // ── BEE-WALL-74: חומת-ה-BEE נמדדת-לתוך-השרשרת — נתיב-הצי הופך את השרשרת
  // לרושם-סיבתי: צמא-RC → ניתוב-דרך-חייל → SWAP.HIVE → BEE → ג'נזיס-HE ──
  try {
    const wallPath = path.join(AGENT_DIR, 'bee_wall.json');
    const fleetPath = path.join(AGENT_DIR, 'he_fleet_state.json');
    const wallStat = fs.existsSync(wallPath) ? fs.statSync(wallPath) : null;
    const wallFresh = wallStat && (Date.now() - wallStat.mtimeMs) < 24 * 3600 * 1000;
    if (wallFresh) {
      const wall = JSON.parse(fs.readFileSync(wallPath, 'utf8'));
      const v = wall.verdict || {};
      let fleet = null;
      try {
        const fst = JSON.parse(fs.readFileSync(fleetPath, 'utf8'));
        fleet = {
          routes: fst.routes || 0,
          beeRouted: fst.beeRouted || 0,
          swapRouted: fst.swapRouted || 0,
          probePhase: (fst.probeBook || {}).phase || 'idle',
          probeSoldier: (fst.probeBook || {}).soldier || null,
          chains: (fst.chains || []).slice(-6).map((c) => ({ at: c.at, mode: c.mode, soldier: c.soldier, legs: (c.legs || []).length, verified: (c.legs || []).filter((l) => l.verified).length })),
        };
      } catch (_) { /* fleet state optional */ }
      const note = 'bee-wall: BEE ' + (v.beeNow || 0) + '/' + (v.target || 100) + ' · gate ' + (v.gateCostSWAP || 0) + ' SWAP.HIVE · fuel ' + ((v.fuel || {}).total || 0) + ' · deficit ' + (v.deficit || 0) + ' · routes ' + ((fleet || {}).routes || 0);
      const { block: beeBlock } = K.buildBlock(st, [{ type: 'heartbeat', note: note.slice(0, 160) }], time);
      chainState.blocks.push(beeBlock);
      nodeSt.beeWall = {
        at: wall.at,
        bee: v.beeNow, target: v.target,
        gateCost: v.gateCostSWAP, askTop: v.askTop, bid: v.bid,
        fuel: v.fuel, deficit: v.deficit,
        incomeRate: v.incomeRate || null, etaDays: v.etaDays != null ? v.etaDays : null,
        binding: v.binding || null,
        pendingReleases: v.pendingReleases || null,
        sovereign: v.sovereign || null, noBridge: v.noBridge || null,
        fleet: fleet || null,
        height: beeBlock.height,
      };
      log('bee-wall block ' + beeBlock.height + ' · ' + note.slice(0, 90));
    } else {
      log('bee-wall: measurement stale/missing — run agent/bee_wall.cjs');
    }
  } catch (e) { log('bee-wall leg skipped: ' + String((e && e.message) || e).slice(0, 80)); }
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // ── VERIFY-15 (75): מטריצת-האימות של שש-הטענות כותבת-את-עצמה לשרשרת —
  // טענה→בדיקה→ראיה→בלוק: האימות הוא אירוע-סיבתי על הספר הריבוני עצמו ──
  try {
    const v15Path = path.join(AGENT_DIR, 'verify15_result.json');
    const v15Stat = fs.existsSync(v15Path) ? fs.statSync(v15Path) : null;
    const v15Fresh = v15Stat && (Date.now() - v15Stat.mtimeMs) < 24 * 3600 * 1000;
    if (v15Fresh) {
      const v15 = JSON.parse(fs.readFileSync(v15Path, 'utf8'));
      const s = v15.summary || {};
      const note = 'verify-15: claims ' + (s.verified || 0) + ' verified + ' + (s.corrected || 0) + ' corrected / ' + (s.total || 6) + ' · checks ' + (s.checksPassed || 0) + '/' + (s.checks || 0) + ' · corrections ' + ((v15.corrections || []).length);
      const { block: v15Block } = K.buildBlock(st, [{ type: 'heartbeat', note: note.slice(0, 160) }], time);
      chainState.blocks.push(v15Block);
      nodeSt.verify15 = {
        at: v15.at,
        verified: s.verified, corrected: s.corrected, failed: s.failed,
        checksPassed: s.checksPassed, checks: s.checks,
        corrections: (v15.corrections || []).map((c) => ({ rank: c.rank, field: c.field })),
        height: v15Block.height,
      };
      log('verify-15 block ' + v15Block.height + ' · ' + note.slice(0, 90));
    } else {
      log('verify-15: matrix stale/missing — run agent/verify15.cjs');
    }
  } catch (e) { log('verify-15 leg skipped: ' + String((e && e.message) || e).slice(0, 80)); }
  await maybeCheckpoint(nodeSt, st, chainState, time);

  // ── VOICE-78: פס-הפרסום של הצי כותב-את-עצמו לשרשרת — חיילים מדווחים על-השרשרת
  // במפתחות-פרסום-משלהם (steem-fleet-report) — הראיה עצמה הופכת אירוע-ריבוני ──
  try {
    const fvPath = path.join(AGENT_DIR, 'fleet_voice_result.json');
    const fvStat = fs.existsSync(fvPath) ? fs.statSync(fvPath) : null;
    const fvFresh = fvStat && (Date.now() - fvStat.mtimeMs) < 24 * 3600 * 1000;
    if (fvFresh) {
      const fv = JSON.parse(fs.readFileSync(fvPath, 'utf8'));
      const s = fv.summary || {};
      const landed = (fv.posts || []).filter((p) => p.verified).slice(0, 3).map((p) => '@' + p.author);
      const note = 'voice-78: publishing rail ' + (s.verified || 0) + '/' + (s.fired || 0) + ' verified · ' + landed.join(' ') + ' · permlink saos-fleet-report-*';
      const { block: fvBlock } = K.buildBlock(st, [{ type: 'heartbeat', note: note.slice(0, 160) }], time);
      chainState.blocks.push(fvBlock);
      nodeSt.fleetVoice = {
        at: fv.at,
        fired: s.fired, landed: s.landed, verified: s.verified, failed: s.failed,
        posts: (fv.posts || []).map((p) => ({ author: p.author, permlink: p.permlink, txid: p.txid, verified: p.verified })),
        boundaries: fv.boundaries || null,
        height: fvBlock.height,
      };
      log('voice-78 block ' + fvBlock.height + ' · ' + note.slice(0, 90));
    } else {
      log('voice-78: evidence stale/missing — run agent/fleet_voice.cjs');
    }
  } catch (e) { log('voice-78 leg skipped: ' + String((e && e.message) || e).slice(0, 80)); }

  // ── GRID-79: הצי-כגריד-מחשוב — אימות-quorum-מלא 13/13-על-אותו-checkpointHash
  // (הקרנל עצמו אוכף-ייחודיות: dup-attest — 13-חתימות-של-13-מפתחות-עצמאיים)
  // + סריקת-מישור-נתונים-מקבילה (12-חיילים × 12-פרוסות-שונות) — הראיות הופכות
  // בלוקי-attest על השרשרת הריבונית ──
  try {
    const gPath = path.join(AGENT_DIR, 'grid79_result.json');
    const gStat = fs.existsSync(gPath) ? fs.statSync(gPath) : null;
    const gFresh = gStat && (Date.now() - gStat.mtimeMs) < 24 * 3600 * 1000;
    if (gFresh) {
      const g = JSON.parse(fs.readFileSync(gPath, 'utf8'));
      const q = (g.phases || {}).quorum || {};
      const sc = (g.phases || {}).scan || {};
      const inf = g.inference || {};
      const prior = ((g.target || {}).priorAttests) || [];
      const verified = (q.results || []).filter((r) => r.verified);
      // TASK-88 LIVE-DEDUP: הקרנל-החי הוא-האמת — שליפת-החתימות-שכבר-על-השרשרת
      // עבור-ה-checkpointHash הזה (measured, לא-מהקובץ-הישן). אף-tx-נידון-לא-נשדר.
      const cpHash = (g.target || {}).checkpointHash;
      const onChain = new Set(((st.attests || {})[cpHash] || []).map((v) => String(v).toLowerCase()));
      const fresh = verified.filter((r) => !onChain.has(String(r.node).toLowerCase()));
      const sealedByChain = verified.filter((r) => onChain.has(String(r.node).toLowerCase())).length;
      const t3 = new Date().toISOString();
      const gTxs = fresh.map((r) => ({ type: 'attest', validator: r.node, checkpointHash: cpHash, time: t3 }));
      gTxs.push({
        type: 'heartbeat',
        note: (fresh.length > 0
          ? 'grid-79: quorum ' + (q.verified || 0) + '/' + (q.of || 13) + ' @cp' + (g.target || {}).height + ' (' + sealedByChain + ' on-chain-sealed + ' + fresh.length + ' new live-attest · zero-dup-broadcast) · scan ' + (sc.verified || 0) + '/' + (sc.of || 12) + ' · speedup ' + (inf.parallelSpeedup || '?') + '× · cost/op ' + (inf.costPerAttestRc || 0) + ' RC · capacity ' + (inf.sustainableOpsPerDay || 0) + ' ops/day'
          : 'grid-79: quorum @cp' + (g.target || {}).height + ' ALREADY-SEALED on-chain ' + sealedByChain + '/13 (live-dedup) · 0 dup-tx broadcast (fix-88) · scan ' + (sc.verified || 0) + '/' + (sc.of || 12)).slice(0, 160),
      });
      const { block: gBlock } = K.buildBlock(st, gTxs, t3);
      chainState.blocks.push(gBlock);
      nodeSt.grid79 = {
        at: g.at,
        target: g.target,
        quorum: { verified: q.verified, of: q.of, requiredV0: q.quorumV0Required, wallMs: q.wallMs, seqEquivalentMs: q.seqEquivalentMs, kernelEarlier: prior.length, kernelNew: fresh.length },
        scan: { verified: sc.verified, of: sc.of, wallMs: sc.wallMs },
        inference: inf,
        height: gBlock.height,
      };
      log('grid-79 block ' + gBlock.height + ' · quorum ' + (q.verified || 0) + '/' + (q.of || 13) + ' · ' + fresh.length + ' new attest-txs (' + sealedByChain + ' already-sealed live-dedup) · scan ' + (sc.verified || 0) + '/' + (sc.of || 12));
    } else {
      log('grid-79: evidence stale/missing — run agent/grid79.cjs');
    }
  } catch (e) { log('grid-79 leg skipped: ' + String((e && e.message) || e).slice(0, 80)); }

  // ── TRON-BRIDGE (90): הגשר הריבוני ⇄ TRON — עוגן-חוצת-שרשרת נכנס לספר.
  // כיוון 1 (SAOS→TRON): קידומת ה-checkpointHash מוצפנת בכמות ה-TRX (הוכחה ציבורית)
  // כיוון 2 (TRON→SAOS): ה-TXID עצמו נרשם כאן — שרשרת-תגובות שזורה בין שני הספרים ──
  try {
    const tbPath = path.join(__dirname, 'tron-bridge-state.json');
    if (fs.existsSync(tbPath)) {
      const tb = JSON.parse(fs.readFileSync(tbPath, 'utf8'));
      const freshA = (tb.anchors || []).filter((a) => a.verified && !a.notedHeight);
      if (freshA.length) {
        const a = freshA[freshA.length - 1];
        const t4 = new Date().toISOString();
        const note = ('tron-anchor: blk ' + (a.block || '?') + ' cp#' + a.cpHeight + ' amount ' + (a.amountSun / 1e6).toFixed(6) + ' TRX hash-encoded · net_fee ' + (a.netFeeSun || 0) + 'sun · txid ' + String(a.txid).slice(0, 16) + '… (90)').slice(0, 160);
        const { block: tbBlock } = K.buildBlock(st, [{ type: 'heartbeat', note }], t4);
        chainState.blocks.push(tbBlock);
        a.notedHeight = tbBlock.height;
        a.notedBlockHash = tbBlock.hash;
        tb.notedAt = t4;
        try { fs.writeFileSync(tbPath + '.tmp', JSON.stringify(tb, null, 2)); fs.renameSync(tbPath + '.tmp', tbPath); } catch (_) {}
        nodeSt.tron = {
          ...(nodeSt.tron || {}), /* (92) לשמר squadBound/pulse/derivatives — לא להחליף-הכל */
          address: tb.address || null, relay: tb.addressRelay || null,
          anchors: (tb.anchors || []).filter((x) => x.verified).length,
          lastAnchor: { cpHeight: a.cpHeight, txid: a.txid, tronBlock: a.block || null, netFeeSun: a.netFeeSun || 0, amountSun: a.amountSun, fractionHex: a.fractionHex || null, notedHeight: tbBlock.height },
          height: tbBlock.height, at: t4,
        };
        log('tron-anchor block ' + tbBlock.height + ' · cp#' + a.cpHeight + ' → ' + String(a.txid).slice(0, 16) + '… (TRON↔SAOS linked)');
      } else {
        const lastV = (tb.anchors || []).find((x) => x.verified);
        if (lastV && (!nodeSt.tron || !nodeSt.tron.lastAnchor || nodeSt.tron.lastAnchor.txid !== lastV.txid)) {
          nodeSt.tron = { ...(nodeSt.tron || {}), address: tb.address || null, anchors: (tb.anchors || []).filter((x) => x.verified).length, measuredAt: new Date().toISOString() };
        }
        /* 107 — מראה-העוגן מתרפאת-עצמה בכל פעימה (שורש-הפער-שנתפס-חי): העדכון-הישן
         * נכתב-רק-פעם-אחת-בעת-הרישום; אחרי-קריסה/החזרה-ממצב-ישן lastAnchor נשאר
         * דבוק-בעוגן-הקודם (נתפס-חי: cp#456 בזמן-שהעוגן-האמתי cp#27528 מעוגן-ומאומת).
         * המראה-קוראת-תמיד מפנקס-הגשר (מקור-האמת) — כולל notedHeight שלו. */
        const lastNoted = (tb.anchors || []).find((x) => x.verified && x.notedHeight) || lastV;
        if (lastNoted && (!nodeSt.tron || !nodeSt.tron.lastAnchor || nodeSt.tron.lastAnchor.txid !== lastNoted.txid || nodeSt.tron.lastAnchor.cpHeight !== lastNoted.cpHeight)) {
          nodeSt.tron = {
            ...(nodeSt.tron || {}),
            address: tb.address || nodeSt.tron?.address || null,
            anchors: (tb.anchors || []).filter((x) => x.verified).length,
            lastAnchor: {
              cpHeight: lastNoted.cpHeight, txid: lastNoted.txid,
              tronBlock: lastNoted.block || null, netFeeSun: lastNoted.netFeeSun || 0,
              amountSun: lastNoted.amountSun, fractionHex: lastNoted.fractionHex || null,
              notedHeight: lastNoted.notedHeight || null,
            },
            measuredAt: new Date().toISOString(),
          };
          log('tron-anchor mirror healed: cp#' + lastNoted.cpHeight + ' noted@' + (lastNoted.notedHeight || '?'));
        }
      }
    }
  } catch (e) { log('tron-bridge leg skipped: ' + String((e && e.message) || e).slice(0, 80)); }

  // ── TRON-SQUAD (91): טבעת-החיילים על TRON — הפעלה-עצמית + טבעת-לפיד אפס-עמלה נכנסות לספר.
  // שרשרת-המימון (אירוע-הון חד-פעמי) וטבעת-מקושרת-עצמית (כל-רגל ≡ קידומת txid הקודם,
  // רגל-1 ≡ checkpointHash של SAOS) — תגובת-שרשרת ציבורית על TRON ברוחב-פס חינם ──
  try {
    const tbPath = path.join(__dirname, 'tron-bridge-state.json');
    if (fs.existsSync(tbPath)) {
      const tb = JSON.parse(fs.readFileSync(tbPath, 'utf8'));
      const sq = tb.squad || {};
      const saveTb = () => { try { fs.writeFileSync(tbPath + '.tmp', JSON.stringify(tb, null, 2)); fs.renameSync(tbPath + '.tmp', tbPath); } catch (_) {} };
      // 91a: שרשרת-ההפעלה-העצמית — נרשמת-פעם-אחת כשכל-החיילים-מופעלים-וכל-הקפיצות-מאומתות
      const allFundingVerified = (sq.funding || []).length === (sq.indices || []).length && (sq.funding || []).every((f) => f.verified);
      const freshF = allFundingVerified && (sq.funding || []).every((f) => !f.notedHeight) && (sq.members || []).filter((m) => m.activated).length === (sq.indices || []).length;
      if (freshF) {
        const t5 = new Date().toISOString();
        const bl = sq.burnLedger || {};
        const note = ('tron-squad: ' + (sq.funding || []).length + ' soldiers activated via self-propagating chain sender→s2→s3→s4→s5 · one-time burn ' + ((bl.totalSun || 0) / 1e6).toFixed(2) + ' TRX · txids ' + (sq.funding || []).map((f) => String(f.txid).slice(0, 10)).join('·') + '… (91)').slice(0, 160);
        const { block: fBlock } = K.buildBlock(st, [{ type: 'heartbeat', note }], t5);
        chainState.blocks.push(fBlock);
        (sq.funding || []).forEach((f) => { f.notedHeight = fBlock.height; f.notedBlockHash = fBlock.hash; });
        tb.notedAt = t5; saveTb();
        nodeSt.tron = {
          ...(nodeSt.tron || {}),
          squad: { activated: (sq.members || []).filter((m) => m.activated).length, ringsClosed: (sq.rings || []).filter((r) => r.closed && r.verified).length, fundingBlock: fBlock.height, at: t5 },
        };
        log('tron-squad block ' + fBlock.height + ' · ' + (sq.funding || []).length + ' soldiers activated (self-propagating) · burn ' + ((bl.totalSun || 0) / 1e6).toFixed(2) + ' TRX one-time (91)');
      }
      // 91b: טבעת-סגורה-ומאומתת — כל-הרגליים-על-השרשרת → בלוק-אחד-עם-כל-ה-TXIDs
      const freshR = (sq.rings || []).filter((r) => r.closed && r.verified && !r.notedHeight && (r.legs || []).length === (sq.indices || []).length);
      if (freshR.length) {
        const r = freshR[freshR.length - 1];
        const t5 = new Date().toISOString();
        const ringFee = (r.legs || []).reduce((s2, l) => s2 + (l.netFeeSun || 0), 0);
        const note = ('tron-squad: ring#' + r.id + ' closed on TRON · ' + (r.legs || []).length + ' legs zero-fee (net_fee=' + ringFee + 'sun) · self-linked amounts · txids ' + (r.legs || []).map((l) => String(l.txid).slice(0, 10)).join('·') + '… (91)').slice(0, 160);
        const { block: rBlock } = K.buildBlock(st, [{ type: 'heartbeat', note }], t5);
        chainState.blocks.push(rBlock);
        r.notedHeight = rBlock.height; r.notedBlockHash = rBlock.hash;
        (r.legs || []).forEach((l) => { l.notedHeight = rBlock.height; });
        tb.notedAt = t5; saveTb();
        nodeSt.tron = {
          ...(nodeSt.tron || {}),
          squad: { ...(nodeSt.tron && nodeSt.tron.squad ? nodeSt.tron.squad : {}), lastRing: { id: r.id, legs: (r.legs || []).length, zeroFee: ringFee === 0, notedHeight: rBlock.height }, at: t5 },
        };
        log('tron-squad block ' + rBlock.height + ' · ring#' + r.id + ' closed · ' + (r.legs || []).length + ' zero-fee legs (TRON→SAOS sealed)');
      } else {
        /* 107 — מראת-הטבעת מתרפאת-עצמה בכל פעימה (אותו-שורש-של-מראת-העוגן):
         * העדכון-הישן היה-חד-פעמי-בעת-הרישום; אחרי-קריסה/החזרה-ממצב-ישן lastRing
         * נשאר-דבוק-בטבעת-קודמת (נתפס-חי: lastRing id=2 בזמן-ש-RING#3 מאומתת-ומאושרת
         * בספר @32915). המראה-קוראת-תמיד מפנקס-הגשר (מקור-האמת). */
        const lastNotedRing = (sq.rings || []).find((r) => r.closed && r.verified && r.notedHeight);
        const curRing = nodeSt.tron && nodeSt.tron.squad && nodeSt.tron.squad.lastRing;
        if (lastNotedRing && (!curRing || curRing.id !== lastNotedRing.id || curRing.notedHeight !== lastNotedRing.notedHeight)) {
          const ringFee = (lastNotedRing.legs || []).reduce((s2, l) => s2 + (l.netFeeSun || 0), 0);
          nodeSt.tron = {
            ...(nodeSt.tron || {}),
            squad: { ...(nodeSt.tron && nodeSt.tron.squad ? nodeSt.tron.squad : {}), lastRing: { id: lastNotedRing.id, legs: (lastNotedRing.legs || []).length, zeroFee: ringFee === 0, notedHeight: lastNotedRing.notedHeight }, at: new Date().toISOString() },
          };
          log('tron-squad mirror healed: ring#' + lastNotedRing.id + ' noted@' + lastNotedRing.notedHeight);
        }
      }
    }
  } catch (e) { log('tron-squad leg skipped: ' + String((e && e.message) || e).slice(0, 80)); }

  // ── TRON-SQUAD-BOUND (92a): ארנק-ה-TRON נקשר-רשמית-כחייל-על-המערכת-שלנו ──
  // 6 כתובות-ריבוניות (שדרן·רכזת·s2..s5 — כולן מה-vault-היחיד) נרשמות-כחיילים
  // בעלי-תפקיד בספר-הריבוני: הפעלה-עצמית-מאומתת + טבעת-אפס-עמלה-מאומתת = הזכאות.
  // נרשם-פעם-אחת; הכתובות-המלאות-חיות-ב-metric-הגשר-וב-TronScan (אפס-סודות).
  try {
    const tbPathB = path.join(__dirname, 'tron-bridge-state.json');
    if (fs.existsSync(tbPathB)) {
      const tbB = JSON.parse(fs.readFileSync(tbPathB, 'utf8'));
      const sqB = tbB.squad || {};
      const boundReady = (sqB.funding || []).length === (sqB.indices || []).length
        && (sqB.funding || []).every((f) => f.verified)
        && (sqB.rings || []).some((r) => r.closed && r.verified)
        && !(tbB.squadBound && tbB.squadBound.notedHeight);
      if (boundReady) {
        const t6 = new Date().toISOString();
        const addrs = [tbB.address, tbB.addressRelay].concat(tbB.squadAddresses || []).filter(Boolean);
        const blB = sqB.burnLedger || {};
        const note = ('tron-squad-bound: TRON wallet bound as soldiers of SAOS-NET — ' + addrs.length + ' sovereign addresses (s0 sender · s1 relay · s2..s5 squad) · one-time burn ' + ((blB.totalSun || 0) / 1e6).toFixed(2) + ' TRX · ring#1 zero-fee · proofs on TRON (92)').slice(0, 160);
        const { block: bBlock } = K.buildBlock(st, [{ type: 'heartbeat', note }], t6);
        chainState.blocks.push(bBlock);
        tbB.squadBound = { at: t6, notedHeight: bBlock.height, notedBlockHash: bBlock.hash, count: addrs.length, addresses: addrs };
        try { fs.writeFileSync(tbPathB + '.tmp', JSON.stringify(tbB, null, 2)); fs.renameSync(tbPathB + '.tmp', tbPathB); } catch (_) {}
        nodeSt.tron = { ...(nodeSt.tron || {}), squadBound: { notedHeight: bBlock.height, count: addrs.length, at: t6 } };
        log('tron-squad-bound block ' + bBlock.height + ' · ' + addrs.length + ' TRON addresses bound as soldiers (92)');
      } else if (tbB.squadBound && tbB.squadBound.notedHeight) {
        /* (92) השתקפות-מתמדת — הקשירה-כבר-על-הספר, המדינה-תמיד-מציגה */
        nodeSt.tron = { ...(nodeSt.tron || {}), squadBound: { notedHeight: tbB.squadBound.notedHeight, count: tbB.squadBound.count || (tbB.squadBound.addresses || []).length, at: tbB.squadBound.at } };
      }
    }
  } catch (e) { log('tron-squad-bound leg skipped: ' + String((e && e.message) || e).slice(0, 80)); }

  // ── TRON-PULSE (92b): אינטרליבינג 24/7 — הרשת-שלנו-שזורה-בזרם-החי-של-TRON ──
  // כל-פעימה קוראת את הבלוק-המאושר-האחרון של TRON (קריאה-בלבד, אפס-עלות) → state.
  // כל-Δ1200 בלוקי-TRON (≈שעה) נחתם-בלוק-עדות-על-הספר: אם-המארח-נופל —
  // זרם-TRON-מחזיק-את-רצף-העדויות-האחרון; כל-אחד-יכול-לאמת-את-הגיל-של-הספר.
  try {
    const t7 = new Date().toISOString();
    const nowBlk = await new Promise((resolve) => {
      const req = require('https').get({ hostname: 'api.trongrid.io', path: '/walletsolidity/getnowblock', family: 4, timeout: 8000 }, (res) => {
        let d = ''; res.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve(null); } });
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
    });
    const pNum = nowBlk && nowBlk.block_header && nowBlk.block_header.raw_data && Number(nowBlk.block_header.raw_data.number || 0);
    const pId = (nowBlk && nowBlk.blockID) || null;
    if (pNum) {
      const head = chainState.blocks[chainState.blocks.length - 1];
      nodeSt.tron = { ...(nodeSt.tron || {}), pulse: { tronHeight: pNum, tronBlockId: pId ? String(pId).slice(0, 20) : null, at: t7 } };
      const tbPathP = path.join(__dirname, 'tron-bridge-state.json');
      let lastPulseH = null, tbP = null;
      if (fs.existsSync(tbPathP)) {
        try { tbP = JSON.parse(fs.readFileSync(tbPathP, 'utf8')); lastPulseH = ((tbP || {}).pulse || {}).tronHeight || null; } catch (_) {}
      }
      if (!lastPulseH || (tbP && tbP.pulse && !tbP.pulse.notedHeight) || pNum - lastPulseH >= 1200) {
        /* (92) פעימה-ראשונה-מעולם → מיד; אחר-כך כל-Δ1200 בלוקי-TRON (≈שעה) */
        const note = ('tron-pulse: SAOS h' + (head ? head.height : '?') + ' ↔ TRON solid blk ' + pNum + ' id ' + String(pId).slice(0, 16) + '… · Δ' + (lastPulseH ? pNum - lastPulseH : 0) + ' tron-blocks · 24/7 interleaved liveness (92)').slice(0, 160);
        const { block: pBlock } = K.buildBlock(st, [{ type: 'heartbeat', note }], t7);
        chainState.blocks.push(pBlock);
        nodeSt.tron.pulse.notedHeight = pBlock.height;
        if (tbP) {
          tbP.pulse = { tronHeight: pNum, at: t7, notedHeight: pBlock.height };
          try { fs.writeFileSync(tbPathP + '.tmp', JSON.stringify(tbP, null, 2)); fs.renameSync(tbPathP + '.tmp', tbPathP); } catch (_) {}
        }
        log('tron-pulse block ' + pBlock.height + ' · TRON blk ' + pNum + ' (24/7 interleaving, 92)');
      }
    } else {
      nodeSt.tron = { ...(nodeSt.tron || {}), pulse: { error: 'trongrid unreachable (honest)', at: t7 } };
      log('tron-pulse: trongrid unreachable — honest mark, no fake (92)');
    }
  } catch (e) { log('tron-pulse leg skipped: ' + String((e && e.message) || e).slice(0, 80)); }

  // ── TRON-DERIVATIVES (92c): נגזרות-בגריד — USDT-TRC20 ניטור-קריאה-בלבד ──
  // הגשר-מודד (watch) יתרות-USDT לכל-הכתובות-הריבוניות; כאן-הגריד-חוטף-את-המדידה:
  // חימוש-חד-פעמי-על-הספר + אירוע-מיידי-כשערך-נכנס (usdt>0) — תשתית-המשק-העתידית.
  try {
    const tbPathD = path.join(__dirname, 'tron-bridge-state.json');
    if (fs.existsSync(tbPathD)) {
      const tbD = JSON.parse(fs.readFileSync(tbPathD, 'utf8'));
      const dv = tbD.derivatives || null;
      if (dv && Array.isArray(dv.usdt)) {
        const usdtTotal = dv.usdt.reduce((s, x) => s + (x.usdt || 0), 0);
        nodeSt.tron = { ...(nodeSt.tron || {}), derivatives: { usdtTotal, measured: dv.measured || null, at: dv.at, readOnly: true } };
        if (!(tbD.derivArmed && tbD.derivArmed.notedHeight)) {
          const t8 = new Date().toISOString();
          const note = ('tron-derivatives: watch armed — USDT-TRC20 read-only monitor on 6 sovereign addresses · measured ' + (dv.measured || '?') + ' · total ' + usdtTotal + ' USDT · zero-burn (92)').slice(0, 160);
          const { block: dBlock } = K.buildBlock(st, [{ type: 'heartbeat', note }], t8);
          chainState.blocks.push(dBlock);
          tbD.derivArmed = { at: t8, notedHeight: dBlock.height };
          try { fs.writeFileSync(tbPathD + '.tmp', JSON.stringify(tbD, null, 2)); fs.renameSync(tbPathD + '.tmp', tbPathD); } catch (_) {}
          nodeSt.tron.derivatives.notedHeight = dBlock.height;
          log('tron-derivatives armed block ' + dBlock.height + ' (92)');
        } else if (usdtTotal > 0 && tbD.derivLastTotal !== usdtTotal) {
          const t8 = new Date().toISOString();
          const note = ('tron-derivatives: VALUE-IN — ' + usdtTotal + ' USDT detected on sovereign addresses (event-block, read-only proof) (92)').slice(0, 160);
          const { block: vBlock } = K.buildBlock(st, [{ type: 'heartbeat', note }], t8);
          chainState.blocks.push(vBlock);
          tbD.derivLastTotal = usdtTotal;
          try { fs.writeFileSync(tbPathD + '.tmp', JSON.stringify(tbD, null, 2)); fs.renameSync(tbPathD + '.tmp', tbPathD); } catch (_) {}
          nodeSt.tron.derivatives.valueInNotedHeight = vBlock.height;
          log('tron-derivatives VALUE-IN block ' + vBlock.height + ' · ' + usdtTotal + ' USDT (92)');
        }
      }
    }
  } catch (e) { log('tron-derivatives leg skipped: ' + String((e && e.message) || e).slice(0, 80)); }

  await maybeCheckpoint(nodeSt, st, chainState, time);

  // EXPLORER-71 — תיעוד-הרשת-על-הרשת (publication ציבורי, אחרי-הצ'קפוינט-כדי-שינשא-את-האחרון)
  if (LIVE) await explorerPublish(nodeSt, st, chainState);

  // עיגון-חוזר-סבלני: צ'קפוינט-אחרון-בלי-anchor-Steem → נסה-שוב (רג'ן-RC)
  if (LIVE) {
    const lastCp = nodeSt.checkpoints[nodeSt.checkpoints.length - 1];
    if (lastCp && lastCp.anchors && !lastCp.anchors.steem) {
      const rc = await rcPct(ACCOUNT);
      if (rc >= RC_GATE_HEAD) {
        const retryPayload = { action: 'checkpoint', net: NET, height: lastCp.height, stateRoot: lastCp.stateRoot, genesisHash: nodeSt.genesisHash, checkpointHash: lastCp.checkpointHash, retry: true, time };
        const aS = await anchorSteem(retryPayload);
        if (aS.txid) {
          lastCp.anchors.steem = aS.txid;
          nodeSt.pendingVerifies.push({ txid: aS.txid, kind: 'steem-anchor', at: new Date().toISOString() });
          log('steem-anchor RETRY ✓ height=' + lastCp.height + ' txid=' + aS.txid);
        } else log('steem-anchor RETRY fail: ' + (aS.skip || aS.err || '?'));
      } else log('steem-anchor RETRY deferred — head RC ' + rc.toFixed(0) + '%');
    }
  }

  // אימות-פתוחים (max 2/beat — סבלנות מול עיכוב-אינדוקס) · 99 — פאזת-רשת-פתוחה
  commitTail(nodeSt, chainState, st); /* חיוב-בלוקים-שנבנו-לדיסק — המנוע-ימשיך-מהם, לא-מזלג */
  releaseLock(); holds = false;
  if (LIVE) {
    const pend = [];
    let checks = 0;
    for (const p of nodeSt.pendingVerifies) {
      // TASK-89: hive-anchor לעולם-לא-נשכח — txid=null → אימות-מהיסטוריית-החותם-החיה
      if (checks < 2 && !p.txid && !p.verified && !p.exhausted && p.kind === 'hive-anchor' && p.by && p.time) {
        checks++;
        try {
          const hist = await hiveSaosHistory(p.by);
          const match = hist.find((h) => h.payload && h.payload.time === p.time && h.payload.action === 'checkpoint');
          p.verified = !!match;
          p.attempts = (p.attempts || 0) + 1;
          if (match) {
            p.txid = match.trx; p.block = match.block; p.verifiedVia = 'hive-history-read-back (89)';
            for (const cp of nodeSt.checkpoints) {
              const a = cp.anchors && cp.anchors.hive;
              const isPend = typeof a === 'string' && a.startsWith('pending:');
              if ((isPend && a.slice(8) === p.by || a === undefined || a === null) && Number(cp.height) === Number(match.payload.height)) {
                cp.anchors.hive = { verified: true, txid: match.trx, block: match.block, by: p.by, at: new Date().toISOString(), backfilled: !isPend };
              }
            }
            log('pending hive-anchor VERIFIED via history @' + p.by + ' blk=' + match.block);
          } else if (p.attempts >= 12) { p.exhausted = true; log('pending hive-anchor exhausted @' + p.by + ' — stays honest-unverified'); }
        } catch (e) { p.attempts = (p.attempts || 0) + 1; log('pending hive-anchor verify ERR: ' + String((e && e.message) || e).slice(0, 60)); }
        if (!p.exhausted) pend.push(p);
        continue;
      }
      if (checks < 2 && p.txid && !p.verified && (p.kind === 'steem-anchor' || p.kind === 'attest' || p.kind === 'explorer-pub' || p.kind === 'produce' || p.kind === 'roster-pub')) {
        checks++;
        const v = await verifyTxid(p.txid);
        p.verified = v.verified; p.node = v.node; p.block = v.block; p.attempts = (p.attempts || 0) + 1;
        if (v.verified) {
          nodeSt.verified.push(p.txid);
          // EXPLORER-71: סנכרון-הדגל-על-רשומת-ה-publication עצמה
          if (p.kind === 'explorer-pub') {
            const ex = nodeSt.explorer = nodeSt.explorer || { publishes: [] };
            for (const pub of ex.publishes || []) if (pub.txid === p.txid) pub.verified = true;
          }
          // STAGE-3 (72): סנכרון-הדגל-על-המנדט ועל-פרסום-הרוסטר
          if (p.kind === 'produce' && p.round !== undefined) {
            const rec = ((nodeSt.rot || {}).rounds || {})[p.round];
            if (rec) rec.verified = true;
          }
          if (p.kind === 'roster-pub') {
            for (const rp of ((nodeSt.rot || {}).rosterPubs || [])) if (rp.txid === p.txid) rp.verified = true;
          }
          log('pending ' + p.kind + ' VERIFIED blk=' + v.block + ' @' + v.node); continue;
        }
        if (p.attempts >= 12) { p.exhausted = true; continue; }
      }
      if (!p.exhausted) pend.push(p);
    }
    nodeSt.pendingVerifies = pend.slice(-16);
  }
  /* 99 — חזרה-למנעול לפני-saveAll + סנכרון-זנב */
  if (!(await reacquireSpin())) { log('BEAT ABORT — lock lost after verify phase (GRID-99, honest)'); return; }
  holds = true;
  if (!catchUpTail(st, chainState)) { log('BEAT ABORT — state fork after verify phase (GRID-99, honest)'); return; }
  /* 112 — מילוי-אחורה של attests מהמארח — כאן-בדיוק: אחרי-התפיסה-מחדש, ממש-לפני-saveAll,
   * כדי-שאפילו-ABORT-מאוחר-יותר לא-יזרוק-את-הראיות-הציבוריות שהפעימה-הקודמת שידרה. */
  try { const bf = await backfillAttests(nodeSt); if (bf) log('attest-BACKFILL: ' + bf + ' ראיות-חוזרות-מהמארח הפעם'); } catch (e) { log('attest-BACKFILL err (honest): ' + String((e && e.message) || e).slice(0, 80)); }

  // dedupe-צ'קפוינטים-לגובה (תמיד — לא-רק-בענף-צ'קפוינט)
  nodeSt.checkpoints = nodeSt.checkpoints.filter((c, i, arr) => i === arr.length - 1 || arr[i + 1].height !== c.height);

  saveAll(nodeSt, chainState, st);
  log('BEAT DONE · height=' + st.meta.height + ' · stateRoot=' + K.stateRoot(st).slice(0, 16) + '…');
  } finally { if (holds) releaseLock(); }
}

function show() {
  const st = loadNodeState();
  const chain = loadChain();
  console.log(JSON.stringify({ ...st, blocksKept: chain.blocks.length, truncated: chain.truncated }, null, 2));
}

/* --inject file.json — קונסולת-מפעיל (W2): בלוק-אחד של txs (stamp/witness) תחת-הנעילה.
   נתיב-ההזרקה-הכנה עד-שה-API (W3) יגיש-דרך-הצומת. הקרנל מאמת-הכל — הזרקה-רעה =
   דחייה-כנה בתוך-הבלוק. הקובץ נמחק-בהצלחה (one-shot). */
async function injectRun(file) {
  let txs;
  try { txs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { log('inject: cannot read ' + file + ': ' + e.message); return; }
  if (txs && typeof txs === 'object' && Array.isArray(txs.txs)) txs = txs.txs;
  if (!Array.isArray(txs) || !txs.length) { log('inject: no txs in ' + file); return; }
  const genesis = JSON.parse(fs.readFileSync(GENESIS_FILE, 'utf8'));
  const chainState = loadChain();
  /* W3-fix: ה-replay מהארכיון-המלא — אותו-דפוס בדיוק כמו-ה-beat (תגלית-519).
   * החלון-החם מפגר-מאחר — replay-ממנו בנה בלוקים-מקבילים (ה-API חשף-זאת חי). */
  let replayBlocks = chainState.blocks;
  try {
    const archLines = fs.readFileSync(ARCHIVE_FILE, 'utf8').trim().split('\n');
    const full = [];
    for (let i = 1; i < archLines.length; i++) { try { full.push(JSON.parse(archLines[i])); } catch (_) {} }
    /* 109 — גן-הגנה-לשחזור: הארכיון-המתוקן ייחודי-לגובה, ובכל-זאת last-wins-בזיכרון
     * (הלקח-מ-510-השכפולים: שני-כותבים-מקביליים — אף-replay לא ייישם גובה-פעמיים). */
    const byH = new Map();
    for (const b of full) if (b && Number.isInteger(b.height)) byH.set(b.height, b);
    const fullDedup = [...byH.values()];
    if (fullDedup.length && (!chainState.blocks.length || fullDedup[0].height <= chainState.blocks[0].height)) replayBlocks = fullDedup;
  } catch (_) { /* אין-ארכיון — חלון (כנות) */ }
  const st = K.initFromGenesis(genesis);
  st.meta.issuer = ACCOUNT;
  for (const b of replayBlocks) for (const tx of b.txs) K.applyTx(st, tx);
  /* 109 — תיקון-שורשי: הגובה = הגובה-האמת של-בלוק-הזנב (לא-מספר-השורות!).
   * הלקח-הקריטי: עם-פערים-היסטוריים-בארכיון, length ≠ גובה — ההנחה-הזאת בנתה
   * בלוק-מתחת-לראש (fork ב-h37851) שהצית-חזרה-דלתות-סגורות (door5-חזרה). */
  const tailBlk = replayBlocks[replayBlocks.length - 1];
  st.meta.height = Math.max(st.meta.height, tailBlk ? tailBlk.height : 0);
  st.meta.lastBlockHash = tailBlk ? tailBlk.hash : null;
  st.meta.lastTime = replayBlocks.length ? replayBlocks[replayBlocks.length - 1].time : st.meta.lastTime;
  const nodeSt = loadNodeState();
  /* סנכרון-ארכיון (93) — גובה-הארכיון הוא-האמת — מונע-אפנד-כפול/גאפ */
  try {
    const archLines = fs.readFileSync(ARCHIVE_FILE, 'utf8').trim().split('\n');
    for (let i = archLines.length - 1; i >= 0; i--) {
      try { const ab = JSON.parse(archLines[i]); if (ab && ab.height) { nodeSt.archiveHeight = Math.max(nodeSt.archiveHeight || 0, ab.height); break; } } catch (_) {}
    }
  } catch (_) {}
  const lk = acquireLock();
  if (!lk.ok) { log('inject SKIPPED — beat lock held (pid ' + lk.holder.pid + ')'); return; }
  try {
    const time = new Date().toISOString();
    const res = K.buildBlock(st, txs, time);
    chainState.blocks.push(res.block);
    const okN = res.results.filter((r) => r.ok).length;
    res.results.forEach((r, i) => { if (!r.ok) log('inject tx[' + i + '] ' + (txs[i] && txs[i].type) + ' REJECTED: ' + r.err); });
    await maybeCheckpoint(nodeSt, st, chainState, time);
    saveAll(nodeSt, chainState, st);
    log('INJECT DONE · ' + okN + '/' + txs.length + ' applied · height=' + st.meta.height + ' · stateRoot=' + K.stateRoot(st).slice(0, 16) + '…');
    try { fs.unlinkSync(file); } catch (_) {}
  } finally { releaseLock(); }
}

async function main() {
  if (process.argv.includes('--selftest')) {
    const t = K.selfTest();
    const ROT_ROOT = 'b8ee2ee80377b1004a16c456c213f0e9085b3661057f10b350b6c2d864bc7137'; // וקטור-רוטציה קבוע (72)
    const rot = K.selfTestRotation();
    const ok = t.replay && t.finalRoot === '366ad47703426892cd51ffaa10f639d97bf8b5ca985eb29bf733bedb01b7082d'
      && rot.replay && rot.dupGuard && rot.finalRoot === ROT_ROOT;
    console.log('kernel vectors: ' + (ok ? 'OK' : 'BROKEN') + ' · final=' + t.finalRoot + ' · rotation=' + rot.finalRoot.slice(0, 8) + '…');
    process.exit(ok ? 0 : 1);
  }
  if (process.argv.includes('--show')) { show(); return; }
  if (process.argv.includes('--inject')) {
    const i = process.argv.indexOf('--inject');
    const file = process.argv[i + 1];
    if (!file) { log('inject: missing file argument'); process.exit(1); }
    return injectRun(file);
  }
  if (process.argv.includes('--boot')) return boot();
  return beat();
}
if (require.main === module) main().catch((e) => { log('FATAL ' + ((e && e.message) || e)); process.exit(1); });

/* 98 — GRID-98: מנוע-הזרימה-הגבוהה יורש-את-משמעת-הקבצים של-הצומת (נעילה/שמירה/טעינה)
 * דרך-module זה — סופר-קובץ-אחד (beat.lock) ואותו-פרוטוקול-ארכיון. אין-שכפול-לוגיקה. */
module.exports = {
  acquireLock, releaseLock, loadChain, loadNodeState, saveAll, maybeCheckpoint, log,
  appendTail, archiveTailHeight, /* 99b — מגן-זנב-קובץ משותף לכל-הכותבים */
  ACCOUNT, NET, NODE_DIR, STATE_FILE, CHAIN_FILE, ARCHIVE_FILE, GENESIS_FILE, AGENT_DIR,
  MAX_BLOCKS_KEPT, CHECKPOINT_EVERY, LOCK_FILE, LOCK_STALE_MS, ECON_CAPS,
};
