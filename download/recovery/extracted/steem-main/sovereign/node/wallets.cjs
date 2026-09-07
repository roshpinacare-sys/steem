#!/usr/bin/env node
/* wallets.cjs — 113 THE-WALLETS (ארנקי-הצבא): זהות-כספית-רב-רשתית-ריבונית לכל-סוכן.
 *
 * המנדט (מהמפעיל): "לכל-חייל ארנקים-מצומדים — ETH/SOL/טרון וכל-הרשתות-המובילות-היום,
 * כתובת-לכל-סוכן, ארנק-פרטי-לכל-סוכן, הכל-מעוגן, תנסה-לתקצב".
 *
 * התשובה-הריבונית:
 *  · גזירה דטרמיניסטית מזרע-ריבוני-אחד (agent/keys/wallets-seed.json — מחוץ-לגיט):
 *      EVM  m/44'/60'/0'/0/i  → כתובת-אחת משרתת 7 רשתות-חכמות:
 *          Ethereum · BSC · Polygon · Arbitrum · Optimism · Base · Avalanche
 *      TRON m/44'/195'/0'/0/i → כתובת-T אישית (אותו-משפחה-כמו-הכספת)
 *      SOL  ed25519(sha256(seed|sol|name)) → base58 (אותו-חוק-כמו-הקרנל: נגזר-וניתן-לאימות)
 *      BTC  m/84'/0'/0'/0/i   → P2WPKH bech32 (הרשת-המובילה-בפועל)
 *    = 10 רשתות לכל-סוכן. הכי-חשוב: הזרע-אצלנו, הכתובות-פומביות, הדיגסט-על-הספר.
 *  · עיגון כפול: (1) מניפסט custom_json saos:wallets/v1 על STEEM — אפס-עמלה,
 *    ציבורי-מתוארך, ניתן-לאימות-בכל-אקספלורר. (2) op wallet על-השרשרת-הריבונית
 *    (קרנל-113 — dedupe-קשוח agent/digest).
 *  · תקצוב: מענקי-WSTEEM/WBLURT/ENERGY מכספת-headcorner על-הספר (transfer_w אמת),
 *    + איירדרופ-devnet-Solana (ניסיון-כנה, קירוב-תקרות מתועד).
 *
 * דיסציפלינות: כותב-יחיד · inject דרך saosnet --inject (הבחנת DONE/REJECT מ-111)
 * · מפתחות-פרטיים-מחוץ-לגיט · כל-הערכים-נמדדים-וכנים. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const AGENT_DIR = path.join(ROOT, 'agent');
const KEYFILE = path.join(AGENT_DIR, 'keys', 'wallets-seed.json');
const PRIV = path.join(AGENT_DIR, 'keys', 'wallets-registry.json');
const PUB = path.join(HERE, 'wallets-public.json');
const AIRDROP_AT = path.join(HERE, 'wallets-airdrop.json');
const LOG = path.join(HERE, 'wallets.log');
const STATE = path.join(HERE, 'state.json');
const SNAPSHOT = path.join(HERE, 'state-snapshot.json'); // מצב-הקרנל החי ({height, st}) — הלקח-החי: state.json הוא-הפנקס, לא-המצב

const ACCOUNT = 'headcorner';
const VAULT = require('./vault-lib.cjs'); // 114 — קריאת-מפתחות-דרך-הכספת (envelope→plaintext)
const NET = 'saos-net/0';
const AIRDROP_COOLDOWN_MS = 6 * 3600 * 1000; // devnet תקרות — 6 שעות בין-סבבים

const dlog = (m) => { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n'); } catch (_) {} console.log(m); };

function loadDotEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(AGENT_DIR, '.env'), 'utf8').split(/\r?\n/)) {
      const t = line.trim(); const eq = t.indexOf('=');
      if (!t || t.startsWith('#') || eq <= 0) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
  return out;
}
const ENV = loadDotEnv();

function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function sha256buf(s) { return crypto.createHash('sha256').update(s).digest(); }
function ripemd160(b) { return crypto.createHash('ripemd160').update(b).digest(); }
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

/* ── צבא-הסוכנים: headcorner + כל-החיילים (vault.json — הרוסטר-הקנוני) ── */
function agentsOf() {
  const names = new Set([ACCOUNT]);
  try {
    const v = VAULT.readMember('vault.json'); // 114 — מהכספת
    for (const a of (v.accounts || [])) if (a && a.username) names.add(String(a.username).toLowerCase());
  } catch (_) {}
  return Array.from(names).sort(); // ממוין — גזירה-דטרמיניסטית לפי-אינדקס
}

/* ── bech32 (BIP-173 רף-ציבורי — P2WPKH v0) ── */
const B32CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) { const b = chk >> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i]; }
  return chk;
}
function bech32HrpExpand(hrp) { const r = []; for (const c of hrp) r.push(c.charCodeAt(0) >> 5); r.push(0); for (const c of hrp) r.push(c.charCodeAt(0) & 31); return r; }
function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0; const out = []; const maxv = (1 << to) - 1;
  for (const v of data) { if (v < 0 || (v >> from) !== 0) return null; acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); } }
  if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); }
  else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}
function btcP2wpkh(pubKey, hrp) {
  const h160 = ripemd160(sha256buf(Buffer.from(pubKey)));
  const prog = convertBits(Array.from(h160), 8, 5, true);
  const data = bech32HrpExpand(hrp).concat([0]).concat(prog);
  const mod = bech32Polymod(data.concat([0, 0, 0, 0, 0, 0])) ^ 1;
  const chk = []; for (let i = 0; i < 6; i++) chk.push((mod >> 5 * (5 - i)) & 31);
  /* בית-הגרסה (v0 → 'q') הוא-חלק-מהמטבע — הלקח-החי-מהבאג-שנתפס-לפני-עיגון */
  return hrp + '1' + [0].concat(prog, chk).map((d) => B32CHARS[d]).join('');
}
function b58check(payload) {
  const bs58 = require(path.join(ROOT, 'node_modules', 'bs58'));
  const p = Buffer.from(payload);
  const h1 = crypto.createHash('sha256').update(p).digest();
  const h2 = crypto.createHash('sha256').update(h1).digest(); // דאבל-sha — הבאג-החי-שנתפס-מול-TronWeb לפני-העיגון
  return bs58.encode(Buffer.concat([p, h2.slice(0, 4)]));
}

/* ── גזירה — idempotent: אותו-זרע = אותן-כתובות, לעולם-לא-מחדשים ── */
function derive({ quiet } = {}) {
  let seedDoc;
  try { seedDoc = VAULT.readMember('wallets-seed.json'); } // 114 — הזרע-מהכספת
  catch (_) {
    seedDoc = { seed: crypto.randomBytes(48).toString('hex'), createdAt: new Date().toISOString(), note: 'SOVEREIGN ROOT — never commit, never regenerate' };
    fs.mkdirSync(path.dirname(KEYFILE), { recursive: true });
    fs.writeFileSync(KEYFILE, JSON.stringify(seedDoc, null, 2), { mode: 0o600 });
    dlog('derive: NEW sovereign seed created (' + KEYFILE + ')');
  }
  const seed = String(seedDoc.seed || '');
  if (!/^[0-9a-f]{64,}$/.test(seed)) throw new Error('bad-seed');
  const agents = agentsOf();
  const ethers = require(path.join(ROOT, 'node_modules', 'ethers'));
  const bs58 = require(path.join(ROOT, 'node_modules', 'bs58'));
  const { ed25519 } = require(path.join(ROOT, 'node_modules', '@noble', 'curves', 'ed25519.js'));
  const evmRoot = ethers.HDNodeWallet.fromSeed(sha256buf(seed + '|evm|44/60'));
  const tronRoot = ethers.HDNodeWallet.fromSeed(sha256buf(seed + '|tron|44/195'));
  const btcRoot = ethers.HDNodeWallet.fromSeed(sha256buf(seed + '|btc|84/0'));
  const priv = { seedRef: KEYFILE, derivedAt: new Date().toISOString(), accounts: [] };
  const pub = { protocol: 'saos:wallets/v1', net: NET, derivedAt: null, agents: [] };
  agents.forEach((name, i) => {
    const evmW = evmRoot.derivePath("m/44'/60'/0'/0/" + i);
    const tronW = tronRoot.derivePath("m/44'/195'/0'/0/" + i);
    const btcW = btcRoot.derivePath("m/84'/0'/0'/0/" + i);
    const solPriv = sha256buf(seed + '|sol|' + name);
    const solPub = ed25519.getPublicKey(solPriv);
    /* טרון = keccak256(pubkey-לא-דחוס)-20-הבתים-האחרונים + קידומת-0x41 (אותו-גזירה-כמו-EVM —
     * ההמרה-המכנית T↔0x). אומת-מול-קוד-המקור-של-TronWeb (computeAddress=vl) ומול-הכספת-החיה. */
    const tronPubU = ethers.SigningKey.computePublicKey(tronW.privateKey, false).slice(4); // strip 0x04
    const kec = ethers.keccak256(Buffer.from(tronPubU, 'hex'));
    const tronAddr = b58check(Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), 'hex')]));
    const btcAddr = btcP2wpkh(Buffer.from(btcW.publicKey.slice(2), 'hex'), 'bc');
    priv.accounts.push({
      agent: name, idx: i,
      evm: { address: evmW.address, path: "m/44'/60'/0'/0/" + i, pk: evmW.privateKey, nets: ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche'] },
      tron: { address: tronAddr, path: "m/44'/195'/0'/0/" + i, pk: tronW.privateKey },
      sol: { address: bs58.encode(solPub), pk: Buffer.from(solPriv).toString('hex') },
      btc: { address: btcAddr, path: "m/84'/0'/0'/0/" + i, pkWIF: btcW.privateKey ? undefined : undefined, pub: btcW.publicKey },
    });
    pub.agents.push({ agent: name, idx: i, evm: evmW.address, tron: tronAddr, sol: bs58.encode(solPub), btc: btcAddr });
  });
  /* הכלל-הריבוני: הזרע-קבוע → אותן-כתובות. אם-כבר-עוגן-מניפסט-על-המארח — חייב-להישמר
   * (הלקח-החי-113: derive שמוחק-את-ה-anchor גורם-לעיגון-כפול). הכתובות-אסור-שישתנו. */
  let prevPub = null;
  try { prevPub = JSON.parse(fs.readFileSync(PUB, 'utf8')); } catch (_) {}
  const digest = sha256hex(canon({ agents: pub.agents.map(({ agent, evm, tron, sol, btc }) => ({ agent, evm, tron, sol, btc })) }));
  if (prevPub && prevPub.manifestDigest && prevPub.manifestDigest !== digest) {
    dlog('derive GUARD: existing digest ' + prevPub.manifestDigest.slice(0, 12) + '… != re-derived ' + digest.slice(0, 12) + '… — keeping existing public file (זרע-שונה? לא-מחליפים-זהות-על-בר-מה)');
    prevPub.derivedAt = prevPub.derivedAt || priv.derivedAt;
    fs.writeFileSync(PUB, JSON.stringify(prevPub, null, 2));
    return { priv, pub: prevPub, agents: agents.map((n, i) => ({ agent: n, idx: i })) };
  }
  pub.manifestDigest = (prevPub && prevPub.manifestDigest) || digest;
  if (prevPub && prevPub.anchor) pub.anchor = prevPub.anchor; // העיגון-ההיסטורי-נשמר-תמיד
  pub.derivedAt = prevPub?.derivedAt || priv.derivedAt;
  fs.mkdirSync(path.dirname(PRIV), { recursive: true });
  fs.writeFileSync(PRIV, JSON.stringify(priv, null, 2), { mode: 0o600 });
  fs.writeFileSync(PUB, JSON.stringify(pub, null, 2));
  if (!quiet) dlog('derive: ' + agents.length + ' agents × 10 networks · digest ' + pub.manifestDigest.slice(0, 16) + '… · private→' + PRIV + ' · public→' + PUB);
  return { priv, pub, agents };
}

/* ── המניפסט הפומבי (העגינה-על-המארח) ── */
function readPub() { return JSON.parse(fs.readFileSync(PUB, 'utf8')); }
function readPriv() { return VAULT.readMember('wallets-registry.json'); } // 114 — הרישום-הפרטי-מהכספת

async function manifest() {
  const pub = readPub();
  if (pub.anchor && pub.anchor.txid) { dlog('manifest: already anchored txid=' + pub.anchor.txid.slice(0, 16) + '… (idempotent)'); return pub.anchor; }
  const steem = require(path.join(ROOT, 'node_modules', 'steem'));
  steem.api.setOptions({ url: 'https://api.steemit.com' });
  const wif = ENV.POSTING_WIF;
  if (!wif) { dlog('manifest SKIP: no POSTING_WIF'); return { skip: 'no-wif' }; }
  const payload = {
    protocol: 'saos:wallets/v1', action: 'wallets', net: NET,
    time: new Date().toISOString(),
    digest: pub.manifestDigest,
    count: pub.agents.length,
    agents: pub.agents.map(({ agent, evm, tron, sol, btc }) => ({ agent, evm, tron, sol, btc })),
    note: 'sovereign multi-chain wallet identity: evm(7 nets: eth/bsc/polygon/arbitrum/optimism/base/avalanche) + tron + sol + btc(p2wpkh) per agent — derived from one sovereign seed, anchored on the host chain, zero fee',
  };
  const op = ['custom_json', { required_auths: [], required_posting_auths: [ACCOUNT], id: 'saos', json: JSON.stringify(payload) }];
  const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [wif]);
  const txid = conf && conf.id;
  if (!txid) throw new Error('no-txid');
  pub.anchor = { txid: String(txid), by: ACCOUNT, at: payload.time, digest: pub.manifestDigest };
  fs.writeFileSync(PUB, JSON.stringify(pub, null, 2));
  dlog('manifest ANCHORED ✓ txid=' + txid + ' · digest=' + pub.manifestDigest.slice(0, 16) + '… · agents=' + pub.agents.length);
  return pub.anchor;
}

/* ── inject — אותו-חוזה כמו-הקציר (הבחנת DONE/REJECT) ── */
function inject(txs, tag) {
  const f = path.join(HERE, 'inject-wallets-' + Date.now() + '.json');
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

async function injectWallets() {
  const pub = readPub();
  const txid = pub.anchor && pub.anchor.txid;
  if (!txid) { dlog('inject SKIP: manifest not anchored yet (anchor first — הדיגסט-חייב-ראיה-ציבורית)'); return; }
  const snap = (() => { try { return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')); } catch (_) { return {}; } })();
  const st = (snap.st || snap);
  const seen = {};
  for (const r of ((st.wallets && st.wallets.recs) || [])) seen[r.agent + '/' + r.digest] = 1;
  const txs = pub.agents
    .map((a) => ({ type: 'wallet', by: ACCOUNT, agent: a.agent, digest: pub.manifestDigest, evm: a.evm, tron: a.tron, sol: a.sol, btc: a.btc, hostTxid: txid, at: new Date().toISOString() }))
    .filter((t) => !seen[t.agent + '/' + t.digest]);
  if (!txs.length) { dlog('inject: all wallets already on-book (idempotent)'); return; }
  const r = inject(txs, 'wallets:' + txs.length);
  if (r.done && !r.rejected) { fs.writeFileSync(path.join(HERE, 'wallets-inject-last.json'), JSON.stringify({ at: new Date().toISOString(), count: txs.length, digest: pub.manifestDigest }, null, 2)); }
}

/* ── תקצוב — מענקים-אמת על-הספר מכספת-headcorner (transfer_w) ── */
const STIPEND = { WSTEEM: 5000, WBLURT: 2000, ENERGY: 1000 }; // µ לחייל
function budget() {
  /* שער-יומי: מענק-אחד-ליום (idempotent-מול-watch) — יומן-המענקים הוא-הראיה */
  const day = new Date().toISOString().slice(0, 10);
  let last = null;
  try { last = JSON.parse(fs.readFileSync(path.join(HERE, 'wallets-budget-last.json'), 'utf8')); } catch (_) {}
  const lastDay = (last && (last.day || String(last.at || '').slice(0, 10))) || null;
  if (lastDay === day) { dlog('budget SKIP: daily stipend already shipped (' + day + ' · ' + (last.txs || 0) + ' txs)'); return; }
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const s = snap.st || snap;
  const me = (s.accounts || {})[ACCOUNT] || { wrapped: {} };
  const soldiers = agentsOf().filter((n) => n !== ACCOUNT);
  const txs = [];
  const plan = [];
  for (const [sym, per] of Object.entries(STIPEND)) {
    const have = (me.wrapped && me.wrapped[sym]) || 0;
    const want = per * soldiers.length;
    const afford = Math.min(want, Math.max(0, Math.floor(have - per * 0.5))); // אף-פעם-לא-ריקון-מוחלט
    const n = Math.min(soldiers.length, Math.floor(afford / per));
    if (n <= 0) { plan.push(sym + ':dry(have ' + have + 'µ)'); continue; }
    for (const so of soldiers.slice(0, n)) txs.push({ type: 'transfer_w', symbol: sym, from: ACCOUNT, to: so, amount: per / 1000, at: new Date().toISOString() });
    plan.push(sym + ':' + n + '×' + per + 'µ(have ' + have + 'µ)');
  }
  if (!txs.length) { dlog('budget SKIP: vault dry — ' + plan.join(' · ') + ' (מענקי-SAOS ירוצו-כשהאוצר-מתמלא: עמלות+מאגר)'); return; }
  const r = inject(txs, 'budget:' + txs.length);
  if (r.done) fs.writeFileSync(path.join(HERE, 'wallets-budget-last.json'), JSON.stringify({ at: new Date().toISOString(), day: day, plan: plan, txs: txs.length }, null, 2));
}

/* ── איירדרופ-devnet-Solana — ניסיון-כנה לתדלק את-הארנקים ── */
const SOL_DEVNET = 'https://api.devnet.solana.com';
async function solRpc(method, params) {
  const r = await fetch(SOL_DEVNET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }) });
  return r.json();
}
async function airdrop({ force } = {}) {
  const pub = readPub();
  const prev = (() => { try { return JSON.parse(fs.readFileSync(AIRDROP_AT, 'utf8')); } catch (_) { return { results: {} }; } })();
  const fresh = force || !prev.at || (Date.now() - new Date(prev.at).getTime() > AIRDROP_COOLDOWN_MS);
  if (!fresh) { dlog('airdrop: cooldown (' + Math.round((AIRDROP_COOLDOWN_MS - (Date.now() - new Date(prev.at).getTime())) / 60000) + 'min left)'); return; }
  const out = { at: new Date().toISOString(), results: {} };
  for (const a of pub.agents) {
    const before = prev.results && prev.results[a.agent] && prev.results[a.agent].funded;
    if (before) { out.results[a.agent] = prev.results[a.agent]; continue; }
    try {
      const r = await solRpc('requestAirdrop', [a.sol, 1e9]); // 1 SOL devnet
      let ok = false, sig = null, err = null;
      if (r && r.result && /^[A-Za-z0-9]+$/.test(r.result)) { sig = r.result; ok = true; }
      else err = (r && r.error && (r.error.message || r.error.code)) || 'unknown';
      // אישור-עצמאי: יתרה בפועל
      let lamports = 0;
      try { const b = await solRpc('getBalance', [a.sol]); lamports = (b && b.result && b.result.value) || 0; if (lamports > 0) ok = true; } catch (_) {}
      out.results[a.agent] = { funded: ok, sig, lamports, err: err ? String(err).slice(0, 90) : null };
      dlog('airdrop ' + a.agent + ' ' + (ok ? 'FUNDED ' + (lamports / 1e9) + ' SOL' + (sig ? ' sig=' + String(sig).slice(0, 12) + '…' : '') : 'DENIED: ' + err));
    } catch (e) { out.results[a.agent] = { funded: false, err: String((e && e.message) || e).slice(0, 90) }; dlog('airdrop ' + a.agent + ' FAIL ' + (e && e.message)); }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  fs.writeFileSync(AIRDROP_AT, JSON.stringify(out, null, 2));
  const funded = Object.values(out.results).filter((x) => x.funded).length;
  dlog('airdrop ROUND: ' + funded + '/' + pub.agents.length + ' funded (devnet — תקצוב-אמת-על-רשת-אמת-לצורך-פיתוח)');
}

/* ── אימות-איכות: האם-העיגון-על-המארח-באמת-שם ── */
async function verifyAnchor() {
  const pub = readPub();
  if (!pub.anchor || !pub.anchor.txid) { dlog('verify: no anchor yet'); return; }
  const steem = require(path.join(ROOT, 'node_modules', 'steem'));
  steem.api.setOptions({ url: 'https://api.steemit.com' });
  const tx = await new Promise((res) => steem.api.getTransaction(pub.anchor.txid, (e, t) => res(e ? null : t)));
  if (!tx) { dlog('verify: txid not visible YET (indexer lag) — will retry'); return; }
  const cj = tx.operations && tx.operations[0] && tx.operations[0][1];
  let ok = false;
  try { ok = JSON.parse(cj.json).digest === pub.manifestDigest; } catch (_) {}
  pub.anchor.verified = !!ok;
  fs.writeFileSync(PUB, JSON.stringify(pub, null, 2));
  dlog('verify: host anchor ' + (ok ? 'VERIFIED ✓ (digest match)' : 'MISMATCH ✗'));
}

/* ── פקודות ── */
async function once() {
  derive({ quiet: true });
  const pub = readPub();
  if (!pub.anchor) await manifest();
  await injectWallets();
  await verifyAnchor();
  budget();
  await airdrop({});
}
async function watch() {
  dlog('watch: THE-WALLETS always-up (tick 5min)');
  for (;;) {
    try { await once(); } catch (e) { dlog('once FAIL: ' + String((e && e.message) || e).slice(0, 120)); }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 * 60 * 1000);
  }
}
function status() {
  try {
    const pub = readPub();
    console.log('agents: ' + pub.agents.length + ' · digest: ' + (pub.manifestDigest || '?').slice(0, 16) + '…');
    console.log('anchor: ' + (pub.anchor ? pub.anchor.txid + (pub.anchor.verified ? ' ✓verified' : ' (pending-verify)') : 'NOT-ANCHORED'));
    for (const a of pub.agents.slice(0, 3)) console.log('  ' + a.agent + '  evm=' + a.evm.slice(0, 10) + '… tron=' + a.tron.slice(0, 8) + '… sol=' + a.sol.slice(0, 8) + '… btc=' + a.btc.slice(0, 12) + '…');
  } catch (_) { console.log('not derived yet — run: node wallets.cjs derive'); }
}

(async () => {
  const cmd = process.argv[2] || 'status';
  try {
    if (cmd === 'derive') derive();
    else if (cmd === 'manifest') { derive({ quiet: true }); await manifest(); }
    else if (cmd === 'inject') { await injectWallets(); }
    else if (cmd === 'verify') await verifyAnchor();
    else if (cmd === 'budget') budget();
    else if (cmd === 'airdrop') await airdrop({ force: process.argv.includes('--force') });
    else if (cmd === 'once') await once();
    else if (cmd === 'watch') await watch();
    else status();
  } catch (e) { dlog('FAIL[' + cmd + ']: ' + String((e && e.message) || e).slice(0, 160)); process.exitCode = 1; }
})();
