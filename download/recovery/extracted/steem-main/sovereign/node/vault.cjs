#!/usr/bin/env node
/* vault.cjs — 114 THE-VAULT CLI: seal | verify | status | restore.
 *
 * הטקס-החזק: verify פותח-את-המעטפת, מגזר-מחדש 12 סוכנים × 4 משפחות (EVM/TRON/SOL/BTC)
 * מהזרע-המוצפן — באותם-נתיבים-בדיוק-כמו-wallets.cjs — ומשווה-מול-wallets-public.json
 * (הזהות-המעוגנת-על-STEEM, txid a0438978…). "הכספת-נפתחת-לזהות-המעוגנת".
 *
 * שימוש:
 *   node vault.cjs seal                 # איטום ראשוני / איטום-חוזר (אותו-מפתח-אב)
 *   node vault.cjs verify [--quiet]     # הטקס-המלא (digests + גזירה-מחדש + דיפ-מול-העיגון)
 *   node vault.cjs status               # ציבורי בלבד — אפס-סודות
 *   node vault.cjs restore [member]     # שחזור קבצי-טקסט מהמעטפת (רפואה) */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const V = require('./vault-lib.cjs');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const PUB = path.join(HERE, 'wallets-public.json');
const VERIFY_LAST = V.VERIFY_LAST;

/* ── גזירה-מחדש (העתק-נאמן של-מסלול-wallets.cjs — אותם-נתיבים, אותם-חוקים) ── */
function sha256buf(s) { return crypto.createHash('sha256').update(s).digest(); }
const B32CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) { const b = chk >> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i]; }
  return chk;
}
function bech32HrpExpand(hrp) { const r = []; for (const c of hrp) r.push(c.charCodeAt(0) >> 5); r.push(0); for (const c of hrp) r.push(c.charCodeAt(0) & 31); return r; }
function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0; const out = []; const maxv = (1 << to) - 1;
  for (const v of data) { if (v < 0 || (v >> from) !== 0) return null; acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); } }
  if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); }
  else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}
function btcP2wpkh(pubKey, hrp) {
  const h160 = crypto.createHash('ripemd160').update(sha256buf(Buffer.from(pubKey))).digest();
  const prog = convertBits(Array.from(h160), 8, 5, true);
  const data = bech32HrpExpand(hrp).concat([0]).concat(prog);
  const mod = bech32Polymod(data.concat([0, 0, 0, 0, 0, 0])) ^ 1;
  const chk = []; for (let i = 0; i < 6; i++) chk.push((mod >> 5 * (5 - i)) & 31);
  return hrp + '1' + [0].concat(prog, chk).map((d) => B32CHARS[d]).join('');
}
function b58check(payload) {
  const bs58 = require(path.join(ROOT, 'node_modules', 'bs58'));
  const p = Buffer.from(payload);
  const h1 = crypto.createHash('sha256').update(p).digest();
  const h2 = crypto.createHash('sha256').update(h1).digest();
  return bs58.encode(Buffer.concat([p, h2.slice(0, 4)]));
}

/* רוסטר-הסוכנים — מהכספת-עצמה (vault.json = הרוסטר-הקנוני), לא-מהדיסק */
function agentsFromVault(vault) {
  const names = new Set(['headcorner']);
  try { for (const a of (vault.accounts || [])) if (a && a.username) names.add(String(a.username).toLowerCase()); } catch (_) {}
  return Array.from(names).sort();
}

function rederive(seed, rosterNames) {
  const ethers = require(path.join(ROOT, 'node_modules', 'ethers'));
  const bs58 = require(path.join(ROOT, 'node_modules', 'bs58'));
  const { ed25519 } = require(path.join(ROOT, 'node_modules', '@noble', 'curves', 'ed25519.js'));
  const evmRoot = ethers.HDNodeWallet.fromSeed(sha256buf(seed + '|evm|44/60'));
  const tronRoot = ethers.HDNodeWallet.fromSeed(sha256buf(seed + '|tron|44/195'));
  const btcRoot = ethers.HDNodeWallet.fromSeed(sha256buf(seed + '|btc|84/0'));
  const out = {};
  rosterNames.forEach((name, i) => {
    const evmW = evmRoot.derivePath("m/44'/60'/0'/0/" + i);
    const tronW = tronRoot.derivePath("m/44'/195'/0'/0/" + i);
    const btcW = btcRoot.derivePath("m/84'/0'/0'/0/" + i);
    const solPriv = sha256buf(seed + '|sol|' + name);
    const solPub = ed25519.getPublicKey(solPriv);
    const tronPubU = ethers.SigningKey.computePublicKey(tronW.privateKey, false).slice(4);
    const kec = ethers.keccak256(Buffer.from(tronPubU, 'hex'));
    const tronAddr = b58check(Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), 'hex')]));
    out[name] = { evm: evmW.address, tron: tronAddr, sol: bs58.encode(solPub), btc: btcP2wpkh(Buffer.from(btcW.publicKey.slice(2), 'hex'), 'bc') };
  });
  return out;
}

/* ── הטקס-המלא ── */
function verify({ quiet } = {}) {
  const t0 = Date.now();
  const res = { at: new Date().toISOString(), ok: false, checks: {}, errors: [] };
  try {
    const v = V.openVault({ allowPlaintext: false }); // הטקס-מאמת-את-המעטפת-עצמה
    res.mode = 'envelope';
    res.envelopeDigest = v.digest;
    res.sealedAt = v.sealedAt;
    const seedDoc = v.get('wallets-seed.json');
    const registry = v.get('wallets-registry.json');
    const steemVault = v.get('vault.json');
    res.checks.seedShape = /^[0-9a-f]{64,}$/.test(String(seedDoc.seed || ''));
    res.checks.registryAccounts = Array.isArray(registry.accounts) && registry.accounts.length > 0;
    res.checks.steemAccounts = Array.isArray(steemVault.accounts) && steemVault.accounts.length > 0;
    const roster = agentsFromVault(steemVault);
    const derived = rederive(String(seedDoc.seed), roster);
    // דיפ מול-הרישום-הפרטי-האטום (אותו-זרע → אותן-כתובות)
    let regMatch = 0, regMiss = [];
    for (const a of registry.accounts) {
      const d = derived[a.agent];
      if (d && a.evm && a.tron && a.sol && d.evm === a.evm.address && d.tron === a.tron.address && d.sol === a.sol.address) regMatch++;
      else regMiss.push(a.agent);
    }
    res.checks.registryMatch = regMatch + '/' + registry.accounts.length;
    // דיפ מול-העיגון-הציבורי — "הכספת-נפתחת-לזהות-המעוגנת"
    let pubMatch = 0, pubMiss = [], anchored = false, pub = null;
    try {
      pub = JSON.parse(fs.readFileSync(PUB, 'utf8'));
      anchored = !!(pub.manifestDigest && pub.anchor && pub.anchor.txid);
      res.anchoredDigest = pub.manifestDigest || null;
      res.anchoredTxid = (pub.anchor && pub.anchor.txid) || null;
      for (const a of pub.agents || []) {
        const d = derived[a.agent];
        if (d && d.evm === a.evm && d.tron === a.tron && d.sol === a.sol && d.btc === a.btc) pubMatch++;
        else pubMiss.push(a.agent);
      }
    } catch (e) { pubMiss.push('public-file:' + e.message.slice(0, 40)); }
    res.checks.anchoredMatch = (pub && pub.agents ? pubMatch + '/' + pub.agents.length : 'no-public');
    res.checks.anchoredPublic = anchored;
    res.ok = res.checks.seedShape && res.checks.registryAccounts && res.checks.steemAccounts && regMiss.length === 0 && pubMiss.length === 0 && pubMatch > 0;
    if (!res.ok) res.errors.push('mismatch registry:[' + regMiss.join(',') + '] public:[' + pubMiss.join(',') + ']');
  } catch (e) {
    res.ok = false;
    res.errors.push(e.message);
  }
  res.ms = Date.now() - t0;
  fs.writeFileSync(VERIFY_LAST, JSON.stringify(res, null, 2));
  if (!quiet) {
    console.log('THE-VAULT verify: ' + (res.ok ? 'VERIFIED ✓' : 'FAILED ✗') + ' (' + res.ms + 'ms)');
    console.log('  envelope ' + (res.envelopeDigest || '—').slice(0, 16) + '… · sealed ' + (res.sealedAt || '—'));
    console.log('  checks: ' + JSON.stringify(res.checks));
    if (res.ok) console.log('  הכספת-נפתחת-לזהות-המעוגנת — 12×4 כתובות-נגזרות-מחדש-ומתאימות-לעיגון-הציבורי');
    if (res.errors.length) console.log('  errors: ' + res.errors.join(' · '));
  }
  return res;
}

function main() {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'seal') {
    const r = V.seal();
    console.log('THE-VAULT sealed ✓ · digest ' + r.digest.slice(0, 16) + '… · ' + Object.keys(r.members).length + ' members · ' + r.sealedAt);
    for (const [n, m] of Object.entries(r.members)) console.log('  · ' + n + ' (' + m.bytes + 'B, ' + m.kind + ')');
    const v = verify({ quiet: true });
    console.log('post-seal verify: ' + (v.ok ? 'VERIFIED ✓' : 'FAILED ✗ — דורש-תיקון-מיידי'));
    if (!v.ok) process.exitCode = 1;
  } else if (cmd === 'verify') {
    const ok = verify({ quiet: process.argv.includes('--quiet') });
    if (!ok.ok) process.exitCode = 1;
  } else if (cmd === 'restore') {
    const r = V.restore(process.argv[3] || null);
    console.log('THE-VAULT restore ✓ · ' + r.restored.join(' · '));
  } else if (cmd === 'status') {
    const s = V.status();
    console.log(JSON.stringify({ sealed: s.sealed, digest: s.digest, sealedAt: s.sealedAt, masterOk: s.masterOk, members: Object.keys(s.members || {}), verifyLast: s.verifyLast && { at: s.verifyLast.at, ok: s.verifyLast.ok } }, null, 2));
  } else {
    console.log('usage: vault.cjs seal|verify|status|restore [member]');
    process.exitCode = 2;
  }
}
main();
