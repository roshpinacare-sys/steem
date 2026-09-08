#!/usr/bin/env node
/* legacy-tron-recover.cjs — 117k: ריפוי-ריבוני של דלתות-הגשר-הישנות (19.13 TRX)
 *
 * הרקע (docs/117-TRX-POSTMORTEM.md): TRKStC5…(idx0) + TAzZZk…(idx1) נגזרו-ממנמוניק-
 * טרון-ישן שאבד-ברולבק-115. ה-worklog-הישן (שורות 2179/2422 בעותק-recovery) מעיד:
 * "12-מילות-הגזירה נקראו מהתמונה" — התמונה: upload/IMG-20260905-WA0025.jpg (קיימת!).
 *
 * הפרוטוקול-כאן (אפס-דליפה):
 *  1. VLM (z-ai-web-dev-sdk, בקצה-האחורי-בלבד) קורא-את-המילים-מהתמונה-בתוך-הזיכרון.
 *  2. גזירה-דטרמיניסטית m/44'/195'/0'/0/{0,1} (אותו-מתכון-tronbridge: fromPhrase).
 *  3. השוואה-קריפטוגרפית-מול-שתי-הכתובות-הידועות — ההתאמה-היא-ההוכחה (עדיף-על-קריאה-כפולה).
 *  4. רק-בהתאמה-מלאה: כתיבה ל-agent/keys/tron-legacy-mnemonic.txt (0600, gitignored —
 *     וה-guardian-אוטומטית-יחתום-RESEAL-על-המעטפת).
 *  5. בלוג-עולה רק: ורדיקט + כתובות-גזורות + יתרות — **המילים-מעולם-לא-נדפסות**.
 */
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

/* יעדי-אימות (ציבוריים — על-השרשרת, ב-postmortem):
 * 117k-תיקון: הסדר-האמיתי-נמדד-בפועל (legacy-verify.cjs · checksum תקף + שתי-הכתובות-נגזרו):
 * idx0=TAzZZ · idx1=TRKSt. הטבלה-הקודמת-הייתה-הפוכה — זו-הייתה-הסיבה-שהסריקות-לא-מצאו-כלום
 * (matchWordsNoCheck-דרש-idx0=TRKSt-וקיבל-כתובת-אחרת → תמיד-false). */
const EXPECT = [
  { idx: 0, addr: 'TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr', tag: 'רכזת-גשר-ישנה' },
  { idx: 1, addr: 'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4', tag: 'שדרן-גשר-ישן' },
];

function log(msg) { console.log('[legacy-recover] ' + msg); }

/* אותו-מתכון-טרון-של-tronbridge/relay: keccak-אחרון-20 + 0x41 + double-sha256-b58check */
function tronAddrFromPriv(privHex) {
  const { ethers: e } = require(path.join(ROOT, 'node_modules', 'ethers'));
  /* אותו-מתכון-מדויק-של-relay.cjs deriveRegistryTron: מפתח-ציבורי-לא-דחוס (slice-4-מדלג-על-0x04) → keccak → 20-בייטים-אחרונים */
  const pubU = e.SigningKey.computePublicKey(privHex, false).slice(4); // 128-hex-chars (X||Y)
  const kec = e.keccak256(Buffer.from(pubU, 'hex'));
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), 'hex')]);
  const h1 = crypto.createHash('sha256').update(payload).digest();
  const h2 = crypto.createHash('sha256').update(h1).digest();
  return BS58.encode(Buffer.concat([payload, h2.subarray(0, 4)]));
}

function deriveAddrs(words) {
  const phrase = words.join(' ');
  return EXPECT.map(({ idx }) => {
    const w = ethers.HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/195'/0'/0/" + idx);
    return { idx, addr: tronAddrFromPriv(w.privateKey) };
  });
}

function parseWords(text, { strict }) {
  const NOISE = new Set(['mnemonic', 'seed', 'phrase', 'wallet', 'keys', 'backup', 'recovery', 'words', 'secret', 'bip39', 'address', 'private', 'word', 'tron']);
  const lines = String(text || '').split(/\r?\n/);
  const words = [];
  for (const ln of lines) {
    const cleaned = ln.replace(/^\s*\d{1,2}\s*[.)\-:]\s*/, '').trim(); // שורות-ממוספרות
    for (const tok of cleaned.split(/[\s,.;:|]+/)) {
      const w = tok.toLowerCase().replace(/[^a-z]/g, '');
      if (!w) continue;
      if (strict ? (w.length >= 3 && w.length <= 8 && !NOISE.has(w)) : /^[a-z]{2,12}$/.test(w)) words.push(w);
    }
  }
  return words;
}

async function main() {
  if (!fs.existsSync(IMG)) { log('FATAL: key image missing (' + IMG + ')'); process.exit(1); }
  if (fs.existsSync(OUT)) { log('already-recovered: ' + path.basename(OUT) + ' exists (0600) — nothing to do (idempotent)'); return; }

  const ZAI = (await import(path.join(ROOT, 'node_modules', 'z-ai-web-dev-sdk', 'dist', 'index.js'))).default
    || (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  const b64 = fs.readFileSync(IMG).toString('base64');

  /* שלוש-קריאות: שתיים-חופשיות + אחת-ממוספרת — האורקל-האמת-הוא-התאמת-הכתובות-על-השרשרת
   * (התאמה-קריפטוגרפית-של-שתי-דלתות = הוכחה-שאין-מאחוריה-תרחיש-שקר). */
  const prompt = 'This image contains a BIP39 seed phrase (12 words). Output ONLY the 12 words in exact order, space-separated, lowercase, nothing else — no numbering, no explanation.';
  const promptNumbered = 'This image contains a BIP39 seed phrase. Transcribe it as exactly 12 numbered lines, format: "1. word" up to "12. word". Lowercase, one word per line, nothing else.';
  const reads = [];
  for (const [tag, pr] of [['free-1', prompt], ['free-2', prompt], ['numbered', promptNumbered]]) {
    const r = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content: [{ type: 'text', text: pr }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } }] }],
      thinking: { type: 'disabled' },
    });
    const raw = String((r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '');
    const loose = parseWords(raw, { strict: false });
    const strictW = parseWords(raw, { strict: true });
    log(tag + ': tokens loose=' + loose.length + '(' + loose.map((w) => w.length).join('') + ') strict=' + strictW.length + ' (shapes only — never the words)');
    reads.push({ tag, loose, strict: strictW });
  }

  /* האורקל: כל-מועמד-בן-12-מילים (loose-או-strict) → גזירה → התאמה-מלאה-של-שתי-הכתובות.
   * 117k-תוספת: אם-התמונה-בטורים (2×6/3×4) קריאת-שורות-משבשת-סדר — מנסים-גם-סידורי-עמודות.
   * האורקל-הקריפטוגרפי-מכריע: סדר-שגוי-מפיק-כתובות-שגויות-בוודאות-מעשית-מלאה. */
  const colPerm = (w, cols) => {
    const rows = 12 / cols;
    const out = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(w[c * rows + r]);
    return out;
  };
  const permutationsOf = (w) => {
    const set = [w];
    for (const cols of [2, 3, 4, 6]) {
      set.push(colPerm(w, cols));
      const alt = [];
      const rows = 12 / cols;
      for (let r = 0; r < rows; r++) for (let c = cols - 1; c >= 0; c--) alt.push(w[c * rows + r]);
      set.push(alt);
    }
    return set;
  };
  let matched = null;
  const tryCandidate = (cand, tag) => {
    if (cand.length !== 12) return false;
    for (const order of permutationsOf(cand)) {
      try {
        const derived = deriveAddrs(order);
        if (derived.every((d, i) => d.addr === EXPECT[i].addr)) { matched = order; log(tag + ': MATCH ✅ (layout permutation)'); return true; }
      } catch (_) { /* invalid-checksum candidate — honest skip */ }
    }
    log(tag + ': 12-tokens → derive (all permutations) → no-match (honest)');
    return false;
  };
  outer:
  for (const r of reads) {
    for (const cand of [r.strict, r.loose]) { if (tryCandidate(cand, r.tag + '/' + (cand === r.loose ? 'loose' : 'strict'))) break outer; }
  }
  if (!matched) {
    /* 117k-ריפוי-בלתי-הרסני: הצורה-קריאה-יציבה-אך-ה-checksum-נכשל → מילה-אחת-לפחות-נקראה-שגוי.
     * אנומרט-את-המילון-האנגלי-המלא (2048) × 12-מקומות: סינון-checksum-מהיר (בלי-PBKDF2)
     * ואז-אורקל-הכתובות. אפס-דליפה: בלוג-עולה-רק-מספרים. */
    log('checksum-fails on all stable reads → single-word substitution sweep (2048×12, checksum-filtered, address-oracle)');
    let WL = null;
    try { WL = require(path.join(ROOT, 'node_modules', 'ethers', 'wordlists')).LangEn.wordlist(); } catch (_) {}
    if (!WL) { try { WL = require(path.join(ROOT, 'node_modules', 'ethers')).LangEn.wordlist(); } catch (_) {} }
    if (!WL) { log('REJECT: wordlist unavailable for self-heal sweep — honest stop'); process.exit(3); }
    const base = reads[0].strict;
    const valid = (w) => { try { return ethers.Mnemonic.isValidMnemonic(w.join(' ')); } catch (_) { return false; } };
    let checksumPass = 0, tried = 0;
    for (let pos = 0; pos < 12 && !matched; pos++) {
      for (let i = 0; i < 2048 && !matched; i++) {
        const w2 = base.slice(); w2[pos] = WL.getWord(i);
        if (!valid(w2)) continue;
        checksumPass++;
        for (const order of permutationsOf(w2)) {
          tried++;
          try {
            const derived = deriveAddrs(order);
            if (derived.every((d, j) => d.addr === EXPECT[j].addr)) { matched = order; log('MATCH ✅ via single-word self-heal at position ' + (pos + 1) + ' (+layout perm)'); break; }
          } catch (_) {}
        }
      }
    }
    if (!matched) {
      log('REJECT: single-word sweep exhausted (checksum-pass=' + checksumPass + ', derived=' + tried + ') — the image may not be the legacy key, or ≥2 words misread. Honest stop, nothing written, nothing leaked.');
      process.exit(3);
    }
  }

  fs.writeFileSync(OUT, matched.join(' ') + '\n', { mode: 0o600 });
  try { fs.chmodSync(OUT, 0o600); } catch (_) {}
  log('MATCH ✅ — cryptographic proof (both legacy doors derive exactly) — words written to ' + path.basename(path.dirname(OUT)) + '/' + path.basename(OUT) + ' (0600, gitignored, guardian auto-RESEAL will envelope it)');
  log('NEXT: legacy-tron-sweep to consolidate 19.13 TRX into the live registry vault (test-first, bandwidth-guarded)');
}

main().catch((e) => { log('FATAL: ' + String((e && e.message) || e).slice(0, 200)); process.exit(1); });
