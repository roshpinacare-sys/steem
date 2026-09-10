#!/usr/bin/env node
/**
 * 117p8-R3 — corpus_resweep: כל-חומר-המפתחות שבידי מול הפומביות-החיות של כל-החשבונות
 * (הסריקות-הקודמות התאימו מול-הכספת; הזווית-החסרה: התאמה מול-השרשרת-החיה של כל-חשבון/שרשרת/תפקיד)
 * מקורות: דיסק-מלא (ללא node_modules/.git) · עץ-git 263c34e^/download/recovery (709 blobs) · כספת
 * מטרות: get_accounts חי משתי-השרשראות · פלט-מאובטח: קידומות-בלבד
 * הרצה: node agent/corpus_resweep.cjs
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bs58 = require('bs58');
const steem = require('steem');

const STEEM_RPC = 'https://api.steemit.com';
const HIVE_RPC = 'https://api.hive.blog';
const ACCOUNTS = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];
const ROLES = ['owner', 'active', 'posting', 'memo'];
const GIT_COMMIT = '263c34e^';
const GIT_PREFIX = 'download/recovery';

function wifValid(w) {
  try {
    const raw = bs58.decode(w);
    if (raw.length !== 37 && raw.length !== 38) return false;
    const body = raw.subarray(0, raw.length - 4);
    const cs = raw.subarray(raw.length - 4);
    const h = crypto.createHash('sha256').update(crypto.createHash('sha256').update(body).digest()).digest();
    if (!h.subarray(0, 4).equals(cs)) return false;
    if (body[0] !== 0x80) return false;
    return body.subarray(1, 34); // privkey (33 bytes incl. compression suffix)
  } catch (_) { return false; }
}

function wifToPub(w) {
  const priv = wifValid(w);
  if (!priv) return null;
  try {
    const secp = require('secp256k1');
    const pk = secp.publicKeyCreate(priv, true);
    const cs = crypto.createHash('sha256').update(crypto.createHash('sha256').update(pk).digest()).digest().subarray(0, 4);
    return 'STM' + bs58.encode(Buffer.concat([pk, cs]));
  } catch (_) { return null; }
}

const mask = (w) => w.slice(0, 4) + '…' + w.slice(-2);
const WIF_RE = /[5JKL9][1-9A-HJ-NP-Za-km-z]{50,51}/g;

// ── 1. קורפוס-דיסק ──
function* walk(dir, depth = 0) {
  if (depth > 6) return;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of ents) {
    if (e.name.startsWith('.') && e.name !== '.env') continue;
    if (['node_modules', '.git', '.next', 'dist', 'build'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (e.isFile()) yield p;
  }
}

const corpus = new Map(); // wif -> sources
const addWif = (w, src) => {
  if (wifValid(w)) {
    if (!corpus.has(w)) corpus.set(w, []);
    const arr = corpus.get(w);
    if (arr.length < 4 && !arr.includes(src)) arr.push(src);
  }
};

let diskFiles = 0;
for (const p of walk('.')) {
  let st; try { st = fs.statSync(p); } catch (_) { continue; }
  if (st.size > 8 * 1024 * 1024) continue;
  let s; try { s = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
  diskFiles++;
  for (const m of s.match(WIF_RE) || []) addWif(m, 'disk:' + p.slice(0, 60));
}

// ── 2. עץ-git (עץ-השחזור שנמחק-מהדיסק) ──
let gitFiles = 0;
try {
  const files = execSync(`git ls-tree -r "${GIT_COMMIT}" --name-only`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter((f) => f.startsWith(GIT_PREFIX));
  for (const f of files) {
    let buf; try { buf = execSync(`git cat-file blob "${GIT_COMMIT}:${f}"`, { maxBuffer: 32 * 1024 * 1024 }); } catch (_) { continue; }
    gitFiles++;
    for (const m of buf.toString('latin1').match(WIF_RE) || []) addWif(m, 'git:' + f.slice(0, 55));
  }
} catch (e) { console.log('git-tree skip: ' + e.message.slice(0, 60)); }

console.log('corpus: disk-files=' + diskFiles + ' · git-blobs=' + gitFiles + ' · valid-WIFs=' + corpus.size);

// ── 3. מטרות-חיות מהשרשרת ──
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
  const targets = new Map(); // pub -> {account, chain, role}
  const chainState = {};
  for (const [chain, url] of [['steem', STEEM_RPC], ['hive', HIVE_RPC]]) {
    const rows = await getAccounts(url, ACCOUNTS);
    for (const row of rows) {
      const a = auths(row);
      chainState[chain] = chainState[chain] || {};
      chainState[chain][row.name] = a;
      for (const r of ROLES) if (a[r]) targets.set(a[r], { account: row.name, chain, role: r });
    }
  }
  console.log('live targets: ' + targets.size + ' pubs across ' + ACCOUNTS.length + ' accounts × 2 chains');

  // ── 4. גזירה והתאמה ──
  const hits = [];
  let derived = 0;
  for (const [wif, srcs] of corpus) {
    const pub = wifToPub(wif);
    if (!pub) continue;
    derived++;
    const t = targets.get(pub);
    if (t) hits.push({ ...t, wif: mask(wif), pub: pub.slice(0, 12) + '…', src: srcs[0] });
  }
  console.log('derived=' + derived + ' · MATCHES=' + hits.length);
  for (const h of hits) console.log('  HIT ' + h.account + ' · ' + h.chain + ' · ' + h.role + ' · wif=' + h.wif + ' · pub=' + h.pub + ' · src=' + h.src);

  // ── 5. דוח (מאובטח) ──
  const report = {
    at: new Date().toISOString(),
    corpus: { diskFiles, gitBlobs: gitFiles, validWifs: corpus.size, derived },
    matches: hits,
    chainState: Object.fromEntries(
      Object.entries(chainState).map(([c, accs]) => [
        c,
        Object.fromEntries(
          Object.entries(accs).map(([n, a]) => [
            n,
            Object.fromEntries(Object.entries(a).map(([r, p]) => [r, p ? p.slice(0, 12) + '…' : null])),
          ])
        ),
      ])
    ),
  };
  fs.writeFileSync('agent/corpus_resweep_report.json', JSON.stringify(report, null, 2));
  console.log('report → agent/corpus_resweep_report.json (masked)');

  // סיכום-חיבוריות חי
  for (const acc of ACCOUNTS) {
    const line = ROLES.map((r) => {
      const s = chainState.steem[acc] && chainState.steem[acc][r];
      const h = chainState.hive[acc] && chainState.hive[acc][r];
      const inCorpusS = s && hits.some((x) => x.account === acc && x.chain === 'steem' && x.role === r);
      const inCorpusH = h && hits.some((x) => x.account === acc && x.chain === 'hive' && x.role === r);
      return r[0].toUpperCase() + (inCorpusS ? 'S✓' : 's✗') + (inCorpusH ? 'H✓' : 'h✗');
    }).join(' ');
    console.log('  ' + acc.padEnd(12) + line);
  }
  console.log('legend: O/A/P/M · S=held-on-steem H=held-on-hive');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
