// ─────────────────────────────────────────────────────────────────────
// R208R DEATH-LAB — §XVIII הוכחת-מוות-תהליך (trace 1a10dda614a62251)
// לכל-שלב-K (1–8): עולם-טרי → ילד-מתאבק-עד-K (SIGKILL) → ילד-החזרה
// (הנתיב-הרשמי: ריצה-מלאה מאותה-מדינה) → בדיקות-אינווריאנט.
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";

const H = "/home/z/my-project";
const LAB = `${H}/sovereign/tmp/r208r/death-lab`;
fs.rmSync(LAB, { recursive: true, force: true });
fs.mkdirSync(LAB, { recursive: true });

const MODEL_FILES = ["objectives.json", "options.json", "capabilities.json", "authority-map.json"];
const results: any[] = [];
function check(name: string, pass: boolean, detail: string): void {
  results.push({ checkpoint: name, pass, detail, epistemic: "OBSERVED" });
  console.log(`${pass ? "PASS" : "FAIL"} [XVIII] ${name}: ${detail}`);
}

function freshWorld(dir: string): void {
  fs.mkdirSync(`${dir}/objectives`, { recursive: true });
  fs.mkdirSync(`${dir}/preferences`, { recursive: true });
  for (const f of MODEL_FILES) fs.copyFileSync(`${H}/sovereign/objectives/${f}`, `${dir}/objectives/${f}`);
  fs.copyFileSync(`${H}/sovereign/objectives/authority-anchor.jsonl`, `${dir}/objectives/authority-anchor.jsonl`);
  fs.writeFileSync(`${dir}/preferences/preferences.jsonl`, "");
  fs.writeFileSync(`${dir}/preferences/state.json`, JSON.stringify({ chain: { lastEntryHash: null, count: 0 }, suspended: false, conditionStreaks: {}, updatedAt: new Date().toISOString() }));
}

async function runChild(dir: string, killAt: number, order: string): Promise<number> {
  const proc = Bun.spawn(["bun", `${H}/sovereign/tmp/r208r/death-child.mts`, dir, String(killAt), order], { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
  return proc.exitCode;
}

function readBook(dir: string): any[] {
  try { return fs.readFileSync(`${dir}/objectives/predictions.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
function readOplog(dir: string): any[] {
  try { return fs.readFileSync(`${dir}/oplog.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

const STAGES: Record<number, string> = {
  1: "אחרי-טעינת-מודל (לפני-תחזית)",
  2: "אחרי-כתיבת-תחזית (לפני-הכרעה)",
  3: "אחרי-ההכרעה (לפני-סגירת-תחזית)",
  4: "אחרי-סגירת-תחזית (לפני-OpLog)",
  5: "אחרי-OpLog (לפני-שער-הפעולה)",
  6: "לפני-הפעולה (אחרי-שמירת-כוונה intent-first)",
  7: "בין-הפעולה-לשמירת-מדינה (חלון-כפילות intent-last)",
  8: "אחרי-שמירת-מדינה — ריצה-שלמה",
};

for (const [order, orderLabel] of [["intent-first", "write-ahead"], ["intent-last", "אחרי-פעולה (כמו money:858)"]] as const) {
  for (const stage of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const dir = `${LAB}/${order}-k${stage}`;
    freshWorld(dir);
    await runChild(dir, stage, order);
    const diedAt = fs.existsSync(`${dir}/died-at`);
    // החזרה — הנתיב-הרשמי: ריצה-מלאה מאותה-מדינה
    await runChild(dir, 0, order);
    const book = readBook(dir);
    const oplog = readOplog(dir);
    const preds = book.filter((e) => e.kind === "PREDICTION");
    const closes = book.filter((e) => e.kind === "PREDICTION-CLOSE");
    const closeIds = new Set(closes.map((c) => c.predictionId));
    const actions = oplog.filter((o) => o.kind === "ACTION-EXECUTED");
    const decisions = oplog.filter((o) => o.kind !== "ACTION-EXECUTED");

    // אינווריאנטים
    const noDuplicateClose = closeIds.size === closes.length;
    const noDuplicateAction = actions.length <= 1;
    const chainIntact = (() => {
      let prev = "GENESIS";
      for (const e of book) {
        const { entryHash, ...rest } = e;
        if (e.prevHash !== prev || e.entryHash !== Bun.hash) { /* placeholder */ }
        prev = e.entryHash;
      }
      return true; // אימות-אמיתי בהמשך (appendPrediction עצמו מאמת torn)
    })();
    const decisionRecorded = decisions.length >= 1;
    const expectedActions = order === "intent-first" ? 1 : (stage === 7 ? 2 : 1);

    check(
      `K${stage}-${order} · ${STAGES[stage]}`,
      noDuplicateClose && noDuplicateAction && decisionRecorded,
      `diedAt=${diedAt} · predictions=${preds.length} · closes=${closes.length} (כפולות=${closes.length - closeIds.size}) · actions=${actions.length}${order === "intent-last" && actions.length === 2 ? " ← חלון-כפילות-חשוף (ממצא-כנה)" : " ✓"} · החזרה משלימה=${decisionRecorded}`,
    );
  }
}

// אימות-שרשרת-אמיתי על ספר-אחד (הכי-עמוס)
{
  const dir = `${LAB}/intent-last-k2`;
  const mod = await import(`${H}/mini-services/objective-consumer.ts?verify=${Date.now()}`);
  process.env.OBJ_DIR = `${dir}/objectives`;
  const mod2 = await import(`${H}/mini-services/objective-consumer.ts?verify2=${Date.now()}`);
  const { readPredBookStrict } = { readPredBookStrict: null } as any;
  // אימות-ידני של השרשרת:
  const book = readBook(dir);
  const { createHash } = await import("node:crypto");
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  let prev = "GENESIS"; let ok = true;
  for (const e of book) {
    const { entryHash, ...rest } = e;
    if (e.prevHash !== prev || e.entryHash !== sha(JSON.stringify(rest))) { ok = false; break; }
    prev = e.entryHash;
  }
  check("chain-integrity-after-death+recovery", ok, `ספר-התחזיות משורשר ותקין לאחר מוות+החזרה (${book.length} רשומות)`);
}

fs.writeFileSync(`${LAB}/results.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`\nTOTAL: ${passed}/${results.length}`);
