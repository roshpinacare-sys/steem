#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// PROOF-ADJUDICATE-R209 — רישום פסקי-הדין של מחזור-הבכורה של צוות-ההנדסה
// (בונה r209-b + מפרך r209-f · הפרדת-רשויות) + חוק-האמת-העומד.
// אדג'ודיקטור בלבד · appendProof בלבד (P1) · כל פקודת-שחזור נבדקה-חי.
// ─────────────────────────────────────────────────────────────────────

import { appendProof, readRegistry } from "./proof-ledger";

const HOME = "/home/z/my-project";

async function repro(cmd: string, expect: string) {
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
  if (!ok) throw new Error(`שחזור-לא-חי (${cmd}) · exit=${exit} · tail=${tail}`);
  return { at: new Date().toISOString(), exit, note: `ok · ${tail}` };
}

async function main() {
  const ids = new Set(readRegistry().map((e) => e.claimId));

  // ── 1. רוויזיית-סגירה: החסירה-המבנית תוקנה והופרכה-שווא ──
  if (!ids.has("R209-TREASURY-INFLIGHT-FIX")) {
    const cmd = `curl -s http://127.0.0.1:3000/api/treasury`;
    const r = await repro(cmd, "refundQueueSp");
    appendProof({
      claimId: "R209-TREASURY-INFLIGHT-FIX",
      claim:
        "סגירת R207-TREASURY-INFLIGHT-HIDDEN: מקטע inFlight נוסף ל-/api/treasury (תוספת-בלבד, 0-מחיקות): refundQueueSp 2,462.51 · receivedInSp 244.11 · grossSp 3,947.25 · delegatedOutSp 3,047.63. המפרך (r209-f) תקף ב-6-מתקפות עצמאיות מהשרשרת-הציבורית (keyless): אימות-מספרים עד rel 9.5e-9 · זהות gross=net+delegatedOut בפער-אפס · יחידות-נכונות (USD=SP×prices.STEEM — לקח-r203) · NULL-דרך-כנה · 0-מפתחות-ישנים-נעלמו · שחזור-עקבי. פסק: PASS. נימה-ניסוחית-אחת שהמפרך חשף תוקנה על-ידי-האדג'ודיקטור.",
      verdict: "PROVEN",
      scope: "LIVE",
      round: "R209",
      law: "הפרדת-רשויות: הבונה לא מאמת את עצמו; מפרך עצמאי עם תקציב-התקפה; האדג'ודיקטור חותם.",
      evidence: [
        { path: `${HOME}/sovereign/proofs/evidence-cycles/r209-treasury/falsifier-verdict.json` },
        { path: `${HOME}/src/app/api/treasury/route.ts` },
        { path: "/tmp/treasury-after-r209.json" },
      ],
      reproduction: { cmd, expect: "refundQueueSp" },
      lastRepro: r,
    });
    console.log("✓ רשום R209-TREASURY-INFLIGHT-FIX (PROVEN)");
  }

  // ── 2. מחזור-הבכורה של צוות-ההנדסה ──
  if (!ids.has("R209-TEAM-CYCLE")) {
    const cmd = `bun -e 'const v=require("/home/z/my-project/sovereign/proofs/evidence-cycles/r209-treasury/falsifier-verdict.json"); console.log("VERDICT="+v.verdict+" ATTACKS="+v.attacks.length+" FAILURES="+v.failures.length)'`;
    const r = await repro(cmd, "VERDICT=PASS");
    appendProof({
      claimId: "R209-TEAM-CYCLE",
      claim:
        "מחזור-בכורה של צוות-ההנדסה הריבוני בהפרדת-רשויות מלאה: בונה (r209-b) כתב +139-שורות/0-מחיקות; מפרך עצמאי (r209-f, ללא-כל-שיתוף-עם-הבונה) רדף אחרי-הפרכה ב-6-וקטורי-התקפה (שרשרת-עצמאית · זהות-חשבונאית · NULL-דרך · נגיעה-בישנים · יחידות · שחזור) — אפס-פגם-מספרי; נימה-אחת נתפסה ותוקנה. ההוכחה היא פלט-המפרך-החתום, לא מילת-הבונה.",
      verdict: "PROVEN",
      scope: "STRUCTURAL",
      round: "R209",
      law: "צוות-ההנדסה: בונה≠מאמת; מפרך-עם-תקציב-התקפה; אדג'ודיקטור-חותם; הכול נרשם בספר.",
      evidence: [
        { path: `${HOME}/sovereign/proofs/evidence-cycles/r209-treasury/falsifier-verdict.json` },
        { path: `${HOME}/worklog.md` },
      ],
      reproduction: { cmd, expect: "VERDICT=PASS" },
      lastRepro: r,
    });
    console.log("✓ רשום R209-TEAM-CYCLE (PROVEN)");
  }

  // ── 3. חוק-האמת העומד ──
  if (!ids.has("R209-PROOF-LAW-STANDING")) {
    const cmd = `bun -e 'const s=require("/home/z/my-project/sovereign/proofs/proof-law-state.json"); if(!s.book.chainOk||s.evidence.driftLive>0) process.exit(1); console.log("LAW-OK beats="+s.beatCount+" repro-ok="+(s.repro.history.find(r=>r.ok)?true:false))'`;
    const r = await repro(cmd, "LAW-OK");
    appendProof({
      claimId: "R209-PROOF-LAW-STANDING",
      claim:
        "חוק-האמת אינו תלוי-זיכרון-סוכן עוד: מאכף-עומד (mini-services/proof-law · :3052 · מניפסט-הצי) מריץ את שער-הספר כל 5-דק' — אימות-שרשרת-מלא מהג'נסיס · אימות-כל-עדות (sha256) · שחזור-חי-מסתובב (טענה-אחת-כל-פעימה, מינימום-6-שעות-בין-ריצות-לטענה) · אזעקות-חמורות על שרשרת-שבורה/סטיית-עדות/שחזור-נכשל. ההוכחה הראשונה שנרצתה-חי-על-ידי-המאכף: R208-J-15WORLDS (exit=0).",
      verdict: "PROVEN",
      scope: "STRUCTURAL",
      round: "R209",
      law: "P1–P6 + מאכף-עומד: הוכחה-שנרשמת-פעם-אחת-ונרצית-באופן-קבוע — לא-נשכחת.",
      evidence: [{ path: `${HOME}/sovereign/proofs/proof-law-state.json` }, { path: `${HOME}/mini-services/proof-law/index.ts` }, { path: `${HOME}/sovereign/fleet/fleet.yaml` }],
      reproduction: { cmd, expect: "LAW-OK" },
      lastRepro: r,
    });
    console.log("✓ רשום R209-PROOF-LAW-STANDING (PROVEN)");
  }

  console.log(`ספר אחרי-האדג'ודיקציה: ${readRegistry().length} רשומות`);
}

main();
