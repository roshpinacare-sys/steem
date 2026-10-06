#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// DEV-REVIVE — החזרת שרת הרשת לחיים בפקודה אחת (R100).
//
// לקח מדוד חי (שלוש קריסות בסשן זה): תהליכים שעולים מתוך בקשת
// bash רגילה (nohup/setsid/disown) נקצרים בסוף הבקשה. הדיבונים
// שורדים דווקא כן — כי daemons-revive משתמש ב-Bun.spawn המנתק
// את הילד לקבוצת-תהליך עצמאית. אותו חוק מוחל כאן על שרת הרשת.
//
// הסקריפט אידמפוטנטי לחלוטין:
//   · שרת שעונה על 3000 — לא נוגעים בו.
//   · פורט נעול בלי מענה — מנוקה ואז מוקם.
//   · שרת שמת — מוקם מחדש, יומן ל-sovereign/keeper/logs/dev-revive.log
//     (dev.log עצמו נכתב ע"י ה-pipeline הרגיל של ה-dev script).
// ─────────────────────────────────────────────────────────────────────

import net from "node:net";

const HOME = "/home/z/my-project";
const PORT = 3000;

function httpOk(port, timeoutMs = 4000, path = "/api/health") {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  return fetch(`http://127.0.0.1:${port}${path}`, {
    signal: ctl.signal,
    cache: "no-store",
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => clearTimeout(t));
}

function tcpAlive(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, "127.0.0.1");
  });
}

function pidsOnPort(port) {
  try {
    const out = Bun.spawnSync(["ss", "-tlnp", `sport = :${port}`], {
      stdout: "pipe",
      stderr: "pipe",
    }).stdout.toString();
    return [...new Set([...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))].filter(
      (p) => Number.isFinite(p) && p > 0,
    );
  } catch {
    return [];
  }
}

async function killPort(port) {
  const pids = pidsOnPort(port);
  if (pids.length === 0) return;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 1500));
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 500));
}

async function main() {
  console.log("── DEV-REVIVE · שרת הרשת ──");

  if (await httpOk(PORT)) {
    console.log(`  ✓ שרת הרשת (:${PORT}) כבר חי — לא נוגעים`);
    process.exit(0);
  }

  if (await tcpAlive(PORT)) {
    console.log(`  ⚠ פורט ${PORT} נעול בלי מענה — מנקה`);
    await killPort(PORT);
  }

  // הרמה מנותקת — לקח הקריסות: רק Bun.spawn שורד את סוף הבקשה.
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "dev"],
    cwd: HOME,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  console.log(`  ↑ bun run dev הוקם (pid ${proc.pid})`);

  // המתנה לעלייה — עד 60 שנ' (קומפילציה ראשונה יכולה לקחת זמן)
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    if (await httpOk(PORT, 3000)) {
      console.log(`  ✓ שרת הרשת (:${PORT}) חי`);
      process.exit(0);
    }
    if (proc.exitCode !== null) {
      console.log(`  ✗ התהליך מת בקוד ${proc.exitCode} — ראה dev.log`);
      process.exit(1);
    }
  }
  console.log("  ✗ פסק-זמן — השרת לא ענה תוך 60 שנ'");
  process.exit(1);
}

await main();
