#!/usr/bin/env node
/**
 * 117p8-R11 — keys_zip_v2: ארכיון-המפתחות הריבוני, גרסה-2 (מדיניות-משמורת-מערכת).
 *
 * שינוי-מדיניות (הוראת-מפעיל 2026-09-10 "זה אצלך בקבצים לא אצלי"):
 * הסיסמאות עוברות משמורת-צ'אט (שאבדה-פעם-אחת-והשאירה-זיפ-נעול לנצח) לשמורת-מערכת:
 * agent/recovery-meta.json מאוכסן בריפו-הפרטי ומכיל את סיסמת-הזיפ + סיסמת-ה-KEYS-BACKUP.
 * התוצאה: כל-reset-סנדבוקס משחזר את כל-המפתחות מהריפו לבד — בלי-תלות בהמשכיות-שיחה.
 *
 * מה-הכלי עושה: אורז את כל-חומר-המפתחות → סיסמה-אקראית-חדשה → AES-256-CBC
 * pbkdf2-300k → roundtrip-אימות (פענוח+ unzip + diff מול-מקור) → מניפסט-sha256
 * → recovery-meta.json (0600) → מדפיס shas-פומביים-בלבד.
 * אף-סיסמה לא נדפסת ולא נכנסת ללוג.
 *
 * הרצה: node agent/keys_zip_v2.cjs [--verify-only]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORK = '/tmp/keyszip-v2';
const OUT_ENC = path.join(ROOT, 'agent', 'vault', 'KEYS-ZIP-2026-09-10.zip.enc');
const META = path.join(ROOT, 'agent', 'recovery-meta.json');

// ── החבילה: כל-חומר-המפתחות שבידינו (21+ קבצים) ──
const FILES = [
  'agent/keys/vault.json',
  'agent/keys/vault.enc',
  'agent/keys/wallets-seed.json',
  'agent/keys/wallets-registry.json',
  'agent/keys/tron-mnemonic.txt',
  'agent/keys/tron-legacy-mnemonic.txt',
  'agent/keys/.vaultkey',
  'agent/keys/key-broker.token',
  'agent/keys/headcorner-recovered.txt',
  'agent/keys/hed-soldiers-source.txt', // R18 — ארכיון-הד.txt: 13 מפתחות-2018 של-12 חשבונות-הסגל (מתים-אומת · ארכיון-בלבד)
  'agent/.env',
  'agent/fleet_keys.enc',
  'agent/fleet_keys.meta.json',
  'agent/rotation_evidence.json',
  'agent/owner_watch_state.json',
  'upload/IMG-20260905-WA0025.jpg',
  'upload/Roshcaregt.txt',
  'upload/Ynet.txt',
  'upload/הד.txt', // R18 — המקור-הגולמי-שהעלה-המפעיל (שמירת-הוכחה)
  'upload/הדקור.txt',
  'upload/חח.txt',
].filter((f) => fs.existsSync(path.join(ROOT, f)));

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function verifyOnly() {
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  const out = path.join(WORK, 'verify.zip');
  fs.mkdirSync(WORK, { recursive: true });
  execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '300000', '-in', OUT_ENC, '-out', out, '-pass', 'env:ZP'], { stdio: 'pipe', env: { ...process.env, ZP: meta.keysZipPass } });
  const ok = fs.readFileSync(out).subarray(0, 2).toString('latin1') === 'PK';
  const innerSha = sha(out); // לפני-המחיקה
  fs.rmSync(WORK, { recursive: true, force: true }); // 117p8-R14 — אפס-חומר-גלוי-שנשאר-ב-tmp
  console.log('verify: ' + (ok ? 'OPEN ✓ (PK header, sha-inner=' + innerSha.slice(0, 12) + '…)' : 'BROKEN'));
  process.exit(ok ? 0 : 2);
}

if (process.argv.includes('--verify-only')) verifyOnly();

// ── 1) אריזה ──
fs.rmSync(WORK, { recursive: true, force: true });
const stage = path.join(WORK, 'stage');
for (const rel of FILES) {
  const dst = path.join(stage, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dst);
}
const manifest = FILES.map((rel) => rel + '  ' + sha(path.join(ROOT, rel))).join('\n');
fs.mkdirSync(path.join(stage, 'MANIFEST'), { recursive: true });
fs.writeFileSync(path.join(stage, 'MANIFEST.txt'), 'KEYS-ZIP-2026-09-10 · ' + FILES.length + ' files · built ' + new Date().toISOString() + ' · sha256 per file:\n\n' + manifest + '\n');

// ── 2) סיסמה-חדשה + הצפנה ──
const zipPass = crypto.randomBytes(24).toString('base64');
const zipFile = path.join(WORK, 'keys.zip');
execFileSync('zip', ['-q', '-r', zipFile, '.'], { cwd: stage, stdio: 'pipe' });
execFileSync('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-iter', '300000', '-in', zipFile, '-out', OUT_ENC, '-pass', 'env:ZP'], { stdio: 'pipe', env: { ...process.env, ZP: zipPass } });

// ── 3) roundtrip: פענוח + unzip + diff מול-המקור ──
const dec = path.join(WORK, 'dec.zip');
execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '300000', '-in', OUT_ENC, '-out', dec, '-pass', 'env:ZP'], { stdio: 'pipe', env: { ...process.env, ZP: zipPass } });
if (sha(dec) !== sha(zipFile)) throw new Error('roundtrip-sha-mismatch');
const xdir = path.join(WORK, 'x');
fs.mkdirSync(xdir, { recursive: true });
execFileSync('unzip', ['-q', '-o', dec, '-d', xdir], { stdio: 'pipe' });
execFileSync('diff', ['-r', stage, xdir], { stdio: 'pipe' });

// ── 4) recovery-meta.json (משמורת-מערכת · נשמר-בריפו-הפרטי) ──
let tarPass = null;
try { tarPass = JSON.parse(fs.readFileSync(META, 'utf8')).keysBackupPass || null; } catch (_) {}
if (!tarPass) tarPass = process.env.BKPASS || null; // מוכרת-מהשיחה — עוברת-כ-env, לא-נדפסת
if (!tarPass) throw new Error('keysBackupPass missing — pass via BKPASS env');
const prev = (() => { try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch (_) { return {}; } })();
const meta = {
  format: 'SAOS-RECOVERY-META-1',
  doctrine: 'operator directive 2026-09-10: "זה אצלך בקבצים לא אצלי" — system custody, private repo. Supersedes chat-only passwords (the chat-only era stranded KEYS-ZIP-2026-09-09 forever).',
  keysZipPass: zipPass,
  keysZipFile: 'agent/vault/KEYS-ZIP-2026-09-10.zip.enc',
  keysZipSha256: sha(OUT_ENC),
  keysZipInnerSha256: sha(zipFile),
  keysBackupPass: tarPass,
  keysBackupFile: 'agent/vault/KEYS-BACKUP-2026-09-09.tar.enc',
  keysBackupSha256: sha(path.join(ROOT, 'agent/vault/KEYS-BACKUP-2026-09-09.tar.enc')),
  replacedArchive: prev.keysZipFile || 'download/KEYS-ZIP-2026-09-09.zip.enc (password-lost — remains in git history, un-openable)',
  sealedAt: new Date().toISOString(),
};
fs.writeFileSync(META, JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 });

console.log('BUILT ' + path.relative(ROOT, OUT_ENC) + ' · ' + FILES.length + ' files + MANIFEST');
console.log('roundtrip: decrypt ✓ · unzip ✓ · diff-vs-source ✓ (byte-identical)');
console.log('outer sha256: ' + meta.keysZipSha256);
console.log('inner sha256: ' + meta.keysZipInnerSha256);
console.log('recovery-meta.json written (0600) — zipPass + keysBackupPass in system custody');

/* 117p8-R14 — היגיינת-מעטפת: stage/x/dec מכילים-חומר-מפתחות-גלוי — חובה-ניקוי
 * בסוף-כל-ריצה (נמצא-חי: /tmp/keyszip-v2/stage נשאר-אחרי-איטום-קודם). */
try { fs.rmSync(WORK, { recursive: true, force: true }); console.log('workdir wiped ✓ (אפס-חומר-גלוי-ב-tmp)'); }
catch (e) { console.log('workdir wipe FAILED — נקה-ידנית: ' + WORK); }

// ── 5) 117p8-R14 — עדכון-sha-מצופים ב-README (ה-README-הוא-מדריך-השחזור —
//    אסור-שיציג-sha של דור-קודם; נשמר-מדויק-אוטומטית אחרי-כל-איטום) ──
const README = path.join(ROOT, 'agent', 'vault', 'KEYS-ZIP-README-HE.md');
try {
  let txt = fs.readFileSync(README, 'utf8');
  const before = txt;
  txt = txt.replace(/^# מצופה: [0-9a-f]{64}$/m, '# מצופה: ' + meta.keysZipSha256);
  txt = txt.replace(/^# מצופה sha256 של הזיפ-הפנימי: [0-9a-f]{64}$/m, '# מצופה sha256 של הזיפ-הפנימי: ' + meta.keysZipInnerSha256);
  if (txt !== before) { fs.writeFileSync(README, txt); console.log('README-HE shas updated ✓'); }
  else console.log('README-HE shas: no-צפוי-lines-found (בדוק-ידנית)');
} catch (e) { console.log('README update skipped: ' + String(e.message).slice(0, 60)); }
