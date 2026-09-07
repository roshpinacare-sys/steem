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
require('dns').setDefaultResultOrder('ipv4first'); // HE lesson: family-4 first
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const SNAPSHOT = path.join(HERE, 'state-snapshot.json');
const DOORLOG = path.join(HERE, 'relay-doors.log');
const TICK = 45000;
const MAX_TRIES = 50;

const S = require(path.join(HERE, 'saosnet.cjs'));
const ACCOUNT = S.ACCOUNT;           // 'headcorner' — מפעיל-הצומת ומנפיק-הדלתות
const steem = require(path.join(ROOT, 'node_modules', 'steem'));
const TronWeb = require(path.join(ROOT, 'node_modules', 'tronweb'));
const VAULT = require(path.join(HERE, 'vault-lib.cjs')); // 114 — הקריאה-דרך-הכספת (envelope→plaintext)
const RPC = 'https://api.trongrid.io';
const KEYFILE = path.join(ROOT, 'agent', 'keys', 'tron-mnemonic.txt');

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

/* ── דלת TRON — העברה-קטנה על Bandwidth-חינם, רק-לכתובות-גזורות-משלנו (בטיחות) ── */
function deriveIdx(idx) {
  const ethers = require(path.join(ROOT, 'node_modules', 'ethers'));
  const mnemonic = VAULT.readMnemonic(); // 114 — מהכספת (envelope→plaintext)
  const w = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/195'/0'/0/" + idx);
  const tw = new TronWeb({ fullHost: RPC, privateKey: w.privateKey.slice(2) });
  try { if (typeof tw.setTimeout === 'function') tw.setTimeout(20000); } catch (_) {}
  return { tw, address: tw.defaultAddress && tw.defaultAddress.base58 };
}
async function doorTron(r) {
  const toIdx = Math.floor(Number((r.payload || {}).toIdx));
  if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 5) throw new Error('relay-tron-toIdx-0..5-only');
  const amountSun = Math.max(1000, Math.min(30000, Math.floor(Number((r.payload || {}).amountSun) || 5000)));
  /* 110 — מאגר-שולחים-לפי-רוחב-פס (הלקח-107-מהעוגנים): הרכזת (idx1) יכולה-להיות-יבשה-היום
   * (Bandwidth-חינם 600B/יום נשרף) — עוברים-לכתובת-הבריכה-העשירה (idx0) באותו-יום.
   * הבטיחות-נשמרת: גם-השולח-וגם-היעד כתובות-גזורות-משלנו (0..5) בלבד. */
  let me = null;
  for (const idx of [1, 0]) {
    const cand = deriveIdx(idx);
    const res = await cand.tw.trx.getAccountResources(cand.address).catch(() => ({}));
    const freeLeft = Math.max(0, Number(res.freeNetLimit || 0) - Number(res.freeNetUsed || 0));
    if (freeLeft >= 300) { me = cand; break; } // transfer ≈270B
  }
  if (!me) throw new Error('no-free-bandwidth-today(hub+pool)');
  const to = deriveIdx(toIdx);
  if (!me.tw.isAddress(to.address)) throw new Error('bad-derive');
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
  return { txid: String(bro.txid), spentSun };
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
  for (const r of queued.slice(0, 3)) {
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
      if (inject(acks, r.ref)) { done++; dlog('DOOR ✓ ' + r.ref + ' via=' + r.via + ' act=' + r.act + ' txid=' + txid); }
    } catch (e) {
      dlog('DOOR ✗ ' + r.ref + ' via=' + r.via + ' :: ' + e.message + (r.tries >= MAX_TRIES ? ' · STALLED(max-tries)' : ' · retry-in-next-pass'));
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
    doors: open.map((r) => ({ ref: r.ref, via: r.via, act: r.act, status: r.status, txid: r.txid || null, tries: r.tries || 0, chain: (r.payload || {}).chain || null, from: (r.payload || {}).from || null, budgetSun: (r.payload || {}).budgetSun || null, escrowµ: r.escrowµ || null, spentSun: r.spentSun || null, gasPaidµ: r.gasPaidµ || null, refundµ: r.refundµ || null })),
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
  if (argv.includes('issue')) return cmdIssue(argv);
  if (argv.includes('once')) { const r = await passOnce(); console.log('relay pass done=' + r.done); return; }
  if (argv.includes('watch')) {
    dlog('THE-DOOR relayer watch start (tick ' + TICK + 'ms)');
    const loop = async () => { try { await passOnce(); } catch (e) { dlog('watch pass error: ' + e.message); } };
    await loop();
    setInterval(loop, TICK);
    return;
  }
  console.log('usage: relay.cjs status | issue --via steem --act post --payload \'{}\' | once | watch');
}
main().catch((e) => { dlog('FATAL ' + ((e && e.message) || e)); process.exit(1); });
