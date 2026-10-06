import { appendProof, readRegistry, verifyRegistry } from "../scripts/proof-ledger";
import * as path from "node:path";
const R = (p: string) => path.resolve(import.meta.dir, "..", p);
const e = appendProof({
  claimId: "R208R-INDEPENDENT-PREDICTOR",
  claim: "מנבא-עצמאי (תהליך-נפרד, אפס-יבוא-קוד-ההכרעה, טעינה-עצמאית מהחוזה): הסכמה 493/493 במטריצה + 4/4 עולמות-קנון עצמאיים (PC-A/PC-B1/PC-SAFETY/PC-AUTH — agreement כפול predictorVsActual+independentVsBuiltin=true). מגבלה-מוצהרת: עצמאות-קוד/תהליך, לא-עצמאות-חוק (סדר-ההכרעה משותף-כחוזה). [רוויזיה: פקודת-השחזור תוקנה להתאמת-פורמט-פלט מדויקת]",
  verdict: "PROVEN",
  scope: "LAB",
  round: "R208P",
  law: "תחזית-לפני-הכרעה · סטייה-עתידית = PREDICTION-DIVERGENCE גלוי",
  evidence: [{ path: R("cognition/OBJECTIVE-CAUSALITY-MATRIX.json") }],
  reproduction: { cmd: "bun sovereign/tmp/r208r/matrix-runner.mts && bun sovereign/tmp/r208r/world-child.mts '{\"id\":\"PC-B1\",\"objectiveMode\":\"ok\",\"prefMode\":\"absent\",\"authMode\":\"valid\",\"sbd\":{\"value\":3.5},\"idleSteem\":210}'", expect: "independentVsBuiltin" },
  lastRepro: { at: "2026-10-05T22:58:00Z", exit: 0, note: "predictorFails=0 ב-493 + world-child פלט-חי independentVsBuiltin=true" },
});
console.log("revision seq", e.seq, e.entryHash.slice(0, 16));
const v = verifyRegistry(readRegistry());
console.log("chain:", v.ok ? "OK" : "BROKEN " + v.reason);
