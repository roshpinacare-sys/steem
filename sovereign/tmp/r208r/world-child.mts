// ─────────────────────────────────────────────────────────────────────
// R208R WORLD-CHILD — בונה-עולם-אחד-מבודד ומריץ-שני-נתיבים (§VI+§XII)
// trace 1a10dda614a62251
//
// נתיב-א: ההכרעה-החיה-האמיתית (objective-consumer + wave-decision + ספר-תחזיות)
// נתיב-ב: המנבא-העצמאי (תהליך-נפרד, §VI — אפס-יבוא-קוד-הכרעה)
//
// שימוש: bun world-child.mts '<spec-json>'
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import { createHash } from "node:crypto";

const H = "/home/z/my-project";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const spec = JSON.parse(process.argv[2] ?? "{}") as {
  id: string;
  objectiveMode?: "ok" | "missing" | "stale" | "invalid-schema" | "falsifier-missing";
  prefMode?: "active" | "expired" | "absent";
  authMode?: "valid" | "absent-domain" | "mutated-unanchored" | "forbidden-legal";
  sbd?: { value: number; unit?: string; ageSec?: number } | null;
  idleSteem?: number;
  thresholdOverride?: number;
};

const LAB = `${H}/sovereign/tmp/r208r/matrix`;
const WDIR = `${LAB}/${spec.id}`;
const OBJ = `${WDIR}/objectives`;
const PREF = `${WDIR}/preferences`;
fs.rmSync(WDIR, { recursive: true, force: true });
fs.mkdirSync(OBJ, { recursive: true });
fs.mkdirSync(PREF, { recursive: true });

const MODEL_FILES = ["objectives.json", "options.json", "capabilities.json", "authority-map.json"];
for (const f of MODEL_FILES) fs.copyFileSync(`${H}/sovereign/objectives/${f}`, `${OBJ}/${f}`);
fs.copyFileSync(`${H}/sovereign/objectives/authority-anchor.jsonl`, `${OBJ}/authority-anchor.jsonl`);
const liveBookRaw = fs.readFileSync(`${H}/sovereign/preferences/preferences.jsonl`, "utf8");
const livePrefState = fs.readFileSync(`${H}/sovereign/preferences/state.json`, "utf8");

// עיגון-חוקי-מעבדה (מהלך-סמכות-לגיטימי: מי-שינה-מודל-מעדכן-עיגון)
function legalReanchor(): void {
  const anchorPath = `${OBJ}/authority-anchor.jsonl`;
  const lines = fs.existsSync(anchorPath) ? fs.readFileSync(anchorPath, "utf8").trim().split("\n").filter(Boolean) : [];
  const prev = lines.length ? JSON.parse(lines[lines.length - 1]!).entryHash : "GENESIS";
  const modelSha256: Record<string, string> = {};
  for (const f of MODEL_FILES) {
    try { modelSha256[f.replace(".json", "")] = sha(fs.readFileSync(`${OBJ}/${f}`)); } catch { /* קובץ-חסר (missing-OFF) — לא נעוגן */ }
  }
  const base = { seq: lines.length + 1, at: new Date().toISOString(), authorityMapSha256: modelSha256["authority-map"], modelSha256, by: `lab:${spec.id}`, trace: "1a10dda614a62251", law: "שינוי-חוקי-מעבדה — עיגון-מעודכן", prevHash: prev };
  fs.appendFileSync(anchorPath, JSON.stringify({ ...base, entryHash: sha(JSON.stringify(base)) }) + "\n");
}

// ── ערכי-ציר: objective ────────────────────────────────────────────
if (spec.objectiveMode === "missing") fs.rmSync(`${OBJ}/objectives.json`);
if (spec.objectiveMode === "stale") {
  for (const f of MODEL_FILES) {
    const p = `${OBJ}/${f}`;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j._meta.builtAt = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    fs.writeFileSync(p, JSON.stringify(j, null, 1));
  }
  legalReanchor(); // עיגון-מעודכן — בודקים MODEL-STALE, לא עיגון
}
if (spec.objectiveMode === "invalid-schema") {
  const p = `${OBJ}/objectives.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j._meta.schema = "sovereign-objectives-vX-invalid";
  fs.writeFileSync(p, JSON.stringify(j, null, 1));
  legalReanchor();
}
if (spec.objectiveMode === "falsifier-missing") {
  const p = `${OBJ}/options.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  delete j.armedCounterfactual.falsifiers;
  fs.writeFileSync(p, JSON.stringify(j, null, 1));
  legalReanchor();
}
// §VII — הצבת-סף-אחר במודל (שינוי-חוקי-מעבדה + עיגון-מעודכן)
if (typeof spec.thresholdOverride === "number") {
  const p = `${OBJ}/options.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j._meta.armingThreshold = { ...j._meta.armingThreshold, value: spec.thresholdOverride, at: new Date().toISOString(), source: `lab-override:${spec.id}` };
  fs.writeFileSync(p, JSON.stringify(j, null, 1));
  legalReanchor();
}

// ── ערכי-ציר: authority ────────────────────────────────────────────
if (spec.authMode === "absent-domain") {
  const p = `${OBJ}/authority-map.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.verdicts = j.verdicts.filter((x: any) => x.domain !== "תנועת-הון");
  fs.writeFileSync(p, JSON.stringify(j, null, 1));
  legalReanchor(); // הסרה-חוקית — התחום הופך לא-מוכר ⇒ fail-closed
}
if (spec.authMode === "forbidden-legal") {
  const p = `${OBJ}/authority-map.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const v = j.verdicts.find((x: any) => x.domain === "תנועת-הון");
  if (v) v.may = "לא — מעבדה: ההזרמה אסורה בעולם-זה";
  fs.writeFileSync(p, JSON.stringify(j, null, 1));
  legalReanchor();
}
if (spec.authMode === "mutated-unanchored") {
  const p = `${OBJ}/authority-map.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const v = j.verdicts.find((x: any) => x.domain === "תנועת-הון");
  if (v) v.may = "כן — מעבדה: הרשאה-מזויפת בלי-עיגון";
  fs.writeFileSync(p, JSON.stringify(j, null, 1));
  // אין-עיגון-מעודכן — ההתקפה: JSON-תקין, סמכות-מזויפת
}

// ── ערכי-ציר: preference ───────────────────────────────────────────
if (spec.prefMode === "absent") {
  fs.writeFileSync(`${PREF}/preferences.jsonl`, "");
  fs.writeFileSync(`${PREF}/state.json`, JSON.stringify({ chain: { lastEntryHash: null, count: 0 }, suspended: false, conditionStreaks: {}, updatedAt: new Date().toISOString() }, null, 1));
} else {
  fs.writeFileSync(`${PREF}/preferences.jsonl`, liveBookRaw.endsWith("\n") ? liveBookRaw : liveBookRaw + "\n");
  fs.writeFileSync(`${PREF}/state.json`, livePrefState);
}

// ── הסביבה-המבודדת — ואז היבוא ─────────────────────────────────────
process.env.OBJ_DIR = OBJ;
process.env.PREF_DIR = PREF;
process.env.PROJ_HOME = H;

const { objectiveDecisionView, appendPrediction, closePrediction, predictWaveDecision } = await import(`${H}/mini-services/objective-consumer.ts`);
const { waveDecision } = await import(`${H}/mini-services/wave-decision.ts`);
const prefsMod = await import(`${H}/mini-services/preferences.ts`);

// פק-תוקף-כנה (EXPIRE-משורשר על העותק)
if (spec.prefMode === "expired") {
  await prefsMod.appendPreference({ kind: "PREFERENCE-EXPIRE", subject: "grid-pool-seed", reason: "מעבדה: פק-תוקף-כנה על ההעדפה-הפעילה (שרשרת-תקפה)", authority: "ADVISORY-ONLY" } as any);
}

// ── נתיב-א: ההכרעה-האמיתית ─────────────────────────────────────────
const waveSteem = 200;
const idleNow = spec.idleSteem ?? 210;
const totalSteemNow = idleNow + 9.415;
const waveDelta = 220; // גל-מדיד בכל-עולמות-המטריצה (הציר-נבדק ב-W0/המעבדה)
const today = "2030-01-01";
const prefEntry = prefsMod.activeDown("grid-pool-seed");
const prefDown = prefEntry
  ? { seq: prefEntry.seq, expiresAt: String(prefEntry.expiresAt ?? ""), evidenceBooks: (prefEntry.evidence ?? []).map((e) => e.book.split("/").pop() ?? e.book), confidence: String(prefEntry.confidence ?? "medium") }
  : null;
const sbdNow = spec.sbd
  ? { value: spec.sbd.value, unit: spec.sbd.unit ?? "SBD", at: new Date(Date.now() - (spec.sbd.ageSec ?? 0) * 1000).toISOString() }
  : null;
const { view, reject, detail } = objectiveDecisionView("grid-pool-seed", {
  measuredSbd: sbdNow,
  prefEvidence: prefEntry?.evidence ?? [],
  requireResource: true,
});
const waveFires = waveDelta >= waveSteem && idleNow >= waveSteem;
const expectedDecision = predictWaveDecision({ waveFires, prefDown: !!prefDown, view, viewRejectReason: reject, authorityForbidden: view?.authorityStatus?.forbidden === true });

let prediction: { ok: true; entry: any } | { ok: false; why: string } = { ok: false, why: "boundary-not-crossed" };
if (waveFires) {
  prediction = appendPrediction({
    kind: "PREDICTION",
    predictionId: `PRED-R208R-${spec.id}-${Date.now()}`,
    boundary: "lab/r208r-matrix#liquidity-wave",
    objectiveId: view?.objectiveId ?? "UNAVAILABLE",
    objectiveSnapshotHash: view ? sha(Object.values(view.modelHashes).join("|")) : undefined,
    resourceSnapshotHash: sha(JSON.stringify({ idleNow, totalSteemNow, waveDelta, sbd: sbdNow?.value ?? null })),
    decisionInputHash: sha(JSON.stringify({ prefDown: !!prefDown, reject, seedVerdict: view?.priority?.verdictForSeed ?? null })),
    expectedDecision,
    expectedReason: view ? `${view.priority.rank} → ${view.priority.verdictForSeed}` : `reject=${reject}`,
    expectedOutcome: "שורת-החלטה אחת",
    falsifier: "PREDICTION-DIVERGENCE: ההכרעה ≠ expectedDecision",
    confidence: "medium",
  } as any);
}
const wd = waveDecision({
  now: new Date().toISOString(), today,
  measCredible: true, waveDelta, idleNow, totalSteemNow,
  lastStreamDay: null, waveSteem, share: 0.2,
  prefDown, view, viewRejectReason: reject,
});
let closedMatch: boolean | null = null;
if (prediction.ok) {
  const c = closePrediction(prediction.entry.predictionId, { actualDecision: wd.kind, divergence: wd.kind === prediction.entry.expectedDecision ? undefined : `expected=${prediction.entry.expectedDecision} actual=${wd.kind}` });
  closedMatch = c.ok ? (c as any).entry.match : null;
}

// ── נתיב-ב: המנבא-העצמאי (תהליך-נפרד) ──────────────────────────────
const predSpec = {
  objDir: OBJ,
  prefDir: PREF,
  wave: { measCredible: true, waveDelta, idleNow, totalSteemNow, lastStreamDay: null, today, waveSteem, share: 0.2 },
  measured: sbdNow,
};
const proc = Bun.spawn(["bun", `${H}/sovereign/tmp/r208r/independent-predictor.mts`], {
  stdin: "pipe", stdout: "pipe", stderr: "pipe",
});
proc.stdin.write(JSON.stringify(predSpec));
proc.stdin.end();
const predictorOut = await new Response(proc.stdout).text();
const predictorErr = await new Response(proc.stderr).text();
await proc.exited;
let predictor: any = null;
try { predictor = JSON.parse(predictorOut.trim()); } catch { predictor = { parseFail: predictorOut.slice(0, 100), err: predictorErr.slice(0, 200) }; }

// ── השוואה ─────────────────────────────────────────────────────────
const result = {
  id: spec.id,
  axes: {
    objective: spec.objectiveMode ?? "ok",
    pref: spec.prefMode ?? "active",
    authority: spec.authMode ?? "valid",
    sensor: spec.sbd == null ? "UNMEASURED" : (spec.sbd.unit && spec.sbd.unit !== "SBD") ? "INVALID-UNIT" : (spec.sbd.ageSec ?? 0) > 3600 ? "UNKNOWN-STALE" : "VALID",
    resource: idleNow >= waveSteem ? "SUFFICIENT" : "INSUFFICIENT",
  },
  inputs: { sbd: sbdNow?.value ?? null, sbdUnit: sbdNow?.unit ?? null, sbdAgeSec: spec.sbd?.ageSec ?? 0, idleNow, thresholdOverride: spec.thresholdOverride ?? null },
  viewReject: reject, viewDetail: detail?.slice(0, 120) ?? null,
  seedVerdict: view?.priority?.verdictForSeed ?? null,
  resourceStatus: view?.resourceRequirement?.status ?? null,
  authorityForbidden: view?.authorityStatus?.forbidden ?? null,
  prefActive: !!prefDown,
  predictionWritten: prediction.ok, predictionMatch: closedMatch,
  expectedDecision,                     // מהמנבא-המובנה בקוד
  actualDecision: wd.kind,              // מהמכריע האמיתי
  independentPrediction: predictor?.expectedDecision ?? `PREDICTOR-FAIL:${predictor?.parseFail ?? "?"}`,
  independentHash: predictor?.predictionHash ?? null,
  agreement: {
    predictorVsActual: predictor?.expectedDecision === wd.kind,
    builtinVsActual: expectedDecision === wd.kind,
    independentVsBuiltin: predictor?.expectedDecision === expectedDecision,
  },
};
process.stdout.write(JSON.stringify(result) + "\n");
