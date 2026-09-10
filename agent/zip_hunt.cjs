#!/usr/bin/env node
/**
 * 117p8-R4 — zip_hunt: פתיחת-כל-הארכיונים מעץ-ההיסטוריה (263c34e^) + דיסק,
 * כולל ארכיונים-מקוננים (עומק ≤3), סריקת-WIF-קנונית + מועמדי-מאסטר,
 * מול 92-הפומביות-החיות (12 חשבונות × שתי-שרשראות × 4 תפקידים) + פומביות-הכספת.
 * אף-סוד-לא-נדפס. פגיעות → /tmp/hunt/hits (0600) + דוח-מאובטח.
 * הרצה: node agent/zip_hunt.cjs [--stage1|--stage2|--all]
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bs58 = require('bs58');
const steem = require('steem');

const COMMIT = '263c34e^';
const ROOT = '/tmp/hunt';
const SRC = path.join(ROOT, 'src');
const HITS = path.join(ROOT, 'hits');
const MAXDEPTH = 3;
const MAXFILE = 16 * 1024 * 1024;
const STAGE = process.argv[2] || '--all';

const STAGE1 = [ // המבטיחים-ביותר
  'download/task26-pre-restore-backup.tar.gz',
  'download/recovery/steem-main.zip',
  'download/KEYS-BACKUP-2026-09-09.tar.enc',
  'sovereign/node/chain-archive-seal.jsonl.gz',
];
const STAGE2 = [ // זיפי-המחקר
  'download/research/zips/unified-platform-v33.56-custody-authority-persistence_2.zip',
  'download/research/zips/ecos_v568_canonical.zip',
  'download/research/zips/srs_sovereign_runtime_substrate_v8.2.0_2.zip',
  'download/research/zips/TITAI_v18_VERIFIED_INSTALLER_WITH_ARCHITECTURE_3.zip',
  'download/research/zips/tfa-evolution-studio-validated_2.zip',
  'download/research/zips/workspace-v0.0.1_2.zip',
  'download/research/zips/qodo-v24.30.49-pass76-quota-gauge_2.zip',
  'download/research/zips/zip-to-pdf-polyglot-9.1.0_3.zip',
  'download/research/zips/V33_30_controlled_human_ux_pilot_instrumentation_patch_2.zip',
  'download/research/extracted/tfa-evolution-studio-validated_2/tasks/tfa-evolution-studio-v32.0.0-repaired.zip',
];

for (const d of [ROOT, SRC, HITS]) fs.mkdirSync(d, { recursive: true });
fs.chmodSync(HITS, 0o700);

// ── ולידציית WIF (37/38 בייט · גרסה 0x80 · צ'קסאם) ──
function wifValid(w) {
  try {
    const raw = bs58.decode(w);
    if (raw.length !== 37 && raw.length !== 38) return false;
    const body = raw.subarray(0, raw.length - 4);
    const cs = raw.subarray(raw.length - 4);
    const h = crypto.createHash('sha256').update(crypto.createHash('sha256').update(body).digest()).digest();
    if (!h.subarray(0, 4).equals(cs)) return false;
    if (body[0] !== 0x80) return false;
    return true;
  } catch (_) { return false; }
}
const wifToPub = (w) => {
  try { return steem.auth.wifToPublic(w); } catch (_) {
    // graphene-semantics fallback: scalar = BigInteger(version-stripped bytes INCL. any 0x01 suffix) mod n
    try {
      const raw = bs58.decode(w);
      if (raw.length !== 37 && raw.length !== 38) return null;
      const body = raw.subarray(0, raw.length - 4);
      if (body[0] !== 0x80) return null;
      const keyBytes = body.subarray(1);
      if (keyBytes.length < 32 || keyBytes.length > 33) return null;
      const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
      let k = BigInt('0x' + keyBytes.toString('hex') || '0') % N;
      if (k === 0n) return null;
      const privBuf = Buffer.from(k.toString(16).padStart(64, '0'), 'hex');
      const secp = require('secp256k1');
      const pk = secp.publicKeyCreate(privBuf, true);
      const cs = crypto.createHash('ripemd160').update(pk).digest().subarray(0, 4);
      return 'STM' + bs58.encode(Buffer.concat([pk, cs]));
    } catch (_) { return null; }
  }
};
const mask = (w) => w.slice(0, 4) + '…' + w.slice(-2);
const WIF_RE = /[5JKL9][1-9A-HJ-NP-Za-km-z]{50,51}/g;
const CAND_FILE_RE = /(env|key|vault|secret|master|seed|mnemonic|backup|recovery|token|pass|wallet|auth|פתח|מפתח)/i;
const CAND_TOK_RE = /[A-Za-z0-9+\/=_\-]{20,80}/g;

// ── מטרות-חיות ──
function getAccounts(url, names) {
  steem.api.setOptions({ url });
  return new Promise((res, rej) => steem.api.getAccounts(names, (e, r) => (e ? rej(e) : res(r))));
}
const ACCOUNTS = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];
const ROLES = ['owner', 'active', 'posting', 'memo'];

(async () => {
  const targets = new Map(); // pub -> {account, chain, role}
  for (const [chain, url] of [['steem', 'https://api.steemit.com'], ['hive', 'https://api.hive.blog']]) {
    const rows = await getAccounts(url, ACCOUNTS);
    for (const row of rows) {
      for (const r of ['owner', 'active', 'posting']) {
        const p = row[r] && row[r].key_auths && row[r].key_auths[0] && row[r].key_auths[0][0];
        if (p) targets.set(p, { account: row.name, chain, role: r });
      }
      if (row.memo_key) targets.set(row.memo_key, { account: row.name, chain, role: 'memo' });
    }
  }
  // גם פומביות-הכספת (לזיהוי-חומר-מוכר)
  const vaultPubs = new Set();
  try {
    const v = JSON.parse(fs.readFileSync('agent/keys/vault.json', 'utf8'));
    for (const a of v.accounts) for (const k of Object.values(a.keys || {})) {
      const pub = k && (k.pub || k.public || (typeof k === 'string' && k.startsWith('STM') ? k : null));
      if (pub) vaultPubs.add(pub);
    }
  } catch (_) {}
  console.log('live targets=' + targets.size + ' · vault pubs=' + vaultPubs.size);

  const stats = { archives: 0, extractedFiles: 0, wifs: new Set(), candidates: new Set(), hits: [] };

  // ── סריקת-עץ-חילוץ ──
  function scanTree(dir, depth, tag) {
    if (depth > 8) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { scanTree(p, depth + 1, tag); continue; }
      if (!e.isFile()) continue;
      let st; try { st = fs.statSync(p); } catch (_) { continue; }
      // ארכיון-מקונן?
      if (depth < MAXDEPTH && /\.(zip|tar\.gz|tgz|tar|bz2|xz)$/i.test(e.name) && st.size < 80 * 1024 * 1024) {
        const nd = p + '.x';
        try {
          fs.mkdirSync(nd, { recursive: true });
          if (/\.zip$/i.test(e.name)) execSync(`unzip -q -o -P '' ${JSON.stringify(p)} -d ${JSON.stringify(nd)} || unzip -q -o ${JSON.stringify(p)} -d ${JSON.stringify(nd)}`, { timeout: 120000, stdio: 'pipe' });
          else if (/\.(tar\.gz|tgz)$/i.test(e.name)) execSync(`tar -xzf ${JSON.stringify(p)} -C ${JSON.stringify(nd)}`, { timeout: 120000, stdio: 'pipe' });
          else if (/\.(tar|bz2|xz)$/i.test(e.name)) execSync(`tar -xf ${JSON.stringify(p)} -C ${JSON.stringify(nd)}`, { timeout: 120000, stdio: 'pipe' });
          console.log('  [nested] ' + e.name.slice(0, 60));
          stats.archives++;
          scanTree(nd, depth + 1, tag + '>' + e.name.slice(0, 30));
        } catch (_) {}
        continue;
      }
      // .enc → ניסיון-פתיחה עם סיסמת-המפעיל
      if (depth < MAXDEPTH && /\.enc$/i.test(e.name) && st.size < 5 * 1024 * 1024) {
        const out = p + '.dec';
        try {
          const pass = fs.readFileSync('/home/z/.bkpass', 'utf8').trim();
          execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -in ${JSON.stringify(p)} -out ${JSON.stringify(out)} -pass env:BKP`, { timeout: 60000, stdio: 'pipe', env: { ...process.env, BKP: pass } });
          console.log('  [enc-opened] ' + e.name.slice(0, 60));
          scanTree(path.dirname(out), depth + 1, tag + '>enc');
        } catch (_) {}
        continue;
      }
      if (st.size > MAXFILE) continue;
      let s; try { s = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
      stats.extractedFiles++;
      for (const m of s.match(WIF_RE) || []) {
        if (wifValid(m)) {
          stats.wifs.add(m);
          const pub = wifToPub(m);
          const t = pub && targets.get(pub);
          if (t) {
            const hit = { ...t, wif: mask(m), src: tag + '::' + path.relative(ROOT, p).slice(0, 90), at: new Date().toISOString() };
            stats.hits.push(hit);
            const hf = path.join(HITS, `${t.account}.${t.chain}.${t.role}.key`);
            if (!fs.existsSync(hf)) fs.writeFileSync(hf, m + '\n', { mode: 0o600 });
            console.log('  *** HIT ' + t.account + ' · ' + t.chain + ' · ' + t.role + ' · wif=' + hit.wif + ' · src=' + hit.src);
          }
        }
      }
      // מועמדי-מאסטר רק מקבצים-רלוונטיים
      if (CAND_FILE_RE.test(e.name) && stats.candidates.size < 4000) {
        for (const m of s.match(CAND_TOK_RE) || []) {
          if (!m.startsWith('STM') && !/^(http|sha256|[0-9a-f]{40,})/i.test(m)) stats.candidates.add(m);
        }
      }
    }
  }

  // ── חילוץ-ארכיון-עליון ──
  function extractTop(gitPath, idx) {
    const dest = path.join(ROOT, 'x' + idx);
    fs.mkdirSync(dest, { recursive: true });
    const local = path.join(SRC, path.basename(gitPath));
    try {
      execSync(`git cat-file blob "${COMMIT}:${gitPath}" > ${JSON.stringify(local)}`, { shell: '/bin/bash', maxBuffer: 128 * 1024 * 1024, timeout: 180000 });
    } catch (e) { console.log('  [skip-cat] ' + gitPath); return; }
    const name = path.basename(gitPath);
    try {
      if (/\.tar\.gz$/.test(name)) execSync(`tar -xzf ${JSON.stringify(local)} -C ${JSON.stringify(dest)}`, { timeout: 300000, stdio: 'pipe' });
      else if (/\.zip$/.test(name)) execSync(`unzip -q -o ${JSON.stringify(local)} -d ${JSON.stringify(dest)}`, { timeout: 300000, stdio: 'pipe' });
      else if (/\.tar\.enc$/.test(name)) {
        const pass = fs.readFileSync('/home/z/.bkpass', 'utf8').trim();
        const dec = local.replace(/\.enc$/, '');
        execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -in ${JSON.stringify(local)} -out ${JSON.stringify(dec)} -pass env:BKP`, { timeout: 120000, stdio: 'pipe', env: { ...process.env, BKP: pass } });
        execSync(`tar -xzf ${JSON.stringify(dec)} -C ${JSON.stringify(dest)}`, { timeout: 120000, stdio: 'pipe' });
      } else if (/\.gz$/.test(name)) execSync(`tar -xzf ${JSON.stringify(local)} -C ${JSON.stringify(dest)}`, { timeout: 120000, stdio: 'pipe' });
      stats.archives++;
      console.log('[opened] ' + gitPath);
      scanTree(dest, 0, gitPath);
    } catch (e) { console.log('  [extract-fail] ' + name + ': ' + String(e.message).slice(0, 60)); }
  }

  const list = STAGE === '--stage1' ? STAGE1 : STAGE === '--stage2' ? STAGE2 : [...STAGE1, ...STAGE2];
  list.forEach((p, i) => extractTop(p, i));

  // ── מבחני-מאסטר (גזירה לפי-שם-חשבון) ──
  console.log('master-derive tests: candidates=' + stats.candidates.size);
  let mtests = 0;
  const masterHits = [];
  for (const cand of stats.candidates) {
    for (const acct of ACCOUNTS) {
      let w;
      try { w = steem.auth.getPrivateKeys(acct, cand, ROLES); } catch (_) { continue; }
      for (const r of ROLES) {
        mtests++;
        const pub = wifToPub(w[r]);
        const t = pub && targets.get(pub);
        if (t) {
          masterHits.push({ account: acct, chain: t.chain, role: t.role, candLen: cand.length, candPrefix: cand.slice(0, 6) + '…' });
          const hf = path.join(HITS, `${acct}.${t.chain}.${t.role}.frommaster`);
          if (!fs.existsSync(hf)) fs.writeFileSync(hf, cand + '\n', { mode: 0o600 });
          console.log('  *** MASTER-HIT ' + acct + ' · ' + t.chain + ' · ' + t.role + ' · cand=' + cand.slice(0, 6) + '…(len=' + cand.length + ')');
        }
      }
    }
  }

  // ── דוח (מאובטח) ──
  const report = {
    at: new Date().toISOString(), stage: STAGE, commit: COMMIT,
    archives: stats.archives, extractedFiles: stats.extractedFiles,
    validWifs: stats.wifs.size, masterTests: mtests, candidates: stats.candidates.size,
    directHits: stats.hits, masterHits,
  };
  fs.writeFileSync('agent/zip_hunt_report.json', JSON.stringify(report, null, 2));
  console.log('DONE archives=' + stats.archives + ' · files=' + stats.extractedFiles + ' · wifs=' + stats.wifs.size + ' · DIRECT-HITS=' + stats.hits.length + ' · MASTER-HITS=' + masterHits.length);
  console.log('report → agent/zip_hunt_report.json (masked) · raw hits → /tmp/hunt/hits (0600)');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
