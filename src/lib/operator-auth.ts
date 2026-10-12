import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * שכבת-האימות של קונסולת-המפעיל.
 * מקור-אמת-יחיד: sanbox/state/credentials.json — אותו קובץ שאר-המפעיל (sanbox/operator-site) מאמת מולו.
 * חוקים: hash scrypt בלבד · אפס-סודות-בתשובות · fail-closed · סשנים git-ignored · הגבלת-ניסיונות.
 */

export const OP_COOKIE = "saos_op";
const SESSION_TTL_MS = 12 * 3_600_000;
const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_MAX = 5;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

function repoRoot(): string {
  // Next.js רץ עם cwd = שורש-הריפו (worktree). אין-ניחושים: cwd הוא האמת.
  return process.cwd();
}

export function stateDir(): string {
  const dir = path.join(repoRoot(), "sanbox", "state");
  return dir;
}

function credsPath(): string {
  return path.join(stateDir(), "credentials.json");
}

function sessionsPath(): string {
  return path.join(stateDir(), "sessions.json");
}

function ensureStateDir(): boolean {
  try {
    const dir = stateDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    return true;
  } catch {
    return false;
  }
}

type Creds = {
  version: number;
  scrypt: { N: number; r: number; p: number; keylen: number };
  salt: string;
  hash: string;
  createdAt: string;
};

export function hasCredentials(): boolean {
  try {
    const c = JSON.parse(readFileSync(credsPath(), "utf8")) as Creds;
    return !!(c && c.salt && c.hash);
  } catch {
    return false;
  }
}

export function verifyPassword(pw: unknown): boolean {
  if (typeof pw !== "string" || pw.length === 0) return false;
  let c: Creds | null = null;
  try {
    c = JSON.parse(readFileSync(credsPath(), "utf8")) as Creds;
  } catch {
    return false;
  }
  if (!c || !c.salt || !c.hash) return false;
  try {
    const { N, r, p, keylen } = c.scrypt && typeof c.scrypt === "object" ? c.scrypt : SCRYPT;
    const calc = scryptSync(pw, Buffer.from(c.salt, "hex"), keylen, { N, r, p });
    return timingSafeEqual(calc, Buffer.from(c.hash, "hex"));
  } catch {
    return false;
  }
}

/** אתחול-ראשון בלבד: נדחה לתמיד ברגע שקיים קובץ-הרשאות. */
export function setPassword(pw: unknown): { ok: boolean; error?: string } {
  if (typeof pw !== "string" || pw.length < 12) return { ok: false, error: "הסיסמה חייבת להכיל 12 תווים לפחות" };
  if (hasCredentials()) return { ok: false, error: "אתחול-סיסמה סגור: הרשאות קיימות" };
  if (!ensureStateDir()) return { ok: false, error: "מדריך-ה-state אינו כתיב" };
  try {
    const salt = randomBytes(16);
    const hash = scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    const creds: Creds = {
      version: 1,
      scrypt: { ...SCRYPT },
      salt: salt.toString("hex"),
      hash: hash.toString("hex"),
      createdAt: new Date().toISOString(),
    };
    const p = credsPath();
    writeFileSync(p, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
    try { chmodSync(p, 0o600); } catch {}
    return { ok: true };
  } catch {
    return { ok: false, error: "כתיבת-ההרשאות נכשלה" };
  }
}

// ── סשנים (קובץ git-ignored, mode 600; הטוקן לעולם לא נרשם בלוג) ──

type Sessions = Record<string, { createdAt: string; expiresAt: string; ipHash: string }>;

function loadSessions(): Sessions {
  try {
    return JSON.parse(readFileSync(sessionsPath(), "utf8")) as Sessions;
  } catch {
    return {};
  }
}

function saveSessions(s: Sessions): void {
  if (!ensureStateDir()) return;
  try {
    writeFileSync(sessionsPath(), JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  } catch {}
}

export function ipHash(ip: string | null): string {
  return createHash("sha256").update(`op-gate:${ip ?? "unknown"}`).digest("hex").slice(0, 16);
}

export function createSession(ip: string | null): { token: string; expiresAt: string } | null {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  const all = loadSessions();
  // תחזוקה: הסרת-פגים + תקרת-50 (הוותיקים נזרקים ראשונים)
  const keep: Sessions = {};
  const entries = Object.entries(all)
    .filter(([, v]) => new Date(v.expiresAt).getTime() > now)
    .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));
  for (const [t, v] of entries.slice(Math.max(0, entries.length - 49))) keep[t] = v;
  keep[token] = { createdAt: new Date(now).toISOString(), expiresAt, ipHash: ipHash(ip) };
  saveSessions(keep);
  return { token, expiresAt };
}

export function readSession(token: string | undefined | null): { valid: boolean; expiresAt: string | null } {
  if (!token || typeof token !== "string" || token.length !== 64) return { valid: false, expiresAt: null };
  const s = loadSessions()[token];
  if (!s) return { valid: false, expiresAt: null };
  if (new Date(s.expiresAt).getTime() <= Date.now()) return { valid: false, expiresAt: null };
  return { valid: true, expiresAt: s.expiresAt };
}

export function destroySession(token: string | undefined | null): void {
  if (!token) return;
  const all = loadSessions();
  if (all[token]) {
    delete all[token];
    saveSessions(all);
  }
}

// ── הגבלת-ניסיונות (זיכרון-תהליך; איפוס-מוצלח) ──

const attempts = new Map<string, { n: number; resetAt: number }>();

export function loginAllowed(ip: string | null): { allowed: boolean; retryAfterSec: number } {
  const k = ipHash(ip);
  const a = attempts.get(k);
  const now = Date.now();
  if (!a || a.resetAt <= now) return { allowed: true, retryAfterSec: 0 };
  if (a.n >= LOGIN_MAX) return { allowed: false, retryAfterSec: Math.ceil((a.resetAt - now) / 1000) };
  return { allowed: true, retryAfterSec: 0 };
}

export function recordLoginResult(ip: string | null, ok: boolean): void {
  const k = ipHash(ip);
  const now = Date.now();
  if (ok) {
    attempts.delete(k);
    return;
  }
  const a = attempts.get(k);
  if (!a || a.resetAt <= now) attempts.set(k, { n: 1, resetAt: now + LOGIN_WINDOW_MS });
  else a.n += 1;
}

export function audit(event: string, detail: Record<string, unknown>): void {
  // מטא-בלבד: אין-סיסמאות, אין-טוקנים, אין-תוכן-גולמי.
  try {
    if (!ensureStateDir()) return;
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...detail }) + "\n";
    appendFileSync(path.join(stateDir(), "audit.log"), line, { mode: 0o600 });
  } catch {}
}
