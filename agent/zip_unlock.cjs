#!/usr/bin/env node
/**
 * 117p8-R11 — zip_unlock: פותח-מפתחות-מועמדים מתוך-הקבצים-שבידינו (המפעיל:
 * "זה אצלך בקבצים") ובודק כל-אחד מול KEYS-ZIP-2026-09-09.zip.enc.
 * אף-ערך-סוד לא נדפס — רק שמות-מועמדים ותוצאה. הצלחה → /tmp/keyszip (0600).
 * הרצה: node agent/zip_unlock.cjs [--extract]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const ZIP = 'download/KEYS-ZIP-2026-09-09.zip.enc';
const INNER_SHA = '684b661f222e313d403829067d1522cb3c462560e64d55f47c93bb0044abd718';
const OUTDIR = '/tmp/keyszip';
const EXTRACT = process.argv.includes('--extract');

const readable = (f) => {
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (_) { return null; }
};

// ── קציר-מועמדים מקבצים (שמות-בלבד בדוח) ──
const cands = [];
const push = (name, val) => { if (val && val.length >= 6 && val.length <= 200 && !cands.some(c => c.val === val)) cands.push({ name, val }); };

const metaP = 'agent/fleet_keys.meta.json';
if (fs.existsSync(metaP)) {
  try {
    const m = JSON.parse(fs.readFileSync(metaP, 'utf8'));
    if (m.pass) push('fleet_keys.meta.json:pass', m.pass);
    for (const [k, v] of Object.entries(m)) if (typeof v === 'string' && k !== 'pass' && k !== 'format' && k !== 'kdf' && k !== 'enc' && v.length >= 6) push('fleet_keys.meta.json:' + k, v);
  } catch (_) {}
}
push('keys/.vaultkey', readable('agent/keys/.vaultkey'));
push('keys/key-broker.token', readable('agent/keys/key-broker.token'));
push('keys/agents-api.token', readable('agent/keys/agents-api.token'));
push('keys/headcorner-recovered.txt(line1)', (readable('agent/keys/headcorner-recovered.txt') || '').split('\n')[0] || null);
// .env: ערכים-שאינם-WIF/URL/pubs
try {
  for (const line of fs.readFileSync('agent/.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (!m) continue;
    const [k, v] = [m[1], m[2].trim()];
    if (/WIF|PUB|URL|MODE|DATABASE|GITHUB/.test(k)) continue;
    if (v.length >= 6) push('.env:' + k, v);
  }
} catch (_) {}
// סיסמת-ה-KEYS-BACKUP המוכחת (מוכרת-מהשיחה) — עוברת-כ-env, לא-נכתבת-לדיסק
const bkp = process.env.BKPASS || null;
if (bkp) push('KEYS-BACKUP-proven-password', bkp);
// מנמוניקים (מילים-מופרדות-רווח) כמועמדי-בזק
push('keys/tron-mnemonic.txt', readable('agent/keys/tron-mnemonic.txt'));
push('keys/tron-legacy-mnemonic.txt', readable('agent/keys/tron-legacy-mnemonic.txt'));

// ── בדיקה ──
fs.rmSync(OUTDIR, { recursive: true, force: true });
fs.mkdirSync(OUTDIR, { recursive: true });
fs.chmodSync(OUTDIR, 0o700);

const wantSha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let found = null;
const results = [];
for (const c of cands) {
  const out = path.join(OUTDIR, 'dec.zip');
  try {
    execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '300000', '-in', ZIP, '-out', out, '-pass', 'env:ZIPCAND'], { timeout: 90000, stdio: 'pipe', env: { ...process.env, ZIPCAND: c.val } });
    const head = fs.readFileSync(out).subarray(0, 2).toString('latin1');
    const sha = wantSha(out);
    const ok = head === 'PK';
    results.push({ name: c.name, ok, shaMatch: sha === INNER_SHA });
    if (ok) { found = { ...c, sha, shaMatch: sha === INNER_SHA }; break; }
  } catch (e) {
    results.push({ name: c.name, ok: false, err: String(e.message).slice(0, 40) });
  }
}

console.log('candidates tested:', results.length);
for (const r of results) console.log('  ' + (r.ok ? 'OPEN ✓' : 'fail') + '  ' + r.name + (r.shaMatch !== undefined ? ' · inner-sha-match=' + r.shaMatch : ''));

if (found) {
  fs.writeFileSync(path.join(OUTDIR, '.zippass'), found.val + '\n', { mode: 0o600 });
  console.log('UNLOCKED by: ' + found.name + ' → decrypted zip at ' + OUTDIR + '/dec.zip (0600) · passfile saved 0600');
  if (found.shaMatch) console.log('inner sha256 MATCHES README expectation ✓');
  if (EXTRACT) {
    const xdir = path.join(OUTDIR, 'x');
    fs.mkdirSync(xdir, { recursive: true });
    execFileSync('unzip', ['-q', '-o', path.join(OUTDIR, 'dec.zip'), '-d', xdir], { stdio: 'pipe' });
    let n = 0; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else n++; } };
    walk(xdir);
    console.log('extracted ' + n + ' files → ' + xdir);
  }
} else {
  console.log('NO candidate opened the zip. הסיסמה-אינה-בקבצים-שנבדקו.');
}
