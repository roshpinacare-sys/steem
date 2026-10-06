#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// FULL-REVIVE — פרוטוקול ההחייאה המלא בפקודה אחת (R128 · ממצא 2-d).
//
// עד עכשיו ההחייאה אחרי מוות-סנדבוקס הייתה רב-שלבית ידנית (r114/r116/
// r126: fetch → reset → install → db:push → כספת → dev-revive →
// daemons-revive → sovereignty/sync) — מועדת-לטעויות בדיוק ברגע
// שבו המערכת הכי פגיעה. הסקריפט הזה הוא אותו פרוטוקול בדיוק, מתועד
// ואידמפוטנטי לחלוטין — אפשר להריץ על צי חי בלי להורג כלום:
//
//   1. git fetch origin main
//   2. git reset --hard origin/main — רק אם העץ מפגר/מלוכלך; מה שנזרק
//      מדווח בכנות לפני האיפוס (קומיטים מקומיים קדימה + שינויים
//      עקובים). untracked לא נפגעים לעולם — אין git clean.
//   3. bun install
//   4. bun run db:push (סכימה מעודכנת)
//   5. שחזור כספת-הארנק — db/wallet-vault.db בדיוק 4,046,848 בייטים
//      מ-Saosmartwallet/db/custom.db בענן (חוק r116). PAT מ-upload/pat.env,
//      נסיגה לטוקן שב-remote origin — אף סוד לא מודפס לעולם.
//   6. bun scripts/dev-revive.mjs (חוק Bun.spawn — שורד את הסשן)
//   7. bun scripts/daemons-revive.mjs (כל הדיבונים, אידמפוטנטי)
//   8. POST /api/weave/sovereignty/sync (הספר מהריפו אל ה-DB)
//   9. דוח אמת סופי — כל צעד PASS/FAIL/SKIP + פרטים.
//      קוד-יציאה 0 רק אם הצי שלם (שרת + כל הדיבונים מהגדרת הצי) ואף
//      צעד לא נכשל.
//
// אזהרת-כנות: reset --hard מחליף קבצים עקובים תחת רגלי תהליכים חיים
// (ה-dev והדיבונים ב--hot ייטענו מחדש מעצמם) — זהו הפרוטוקל המתועד.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

const HOME = "/home/z/my-project";
const VAULT_PATH = `${HOME}/db/wallet-vault.db`;
const VAULT_EXPECTED_BYTES = 4_046_848; // חוק r116 — הגודל המדויק של הכספת מהענן
const VAULT_SOURCE = "roshpinacare-sys/Saosmartwallet/contents/db/custom.db";
const WEB_PORT = 3000;

/** הצי נקרא מהגדרת-האמת של daemons-revive.mjs — מקור-יחיד, אין שכפול
 *  שמתיישן (שיעור r119: מספר ב-JSX/קוד חייב להיגזר, לא להיכתב ידנית).
 *  r128: דיבון האוצרות (curation :3040) נוסף לצי ע"י סוכן מקביל — גם
 *  הוא נבדק אוטומטית. נפילת-פרסור → נפילה-כנה לרשימת-הברזל ההיסטורית. */
function fleetFromReviveScript() {
  const fallback = [
    { name: "pulse", port: 3033 }, { name: "money", port: 3034 }, { name: "hunter", port: 3035 },
    { name: "keeper", port: 3036 }, { name: "student", port: 3037 }, { name: "fleet-verify", port: 3038 },
    { name: "weblift", port: 3039 },
  ];
  try {
    const src = fs.readFileSync(`${HOME}/scripts/daemons-revive.mjs`, "utf8");
    const fleet = [...src.matchAll(/\{\s*name:\s*"([^"]+)",\s*port:\s*(\d+)/g)]
      .map((m) => ({ name: m[1], port: Number(m[2]) }))
      .filter((d) => Number.isFinite(d.port) && d.port > 0);
    if (fleet.length >= fallback.length) return fleet;
    return fallback;
  } catch {
    return fallback;
  }
}

// ── דוח הצעדים ────────────────────────────────────────────────────
const steps = [];

function report(name, verdict, detail) {
  steps.push({ name, verdict, detail });
  const mark = verdict === "PASS" ? "✓" : verdict === "SKIP" ? "◦" : "✗";
  console.log(`  ${mark} [${verdict}] ${name} — ${detail}`);
}

/** הרצת פקודה עד סיומה — פלט נקלט לדוח (שום דבר לא מודפס גולמי אם ארוך) */
async function run(cmd, timeoutMs = 300_000) {
  const proc = Bun.spawn({ cmd, cwd: HOME, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => {
    try { proc.kill(); } catch {}
  }, timeoutMs);
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, out: (out + "\n" + err).trim() };
}

function firstLines(text, n) {
  // r136 · חוסן: הפונקציה מקבלת מחרוזת או מערך-שורות (הדיווח לעולם לא מפיל את הפרוטוקול)
  const lines = (Array.isArray(text) ? text : String(text ?? "").split("\n")).filter((l) => String(l).trim());
  if (lines.length <= n) return lines;
  return [...lines.slice(0, n), `…+${lines.length - n} שורות נוספות`];
}

async function httpOk(port, timeoutMs = 4000, path = "/api/health") {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: ctl.signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** טוקן גיטהאב לקריאת הכספת — מקורות מועדפים; אף פעם לא מודפס */
function vaultTokens() {
  const sources = [];
  try {
    const t = fs.readFileSync(`${HOME}/upload/pat.env`, "utf8").trim();
    if (t.length > 20) sources.push({ label: "upload/pat.env", token: t });
  } catch {}
  return sources;
}

/** טוקן מה-remote origin (מוטמע בכתובת) — רואה את כל ריפואי הארגון (מדידה חיה 2-c) */
function remoteUrlToken() {
  const r = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: HOME, stdout: "pipe", stderr: "pipe" });
  const url = r.stdout?.toString().trim() ?? "";
  const m = /https:\/\/([^@\/:]+)@github\.com/.exec(url) || /:\/\/([^@\/:]+):[^@\/]*@github\.com/.exec(url);
  return m ? { label: "remote origin (embedded)", token: m[1] } : null;
}

async function main() {
  console.log("── FULL-REVIVE · פרוטוקול ההחייאה המלא ──");
  const t0 = Date.now();

  // ── צעד 1: git fetch origin main ────────────────────────────────
  console.log("[1/8] git fetch origin main");
  const fetchRes = await run(["git", "fetch", "origin", "main"], 120_000);
  const fetchOk = fetchRes.code === 0;
  if (fetchOk) {
    report("git-fetch", "PASS", "origin/main נמשך");
  } else {
    report("git-fetch", "FAIL", `קוד ${fetchRes.code}: ${firstLines(fetchRes.out, 2).join(" · ").slice(0, 160)}`);
  }

  // ── צעד 2: reset --hard origin/main — רק אם מפגר/מלוכלך ─────────
  console.log("[2/8] סנכרון העץ מול origin/main");
  if (!fetchOk) {
    report("git-reset", "SKIP", "fetch נכשל — איפוס מול רפרנס ישן מסוכן; העץ המקומי נשאר כמו שהוא");
  } else {
    const head = (await run(["git", "rev-parse", "HEAD"])).out;
    const origin = (await run(["git", "rev-parse", "origin/main"])).out;
    const status = (await run(["git", "status", "--porcelain"])).out;
    const dirty = status.length > 0;
    const inSync = head === origin;
    if (inSync && !dirty) {
      report("git-reset", "SKIP", `העץ מסונכרן ונקי (HEAD ${head.slice(0, 10)}) — לא נוגעים`);
    } else {
      // דוח-אמת לפני האיפוס: מה בדיוק נזרק
      const counts = (await run(["git", "rev-list", "--left-right", "--count", "origin/main...HEAD"])).out;
      const [behind, ahead] = counts.split(/\s+/).map((x) => Number(x) || 0);
      const droppedCommits = ahead > 0
        ? firstLines((await run(["git", "log", "--oneline", "-15", "origin/main..HEAD"])).out, 15)
        : [];
      const statusLines = status.split("\n").filter((l) => l.trim());
      const tracked = statusLines.filter((l) => !l.startsWith("??"));
      const untracked = statusLines.length - tracked.length;
      const resetRes = await run(["git", "reset", "--hard", "origin/main"], 120_000);
      if (resetRes.code === 0) {
        const parts = [`אופס ל-origin/main (${origin.slice(0, 10)}); מפגר ${behind} · קדימה ${ahead}`];
        if (droppedCommits.length) parts.push(`קומיטים מקומיים שנזרקו: ${droppedCommits.join(" | ").slice(0, 300)}`);
        if (tracked.length) parts.push(`שינויים עקובים שנדרסו (${tracked.length}): ${firstLines(tracked.join(" · "), 8).join(" · ").slice(0, 300)}`);
        if (untracked > 0) parts.push(`${untracked} קבצים untracked — לא נפגעו (אין git clean)`);
        report("git-reset", "PASS", parts.join(" · "));
      } else {
        report("git-reset", "FAIL", `קוד ${resetRes.code}: ${firstLines(resetRes.out, 2).join(" · ").slice(0, 160)}`);
      }
    }
  }

  // ── צעד 3: bun install ──────────────────────────────────────────
  console.log("[3/8] bun install");
  const inst = await run(["bun", "install"], 300_000);
  report("bun-install", inst.code === 0 ? "PASS" : "FAIL",
    inst.code === 0 ? `תלויות תקינות (${firstLines(inst.out, 2).join(" · ").slice(0, 120) || "שום שינוי"})`
      : `קוד ${inst.code}: ${firstLines(inst.out, 3).join(" · ").slice(0, 200)}`);

  // ── צעד 4: bun run db:push ──────────────────────────────────────
  console.log("[4/8] bun run db:push");
  const dbp = await run(["bun", "run", "db:push"], 300_000);
  report("db-push", dbp.code === 0 ? "PASS" : "FAIL",
    dbp.code === 0 ? `הסכימה הונעה (${firstLines(dbp.out, 2).join(" · ").slice(0, 120) || "ללא שינוי"})`
      : `קוד ${dbp.code}: ${firstLines(dbp.out, 3).join(" · ").slice(0, 200)}`);

  // ── צעד 5: שחזור כספת-הארנק ─────────────────────────────────────
  console.log("[5/8] שחזור כספת-הארנק (wallet-vault)");
  try {
    const st = fs.existsSync(VAULT_PATH) ? fs.statSync(VAULT_PATH) : null;
    if (st && st.size === VAULT_EXPECTED_BYTES) {
      report("wallet-vault", "PASS", `כבר קיים בגודל המדויק ${VAULT_EXPECTED_BYTES.toLocaleString("en-US")} בייטים — לא נוגעים`);
    } else {
      if (st) {
        console.log(`  ⚠ הכספת המקומית ${st.size.toLocaleString("en-US")} בייטים (לא ${VAULT_EXPECTED_BYTES.toLocaleString("en-US")}) — משחזר מהענן`);
      }
      const sources = vaultTokens();
      const remoteTok = remoteUrlToken();
      if (remoteTok) sources.push(remoteTok);
      let bytes = null;
      let usedLabel = null;
      let lastErr = "";
      for (const src of sources) {
        try {
          const res = await fetch(`https://api.github.com/repos/${VAULT_SOURCE}`, {
            headers: {
              Authorization: `token ${src.token}`,
              Accept: "application/vnd.github.raw",
              "User-Agent": "full-revive",
            },
            signal: AbortSignal.timeout(120_000),
          });
          if (res.ok) {
            bytes = new Uint8Array(await res.arrayBuffer());
            usedLabel = src.label;
            break;
          }
          lastErr = `http ${res.status}`;
        } catch (e) {
          lastErr = String(e?.message ?? e).slice(0, 80);
        }
      }
      if (!bytes) {
        report("wallet-vault", "FAIL", `הורדה מהענן נכשלה מכל המקורות (${sources.map((s) => s.label).join(", ") || "אין מקורות"}; אחרון: ${lastErr}) — הכספת לא שוחזרה`);
      } else if (bytes.byteLength !== VAULT_EXPECTED_BYTES) {
        report("wallet-vault", "FAIL", `גודל שהתקבל ${bytes.byteLength.toLocaleString("en-US")} בייטים ≠ ${VAULT_EXPECTED_BYTES.toLocaleString("en-US")} המצופה (מקור: ${usedLabel}) — לא נכתב, הכספת בענן השתנתה?`);
      } else {
        const magic = Buffer.from(bytes.slice(0, 15)).toString("utf8");
        if (magic !== "SQLite format 3") {
          report("wallet-vault", "FAIL", `התוכן שהתקבל אינו SQLite (magic "${magic.slice(0, 8)}…") — לא נכתב בכנות`);
        } else {
          fs.mkdirSync(`${HOME}/db`, { recursive: true });
          const tmp = `${VAULT_PATH}.tmp-restore`;
          fs.writeFileSync(tmp, bytes); // כתיבה אטומית — רגע-מוות לא ישאיר כספת חצויה
          fs.renameSync(tmp, VAULT_PATH);
          report("wallet-vault", "PASS", `שוחזר מהענן (מקור ${usedLabel}): ${VAULT_EXPECTED_BYTES.toLocaleString("en-US")} בייטים בדיוק · SQLite תקין`);
        }
      }
    }
  } catch (e) {
    report("wallet-vault", "FAIL", `חריגה: ${String(e?.message ?? e).slice(0, 140)}`);
  }

  // ── צעד 6: dev-revive (שרת הרשת) ───────────────────────────────
  console.log("[6/8] dev-revive (שרת הרשת :3000)");
  const dev = await run([process.execPath, "scripts/dev-revive.mjs"], 120_000);
  report("dev-revive", dev.code === 0 ? "PASS" : "FAIL",
    dev.code === 0 ? `שרת הרשת חי (${firstLines(dev.out, 2).join(" · ").slice(0, 140)})`
      : `קוד ${dev.code}: ${firstLines(dev.out, 3).join(" · ").slice(0, 200)}`);

  // ── צעד 7: daemons-revive (הדיבונים — כולם מהגדרת הצי) ───────────────────────
  console.log("[7/8] daemons-revive (הצי)");
  const dae = await run([process.execPath, "scripts/daemons-revive.mjs"], 180_000);
  report("daemons-revive", dae.code === 0 ? "PASS" : "FAIL",
    dae.code === 0 ? `הצי הוקם (${firstLines(dae.out.split("\n").filter((l) => l.includes("✓") || l.includes("──")), 3).join(" · ").slice(0, 160)})`
      : `קוד ${dae.code}: ${firstLines(dae.out, 4).join(" · ").slice(0, 240)}`);

  // ── צעד 8: sovereignty/sync (הספר מהריפו) ────────────────────────
  console.log("[8/8] POST /api/weave/sovereignty/sync");
  let syncOk = false;
  let syncDetail = "";
  try {
    const res = await fetch(`http://127.0.0.1:${WEB_PORT}/api/weave/sovereignty/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(300_000),
      cache: "no-store",
    });
    const j = await res.json().catch(() => ({}));
    syncOk = res.ok && j?.ok === true;
    syncDetail = syncOk
      ? `ספר מסונכרן (synced=${j.synced ?? "?"} · ${j.verify?.sigOk != null ? `חתימות ${j.verify.sigOk}` : "אימות הוחזר"} · ראש ${String(j.remote?.headHash ?? "?").slice(0, 10)}…)`
      : `http ${res.status}: ${String(j?.error ?? "ללא גוף").slice(0, 140)}`;
  } catch (e) {
    syncDetail = `לא נענה: ${String(e?.message ?? e).slice(0, 140)}`;
  }
  report("sovereignty-sync", syncOk ? "PASS" : "FAIL", syncDetail);

  // ── בדיקת-צי סופית: כל הדלתות עונות ───────────────────────────────
  console.log("── בדיקת צי סופית ──");
  const fleet = fleetFromReviveScript();
  let fleetUp = true;
  const webUp = await httpOk(WEB_PORT, 6000);
  if (!webUp) fleetUp = false;
  console.log(`  ${webUp ? "✓" : "✗"} שרת-הרשת (:${WEB_PORT}) ${webUp ? "UP" : "DOWN"}`);
  for (const d of fleet) {
    // זמן-עלייה ניתן לדיבונים שזה עתה הוקמו — ניסיון חוזר קצר לפני הכרעה
    let up = false;
    for (let tryN = 0; tryN < 3 && !up; tryN++) {
      up = await httpOk(d.port, 2500, "/");
      if (!up) await new Promise((r) => setTimeout(r, 3000));
    }
    if (!up) fleetUp = false;
    console.log(`  ${up ? "✓" : "✗"} ${d.name} (:${d.port}) ${up ? "UP" : "DOWN"}`);
  }

  // ── דוח-אמת סופי ─────────────────────────────────────────────────
  const fails = steps.filter((s) => s.verdict === "FAIL").length;
  const passes = steps.filter((s) => s.verdict === "PASS").length;
  const skips = steps.filter((s) => s.verdict === "SKIP").length;
  console.log("── דוח סופי ──");
  for (const s of steps) console.log(`  [${s.verdict}] ${s.name}: ${s.detail.slice(0, 220)}`);
  const verdict = fleetUp && fails === 0
    ? `ההחייאה שלמה — הצי עלה (${passes} PASS · ${skips} SKIP · ${fails} FAIL · ${((Date.now() - t0) / 1000).toFixed(1)}ש')`
    : `ההחייאה חלקית — צי ${fleetUp ? "עלה" : "לא שלם"}, צעדים כושלים: ${fails} (ראה למעלה בכנות)`;
  console.log(`── ${verdict} ──`);

  // קבלה ליומן השומר — ההיסטוריה של ההחייאות נשמרת לצד שאר הקבלות
  try {
    const logDir = `${HOME}/sovereign/keeper/logs`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(`${logDir}/full-revive.log`, [
      `\n── ${new Date().toISOString()} ──`,
      ...steps.map((s) => `[${s.verdict}] ${s.name}: ${s.detail}`),
      verdict,
      "",
    ].join("\n"));
  } catch { /* היומן אינו קריטי להחייאה */ }

  process.exit(fleetUp && fails === 0 ? 0 : 1);
}

await main();
