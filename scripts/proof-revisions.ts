#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// R208P · REVISIONS — הכרעות-הסבב על גבי הרישום-המייסד
//   · רוויזיות-עדות: מטריצה, מנבא, עיגון, אמת-חיה, ספר-רשת, לב-ענן
//     (כל-העדויות עוברות לכספת-הקפואה — הראיה נקפאת לעד)
//   · הכרעה-חדשה 1: חלון-הכפילות intent-first — נסגר והוכח (6/6)
//   · הכרעה-חדשה 2: X3 — קריטריון-חזרה ל-D-OP-01 נקבע והמודל עוגן-מחדש
// ─────────────────────────────────────────────────────────────────────

import * as path from "node:path";
import { appendProof, readRegistry, verifyRegistry } from "./proof-ledger";

const R = (p: string) => path.resolve(import.meta.dir, "..", p);
const REPRO = "sovereign/proofs/repro-r208p";
const ROUND = "R208P";

async function main() {
  const existing = readRegistry();
  const last = new Map<string, string>(); // claimId → verdict אחרון
  for (const e of existing) last.set(e.claimId, e.verdict);
  const add = (args: Parameters<typeof appendProof>[0]) => {
    const e = appendProof(args);
    console.log(`✓ seq ${e.seq} · ${e.claimId} · ${e.verdict} · ${e.entryHash.slice(0, 16)}…`);
  };

  // ── רוויזיות-עדות (אותן טענות — עדויות-קפואות מכספת-הרישום) ──
  add({
    claimId: "R208R-CAUSAL-MATRIX-493",
    claim: "493 עולמות-פקטוריאליים: 0 כישלונות · 0 סטיות-מנבא · 0 אי-התאמות-ספר · ארבעת-ההיפוכים עוברים · XIV/XV/XVI תקינים · שינוי-סף-במודל מהפך-הכרעה ולעולם-לא-יוצר-סמכות. [רוויזיה: עדות-קפואה מכספת-הרישום]",
    verdict: "PROVEN",
    scope: "LAB",
    round: ROUND,
    law: "היפוך-משתנה-יחיד במודל מהפך-הכרעה · המודל מדכא-בלבד",
    evidence: [{ path: R("cognition/OBJECTIVE-CAUSALITY-MATRIX.json") }],
    reproduction: { cmd: "bun sovereign/tmp/r208r/matrix-runner.mts", expect: '"failed": 0' },
    lastRepro: { at: "2026-10-05T22:31:00Z", exit: 0, note: "worldsRun=493 · failed=0 · predictorFails=0" },
  });

  add({
    claimId: "R208R-INDEPENDENT-PREDICTOR",
    claim: "מנבא-עצמאי (תהליך-נפרד): הסכמה 493/493 + 4/4 עולמות-קנון (independentVsBuiltin=true). מגבלה-מוצהרת: עצמאות-קוד/תהליך, לא-חוק. [רוויזיה: עדות-קפואה]",
    verdict: "PROVEN",
    scope: "LAB",
    round: ROUND,
    law: "תחזית-לפני-הכרעה",
    evidence: [{ path: R("cognition/OBJECTIVE-CAUSALITY-MATRIX.json") }],
    reproduction: { cmd: "bun sovereign/tmp/r208r/matrix-runner.mts && bun sovereign/tmp/r208r/world-child.mts '{\"id\":\"PC-B1\",\"objectiveMode\":\"ok\",\"prefMode\":\"absent\",\"authMode\":\"valid\",\"sbd\":{\"value\":3.5},\"idleSteem\":210}'", expect: "independentVsBuiltin" },
    lastRepro: { at: "2026-10-05T22:58:00Z", exit: 0, note: "predictorFails=0 + פלט-חי" },
  });

  add({
    claimId: "R208R-AUTHORITY-ANCHOR",
    claim: "עיגון-האש PREVENTED: ספר-עיגון חי · אימות-בייטס ב-loadModel · MODEL-UNANCHORED fail-closed (נמדד-חי ב-W-B2b) · 8/8 התקפות נדחות · כלי-העיגון הריץ-חי פעמיים בסבב (רגע-הרישום + רגע-הכרעת-X3). [רוויזיה: עדות-קפואה — ספר-העיגון נקפא בזמן-הרישום; הספר-החי ממשיך-לגדול-חוקית]",
    verdict: "PROVEN",
    scope: "STRUCTURAL",
    round: ROUND,
    law: "פורמט-תקין ≠ סמכות-תקינה · מי-שינה-מודל-מעדכן-עיגון",
    evidence: [{ path: R("sovereign/objectives/authority-anchor.jsonl") }],
    reproduction: { cmd: "bun sovereign/tmp/r208/replay-world.mts W-B2b-tampered-nopref", expect: "MODEL-UNANCHORED" },
    lastRepro: { at: "2026-10-05T22:20:44Z", exit: 0, note: "דחייה-חיה על MODEL-UNANCHORED" },
  });

  add({
    claimId: "R208R-LIVE-REPLAY-TRUTH",
    claim: "חי: אותן-ראיות→WAIT-PREFERENCE (P#1 seq 3 · מודל a84280b6a77c · מדידה-חי 0.015 SBD) — ההכרעה-החיה מוכוונת-מודל; אפס-זיהום-מעבדה-בחי. [רוויזיה: עדות-קפואה — מצב-הדיבון נקפא בזמן-הרישום]",
    verdict: "PROVEN",
    scope: "LIVE",
    round: ROUND,
    law: "אין-המצאת-עולם",
    evidence: [{ path: R("sovereign/money/state.json") }],
    reproduction: { cmd: "bun sovereign/tmp/r208/live-replay.mts", expect: "WAIT-PREFERENCE" },
    lastRepro: { at: "2026-10-05T22:37:00Z", exit: 0, note: "sameDecision=true · modelHashHead a84280b6a77c" },
  });

  add({
    claimId: "R208P-BOOK-INTEGRITY",
    claim: "ספר-הרשת מאומת-חישוב-מחדש-מלא (שרשרת+חתימות-EIP-191+ראיות · EXIT=0 · 22 ימי-רצף-חיים). [רוויזיה: עדות-קפואה — ראש-הספר בזמן-הרישום; הספר גדל-חוקית בכל-פעימה]",
    verdict: "PROVEN",
    scope: "NETWORK",
    round: ROUND,
    law: "אמת לא נקנית בהצבעה — היא נגזרת מהאימות",
    evidence: [{ path: R("sovereign/ledger.json") }],
    reproduction: { cmd: "bun run scripts/weave-verify-book.ts sovereign/ledger.json", expect: "VERDICT: הספר תקין" },
    lastRepro: { at: "2026-10-05T22:40:00Z", exit: 0, note: "EXIT=0" },
  });

  add({
    claimId: "R208P-HEARTBEAT-RECURRENT",
    claim: "פעימות-לב-ענן חוזרות: הרשת מאמתת-את-עצמה קבוע מהענן גם-כשהסנדבוקס מת; קווי-עיגון Steem+ZERO באותו-מחזור. [רוויזיה: עדויות-קפואות]",
    verdict: "PROVEN",
    scope: "NETWORK",
    round: ROUND,
    law: "הריפו הוא הבית-הריבוני",
    evidence: [
      { path: R(".github/workflows/weave-heart.yml") },
      { path: R("sovereign/ledger.json") },
    ],
    reproduction: { cmd: "bun run scripts/weave-verify-book.ts sovereign/ledger.json && grep -c 'פעימת לב ריבונית' sovereign/ledger.json", expect: "VERDICT: הספר תקין" },
    lastRepro: { at: "2026-10-05T22:40:30Z", exit: 0, note: "אימות-מלא עובר" },
  });

  // ── הכרעה-חדשה 1: חלון-הכפילות ──
  add({
    claimId: "R208R-INTENT-WINDOW",
    claim: "הכרעת חלון-הכפילות intent-last (K7): **write-ahead intent** — ספר-כוונות hash-chained נפרד (mini-services/money/intents.ts); כוונה-נרשמת לפני-השידור-החוץ · נסגרת בתוצאה-אמיתית · מוות-בחלון ⇒ היורש סוגר UNRESOLVED-AT-BOOT (UNKNOWN-כנה, לעולם-לא-מומצא) + השתקת-ירי-חוזר לאותו (action,target) ל-30 דק' שקט-עולם (פעולה-אחרת אינה מושתקת) · וירינג-מלא ב-act() ב-HEAD (6-נקודות). מעבדה: 6/6 — כולל מוות-חי-בחלון (SIGKILL) וירושה. ההכרעה: בטיחות-על-פני-פעילות; אפס-נגיעה בסמנטיקת-ספר-ההיסטוריה.",
    verdict: "PROVEN",
    scope: "STRUCTURAL",
    round: ROUND,
    law: "כוונה-פתוחה היא עדות-חיה · תוצאת-חוץ לא-מומצאת לעולם · לא מייעלים-ל-A — מייעלים-לאמת",
    evidence: [
      { path: R(`${REPRO}/intent-lab-results.json`) },
      { path: R(`${REPRO}/death-lab-live.txt`) },
    ],
    reproduction: { cmd: "bun sovereign/tmp/r208p/intent-lab.mts", expect: "TOTAL: 6/6" },
    lastRepro: { at: "2026-10-05T23:05:00Z", exit: 0, note: "6/6 — כולל וירינג-חי ב-HEAD" },
  });

  // ── הכרעה-חדשה 2: X3 ──
  add({
    claimId: "X3-DOP01-RETURN-CRITERION",
    claim: "הכרעת X3: קריטריון-חזרה-מדיד ל-D-OP-01 נקבע במודל עצמו (objectives.json#contradictions[2].resolutionCriterion): חזרה-ל-ACTIVE ביום-הראשון של usdToday ≥ 0.01 מדיד-חי ביומן-היומי · אופק 2026-10-15 — אם עדיין אפס: ההסבר-המבני מופרך וההשעיה חייבת-הסלקה למפעיל, אסור-להאריך-בשקט · קריטריון-מדיד-בלבד, אפס-הרחבת-סמכות · המודל שונה-חוקית ועוגן-מחדש בכלי-העיגון-הרשמי (עיגון-טרי על הבייטס-החדשים).",
    verdict: "RESOLVED-BY-DECISION",
    scope: "STRUCTURAL",
    round: ROUND,
    law: "השעיה בלי-קריטריון-מדיד היא סתירה · שינוי-חוקי-מודל = שינוי+עיגון-מעודכן",
    evidence: [{ path: R("sovereign/objectives/objectives.json") }],
    reproduction: { cmd: "grep -A3 resolutionCriterion sovereign/objectives/objectives.json | grep -c 'usdToday'", expect: "1" },
    lastRepro: { at: "2026-10-05T23:06:00Z", exit: 0, note: "הקריטריון במודל · עיגון-מעודכן נכתב (dcd3c440…)" },
  });

  const entries = readRegistry();
  const v = verifyRegistry(entries);
  console.log(`─── סיכום: ${entries.length} רשומות · שרשרת ${v.ok ? "תקינה ✓" : "שבורה ✗"} · ראש ${entries[entries.length - 1].entryHash.slice(0, 20)}…`);
  if (!v.ok) process.exit(1);
}

main();
