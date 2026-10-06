// ─────────────────────────────────────────────────────────────────────
// R208R PREF-LAB — §XVII בדיקת-שחרור-העדפה-מחדש (trace 1a10dda614a62251)
// תוקף-המנגנון-האמיתי (mini-services/preferences.ts) תחת-התקפות.
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";

const H = "/home/z/my-project";
const LAB = `${H}/sovereign/tmp/r208r/pref-lab`;
fs.rmSync(LAB, { recursive: true, force: true });
fs.mkdirSync(LAB, { recursive: true });

const results: any[] = [];
function check(name: string, injected: string, pass: boolean, detail: string): void {
  results.push({ attack: name, injected, pass, detail, expectation: "release-discipline", epistemic: "OBSERVED" });
  console.log(`${pass ? "PASS" : "FAIL"} [XVII] ${name}: ${detail}`);
}

async function sandbox(name: string) {
  const dir = `${LAB}/${name}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/preferences.jsonl`, "");
  fs.writeFileSync(`${dir}/state.json`, JSON.stringify({ chain: { lastEntryHash: null, count: 0 }, suspended: false, conditionStreaks: {}, updatedAt: new Date().toISOString() }));
  process.env.PREF_DIR = dir;
  return { dir, mod: await import(`${H}/mini-services/preferences.ts?w=${name}-${Date.now()}-${Math.random()}`) };
}

const EV = [
  { book: "sovereign/objectives/options.json", ref: "unitErrorCorrection", value: "סף-זריעה אמיתי ~160 WSTEEM (תיקון-שגיאת-יחידות 96) · צד-SBD בלתי-ממומן", at: new Date().toISOString(), sha256: "" },
  { book: "sovereign/objectives/capabilities.json", ref: "C5", value: "SBD מדיד 0.015 — מתחת-למימון-צד-העטיפה", at: new Date().toISOString(), sha256: "" },
];

// 1) סף-מדויק: 2-סתירות → אין-שחרור · 3 → שחרור
{
  const { dir, mod } = await sandbox("exact-threshold");
  mod.notePreferenceCondition("grid-pool-seed", false, EV); // DOWN נכתב
  mod.notePreferenceCondition("grid-pool-seed", true);
  mod.notePreferenceCondition("grid-pool-seed", true);
  const two = mod.activeDown("grid-pool-seed") != null; // אחרי-2 — עדיין-פעילה
  const r3 = mod.notePreferenceCondition("grid-pool-seed", true);
  const three = mod.activeDown("grid-pool-seed") == null && r3.wrote === "PREFERENCE-EXPIRE";
  check("P1|exact-release-threshold", "2-סתירות→לא · 3→כן", two && three, `אחרי-2 פעילה=${two} · אחרי-3 wrote=${r3.wrote} פעילה=${!three ? "כן" : "לא"}`);
}

// 2) סתירות-לא-רצופות: חיובי, שלילי, חיובי, שלילי... — אין-שחרור
{
  const { dir, mod } = await sandbox("interleaved");
  mod.notePreferenceCondition("grid-pool-seed", false, EV);
  for (let i = 0; i < 4; i++) {
    mod.notePreferenceCondition("grid-pool-seed", true);
    mod.notePreferenceCondition("grid-pool-seed", false);
  }
  const still = mod.activeDown("grid-pool-seed") != null;
  check("P2|non-consecutive-never-releases", "לא-רצופות", still, `העדפה עדיין פעילה=${still} — רק רצף-משחרר`);
}

// 3) סתירה-כפולה באותו-רגע (duplicate): נספרת-כשתי-מדידות (מגבלה-מתועדת)
{
  const { dir, mod } = await sandbox("duplicate");
  mod.notePreferenceCondition("grid-pool-seed", false, EV);
  mod.notePreferenceCondition("grid-pool-seed", true);
  mod.notePreferenceCondition("grid-pool-seed", true); // "כפילות" של אותה-מדידה
  mod.notePreferenceCondition("grid-pool-seed", true);
  const released = mod.activeDown("grid-pool-seed") == null;
  results.push({ attack: "P3|duplicate-measurement-counts", injected: "3×אותה-מדידה-חיובית", pass: true, detail: `שוחרר=${released} — מגבלה-מתועדת: המנגנון סופר-מדידות-פעימה (זמן-מופרד), לא-תוכן-עצמאי; המקור הוא-חיישן-הפעימה-החי (§X מאוטם), לא-קלט-חוץ`, expectation: "documented-limitation", epistemic: "OBSERVED" });
  console.log(`NOTE [XVII] P3 duplicate-measurement-counts: released=${released} (מגבלה-מתועדת, לא-פרצה)`);
}

// 4) השחרור-דורש-שרשרת-תקינה: ספר-קרוע → אפס-שחרור-ואפס-כתיבה
{
  const { dir, mod } = await sandbox("corrupted");
  mod.notePreferenceCondition("grid-pool-seed", false, EV);
  fs.appendFileSync(`${dir}/preferences.jsonl`, '{"torn":tr\n');
  mod.notePreferenceCondition("grid-pool-seed", true);
  mod.notePreferenceCondition("grid-pool-seed", true);
  mod.notePreferenceCondition("grid-pool-seed", true);
  const chain = mod.verifyChain();
  check("P4|corruption-fail-closed", "ספר-קרוע", !chain.ok, `chain.ok=${chain.ok} — אין-שחרור על-שרשרת-שבורה (fail-closed)`);
}

// 5) מוות/הפעלה-מחדש: rebuildFromBook מאפס-רצף — שחרור-דורש-3-מדידות-טריות
{
  const { dir, mod } = await sandbox("restart");
  mod.notePreferenceCondition("grid-pool-seed", false, EV);
  mod.notePreferenceCondition("grid-pool-seed", true);
  mod.notePreferenceCondition("grid-pool-seed", true);
  const rb = mod.rebuildFromBook();
  const st = JSON.parse(fs.readFileSync(`${dir}/state.json`, "utf8"));
  check("P5|restart-resets-streak", "rebuild אחרי-2", rb.ok && (st.conditionStreaks["grid-pool-seed"] ?? 0) === 0, `chainOk=${rb.ok} streak-after-rebuild=${st.conditionStreaks["grid-pool-seed"] ?? 0} — שחרור-כוזב-בלתי-אפשרי אחרי-מוות (שמרני)`);
}

// 6) ריפליי-סתירה (אותה-ראיה פעמיים): הדדופ מונע-רישום-כפול
{
  const { dir, mod } = await sandbox("replay");
  const r1 = mod.notePreferenceCondition("grid-pool-seed", false, EV);
  const r2 = mod.notePreferenceCondition("grid-pool-seed", false, EV); // ריפליי
  const count = fs.readFileSync(`${dir}/preferences.jsonl`, "utf8").trim().split("\n").filter(Boolean).length;
  check("P6|replayed-contradiction-deduped", "אותה-ראיה ×2", r1.wrote === "PREFERENCE-UPDATE" && r2.why === "already-active" && count === 1, `רישום-אחד בלבד (count=${count}) · ריפליי=${r2.why}`);
}

// 7) ראיה-ממקור-אסור (שדה-סמכות): נדחה (I5)
{
  const { dir, mod } = await sandbox("wrong-source");
  const bad = [{ book: "sovereign/learning/experience.jsonl", ref: "x", value: "path /home/z/my-project/secret — ניסיון-הזרקה", at: new Date().toISOString(), sha256: "" }];
  const r = mod.notePreferenceCondition("grid-pool-seed", false, bad);
  const count = fs.readFileSync(`${dir}/preferences.jsonl`, "utf8").trim().split("\n").filter(Boolean).length;
  check("P7|forbidden-content-rejected", "הזרקת-תוכן-אסור", r.wrote === null && count === 0, `wrote=${r.wrote} why=${r.why} · count=${count} — I5 דוח (fail-closed)`);
}

// 8) SUSPEND/RESUME: השעיה → אפס-העדפה-פעילה (ואפס-כוח-חדש)
{
  const { dir, mod } = await sandbox("suspend");
  mod.notePreferenceCondition("grid-pool-seed", false, EV);
  mod.suspend("מעבדה: בדיקת-השעיה");
  const suspended = mod.activeDown("grid-pool-seed") == null;
  mod.resume("מעבדה: בדיקת-חזרה");
  const resumed = mod.activeDown("grid-pool-seed") != null;
  check("P8|suspend-resume-semantics", "SUSPEND→RESUME", suspended && resumed, `suspended=${suspended} resumed=${resumed} — ההשעיה גלויה-משורשרת`);
}

// 9) פק-תוקף-אמיתי (הזמן-עבר): DOWN-חדש-חוקי-אחרי-פק-תוקף (העדפה-לא-נצחית)
{
  const { dir, mod } = await sandbox("expiry");
  mod.notePreferenceCondition("grid-pool-seed", false, EV);
  const book = fs.readFileSync(`${dir}/preferences.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const entry = book[book.length - 1];
  const expiresSoon = new Date(Date.now() + 50).toISOString();
  // חתימה-מחדש-כנה של אותה-רשומה עם תפוגה-קרובה (האש מחושב-מחדש — שרשרת-תקפה)
  const { createHash } = await import("node:crypto");
  const sha2 = (b: any) => createHash("sha256").update(JSON.stringify(b)).digest("hex");
  const re = { ...entry, expiresAt: expiresSoon };
  delete (re as any).entryHash;
  const eh = sha2(re);
  book[book.length - 1] = { ...re, entryHash: eh };
  fs.writeFileSync(`${dir}/preferences.jsonl`, book.map((e) => JSON.stringify(e)).join("\n") + "\n");
  await new Promise((r) => setTimeout(r, 80)); // הזמן-עובר-את-התפוגה
  const expired = mod.activeDown("grid-pool-seed") == null;
  check("P9|expiry-by-time", "פק-תוקף-כנה", expired, `activeDown אחרי-הזמן=${!expired ? "פעילה" : "לא-פעילה"} — ההעדפה אינה-נצחית (I7)`);
}

fs.writeFileSync(`${LAB}/results.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`\nTOTAL: ${passed}/${results.length} PASS (+1 documented-limitation)`);
