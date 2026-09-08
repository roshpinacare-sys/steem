#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * 108 — THE-DOOR RELAYER (דבר-גורר-דבר) · מבצע-החוזים-החכמים-החינמיים
 *
 * הרעיון (מהמשתמש, 107): הרשת-שלנו חינם — חוזה-חכם עליה מכריח טרנזקציה על
 * רשת-מרוחקת בלי לשלם גז/עמלה/אנרגיה. ה-relayer הוא היד שמבצעת:
 *
 *   relay (אפס-גז על SAOS-NET) ──► מבצע-באמת על הרשת-המרוחקת ──► relay_ack
 *   (steem custom_json = אפס עמלה, RC בלבד) · (tron = Bandwidth חינם להעברה-
 *   קטנה, מימון-מותר מהארנק) · (blurt = אפס עמלה, צמתים-מתים נכון-לעכשיו —
 *   נשאר-בתור בכנות) ──► payload.next = הדלת-הבאה (שרשרת-דלתות עם עומק-
 *   מוגבל, אנטי-לולאה).
 *
 * פקודות:
 *   status   — לוח-ה-relay החי
 *   issue    — הצתה: מזריק relay אחד כ-headcorner (seq מהמצב-החי)
 *   once     — מעבר-אחד: מבצע queued → מזריק relay_ack (+ הדלת-הבאה אם chain)
 *   watch    — לולאה כל 45 שניות
 *
 * דיסציפלינה: אותו-נעילה/ארכיון/קרנל של הצומת (saosnet --inject) — הקרנל
 * מאמת-הכל; זריקה-רעה נדחית-כנה. הלוג relay-doors.log.
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dns').setDefaultResultOrder('ipv4first'); // HE lesson: family-4 first
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const SNAPSHOT = path.join(HERE, 'state-snapshot.json');
const DOORLOG = path.join(HERE, 'relay-doors.log');
const TICK = 45000;
const MAX_TRIES = 50;

/* 117g — תובנה-חיה: הדלת-נתקעה-שעות-על-"no-free-bandwidth" כשהאמת-היא
 * שהשולחים-הקבועים [1,0] ריקים-לגמרי (0 TRX) — והודעת-השגיאה-שיקרה.
 * התיקון-המשולש: (1) גילוי-שולח-חי-על-פני-כל-הדלתות-הנשלטות (relay-idx 0..5
 * + 12 דלתות-הרישום-הריבוני — הכל-מהכספת, אפס-מפתחות-בקוד) · (2) כנות:
 * no-funded-sender ≠ no-free-bandwidth · (3) נסיגה-רכה-מקומית — דלת-שנכשלה
 * נסה-כל-15 דק' במקום-כל-45 שניות (ספר-fails מקומי — הספר-הריבוני-לא-מתלכלך). */
const SENDERS_CACHE = path.join(HERE, 'relay-senders.json');
const FAILS_FILE = path.join(HERE, 'relay-fails.json');
const SENDERS_TTL_MS = 600_000;   // 10 דק' — מנגנון-ה-cache חוסך-~36 קריאות-RPC-לניסיון
const BACKOFF_AFTER = 8;          // אחרי-8 כשלות-רצופות
const BACKOFF_MS = 900_000;       // 15 דק' נסיגה-רכה
const ACTIVATION_HEADROOM_SUN = 1_500_000; // העברה-לכתובת-לא-מופעלת = עמלת-הפעלה-מהשולח
const FEE_HEADROOM_SUN = 60_000;

const S = require(path.join(HERE, 'saosnet.cjs'));
const ACCOUNT = S.ACCOUNT;           // 'headcorner' — מפעיל-הצומת ומנפיק-הדלתות
const steem = require(path.join(ROOT, 'node_modules', 'steem'));
const TronWeb = require(path.join(ROOT, 'node_modules', 'tronweb'));
const VAULT = require(path.join(HERE, 'vault-lib.cjs')); // 114 — הקריאה-דרך-הכספת (envelope→plaintext)
const RPC = 'https://api.trongrid.io';
/* 117h — KEYFILE/קריאת-מנמוניק-legacy הוסרו: המנמוניק נשחת-ב-115 (postmortem 5da5cfb)
 * וכל-חומר-הדלתות נגזר-מהזרע-הריבוני (למטה) — אין-עוד-תלות-במפתח-מת. */

const dlog = (m) => {
  const line = '[' + new Date().toISOString() + '] ' + m;
  try { fs.appendFileSync(DOORLOG, line + '\n'); } catch (_) {}
  console.log(line);
};

function loadEnvWif() {
  /* אותו-מקור כמו saosnet: agent/.env POSTING_WIF (ראש) · fallback: הכספת (114) ואז vault.json */
  try {
    const env = fs.readFileSync(path.join(ROOT, 'agent', '.env'), 'utf8');
    const m = env.match(/^POSTING_WIF\s*=\s*(\S+)/m);
    if (m) return m[1];
  } catch (_) {}
  try {
    const v = VAULT.readMember('vault.json');
    const me = (v.accounts || []).find((a) => String(a.username).toLowerCase() === ACCOUNT);
    if (me && me.keys && me.keys.posting && me.keys.posting.wif) return me.keys.posting.wif;
  } catch (_) {}
  return null;
}

function readRelayState() {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const st = snap.st || {};
  return { snap, relay: st.relay || { nextBy: {}, open: {}, log: [], sent: 0, issued: 0 }, metaIssuer: String(st.meta && st.meta.issuer || '').toLowerCase() };
}

/* ── הזרקה דרך שער-הצומת (אותו-נעילה, אותו-קרנל) · ניסיון-חוזה על-מנעול-עמוס (108-fix) ── */
function inject(txs, tag) {
  const f = path.join(HERE, 'inject-relay-' + Date.now() + '.json');
  fs.writeFileSync(f, JSON.stringify(txs));
  const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {} };
  let out = '', ok = false, skipped = false;
  for (let a = 0; a < 4 && !ok; a++) {
    if (a > 0) sleepSync(4000); // ה-beat מחזיק-מנעול במהלך CATCH-UP — ממתינים-בכבוד
    const r = spawnSync('node', [path.join(HERE, 'saosnet.cjs'), '--inject', f], { cwd: HERE, encoding: 'utf8', timeout: 120000 });
    out = (r.stdout || '') + (r.stderr || '');
    ok = /INJECT DONE/.test(out);
    skipped = /SKIPPED/.test(out);
    if (ok || !skipped) break;
  }
  try { fs.unlinkSync(f); } catch (_) {}
  dlog('inject[' + tag + '] ' + (ok ? 'OK' : skipped ? 'LOCK-BUSY(4 tries)' : 'FAIL') + ' :: ' + out.split('\n').filter((l) => /INJECT|REJECT|SKIPPED/.test(l)).slice(0, 3).join(' | '));
  return ok;
}

/* ── דלת STEEM — custom_json אפס-עמלה (RC בלבד) ── */
async function doorSteem(r) {
  const wif = loadEnvWif();
  if (!wif) throw new Error('no-posting-wif');
  const op = ['custom_json', {
    required_auths: [], required_posting_auths: [ACCOUNT], id: 'saos',
    json: JSON.stringify({ protocol: 'saos:relay/v1', action: 'relay', ref: r.ref, via: r.via, act: r.act, payload: r.payload || {}, time: new Date().toISOString() }),
  }];
  const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [wif]);
  const txid = conf && conf.id;
  if (!txid) throw new Error('no-txid');
  return { txid: String(txid), spentSun: 0 }; // steem: אפס-עמלה מובנה (RC בלבד)
}

/* ── דלת TRON — העברה-קטנה על Bandwidth-חינם, רק-לכתובות-גזורות-משלנו (בטיחות) ──
 * 117h — deriveIdx מאותחל-על-הזרע-הריבוני: היה-נגזר-ממנמוניק-הגשר-הlegacy (מת-ב-115,
 * postmortem 5da5cfb) — ה-ENOENT-שלו-היה-השקר-האחרון-של-הדלת. המשפחה relay-idx 0..5
 * נוסדת-מחדש-על-נתיב-עצמאי-מהזרע: sha256(seed+'|tron|relay|44/195') → m/44'/195'/0'/0/i.
 * כתובות-חדשות-לגמרי (הישנות-שריד-היסטורי-חסר-מפתחות) · שליטה-מלאה-מהכספת-האחת. */
function deriveIdx(idx) {
  const ethers = require(path.join(ROOT, 'node_modules', 'ethers'));
  const seed = String(VAULT.readMember('wallets-seed.json').seed || '');
  if (!/^[0-9a-f]{64,}$/.test(seed)) throw new Error('bad-seed');
  const root = ethers.HDNodeWallet.fromSeed(sha256buf(seed + '|tron|relay|44/195'));
  const w = root.derivePath("m/44'/195'/0'/0/" + idx);
  const tw = new TronWeb({ fullHost: RPC, privateKey: w.privateKey.slice(2) });
  try { if (typeof tw.setTimeout === 'function') tw.setTimeout(20000); } catch (_) {}
  return { tw, address: tw.defaultAddress && tw.defaultAddress.base58 };
}

/* 117g — דלתות-הרישום-הריבוני (12 סוכנים): אותו-זרע-ריבוני, גזירת-tron|44/195 —
 * אותו-מתכון-בתים-כמו-wallets.cjs (sha256(seed+'|tron|44/195') → m/44'/195'/0'/0/i).
 * אלה-אותן-כתובות-שה-watcher-סוקר-להפקדות — הפקדת-TRX-לנמל-כלשהו = דלת-ה-relayer
 * מקבלת-שולח-חי-אוטומטית. המעגל נסגר. */
function sha256buf(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
function b58c(payload) {
  const bs58 = require(path.join(ROOT, 'node_modules', 'bs58'));
  const p = Buffer.from(payload);
  const h1 = crypto.createHash('sha256').update(p).digest();
  const h2 = crypto.createHash('sha256').update(h1).digest(); // double-sha (הלקח-113)
  return bs58.encode(Buffer.concat([p, h2.slice(0, 4)]));
}
function deriveRegistryTron(i) {
  const ethers = require(path.join(ROOT, 'node_modules', 'ethers'));
  const seed = String(VAULT.readMember('wallets-seed.json').seed || '');
  if (!/^[0-9a-f]{64,}$/.test(seed)) throw new Error('bad-seed');
  const tronRoot = ethers.HDNodeWallet.fromSeed(sha256buf(seed + '|tron|44/195'));
  const tronW = tronRoot.derivePath("m/44'/195'/0'/0/" + i);
  const tw = new TronWeb({ fullHost: RPC, privateKey: tronW.privateKey.slice(2) });
  try { if (typeof tw.setTimeout === 'function') tw.setTimeout(20000); } catch (_) {}
  const tronPubU = ethers.SigningKey.computePublicKey(tronW.privateKey, false).slice(4);
  const kec = ethers.keccak256(Buffer.from(tronPubU, 'hex'));
  const addr = b58c(Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), 'hex')]));
  return { tw, address: addr };
}
function controlledTronDoors() {
  const list = [];
  for (const idx of [0, 1, 2, 3, 4, 5]) list.push({ family: 'relay-idx', idx, mk: () => deriveIdx(idx) });
  for (let i = 0; i < 12; i++) list.push({ family: 'registry', idx: i, mk: () => deriveRegistryTron(i) });
  return list;
}

/* סריקת-שולחים — עם-cache-של-10 דק' (חסכון-429). מחזיר-את-השולח-הנבחר-או-null+סיבה-כנה.
 * 117i — שיעור-החיים-מההתחיות: קריאת-RPC-שנכשלת איננה "יתרה-אפס" — היא "לא-נקרא".
 * הפיצוץ-השקט היה-השקר-הכי-גרוע-של-הדלת: burst של 36 קריאות-רצופות → 429 →
 * catch(()=>({})) → כל-הדלתות-נראו-ריקות → "no-funded-sender" בזמן-ש-18.7-TRX-ישבו-על-הדלת.
 * התיקון: קצב-בין-דלתות · ניסיון-חוזר-אחד · דלת-שלא-נקראה נושאת err ולא bal=0 ·
 * סריקה-מדורגת לא-נשמרת-ל-10-דק' אלא-ל-60-שנ' — הדלת-מנסה-שוב-מהר. */
const SCAN_HOSTS = ['https://api.trongrid.io'];
const SCAN_PACE_MS = 350;      // בין-דלתות — בלי-ברסט, בלי-429
const SCAN_RETRY_MS = 600;     // ניסיון-שני-לדלת-שנכשלה
const DEGRADED_TTL_MS = 60_000;

async function readAccountWithFallback(tw, address) {
  let lastErr = null;
  for (const host of SCAN_HOSTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const acc = await tw.trx.getAccount(address);
        if (acc && typeof acc === 'object' && Object.keys(acc).length) return { acc, via: host };
        return { acc: acc || {}, via: host }; // {} = חשבון-לא-מופעל — תשובה-לגיטימית
      } catch (e) { lastErr = e; }
      if (attempt === 0) await new Promise((r) => setTimeout(r, SCAN_RETRY_MS));
    }
  }
  throw lastErr || new Error('rpc-unreachable');
}

async function scanTronSender(amountSun, needHeadroom) {
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(SENDERS_CACHE, 'utf8')); } catch (_) {}
  if (cache && (Date.now() - Number(cache.at || 0)) < (cache.degraded ? DEGRADED_TTL_MS : SENDERS_TTL_MS)) {
    return { pick: cache.pick, reason: cache.reason, cached: true, doors: (cache.doors || []).length, cachedAt: cache.at };
  }
  const doors = [];
  let funded = 0, bestBal = 0, bestBalAddr = null, readsFailed = 0;
  const list = controlledTronDoors();
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (i > 0) await new Promise((r) => setTimeout(r, SCAN_PACE_MS)); // קצב — לא-להציף-את-הציבורי
    try {
      const c = d.mk();
      if (!c.address) continue;
      const { acc } = await readAccountWithFallback(c.tw, c.address);
      const res = await c.tw.trx.getAccountResources(c.address).catch(() => ({}));
      const bal = Number((acc && acc.balance) || 0);
      const freeLeft = Math.max(0, Number((res && res.freeNetLimit) || 0) - Number((res && res.freeNetUsed) || 0));
      const activated = !!(acc && acc.address);
      doors.push({ family: d.family, idx: d.idx, address: c.address, bal, freeLeft, activated });
      if (bal > 0) funded++;
      if (bal > bestBal) { bestBal = bal; bestBalAddr = c.address; }
    } catch (e) {
      readsFailed++;
      doors.push({ family: d.family, idx: d.idx, err: 'rpc-failed(' + String((e && e.message) || e).slice(0, 40) + ')' });
    }
  }
  const need = amountSun + needHeadroom;
  const pick = doors.find((x) => x.bal >= need && x.freeLeft >= 300) || null;
  const degradedNote = readsFailed > 0 ? ' · reads-failed=' + readsFailed + '/' + list.length : '';
  const reason = pick
    ? ('ok' + (readsFailed > 0 ? '(degraded' + degradedNote + ')' : ''))
    : (readsFailed > 0 && funded === 0
      ? 'scan-degraded(reads-failed=' + readsFailed + '/' + list.length + ' · לא-קוראים-לא-אומרים-ריקים)'
      : (funded === 0
        ? 'no-funded-sender(doors=' + doors.length + ' · richest=' + bestBalAddr + '@' + bestBal + 'sun)'
        : 'no-free-bandwidth(funded=' + funded + ' · richest=' + bestBalAddr + '@' + bestBal + 'sun' + degradedNote + ')'));
  const snap = { at: Date.now(), pick: pick ? { family: pick.family, idx: pick.idx, address: pick.address, bal: pick.bal, freeLeft: pick.freeLeft } : null, reason, readsFailed, degraded: readsFailed > 0, doors };
  try { fs.writeFileSync(SENDERS_CACHE, JSON.stringify(snap)); } catch (_) {}
  return { pick: snap.pick, reason, cached: false, doors: doors.length, cachedAt: snap.at, readsFailed };
}
function invalidateSenderCache() { try { fs.unlinkSync(SENDERS_CACHE); } catch (_) {} }

/* ספר-כשלים-מקומי (נסיגה-רכה) — לא-נוגע-בספר-הריבוני */
function readFails() { try { return JSON.parse(fs.readFileSync(FAILS_FILE, 'utf8')); } catch (_) { return {}; } }
function saveFails(f) { try { fs.writeFileSync(FAILS_FILE, JSON.stringify(f)); } catch (_) {} }
function failBump(ref, err) { const f = readFails(); f[ref] = { count: ((f[ref] || {}).count || 0) + 1, lastAt: Date.now(), lastErr: String(err).slice(0, 160) }; saveFails(f); return f[ref]; }
function failClear(ref) { const f = readFails(); if (f[ref]) { delete f[ref]; saveFails(f); } }

async function doorTron(r) {
  const toIdx = Math.floor(Number((r.payload || {}).toIdx));
  if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 5) throw new Error('relay-tron-toIdx-0..5-only');
  const amountSun = Math.max(1000, Math.min(30000, Math.floor(Number((r.payload || {}).amountSun) || 5000)));
  const to = deriveIdx(toIdx);
  if (!to.address || !to.tw.isAddress(to.address)) throw new Error('bad-derive');
  /* 117g — האם-היעד-מופעל? כתובת-לא-מופעלת = עמלת-הפעלה-מהשולח (דורש-יתרה-גדולה-יותר) */
  const toAcc = await to.tw.trx.getAccount(to.address).catch(() => ({}));
  const toActivated = !!(toAcc && toAcc.address);
  const headroom = toActivated ? FEE_HEADROOM_SUN : ACTIVATION_HEADROOM_SUN;
  /* 110→117g — מאגר-שולחים-חי-על-פני-כל-הדלתות-הנשלטות (היה: [1,0] קבועות-וריקות).
   * הבטיחות-נשמרת: כל-שולח-אפשרי-נגזר-מהכספת-שלנו · היעד-עודנו-idx-0..5-בלבד. */
  const scan = await scanTronSender(amountSun, headroom);
  if (!scan.pick) throw new Error(scan.reason);
  const me = (scan.pick.family === 'registry') ? deriveRegistryTron(scan.pick.idx) : deriveIdx(scan.pick.idx);
  if (me.address === to.address) throw new Error('sender==receiver(would-be-noop)');
  const unsigned = await me.tw.transactionBuilder.sendTrx(to.address, amountSun, me.address);
  const signed = await me.tw.trx.sign(unsigned, me.tw.defaultAddress.privateKey);
  const bro = await me.tw.trx.sendRawTransaction(signed);
  if (!bro || !bro.result) throw new Error('tron-reject:' + ((bro && bro.message && Buffer.from(bro.message).toString()) || '?'));
  /* 109 — הוכחת-הוצאה: receipt.net_fee מהשרשרת = השריפה-האמת (Bandwidth-חינם → 0) */
  let spentSun = 0;
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try { const info = await me.tw.trx.getTransactionInfo(bro.txid); if (info && info.receipt) { spentSun = Math.max(0, Number(info.receipt.net_fee || 0)); if (info.blockNumber) break; } } catch (_) {}
  }
  invalidateSenderCache(); // השולח-השתמש-ברוחב-הפס — הסריקה-הבאה-חייבת-להיות-חיה
  return { txid: String(bro.txid), spentSun, sender: me.address };
}

/* ── דלת BLURT — צמתים-ציבוריים מתים (נמדד 108) — שקיפות: נשאר-בתור ── */
async function doorBlurt(r) {
  const nodes = ['https://api.blurt.bloodmage.xyz', 'https://rpc.blurt.world', 'https://blurt-rpc.saboin.com', 'https://rpc.blurtmind.com', 'https://blurtrpc.astrike.eu', 'https://blurt-rpc.c0ff33.dev'];
  for (const n of nodes) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(n, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_config', params: [], id: 1 }), signal: ctl.signal });
      clearTimeout(t);
      const j = await res.json().catch(() => null);
      if (j && j.result && j.result.BLURT_CHAIN_ID) throw new Error('BLURT-NODE-ALIVE:' + n + ' — wire broadcast here');
    } catch (e) { if (/ALIVE/.test(e.message)) throw e; }
  }
  throw new Error('blurt-nodes-down(0/6)');
}

async function executeRelay(r) {
  if (r.via === 'steem') return doorSteem(r);
  if (r.via === 'tron') return doorTron(r);
  if (r.via === 'blurt') return doorBlurt(r);
  throw new Error('unknown-via');
}

/* ── מעבר-אחד של ה-relayer ── */
async function passOnce() {
  const { relay, metaIssuer } = readRelayState();
  const queued = Object.values(relay.open || {}).filter((r) => r.status === 'queued').sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));
  if (!queued.length) { dlog('pass: no queued relays · sent=' + relay.sent + ' issued=' + relay.issued); return { done: 0 }; }
  let done = 0;
  const fails = readFails();
  for (const r of queued.slice(0, 3)) {
    /* 117g — נסיגה-רכה: דלת-שנכשלה-8 פעמים-רצופות-נסה-כל-15 דק' (ולא-כל-45 שניות).
     * מפסיק-את-שטף-הלוג-ושומר-על-מכסות-ה-RPC. דלת-כזו-עדיין-חיה — רק-נושמת-לאט. */
    const f = fails[r.ref];
    if (f && f.count >= BACKOFF_AFTER && (Date.now() - f.lastAt) < BACKOFF_MS) {
      const leftSec = Math.round((BACKOFF_MS - (Date.now() - f.lastAt)) / 1000);
      if (((f.count || 0) % 20) === 0) dlog('DOOR ⏸ ' + r.ref + ' (backoff · count=' + f.count + ' · next-in~' + leftSec + 's · last: ' + (f.lastErr || '').slice(0, 80) + ')');
      continue;
    }
    try {
      const res = await executeRelay(r);
      const txid = typeof res === 'string' ? res : res.txid;
      const spentSun = typeof res === 'string' ? 0 : Math.max(0, Number(res.spentSun) || 0);
      const acks = [{ type: 'relay_ack', issuer: metaIssuer || ACCOUNT, ref: r.ref, txid, spentSun }];
      /* דבר-גורר-דבר: אחרי-סגירת-דלת — הדלת-הבאה מוצתת-אוטומטית (עומק-מוגבל) */
      const nx = (r.payload || {}).next;
      if (nx && nx.via && nx.act) {
        const depth = Math.max(0, Math.min(4, Math.floor(Number(nx.depth != null ? nx.depth : (r.payload || {}).depth) || 0)));
        if (depth > 0) {
          acks.push({ type: 'relay', issuer: ACCOUNT, seq: (relay.nextBy[ACCOUNT] || 1), via: String(nx.via), act: String(nx.act), payload: Object.assign({}, nx.payload || {}, { depth: depth - 1, from: r.ref, chain: 'door-chain' }) });
        } else { dlog('chain-end: depth exhausted after ' + r.ref); }
      }
      if (inject(acks, r.ref)) { done++; failClear(r.ref); dlog('DOOR ✓ ' + r.ref + ' via=' + r.via + ' act=' + r.act + ' txid=' + txid); }
    } catch (e) {
      const st = failBump(r.ref, e.message);
      dlog('DOOR ✗ ' + r.ref + ' via=' + r.via + ' :: ' + e.message + ' (count=' + st.count + (st.count >= BACKOFF_AFTER ? ' · backoff-15m' : ' · retry-in-next-pass') + ')');
    }
  }
  return { done };
}

function cmdStatus() {
  const { snap, relay } = readRelayState();
  const open = Object.values(relay.open || {});
  console.log(JSON.stringify({
    height: snap.height, metaIssuer: readRelayState().metaIssuer,
    issued: relay.issued || 0, sent: relay.sent || 0,
    queued: open.filter((r) => r.status === 'queued').length,
    nextSeqBy: relay.nextBy || {},
    gasSettledSun: relay.gasSettledSun || 0,
    doors: open.map((r) => ({ ref: r.ref, via: r.via, act: r.act, status: r.status, txid: r.txid || null, tries: r.tries || 0, chain: (r.payload || {}).chain || null, from: (r.payload || {}).from || null, budgetSun: (r.payload || {}).budgetSun || null, escrowµ: r.escrowµ || null, spentSun: r.spentSun || null, gasPaidµ: r.gasPaidµ || null, refundµ: r.refundµ || null, failCount: (readFails()[r.ref] || {}).count || 0, lastErr: (readFails()[r.ref] || {}).lastErr || null })),
    senderScan: (() => { try { const c = JSON.parse(fs.readFileSync(SENDERS_CACHE, 'utf8')); return { at: new Date(c.at).toISOString(), reason: c.reason, pick: c.pick || null, doorsScanned: (c.doors || []).length, fundedDoors: (c.doors || []).filter((x) => x.bal > 0).length }; } catch (_) { return null; } })(),
  }, null, 2));
}

function cmdIssue(argv) {
  const get = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const via = get('via', 'steem');
  const act = get('act', 'post');
  let payload = {};
  try { payload = JSON.parse(get('payload', '{}')); } catch (e) { dlog('issue: bad payload json'); process.exit(1); }
  payload.v = 2; // 109 — דלתות-v2: פיקדון-חוזה (escrow) פעיל — שער-תאימות-לאחור לדלתות-109-המוקדמות
  const { relay } = readRelayState();
  const seq = relay.nextBy[ACCOUNT] || 1;
  const ok = inject([{ type: 'relay', issuer: ACCOUNT, seq, via, act, payload }], 'issue:' + via + ':' + act);
  dlog('issue ' + (ok ? 'OK' : 'FAIL') + ' seq=' + seq + ' via=' + via + ' act=' + act);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('status')) return cmdStatus();
  if (argv.includes('scan')) {
    /* 117g — בדיקת-סריקת-שולחים-קריאה-בלבד (אפס-שידור) — עוקף-cache-לכפיית-חי */
    const get = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? Number(argv[i + 1]) : d; };
    const amountSun = get('amount', 5000);
    const toIdx = get('to-idx', 2);
    const to = deriveIdx(toIdx);
    const toAcc = await to.tw.trx.getAccount(to.address).catch(() => ({}));
    const toActivated = !!(toAcc && toAcc.address);
    const headroom = toActivated ? FEE_HEADROOM_SUN : ACTIVATION_HEADROOM_SUN;
    try { fs.unlinkSync(SENDERS_CACHE); } catch (_) {}
    const scan = await scanTronSender(amountSun, headroom);
    const live = JSON.parse(fs.readFileSync(SENDERS_CACHE, 'utf8'));
    console.log(JSON.stringify({ toIdx, to: to.address, toActivated, headroom, amountSun, pick: scan.pick, reason: scan.reason, cached: scan.cached, doors: live.doors }, null, 2));
    return;
  }
  if (argv.includes('issue')) return cmdIssue(argv);
  if (argv.includes('once')) { const r = await passOnce(); console.log('relay pass done=' + r.done); return; }
  if (argv.includes('watch')) {
    dlog('THE-DOOR relayer watch start (tick ' + TICK + 'ms)');
    const loop = async () => { try { await passOnce(); } catch (e) { dlog('watch pass error: ' + e.message); } };
    await loop();
    setInterval(loop, TICK);
    return;
  }
  console.log('usage: relay.cjs status | scan [--amount sun --to-idx 0..5] | issue --via steem --act post --payload \'{}\' | once | watch');
}
main().catch((e) => { dlog('FATAL ' + ((e && e.message) || e)); process.exit(1); });
