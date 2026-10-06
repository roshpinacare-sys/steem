// חידוש-חוקי P#1 על המודל-המשוחזר (אחרי-אירוע-ההשתקמות מה-reset) —
// EXPIRE → UPDATE עם אסמכתאות-טריות מהבייטס-הנוכחיים (החוק של R208R §VII)
import * as crypto from "node:crypto";
import * as prefs from "../mini-services/preferences";
import * as fs from "node:fs";

const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const OBJ = "/home/z/my-project/sovereign/objectives";

const exp = prefs.appendPreference({
  kind: "PREFERENCE-EXPIRE",
  subject: "grid-pool-seed",
  reason: "חידוש-חוקי R208P: אסמכתאות-ההעדפה נשאו בייטס-מודל ישנים (be5c4327) מול-המודל-המשוחזר (f8126304) — EVIDENCE-HASH-DRIFT נמדד; חידוש על המודל-החי-כעת",
  authority: "ADVISORY-ONLY",
} as any);
console.log("EXPIRE ok=" + exp.ok + (exp.ok ? " seq=" + (exp as any).entry.seq : " why=" + (exp as any).why));

const upd = prefs.appendPreference({
  kind: "PREFERENCE-UPDATE",
  subject: "grid-pool-seed",
  direction: "DOWN",
  scope: { regime: ["pre-landing-window", "sbd-unfunded"] },
  confidence: "medium",
  expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  evidence: [
    { book: "sovereign/objectives/options.json", ref: "unitErrorCorrection", value: "סף-זריעה אמיתי ~160 WSTEEM · צד-SBD בלתי-ממומן", at: new Date().toISOString(), sha256: sha(`${OBJ}/options.json`) },
    { book: "sovereign/objectives/capabilities.json", ref: "C5", value: "SBD מדיד 0.015 — מתחת-למימון-צד-העטיפה", at: new Date().toISOString(), sha256: sha(`${OBJ}/capabilities.json`) },
    { book: "sovereign/objectives/options.json", ref: "_meta.armingThreshold", value: "הסף-הרג'ימי חי-כעת במודל — OBJECTIVE-PARAMETER (§VII R208R)", at: new Date().toISOString(), sha256: sha(`${OBJ}/options.json`) },
  ],
  reason: "חידוש-חוקי R208P: אותה העדפה-נלמדת (DOWN · advisory-only) על הבייטס-המשוחזרים — אפס-שינוי-מהות, אפס-הרחבת-סמכות",
  authority: "ADVISORY-ONLY",
} as any);
console.log("UPDATE ok=" + upd.ok + (upd.ok ? " seq=" + (upd as any).entry.seq : " why=" + (upd as any).why));

const chain = prefs.verifyChain();
console.log("chain ok=" + chain.ok + " count=" + chain.count);
const active = prefs.activeDown("grid-pool-seed");
console.log("P#1 active=" + !!active + " seq=" + active?.seq + " evidence=" + (active?.evidence ?? []).length);
process.exit(0);
