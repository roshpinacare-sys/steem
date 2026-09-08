#!/usr/bin/env node
/* legacy-tron-recover2.cjs — 117k: סיבוב-מילים-כפול (אחרי-שסיבוב-יחיד-מוצה-ב-recover.cjs)
 *
 * מצב-נמדד: 3-קריאות-VLM-יציבות-בצורה (666455565347) · checksum-נכשל · סיבוב-מילה-יחידה
 * (1562-עוברי-checksum, 14058-גזירות) לא-מצא → לפחות-2-מילים-נקראו-שגוי.
 *
 * הסריקה-כאן: לכל-זוג-מקומות (66) × מילים-בעלות-אורך-זהה-לנקרא (מצמצם-~2048→~400)
 * × סינון-checksum-מהיר (בלי-PBKDF2) × אורקל-כתובות-על-שתי-הדלתות.
 * + החלפות-שכנים (שגיאת-סדר-קריאה) + היפוך-מלא.
 * אפס-דליפה: בלוג-עולה-רק-מספרים-ומסקנות. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const IMG = path.join(ROOT, 'upload', 'IMG-20260905-WA0025.jpg');
const OUT = path.join(ROOT, 'agent', 'keys', 'tron-legacy-mnemonic.txt');
const BS58 = require(path.join(ROOT, 'node_modules', 'bs58'));
const { ethers } = require(path.join(ROOT, 'node_modules', 'ethers'));

const EXPECT = [
  { idx: 0, addr: 'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4' },
  { idx: 1, addr: 'TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr' },
];
function log(msg) { console.log('[recover2] ' + msg); }

function tronAddrFromPriv(privHex) {
  const pubU = ethers.SigningKey.computePublicKey(privHex, false).slice(4);
  const kec = ethers.keccak256(Buffer.from(pubU, 'hex'));
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), 'hex')]);
  const h2 = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest();
  return BS58.encode(Buffer.concat([payload, h2.subarray(0, 4)]));
}
function matchWordsNoCheck(words) {
  /* מניח-checksum-תקף (נבדק-בזול-מראש) — מוודא-רק-את-אורקל-הכתובות (idx0-ראשון = חיתוך-מהיר) */
  try {
    const phrase = words.join(' ');
    const w0 = ethers.HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/195'/0'/0/" + EXPECT[0].idx);
    if (tronAddrFromPriv(w0.privateKey) !== EXPECT[0].addr) return false;
    const w1 = ethers.HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/195'/0'/0/" + EXPECT[1].idx);
    return tronAddrFromPriv(w1.privateKey) === EXPECT[1].addr;
  } catch (_) { return false; }
}
function parseWords(text) {
  const NOISE = new Set(['mnemonic', 'seed', 'phrase', 'wallet', 'keys', 'backup', 'recovery', 'words', 'secret', 'bip39', 'address', 'private', 'word', 'tron']);
  const words = [];
  for (const ln of String(text || '').split(/\r?\n/)) {
    const cleaned = ln.replace(/^\s*\d{1,2}\s*[.)\-:]\s*/, '').trim();
    for (const tok of cleaned.split(/[\s,.;:|]+/)) {
      const w = tok.toLowerCase().replace(/[^a-z]/g, '');
      if (w.length >= 3 && w.length <= 8 && !NOISE.has(w)) words.push(w);
    }
  }
  return words;
}

function permuteOrders(w) {
  const set = [w];
  const colPerm = (arr, cols) => { const rows = 12 / cols; const out = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(arr[c * rows + r]); return out; };
  for (const cols of [2, 3, 4, 6]) {
    set.push(colPerm(w, cols));
    const alt = []; const rows = 12 / cols;
    for (let r = 0; r < rows; r++) for (let c = cols - 1; c >= 0; c--) alt.push(w[c * rows + r]);
    set.push(alt);
  }
  for (let i = 0; i < 11; i++) { const s = w.slice(); [s[i], s[i + 1]] = [s[i + 1], s[i]]; set.push(s); } // החלפות-שכנים
  set.push(w.slice().reverse());
  return set;
}

async function main() {
  if (fs.existsSync(OUT)) { log('already-recovered — nothing to do'); return; }
  const ZAI = (await import(path.join(ROOT, 'node_modules', 'z-ai-web-dev-sdk', 'dist', 'index.js'))).default;
  const zai = await ZAI.create();
  const b64 = fs.readFileSync(IMG).toString('base64');
  const prompt = 'This image contains a BIP39 seed phrase (12 words). Output ONLY the 12 words in exact order, space-separated, lowercase, nothing else — no numbering, no explanation.';
  const reads = [];
  for (let i = 0; i < 2; i++) {
    const r = await zai.chat.completions.createVision({ messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } }] }], thinking: { type: 'disabled' } });
    reads.push(parseWords((r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || ''));
  }
  log('read shapes: ' + reads.map((r) => r.length + '(' + r.map((w) => w.length).join('') + ')').join(' · '));
  if (reads.some((r) => r.length !== 12)) { log('REJECT: reads not 12 tokens'); process.exit(2); }

  const base = reads[0];
  /* אילו-מקומות-שונים-בין-הקריאות? (עדיפות-לא-ודאיים) — בלוג-רק-מספרי-מקומות */
  const diffPos = [];
  for (let p = 0; p < 12; p++) if (reads[0][p] !== reads[1][p]) diffPos.push(p);
  log('cross-read diff positions (0-based): [' + diffPos.join(',') + ']');

  const WL = (require(path.join(ROOT, 'node_modules', 'ethers')).LangEn).wordlist();
  const byLen = new Map();
  for (let i = 0; i < 2048; i++) { const w = WL.getWord(i); if (!byLen.has(w.length)) byLen.set(w.length, []); byLen.get(w.length).push(w); }
  log('wordlist buckets: ' + [...byLen.entries()].map(([l, a]) => l + ':' + a.length).sort().join(' · '));

  /* שלב-0: הקריאה-עצמה + פרמוטציות-סדר (זול) */
  for (const order of permuteOrders(base)) if (matchWordsNoCheck(order) && ethers.Mnemonic.isValidMnemonic(order.join(' '))) { fs.writeFileSync(OUT, order.join(' ') + '\n', { mode: 0o600 }); log('MATCH ✅ direct/perm'); return finish(); }

  /* שלב-1: סיבוב-מילה-יחידה מלא (עם-פרמוטציות-זול-מחוץ ל-PBKDF2: קודם-checksum-אז-אורקל-על-base-order) */
  for (let p = 0; p < 12; p++) for (let i = 0; i < 2048; i++) {
    const w2 = base.slice(); w2[p] = WL.getWord(i);
    if (!ethers.Mnemonic.isValidMnemonic(w2.join(' '))) continue;
    if (matchWordsNoCheck(w2)) { fs.writeFileSync(OUT, w2.join(' ') + '\n', { mode: 0o600 }); log('MATCH ✅ single-word pos=' + p); return finish(); }
  }
  log('single-word sweep done — no match → two-word constrained sweep');

  /* שלב-2: סיבוב-זוגות מאולץ-אורך. סדר-זוגות: קודם-זוגות-עם-מקום-לא-ודאי */
  const pairs = [];
  for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) pairs.push([a, b]);
  pairs.sort((x, y) => (diffPos.includes(x[0]) || diffPos.includes(x[1]) ? 0 : 1) - (diffPos.includes(y[0]) || diffPos.includes(y[1]) ? 0 : 1));
  let candidates = 0, derived = 0;
  const t0 = Date.now();
  for (const [a, b] of pairs) {
    const la = byLen.get(base[a].length) || [], lb = byLen.get(base[b].length) || [];
    for (const wa of la) {
      const w2 = base.slice(); w2[a] = wa;
      for (const wb of lb) {
        w2[b] = wb;
        candidates++;
        if (!ethers.Mnemonic.isValidMnemonic(w2.join(' '))) continue;
        derived++;
        /* base-order-בלבד בשלב-זה (היפותזת-סדר-נבדקה-בשלב-0) — PBKDF2-אחד-למועמד */
        if (matchWordsNoCheck(w2)) { fs.writeFileSync(OUT, w2.join(' ') + '\n', { mode: 0o600 }); log('MATCH ✅ two-word pos=' + a + ',' + b); return finish(); }
      }
      if (candidates % 1000000 === 0) log('progress: candidates=' + candidates + ' checksum-pass=' + derived + ' elapsed=' + Math.round((Date.now() - t0) / 1000) + 's');
    }
  }
  log('REJECT: two-word sweep exhausted (candidates=' + candidates + ' derived=' + derived + ' elapsed=' + Math.round((Date.now() - t0) / 1000) + 's) — honest stop, nothing written');
  process.exit(3);

  function finish() {
    try { fs.chmodSync(OUT, 0o600); } catch (_) {}
    log('words written to agent/keys/tron-legacy-mnemonic.txt (0600, gitignored, RESEAL will envelope) — cryptographic proof: both legacy doors derive exactly');
  }
}
main().catch((e) => { log('FATAL: ' + String((e && e.message) || e).slice(0, 200)); process.exit(1); });
