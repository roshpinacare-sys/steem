// ─────────────────────────────────────────────────────────────────────
// R208-D SENSOR-LAB — poison.mts (סוכן-D: יריב-חיישנים, trace 1a10d7a051e822d1)
// שימוש: bun poison.mts <vector>   (תהליך-אחד-לכל-וקטור — OBJ_DIR/PREF_DIR
// נלכדים ברמת-המודול, לכן היבוא הדינמי אחרי-הזרעת-הסביבה בלבד)
//
// שיטה: עותקים-מבודדים של 4 קבצי-המודל (המקור החי — קריאה-בלבד) + הזרקת
// מדידה-מורעלת לממשק-הצר. הגל תמיד "נמדד" (waveDelta 220 ≥ 200, idle 210)
// ואין-העדפה-פעילה (prefDown=null) — כלומר הדבר-היחיד שעומד-בין-הרעל
// ל-ACT הוא צרכן-המטרות עצמו. זו עמדת-התקפה-החזקה-ביותר.
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";

const H = "/home/z/my-project";
const vector = process.argv[2] ?? "UNKNOWN";
const LAB = `${H}/sovereign/tmp/r208/sensor-lab`;
const WDIR = `${LAB}/runs/${vector}`;
const OBJ = `${WDIR}/objectives`;
const PREF = `${WDIR}/preferences`;
const MODEL_FILES = ["objectives.json", "options.json", "capabilities.json", "authority-map.json"];
const DAY = 24 * 3600 * 1000;

type Sbd = { value: number; unit?: string; at?: string }; // at: "now" | ISO | "not-a-date"
type Poison = { desc: string; sbd: Sbd | null; mutate?: (objDir: string, now: number) => void };

// ── עזרי-טמפר (בעותקים-בלבד) ─────────────────────────────────────────
function edit(objDir: string, file: string, fn: (j: any) => void): void {
  const p = `${objDir}/${file}`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  fn(j);
  fs.writeFileSync(p, JSON.stringify(j, null, 1), "utf8");
}
function setBuiltAtAll(objDir: string, ms: number, only?: string): void {
  for (const f of MODEL_FILES) {
    if (only && f !== only) continue;
    edit(objDir, f, (j) => { j._meta.builtAt = new Date(ms).toISOString(); });
  }
}
function resolveAt(at?: string): string {
  if (at === undefined || at === "now") return new Date().toISOString();
  return at; // כולל "not-a-date" — בכוונה
}

// ── וקטורי-ההזרקה ────────────────────────────────────────────────────
// הערה-אסטרטגית: בווקטורי-טמפר-מודל מזריקים מדידה "צועקת" SBD 3.5 ממומן —
// היריב-החזק-ביותר: מודל-פגום + חיישן-מפרגן. חייב להישאר WAIT-*, לעולם לא ACT.
const V: Record<string, Poison> = {
  // 1) מודל-ישן
  "V1-stale-all-8d": { desc: "builtAt=now-8d בכל-4-הקבצים (מעבר-TTL) + מדידה-ממומנת 3.5 SBD", sbd: { value: 3.5 }, mutate: (o, now) => setBuiltAtAll(o, now - 8 * DAY) },
  "V1b-stale-options-only-8d": { desc: "builtAt=now-8d רק-options.json (הזדקנות-חלקית) + 3.5 SBD", sbd: { value: 3.5 }, mutate: (o, now) => setBuiltAtAll(o, now - 8 * DAY, "options.json") },
  "V1c-fresh-6d23h": { desc: "בקרת-גבול: builtAt=now-6d23h (בתוך-TTL) + 0.015 SBD — המודל-חייב-היטען", sbd: { value: 0.015 }, mutate: (o, now) => setBuiltAtAll(o, now - 6 * DAY - 23 * 3600 * 1000) },
  "V1d-stale-7d1s": { desc: "בקרת-גבול: builtAt=now-(7d+1s) — בדיוק-מעבר-TTL + 3.5 SBD", sbd: { value: 3.5 }, mutate: (o, now) => setBuiltAtAll(o, now - 7 * DAY - 1000) },
  // 2) מפריך-חסר
  "V2-falsifier-delta-missing": { desc: "מחיקת armedCounterfactual.falsifiers.delta מ-options + 3.5 SBD", sbd: { value: 3.5 }, mutate: (o) => edit(o, "options.json", (j) => { delete j.armedCounterfactual.falsifiers.delta; }) },
  "V2b-falsifiers-empty": { desc: "falsifiers={} ריק-לגמרי + 3.5 SBD", sbd: { value: 3.5 }, mutate: (o) => edit(o, "options.json", (j) => { j.armedCounterfactual.falsifiers = {}; }) },
  // 3) סכמה-שבורה
  "V3-schema-v2": { desc: "objectives._meta.schema='sovereign-objectives-v2' (לא-מוכר) + 3.5 SBD", sbd: { value: 3.5 }, mutate: (o) => edit(o, "objectives.json", (j) => { j._meta.schema = "sovereign-objectives-v2"; }) },
  "V3b-schema-absent": { desc: "מחיקת _meta כולו מ-objectives + 3.5 SBD", sbd: { value: 3.5 }, mutate: (o) => edit(o, "objectives.json", (j) => { delete j._meta; }) },
  // 4) היוחסות-מזויפת
  "V4-trace-removed": { desc: "מחיקת options._meta.trace + 3.5 SBD", sbd: { value: 3.5 }, mutate: (o) => edit(o, "options.json", (j) => { delete j._meta.trace; }) },
  "V4b-law-removed": { desc: "מחיקת options._meta.law + 3.5 SBD", sbd: { value: 3.5 }, mutate: (o) => edit(o, "options.json", (j) => { delete j._meta.law; }) },
  "V4c-builtAt-garbage": { desc: "options._meta.builtAt='not-a-date' + 3.5 SBD (בקרת-ניגוד-מול-V8)", sbd: { value: 3.5 }, mutate: (o) => edit(o, "options.json", (j) => { j._meta.builtAt = "not-a-date"; }) },
  // 5) התקפת-אפס (API-כושל המחופש-לאפס-כן)
  "V5-zero-fresh": { desc: "measuredSbd {0, SBD, עכשיו} — אפס-טרי (שחרור-העדפה: prefDown=null)", sbd: { value: 0 } },
  "V5b-zero-stale-2h": { desc: "measuredSbd {0, SBD, age=7200s} — אפס-זקן", sbd: { value: 0, at: new Date(Date.now() - 7200 * 1000).toISOString() } },
  "V5c-missing-measurement": { desc: "אין-מדידה (null) וההכרעה-דורשת-משאב", sbd: null },
  // 6) הברחת-יחידות
  "V6a-unit-USD/STEEM-3.5": { desc: "measuredSbd {3.5, unit:'USD/STEEM'} — מספר-ממומן-ביחידה-שגויה", sbd: { value: 3.5, unit: "USD/STEEM" } },
  "V6b-unit-lowercase-usd-3.5": { desc: "measuredSbd {3.5, unit:'usd'} — אות-קטנה", sbd: { value: 3.5, unit: "usd" } },
  "V6c-unit-empty-3.5": { desc: "measuredSbd {3.5, unit:''} — יחידה-ריקה", sbd: { value: 3.5, unit: "" } },
  "V6d-unit-absent-0.1041": { desc: "measuredSbd {0.1041, יחידה-חסרה} — מספר-הפאריט-בלי-תג-יחידה (שיעור-0.1041)", sbd: { value: 0.1041 } },
  "V6e-unit-absent-3.5": { desc: "measuredSbd {3.5, יחידה-חסרה} — ממומן-בגודל-ובלי-תג-יחידה", sbd: { value: 3.5 } },
  // 7) מדידה-סותרת-את-הפרוזה-של-המודל
  "V7-contradiction-3.5-vs-model-0.015": { desc: "מדידה-חיה {3.5, SBD, עכשיו} מול-פרוזת-המודל (options: צד-SBD בלתי-ממומן 0.015) — לא-נוגעים-במודל", sbd: { value: 3.5 } },
  "V7b-model-threshold-ignored": { desc: "הוספת unitErrorCorrection.sbdFundThreshold='300 SBD' לפרוזת-המודל + מדידה 3.5 — האם-פרוזת-המודל-מזיזה-את-הסף?", sbd: { value: 3.5 }, mutate: (o) => edit(o, "options.json", (j) => { j.unitErrorCorrection.sbdFundThreshold = "300 SBD (מעבדה: המודל-דורש-300)"; }) },
  // 8) at-מקולקל
  "V8-at-not-a-date-3.5": { desc: "measuredSbd {3.5, SBD, at:'not-a-date'} — חותמת-זמן-פסולת-בגודל-ממומן", sbd: { value: 3.5, at: "not-a-date" } },
  "V8b-at-not-a-date-0": { desc: "measuredSbd {0, SBD, at:'not-a-date'} — פסולת-באפס (האם-השער-נשבר-רק-בגודל-ממומן?)", sbd: { value: 0, at: "not-a-date" } },
  "V8c-at-exactly-3600s": { desc: "בקרת-גבול: age=3600s בדיוק + 0.015 — לא->3600 ⇒ צריך-לעבור", sbd: { value: 0.015, at: new Date(Date.now() - 3600 * 1000).toISOString() } },
  "V8d-at-3601s": { desc: "בקרת-גבול: age=3601s + 0.015 — מעבר-הסף ⇒ RESOURCE-UNKNOWN", sbd: { value: 0.015, at: new Date(Date.now() - 3601 * 1000).toISOString() } },
  // 9) ענק/NaN/Infinity
  "V9-nan": { desc: "measuredSbd {value:NaN, SBD}", sbd: { value: NaN } },
  "V9b-infinity": { desc: "measuredSbd {value:Infinity, SBD}", sbd: { value: Infinity } },
  "V9c-1e308": { desc: "measuredSbd {value:1e308, SBD} — סנסור-משוגע-בגודל-פיניטי", sbd: { value: 1e308 } },
  "V9d-neg1e308": { desc: "measuredSbd {value:-1e308, SBD} — שלילי-ענק", sbd: { value: -1e308 } },
  // 10) גבולות-סף-המימון (3.0) + טרייסביליות §XV
  "V10a-exactly-3.0": { desc: "בקרת-גבול: measuredSbd {3.0, SBD} — sף-מימון-כולל (>=3.0)", sbd: { value: 3.0 } },
  "V10b-2.999": { desc: "בקרת-גבול: measuredSbd {2.999, SBD} — מתחת-לסף", sbd: { value: 2.999 } },
  "V15-traceability": { desc: "בקרת-§XV: תצוגה-מוצלחת {0.015, SBD, עכשיו} — אימות-מטא-מלאה על UnitValue", sbd: { value: 0.015 } },
};

const cfg = V[vector];
if (!cfg) { console.error(JSON.stringify({ error: `unknown vector ${vector}` })); process.exit(2); }

// ── בניית-העולם-המבודד ────────────────────────────────────────────────
fs.rmSync(WDIR, { recursive: true, force: true });
fs.mkdirSync(OBJ, { recursive: true });
fs.mkdirSync(PREF, { recursive: true });
for (const f of MODEL_FILES) fs.copyFileSync(`${H}/sovereign/objectives/${f}`, `${OBJ}/${f}`);
fs.writeFileSync(`${PREF}/state.json`, JSON.stringify({ chain: { lastEntryHash: null, count: 0 }, suspended: false, conditionStreaks: {}, updatedAt: new Date().toISOString() }, null, 1), "utf8");

const nowMs = Date.now();
if (cfg.mutate) cfg.mutate(OBJ, nowMs);

// ── רק-עכשיו: סביבה-מבודדת + יבוא-דינמי ──────────────────────────────
process.env.OBJ_DIR = OBJ;
process.env.PREF_DIR = PREF;
process.env.PROJ_HOME = H;

const { objectiveDecisionView, appendPrediction, closePrediction, predictWaveDecision } = await import(`${H}/mini-services/objective-consumer.ts`);
const { waveDecision } = await import(`${H}/mini-services/wave-decision.ts`);

// הזרקת-המדידה (unit נשלח רק-אם-הוגדר — בדיקת-ברירת-המחדל של הצרכן)
const msd: { value: number; at: string; unit?: string } | null = cfg.sbd
  ? { value: cfg.sbd.value, at: resolveAt(cfg.sbd.at) }
  : null;
if (msd && cfg.sbd!.unit !== undefined) msd.unit = cfg.sbd!.unit;

// קלט-גל-חי: הגבול-נחצה, אין-העדפה — רק-הצרכן-עומד-בין-הרעל-ל-ACT
const waveFires = true;
const { view, reject, detail } = objectiveDecisionView("grid-pool-seed", {
  measuredSbd: cfg.sbd ? msd : null,
  prefEvidence: [],
  requireResource: true,
});
const expectedDecision = predictWaveDecision({ waveFires, prefDown: false, view, viewRejectReason: reject, authorityForbidden: view?.authorityStatus?.forbidden === true });

// §VII — תחזית-לפני-ההכרעה (ספר-משורשר בעותק-המבודד)
const pred = appendPrediction({
  kind: "PREDICTION",
  predictionId: `PRED-D-${vector}-${nowMs}`,
  boundary: "lab/sensor-lab#poison",
  objectiveId: view?.objectiveId ?? "UNAVAILABLE",
  expectedDecision,
  expectedReason: view ? `${view.priority.verdictForSeed} · ${view.resourceRequirement.status}` : `reject=${reject}:${String(detail).slice(0, 80)}`,
  falsifier: "PREDICTION-DIVERGENCE: ההכרעה ≠ expectedDecision",
  confidence: "high",
});

const wd = waveDecision({
  now: new Date().toISOString(), today: "2030-01-01",
  measCredible: true, waveDelta: 220, idleNow: 210, totalSteemNow: 219.415,
  lastStreamDay: null, waveSteem: 200, share: 0.2,
  prefDown: null, view, viewRejectReason: reject,
});

const closed = pred.ok ? closePrediction(pred.entry.predictionId, { actualDecision: wd.kind, divergence: wd.kind === expectedDecision ? undefined : `expected=${expectedDecision} actual=${wd.kind}` }) : { ok: false as const };

// סדר-הספר: התחזית-נכתבה-לפני-הסגירה?
let predictionBeforeDecision: boolean | null = null;
try {
  const book = fs.existsSync(`${OBJ}/predictions.jsonl`) ? fs.readFileSync(`${OBJ}/predictions.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const pAt = book.find((e: any) => e.kind === "PREDICTION")?.at ?? null;
  const cAt = book.find((e: any) => e.kind === "PREDICTION-CLOSE")?.at ?? null;
  predictionBeforeDecision = pAt != null && cAt != null && pAt <= cAt;
} catch { /* לא-קריטי */ }

// §XV — מטא-המדידה-בתצוגה (טרייסביליות)
const meas = view?.resourceRequirement?.measured ?? null;
const measMeta = meas ? {
  value: meas.value, unit: meas.unit,
  source: String(meas.source).slice(0, 70),
  at: meas.at,
  stalenessSec: Number.isNaN(meas.stalenessSec) ? "NaN!" : meas.stalenessSec,
  transformation: String(meas.transformation).slice(0, 50),
} : null;
const threshMeta = view ? {
  seedWsteem: { value: view.threshold?.seedWsteem?.value, unit: view.threshold?.seedWsteem?.unit, hasSource: !!view.threshold?.seedWsteem?.source, hasAt: !!view.threshold?.seedWsteem?.at, hasTransformation: !!view.threshold?.seedWsteem?.transformation },
  depthUsd: { value: view.threshold?.depthUsd?.value, unit: view.threshold?.depthUsd?.unit, hasSource: !!view.threshold?.depthUsd?.source, hasAt: !!view.threshold?.depthUsd?.at, hasTransformation: !!view.threshold?.depthUsd?.transformation },
} : null;

console.log(JSON.stringify({
  vector, injected: cfg.desc,
  sbdInjected: cfg.sbd ? { value: cfg.sbd.value, unit: cfg.sbd.unit === undefined ? "(ABSENT→consumer default)" : JSON.stringify(cfg.sbd.unit), at: cfg.sbd.at ?? "now" } : null,
  viewReject: reject, detail: detail ? String(detail).slice(0, 110) : null,
  resourceStatus: view?.resourceRequirement?.status ?? null,
  seedVerdict: view?.priority?.verdictForSeed ?? null,
  measuredStaleness: measMeta ? measMeta.stalenessSec : null,
  measuredMeta: measMeta, thresholdMeta: threshMeta,
  expectedDecision, decision: wd.kind, match: closed.ok === true ? closed.entry.match : null,
  predictionWritten: pred.ok, predictionBeforeDecision,
  reason: wd.reason.slice(0, 190),
}));
