#!/usr/bin/env node
/* legacy-verify.cjs — 117k: אורקל-אימות-מנומניק (אפס-דליפה)
 * קלט: נתיב-קובץ-ביטוי (argv[2]) · פלט: checksum-תקף? · כתובות-גזורות · התאמה-מול-דלתות-הידועות.
 * המילים-מעולם-לא-נדפסות. התאמה-מלאה → מדפיס MATCH-מלא (בלי-מילים). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = '/home/z/my-project';
const BS58 = require(path.join(ROOT, 'node_modules', 'bs58'));
const { ethers } = require(path.join(ROOT, 'node_modules', 'ethers'));

const EXPECT = [
  { idx: 0, addr: 'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4' },
  { idx: 1, addr: 'TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr' },
];

function tronAddrFromPriv(privHex, compressed) {
  const pub = compressed
    ? ethers.SigningKey.computePublicKey(privHex, true).slice(2)
    : ethers.SigningKey.computePublicKey(privHex, false).slice(4);
  const kec = ethers.keccak256(Buffer.from(pub, 'hex'));
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), 'hex')]);
  const h2 = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest();
  return BS58.encode(Buffer.concat([payload, h2.subarray(0, 4)]));
}

const phrase = fs.readFileSync(process.argv[2], 'utf8').trim().replace(/\s+/g, ' ');
const words = phrase.split(' ');
const valid = ethers.Mnemonic.isValidMnemonic(phrase);
console.log('[verify] words=' + words.length + ' lengths=' + words.map((w) => w.length).join(''));
console.log('[verify] checksum-valid=' + valid);
if (!valid) { console.log('[verify] verdict=CHECKSUM-FAIL (סדר/קריאה שגויה)'); process.exit(1); }

const PATHS = ["m/44'/195'/0'/0/0", "m/44'/195'/0'/0/1"];
const wallet0 = ethers.HDNodeWallet.fromPhrase(phrase, undefined, PATHS[0]);
const wallet1 = ethers.HDNodeWallet.fromPhrase(phrase, undefined, PATHS[1]);
const a0u = tronAddrFromPriv(wallet0.privateKey, false);
const a1u = tronAddrFromPriv(wallet1.privateKey, false);
const a0c = tronAddrFromPriv(wallet0.privateKey, true);
const a1c = tronAddrFromPriv(wallet1.privateKey, true);
console.log('[verify] idx0 uncompr=' + a0u + ' compr=' + a0c);
console.log('[verify] idx1 uncompr=' + a1u + ' compr=' + a1c);
const m0 = (a0u === EXPECT[0].addr || a0c === EXPECT[0].addr);
const m1 = (a1u === EXPECT[1].addr || a1c === EXPECT[1].addr);
console.log('[verify] match-idx0=' + m0 + ' match-idx1=' + m1);
if (m0 && m1) { console.log('[verify] verdict=FULL-MATCH ✅'); process.exit(0); }
/* אם-checksum-תקף-אבל-אין-התאמה: נסה-מסלולים-אחרים (חשבונות/שינויים/אינדקסים) */
const alts = ["m/44'/195'/0'/0/2", "m/44'/195'/0'/1/0", "m/44'/195'/0'/1/1", "m/44'/195'/1'/0/0", "m/44'/195'/1'/0/1", "m/44'/195'/0/0/0", "m/44'/195'/0/0/1", "m/44'/195'/0'/0", "m/44'/195'/0'/1"];
for (const p of alts) {
  try {
    const w = ethers.HDNodeWallet.fromPhrase(phrase, undefined, p);
    const au = tronAddrFromPriv(w.privateKey, false);
    const ac = tronAddrFromPriv(w.privateKey, true);
    const hit = (au === EXPECT[0].addr || ac === EXPECT[0].addr || au === EXPECT[1].addr || ac === EXPECT[1].addr) ? ' <== EXPECT-HIT' : '';
    console.log('[verify] alt ' + p + ' u=' + au + ' c=' + ac + hit);
  } catch (_) {}
}
console.log('[verify] verdict=CHECKSUM-OK-NO-MATCH (מילים-נכונות? נסה-מסלול-אחר/קריאה-שונה)');
