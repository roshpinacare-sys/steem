#!/usr/bin/env node
/* vault-lib.cjs — 114 THE-VAULT (הכספת): מעטפת-הצפנה ריבונית לכל-חומר-המפתחות.
 *
 * המנדט (מהמפעיל): "וודא כתובות אמיתיות שיהיה מפתחות בכספת כמו שצריך והכל".
 *
 * התשובה-הריבונית — שדרוג-אמת מעל-הקיים (בלי-לשבור-את-המכונה):
 *  · המצב-הקודם: 4 קבצי-מפתחות-פזורים-בטקסט-פשוט (wallets-seed / wallets-registry /
 *    vault.json / tron-mnemonic) — הכספת-הייתה-רעיון, לא-מנגנון.
 *  · המצב-החדש: מעטפת-אחת מוצפנת agent/keys/vault.enc — AES-256-GCM
 *    (KDF: scrypt N=2^15) עם-מפתח-אב-אקראי agent/keys/.vaultkey (chmod 600) —
 *    המעטפת-היא-מקור-האמת: digests-חברים מאומתים בכל-פתיחה · שחזור-אוטומטי
 *    של-כל-חבר-פגום/חסר (vault.cjs restore · guardian healVault) · טקסט-פשוט
 *    נשאר-רק-כשיקוף-תפעולי (10+ קוראים-חיים: escrow/fleet/agent.cjs/UI) —
 *    ההבטחה: אם-כל-הטקסט-הפשוט-נעלם → `vault.cjs restore` מחזיר-הכל.
 *  · טקס-האימות: `vault.cjs verify` פותח-את-המעטפת, מגזר-מחדש 12×4 כתובות
 *    מהזרע-המוצפן, ומשווה-מול wallets-public.json — העיגון-הציבורי-על-STEEM.
 *    "הכספת-נפתחת-לזהות-המעוגנת" — זו-ההוכחה-החזקה-ביותר-שאין.
 *
 * דיסציפלינות: אפס-סודות-ב-stdout של-status · המעטפת-והמפתח-מחוץ-לגיט
 * (agent/keys/ מנוטרש-כבר-מ-113) · כותב-יחיד-לכל-קובץ · כל-כשל-נאמר-בקול. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS = path.join(__dirname, '..', '..', 'agent', 'keys');
const ENC = path.join(KEYS, 'vault.enc');
const MASTER = path.join(KEYS, '.vaultkey');
const VERIFY_LAST = path.join(__dirname, 'vault-verify-last.json');

/* 117h — מצבות-כנות לחברים-שאינם: לא-ממציאים-תוכן, לא-מסתירים-אובדן. */
const ABSENT_NOTES = {
  'tron-mnemonic.txt': 'LOST-FOREVER(115-rollback · postmortem 5da5cfb · bridge retired — doors re-founded on sovereign seed 117h)',
  'vault.json': 'RETIRED(STEEM creds flow from agent/.env POSTING_WIF · roster readers all catch-degrade)',
  'wallets-registry.json': 'DERIVABLE-ON-DEMAND(from wallets-seed via wallets.cjs recipe)',
};

/* חברי-הכספת — כל-חומר-המפתחות-הריבוני */
const MEMBERS = [
  { name: 'wallets-seed.json', kind: 'json' },      // הזרע-הריבוני (113)
  { name: 'wallets-registry.json', kind: 'json' },  // המפתחות-הפרטיים-של-12-הסוכנים (113)
  { name: 'vault.json', kind: 'json' },             // כספת-הצבא-הSTEEM (הרוסטר-הקנוני)
  { name: 'tron-mnemonic.txt', kind: 'text' },      // מנמוניק-טרון (הגשר-והדקס)
  { name: 'tron-legacy-mnemonic.txt', kind: 'text' }, // 117k — מנמוניק-טרון-הישן (הושחזר-מהתמונה · דלתות TAzZZ/TRKSt · 19.13 TRX)
];

function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function readMemberFile(name) {
  return fs.readFileSync(path.join(KEYS, name), 'utf8');
}

/* ── איטום: מה-שחי → מעטפת-אחת-מוצפנת + מפתח-אב · 117h — סמנטיקת-גרועה-כנה:
 * חברים-חסרים-על-הדיסק לא-מפילים-את-האיטום — הם-נרשמים-במעטפת (env.absent)
 * עם-סיבה-כנה (אבד/פר-הזמן/נגזר-לפי-דרישה) והאמת-נשמרת-בלי-להמציא-תוכן.
 * תנאי-היסוד: wallets-seed.json חייב-להיות-קיים (גרעין-הזהות). */
function seal(selfManifest) {
  fs.mkdirSync(KEYS, { recursive: true });
  const bundle = { sealedAt: new Date().toISOString(), members: {} };
  const absent = {};
  for (const m of MEMBERS) {
    let raw = null;
    try { raw = readMemberFile(m.name); } catch (_) { raw = null; }
    if (raw === null) {
      absent[m.name] = ABSENT_NOTES[m.name] || 'missing-at-seal';
      continue;
    }
    bundle.members[m.name] = { kind: m.kind, bytes: Buffer.byteLength(raw), content: raw };
  }
  if (!bundle.members['wallets-seed.json']) throw new Error('seal-refused: no wallets-seed.json (גרעין-הזהות)');
  // אם-קיימת-מעטפת-קודמת — אותו-מפתח-אב (איטום-חוזר-בלי-סיבוב-מפתחות)
  let master = null;
  try { master = fs.readFileSync(MASTER, 'utf8').trim(); } catch (_) {}
  if (!master || master.length < 40) {
    master = crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(MASTER, master, { mode: 0o600 });
    try { fs.chmodSync(MASTER, 0o600); } catch (_) {}
  }
  const salt = crypto.randomBytes(16);
  const KDF = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }; // 128·N·r≈33MB — ברירת-המחדל-של-node-חוסמת; מרימים-תקרה
  const key = crypto.scryptSync(master, salt, 32, KDF);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(bundle), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const env = {
    v: 1,
    kdf: 'scrypt', N: 1 << 15, r: 8, p: 1,
    salt: salt.toString('hex'), iv: iv.toString('hex'), tag: tag.toString('hex'),
    ct: ct.toString('hex'),
    digest: sha256hex(ct.toString('hex')),
    members: Object.fromEntries(Object.entries(bundle.members).map(([k, v]) => [k, { sha256: sha256hex(v.content), bytes: v.bytes, kind: v.kind }])),
    absent,
    selfManifest: selfManifest || null,
    sealedAt: bundle.sealedAt,
    note: 'SAOS sovereign vault envelope — one encrypted truth for all army keys (117h: degraded-honest seal — absent members memorialized, never fabricated; selfManifest = self-attested identity of the sealed seed)',
  };
  const tmp = ENC + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(env, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, ENC);
  _cache = null; // איטום-חדש → cache-פסול
  // טקסט-מסתובב-סביב-הזהות (סודות-לא-נכתבים)
  return { ok: true, digest: env.digest, members: env.members, absent, sealedAt: env.sealedAt };
}

/* ── פתיחה: מעטפת-קודם · fallback-טקסט-פשוט (גלגל-הצלה-תפעולי) ──
 * cache-בתהליך: scrypt-יקר (~100-400ms) — המעטפת-אטומה/בלתי-ניתנת-לשינוי-בזמן-ריצה,
 * פותחים-פעם-אחת-לפרוצס (ה-cache-מתרוקן-אם-קובץ-המעטפת-מתחלף-mtime). */
let _cache = null; // {mtime, opened}
function openVault({ allowPlaintext = true } = {}) {
  let mtime = null;
  try { mtime = fs.statSync(ENC).mtimeMs; } catch (_) { mtime = null; }
  if (_cache && _cache.mtime === mtime && (mtime !== null || allowPlaintext)) return _cache.opened;
  if (fs.existsSync(ENC)) {
    const env = JSON.parse(fs.readFileSync(ENC, 'utf8'));
    const master = fs.readFileSync(MASTER, 'utf8').trim();
    const key = crypto.scryptSync(master, Buffer.from(env.salt, 'hex'), 32, { N: env.N, r: env.r, p: env.p, maxmem: 96 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(env.tag, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(env.ct, 'hex')), decipher.final()]).toString('utf8');
    const bundle = JSON.parse(plain);
    // אימות-חברים-בכל-פתיחה (GCM כבר-מאמת-שלמות — ה-digests-מאמתים-תוכן-מול-המניפסט)
    for (const [name, meta] of Object.entries(env.members || {})) {
      const got = sha256hex(bundle.members[name].content);
      if (got !== meta.sha256) throw new Error('vault member digest mismatch: ' + name);
    }
    const opened = {
      mode: 'envelope', sealedAt: env.sealedAt, digest: env.digest, members: env.members,
      get(name) {
        const m = bundle.members[name];
        if (!m) throw new Error('no such vault member: ' + name);
        return m.kind === 'json' ? JSON.parse(m.content) : m.content;
      },
    };
    _cache = { mtime, opened };
    return opened;
  }
  if (!allowPlaintext) throw new Error('vault envelope missing: ' + ENC);
  // fallback — המצב-ההיסטורי (טרם-איטום / אחרי-שחזור-חלקי)
  const opened = {
    mode: 'plaintext', sealedAt: null, digest: null, members: {},
    get(name) {
      const raw = readMemberFile(name);
      return MEMBERS.find((m) => m.name === name).kind === 'json' ? JSON.parse(raw) : raw;
    },
  };
  _cache = { mtime, opened };
  return opened;
}

/* ── שחזור: מעטפת → קבצי-טקסט-פשוט (הרפואה-של-הכספת) · 117h — חבר-שלא-נאטם מדולג בכנות ── */
function restore(only) {
  const v = openVault({ allowPlaintext: false });
  const out = [], skipped = [];
  for (const m of MEMBERS) {
    if (only && m.name !== only) continue;
    let raw = null;
    try { raw = v.get(m.name); } catch (_) { raw = null; }
    if (raw === null) { skipped.push(m.name + '(absent-from-envelope)'); continue; }
    const content = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    const p = path.join(KEYS, m.name);
    const tmp = p + '.restore.tmp';
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    fs.renameSync(tmp, p);
    out.push(m.name + '(' + Buffer.byteLength(content) + 'B)');
  }
  return { ok: true, restored: out, skipped, digest: v.digest };
}

/* ── סטטוס-ציבורי (אפס-סודות) — ל-API ול-guardian ── */
function status() {
  let sealed = false, digest = null, sealedAt = null, members = {}, absent = {}, masterOk = false;
  try {
    const env = JSON.parse(fs.readFileSync(ENC, 'utf8'));
    sealed = true; digest = env.digest; sealedAt = env.sealedAt; members = env.members || {}; absent = env.absent || {};
    masterOk = fs.existsSync(MASTER);
  } catch (_) {}
  let verifyLast = null;
  try { verifyLast = JSON.parse(fs.readFileSync(VERIFY_LAST, 'utf8')); } catch (_) {}
  return { sealed, digest, sealedAt, masterOk, members, absent, verifyLast };
}

/* ── עוזרי-קריאה-תפעוליים — כל-ה-daemons-קוראים-דרך-הכספת (envelope→plaintext) ── */
function readMnemonic() {
  try { const v = openVault(); return String(v.get('tron-mnemonic.txt')).trim().split(/\s+/).join(' '); } catch (_) {}
  try { return fs.readFileSync(path.join(KEYS, 'tron-mnemonic.txt'), 'utf8').trim().split(/\s+/).join(' '); } catch (_) {}
  throw new Error('tron-mnemonic-lost(115-rollback · postmortem 5da5cfb — doors re-founded on sovereign seed 117h)'); // כנות-במקום-ENOENT
}
function readMember(name) {
  // envelope → plaintext (שני-המקורות-נאמנים; המעטפת-מגובה-ב-restore)
  try { return openVault().get(name); } catch (_) {}
  const raw = fs.readFileSync(path.join(KEYS, name), 'utf8');
  const m = MEMBERS.find((x) => x.name === name);
  return m && m.kind === 'json' ? JSON.parse(raw) : raw;
}

module.exports = { seal, openVault, restore, status, readMnemonic, readMember, MEMBERS, ABSENT_NOTES, ENC, MASTER, VERIFY_LAST, sha256hex };
