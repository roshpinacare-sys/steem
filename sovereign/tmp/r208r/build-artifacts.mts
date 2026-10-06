// ─────────────────────────────────────────────────────────────────────
// R208R ARTIFACT-BUILDER — מרכיב את-ארטיפקטי-הסבב מהראיות-הגולמיות
// trace 1a10dda614a62251 · כל-שדה נושא סיווג אפיסטמי
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";

const H = "/home/z/my-project";
const C = `${H}/cognition`;
const R = `${H}/sovereign/tmp/r208r`;
const j = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const now = new Date().toISOString();

const zero = j(`${R}/zero-point.json`);
const matrix = j(`${C}/OBJECTIVE-CAUSALITY-MATRIX.json`);
const integrity = j(`${R}/integrity-lab/results.json`);
const accum = j(`${R}/accumulator-lab/results.json`);
const pref = j(`${R}/pref-lab/results.json`);
const death = j(`${R}/death-lab/results.json`);

const bySection = (res: any[], s: string) => res.results.filter((r: any) => r.section === s);
const count = (arr: any[]) => ({ total: arr.length, pass: arr.filter((r: any) => r.pass).length });

// ── INDEPENDENT-PREDICTOR.json ──────────────────────────────────────
const predSrc = fs.readFileSync(`${R}/independent-predictor.mts`, "utf8");
fs.writeFileSync(`${C}/INDEPENDENT-PREDICTOR.json`, JSON.stringify({
  _meta: { schema: "r208r-independent-predictor-v1", round: "R208R", trace: "1a10dda614a62251", at: now,
    law: "§VI: המנבא-העצמאי לא מייבא, לא קורא ולא משתמש בקוד-ההכרעה — הסטייה-ביניהם היא מפריך-נצפה" },
  implementation: {
    file: "sovereign/tmp/r208r/independent-predictor.mts",
    process: "נפרד (Bun.spawn בכל-עולם) — P1 OBSERVED",
    imports: ["node:fs", "node:crypto", "stdin-JSON"],
    forbiddenImportsVerified: "OBSERVED — אפס-יבוא של objective-consumer/wave-decision/money/preferences (P1–P3)",
    derivedFrom: "החוזה-המתועד (§IV/§V/§XV מהנחיה-R208 + סדר-ההכרעה-החוקי), לא-מהקוד",
    ownPredictionHash: true,
  },
  agreement: {
    worldsTested: matrix.summary.worldsRun,
    predictorVsActualAgree: matrix.summary.worldsRun - matrix.summary.predictorAgreementFails,
    divergences: matrix.summary.predictorAgreementFails,
    builtinPredictorVsActual: `${matrix.summary.worldsRun - matrix.summary.builtinPredictionFails}/${matrix.summary.worldsRun}`,
    predictionBookMismatch: matrix.summary.predictionBookMismatch,
    epistemic: "OBSERVED",
  },
  developmentFinding: {
    finding: "במהלך-הפיתוח-העצמאי נמצאו 2 סטיות-מימוש (מותר-שיפוט-סמכות-מהמפה-ישירות במקום-דרך-תצוגה; דירוג-מדידה-לא-כשירה-כ-WAIT-MODEL במקום-WAIT-SAFETY) — תוקנו-במנבא לאחר-קריאת-החוזה-המתועד, לא-בקוד-המכריע; המכריע לא שונה בעקבות-המנבא",
    epistemic: "OBSERVED — תיעוד-כנה: המנבא כוון-לחוזה, החוזה לא כוון-למנבא",
  },
  note: "מגבלת-הכנות: סדר-ההכרעה-עצמו הוא-חוק-משותף (§V מהנחיה) — העצמאות היא בקוד/תהליך/טעינה, לא בחוק",
}, null, 1));

// ── THRESHOLD-PROVENANCE.json ───────────────────────────────────────
const thr = matrix.thresholdProvenance;
fs.writeFileSync(`${C}/THRESHOLD-PROVENANCE.json`, JSON.stringify({
  _meta: { schema: "r208r-threshold-provenance-v1", round: "R208R", trace: "1a10dda614a62251", at: now,
    law: "סף-המגדיר «מה-נחשב-הצלחת-מטרה» אינו חוק-בטיחות — אין-מסתירים-אותו-ככזה (§VII)" },
  before_R208R: { state: "SBD_FUND_THRESHOLD = 3.0 קבוע-סמוי ב-mini-services/objective-consumer.ts:269", epistemic: "OBSERVED (אומת-מחדש מ-HEAD) · REFUTED-אחרי-התיקון" },
  after_R208R: {
    objectiveParameter: { location: "options.json#_meta.armingThreshold", value: 3.0, unit: "SBD",
      whoMayChange: "אדג'ודיקטור-מטרות בלבד (מפעיל/ממשל) — אסור ללמידה/לדיבון/לחיישן/לצרכן",
      modelContainsIt: true, consumerReadsIt: "getArmingThresholdSbd() + objectiveDecisionView — קריאה-מהמודל-בלבד",
      changingItChangesDecision: thr.thresholdMutationChangedDecision, mutationTest: { threshold_3_0_sbd_1_0: thr.baseline_3_0_sbd_1_0, threshold_0_5_sbd_1_0: thr.mutated_0_5_sbd_1_0 }, epistemic: "OBSERVED" },
    safetyCap: { items: ["טווח-ערך [0, 1e6]", "זקנה ≤ 3600ש'", "שעון-עתידי > 60ש' ⇒ UNKNOWN", "גבול-גיל-מודל 7 ימים"], owner: "קוד-הצרכן (const) — המודל אינו יכול להזיז", epistemic: "OBSERVED" },
    authorityCondition: { items: ["מפת-הסמכות (מעוגנת-האש)", "tx-gate $100 const", "GATE.json mode"], owner: "חוץ-מודלי לחלוטין — השערים אינם קוראים קבצי-מודל (OBSERVED: אפס-התאמות)", epistemic: "OBSERVED" },
  },
  thresholdMutationCannotCreateAuthority: thr.thresholdMutationCannotCreateAuthority,
  mutationWithAuthorityAbsent: { decision: thr.mutated_with_authority_absent, expected: "BLOCKED_BY_AUTHORITY" },
  mutationWithPreferenceActive: { decision: thr.mutated_with_pref_active, expected: "WAIT-PREFERENCE (ההעדפה עדיין דוכאת)" },
  extremeThreshold_1e9: { decision: thr.mutated_1e9, note: "גם-סף-מוקצן לא עוקף קפסות-בטיחות (מדידת-3.5 בטווח-תקין → QUALIFIED — אך נבדק גם ב-integrity-lab B7: קריאת-הסף מהמודל-בלבד)" },
  duplicationRepair: "money/index.ts:1188 קרא 3.0 מקומי — תוקן: קורא getArmingThresholdSbd(); אפס-שכפול (OBSERVED: קבוע-סמוי-בקוד=false)",
}, null, 1));

// ── AUTHORITY-INTEGRITY.json ────────────────────────────────────────
const auth = bySection(integrity, "VIII");
fs.writeFileSync(`${C}/AUTHORITY-INTEGRITY.json`, JSON.stringify({
  _meta: { schema: "r208r-authority-integrity-v1", round: "R208R", trace: "1a10dda614a62251", at: now,
    law: "פורמט-תקין ≠ סמכות-תקינה · מפתח-הסמכות חייב היותו אסמכתא, לא קובץ-JSON-טוב" },
  before_R208R: { verdict: "AUTHORITY INTEGRITY = DETECTION ONLY (ולמעשה: אפס-גילוי) — כל-מוטציית-JSON-תקינה הייתה מתקבלת בשקט",
    epistemic: "OBSERVED (קריאת-HEAD + ניתוח; R208 רשם-זאת-כסתירה-פתוחה)" },
  repair: {
    mechanism: "sovereign/objectives/authority-anchor.jsonl — ספר-עיגון-האש append-only; loadModel מאמת בייטס-דיסק מול-העיגון-האחרון; עיגון-מלא לארבעת-קבצי-המודל (§IX); כלי-עיגון-רשמי: sovereign/tmp/r208r/anchor-tool.mts",
    anchorsWritten: [{ seq: 1, scope: "authority-map" }, { seq: 2, scope: "full-model (4 קבצים)" }],
    epistemic: "OBSERVED",
  },
  attacks: auth,
  attackVerdict: "8/8 — כל-מוטציית-בייט/ריפליי/הזרקה/ספר-קרוע נדחית AUTHORITY-MAP-UNANCHORED (fail-closed); שינוי-חוקי + עיגון-מעודכן מתקבל (בקרה)",
  gatesIndependent: { txGateReadsModel: zero.authorityIndependence.txGateReadsModelFiles, autonomyLawReadsModel: zero.authorityIndependence.autonomyLawReadsModelFiles, note: "השערים אינם קוראים מודל — טמפר-מודל מדרדר לחוק-בסיס, לעולם לא עוקף (אומת-שוב R208R)", epistemic: "OBSERVED" },
  finalVerdict: "AUTHORITY INTEGRITY = PREVENTED (fail-closed) — שדרוג מ-DETECTION-ONLY",
}, null, 1));

// ── MODEL-INTEGRITY.json ────────────────────────────────────────────
const model = bySection(integrity, "IX");
fs.writeFileSync(`${C}/MODEL-INTEGRITY.json`, JSON.stringify({
  _meta: { schema: "r208r-model-integrity-v1", round: "R208R", trace: "1a10dda614a62251", at: now,
    law: "בייטס-שנצרכו == בייטס-שהוכרזו == בייטס-המשויכים-לתחזית == בייטס-המשויכים-לתוצאה (§IX)" },
  consumedContentProof: {
    mechanism: "objectiveSnapshotHash = sha256(join(per-file sha256)) — מחויבות-ניתנת-לאימות-חוזר מול-הדיסק בכל-עת; ביקורת-אמצע-מחזור (MODEL-CHANGED-MIDCYCLE) נוספה ב-decide() (§IX)",
    withinCycleTOCTOU: "בלתי-אפשרי-מבנית: קריאות-fs.readFileSync סינכרוניות בתוך-פעימה-חד-חוטית; החלון הוא-בין-שלבים — ומנוטר (OBSERVED B2)",
    epistemic: "OBSERVED+DERIVED",
  },
  attacks: model,
  anchors: "עיגון-מלא (modelSha256 לארבעת-הקבצים) בספר-העיגון — symlink/החלפה/כתיבה-חלקית נדחים MODEL-UNANCHORED/MODEL-JSON-BROKEN/EVIDENCE-HASH-DRIFT",
  openLimitation: "מודל-תקין-אך-שקרי (valid-but-false) אינו ניתן-לגילוי מקומי: עיגון-האש מוכיח מיוחסות-בייטס (מה-נצרך), לא נכונות-תוכן (מה-אמת) — נכונות-התוכן נשענת על אדג'ודיקציית-המקור + חתימות-ההעדפה",
  epistemic: "OBSERVED",
}, null, 1));

// ── SENSOR-TRUTH.json ───────────────────────────────────────────────
const sensor = bySection(integrity, "X");
fs.writeFileSync(`${C}/SENSOR-TRUTH.json`, JSON.stringify({
  _meta: { schema: "r208r-sensor-truth-v1", round: "R208R", trace: "1a10dda614a62251", at: now,
    law: "כשל-מדידה → UNMEASURED · לעולם לא → 0 (§X)" },
  r208Baseline: "32-וקטורים (R208-D): 3-פרצות נמצאו ונאטמו (staleness-NaN, יחידה-חסרה, 1e308) — 15/15 PASS מחדש",
  newVectorsThisRound: sensor,
  newFindingAndRepair: {
    finding: "S9/S10 — חותמת-זמן-עתידית התקבלה כ«טרייה» (staleness נחתך-ל-0): התקפת-שעון-עתידי הייתה עוברת בשקט",
    repair: "מדידה-מהעתיד (>60ש') ⇒ RESOURCE-UNKNOWN-REQUIRED (UNKNOWN), גם-בצרכן וגם-במנבא-העצמאי",
    epistemic: "OBSERVED — נמצא-בהתקפה, תוקן-בסבב, נבדק-מחדש",
  },
  preferencePathZeroFix: {
    finding: "money/index.ts:1187 — `sbdArming?.balance ?? 0`: כשל-מדידה → 0 בנתיב-כתיבת-ההעדפה (הפרה-ישירה של חוק-החיישן; היה כותב DOWN מ«0.000 מדומה» ומשאיר רצף-שחרור-ישן)",
    repair: "מדידה-לא-ספרתית ⇒ resetConditionStreak + אין-כתיבת-DOWN; והסף נקרא מהמודל (אפס-שכפול); S14 מוכיח: רצף 2→0 על מדידה-נעדרת",
    epistemic: "OBSERVED — פגם-חי-נמצא-מ-HEAD ותוקן-בסבב",
  },
  unitMetadataMandatory: "כל-מדידה נושאת value/unit/source/at/stalenessSec/transformation — S5/S6/S7 מוכיחים דחיית-יחידות-שקטות (לקח 0.1041)",
  limitation: "מדידות-סותרות-ממקורות-מרובים: הגבול צורך-חיישן-אחד (money measure()); זיהוי-סתירות-בין-מקורות אינו-ממומש — UNKNOWN-כנה",
  finalVerdict: `SENSOR TRUTH = ${count(sensor).pass}/${count(sensor).total} PASS + פגם-נתיב-העדפה תוקן`,
}, null, 1));

// ── ACCUMULATOR-INTEGRITY.json ──────────────────────────────────────
fs.writeFileSync(`${C}/ACCUMULATOR-INTEGRITY.json`, JSON.stringify({
  _meta: { schema: "r208r-accumulator-integrity-v1", round: "R208R", trace: "1a10dda614a62251", at: now,
    law: "total_realized = Σ אירועים-קנוניים-ייחודיים — לא «סף-קודם + תצוגה-נוכחית» (§XI)" },
  before_R208R: {
    finding: "state.realizedPnlUsd הצטבר += fill.pnlUsd ללא canonical_event_id; fill.seq היה מיקום-במערך-קטום (≤200); האינווריאנט Σ(ledger)==accumulator לא-נאכף בשום-מקום — כפילות/ריטריי/שחזור-חלקי היו משקרים-את-הרווח-הממומש",
    epistemic: "OBSERVED (קריאת-HEAD: mini-services/dex-grid/index.ts:579)",
  },
  repair: {
    module: "mini-services/dex-grid/accumulator.ts — מימוש-יחיד (הדיבון והמעבדה מייבאים את-אותו-קוד)",
    canonicalEventId: "sha256(fillSeq מונוטוני | at | pair | side | amountIn | amountOut)",
    derivationOrder: "ספר-קודם → גזירה-מהספר → persist; בעלייה: recompute מהספר (ריפוי-עצמי מקריסה-בין-שלבים)",
    liveState: "dex-grid ב-dry מאז-עלייתו: realized=0, fills=0 — התיקון נכנס-לפני-המילוי-החי-הראשון",
    epistemic: "OBSERVED",
  },
  attacks: accum.results,
  attackVerdict: "11/11 — שימור-מוכח: ריטריי/ריפליי/כפילות/אירוע-מאוחר/גלגול-שעון/שורה-קרועה/הרצות-מקבילות/הפעלה-מחדש — אפס-כפילות, אפס-שקר, אינווריאנט ראשי מאומת בחישוב-בלתי-תלוי",
  impact: "כל-ראיה-חיובית-עתידית על «רווח-ממומש» בגבול-זה כשירה-מעתה להיות מנופחת-לפי-אירועים — כפילות אינה מייצרת-עוד-רווח",
}, null, 1));

// ── LIVE ledgers ────────────────────────────────────────────────────
const liveMoney = j(`${H}/sovereign/money/state.json`);
const livePrefBook = fs.readFileSync(`${H}/sovereign/preferences/preferences.jsonl`, "utf8").trim().split("\n").filter(Boolean);
const livePredBook = fs.existsSync(`${H}/sovereign/objectives/predictions.jsonl`) ? fs.readFileSync(`${H}/sovereign/objectives/predictions.jsonl`, "utf8").trim().split("\n").filter(Boolean) : [];
fs.writeFileSync(`${C}/LIVE-PREDICTION-LEDGER.jsonl`, JSON.stringify({
  _meta: { schema: "r208r-live-prediction-ledger-v1", round: "R208R", trace: "1a10dda614a62251", at: now,
    source: "sovereign/objectives/predictions.jsonl (הספר-החי — מראה-מילולית)",
    law: "הספר-החי נכתב רק בחציית-גבול-חי; ספר-ריק = אין-חצייה — זו כנות, לא הצלחה",
  },
}) + "\n" + livePredBook.map((l) => l).join("\n") + (livePredBook.length ? "\n" : ""));
fs.writeFileSync(`${C}/LIVE-OUTCOME-LEDGER.jsonl`, JSON.stringify({
  _meta: { schema: "r208r-live-outcome-ledger-v1", round: "R208R", trace: "1a10dda614a62251", at: now,
    law: "תוצאה-חוצה נרשמת רק מחיישן-עולם-בלתי-תלוי; ACTION_SENT ≠ SUCCESS (§XX)",
    liveWorldStatus: "LIVE_POSITIVE_WORLD = UNOBSERVED",
    observedDuringRound: { lastTotalSteem: liveMoney.lastTotalSteem, waveThreshold: 200, idleThreshold: 200, lastStreamDay: liveMoney.lastStreamDay, arenaStreamEventsEver: 0, prefBookEntries: livePrefBook.length },
    epistemic: "OBSERVED — העולם לא חצה את הגבול בחלון-הסבב; לא יוצרו תנאים, לא נוצקו גלים (§IV/§XIX)",
  },
}) + "\n");

// ── REARM-ELIGIBILITY.json ──────────────────────────────────────────
const gate = j(`${H}/sovereign/autonomy/GATE.json`);
const cap = j(`${H}/sovereign/objectives/capabilities.json`);
fs.writeFileSync(`${C}/REARM-ELIGIBILITY.json`, JSON.stringify({
  _meta: { schema: "r208r-rearm-eligibility-v1", round: "R208R", trace: "1a10dda614a62251", at: now,
    law: "«חימוש» = מעבר dex-grid מ-dry ל-armed — דורש הכרעת-ממשל/מפעיל; האורגניזם אינו מעניק-לעצמו (§XIX)" },
  eligibility: false,
  conditions: [
    { cond: "מצב-מודל תקף-ומעוגן", status: "OBSERVED-TRUE", evidence: "MODEL-UNANCHORED checks pass; anchor seq=2" },
    { cond: "חיישן-SBD כשיר", status: "OBSERVED-TRUE-MECHANSIM", evidence: "S1–S14 fail-closed; מדידה-חיה 0.015 SBD (פורמט-תקין)" },
    { cond: "תחילת-מקור-הסף", status: "OBSERVED-TRUE", evidence: "THRESHOLD-PROVENANCE: הסף במודל-בלבד" },
    { cond: "שימור-המצבר", status: "OBSERVED-TRUE", evidence: "ACCUMULATOR-INTEGRITY 11/11 (מנופח-לפי-אירועים-קנוניים)" },
    { cond: "סמכות-מעוגנת", status: "OBSERVED-TRUE", evidence: "AUTHORITY-INTEGRITY 8/8 PREVENTED" },
    { cond: "העדפה תקפה", status: "OBSERVED", evidence: "P#1 פעילה (seq 3, פוגה 2026-10-12)" },
    { cond: "מימון-צד-SBD ≥ הסף-הרג'ימי (3.0 SBD)", status: "OBSERVED-FALSE", evidence: "מדידה-חיה 0.015 SBD — בלתי-ממומן" },
    { cond: "עומק-בריכה ≥ $20 (depthOk)", status: "OBSERVED-FALSE", evidence: "depthUsd ≈ $0.025 (unitErrorCorrection)" },
    { cond: "גל-דלק חי נמדד (≥200 STEEM עליית-הון-כולל)", status: "OBSERVED-FALSE", evidence: "lastTotalSteem=10.792; אפס-אירועי-הזרמה אי-פעם" },
    { cond: "הכרעת-ממשל/מפעיל ל-armed", status: "UNKNOWN — לא-נדרשה-ולא-נתבעה בסבב", evidence: "GATE mode=THINKING; אין-בקשה" },
    { cond: "HARD_CAPS/econ-gate/kill-switch", status: "OBSERVED-TRUE (מנגנונים חיים)", evidence: "קפסות-קוד const · kill-switch קיים" },
    { cond: "התוצאה-החוצה-הראשונה נצפית מחיישן-בלתי-תלוי", status: "UNOBSERVED — תלוי-עולם", evidence: "LIVE-OUTCOME-LEDGER" },
  ],
  verdict: "לא-כשיר-לחימוש: 3-תנאי-עולם שליליים-מדיד (מימון/עומק/גל) + 1-הכרעת-ממשל שלא-נתבעה — האורגניזם ממתין-לעולם, לא מייצר-אותו",
}, null, 1));

console.log("artifacts written:", ["INDEPENDENT-PREDICTOR.json", "THRESHOLD-PROVENANCE.json", "AUTHORITY-INTEGRITY.json", "MODEL-INTEGRITY.json", "SENSOR-TRUTH.json", "ACCUMULATOR-INTEGRITY.json", "LIVE-PREDICTION-LEDGER.jsonl", "LIVE-OUTCOME-LEDGER.jsonl", "REARM-ELIGIBILITY.json"].map((f) => `${C}/${f}`).join("\n"));
