#!/usr/bin/env node
/**
 * 117p8 — זיהוי-פורנזי של המפתח שהמסר המפעיל (tov)
 * קלט: /tmp/.tovkey (0600) — לעולם לא נדפיס את הסוד או נגזרות סוד; קידומות-פומביות בלבד.
 * מבחנים: base58check(WIF שארשת-גרסה) · גזירת-privkey-חלונות · secp256k1→STM-pub ·
 *         ed25519→Solana-pub · master-password-נגזרות (steem.auth.getPrivateKeys)
 * מול: 8-הפומביות-החיות של tov (Steem+Hive) + כל-הפומביות בכספת (11-חשבונות).
 * הרצה: node agent/identify_tov_key.cjs
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const bs58 = require('bs58');
const steem = require('steem');
const nacl = require('tweetnacl');

const KEY = fs.readFileSync('/tmp/.tovkey', 'utf8').trim();
const TAG = KEY.slice(0, 4) + '…(len=' + KEY.length + ')';

// ── אמת-מידה על השרשרת (117p8 פורנזיקה): 8 פומביות-חיות של tov ──
const TOV_LIVE = {
  steem: {
    owner: 'STM6GxKCvaHX19RE7x3wQ2nt9SWtDzhBH1TYrxghr3zoYUFHCDb7H',
    active: 'STM7q6Udi4hSJf29mhUo89rcSuFnPw3GnhTX8LmhG2mcj67iRpHkw',
    posting: 'STM8QuHf4puU67RAKAbZsRJqsmi7hYGWKe9b81JdvSZgGNZiJqxq5',
    memo: 'STM5M2vUyDTjuf3ofkQNzdxjm3UhJ3G2oscoXb8AXvKmK6mf4GUHf',
  },
  hive: {
    owner: 'STM72T4defMbBARJd7Hybg52tiAzc6WTgHsxFM2SF2uX4FVKwQtsw',
    active: 'STM4wCC3Qq2HxE9DLrny5rAHrcMM8NvEV3mCjEHU8v6WSkDvQWnhf',
    posting: 'STM6Mg3tZFzc5s1czV84G3HVdhQabtv8h28n1kgVkd8D4ywECD2HM',
    memo: 'STM62qAypDH6zDAZqRENhAfxpuN7j5B1YT2nh1Th5g784awFYH9c5',
  },
};
const TOV_LIVE_FLAT = Object.entries(TOV_LIVE)
  .flatMap(([chain, roles]) => Object.entries(roles).map(([role, pub]) => ({ chain, role, pub })));

// ── כספת: מפת-כל-הפומביות (pub -> תווית) ──
const VAULT = JSON.parse(fs.readFileSync('agent/keys/vault.json', 'utf8'));
const PUBMAP = {};
function pkOf(wif) { try { return steem.auth.wifToPublic(wif); } catch (_) { return null; } }
for (const a of VAULT.accounts || []) {
  const ks = a.keys || {};
  const roleEntries = (ks.posting || ks.steem || ks.hive) ? Object.entries(ks) : [];
  for (const [k, v] of roleEntries) {
    if (k === 'steem' || k === 'hive') {
      for (const [role, vv] of Object.entries(v || {})) {
        const pub = (vv && typeof vv === 'object' ? (vv.pub || pkOf(vv.wif)) : (typeof vv === 'string' ? pkOf(vv) : null));
        if (pub) PUBMAP[pub] = `${a.username}:${k}:${role}`;
      }
    } else if (v) {
      const pub = typeof v === 'object' ? (v.pub || pkOf(v.wif)) : (typeof v === 'string' ? pkOf(v) : null);
      if (pub) PUBMAP[pub] = `${a.username}:${k}`;
    }
  }
}
// self-test של מפת-הכספת (בלי הדפסת סוד)
let vaultDerived = 0;
for (const label of Object.values(PUBMAP)) vaultDerived++;
console.log(`vault-map: ${vaultDerived} פומביות ממופות מ-11-חשבונות`);

function classify(pub) {
  const live = TOV_LIVE_FLAT.find((x) => x.pub === pub);
  if (live) return `★TOV-LIVE ${live.chain}:${live.role}`;
  if (PUBMAP[pub]) return `vault:${PUBMAP[pub]}`;
  return null;
}

const findings = { steem: [], solana: [], master: [], raw: {} };

// ── 1. base58 דיקוד ──
let bytes = null;
try { bytes = bs58.decode(KEY); } catch (e) { console.log('base58: שגיאה', e.message); }
if (bytes) {
  findings.raw.len = bytes.length;
  findings.raw.firstByte = '0x' + bytes[0].toString(16);
  console.log(`base58-decode: ${bytes.length} בייטים · בייט-ראשון=${findings.raw.firstByte}`);

  // ── 2. WIF checksum (sha256d) — כל גרסה ──
  if (bytes.length >= 5) {
    const payload = bytes.slice(0, -4);
    const chk = bytes.slice(-4);
    const h = crypto.createHash('sha256').update(payload).digest();
    const h2 = crypto.createHash('sha256').update(h).digest();
    const ok = h2.slice(0, 4).equals(chk);
    console.log(`base58check(sha256d): ${ok ? 'תקין' : 'כושל'}`);
    if (ok) {
      const version = payload[0];
      let priv = payload.slice(1);
      if (priv.length === 33 && priv[32] === 1) priv = priv.slice(0, 32);
      console.log(`WIF-גרסה=0x${version.toString(16)} · priv-אורך=${priv.length}`);
      if (version === 0x80 && priv.length === 32) {
        // Steem-pub
        const wif = bs58.encode(Buffer.concat([Buffer.from([0x80]), priv, h2.slice(0, 4)]));
        let pub = null; try { pub = steem.auth.wifToPublic(wif); } catch (_) {}
        if (pub) {
          const cls = classify(pub);
          console.log(`secp256k1-פומבית: ${pub.slice(0, 9)}… · ${cls || 'לא-מוכרת'}`);
          findings.steem.push({ pub, cls });
        }
      }
      // ed25519 מהגרעין (אחרי-גרסה)
      if (priv.length >= 32) {
        const seed = priv.slice(0, 32);
        const kp = nacl.sign.keyPair.fromSeed(seed);
        const solPub = bs58.encode(kp.publicKey);
        console.log(`ed25519(גרעין)-Solana-pub: ${solPub}`);
        findings.solana.push(solPub);
      }
    }
  }

  // ── 3. ed25519 ישיר ──
  if (bytes.length === 64) {
    const kp = nacl.sign.keyPair.fromSecretKey(bytes);
    console.log(`ed25519(64B-secret)-Solana-pub: ${bs58.encode(kp.publicKey)}`);
    findings.solana.push(bs58.encode(kp.publicKey));
  }
  if (bytes.length === 32) {
    const kp = nacl.sign.keyPair.fromSeed(bytes);
    console.log(`ed25519(32B-seed)-Solana-pub: ${bs58.encode(kp.publicKey)}`);
    findings.solana.push(bs58.encode(kp.publicKey));
  }

  // ── 4. חלונות-32B כ-privkey secp256k1 (steem-js ecc) ──
  const eccPkFromBuf = (buf) => {
    try {
      const ecc = steem.auth.ecc || require('steem/lib/auth/ecc');
      const P = ecc.PrivateKey.fromBuffer(Buffer.from(buf));
      return P.toPublic().toString();
    } catch (_) { return null; }
  };
  const starts = [0, 1, 2, 4, 6].filter((s) => s + 32 <= bytes.length);
  for (const s of starts) {
    const pub = eccPkFromBuf(bytes.slice(s, s + 32));
    if (!pub) continue;
    const cls = classify(pub);
    if (cls) {
      console.log(`חלון[${s}]+32B→secp256k1: ${pub.slice(0, 9)}… · ${cls}`);
      findings.steem.push({ pub, cls, window: s });
    }
  }

  // ── 5. ed25519 חלונות (seed בכל היסט) ──
  for (const s of starts) {
    const kp = nacl.sign.keyPair.fromSeed(bytes.slice(s, s + 32));
    findings.solana.push(bs58.encode(kp.publicKey));
  }
}

// ── 6. master-password נגזרות (tov + headcorner) ──
for (const acct of ['tov', 'headcorner']) {
  try {
    const dk = steem.auth.getPrivateKeys(acct, KEY, ['owner', 'active', 'posting', 'memo']);
    for (const [role, wif] of Object.entries(dk)) {
      const pub = pkOf(wif);
      if (!pub) continue;
      const cls = classify(pub);
      if (cls) {
        console.log(`master-derive(${acct}:${role}): ${pub.slice(0, 9)}… · ${cls}`);
        findings.master.push({ acct, role, pub, cls });
      }
    }
    console.log(`master-derive(${acct}): הושלם — התאמות: ${findings.master.filter((m) => m.acct === acct).length}`);
  } catch (e) {
    console.log(`master-derive(${acct}): שגיאה ${e.message}`);
  }
}

// ── 7. יעדי-Solana מהמערכת (xwallets אם-קיים) ──
try {
  const xw = JSON.parse(fs.readFileSync('agent/keys/xwallets.json', 'utf8'));
  const sysSols = (xw.solana || []).map((w) => w.address);
  console.log(`xwallets-Solana-ארנקים: ${sysSols.length} (${sysSols.map((s) => s.slice(0, 6) + '…').join(' ')})`);
  findings.systemSolana = sysSols;
} catch (_) {
  console.log('xwallets: אין-קובץ (אולי-אבד-ב-reset)');
  findings.systemSolana = [];
}

fs.writeFileSync('agent/identify_tov_key_report.json', JSON.stringify({ at: new Date().toISOString(), tag: TAG, findings }, null, 2));
console.log('=== סיום — דוח: agent/identify_tov_key_report.json (בלי-סודות) ===');
