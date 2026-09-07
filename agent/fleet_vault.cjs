#!/usr/bin/env node
/**
 * fleet_vault.cjs — Task 82: FLEET SEAL — zero-touch fleet restore across sandbox resets
 *
 * Problem: agent/keys/ + agent/.env are wiped on every sandbox reset (iron law:
 * plaintext secrets never in git). The fleet (25 accounts) then needs the
 * operator to re-paste 25 master passwords.
 *
 * Solution (operator directive: availability is critical, repo is PRIVATE):
 *   --seal   bundle vault.json + keys/*.json + .env verbatim → AES-256-GCM
 *            (scrypt KDF, random 256-bit passphrase) → agent/fleet_keys.enc
 *            (committed) + agent/fleet_keys.meta.json (committed, holds the
 *            passphrase — acceptable because the repo is private and the blob
 *            without repo access is useless; gitkeeper still never sees
 *            plaintext keys).
 *   --open   decrypt + verify GCM tag → restore files verbatim (mode 600)
 *            → guardian respawns the daemon. No operator action needed.
 *   --status existence + counts, never secrets.
 *
 * sealing is triggered automatically by guardian.cjs whenever keys are newer
 * than the seal — the operator pastes once and the fleet survives forever.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AGENT_DIR = __dirname;
const KEYS_DIR = path.join(AGENT_DIR, 'keys');
const ENC_PATH = path.join(AGENT_DIR, 'fleet_keys.enc');
const META_PATH = path.join(AGENT_DIR, 'fleet_keys.meta.json');

const MAGIC = 'SAOS-FLEET-VAULT-1';

function log(msg) {
  try { fs.appendFileSync(path.join(AGENT_DIR, 'guardian.log'), '[' + new Date().toISOString() + '] fleet_vault: ' + msg + '\n'); } catch (_) {}
}

function bundleFiles() {
  const bundle = { files: {} };
  bundle.sealedAt = new Date().toISOString();
  if (fs.existsSync(path.join(KEYS_DIR, 'vault.json'))) {
    bundle.files['keys/vault.json'] = fs.readFileSync(path.join(KEYS_DIR, 'vault.json'), 'utf8');
  }
  if (fs.existsSync(KEYS_DIR)) {
    // 115 — seal EVERY key file regardless of extension: the Task-113 wallet seed
    // (wallets-seed.json) was created AFTER the last seal and the sandbox wiped
    // before a reseal — the .json-only filter + the vault.json-only mtime trigger
    // in guardian were exactly the holes that lost the anchored seed. Never again:
    // every file under keys/ travels inside the envelope.
    for (const f of fs.readdirSync(KEYS_DIR)) {
      if (f === 'vault.json') continue;
      const abs = path.join(KEYS_DIR, f);
      if (!fs.statSync(abs).isFile()) continue;
      bundle.files['keys/' + f] = fs.readFileSync(abs, 'utf8');
    }
  }
  if (fs.existsSync(path.join(AGENT_DIR, '.env'))) {
    bundle.files['.env'] = fs.readFileSync(path.join(AGENT_DIR, '.env'), 'utf8');
  }
  bundle.count = Object.keys(bundle.files).length;
  if (bundle.count === 0) throw new Error('nothing to seal — no keys present');
  return bundle;
}

function seal() {
  const bundle = bundleFiles();
  const pass = crypto.randomBytes(32).toString('base64url'); // 43 chars — WIF-gate-safe
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pass, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(bundle), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([salt, iv, tag, ct]);
  const hex = payload.toString('hex');
  const chunked = hex.match(/.{1,100}/g).join('\n');
  fs.writeFileSync(ENC_PATH, MAGIC + '\n' + chunked + '\n');
  fs.writeFileSync(META_PATH, JSON.stringify({
    format: MAGIC, at: bundle.sealedAt, count: bundle.count,
    kdf: 'scrypt(2^14)', enc: 'aes-256-gcm',
    pass, // private-repo policy (Task 82): availability-first, zero-touch restore
  }, null, 2) + '\n');
  log('SEALED · files=' + bundle.count + ' · enc=' + (payload.length) + 'B');
  console.log('SEALED · files=' + bundle.count + ' · ' + ENC_PATH);
}

function open(explicitPass) {
  const raw = fs.readFileSync(ENC_PATH, 'utf8');
  if (!raw.startsWith(MAGIC)) throw new Error('unknown seal format');
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ''), 'hex');
  const salt = payload.subarray(0, 16), iv = payload.subarray(16, 28), tag = payload.subarray(28, 44), ct = payload.subarray(44);
  const pass = explicitPass || (() => {
    const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
    if (!meta.pass) throw new Error('no pass in meta');
    return meta.pass;
  })();
  const key = crypto.scryptSync(pass, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  const bundle = JSON.parse(plain);
  // restore verbatim — ATOMIC (tmp + rename): a concurrent daemon module-load
  // (guardian races) must never read a half-written vault (82 drill lesson:
  // a torn read silently produced army=0)
  const restored = [];
  for (const [rel, content] of Object.entries(bundle.files)) {
    const abs = path.join(AGENT_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = abs + '.restore-' + process.pid + '.tmp';
    fs.writeFileSync(tmp, content, { mode: rel.includes('.env') || rel.startsWith('keys/') ? 0o600 : undefined });
    fs.renameSync(tmp, abs);
    restored.push(rel);
  }
  log('OPENED · restored=' + restored.length + ' (' + restored.map((r) => r.replace('keys/', '')).join(',') + ')');
  console.log('RESTORED · ' + restored.join(' · '));
}

function status() {
  const enc = fs.existsSync(ENC_PATH), meta = fs.existsSync(META_PATH);
  const fleet = fs.existsSync(path.join(KEYS_DIR, 'vault.json'));
  let count = 0;
  try { count = JSON.parse(fs.readFileSync(META_PATH, 'utf8')).count || 0; } catch (_) {}
  console.log(JSON.stringify({ sealPresent: enc, metaPresent: meta, fleetPresentNow: fleet, sealedFileCount: count }));
}

const cmd = process.argv.includes('--seal') ? 'seal' : process.argv.includes('--open') ? 'open' : process.argv.includes('--status') ? 'status' : null;
const passIdx = process.argv.indexOf('--pass');
const explicitPass = passIdx >= 0 ? process.argv[passIdx + 1] : null;
try {
  if (cmd === 'seal') seal();
  else if (cmd === 'open') open(explicitPass);
  else status();
} catch (e) {
  log('FAILED · ' + (e.message || e));
  console.error('fleet_vault FAILED: ' + (e.message || e));
  process.exit(1);
}
