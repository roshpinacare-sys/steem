#!/usr/bin/env node
/**
 * 117p8-R4 — master_blast: בדיקת-מאסטר מהירה (קריפטו-טהורה) של כל-המועמדים מעצי-החילוץ
 * מול 92-הפומביות-החיות. נוסחה: sha256(normalized(account+role+password)) → scalar → pub.
 * הצלבה-עצמית: מאסטר-tov-הידוע חייב לגזור 4/4-פומביות-כספת.
 * הרצה: node agent/master_blast.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bs58 = require('bs58');
const secp = require('secp256k1');
const steem = require('steem');

const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const ACCOUNTS = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];
const ROLES = ['owner', 'active', 'posting', 'memo'];

const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const scalarPub = (privBuf) => {
  const k = BigInt('0x' + privBuf.toString('hex')) % N;
  if (k === 0n) return null;
  const pk = secp.publicKeyCreate(Buffer.from(k.toString(16).padStart(64, '0'), 'hex'), true);
  const cs = crypto.createHash('ripemd160').update(pk).digest().subarray(0, 4);
  return 'STM' + bs58.encode(Buffer.concat([pk, cs]));
};
const norm = (s) => s.trim().split(/[\t\n\v\f\r ]+/).join(' ');
const derivePub = (acct, role, pass) => scalarPub(sha256(Buffer.from(norm(acct + role + pass), 'utf8')));

function getAccounts(url, names) {
  steem.api.setOptions({ url });
  return new Promise((res, rej) => steem.api.getAccounts(names, (e, r) => (e ? rej(e) : res(r))));
}

(async () => {
  // מטרות-חיות
  const targets = new Map();
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
  console.log('live targets=' + targets.size);

  // הצלבה-עצמית: מאסטר-tov (קלט-0600 מ-/tmp/hunt/tovmaster — נכתב-חד-פעמי) → 4/4 פומביות-כספת
  const vault = JSON.parse(fs.readFileSync('agent/keys/vault.json', 'utf8'));
  const tovVault = vault.accounts.find((x) => x.username === 'tov');
  let selfOk = 0, selfTot = 0;
  try {
    const MASTER = fs.readFileSync('/tmp/hunt/tovmaster', 'utf8').trim();
    for (const r of ROLES) {
      selfTot++;
      const want = tovVault.keys[r] && tovVault.keys[r].pub;
      const got = derivePub('tov', r, MASTER);
      if (want && got === want) selfOk++;
    }
  } catch (_) { console.log('self-test skip (no master file)'); }
  console.log('SELF-TEST tov-master derive: ' + selfOk + '/' + selfTot);
  if (selfTot && selfOk < selfTot) { console.log('FATAL: derive scheme mismatch — aborting'); process.exit(2); }

  // איסוף-מועמדים מעצי-החילוץ
  const CAND_FILE_RE = /(env|key|vault|secret|master|seed|mnemonic|backup|recovery|token|pass|wallet|auth)/i;
  const CAND_TOK_RE = /[A-Za-z0-9+/=_\-]{16,100}/g;
  const cands = new Set();
  const roots = ['/tmp/hunt/x0', '/tmp/hunt/x1', '/tmp/hunt/x2', '/tmp/hunt/x3'];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      let st; try { st = fs.statSync(p); } catch (_) { continue; }
      if (st.size > 2 * 1024 * 1024) continue;
      let s; try { s = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
      if (CAND_FILE_RE.test(e.name)) {
        for (const m of s.match(CAND_TOK_RE) || []) {
          if (!m.startsWith('STM') && !/^(http|sha256-[A-Za-z0-9+/]{20,})/.test(m) && !/^[0-9a-f]{40,}$/.test(m)) cands.add(m);
          if (cands.size >= 20000) return;
        }
      }
    }
  };
  roots.forEach((r) => walk(r, 0));
  // מועמד-נוסף: כל-שורות-ה-.env ששוחזר (ערכים)
  try {
    for (const l of fs.readFileSync('agent/.env', 'utf8').split('\n')) {
      const m = l.match(/^([A-Z_0-9]+)=(.+)$/);
      if (m && m[2].length >= 8) cands.add(m[2]);
    }
  } catch (_) {}
  console.log('candidates=' + cands.size);

  // בליצה: מועמד × חשבון × תפקיד
  const hits = [];
  let tested = 0;
  const t0 = Date.now();
  for (const cand of cands) {
    for (const acct of ACCOUNTS) {
      for (const role of ROLES) {
        tested++;
        const pub = derivePub(acct, role, cand);
        const t = pub && targets.get(pub);
        if (t) {
          hits.push({ account: acct, chain: t.chain, role: t.role, candLen: cand.length, candPrefix: cand.slice(0, 8) + '…', via: 'master-derive' });
          const hf = '/tmp/hunt/hits/' + acct + '.' + t.chain + '.' + t.role + '.frommaster';
          if (!fs.existsSync(hf)) fs.writeFileSync(hf, cand + '\n', { mode: 0o600 });
          console.log('*** MASTER-HIT ' + acct + ' · ' + t.chain + ' · ' + t.role + ' · cand=' + cand.slice(0, 8) + '…(len=' + cand.length + ')');
        }
      }
    }
  }
  console.log('tested=' + tested + ' in ' + Math.round((Date.now() - t0) / 1000) + 's · MASTER-HITS=' + hits.length);
  fs.writeFileSync('agent/master_blast_report.json', JSON.stringify({ at: new Date().toISOString(), candidates: cands.size, tested, hits }, null, 2));
  console.log('report → agent/master_blast_report.json (masked)');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
