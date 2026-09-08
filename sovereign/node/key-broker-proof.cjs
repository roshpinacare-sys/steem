#!/usr/bin/env node
/* key-broker-proof.cjs — 117k: הוכחת-E2E לשער-החתימה
 *
 * מוכיח (בלי-שידור, בלי-עלות, אפס-דליפה):
 *  1) /health חי · /doors מחזיר 8 דלתות (6 ריבוניות + 2 ישנות) עם TAzZZ/TRKSt.
 *  2) לכל-דלתה: POST /sign על-digest-אקראי → שחזור-מפתח-ציבורי-מהחתימה (ecrecover)
 *     → גזירת-כתובת-טרון → התאמה-מלאה לכתובת-הדלתה. זו-הוכחה-קריפטוגרפית-שהמערכת-
 *     שולטת-במפתח-מבלי-שהמפתח-עזב-את-הברוקר.
 *  3) שלילי: טוקן-שגוי → 401 · digest-לא-תקין → 400.
 *  פלט: key-broker-proof.json (רק-מספרים/כתובות-ציבוריות) · exit 0 = הכל-ירוק.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const { ethers } = require(path.join(ROOT, 'node_modules', 'ethers'));
const bs58 = require(path.join(ROOT, 'node_modules', 'bs58'));
const TOKEN = fs.readFileSync(path.join(ROOT, 'agent', 'keys', 'key-broker.token'), 'utf8').trim();
const BASE = 'http://127.0.0.1:3040';

function tronAddrFromPubUncompr(pubUHexNo04) {
  const kec = ethers.keccak256(Buffer.from(pubUHexNo04, 'hex'));
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), 'hex')]);
  const h2 = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest();
  return bs58.encode(Buffer.concat([payload, h2.subarray(0, 4)]));
}

async function main() {
  const out = { at: new Date().toISOString(), checks: [], pass: 0, fail: 0 };
  const h = await fetch(BASE + '/health').then((r) => r.json());
  out.checks.push({ name: 'health', ok: !!h.ok && h.doors >= 8 });
  const d = await fetch(BASE + '/doors', { headers: { 'x-kb-token': TOKEN } }).then((r) => r.json());
  const doorList = d.doors || [];
  out.checks.push({ name: 'doors-count', ok: doorList.length >= 8, doors: doorList.length });
  out.checks.push({ name: 'legacy-present', ok: doorList.some((x) => x.address === 'TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr') && doorList.some((x) => x.address === 'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4') });
  for (const door of doorList) {
    const digest = crypto.randomBytes(32).toString('hex');
    const s = await fetch(BASE + '/sign', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kb-token': TOKEN }, body: JSON.stringify({ door: door.id, digestHex: digest }) }).then((r) => r.json());
    let ok = false;
    if (s.ok) {
      const sigHex = s.signatureHex;
      const sigObj = { r: '0x' + sigHex.slice(0, 64), s: '0x' + sigHex.slice(64, 128), v: parseInt(sigHex.slice(128, 130), 16) };
      const pub = ethers.SigningKey.recoverPublicKey('0x' + digest, sigObj);
      const addr = tronAddrFromPubUncompr(pub.slice(4));
      ok = addr === door.address;
    }
    out.checks.push({ name: 'sign-recover:' + door.id, ok, door: door.address });
  }
  const bad401 = await fetch(BASE + '/doors', { headers: { 'x-kb-token': 'ff'.repeat(32) } });
  out.checks.push({ name: 'deny-wrong-token', ok: bad401.status === 401, status: bad401.status });
  const bad400 = await fetch(BASE + '/sign', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kb-token': TOKEN }, body: JSON.stringify({ door: doorList[0] && doorList[0].id, digestHex: 'abcd' }) });
  out.checks.push({ name: 'deny-bad-digest', ok: bad400.status === 400, status: bad400.status });

  out.pass = out.checks.filter((c) => c.ok).length;
  out.fail = out.checks.filter((c) => !c.ok).length;
  out.verdict = out.fail === 0 ? 'ALL-GREEN' : 'BROKEN';
  fs.writeFileSync(path.join(HERE, 'key-broker-proof.json'), JSON.stringify(out, null, 2));
  console.log('[kb-proof] ' + out.verdict + ' · pass=' + out.pass + ' fail=' + out.fail);
  for (const c of out.checks) console.log('[kb-proof]   ' + (c.ok ? '✓' : '✗') + ' ' + c.name + (c.door ? ' ' + c.door : ''));
  process.exit(out.fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('[kb-proof] FATAL', e.message); process.exit(1); });
