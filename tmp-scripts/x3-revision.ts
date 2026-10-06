import { appendProof, readRegistry, verifyRegistry } from "../scripts/proof-ledger";
import * as path from "node:path";
const R = (p: string) => path.resolve(import.meta.dir, "..", p);
const e = appendProof({
  claimId: "X3-DOP01-RETURN-CRITERION",
  claim: "הכרעת X3: קריטריון-חזרה-מדיד ל-D-OP-01 נקבע במודל עצמו (objectives.json#contradictions[2].resolutionCriterion): חזרה-ל-ACTIVE ביום-הראשון של usdToday ≥ 0.01 מדיד-חי ביומן-היומי · אופק 2026-10-15 — אם עדיין אפס: ההסבר-המבני מופרך וההשעיה חייבת-הסלקה למפעיל, אסור-להאריך-בשקט · קריטריון-מדיד-בלבד, אפס-הרחבת-סמכות · המודל שונה-חוקית ועוגן-מחדש בכלי-העיגון-הרשמי. [רוויזיה: פקודת-השחזור חדה — ספירת-הקריטריון-עצמו]",
  verdict: "RESOLVED-BY-DECISION",
  scope: "STRUCTURAL",
  round: "R208P",
  law: "השעיה בלי-קריטריון-מדיד היא סתירה · שינוי-חוקי-מודל = שינוי+עיגון-מעודכן",
  evidence: [{ path: R("sovereign/objectives/objectives.json") }],
  reproduction: { cmd: "grep -c 'resolutionCriterion' sovereign/objectives/objectives.json", expect: "1" },
  lastRepro: { at: "2026-10-06T00:20:00Z", exit: 0, note: "הקריטריון במודל · עיגון-מעודכן 609d72d0" },
});
console.log("revision seq", e.seq, e.entryHash.slice(0, 16));
console.log("chain:", verifyRegistry(readRegistry()).ok ? "OK" : "BROKEN");
