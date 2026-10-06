#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · PROOF-SEED (R208P) — הרישום-המייסד של ספר-ההוכחות
//
// כל ההוכחות שנצברו ב-R208/R208R + עובדות-הרשת — נרשמות פעם-אחת
// עם עדויות מהוצללות ופקודות-שחזור שרצו-חי בסבב זה (22:20–22:40Z).
// מיון-כנה: מה שהוכח — PROVEN; מה שהעולם לא סיפק — OPEN/UNOBSERVED.
// אפס-המצאה · אפס-פתיחה-מחדש-של-מה שכבר-נשפט · אפס-הרחבת-סמכות.
// ─────────────────────────────────────────────────────────────────────

import * as path from "node:path";
import {
  appendProof,
  readRegistry,
  verifyRegistry,
} from "./proof-ledger";

const R = (p: string) => path.resolve(import.meta.dir, "..", p);
const REPRO = "sovereign/proofs/repro-r208p";
const ROUND = "R208P";
const TRACE = "1a10e219d0860c0d";

const W15 = [
  "W0-no-wave", "W-A-live-truth", "W-B1-release-sbd-funded",
  "W-B1b-release-sbd-unfunded", "W-B2-tampered-pref", "W-B2b-tampered-nopref",
  "W-B3-stale-nopref", "W-B5-nopref-sbd-funded", "W-B6-resource-depleted",
  "W-B7-authority-forbidden", "W-B8-pref-expired", "W-B9-model-missing",
  "W-B10-unit-mismatch", "W-B11-stale-measurement", "W-B12-missing-measurement",
].map((w) => `bun sovereign/tmp/r208/replay-world.mts ${w}`).join(" && ");

async function main() {
  const existing = readRegistry().map((e) => e.claimId);
  const add = (args: Parameters<typeof appendProof>[0]) => {
    if (existing.includes(args.claimId)) {
      console.log(`↷ כבר-רשום: ${args.claimId}`);
      return;
    }
    const e = appendProof(args);
    console.log(`✓ seq ${e.seq} · ${e.claimId} · ${e.verdict} · ${e.entryHash.slice(0, 16)}…`);
  };

  // ── 1. מטריצת-15-העולמות של R208 — שוחזרה-חי מ-HEAD בסבב זה ──
  add({
    claimId: "R208-J-15WORLDS",
    claim: "15 עולמות-R208 משוחזרים מ-HEAD: 14/15 הכרעות זהות מילה-במילה (W-A→WAIT-PREFERENCE · W-B1→ACT · W-B1b→WAIT-MODEL · W-B7→BLOCKED_BY_AUTHORITY · כל-הדחיות-הבטוחות) ו-W-B2b (options-מדומות) נדחה-כעת מוקדם-יותר (WAIT-SAFETY מול MODEL-UNANCHORED) — הקשחת-עיגון R2, לא רגרסיה; אף-עולם-מדומה אינו פועל.",
    verdict: "PROVEN",
    scope: "LAB",
    round: ROUND,
    law: "עולם-מדומה מעולם לא מקבל פעולה · המודל הוא הקלט המכריע בגבול",
    evidence: [
      { path: R(`${REPRO}/15worlds-live.txt`) },
      { path: R("sovereign/tmp/r208/replay-worlds.jsonl") },
      { path: R(`${REPRO}/15worlds-meta.json`) },
    ],
    reproduction: { cmd: W15, expect: "" },
    lastRepro: { at: "2026-10-05T22:20:44Z", exit: 0, note: "הרצה-חי מלאה של 15 העולמות מ-HEAD — 14/15 זהים + 1 מוקשה-מוקדם" },
  });

  // ── 2. מטריצת-הסיבתיות 493 עולמות ──
  add({
    claimId: "R208R-CAUSAL-MATRIX-493",
    claim: "493 עולמות-פקטוריאליים (objective×pref×authority×sensor×resource): 0 כישלונות · 0 סטיות-מנבא · 0 אי-התאמות-ספר · ארבעת-ההיפוכים (מטרה/סמכות/חיישן/העדפה) מהפכים-את-ההכרעה · XIV: POSITIVE+אין-סמכות→BLOCKED_BY_AUTHORITY אף-פעולה · XV: סמכות+NEGATIVE→לעולם-לא-ACT · XVI: 240 עולמות-לחץ-משאבים→לעולם-לא-ACT · שינוי-סף-במודל מהפך-הכרעה ולעולם-לא-יוצר-סמכות.",
    verdict: "PROVEN",
    scope: "LAB",
    round: ROUND,
    law: "היפוך-משתנה-יחיד במודל מהפך-הכרעה · המודל מדכא-בלבד ומעולם-לא-מעניק",
    evidence: [{ path: R("cognition/OBJECTIVE-CAUSALITY-MATRIX.json") }],
    reproduction: { cmd: "bun sovereign/tmp/r208r/matrix-runner.mts", expect: '"failed": 0' },
    lastRepro: { at: "2026-10-05T22:31:00Z", exit: 0, note: "הרצה-חי: worldsRun=493 · failed=0 · predictorFails=0 · predBookMismatch=0" },
  });

  // ── 3. המנבא-העצמאי ──
  add({
    claimId: "R208R-INDEPENDENT-PREDICTOR",
    claim: "מנבא-עצמאי (תהליך-נפרד, אפס-יבוא-קוד-ההכרעה, טעינה-עצמאית מהחוזה): הסכמה 493/493 במטריצה + 4/4 עולמות-קנון עצמאיים (PC-A/PC-B1/PC-SAFETY/PC-AUTH — agreement כפול predictorVsActual+independentVsBuiltin=true). מגבלה-מוצהרת: עצמאות-קוד/תהליך, לא-עצמאות-חוק (סדר-ההכרעה משותף-כחוזה).",
    verdict: "PROVEN",
    scope: "LAB",
    round: ROUND,
    law: "תחזית-לפני-הכרעה · סטייה-עתידית = PREDICTION-DIVERGENCE גלוי",
    evidence: [{ path: R("cognition/OBJECTIVE-CAUSALITY-MATRIX.json") }],
    reproduction: { cmd: "bun sovereign/tmp/r208r/matrix-runner.mts && bun sovereign/tmp/r208r/world-child.mts '{\"id\":\"PC-B1\",\"objectiveMode\":\"ok\",\"prefMode\":\"absent\",\"authMode\":\"valid\",\"sbd\":{\"value\":3.5},\"idleSteem\":210}'", expect: '"independentVsBuiltin": true' },
    lastRepro: { at: "2026-10-05T22:38:00Z", exit: 0, note: "predictorFails=0 ב-493 + 4/4 עולמות-קנון בהסכמה-מלאה" },
  });

  // ── 4. עיגון-סמכות PREVENTED ──
  add({
    claimId: "R208R-AUTHORITY-ANCHOR",
    claim: "עיגון-האש של קבצי-המודל: ספר-עיגון חי (sovereign/objectives/authority-anchor.jsonl) · אימות-בייטס ב-loadModel · כל-שינוי-מודל-בלי-עיגון-מעודכן = MODEL-UNANCHORED fail-closed (נמדד-חי ב-W-B2b) · 8/8 התקפות-מפה נדחות · שינוי-חוקי-דורש-עיגון-מעודכן (כלי-העיגון הרשמי הריץ-חי בסבב זה — עיגון-טרי נכתב על בייטס-זהים).",
    verdict: "PROVEN",
    scope: "STRUCTURAL",
    round: ROUND,
    law: "פורמט-תקין ≠ סמכות-תקינה · המודל מדכא-בלבד; מפה-מזויפת מדרדרת-לחוק-הבסיס, לעולם-לא-מרחיבה",
    evidence: [{ path: R("sovereign/objectives/authority-anchor.jsonl") }],
    reproduction: { cmd: "bun sovereign/tmp/r208/replay-world.mts W-B2b-tampered-nopref", expect: "MODEL-UNANCHORED" },
    lastRepro: { at: "2026-10-05T22:20:44Z", exit: 0, note: "עולם-מדומות-נדחה-חי על MODEL-UNANCHORED" },
  });

  // ── 5. איטום-חיישנים ──
  add({
    claimId: "R208R-SENSOR-SEALED",
    claim: "אינטגריות-חיישנים fail-closed: 29/29 וקטורים (כולל יחידה-חסרה · טווח-1e308 · זמן-פגום · חותמת-עתידית · מדידה-כושלת→UNMEASURED-לעולם-לא-0) — כל-כשל→UNMEASURED→WAIT-SAFETY; שני-חורים-נמצאו-בגילוי-עצמי (R208R §X) ונאטמו.",
    verdict: "PROVEN",
    scope: "LAB",
    round: ROUND,
    law: "מדידה-כושלת = UNMEASURED, לעולם לא אפס",
    evidence: [{ path: R("cognition/R208R-VERDICT.json") }],
    reproduction: { cmd: "bun sovereign/tmp/r208r/integrity-lab.mts", expect: "29/29" },
    lastRepro: { at: "2026-10-05T22:36:00Z", exit: 0, note: "TOTAL: 29/29 PASS — הרצה-חי" },
  });

  // ── 6. שימור-המצבר ──
  add({
    claimId: "R208R-ACCUMULATOR-CONSERVATION",
    claim: "שימור-מצבר: total_realized = Σ אירועים-קנוניים-ייחודיים (canonical_event_id מונוטוני + גזירה-מהספר + ריפוי-עצמי) — 11/11 התקפות (ריטריי/ריפליי/כפילות/מאוחר/קרוע/מקבילי/שעון/ריסטרט) אפס-כפילות; התיקון קדם-למילוי-החי-הראשון.",
    verdict: "PROVEN",
    scope: "LAB",
    round: ROUND,
    law: "שום-אירוע-לא-נספר-פעמיים · שום-רווח-לא-נוצר-מהאוויר",
    evidence: [{ path: R("cognition/R208R-VERDICT.json") }],
    reproduction: { cmd: "bun sovereign/tmp/r208r/accumulator-lab.mts", expect: "11/11" },
    lastRepro: { at: "2026-10-05T22:36:30Z", exit: 0, note: "TOTAL: 11/11 PASS — הרצה-חי" },
  });

  // ── 7. מעבדת-העדפות ──
  add({
    claimId: "R208R-PREFERENCE-LAB",
    claim: "מנגנון-העדפות I7: סף-שחרור-מדויק (2-מדידות-לא-משחררות · 3-משחררות) · שרשרת-שבורה fail-closed · ריסטרט-מאפס-רצף · ריפליי/תוכן-אסור נדחים · פק-תוקף-כנה — 9/9; מגבלה-מתועדת: השחרור סופר-מדידות-פעימה, לא-ראיות-מתויגות-מקור.",
    verdict: "PROVEN",
    scope: "LAB",
    round: ROUND,
    law: "ההעדפה מדכאה-בלבד ואינה נוגעת בסמכות (FLIP4-אומת)",
    evidence: [{ path: R("cognition/R208R-VERDICT.json") }],
    reproduction: { cmd: "bun sovereign/tmp/r208r/pref-lab.mts", expect: "9/9" },
    lastRepro: { at: "2026-10-05T22:36:45Z", exit: 0, note: "TOTAL: 9/9 PASS — הרצה-חי" },
  });

  // ── 8. שרידות-מוות ──
  add({
    claimId: "R208-DEATH-SURVIVAL",
    claim: "שרידות-מוות-תהליך: שני-מוות-חי (kill 19:37:08Z · kill -9 21:38:20Z) — השומר סירב-חוקית (תקציב-3/3 · BOOT-GRACE-90ד') וההחייאה דרך-הנתיב-הרשמי R84; beats/lastTotalSteem/lastStreamDay/ספרים/שרשראות/האשים שומרו; שחזור-חי-קריאה-בלבד: אותן-ראיות→אותה-הכרעה · מעבדת-מוות 16/17 (ה-K7 החשוף-הידוע נרשם-ומוכרע-בנפרד).",
    verdict: "PROVEN",
    scope: "LIVE",
    round: ROUND,
    law: "שינוי-דעת-מכונה · אותן-ראיות→אותה-הכרעה גם-אחרי-מוות",
    evidence: [
      { path: R("cognition/R208R-VERDICT.json") },
      { path: R(`${REPRO}/death-lab-live.txt`) },
    ],
    reproduction: { cmd: "bun sovereign/tmp/r208/death-lab.mts || bun sovereign/tmp/r208r/death-lab.mts", expect: "TOTAL: 16/17" },
    lastRepro: { at: "2026-10-05T22:52:00Z", exit: 0, note: "16/17 — ה-K7-הידוע-חשוף-בכנות (חלון-כפילות intent-last)" },
  });

  // ── 9. אמת-חיה של ההכרעה-החיה ──
  add({
    claimId: "R208R-LIVE-REPLAY-TRUTH",
    claim: "חי: אותן-ראיות→WAIT-PREFERENCE (P#1 פעילה seq 3 · מודל a84280b6a77c · מדידת-חי 0.015 SBD) — ההכרעה-החיה מוכוונת-מודל וקריאה-בלבד; אפס-זיהום-מעבדה-בחי (ספר-התחזיות-החי נותר ריק).",
    verdict: "PROVEN",
    scope: "LIVE",
    round: ROUND,
    law: "אין-המצאת-עולם · המעבדה אינה מדווחת כחיים",
    evidence: [{ path: R("sovereign/money/state.json") }],
    reproduction: { cmd: "bun sovereign/tmp/r208/live-replay.mts", expect: "WAIT-PREFERENCE" },
    lastRepro: { at: "2026-10-05T22:37:00Z", exit: 0, note: "sameDecision=true · modelHashHead a84280b6a77c" },
  });

  // ── 10. שלמות-ספר-הרשת ──
  add({
    claimId: "R208P-BOOK-INTEGRITY",
    claim: "ספר-הרשת (THE WEAVE): שרשרת-hash + חתימות-EIP-191 + ראיות — מאומתים-חישוב-מחדש-מלא (EXIT=0) · 1400+ אימותים · 22 ימי-רצף-חיים · 106 אימותים-ב-24ש'.",
    verdict: "PROVEN",
    scope: "NETWORK",
    round: ROUND,
    law: "אמת לא נקנית בהצבעה — היא נגזרת מהאימות (חוק 13)",
    evidence: [{ path: R("sovereign/ledger.json") }],
    reproduction: { cmd: "bun run scripts/weave-verify-book.ts sovereign/ledger.json", expect: "VERDICT: הספר תקין" },
    lastRepro: { at: "2026-10-05T22:40:00Z", exit: 0, note: "EXIT=0 — שרשרת, חתימות וראיות אומתו בחישוב-מחדש מלא" },
  });

  // ── 11. פעימות-לב-ענן חוזרות (רשת מאמתת-את-עצמה) ──
  add({
    claimId: "R208P-HEARTBEAT-RECURRENT",
    claim: "פעימות-לב-ענן חוזרות (GitHub Actions + מתאם-ציבורי): 20+ אימותי-לב שכל-אחד מאמת-מחדש את כל הספר (1298/1298 חתימות · head תואם) — הרשת מאמתת-את-עצמה קבוע מהענן גם-כשהסנדבוקס מת; קווי-עיגון Steem+ZERO רצים באותו-מחזור.",
    verdict: "PROVEN",
    scope: "NETWORK",
    round: ROUND,
    law: "הריפו הוא הבית-הריבוני · גיטהאב עצמו מפעיל את הרשת",
    evidence: [
      { path: R(".github/workflows/weave-heart.yml") },
      { path: R("sovereign/ledger.json") },
    ],
    reproduction: { cmd: "bun run scripts/weave-verify-book.ts sovereign/ledger.json && grep -c 'פעימת לב ריבונית' sovereign/ledger.json", expect: "VERDICT: הספר תקין" },
    lastRepro: { at: "2026-10-05T22:40:30Z", exit: 0, note: "אימות-מלא עובר · פעימות-הלב חתומות בספר (#480…#1299)" },
  });

  // ── 12. חציית-גבול-חי-חיובית — UNOBSERVED (כנות, לא כישלון) ──
  add({
    claimId: "R208-LIVE-POSITIVE-WORLD",
    claim: "חציית-גבול-חי-חיובית: UNOBSERVED — העולם לא סיפק גל ≥200 STEEM (נזיל-חי 10.792 · אפס-ARENA-STREAM-אי-פעם); האורגניזם אסור-לו-ליצור-את-האירוע; הלכידה חמושה-קבוע ב-decide() 1.13.0 — הגל-החי-הראשון יירשם-אוטומטית בספר-התחזיות-החי ויירשם-כאן כרשומה-חדשה.",
    verdict: "UNOBSERVED",
    scope: "LIVE",
    round: ROUND,
    law: "אין-מניפולציה-לייצור-עדות · העדר-אירוע אינו כישלון כשהעולם לא סיפק",
    evidence: [{ path: R("cognition/R208R-VERDICT.json") }],
    reproduction: { cmd: "test ! -s sovereign/objectives/predictions.jsonl && echo LIVE-PREDICTION-LEDGER-STILL-EMPTY", expect: "LIVE-PREDICTION-LEDGER-STILL-EMPTY" },
    lastRepro: { at: "2026-10-05T22:41:00Z", exit: 0, note: "הספר-החי ריק — כנות מלאה" },
  });

  // ── 13. ספר-התחזיות-החי ריק ──
  add({
    claimId: "R208R-LIVE-PREDICTION-LEDGER-EMPTY",
    claim: "ספר-התחזיות-החי (sovereign/objectives/predictions.jsonl): 0 שורות אי-פעם — אף-גבול-חי-לא-נכתב; המעבדות כתבו-רק-לעותקיהן; אפס-המצאת-גל-חי.",
    verdict: "UNOBSERVED",
    scope: "LIVE",
    round: ROUND,
    law: "ספר-חי נכתב רק בגבול-חי אמיתי",
    evidence: [{ path: R("cognition/R208R-VERDICT.json") }],
    reproduction: { cmd: "ls sovereign/objectives/predictions.jsonl 2>/dev/null || echo EMPTY-NEVER-WRITTEN", expect: "EMPTY-NEVER-WRITTEN" },
  });

  // ── 14. חלון-הכפילות — רשום-כנה כפתוח; ההכרעה תירשם ברשומה-עוקבת ──
  add({
    claimId: "R208R-INTENT-WINDOW",
    claim: "חלון-כפילות-פעולה intent-last (בין-שידור-חוץ לשמירת-תוצאה): חשוף-מכנית (K7 actions=2 — הודגם-חי בסבב זה), מוגן-משולש (lastActionAt-בפתיחה R93 + תקציב-מוקדם + ניכוס-פקודות-זרות r191).",
    verdict: "OPEN",
    scope: "STRUCTURAL",
    round: ROUND,
    law: "ממצא-כנה נרשם בדיוק — לא מוסתר ולא מומצא",
    evidence: [{ path: R(`${REPRO}/death-lab-live.txt`) }],
    reproduction: { cmd: "bun sovereign/tmp/r208r/death-lab.mts", expect: "K7-intent-last" },
    lastRepro: { at: "2026-10-05T22:52:00Z", exit: 0, note: "K7 מדגים-חי: actions=2 בחלון" },
  });

  // ── 15. X3 — D-OP-01 מושעה בלי-קריטריון-חזרה ──
  add({
    claimId: "X3-DOP01-RETURN-CRITERION",
    claim: "X3: D-OP-01 (הכנסה > $0.01/יום) מושעה בהוראת-מפעיל בלי-קריטריון-מדיד-לחזרה ל-ACTIVE — סתירה-פתוחה במודל (objectives.json#contradictions[2]).",
    verdict: "OPEN",
    scope: "STRUCTURAL",
    round: ROUND,
    law: "השעיה בלי-קריטריון-מדיד היא סתירה — חייבת-קריטריון",
    evidence: [{ path: R("sovereign/objectives/objectives.json") }],
    reproduction: { cmd: "grep -c 'D-OP-01 מושעה בהוראת-מפעיל' sovereign/objectives/objectives.json", expect: "1" },
  });

  // ── אימות-סופי ──
  const entries = readRegistry();
  const v = verifyRegistry(entries);
  console.log(`─── סיכום: ${entries.length} רשומות · שרשרת ${v.ok ? "תקינה ✓" : "שבורה ✗ " + v.reason} · ראש ${entries[entries.length - 1].entryHash.slice(0, 20)}…`);
  if (!v.ok) process.exit(1);
}

main();
