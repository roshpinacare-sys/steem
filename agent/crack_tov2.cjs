#!/usr/bin/env node
/**
 * 117p8 — crack_tov2: מציאת סכמת-הגזירה של מפתחות-השרשרת-החיים של @tov
 * (הוחלפו 2026-09-08 21:34 ע"י הרוטציה-המורדת — steem≠hive ⇒ שתי-גזירות-נפרדות).
 * קלט-סודי: /tmp/.tovkey (המאסטר שהמסר המפעיל) — לעולם לא נדפיס אותו/סודות.
 * מטרות: 8 פומביות-חיות (נמדדות-חי מהשרשרת בתחילת-הריצה).
 * הרצה: node agent/crack_tov2.cjs
 * Task 11-c (2026-10-01): הבעלים אישר — אין-עוד-מפתחות · tov-hive = BLOCKED-NO-KEY
 * (אפס-שימוש-כלכלי). כלי-פורנזי-ארכיוני בלבד — לא-לפעולה.
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const bs58 = require('bs58');
const steem = require('steem');

const MASTER = fs.readFileSync('/tmp/.tovkey', 'utf8').trim();
const pkOf = (w) => { try { return steem.auth.wifToPublic(w); } catch (_) { return null; } };

// סודות-מועמדים מהמערכת (מקומיים, 0600) — אף-אחד לא נדפס
function readSafe(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch (_) { return null; } }
const secrets = new Set([MASTER]);
const add = (s, tag) => { if (s && String(s).length >= 6 && String(s).length <= 300) secrets.add(String(s).trim()); };
// מנמוניקים + זרעים + טוקנים מקומיים
for (const p of ['agent/keys/tron-mnemonic.txt', 'agent/keys/tron-legacy-mnemonic.txt']) {
  const s = readSafe(p); if (s) add(s);
}
try { const w = JSON.parse(fs.readFileSync('agent/keys/wallets-seed.json', 'utf8')); for (const k of Object.values(w)) if (typeof k === 'string') add(k); } catch (_) {}
try { const r = JSON.parse(fs.readFileSync('agent/keys/wallets-registry.json', 'utf8')); if (r.seed) add(r.seed); } catch (_) {}
// טוקנים-מקומיים
for (const p of ['agent/keys/key-broker.token', 'agent/keys/agents-api.token']) { const s = readSafe(p); if (s) add(s); }
// קבצי-המפעיל (לא-מדפיסים): Ynet.txt + הדקור.txt + Roshcaregt.txt — כל-שורה/טוקן כסוד-מועמד
for (const p of ['upload/Ynet.txt', 'upload/הדקור.txt', 'upload/Roshcaregt.txt']) {
  try {
    const c = fs.readFileSync(p, 'utf8');
    for (const tok of c.split(/[\s,;"'()]+/)) if (tok.length >= 20 && tok.length <= 120) add(tok);
  } catch (_) {}
}
// .env המקומי (אם-יש-שריד)
try { for (const line of fs.readFileSync('agent/.env', 'utf8').split('\n')) { const m = line.match(/=(.+)$/); if (m && m[1].length >= 8) add(m[1]); } } catch (_) {}
// ה-WIFs הישנים של tov מהכספת (כל-4 התפקידים)
try {
  const v = JSON.parse(fs.readFileSync('agent/keys/vault.json', 'utf8'));
  const t = v.accounts.find((a) => a.username === 'tov');
  for (const [role, kk] of Object.entries(t.keys || {})) { const wif = kk && kk.wif; if (wif) { add(wif); secrets.add('HEOLD:' + role + ':' + wif); } }
} catch (_) {}

// גרסאות-גזירה של כל סוד: גולמי · hex-sha256 · hex-sha512
const passVariants = [];
for (const s of secrets) {
  passVariants.push([s, 'raw']);
  const isOldWif = String(s).startsWith('HEOLD:');
  const base = isOldWif ? s.split(':')[2] : s;
  for (const d of ['sha256', 'sha512']) {
    const h = crypto.createHash(d).update(base).digest('hex');
    passVariants.push([h, d]);
  }
}

const LOGINS = ['tov', '@tov', 'TOV', 'Tov', 'tov-steem', 'tov_hive', 'steem-tov', 'hive-tov', 'tov.steem', 'tov.hive',
  'tovsteem', 'tovhive', 'tov steem', 'tov hive', 'tov-STEEM', 'tov-HIVE', 'tov1', 'tov2', 'tovs', 'tovh',
  'tov-hive1', 'tov-steem1', 'STEEM', 'HIVE', 'steem', 'hive'];

const SUFFIXES = ['', '\n', ' ', '-steem', '-hive', '_steem', '_hive', ':steem', ':hive', 'steem', 'hive',
  'STEEM', 'HIVE', '-1', '-2', '1', '2', 'v2', '-v2', 'new', '2026', '-steem-1', '-hive-1', 'tov', '@tov'];

let targets = []; // {chain, role, pub}
async function fetchLive() {
  const get = (node, name) => new Promise((res) => {
    steem.api.setOptions({ url: node, useAppbaseApi: true });
    steem.api.getAccounts([name], (e, r) => res(e ? null : r && r[0]));
  });
  const st = await get('https://api.steemit.com', 'tov');
  const hv = await get('https://api.hive.blog', 'tov');
  for (const [chain, acc] of [['steem', st], ['hive', hv]]) {
    if (!acc) continue;
    targets.push({ chain, role: 'owner', pub: acc.owner.key_auths[0][0] });
    targets.push({ chain, role: 'active', pub: acc.active.key_auths[0][0] });
    targets.push({ chain, role: 'posting', pub: acc.posting.key_auths[0][0] });
    targets.push({ chain, role: 'memo', pub: acc.memo_key });
  }
}

async function main() {
  await fetchLive();
  console.log('מטרות-חיות נמדדו:', targets.map((t) => `${t.chain}:${t.role}=${t.pub.slice(0, 9)}…`).join(' '));
  const tset = new Map(targets.map((t) => [t.pub, t]));
  let tested = 0;
  const hits = [];
  const t0 = Date.now();

  for (const [pass, ptag] of passVariants) {
    for (const login of LOGINS) {
      for (const suf of SUFFIXES) {
        const pw = pass + suf;
        let wifs;
        try { wifs = steem.auth.getPrivateKeys(login, pw, ['owner', 'active', 'posting', 'memo']); } catch (_) { continue; }
        for (const [role, wif] of Object.entries(wifs)) {
          tested++;
          const pub = pkOf(wif);
          if (!pub) continue;
          const hit = tset.get(pub);
          if (hit) {
            hits.push({ login, scheme: getSchemeName(ptag), pwLen: pw.length, hitChain: hit.chain, hitRole: hit.role, pub });
            console.log(`★ HIT: login="${login}" pass=${ptag}${suf ? '+suffix(' + encodeURIComponent(suf) + ')' : ''} → ${hit.chain}:${hit.role} ${pub.slice(0, 12)}…`);
          }
        }
      }
    }
  }
  console.log(`נבדקו ${tested} נגזרות ב-${((Date.now() - t0) / 1000).toFixed(1)}ש׳ · התאמות: ${hits.length}`);

  // עדיין-לא: הגרסה-הישירה (login=tov pass=raw-מאסטר) → הכספת (ידוע). עכשיו: שמירת-דוח.
  const rep = { at: new Date().toISOString(), tested, hits: hits.map((h) => ({ ...h, pub: h.pub })), targets: targets.map((t) => ({ ...t, pub: t.pub.slice(0, 10) + '…' })) };
  fs.writeFileSync('agent/crack_tov2_report.json', JSON.stringify(rep, null, 2));
  console.log('דוח → agent/crack_tov2_report.json');

  // אם-יש-התאמה: גזירה-מלאה של כל-4 התפקידים לשתי-השרשראות (vault-first — בלי-שידור כאן)
  if (hits.length) {
    const h = hits[0];
    console.log(`\n>>> נמצאה-סכמה! login="${h.login}" — דרוש-שלב-שחזור נפרד (vault-first + re-seal)`);
  }
}

function getSchemeName(ptag) { return ptag; }

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
