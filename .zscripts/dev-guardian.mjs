// ─────────────────────────────────────────────────────────────────────
// DEV-GUARDIAN · שומר-סף של תא-הפיקוד (R221)
//
// רקע נמדד: הפלטפורמה מוחקת את next-server (ה-worker) שוב-ושוב בלי
// רישום בלוג ובלי OOM — מפעיל-האתחול של הסנדבוקס מקים את השרת פעם-אחת
// ב-boot בלבד, ואחר-כך העץ נשאר חשוף. ה-guardian הזה מקיים את חוק
// הריפוי-העצמי של האורגניזם עבור תא-הפיקוד עצמו: בדיקת-בריאות תקופתית
// מול :3000, והקמה-מחדש (detached, unref'd) כשהשרת נופל.
//
// חוקי-ברזל:
//   · מופע-יחיד: pidfile + kill(pid,0) — מופע-שני יוצא-נקי (חוק T-15).
//   · אף-רצח: ה-guardian לעולם לא הורג תהליכים — רק מקים כשבריאות=שקר.
//   · יומן-כנות: כל-הקמה נרשמת עם סיבה ו-pid, אפס-טענות.
// ─────────────────────────────────────────────────────────────────────
import { spawn } from "node:child_process";
import fs from "node:fs";

const ROOT = "/home/z/my-project";
const LOG = `${ROOT}/.zscripts/dev-guardian.log`;
const PIDFILE = `${ROOT}/.zscripts/dev-guardian.pid`;

function log(msg) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch {}
}

// ── מופע-יחיד ──
try {
  const prev = fs.readFileSync(PIDFILE, "utf8").trim();
  if (prev) {
    try { process.kill(Number(prev), 0); console.log(`guardian ${prev} already alive — exit (single-instance law)`); process.exit(0); }
    catch { log(`stale pidfile ${prev} — adopting`); }
  }
} catch { /* no pidfile — first run */ }
fs.writeFileSync(PIDFILE, String(process.pid));

async function healthy() {
  try {
    const r = await fetch("http://127.0.0.1:3000/api/saos/status", { signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
}

log(`guardian up pid=${process.pid}`);
let respawns = 0;

while (true) {
  const ok = await healthy();
  if (!ok) {
    respawns++;
    const out = fs.openSync(`${ROOT}/dev.log`, "a");
    const err = fs.openSync(`${ROOT}/dev-guardian.err.log`, "a");
    const child = spawn("bash", ["-c", "cd /home/z/my-project && exec bun run dev"], { detached: true, stdio: ["ignore", out, err] });
    child.unref();
    log(`respawn #${respawns} pid=${child.pid} (health failed)`);
    fs.writeFileSync(`${ROOT}/.zscripts/dev.pid`, String(child.pid));
    // השרת צריך זמן לקום — המתנה ארוכה לפני הבדיקה הבאה
    await new Promise((r) => setTimeout(r, 30000));
  }
  await new Promise((r) => setTimeout(r, 12000));
}
