// sanbox/operator-site/index.ts — שער-המפעיל (סיסמה) + לוח-בקרה + API-סוכנים
// חוקים: אפס-סודות-בתשובות · loopback בלבד · fail-closed · אפס-תלות-חוץ
// פורט: 3046 (דרך-השער: /operator?XTransformPort=3046)
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const SB = path.resolve(import.meta.dir, "..");            // sanbox/
const ROOT = path.resolve(SB, "..");                       // שורש-הריפו
const STATE = path.join(SB, "state");
const PORT = Number(process.env.PORT ?? 3046);
const HOST = process.env.HOST ?? "127.0.0.1";
const SETUP_WINDOW_MS = Number(process.env.SETUP_WINDOW_MIN ?? 20) * 60_000;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_H ?? 12) * 3_600_000;
const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_MAX = 5;
const BOOT_TS = Date.now();

const CREDS = path.join(STATE, "credentials.json");
const TOKEN_FILE = path.join(STATE, "agent-token");
const AUDIT = path.join(STATE, "audit.log");
mkdirSync(STATE, { recursive: true });

// ── agent-token (192-bit, git-ignored, לעולם לא מוחזר ברשת) ──
if (!existsSync(TOKEN_FILE)) {
  writeFileSync(TOKEN_FILE, randomBytes(24).toString("hex") + "\n", { mode: 0o600 });
} else {
  try { chmodSync(TOKEN_FILE, 0o600); } catch {}
}
function agentToken(): string {
  try { return readFileSync(TOKEN_FILE, "utf8").trim(); } catch { return ""; }
}

// ── credentials (hash scrypt בלבד) ──
type Creds = { version: number; scrypt: { N: number; r: number; p: number; keylen: number }; salt: string; hash: string; createdAt: string };
function loadCreds(): Creds | null {
  try { return JSON.parse(readFileSync(CREDS, "utf8")) as Creds; } catch { return null; }
}
function verifyPassword(pw: string): boolean {
  const c = loadCreds();
  if (!c || typeof pw !== "string" || pw.length === 0) return false;
  try {
    const { N, r, p, keylen } = c.scrypt;
    const calc = scryptSync(pw, Buffer.from(c.salt, "hex"), keylen, { N, r, p });
    return timingSafeEqual(calc, Buffer.from(c.hash, "hex"));
  } catch { return false; }
}
function savePassword(pw: string): boolean {
  try {
    const salt = randomBytes(16);
    const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
    const out: Creds = {
      version: 1,
      scrypt: { N: 16384, r: 8, p: 1, keylen: 64 },
      salt: salt.toString("hex"),
      hash: hash.toString("hex"),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(CREDS, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
    return true;
  } catch { return false; }
}

// ── sessions + rate-limit + audit ──
const sessions = new Map<string, number>();
function newSession(): string {
  const t = randomBytes(24).toString("hex");
  sessions.set(t, Date.now() + SESSION_TTL_MS);
  return t;
}
function sessionOk(t: string | null | undefined): boolean {
  if (!t) return false;
  const exp = sessions.get(t);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(t); return false; }
  return true;
}
const attempts = new Map<string, number[]>();
function prune(arr: number[]): number[] {
  const now = Date.now();
  return arr.filter(t => now - t < LOGIN_WINDOW_MS);
}
function limited(ip: string): boolean {
  const arr = prune(attempts.get(ip) ?? []);
  attempts.set(ip, arr);
  return arr.length >= LOGIN_MAX;
}
function noteAttempt(ip: string): void {
  const arr = prune(attempts.get(ip) ?? []);
  arr.push(Date.now());
  attempts.set(ip, arr);
}
function audit(event: string, ip: string, ok: boolean, detail = ""): void {
  try {
    appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), event, ip, ok, detail }) + "\n");
  } catch {}
}

// ── MANIFEST + בריאות-צי ──
type Comp = { id: string; kind: string; cwd?: string; cmd?: string; port: number; health: string; critical?: boolean };
function manifest(): { components: Comp[] } {
  try { return JSON.parse(readFileSync(path.join(SB, "MANIFEST.json"), "utf8")) as { components: Comp[] }; }
  catch { return { components: [] }; }
}
async function alive(port: number, health: string): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${health}`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}
async function fleetStatus(): Promise<Array<{ id: string; port: number; alive: boolean }>> {
  const out: Array<{ id: string; port: number; alive: boolean }> = [];
  for (const c of manifest().components) {
    out.push({ id: c.id, port: c.port, alive: await alive(c.port, c.health) });
  }
  return out;
}
function gitInfo(): { branch: string; head: string; behind: string; ahead: string } {
  // spawnSync כאן בטוח: קריאות-git קצרות ואינן קוראות לשרת-זה עצמו
  const g = (args: string[]): string | null => {
    const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 8000 });
    return r.status === 0 ? (r.stdout ?? "").trim() : null;
  };
  const branch = g(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "?";
  const head = (g(["rev-parse", "HEAD"]) ?? "?").slice(0, 12);
  const counts = g(["rev-list", "--left-right", "--count", "origin/saos-cockpit...HEAD"]);
  let behind = "?", ahead = "?";
  if (counts) { const parts = counts.split(/\s+/); behind = parts[0] ?? "?"; ahead = parts[1] ?? "?"; }
  return { branch, head, behind, ahead };
}
function runtimeJson(file: string): unknown {
  try { return JSON.parse(readFileSync(path.join(STATE, file), "utf8")); } catch { return null; }
}

// ── פעולות-ריצה (whitelist סגור — אין eval, אין קלט-משתמש ב-shell) ──
const ACTIONS: Record<string, { file: string; timeout: number }> = {
  bootstrap: { file: path.join(SB, "bootstrap.sh"), timeout: 240_000 },
  verify: { file: path.join(SB, "verify.sh"), timeout: 240_000 },
  push: { file: path.join(ROOT, "scripts", "sovereign-push.sh"), timeout: 120_000 },
};
function runAction(action: string): Promise<{ exit: number; tail: string }> {
  const a = ACTIONS[action];
  if (!a || !existsSync(a.file)) return Promise.resolve({ exit: -1, tail: "פעולה לא מוכרת" });
  // חובה spawn אסינכרוני: הסקריפטים קוראים חזרה לשרת-זה (health/status) —
  // spawnSync היה חוסם את לולאת-האירועים ויוצר self-deadlock (מדוד 2026-10-09)
  return new Promise((resolve) => {
    try {
      const child = spawn("bash", [a.file], { cwd: ROOT, timeout: a.timeout });
      let out = "";
      const add = (d: Buffer) => { if (out.length < 200_000) out += d.toString(); };
      child.stdout?.on("data", add);
      child.stderr?.on("data", add);
      child.on("error", (e) => resolve({ exit: -1, tail: String(e) }));
      child.on("close", (code) => resolve({ exit: code ?? -1, tail: out.trim().slice(-6000) }));
    } catch (e) {
      resolve({ exit: -1, tail: String(e) });
    }
  });
}

// ── html helpers ──
const esc = (s: string) => s.replace(/[&<>"']/g, m => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m] as string));
function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...headers },
  });
}
function json(v: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
}
function redirect(loc: string, cookie?: string): Response {
  const h: Record<string, string> = { Location: loc };
  if (cookie) h["Set-Cookie"] = cookie;
  return new Response(null, { status: 303, headers: h });
}

const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin:0; font-family: system-ui, -apple-system, sans-serif; background:#111214; color:#e7e7ea; direction:rtl; }
.wrap { max-width: 880px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.sub { color:#9aa0a6; font-size:13px; margin-bottom:20px; }
.card { background:#1b1d21; border:1px solid #2a2d33; border-radius:12px; padding:16px; margin-bottom:16px; }
.row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
.pill { padding:3px 10px; border-radius:999px; font-size:12px; border:1px solid #2a2d33; }
.up { color:#7ee2a8; border-color:#2c5a3f; }
.down { color:#ff9b9b; border-color:#6b2f2f; }
input, button { font: inherit; }
input { background:#141518; color:#e7e7ea; border:1px solid #2a2d33; border-radius:8px; padding:9px 12px; min-width: 200px; }
button { background:#2f6f4f; border:0; color:#fff; border-radius:8px; padding:10px 16px; cursor:pointer; }
button.gray { background:#3a3d44; }
button:disabled { opacity:.5; cursor:default; }
pre { background:#141518; border:1px solid #2a2d33; border-radius:8px; padding:12px; overflow:auto; max-height:340px; font-size:12px; direction:ltr; text-align:left; white-space:pre-wrap; }
.muted { color:#9aa0a6; font-size:12px; }
`;

function page(title: string, body: string): string {
  return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>' + STYLE + '</style></head><body><div class="wrap">' + body + '</div></body></html>';
}

function loginPage(qsStr: string, msg = ""): string {
  let m = "";
  if (msg) m = '<div class="pill down" style="margin-bottom:10px">' + esc(msg) + '</div>';
  return page("כניסת-מפעיל", `
<h1>שער-המפעיל · sanbox</h1><div class="sub">הכל מאחורי-סיסמה. אין כאן מידע-ציבורי.</div>
<div class="card">
  ${m}
  <form method="post" action="/operator/login${esc(qsStr)}">
    <div class="row"><input type="password" name="password" placeholder="סיסמת-מפעיל" autocomplete="current-password" required autofocus><button type="submit">כניסה</button></div>
  </form>
</div>
<div class="muted">סוכנים: העבירו X-Op-Token בכותרת — או עבדו מקומית: sanbox/bootstrap.sh · sanbox/verify.sh</div>`);
}

function setupPage(qsStr: string, endsAt: number, msg = ""): string {
  const mins = Math.max(0, Math.round((endsAt - Date.now()) / 60000));
  let m = "";
  if (msg) m = '<div class="pill down" style="margin-bottom:10px">' + esc(msg) + '</div>';
  return page("אתחול-סיסמה", `
<h1>אתחול-ראשוני · sanbox</h1><div class="sub">אין עדיין סיסמה. קבעו סיסמת-מפעיל — החלון נסגר בעוד ${mins} דק'.</div>
<div class="card">
  ${m}
  <form method="post" action="/operator/setup${esc(qsStr)}">
    <div class="row">
      <input type="password" name="password" placeholder="סיסמה (מינימום 8)" required minlength="8" autocomplete="new-password">
      <input type="password" name="password2" placeholder="אימות-סיסמה" required minlength="8" autocomplete="new-password">
      <button type="submit">קביעה</button>
    </div>
  </form>
</div>
<div class="muted">נשמר hash scrypt בלבד (state/, git-ignored). אין שחזור — שכחתם? מחקו state/credentials.json והתחילו מחדש.</div>`);
}

function dashboardPage(): string {
  // הערה: ה-script הפנימי משתמש בשרשור-מחרוזות בלבד (אין template-literals) — בכוונה
  const script = `
const QS = window.location.search || "";
function el(id){ return document.getElementById(id); }
async function st(){
  try {
    const r = await fetch("/operator/status" + QS);
    if (r.status !== 200) { window.location = "/operator" + QS; return; }
    const j = await r.json();
    el("fleet").innerHTML = j.fleet.map(function(f){
      var cls = f.alive ? "up" : "down";
      var state = f.alive ? "חי" : "לא-מגיב";
      return '<span class="pill ' + cls + '">' + f.id + ' :' + f.port + ' ' + state + '</span>';
    }).join(" ");
    el("git").textContent = j.git.branch + " @ " + j.git.head + " · behind=" + j.git.behind + " ahead=" + j.git.ahead;
  } catch(e) {
    el("fleet").innerHTML = '<span class="pill down">status נכשל</span>';
  }
}
el("rf").onclick = st;
Array.prototype.forEach.call(document.querySelectorAll("button[data-a]"), function(b){
  b.onclick = async function(){
    b.disabled = true;
    el("out").style.display = "block";
    el("out").textContent = "מריץ " + b.getAttribute("data-a") + " …";
    try {
      const r = await fetch("/operator/run" + QS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: b.getAttribute("data-a") }) });
      const j = await r.json();
      el("out").textContent = "exit=" + j.exit + "\\n\\n" + (j.tail || "(אין-פלט)");
    } catch(e) { el("out").textContent = "שגיאה: " + e; }
    b.disabled = false;
    st();
  };
});
el("ra").onclick = async function(){
  const r = await fetch("/operator/audit" + QS);
  const j = await r.json();
  el("audit").style.display = "block";
  el("audit").textContent = (j.lines || []).join("\\n") || "(ריק)";
};
st();
`;
  return page("לוח-בקרה · sanbox", `
<h1>לוח-בקרה · sanbox</h1><div class="sub">מפעיל-הסנדבוקס המקיף — הכל ממקום-אחד, בלי טרמינל</div>
<div class="card"><div class="row"><strong>צי-השירותים</strong><button class="gray" id="rf" type="button">רענון</button></div><div id="fleet" class="row" style="margin-top:10px"><span class="muted">טוען…</span></div></div>
<div class="card"><div class="row"><strong>גיט</strong><span id="git" class="muted">…</span></div></div>
<div class="card"><strong>פעולות</strong>
  <div class="row" style="margin-top:10px">
    <button data-a="bootstrap" type="button">bootstrap (חייאה)</button>
    <button data-a="verify" type="button">verify (אימות)</button>
    <button class="gray" data-a="push" type="button">push (דחיפה-דרך-השער)</button>
  </div>
  <pre id="out" style="display:none"></pre>
</div>
<div class="card"><strong>יומן-ביקורת</strong> <button class="gray" id="ra" type="button">טען-יומן</button><pre id="audit" style="display:none"></pre></div>
<script>${script}</script>`);
}

// ── cookie / auth ──
function cookieOf(req: Request): string | undefined {
  const c = req.headers.get("cookie") ?? "";
  for (const part of c.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx).trim() === "sb_op") return part.slice(idx + 1).trim();
  }
  return undefined;
}
function sessionCookie(token: string): string {
  return `sb_op=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}
function ipOf(req: Request, server: unknown): string {
  const fwd = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  if (fwd) return fwd;
  try { return ((server as { requestIP?: (r: Request) => { address: string } | null }).requestIP?.(req)?.address) || "local"; }
  catch { return "local"; }
}
function authorized(req: Request): boolean {
  const tok = req.headers.get("x-op-token");
  if (tok && tok.length > 0 && tok === agentToken()) return true;
  return sessionOk(cookieOf(req));
}
function setupOpen(): boolean {
  return !loadCreds() && Date.now() - BOOT_TS < SETUP_WINDOW_MS;
}

// ── server ──
Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req, server) {
    const u = new URL(req.url);
    const ip = ipOf(req, server);
    const qsStr = u.search;
    const p = u.pathname.replace(/\/+$/, "") || "/";

    // ציבורי-מינימלי: בלי מידע (לא מגלה אם credentials קיימים)
    if (p === "/health") {
      return json({ ok: true, service: "sanbox-operator", ts: new Date().toISOString() });
    }

    if (p === "/operator") {
      if (!loadCreds() && Date.now() - BOOT_TS < SETUP_WINDOW_MS) {
        return html(setupPage(qsStr, BOOT_TS + SETUP_WINDOW_MS));
      }
      if (authorized(req)) return html(dashboardPage());
      return html(loginPage(qsStr));
    }

    if (p === "/operator/setup" && req.method === "POST") {
      if (loadCreds()) return redirect("/operator" + qsStr);
      if (Date.now() - BOOT_TS >= SETUP_WINDOW_MS) {
        audit("setup", ip, false, "window-closed");
        return html(page("חלון-נסגר", "<h1>חלון-האתחול נסגר</h1><div class='sub'>הריצו: OPERATOR_BOOTSTRAP_PASSWORD='…' bash sanbox/operator-site/auth/gen-hash.sh — או מחקו state/credentials.json (אם קיים) והפעילו מחדש.</div>"), 403);
      }
      if (limited(ip)) { audit("setup", ip, false, "rate-limited"); return html(loginPage(qsStr, "נסיונות-רבים — נסו מאוחר יותר"), 429); }
      noteAttempt(ip);
      const body = new URLSearchParams(await req.text());
      const pw = body.get("password") ?? "";
      const pw2 = body.get("password2") ?? "";
      if (pw.length < 8 || pw !== pw2) {
        audit("setup", ip, false, "invalid");
        return html(setupPage(qsStr, BOOT_TS + SETUP_WINDOW_MS, "סיסמה קצרה מדי או לא תואמת (מינימום 8)"), 400);
      }
      if (savePassword(pw)) {
        audit("setup", ip, true, "credentials-created");
        return redirect("/operator" + qsStr, sessionCookie(newSession()));
      }
      return html(setupPage(qsStr, BOOT_TS + SETUP_WINDOW_MS, "שמירה נכשלה"), 500);
    }

    if (p === "/operator/login" && req.method === "POST") {
      const tok = req.headers.get("x-op-token");
      const agentOk = !!(tok && tok.length > 0 && tok === agentToken());
      // rate-limit על נתיב-הסיסמה בלבד — token-סוכן הוא זהות-מכונה (מי שקורא את
      // קובץ-ה-token כבר חזק-מהשער) ואסור שייחסם בגלל ניסיונות-סיסמה של אחרים
      if (!agentOk) {
        if (limited(ip)) { audit("login", ip, false, "rate-limited"); return json({ error: "rate-limited" }, 429); }
        noteAttempt(ip);
      }
      let passwordOk = false;
      if (!agentOk) {
        try {
          const body = new URLSearchParams(await req.text());
          passwordOk = verifyPassword(body.get("password") ?? "");
        } catch { passwordOk = false; }
      }
      if (!agentOk && !passwordOk) {
        audit("login", ip, false, "bad-credentials");
        return json({ error: "unauthorized" }, 401);
      }
      const via = agentOk ? "agent-token" : "password";
      audit("login", ip, true, via);
      const cookie = sessionCookie(newSession());
      if (agentOk) return json({ ok: true, via }, 200, { "Set-Cookie": cookie });
      return redirect("/operator" + qsStr, cookie);
    }

    if (p === "/operator/status") {
      if (!authorized(req)) { audit("status", ip, false); return json({ error: "unauthorized" }, 401); }
      return json({
        now: new Date().toISOString(),
        credentialsSet: !!loadCreds(),
        setupWindow: { open: setupOpen(), endsAt: new Date(BOOT_TS + SETUP_WINDOW_MS).toISOString() },
        fleet: await fleetStatus(),
        git: gitInfo(),
        lastVerify: runtimeJson("last-verify.json"),
        lastBootstrap: runtimeJson("last-bootstrap.json"),
      });
    }

    if (p === "/operator/run" && req.method === "POST") {
      if (!authorized(req)) { audit("run", ip, false); return json({ error: "unauthorized" }, 401); }
      let action = "";
      try { action = ((await req.json()) as { action?: string }).action ?? ""; } catch { action = ""; }
      const res = await runAction(action);
      audit("run", ip, res.exit === 0, action);
      return json(res);
    }

    if (p === "/operator/audit") {
      if (!authorized(req)) return json({ error: "unauthorized" }, 401);
      try {
        const lines = readFileSync(AUDIT, "utf8").trim().split("\n").slice(-60);
        return json({ lines });
      } catch { return json({ lines: [] }); }
    }

    return json({ error: "not-found" }, 404);
  },
  error() { return json({ error: "internal" }, 500); },
});

console.log(
  `sanbox-operator: http://${HOST}:${PORT}/operator ` +
  `(setup ${Math.round(SETUP_WINDOW_MS / 60000)}min · sessions ${Math.round(SESSION_TTL_MS / 3600000)}h · agent-token: state/agent-token)`
);
