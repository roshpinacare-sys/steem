// R207 — מעבדה-מבודדת לשכבת-ההעדפות (לקח-r206: ספר-חי אינו שטח-ניסוי · PREF_DIR נאכף-בריצה)
// ריצה: PREF_DIR=/home/z/my-project/sovereign/tmp/r207/pref-lab bun <קובץ-זה>
import fs from "node:fs";
import { createHash } from "node:crypto";

const LAB = process.env.PREF_DIR;
const LIVE = "/home/z/my-project/sovereign/preferences";
if (!LAB || !LAB.startsWith("/home/z/my-project/sovereign/tmp/r207/pref-lab") || LAB === LIVE) {
  console.error("FATAL: בידוד-מעבדה נכשל — PREF_DIR חייב sovereign/tmp/r207/pref-lab (assert-בריצה)");
  process.exit(99);
}
// לקח-r206: לא אוסרים קיום-ספר-חי — מוכיחים אי-נגיעה: hash לפני/אחרי
const liveBefore = (p: string) => { try { return createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } catch { return "absent"; } };
const liveHashBefore = [`${LIVE}/preferences.jsonl`, `${LIVE}/state.json`].map(liveBefore);
for (const f of ["preferences.jsonl", "state.json"]) {
  const p = `${LAB}/${f}`;
  if (fs.existsSync(p)) { console.error(`FATAL: ${p} קיים-מראש — מעבדה לא נקייה`); process.exit(99); }
}
fs.mkdirSync(LAB, { recursive: true });

const mod = await import("/home/z/my-project/mini-services/preferences.ts");
let pass = 0, fail = 0;
function t(name: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`  PASS ${name}${extra ? " · " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " · " + extra : ""}`); }
}

const EV = (book: string, ref: string) => [{ book, ref, value: "ראיה-מאומתת-מהארטיפקט (מעבדה)", at: new Date().toISOString(), sha256: "" }];
const down = (subject: any, extra: any = {}) => ({
  kind: "PREFERENCE-UPDATE", subject, direction: "DOWN", scope: { regime: ["lab"] },
  confidence: "medium", expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  evidence: EV("sovereign/objectives/options.json", "unitErrorCorrection"),
  reason: "ראיה-מעוגנת מהארטיפקטים של r207 (מעבדה-מבודדת)", authority: "ADVISORY-ONLY", ...extra,
});

console.log("── מעבדת-העדפות R207 ──");

// 1. רישום-תקין + שרשרת
const r1 = mod.appendPreference(down("grid-pool-seed"));
t("1 רישום-תקין", r1.ok === true);
t("2 שרשרת-תקינה אחרי-רישום", mod.verifyChain().ok && mod.verifyChain().count === 1);
t("3 activeDown מחזיר את הרשומה", mod.activeDown("grid-pool-seed")?.seq === 1);

// 2. דדופ-נושא
const r2 = mod.appendPreference(down("grid-pool-seed"));
t("4 דדופ: עדכון-שני-לאותו-נושא נדחה", r2.ok === false && /ALREADY-ACTIVE/.test((r2 as any).why));

// 3. I2 — subject לא-מוכר
const r3 = mod.appendPreference(down("attack-power-down" as any));
t("5 I2: subject לא-מוכר נדחה", r3.ok === false && /UNKNOWN-SUBJECT/.test((r3 as any).why));

// 4. I3 — סמכות-חייבת ADVISORY-ONLY
const r4 = mod.appendPreference(down("ladder-reprice", { authority: "FULL" }));
t("6 I3: authority≠ADVISORY-ONLY נדחה", r4.ok === false && /AUTHORITY-MUST-BE/.test((r4 as any).why));

// 5. I5 — שדה-אסור / תוכן-אסור
const r5a = mod.appendPreference({ ...down("ladder-reprice"), gateOverride: "ACTIVE" } as any);
t("7 I5: מפתח-חוץ-לרשימה נדחה", r5a.ok === false && /FORBIDDEN-KEY/.test((r5a as any).why));
const r5b = mod.appendPreference({ ...down("ladder-reprice"), reason: "נסה להזיז GATE_THRESHOLD=999 דרך ההעדפה" });
t("8 I5: תוכן-תקרה/סף נדחה", r5b.ok === false && /FORBIDDEN-CONTENT/.test((r5b as any).why));
const r5c = mod.appendPreference({ ...down("ladder-reprice"), reason: "נתיב /home/z/my-project/sovereign/autonomy/GATE.json" });
t("9 I5: תוכן-נתיב נדחה", r5c.ok === false && /FORBIDDEN-CONTENT/.test((r5c as any).why));

// 6. I6 — ספר-ראיה לא-מותר / קובץ-חסר
const r6a = mod.appendPreference({ ...down("ladder-reprice"), evidence: EV("sovereign/autonomy/GATE.json", "x") });
t("10 I6: ספר-ראיה-אסור נדחה", r6a.ok === false && /EVIDENCE-BOOK-NOT-ALLOWED/.test((r6a as any).why));
const r6b = mod.appendPreference({ ...down("ladder-reprice"), evidence: EV("sovereign/objectives/לא-קיים.json", "x") });
t("11 I6: ראיה-לא-קיימת נדחה (ספר-אסור או קובץ-חסר)", r6b.ok === false && /EVIDENCE-(BOOK-NOT-ALLOWED|FILE-MISSING)/.test((r6b as any).why));

// 7. שחרור בראיה-סותרת (I7 — streak 3)
mod.notePreferenceCondition("grid-pool-seed", true);
mod.notePreferenceCondition("grid-pool-seed", true);
const r7 = mod.notePreferenceCondition("grid-pool-seed", true);
t("12 I7: שחרור אחרי 3 מדידות-סותרות רצופות", r7.wrote === "PREFERENCE-EXPIRE");
t("13 אחרי-שחרור: activeDown=null", mod.activeDown("grid-pool-seed") === null);

// 8. רישום-מחדש אחרי-שחרור (החיים ממשיכים)
const r8 = mod.appendPreference(down("grid-pool-seed"));
t("14 רישום-מחדש אחרי-שחרור מתקבל", r8.ok === true);

// 9. מוות-ושחזור: מחיקת-state → rebuild מהספר
fs.rmSync(`${LAB}/state.json`);
const rb = mod.rebuildFromBook();
t("15 שחזור-מהספר אחרי-מוות (3 רשומות: U·E·U)", rb.ok && rb.count === 3 && mod.activeDown("grid-pool-seed") !== null);

// 10. ספר-קרוע → fail-closed גלוי
const bookPath = `${LAB}/preferences.jsonl`;
const good = fs.readFileSync(bookPath, "utf8");
fs.appendFileSync(bookPath, `{"seq":999,"torn"\n`);
t("16 שרשרת-קרועה מתגלית", mod.verifyChain().ok === false);
t("17 fail-closed: activeDown=null על-ספר-שבור (לא-המצאה-שקטה)", mod.activeDown("grid-pool-seed") === null);
const r10 = mod.appendPreference(down("ladder-reprice"));
t("18 כתיבה על-ספר-שבור נדחית (CHAIN-BROKEN)", r10.ok === false && /CHAIN-BROKEN/.test((r10 as any).why));
fs.writeFileSync(bookPath, good); // שחזור-מעבדה

// 11. SUSPEND/RESUME
mod.suspend("זיהום-מעבדה-מדומה (בדיקת-השעיה)");
t("19 SUSPEND: activeDown=null", mod.activeDown("grid-pool-seed") === null);
mod.resume("שחזור-מאומת (בדיקת-השעיה)");
t("20 RESUME: ההעדפה חוזרת להיות פעילה", mod.activeDown("grid-pool-seed") !== null);

// 12. תפוגת-תוקף (I7)
const r12 = mod.appendPreference(down("hold-reserve", { expiresAt: new Date(Date.now() - 1000).toISOString() }));
t("21 רישום עם תפוגה-בעבר מתקבל-בספר", r12.ok === true);
t("22 אך אינו פעיל (פג-תוקף)", mod.activeDown("hold-reserve") === null);

// 13. ביקורת-ייבוא: המודול לא מייבא מודולי-שער (I1) — והצרכן היחיד הוא הדיבון
const src = fs.readFileSync("/home/z/my-project/mini-services/preferences.ts", "utf8");
t("23 I1: המודול לא מייבא tx-gate/autonomy-law/owner-key/econ-gate", !/from\s+["'][^"']*(tx-gate|autonomy-law|owner-key|econ-gate)/.test(src));
const moneySrc = fs.readFileSync("/home/z/my-project/mini-services/money/index.ts", "utf8");
t("24 I1: הדיבון (money) מייבא את המודול — הצרכן-המתוכנן", /preferences/.test(moneySrc));

console.log(`\n── סיכום: ${pass} PASS · ${fail} FAIL ──`);
const liveHashAfter = [`${LIVE}/preferences.jsonl`, `${LIVE}/state.json`].map(liveBefore);
t("25 אי-נגיעה: ספרי-החי לא השתנו במהלך המעבדה", JSON.stringify(liveHashBefore) === JSON.stringify(liveHashAfter));
process.exit(fail > 0 ? 1 : 0);
