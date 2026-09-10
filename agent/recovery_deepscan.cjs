#!/usr/bin/env node
/**
 * 117p8-R9 — recovery_deepscan: הסריקה-העמוקה על-כל-חומר-החילוץ (הזיפ-המקורי + הכספת-המפוענחת)
 * הרקע: corpus_resweep (R3) סרק-בייטים-גלומיים-של-ארכיונים — WIF בתוך-zip/tar לא-נראה ל-regex.
 * R9: הכל פורק-קודם (steem-main.zip → 714 קבצים · KEYS-BACKUP.tar.enc → 14 קבצי-מפתחות ·
 *      fleet_keys.enc → כספת-2026-09-06 + .env) — ועתה סריקת-WIF אמיתית על-טקסט-פתוח.
 * מקורות: .recovery-extract (עץ-git המשוחזר 709+4) · /tmp/zip-extract (פנים-הזיפ) ·
 *          /tmp/keys-decrypt/keys-backup (bundle-2026-09-09) · /tmp/fleet-stamp-open (חותמת-2026-09-06)
 * מטרות: get_accounts חי משתי-השרשראות · פלט-מאובטח: קידומות-בלבד · אפס-סודות-ב-stdout/דוח.
 * הרצה: node agent/recovery_deepscan.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const steem = require('steem');

const STEEM_RPC = 'https://api.steemit.com';
const HIVE_RPC = 'https://api.hive.blog';
const ACCOUNTS = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];
const ROLES = ['owner', 'active', 'posting', 'memo'];

const SOURCES = [
  ['/home/z/my-project/.recovery-extract', 'extract-tree'],
  ['/tmp/zip-extract', 'zip-inner'],
  ['/tmp/keys-decrypt/keys-backup', 'bundle-2026-09-09'],
  ['/tmp/fleet-stamp-open', 'fleet-stamp-2026-09-06'],
];

function wifValid(w) {
  try {
    const raw = require('bs58').decode(w);
    if (raw.length !== 37 && raw.length !== 38) return false;
    const body = raw.subarray(0, raw.length - 4);
    const cs = raw.subarray(raw.length - 4);
    const h = crypto.createHash('sha256').update(crypto.createHash('sha256').update(body).digest()).digest();
    if (!h.subarray(0, 4).equals(cs)) return false;
    if (body[0] !== 0x80) return false;
    return true;
  } catch (_) { return false; }
}
function wifToPub(w) {
  try { return steem.auth.wifToPublic(w); } catch (_) { return null; }
}
const mask = (w) => w.slice(0, 4) + '…' + w.slice(-2);
const WIF_RE = /[5JKL9][1-9A-HJ-NP-Za-km-z]{50,51}/g;

function* walk(dir, depth = 0) {
  if (depth > 8) return;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (e.isFile()) yield p;
  }
}

// ── 1. קורפוס ──
const corpus = new Map(); // wif -> Set(sources)
const addWif = (w, src) => {
  if (!wifValid(w)) return;
  if (!corpus.has(w)) corpus.set(w, new Set());
  corpus.get(w).add(src);
};
let filesScanned = 0;
const perSource = {};
for (const [root, tag] of SOURCES) {
  if (!fs.existsSync(root)) { perSource[tag] = 'MISSING'; continue; }
  let n = 0;
  for (const p of walk(root)) {
    let st; try { st = fs.statSync(p); } catch (_) { continue; }
    if (st.size > 16 * 1024 * 1024) continue;
    let s; try { s = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
    n++; filesScanned++;
    for (const m of s.match(WIF_RE) || []) addWif(m, tag);
  }
  perSource[tag] = n;
}
console.log('corpus: files=' + filesScanned + ' · ' + JSON.stringify(perSource) + ' · valid-WIFs=' + corpus.size);

// ── 2. מטרות-חיות ──
function getAccounts(url, names) {
  steem.api.setOptions({ url });
  return new Promise((res, rej) => steem.api.getAccounts(names, (e, r) => (e ? rej(e) : res(r))));
}
const auths = (acc) => {
  const out = {};
  for (const r of ['owner', 'active', 'posting']) out[r] = acc[r] && acc[r].key_auths && acc[r].key_auths[0] ? acc[r].key_auths[0][0] : null;
  out.memo = acc.memo_key || null;
  return out;
};

(async () => {
  const targets = new Map(); // pub -> [{account,chain,role}]
  const chainState = {};
  for (const [chain, url] of [['steem', STEEM_RPC], ['hive', HIVE_RPC]]) {
    try {
      const rows = await getAccounts(url, ACCOUNTS);
      for (const row of rows) {
        const a = auths(row);
        chainState[chain] = chainState[chain] || {};
        chainState[chain][row.name] = a;
        for (const r of ROLES) if (a[r]) {
          if (!targets.has(a[r])) targets.set(a[r], []);
          targets.get(a[r]).push({ account: row.name, chain, role: r });
        }
      }
    } catch (e) { console.log('chain-error ' + chain + ': ' + e.message.slice(0, 60)); }
  }
  let pubCount = 0;
  for (const v of targets.values()) pubCount += v.length;
  console.log('live targets: ' + pubCount + ' roles · ' + targets.size + ' distinct pubs · ' + ACCOUNTS.length + ' accounts × 2 chains');

  // ── 3. גזירה והתאמה ──
  const hits = [];
  let derived = 0;
  for (const [wif, srcs] of corpus) {
    const pub = wifToPub(wif);
    if (!pub) continue;
    derived++;
    const t = targets.get(pub);
    if (t) for (const m of t) hits.push({ ...m, wif: mask(wif), pub: pub.slice(0, 12) + '…', src: [...srcs].join('+') });
  }
  console.log('derived=' + derived + ' · MATCHES=' + hits.length);
  for (const h of hits) console.log('  HIT ' + h.account + ' · ' + h.chain + ' · ' + h.role + ' · wif=' + h.wif + ' · pub=' + h.pub + ' · src=' + h.src);

  // ── 4. כיסוי-חשבונות ──
  const coverage = {};
  for (const acc of ACCOUNTS) {
    for (const chain of ['steem', 'hive']) {
      const need = ROLES.filter((r) => chainState[chain] && chainState[chain][acc] && chainState[chain][acc][r]);
      const got = hits.filter((h) => h.account === acc && h.chain === chain).map((h) => h.role);
      coverage[acc + '.' + chain] = got.length + '/' + need.length + (got.length === need.length && need.length ? ' FULL' : need.length ? ' partial:' + got.join(',') : ' (no-chain-data)');
    }
  }

  // ── 5. דוח (מאובטח — קידומות-בלבד) ──
  const report = {
    at: new Date().toISOString(),
    corpus: { filesScanned, perSource, validWifs: corpus.size, derived },
    matches: hits,
    coverage,
  };
  fs.writeFileSync('/home/z/my-project/agent/recovery_deepscan_report.json', JSON.stringify(report, null, 2) + '\n');
  console.log('report → agent/recovery_deepscan_report.json');

  const tovFull = hits.filter((h) => h.account === 'tov');
  console.log('TOV: ' + tovFull.length + ' role-hits (' + [...new Set(tovFull.map((h) => h.chain))].join('+') + ')');
  const factory = [...corpus.keys()].length;
  console.log('corpus-size=' + factory);
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
