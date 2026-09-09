#!/usr/bin/env node
/* crack_tov.cjs — 117p8: mine git history (download/recovery tree) for key material
 * that matches @tov's LIVE on-chain authorities. Everything in-memory; output masked.
 * Usage: node agent/crack_tov.cjs
 */
'use strict';
const { execSync } = require('child_process');
const crypto = require('crypto');
const bs58 = require('bs58');

const COMMIT = process.argv[2] || '263c34e^';
const PREFIX = 'download/recovery';

// tov live pubkeys (from chain, 2026-09-09)
const TOV_LIVE = [
  'STM6GxKCvaHX19RE7x3wQ2nt9SWtDzhBH1TYrxghr3zoYUFHCDb7H', // steem owner
  'STM7q6Udi4hSJf29mhUo89rcSuFnPw3GnhTX8LmhG2mcj67iRpHkw', // steem active
  'STM8QuHf4puU67RAKAbZsRJqsmi7hYGWKe9b81JdvSZgGNZiJqxq5', // steem posting
  'STM5M2vUyDTjuf3ofkQNzdxjm3UhJ3G2oscoXb8AXvKmK6mf4GUHf', // steem memo
  'STM72T4defMbBARJd7Hybg52tiAzc6WTgHsxFM2SF2uX4FVKwQtsw', // hive owner
  'STM4wCC3Qq2HxE9DLrny5rAHrcMM8NvEV3mCjEHU8v6WSkDvQWnhf', // hive active
  'STM6Mg3tZFzc5s1czV84G3HVdhQabtv8h28n1kgVkd8D4ywECD2HM', // hive posting
  'STM62qAypDH6zDAZqRENhAfxpuN7j5B1YT2nh1Th5g784awFYH9c5', // hive memo
];

function wifValid(w) {
  try {
    const raw = bs58.decode(w);
    if (raw.length !== 37) return false;
    const payload = raw.subarray(0, 33);
    const checksum = raw.subarray(33);
    const h = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest();
    if (!h.subarray(0, 4).equals(checksum)) return false;
    if (payload[0] !== 0x80) return false;
    return payload;
  } catch (e) {
    return false;
  }
}

function wifToPub(w) {
  const payload = wifValid(w);
  if (!payload) return null;
  // steem/hive use compressed secp256k1 pubkeys
  const secp = require('secp256k1');
  const priv = payload.subarray(1);
  try {
    const pk = secp.publicKeyCreate(priv, true);
    const checksum = crypto.createHash('sha256').update(crypto.createHash('sha256').update(pk).digest()).digest().subarray(0, 4);
    const full = Buffer.concat([pk, checksum]);
    return 'STM' + bs58.encode(full);
  } catch (e) {
    return null;
  }
}

function maskWif(w) { return w.slice(0, 4) + '…' + w.slice(-2); }

// 1. list files
const files = execSync(`git ls-tree -r "${COMMIT}" --name-only`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter((f) => f.startsWith(PREFIX));
console.log('scanning ' + files.length + ' blobs under ' + PREFIX + ' @ ' + COMMIT);

// 2. scan every blob for WIF candidates + FACTORY_MASTER
const WIF_RE = /[5JKL9][1-9A-HJ-NP-Za-km-z]{50,51}/g;
const found = new Map(); // wif -> [files]
const fmFound = []; // FACTORY_MASTER lines (file -> value kept in-memory only)
const candSecrets = new Set();
let scanned = 0;
const FM_RE = /FACTORY_MASTER[=:]\s*["']?([^\s"']+)["']?/g;
const CAND_SEED_RE = /(?:seed|master|pass|password|root|sov)["']?\s*[:=]\s*["']([A-Za-z0-9]{16,})["']/gi;

for (const f of files) {
  let buf;
  try {
    buf = execSync(`git cat-file blob "${COMMIT}:${f}"`, { maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { continue; }
  scanned++;
  const s = buf.toString('latin1');
  const matches = s.match(WIF_RE) || [];
  for (const m of matches) {
    if (wifValid(m)) {
      if (!found.has(m)) found.set(m, []);
      if (found.get(m).length < 5) found.get(m).push(f);
    }
  }
  let fm;
  while ((fm = FM_RE.exec(s)) !== null) {
    fmFound.push({ file: f, value: fm[1] });
  }
  // seed-like candidates for derivation tests
  let cm;
  while ((cm = CAND_SEED_RE.exec(s)) !== null) {
    if (cm[1].length >= 16) candSecrets.add(cm[1]);
  }
}
console.log('scanned=' + scanned + ' · valid-WIFs=' + found.size + ' · FACTORY_MASTER-lines=' + fmFound.length);

// 3. derive pubkeys and match
const hits = [];
let d = 0;
for (const [wif, srcs] of found) {
  d++;
  const pub = wifToPub(wif);
  if (!pub) continue;
  const idx = TOV_LIVE.indexOf(pub);
  if (idx >= 0) {
    hits.push({ roleIdx: idx, wifMasked: maskWif(wif), pub: pub.slice(0, 12) + '…', srcs });
  }
}
console.log('derived=' + d);
if (hits.length) {
  const roleNames = ['steem-owner', 'steem-active', 'steem-posting', 'steem-memo', 'hive-owner', 'hive-active', 'hive-posting', 'hive-memo'];
  console.log('*** MATCHES FOR @tov ***');
  for (const h of hits) console.log('  ' + roleNames[h.roleIdx] + ' · wif=' + h.wifMasked + ' · pub=' + h.pub + ' · in=' + h.srcs.join(', '));
} else {
  console.log('no direct WIF match for @tov in this tree');
}

// 4. FACTORY_MASTER candidates → derive tov + test
if (fmFound.length) {
  const steem = require('steem');
  const roles = ['owner', 'active', 'posting', 'memo'];
  const uniq = [...new Set(fmFound.map((x) => x.value))];
  console.log('testing ' + uniq.length + ' FACTORY_MASTER candidates (masked: len only)');
  for (const [i, fm] of uniq.entries()) {
    try {
      const w = steem.auth.getPrivateKeys('tov', fm, roles);
      let ok = 0;
      const pubs = {};
      for (const r of roles) { pubs[r] = steem.auth.wifToPublic(w[r]); if (TOV_LIVE.includes(pubs[r])) ok++; }
      console.log('  FM#' + i + ' len=' + fm.length + ' from=' + fmFound.find((x) => x.value === fm).file + ' → tov matches=' + ok + '/8' + (ok ? ' pubs=' + roles.map((r) => pubs[r].slice(0, 10) + '…').join(' ') : ''));
    } catch (e) { console.log('  FM#' + i + ' derive fail: ' + e.message.slice(0, 50)); }
  }
}

// 5. write hits (masked) to report for the next stage
const fs = require('fs');
fs.writeFileSync('agent/crack_tov_report.json', JSON.stringify({
  at: new Date().toISOString(), commit: COMMIT, scanned, wifs: found.size,
  matches: hits.map((h) => ({ role: roleNames[h.roleIdx], wif: h.wifMasked, pub: h.pub, src: h.srcs[0] })),
  fmCandidates: fmFound.map((x) => ({ file: x.file, len: x.value.length })),
}, null, 2));
console.log('report → agent/crack_tov_report.json (masked)');
