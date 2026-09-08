/**
 * THE-KEY-BROKER (117k) — שער-החתימה-הריבוני
 *
 * המנדט (מהמפעיל): "צריך קצת גישה למפתחות בצורה חכמה שכל הסוכנים יוכלו לעבוד אבל שזה יהיה בטוח"
 *
 * עקרונות-אבטחה (קשיחים):
 *  · מפתחות-פרטיים חיים-רק-בזיכרון-התהליך-הזה — לעולם לא בתשובה, בלוג או בקובץ.
 *  · localhost בלבד (127.0.0.1) + טוקן (agent/keys/key-broker.token, 0600) + הגבלת-קצב + אודיט JSONL.
 *  · חתימה על digest (32 בייטים) בלבד — הסוכנים בונים-טרנזקציה בעצמם, הברוקר רק מחתים.
 *  · /doors חושף כתובות-ציבוריות בלבד (זהות — לא סוד).
 *  · אפס-סודות-בלוג: האודיט מכיל מזהי-דלת + digest + פסיקות בלבד.
 *
 * דלתות:
 *  · sov:{0..5}   — מנמוניק-ריבוני (agent/keys/tron-mnemonic.txt) · m/44'/195'/0'/0/{0..5}
 *  · legacy:{0,1} — מנמוניק-הישן-המשוחזר (agent/keys/tron-legacy-mnemonic.txt) · idx0=TAzZZ… idx1=TRKSt…
 *
 * הרצה: bun run dev (bun --hot · פורט 3040 · מובן-חוזר-אוטומטית-בשינוי-קבצים)
 */
import { serve } from 'bun';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';

const PORT = 3040;
const HOST = '127.0.0.1';
const VERSION = 'key-broker/117k';
const HERE = import.meta.dir;
const ROOT = path.resolve(HERE, '..', '..');
const KEYS = path.join(ROOT, 'agent', 'keys');
const MNEM_SOV = path.join(KEYS, 'tron-mnemonic.txt');
const MNEM_LEGACY = path.join(KEYS, 'tron-legacy-mnemonic.txt');
const TOKEN_FILE = path.join(KEYS, 'key-broker.token');
const AUDIT = path.join(HERE, 'audit.jsonl');
const TRON_PATH = (i: number) => "m/44'/195'/0'/0/" + i;

interface Door {
  id: string;
  address: string;
  priv: string;
  family: string;
  path: string;
}

let doors: Door[] = [];
const bootAt = Date.now();

function derive(phrase: string, family: string, idxs: number[]): Door[] {
  const out: Door[] = [];
  for (const i of idxs) {
    const w = ethers.HDNodeWallet.fromPhrase(phrase, undefined, TRON_PATH(i));
    // כתובת-טרון: pubkey-לא-דחוס → keccak-20-אחרונים → 0x41 ‖ double-sha256 → base58check
    const pubU = ethers.SigningKey.computePublicKey(w.privateKey, false).slice(4);
    const kec = ethers.keccak256(Buffer.from(pubU, 'hex'));
    const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), 'hex')]);
    const h2 = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest();
    const bs58 = require(path.join(ROOT, 'node_modules', 'bs58'));
    const address = bs58.encode(Buffer.concat([payload, h2.subarray(0, 4)]));
    out.push({ id: family + ':' + i, address, priv: w.privateKey.slice(2), family, path: TRON_PATH(i) });
  }
  return out;
}

function loadDoors() {
  const next: Door[] = [];
  try {
    const p = fs.readFileSync(MNEM_SOV, 'utf8').trim().replace(/\s+/g, ' ');
    if (ethers.Mnemonic.isValidMnemonic(p)) next.push(...derive(p, 'sov', [0, 1, 2, 3, 4, 5]));
  } catch (_) { /* אין-קובץ — דלתות-ריבוניות-חסרות (שקיפות-ב-/health) */
  }
  try {
    const p = fs.readFileSync(MNEM_LEGACY, 'utf8').trim().replace(/\s+/g, ' ');
    if (ethers.Mnemonic.isValidMnemonic(p)) next.push(...derive(p, 'legacy', [0, 1]));
  } catch (_) { /* אין-קובץ — דלתות-ישנות-חסרות */
  }
  doors = next;
}

function ensureToken(): string {
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(t)) return t;
  } catch (_) { /* ייצור-ראשון */ }
  const t = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch (_) {}
  return t;
}

let TOKEN = ensureToken();
/* רענון-טוקן-חם (אם-המפעיל-מסובב) כל-30s */
setInterval(() => { try { const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(t)) TOKEN = t; } catch (_) {} }, 30000);
/* רענון-דלתות-חם (guardian עשוי-לשחזר/לסובב-קבצי-מפתח) */
setInterval(loadDoors, 20000);
loadDoors();

/* ── הגבלת-קצת: חלון-החלקה לכל-טוקן ── */
const RATE_MAX = 240;
const RATE_WINDOW_MS = 60_000;
const hits: number[] = [];
function rateOk(): boolean {
  const now = Date.now();
  while (hits.length && now - hits[0] > RATE_WINDOW_MS) hits.shift();
  if (hits.length >= RATE_MAX) return false;
  hits.push(now);
  return true;
}

function audit(op: string, detail: Record<string, unknown>, verdict: string) {
  try {
    fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), op, ...detail, verdict }) + '\n');
  } catch (_) { /* אודיט-לעולם-לא-מפיל-את-השירות */ }
}

function json(res: unknown, status = 200): Response {
  return new Response(JSON.stringify(res), { status, headers: { 'content-type': 'application/json' } });
}

function authed(req: Request): boolean {
  const t = req.headers.get('x-kb-token') || '';
  const a = Buffer.from(t);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, '') || '/';

  if (route === '/health') {
    return json({ ok: true, service: VERSION, doors: doors.length, families: [...new Set(doors.map((d) => d.family))], uptimeMs: Date.now() - bootAt });
  }

  if (!authed(req)) {
    audit('auth', { route }, 'DENY-bad-token');
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  if (!rateOk()) {
    audit('rate', { route }, 'DENY-rate');
    return json({ ok: false, error: 'rate-limited' }, 429);
  }

  if (route === '/doors') {
    return json({ ok: true, doors: doors.map(({ id, address, family, path }) => ({ id, address, family, path })) });
  }

  if (route === '/derive') {
    /* גזירה-ציבורית-לכלי-הסוכנים: {family, idx} → {address} (אין-מפתח-פרטי-בתשובה) */
    try {
      const body = await req.json();
      const fam = String(body.family || '');
      const idx = Number(body.idx || 0);
      if (!['sov', 'legacy'].includes(fam)) return json({ ok: false, error: 'bad-family' }, 400);
      const found = doors.find((d) => d.family === fam && d.path === TRON_PATH(idx));
      if (!found) return json({ ok: false, error: 'door-not-loaded' }, 404);
      audit('derive', { family: fam, idx }, 'OK');
      return json({ ok: true, id: found.id, address: found.address, path: found.path });
    } catch (_) { return json({ ok: false, error: 'bad-json' }, 400); }
  }

  if (route === '/sign') {
    /* החתימה-היחידה-המוצעת: {door, digestHex} — digest-בדיוק-32-בייטים (sha256 של-המטען-שהסוכן-בנה).
     * טרון: sig = sign(sha256(rawData)) · 65-בייטים r‖s‖v(v=27+rec). אפס-מפתח-בתשובה. */
    try {
      const body = await req.json();
      const id = String(body.door || '');
      const digestHex = String(body.digestHex || '').toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(digestHex)) {
        audit('sign', { door: id }, 'DENY-bad-digest');
        return json({ ok: false, error: 'digestHex-must-be-32-bytes-hex' }, 400);
      }
      const door = doors.find((d) => d.id === id || d.address === id);
      if (!door) {
        audit('sign', { door: id }, 'DENY-no-door');
        return json({ ok: false, error: 'unknown-door' }, 404);
      }
      const digest = Buffer.from(digestHex, 'hex');
      const sk = new ethers.SigningKey('0x' + door.priv);
      const sig = sk.sign('0x' + digestHex); // v6: serialized = r‖s‖v(27/28) · 65-בייטים
      const signatureHex = sig.serialized.slice(2);
      audit('sign', { door: door.id, digest: digestHex }, 'OK');
      return json({ ok: true, door: door.id, address: door.address, signatureHex });
    } catch (_) { return json({ ok: false, error: 'bad-json' }, 400); }
  }

  return json({ ok: false, error: 'not-found' }, 404);
}

serve({ hostname: HOST, port: PORT, fetch: handle });
console.log('[' + new Date().toISOString() + '] ' + VERSION + ' up on http://' + HOST + ':' + PORT + ' · doors=' + doors.length + ' (' + doors.map((d) => d.id + '=' + d.address.slice(0, 8)).join(' ') + ')');
