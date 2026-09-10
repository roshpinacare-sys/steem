#!/usr/bin/env node
/**
 * R18e — secret-sweep (קריאה-בלבד · אפס-סודות-בפלט)
 * ====================================================
 * בודק את כל הקבצים המנוטרים בגיט מול שתי רשימות-אמת:
 *   1) הכספת המקומית agent/keys/vault.json (השוואה-ישירה של מחרוזות-סוד)
 *   2) הפומביות-החיות על-השרשרת (/tmp/r18audit.json · agent/rotation_evidence.json · הכספת)
 *      — ע"י גזירת-מפתח-ציבורי מתוך WIF תקין (base58check) והשוואה
 *
 * חוקי-פלט: קובץ:שורה · אורך · תו-קידומת · פסק-דין. אף-פעם לא תוכן הסוד.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const ROOT = '/home/z/my-project';
process.chdir(ROOT);

let steem = null;
try { steem = require('steem'); } catch (_) {}

const B58ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decodeFull(s) {
  let n = 0n;
  for (const c of s) {
    const i = B58ALPHABET.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let pad = 0;
  for (const c of s) { if (c === '1') pad++; else break; }
  return Buffer.from('00'.repeat(pad) + hex, 'hex');
}
function validWif(s) {
  if (!/^[5][1-9A-HJ-NP-Za-km-z]{50}$/.test(s)) return false;
  const raw = b58decodeFull(s);
  if (!raw || raw.length !== 37 || raw[0] !== 0x80) return false;
  const payload = raw.slice(0, 33);
  const sum = raw.slice(33);
  const h = crypto.createHash('sha256').update(
    crypto.createHash('sha256').update(payload).digest()
  ).digest();
  return sum.equals(h.slice(0, 4));
}
function wifToPub(s) {
  try {
    if (steem && steem.auth && typeof steem.auth.wifToPublic === 'function') {
      const p = steem.auth.wifToPublic(s);
      if (typeof p === 'string') return p;
    }
  } catch (_) {}
  return null;
}

// ---------- אוספי-אמת ----------
const vaultStrings = new Set();   // כל-מחרוזת-סוד בכספת (השוואה-ישירה)
const pubLabels = new Map();      // pub → label (כספת + ביקורת-חיה)
const vaultWifs = [];

function labelOf(vaultPath) { return vaultPath; }

function walkCollect(obj, p, sink) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const child = p ? p + '.' + k : k;
    if (typeof v === 'string') sink(child, k, v);
    else walkCollect(v, child, sink);
  }
}

// כספת
let vaultOk = false;
try {
  const v = JSON.parse(fs.readFileSync('agent/keys/vault.json', 'utf8'));
  walkCollect(v, 'vault', (p, k, s) => {
    if (/wif/i.test(k) || /priv/i.test(k) || /seed/i.test(k)) {
      if (!/^STM|^TST/.test(s)) {
        vaultStrings.add(s);
        if (validWif(s)) vaultWifs.push({ path: p });
        pubLabels.set(s, p + ' [SOD]'); // לא-צריך-לקרות; הגנה-עודפת
      }
    }
    if (/^STM|^TST/.test(s) || /pub/i.test(k)) {
      if (s.length > 20) pubLabels.set(s, p);
    }
    // פומביות אינן סודות — כבר-פומביות-על-השרשרת
    if (s.length >= 40 && !/^STM|^TST/.test(s) && !/\.pub$/i.test(p)) vaultStrings.add(s);
  });
  vaultOk = true;
} catch (e) { console.log('vault: לא-זמינה (' + (e.code || e.message) + ') — ממשיך-עם-מקורות-פומביים'); }

// ביקורת-חיה R18d (פומביות-מהשרשראות)
for (const f of ['/tmp/r18audit.json', 'agent/rotation_evidence.json']) {
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    walkCollect(j, path.basename(f), (p, k, s) => {
      if (/^STM|^TST/.test(s)) pubLabels.set(s, p);
    });
  } catch (_) {}
}

// ---------- סריקת-קבצים-מנוטרים ----------
let tracked = [];
try {
  tracked = execSync('git ls-files -z', { maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean);
} catch (e) { console.log('ERR git ls-files: ' + e.message); process.exit(1); }

const WIF_RE = /\b5[1-9A-HJ-NP-Za-km-z]{50}\b/g;
const HEX64_RE = /\b[0-9a-f]{64}\b/g;
const PASS_RE = /(?:password|passphrase|pass_?word|master_?pass|seal_?pass)\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/gi;

const findings = [];
let scanned = 0, skippedBinary = 0, skippedSize = 0;
let hexTotal = 0;

for (const rel of tracked) {
  let st;
  try { st = fs.statSync(rel); } catch (_) { continue; }
  if (!st.isFile()) continue;
  if (st.size > 12 * 1024 * 1024) { skippedSize++; continue; }
  if (/\.(png|jpg|jpeg|gif|webp|ico|gz|zip|enc|tar|db|pdf|woff2?|ttf)$/i.test(rel)) { skippedBinary++; continue; }
  let buf;
  try { buf = fs.readFileSync(rel); } catch (_) { continue; }
  if (buf.includes(0)) { skippedBinary++; continue; }
  const text = buf.toString('utf8');
  scanned++;

  const lines = null; // מחושב-לפי-ביקוש

  const lineAt = (idx) => text.slice(0, idx).split('\n').length;

  // 1) WIF candidates
  for (const m of text.matchAll(WIF_RE)) {
    const s = m[0];
    const info = { file: rel, line: lineAt(m.index), kind: 'wif-like', head: s.slice(0, 2), len: s.length };
    if (!validWif(s)) { info.verdict = 'תבנית-בלבד (checksum-כושל)'; findings.push(info); continue; }
    info.verdict = 'WIF-תקין';
    if (vaultStrings.has(s)) info.verdict += ' · =סוד-מהכספת';
    const pub = wifToPub(s);
    if (pub) {
      info.hasPub = true;
      if (pubLabels.has(pub)) info.verdict += ' · חי: ' + pubLabels.get(pub);
      else info.verdict += ' · פומבית-לא-מזוהה (לא-בכספת/לא-בביקורת)';
    }
    findings.push(info);
  }

  // 2) השוואה-ישירה: מחרוזות-כספת בתוך קובץ
  if (vaultOk) {
    for (const s of vaultStrings) {
      if (s.length < 40) continue;
      const idx = text.indexOf(s);
      if (idx >= 0) {
        findings.push({ file: rel, line: lineAt(idx), kind: 'vault-string-hit', head: s.slice(0, 2), len: s.length, verdict: 'שווה-לסוד-בכספת' });
      }
    }
  }

  // 3) סיסמאות-קשיחות בקוד
  for (const m of text.matchAll(PASS_RE)) {
    const s = m[1];
    findings.push({ file: rel, line: lineAt(m.index), kind: 'hardcoded-pass', head: s.slice(0, 2), len: s.length, verdict: 'מחרוזת-סיסמה-מקודדת (שווה-לכספת: ' + (vaultStrings.has(s) ? 'כן' : 'לא') + ')' });
  }

  // 4) ספירת-hex64 (שקיפות-בלבד)
  const hexes = text.match(HEX64_RE);
  if (hexes && hexes.length) hexTotal += hexes.length;
}

// ---------- דוח ----------
console.log('== R18e secret-sweep ==');
console.log('steem-lib: ' + (steem ? 'זמינה' : 'לא-זמינה') + ' · כספת: ' + (vaultOk ? 'נטענה' : 'לא') + ' · נסרקו ' + scanned + ' קבצים (דילוג: ' + skippedBinary + ' בינאריים, ' + skippedSize + ' ענקיים) · hex64-סה"כ: ' + hexTotal);
console.log('פומביות-מוכרות: ' + pubLabels.size + ' · כספת: ' + vaultWifs.length + ' WIF-תקינים');

const live = findings.filter(f => /חי:|=סוד-מהכספת|שווה-לסוד/.test(f.verdict) && !/פומבית/.test(f.verdict));
const wifValid = findings.filter(f => f.verdict.startsWith('WIF-תקין'));
const wifShape = findings.filter(f => f.verdict.startsWith('תבנית-בלבד'));
const passes = findings.filter(f => f.kind === 'hardcoded-pass');

console.log('\n-- חורים-קריטיים (מפתח-חי/שווה-לכספת): ' + live.length);
for (const f of live) console.log('  !! ' + f.file + ':' + f.line + ' ' + f.verdict);

console.log('\n-- WIF-תקינים (לא-מזוהים-כחיים): ' + wifValid.filter(f => !/חי:|=סוד/.test(f.verdict)).length);
for (const f of wifValid) { if (!/חי:|=סוד/.test(f.verdict)) console.log('  ~ ' + f.file + ':' + f.line + ' ' + f.verdict); }

console.log('\n-- תבניות-WIF-לא-תקפות: ' + wifShape.length);
const byFile = {};
for (const f of wifShape) { byFile[f.file] = (byFile[f.file] || 0) + 1; }
for (const [f, c] of Object.entries(byFile)) console.log('  · ' + f + ' ×' + c);

console.log('\n-- סיסמאות-מקודדות: ' + passes.length);
for (const f of passes) console.log('  $ ' + f.file + ':' + f.line + ' len=' + f.len + ' p=' + f.head + '** ' + f.verdict);
console.log('\n== סוף-דוח (אפס-תוכן-סודות-הודפס) ==');
