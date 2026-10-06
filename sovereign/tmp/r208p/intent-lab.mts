// ─────────────────────────────────────────────────────────────────────
// R208P INTENT-LAB — הוכחת-סגירת חלון-הכפילות (trace 1a10e219d0860c0d)
//
// ההכרעה: write-ahead intent (mini-services/money/intents.ts) + וירינג
// ב-money/index.ts act(). המעבדה מוכיחה שלושה-דברים:
//   L1 · התנהגות (על-המודול-החי עצמו): מוות בין-כוונה לתוצאה ⇒ היורש
//        סוגר UNKNOWN-כנה, מושתק מירי-חוזר לאותו (action,target),
//        פעולה-אחרת אינה מושתקת, ואין פעולה-שנייה.
//   L2 · וירינג-חי ב-HEAD: נקודות-החיבור ב-act() קיימות בקוד-החי.
//   L3 · שרשרת-ספר-הכוונות תקינה (verifyIntentsBook).
// אין-גישה להון-חי · אין-שידור-חוץ · ספר-כוונות מעבדה מנותק (INTENT_BOOK).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

const H = "/home/z/my-project";
const LAB = `${H}/sovereign/proofs/repro-r208p`;
const BOOK = `${LAB}/intent-lab-book.jsonl`;
const results: { checkpoint: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ checkpoint: name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [R208P] ${name}: ${detail}`);
};

for (const f of [BOOK, `${LAB}/victim.fired`, `${LAB}/victim.closed`, `${LAB}/revival.json`]) {
  try { fs.rmSync(f, { force: true }); } catch {}
}

// ── ילד-קורבן: רושם כוונה (המודול-החי) → מרקר → ממתין (ההורה הורג בחלון) ──
fs.writeFileSync(
  `${LAB}/intent-lab-child-wrap.mts`,
  `
import * as mod from "${H}/mini-services/money/intents.ts";
import fs from "node:fs";
const id = mod.appendIntent({ action: "reprice", target: "steem", tag: null, reason: "מעבדה: ירי-מדומה לפני-מוות" });
fs.writeFileSync("${LAB}/victim.fired", id);
await new Promise((r) => setTimeout(r, 10_000));
mod.closeIntent(id, "REPRICE", true);
fs.writeFileSync("${LAB}/victim.closed", id);
`,
);

const proc = Bun.spawn(["bun", `${LAB}/intent-lab-child-wrap.mts`], {
  env: { ...process.env, INTENT_BOOK: BOOK },
  stdout: "ignore",
  stderr: "ignore",
});
const t0 = Date.now();
while (!fs.existsSync(`${LAB}/victim.fired`) && Date.now() - t0 < 15_000) await new Promise((r) => setTimeout(r, 50));
proc.kill("SIGKILL"); // מוות בדיוק בחלון: כוונה-רשומה · תוצאה-לא-נסגרה
await new Promise((r) => setTimeout(r, 300));
const firedId = fs.existsSync(`${LAB}/victim.fired`) ? fs.readFileSync(`${LAB}/victim.fired`, "utf8") : "—";
const diedBeforeClose = !fs.existsSync(`${LAB}/victim.closed`);
check("L1a · כוונה-רשומה-לפני-השידור ואז SIGKILL בחלון", firedId !== "—" && diedBeforeClose, `intentId=${firedId.slice(0, 24)}… · נהרג-לפני-סגירה=${diedBeforeClose}`);

// ── ילד-יורש: bootReconcile → isSuppressed ──
fs.writeFileSync(
  `${LAB}/intent-lab-revival.mts`,
  `
import * as mod from "${H}/mini-services/money/intents.ts";
import fs from "node:fs";
const rec = mod.bootReconcileIntents();
const suppressed = mod.isSuppressed("reprice", "steem");
const suppressedOther = mod.isSuppressed("arm-buy", "hive");
const open = mod.openIntents().length;
const chain = mod.verifyIntentsBook();
fs.writeFileSync("${LAB}/revival.json", JSON.stringify({ rec, suppressed, suppressedOther, open, chain }));
`,
);
const rev = Bun.spawn(["bun", `${LAB}/intent-lab-revival.mts`], { env: { ...process.env, INTENT_BOOK: BOOK }, stdout: "ignore", stderr: "ignore" });
await rev.exited;
const R = JSON.parse(fs.readFileSync(`${LAB}/revival.json`, "utf8"));
check("L1b · היורש סוגר UNKNOWN-כנה (UNRESOLVED-AT-BOOT)", R.rec.closed === 1 && R.open === 0, `closed=${R.rec.closed} · open-אחרי=${R.open} · suppressed=${(R.rec.suppressed ?? []).join(",")}`);
check("L1c · ירי-חוזר לאותו (action,target) אסור", R.suppressed === true, "isSuppressed(reprice,steem)=true — 30 דק' שקט-עולם");
check("L1d · פעולה-אחרת אינה מושתקת (מדידה-מדויקת, לא-ענישה-קולקטיבית)", R.suppressedOther === false, "isSuppressed(arm-buy,hive)=false");
check("L3 · שרשרת-ספר-הכוונות תקינה", R.chain === true, "verifyIntentsBook=true (GENESIS→INTENT→CLOSE)");

// ── L2 · וירינג-חי ב-HEAD ──
const moneySrc = fs.readFileSync(`${H}/mini-services/money/index.ts`, "utf8");
const wiring = {
  import: moneySrc.includes('from "./intents"'),
  bootReconcile: moneySrc.includes("bootReconcileIntents()"),
  intentBeforeSend: moneySrc.indexOf("const intentId = appendIntent(") >= 0 && moneySrc.indexOf("const intentId = appendIntent(") < moneySrc.indexOf("await fetch(EXCHANGE_API"),
  suppressGate: moneySrc.includes("if (isSuppressed(action, target))"),
  closeOnOutcome: moneySrc.includes("closeIntent(intentId, actionKind"),
  closeOnNoKey: moneySrc.includes('closeIntent(intentId, "LANE-BLOCKED"'),
};
check("L2 · וירינג intent-first ב-act() של HEAD (6-נקודות)", Object.values(wiring).every(Boolean), JSON.stringify(wiring).slice(0, 200));

const passed = results.filter((r) => r.pass).length;
fs.writeFileSync(`${LAB}/intent-lab-results.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
console.log(`\nTOTAL: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
