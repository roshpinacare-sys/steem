// ─────────────────────────────────────────────────────────────────────
// R208R DEATH-CHILD — תהליך-בן שמדמה את נתיב-הגבול ומהרג-את-עצמו (SIGKILL)
// בדיוק-אחרי-שלב-K. §XVIII (trace 1a10dda614a62251)
// שימוש: bun death-child.mts <workDir> <killAt:0-8> <order:intent-first|intent-last>
// killAt=0 → ריצה-מלאה בלי-מוות (שחזור/בסיס)
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import { createHash } from "node:crypto";

const H = "/home/z/my-project";
const WDIR = process.argv[2] ?? `${H}/sovereign/tmp/r208r/death-lab/w0`;
const KILL_AT = Number(process.argv[3] ?? "0");
const ORDER = process.argv[4] ?? "intent-last";
const OBJ = `${WDIR}/objectives`;
const PREF = `${WDIR}/preferences`;
const STATE = `${WDIR}/state.json`;
const OPLOG = `${WDIR}/oplog.jsonl`;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function maybeKill(stage: number): void {
  if (KILL_AT !== 0 && KILL_AT === stage) {
    fs.writeFileSync(`${WDIR}/died-at`, String(stage));
    process.kill(process.pid, "SIGKILL");
  }
}

// שלב 0: אתחול (KILL_AT=0 ⇒ ריצה-מלאה בלי-מוות — שחזור/בסיס)
if (KILL_AT === 0) fs.rmSync(`${WDIR}/died-at`, { force: true });

process.env.OBJ_DIR = OBJ;
process.env.PREF_DIR = PREF;
process.env.PROJ_HOME = H;
const { objectiveDecisionView, appendPrediction, closePrediction, predictWaveDecision } = await import(`${H}/mini-services/objective-consumer.ts`);
const { waveDecision } = await import(`${H}/mini-services/wave-decision.ts`);
const prefsMod = await import(`${H}/mini-services/preferences.ts`);

// שלב 1: טעינת-מודל (הקלטות-חיות-מתויגות-מעבדה)
const { view, reject } = objectiveDecisionView("grid-pool-seed", {
  measuredSbd: { value: 3.5, unit: "SBD", at: new Date().toISOString() },
  prefEvidence: [], requireResource: true,
});
maybeKill(1);

// שלב 2: כתיבת-תחזית (flush לדיסק)
const predictionId = `PRED-DEATH-${KILL_AT === 0 ? "base" : `run-${fs.existsSync(`${WDIR}/runs`) ? JSON.parse(fs.readFileSync(`${WDIR}/runs`, "utf8")) : 1}`}-${Date.now()}`;
const prediction = appendPrediction({
  kind: "PREDICTION",
  predictionId,
  boundary: "lab/r208r-death#liquidity-wave",
  objectiveId: view?.objectiveId ?? "UNAVAILABLE",
  objectiveSnapshotHash: view ? sha(Object.values(view.modelHashes).join("|")) : undefined,
  decisionInputHash: sha(JSON.stringify({ reject })),
  expectedDecision: predictWaveDecision({ waveFires: true, prefDown: false, view, viewRejectReason: reject, authorityForbidden: view?.authorityStatus?.forbidden === true }),
  expectedReason: "death-lab",
  expectedOutcome: "שורת-החלטה",
  falsifier: "PREDICTION-DIVERGENCE",
  confidence: "medium",
} as any);
maybeKill(2);

// שלב 3: ההכרעה (פונקציה-טהורה)
const wd = waveDecision({
  now: new Date().toISOString(), today: "2030-01-01",
  measCredible: true, waveDelta: 220, idleNow: 210, totalSteemNow: 219.415,
  lastStreamDay: null, waveSteem: 200, share: 0.2,
  prefDown: null, view, viewRejectReason: reject,
});
maybeKill(3);

// שלב 4: סגירת-התחזית מול-ההכרעה
let closed: any = { ok: false };
if (prediction.ok) closed = closePrediction(prediction.entry.predictionId, { actualDecision: wd.kind });
maybeKill(4);

// שלב 5: רישום-OpLog (ההחלטה בהיסטוריה)
fs.appendFileSync(OPLOG, JSON.stringify({ at: new Date().toISOString(), kind: wd.kind, act: wd.kind === "ACT" }) + "\n");
maybeKill(5);

// שלב 6/7/8: שער-הפעולה + הפעולה — סדר-שמירת-הכוונה קובע חלון-כפילות
const state = JSON.parse(fs.existsSync(STATE) ? fs.readFileSync(STATE, "utf8") : JSON.stringify({ lastStreamDay: null, actions: 0 }));
const alreadyStreamed = state.lastStreamDay === "2030-01-01";
if (ORDER === "intent-first" && !alreadyStreamed && wd.kind === "ACT") {
  state.lastStreamDay = "2030-01-01"; // write-ahead: הכוונה-נשמרת-לפני-הפעולה
  fs.writeFileSync(STATE, JSON.stringify(state));
}
maybeKill(6);
if (!alreadyStreamed && wd.kind === "ACT") {
  fs.appendFileSync(OPLOG, JSON.stringify({ at: new Date().toISOString(), kind: "ACTION-EXECUTED", action: "arena-stream", tag: ORDER }) + "\n");
}
// שלב 7 = בדיוק-בין-הפעולה-לשמירת-המדינה (intent-last): זהו חלון-הכפילות
maybeKill(7);
if (ORDER === "intent-last" && !alreadyStreamed && wd.kind === "ACT") {
  state.lastStreamDay = "2030-01-01"; // אחרי-הפעולה (כמו money/index.ts:858)
  fs.writeFileSync(STATE, JSON.stringify(state));
}
maybeKill(8);
fs.writeFileSync(`${WDIR}/done`, "1");
