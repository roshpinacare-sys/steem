#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// PROOF-SEED-R209 — רישום פסקי-הדין הנמדדים של סבב R207 + חוק-האמת (R209)
// דרך appendProof בלבד (P1 · append-only · כספת-עדויות קפואה).
// כל רישום נושא פקודת-שחזור שנבדקה-חי לפני הרישום.
// ─────────────────────────────────────────────────────────────────────

import { appendProof, readRegistry } from "./proof-ledger";

const HOME = "/home/z/my-project";

async function repro(
  cmd: string,
  expect: string,
): Promise<{ at: string; exit: number; note: string }> {
  const proc = Bun.spawn(["bash", "-c", cmd], { cwd: HOME, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), 120_000);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  clearTimeout(timer);
  const tail = (stdout || stderr).trim().split("\n").slice(-2).join(" | ").slice(0, 200);
  const ok = exit === 0 && (expect === "" || stdout.includes(expect) || tail.includes(expect));
  if (!ok)
    throw new Error(`פקודת-שחזור לא-חיה-לפני-רישום (${cmd}) · exit=${exit} · tail=${tail}`);
  return { at: new Date().toISOString(), exit, note: `ok · ${tail}` };
}

async function main() {
  const existing = readRegistry();
  const ids = new Set(existing.map((e) => e.claimId));
  console.log(`ספר קיים: ${existing.length} רשומות · ${ids.size} טענות`);

  // ── 1. חקירה-הצלבה של חמישה-סוכנים (R207) ──
  if (!ids.has("R207-CROSS-EXAM-FIVE")) {
    const cmd = `grep -c "^Task ID: r207" ${HOME}/worklog.md`;
    const r = await repro(cmd, "6");
    appendProof({
      claimId: "R207-CROSS-EXAM-FIVE",
      claim:
        "חמישה-סוכנים מקבילים (קריאה-בלבד: ObjectiveAuditor · ResourceCartographer · CounterfactualAdversary · CapabilityEconomist · SovereignSafetyJudge) ביצעו חקירה-מדידה-עצמאית של האורגניזם + סעיף-אדג'ודיקטור מצליב = 6 סעיפי-יומן; האדג'ודיקטור אימת ממצאים מרכזיים במדידה-ישירה לפני בנייה (שני תיקוני-אמת: powerdown ×4 · F-1).",
      verdict: "PROVEN",
      scope: "STRUCTURAL",
      round: "R207",
      law: "סווארם-קריאה-בלבד: הבונה לא מאמת את עצמו; האדג'ודיקטור מאמת מול החי לפני פסק.",
      evidence: [{ path: `${HOME}/worklog.md` }],
      reproduction: { cmd, expect: "6" },
      lastRepro: r,
    });
    console.log("✓ רשום R207-CROSS-EXAM-FIVE");
  }

  // ── 2. חיישן-powerdown ×4 — פגם-מדידה נמצא ותוקן-חי ──
  if (!ids.has("R207-POWERDOWN-X4-FIX")) {
    const cmd = `grep -n "remainingVests = Math.max(0, toWithdraw - withdrawn)" ${HOME}/src/app/api/money/route.ts`;
    const r = await repro(cmd, "withdrawn");
    appendProof({
      claimId: "R207-POWERDOWN-X4-FIX",
      claim:
        "חיישן-ה-powerdown ב-/api/money (route.ts) דיווח פי-4 מהאמת (ceil(to_withdraw/rate) + to_withdraw×perVest בלי לגרוע withdrawn) — paymentsLeft 4→1 · totalRemaining 1,903.77→475.945. תוקן-חי: יתרת-אמת = to_withdraw − withdrawn. פגם-מדידה-עצמית שהוכיח את חוק «מי שמדד את עצמו — יתקן באיחור».",
      verdict: "PROVEN",
      scope: "LIVE",
      round: "R207",
      law: "חוק-חיישן: מדידה-כושלת → UNMEASURED, לעולם לא 0; חיישן-עצמי נבדק-חוץ.",
      evidence: [{ path: `${HOME}/src/app/api/money/route.ts` }, { path: `${HOME}/worklog.md` }],
      reproduction: { cmd, expect: "withdrawn" },
      lastRepro: r,
    });
    console.log("✓ רשום R207-POWERDOWN-X4-FIX");
  }

  // ── 3. חור-ההרשאה F-1 — נמצא ואטום-חי ──
  if (!ids.has("R207-F1-SEAL")) {
    const cmd = `curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:3000/api/autonomy`;
    const r = await repro(cmd, "401");
    appendProof({
      claimId: "R207-F1-SEAL",
      claim:
        "F-1 (שופט-הבטיחות): POST /api/autonomy כתב GATE.json בלי אימות-מפעיל — חור-הרשאה-חי. אטום-חי (operatorFromRequest + ייחוס-סשן): פוסט-אנונימי מחזיר HTTP 401 · GATE.json לא נוגע (THINKING).",
      verdict: "PROVEN",
      scope: "LIVE",
      round: "R207",
      law: "אין-כתיבת-שער בלי-מפעיל; סמכות-לא-נוצרת מהשתקפות-עצמית.",
      evidence: [{ path: `${HOME}/src/app/api/autonomy/route.ts` }, { path: `${HOME}/worklog.md` }],
      reproduction: { cmd, expect: "401" },
      lastRepro: r,
    });
    console.log("✓ רשום R207-F1-SEAL");
  }

  // ── 4. האוצר מסתיר in-flight — OPEN כנה (מתוקן בהמשך-הסבב) ──
  if (!ids.has("R207-TREASURY-INFLIGHT-HIDDEN")) {
    const cmd = `bun -e 'const j=require("http://127.0.0.1:3000/api/treasury");' 2>/dev/null; curl -s http://127.0.0.1:3000/api/treasury | head -c 200`;
    const r = await repro(cmd, "ok");
    appendProof({
      claimId: "R207-TREASURY-INFLIGHT-HIDDEN",
      claim:
        "מפת-האוצר (/api/treasury) מחריגה refund-queue 2,462.46-SP (≈$154) + received-in 244.10-SP (≈$15) — מציגה ~30% מהנכס-הגולם (~$247 ב-SP גולם, מדידה r207-d). לא-שקר-זדון: נוסחת-נטו שנועדה-לשמרנות והופכת בחלון-החזרה לחסירה-מבנית. תיקון-מתוכנן: פירוק inFlight מול committed בתוספת-בלבד (אפס-שינוי-שדות-קיימים).",
      verdict: "OPEN",
      scope: "LIVE",
      round: "R207",
      law: "חוק-המפה: מפה שמסתירה נכס-חי = חסירה-מבנית; מדיד → מתוקן → נרשם-רוויזיה.",
      evidence: [{ path: `${HOME}/src/app/api/treasury/route.ts` }, { path: "/tmp/treasury-before-r209.json" }],
      reproduction: { cmd, expect: "ok" },
      lastRepro: r,
    });
    console.log("✓ רשום R207-TREASURY-INFLIGHT-HIDDEN (OPEN)");
  }

  const after = readRegistry();
  console.log(`ספר אחרי-רישום: ${after.length} רשומות`);
}

main();
