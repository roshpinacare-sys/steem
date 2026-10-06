// ─────────────────────────────────────────────────────────────────────
// R208 REPLAY-WORLD — רץ-עולם-יחיד (§VI/VIII/XII/XIII/XIV/XV)
// תהליך-בן מבודד: OBJ_DIR/PREF_DIR מופנים לעותקים במעבדה לפני היבוא.
// אין גישה לשרשרת/מפתחות/הון-חי/חותם/מדידה-חית — הקלטות מתויגות-מעבדה.
// שימוש: bun replay-world.mts <world-name>
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";

const H = "/home/z/my-project";
const world = process.argv[2] ?? "UNKNOWN";
const LAB = `${H}/sovereign/tmp/r208/replay-lab`;
const WDIR = `${LAB}/${world}`;
const OBJ = `${WDIR}/objectives`;
const PREF = `${WDIR}/preferences`;
fs.rmSync(WDIR, { recursive: true, force: true });
fs.mkdirSync(OBJ, { recursive: true });
fs.mkdirSync(PREF, { recursive: true });

// עותקים טריים של מודל-המטרות (המקור החי — קריאה בלבד)
const MODEL_FILES = ["objectives.json", "options.json", "capabilities.json", "authority-map.json"];
for (const f of MODEL_FILES) fs.copyFileSync(`${H}/sovereign/objectives/${f}`, `${OBJ}/${f}`);
// §VIII R208R — ספר-עיגון-האש נסחב עם-המפה (העותק מאומת מקור)
if (fs.existsSync(`${H}/sovereign/objectives/authority-anchor.jsonl`)) {
  fs.copyFileSync(`${H}/sovereign/objectives/authority-anchor.jsonl`, `${OBJ}/authority-anchor.jsonl`);
}

// קריאת P#1 החיה (לזריעה-נאמנה בעותקים)
const liveBookRaw = fs.readFileSync(`${H}/sovereign/preferences/preferences.jsonl`, "utf8");
const liveBook = liveBookRaw.trim().split("\n").map((l) => JSON.parse(l));
const liveP1 = liveBook.filter((e: any) => e.kind === "PREFERENCE-UPDATE" && e.subject === "grid-pool-seed").slice(-1)[0];
// §R208R — זריעה-נאמנה: הספר-המלא (שרשרת-תקפה), לא רק-הרשומה-האחרונה
const livePrefState = fs.readFileSync(`${H}/sovereign/preferences/state.json`, "utf8");

// תצורת-עולם
type WorldCfg = {
  wave: boolean; // האם הגל נמדד
  pref: "live" | "none" | "expired" | "release-streak";
  sbd: { value: number; unit?: string; ageSec?: number } | null; // מדידת-SBD (מתויג-מעבדה)
  tamper?: "options" | "stale" | "authority" | "delete-objectives";
};
const CFG: Record<string, WorldCfg> = {
  "W0-no-wave": { wave: false, pref: "live", sbd: { value: 0.015 } },
  "W-A-live-truth": { wave: true, pref: "live", sbd: { value: 0.015 } }, // העולם החי הנמדד היום
  "W-B1-release-sbd-funded": { wave: true, pref: "release-streak", sbd: { value: 3.5 } }, // משתנה-יחיד: SBD ממומן + שחרור-I7
  "W-B1b-release-sbd-unfunded": { wave: true, pref: "release-streak", sbd: { value: 0.015 } }, // המודל לבדו מדכא
  "W-B2-tampered-pref": { wave: true, pref: "live", sbd: { value: 0.015 }, tamper: "options" },
  "W-B2b-tampered-nopref": { wave: true, pref: "none", sbd: { value: 0.015 }, tamper: "options" },
  "W-B3-stale-nopref": { wave: true, pref: "none", sbd: { value: 0.015 }, tamper: "stale" },
  "W-B5-nopref-sbd-funded": { wave: true, pref: "none", sbd: { value: 3.5 } },
  "W-B6-resource-depleted": { wave: true, pref: "live", sbd: { value: 0.015 } }, // אבל idle<200 — ראה inp
  "W-B7-authority-forbidden": { wave: true, pref: "none", sbd: { value: 3.5 }, tamper: "authority" },
  "W-B8-pref-expired": { wave: true, pref: "expired", sbd: { value: 0.015 } },
  "W-B9-model-missing": { wave: true, pref: "none", sbd: { value: 0.015 }, tamper: "delete-objectives" },
  "W-B10-unit-mismatch": { wave: true, pref: "none", sbd: { value: 0.0625, unit: "USD/STEEM" } },
  "W-B11-stale-measurement": { wave: true, pref: "none", sbd: { value: 0.015, ageSec: 7200 } },
  "W-B12-missing-measurement": { wave: true, pref: "none", sbd: null },
};
const cfg = CFG[world];
if (!cfg) {
  console.error(JSON.stringify({ error: `unknown world ${world}` }));
  process.exit(2);
}

// זריעת-ספר-העדפות לפי-העולם
function seedPreferences(): void {
  const now = Date.now();
  if ((cfg.pref === "live" || cfg.pref === "release-streak") && liveP1) {
    // release-streak: הספר-החי-המלא (§R208R — שרשרת-תקפה) ואז מנגנון-I7 החי
    fs.writeFileSync(`${PREF}/preferences.jsonl`, liveBookRaw.endsWith("\n") ? liveBookRaw : liveBookRaw + "\n");
    fs.writeFileSync(`${PREF}/state.json`, livePrefState);
  } else if (cfg.pref === "expired" && liveP1) {
    // פק-תוקף-כנה (§R208R): הספר-המלא + EXPIRE-משורשר-חוקית — השרשרת נשארת תקפה
    fs.writeFileSync(`${PREF}/preferences.jsonl`, liveBookRaw.endsWith("\n") ? liveBookRaw : liveBookRaw + "\n");
    fs.writeFileSync(`${PREF}/state.json`, livePrefState);
    process.env.PREF_DIR = PREF;
  } else {
    fs.writeFileSync(`${PREF}/preferences.jsonl`, "");
    fs.writeFileSync(`${PREF}/state.json`, JSON.stringify({ chain: { lastEntryHash: null, count: 0 }, suspended: false, conditionStreaks: {}, updatedAt: new Date().toISOString() }, null, 1));
  }
}
seedPreferences();

// טמפר לפי-העולם (בעותקים בלבד)
if (cfg.tamper === "options") {
  const p = `${OBJ}/options.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.decision = "TAMPERED-IN-LAB — שינוי-בית אחד חוקי-מעבדה";
  fs.writeFileSync(p, JSON.stringify(j, null, 1));
}
if (cfg.tamper === "stale") {
  for (const f of MODEL_FILES) {
    const p = `${OBJ}/${f}`;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j._meta.builtAt = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    fs.writeFileSync(p, JSON.stringify(j, null, 1));
  }
}
if (cfg.tamper === "authority") {
  const p = `${OBJ}/authority-map.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const v = j.verdicts.find((x: any) => x.domain === "תנועת-הון");
  if (v) v.may = "לא — מעבדה: ההזרמה אסורה בעולם-זה";
  fs.writeFileSync(p, JSON.stringify(j, null, 1));
  // §VIII R208R — עיגון-חוקי של השינוי (מהלך-סמכות-לגיטימי: מי-שינה-מפה-מעדכן-עיגון).
  // בלי-זה מוטציה נדחית AUTHORITY-MAP-UNANCHORED. כאן מדמים את-הנתיב-החוקי
  // כדי לבחון את BLOCKED_BY_AUTHORITY עצמו על-מפה-מאומתת-מקור.
  const { createHash } = await import("node:crypto");
  const shaBuf = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const anchorPath = `${OBJ}/authority-anchor.jsonl`;
  const anchorLines = fs.existsSync(anchorPath) ? fs.readFileSync(anchorPath, "utf8").trim().split("\n").filter(Boolean) : [];
  const prevA = anchorLines.length ? JSON.parse(anchorLines[anchorLines.length - 1]!).entryHash : "GENESIS";
  const base = { seq: anchorLines.length + 1, at: new Date().toISOString(), authorityMapSha256: shaBuf(fs.readFileSync(p)), by: `lab-legal-reanchor:${world}`, trace: "1a10dda614a62251", law: "שינוי-חוקי-מעבדה — עיגון-מעודכן", prevHash: prevA };
  fs.appendFileSync(anchorPath, JSON.stringify({ ...base, entryHash: shaBuf(JSON.stringify(base)) }) + "\n");
}
if (cfg.tamper === "delete-objectives") {
  fs.rmSync(`${OBJ}/objectives.json`);
}

// עכשיו — לאחר-כל-הכנות — היבוא הדינמי עם הסביבה המבודדת
process.env.OBJ_DIR = OBJ;
process.env.PREF_DIR = PREF;
process.env.PROJ_HOME = H;

const { objectiveDecisionView, appendPrediction, closePrediction, predictWaveDecision } = await import(`${H}/mini-services/objective-consumer.ts`);
const { waveDecision } = await import(`${H}/mini-services/wave-decision.ts`);
const prefsMod = await import(`${H}/mini-services/preferences.ts`);

// §XII — שחרור-העדפה בראיה-סותרת (3 מדידות-חיוביות רצופות — מנגנון-I7 החי)
let releaseTrace: string[] = [];
if (cfg.pref === "release-streak") {
  for (let i = 1; i <= 3; i++) {
    const r = prefsMod.notePreferenceCondition("grid-pool-seed", true);
    releaseTrace.push(`streak#${i}:${r.wrote ?? r.why ?? "none"}`);
  }
}
// §R208R — פק-תוקף-כנה: EXPIRE-משורשר-חוקית על הספר-המלא (לא שבירת-שדה-כמו-ב-r208)
if (cfg.pref === "expired") {
  const r = prefsMod.appendPreference({ kind: "PREFERENCE-EXPIRE", subject: "grid-pool-seed", reason: "מעבדה: פק-תוקף-כנה — הזמן-עבר על ההעדפה-הפעילה (שרשרת-תקפה)", authority: "ADVISORY-ONLY" });
  releaseTrace.push(`expired:${r.ok ? "EXPIRE-written" : (r as any).why}`);
}

// בניית-הקלטות (מתויג-מעבדה; הערכים החיים של היום ב-W-A)
const waveSteem = 200;
const idleNow = world === "W-B6-resource-depleted" ? 100 : cfg.wave ? 210 : 1.377;
const totalSteemNow = idleNow + 9.415;
const waveDelta = cfg.wave ? 220 : 0;
const measCredible = true;
const today = "2030-01-01"; // אין-זרם-היום בעולם-המעבדה

const prefEntry = prefsMod.activeDown("grid-pool-seed");
const prefDown = prefEntry
  ? { seq: prefEntry.seq, expiresAt: String(prefEntry.expiresAt ?? ""), evidenceBooks: (prefEntry.evidence ?? []).map((e) => e.book.split("/").pop() ?? e.book), confidence: String(prefEntry.confidence ?? "medium") }
  : null;
const sbdNow = cfg.sbd
  ? { value: cfg.sbd.value, unit: cfg.sbd.unit ?? "SBD", at: new Date(Date.now() - (cfg.sbd.ageSec ?? 0) * 1000).toISOString() }
  : null;
const { view, reject, detail } = objectiveDecisionView("grid-pool-seed", {
  measuredSbd: sbdNow,
  prefEvidence: prefEntry?.evidence ?? [],
  requireResource: true,
});
  const waveFires = measCredible && waveDelta >= waveSteem && idleNow >= waveSteem && today !== "2026-10-05";
const expectedDecision = predictWaveDecision({ waveFires, prefDown: !!prefDown, view, viewRejectReason: reject, authorityForbidden: view?.authorityStatus?.forbidden === true });

// §VII — תחזית לפני-ההכרעה (רק כשהגבול נחצה — כמו ב-decide החי)
let prediction: { ok: true; entry: any } | { ok: false; why: string } = { ok: false, why: "boundary-not-crossed" };
const tPred = new Date().toISOString();
if (waveFires) {
  prediction = appendPrediction({
    kind: "PREDICTION",
    predictionId: `PRED-LAB-${world}-${Date.now()}`,
    boundary: "lab/replay#liquidity-wave",
    objectiveId: view?.objectiveId ?? "UNAVAILABLE",
    objectiveSnapshotHash: view ? Object.values(view.modelHashes).join("|").slice(0, 64) : undefined,
    resourceSnapshotHash: `lab:${JSON.stringify({ idleNow, totalSteemNow, waveDelta, sbd: sbdNow?.value ?? null })}`,
    decisionInputHash: `lab:${JSON.stringify({ prefDown: !!prefDown, reject, seedVerdict: view?.priority?.verdictForSeed ?? null })}`,
    expectedDecision,
    expectedReason: view ? `${view.priority.rank} → ${view.priority.verdictForSeed}` : `reject=${reject}:${String(detail).slice(0, 100)}`,
    expectedOutcome: view?.falsifier?.delta ?? "אין-תצוגה",
    falsifier: "PREDICTION-DIVERGENCE: ההכרעה ≠ expectedDecision",
    confidence: "medium",
  });
}

// ההכרעה — אותה-פונקציה טהורה שהדיבון החי מריץ
const wd = waveDecision({
  now: new Date().toISOString(), today,
  measCredible, waveDelta, idleNow, totalSteemNow,
  lastStreamDay: null,
  waveSteem, share: 0.2,
  prefDown, view, viewRejectReason: reject,
});

// סגירת-התחזית מול-ההכרעה
let closed: any = { ok: false, why: "prediction-not-written" };
if (prediction.ok) {
  closed = closePrediction(prediction.entry.predictionId, {
    actualDecision: wd.kind,
    divergence: wd.kind === prediction.entry.expectedDecision ? undefined : `expected=${prediction.entry.expectedDecision} · actual=${wd.kind}`,
  });
}

// מיקרו-בדיקות-חוזה (§XVII): אין סגירה-כפולה · אין סגירת-זר
const micro: Record<string, unknown> = {};
if (prediction.ok) {
  micro.doubleClose = closePrediction(prediction.entry.predictionId, { actualDecision: wd.kind });
  micro.closeForeignId = closePrediction("PRED-NEVER-EXISTED", { actualDecision: wd.kind });
}

// השוואת-הפוך (התחזית נכתבה לפני ההכרעה?): סדר-הספר מוכיח
const bookRaw = fs.existsSync(`${OBJ}/predictions.jsonl`) ? fs.readFileSync(`${OBJ}/predictions.jsonl`, "utf8").trim().split("\n") : [];
const book = bookRaw.filter(Boolean).map((l) => JSON.parse(l));
const predAt = book.find((e: any) => e.kind === "PREDICTION")?.at ?? null;
const closeAt = book.find((e: any) => e.kind === "PREDICTION-CLOSE")?.at ?? null;
const predictionBeforeDecision = predAt != null && closeAt != null && predAt <= closeAt;

void tPred;
console.log(JSON.stringify({
  world, cfg,
  waveFires, prefDown: !!prefDown, sbd: sbdNow?.value ?? null, sbdUnit: sbdNow?.unit ?? null,
  viewReject: reject, viewDetail: detail, viewEpistemic: view?.epistemicStatus ?? null,
  seedVerdict: view?.priority?.verdictForSeed ?? null, resourceStatus: view?.resourceRequirement?.status ?? null,
  authorityForbidden: view?.authorityStatus?.forbidden ?? null,
  opportunityCostOrdinal: view?.opportunityCost?.ordinal ?? null,
  expectedDecision, decision: wd.kind, decisionReason: wd.reason.slice(0, 240),
  predictionWritten: prediction.ok, predictionWhy: prediction.ok ? undefined : (prediction as any).why,
  predictionClosed: closed.ok === true, match: closed.ok === true ? closed.entry.match : null,
  predictionBeforeDecision, predAt, closeAt,
  bookSeq: book.length, releaseTrace,
  micro: { doubleCloseRejected: micro.doubleClose?.ok === false, closeForeignRejected: micro.closeForeignId?.ok === false },
}));
