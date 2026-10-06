// ─────────────────────────────────────────────────────────────────────
// OBJECTIVE-CONSUMER — חוזה-צריכת-מטרות (R208, trace 1a10d7a051e822d1)
//
// R207 הוכיח שהאורגניזם יודע לייצג מטרות/משאבים/אלטרנטיבות/עלות-הזדמנות.
// R208 בודק האם המודל הזה גורם להחלטה-שונה כשהמציאות משתנה.
//
// החוזה (§IV): שכבת-ההחלטה צורכת את מודל-המטרות רק דרך ממשק-צר — תצוגה
// עם שדות-החלטה בלבד. הצרכן דוחה (fail-closed): מודל-ישן · סכמה-שגויה ·
// האש-שבור · סתירת-סמכות לא-פתורה · היוחסות-מזויפת · מטרה בלי מפריך ·
// משאב UNKNOWN כשההכרעה דורשת אותו.
//
// הפרדת-סמכות (§V): objective → preference · authority → permission.
// המודל לעולם לא מעניק סמכות. הוא משפיע על העדפה (דיכוי-בלבד, I3).
//
// תחזית-טרום-פעולה (§VII): ספר-תחזיות משורשר — התחזית נכתבת לפני-ההכרעה
// (flush-לדיסק), וההכרעה נסגרת מולה. אין הסבר-בדיעבד ואין קשירה-רטרואקטיבית.
//
// כנות-חיישנים (§XV): כל מספר-החלטה נושא יחידה/מקור/זמן/זקנה/טרנספורמציה.
// אסור ל-0.1041 להחליף בשקט משמעות מ-SBD/STEEM ל-USD/STEEM.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import { createHash } from "node:crypto";

const OBJ_DIR = process.env.OBJ_DIR ?? "/home/z/my-project/sovereign/objectives";
const HOME = process.env.PROJ_HOME ?? "/home/z/my-project";

const MODEL_FILES = ["objectives.json", "options.json", "capabilities.json", "authority-map.json"] as const;
const KNOWN_SCHEMAS = new Set(["sovereign-objectives-v1", "sovereign-options-v1", "sovereign-capabilities-v1", "sovereign-authority-map-v1"]);
// תוקף-המודל: חלון-הנחיתות שהמודל מתאר (06–11/10) — אחריו הוא ישן-מטבע.
const MODEL_MAX_AGE_DAYS = 7;

export interface UnitValue {
  value: number;
  unit: string; // STEEM | SBD | SBD/STEEM | USD/STEEM | WSTEEM | VESTS ...
  source: string;
  at: string;
  stalenessSec: number | null;
  transformation: string;
}

export interface ObjectiveView {
  subject: string;
  objectiveId: string; // מזהה-מודל (לא המצאה — מ-objectives.json/options.json)
  priority: { rank: string; verdictForSeed: string; source: string };
  metric: string;
  target: string;
  threshold: { seedWsteem: UnitValue; depthUsd: UnitValue } | null;
  resourceRequirement: { status: "SUFFICIENT" | "INSUFFICIENT" | "UNKNOWN"; why: string; measured: UnitValue | null };
  opportunityCost: { actionA: string; actionB: string; foregone: string; learningValue: string; risk: string; ordinal: "HIGHER" | "LOWER" | "UNKNOWN"; source: string };
  alternative: string[];
  falsifier: Record<string, string>;
  confidence: string;
  epistemicStatus: "VERIFIED" | "EVIDENCE-DRIFTED" | "PARTIAL";
  authorityStatus: { domain: string; forbidden: boolean; basis: string; enforcement: string } | null;
  contradictions: { id: string; statement: string }[];
  modelHashes: Record<string, string>;
  measuredAt: string;
}

export interface PredictionEntry {
  seq: number;
  at: string;
  kind: "PREDICTION" | "PREDICTION-CLOSE";
  predictionId: string;
  boundary: string;
  objectiveId?: string;
  objectiveSnapshotHash?: string;
  resourceSnapshotHash?: string;
  decisionInputHash?: string;
  expectedDecision?: string;
  expectedReason?: string;
  expectedOutcome?: string;
  falsifier?: string;
  confidence?: string;
  actualDecision?: string;
  match?: boolean;
  divergence?: string;
  prevHash: string;
  entryHash: string;
}

// ── עזרי-האש ─────────────────────────────────────────────────────────
function sha256Buf(b: Buffer | string): string {
  return createHash("sha256").update(b).digest("hex");
}
function sha256File(p: string): string | null {
  try { return sha256Buf(fs.readFileSync(p)); } catch { return null; }
}

// ── ספר-תחזיות (§VII) — append-only משורשר, fail-closed ──────────────
const PRED_BOOK = `${OBJ_DIR}/predictions.jsonl`;
const PRED_KEYS = new Set(["seq", "at", "kind", "predictionId", "boundary", "objectiveId", "objectiveSnapshotHash", "resourceSnapshotHash", "decisionInputHash", "expectedDecision", "expectedReason", "expectedOutcome", "falsifier", "confidence", "actualDecision", "match", "divergence", "prevHash", "entryHash"]);

function readPredBook(): { entries: PredictionEntry[]; torn: boolean } {
  let raw: string;
  try { raw = fs.readFileSync(PRED_BOOK, "utf8"); } catch { return { entries: [], torn: false }; }
  const entries: PredictionEntry[] = [];
  for (const line of raw.trim() ? raw.trim().split("\n") : []) {
    try { entries.push(JSON.parse(line) as PredictionEntry); } catch { return { entries, torn: true }; }
  }
  return { entries, torn: false };
}
function predHash(e: Omit<PredictionEntry, "entryHash">): string {
  return sha256Buf(JSON.stringify(e));
}

export function appendPrediction(draft: Omit<PredictionEntry, "seq" | "at" | "prevHash" | "entryHash">): { ok: true; entry: PredictionEntry } | { ok: false; why: string } {
  try {
    const { entries, torn } = readPredBook();
    if (torn) return { ok: false, why: "PRED-BOOK-TORN (fail-closed)" };
    for (const e of entries) for (const k of Object.keys(e)) if (!PRED_KEYS.has(k)) return { ok: false, why: `PRED-FORBIDDEN-KEY: ${k}` };
    if (draft.kind !== "PREDICTION") return { ok: false, why: "APPEND-IS-FOR-PREDICTION-ONLY" };
    if (!draft.predictionId || !draft.boundary) return { ok: false, why: "PRED-REQUIRES-ID+BOUNDARY" };
    if (!draft.expectedDecision) return { ok: false, why: "PRED-REQUIRES-EXPECTED-DECISION" };
    if (!draft.falsifier) return { ok: false, why: "PRED-REQUIRES-FALSIFIER (§VII)" };
    const prevHash = entries.length ? entries[entries.length - 1]!.entryHash : "GENESIS";
    const base: Omit<PredictionEntry, "entryHash"> = { ...draft, seq: (entries.length ? entries[entries.length - 1]!.seq : 0) + 1, at: new Date().toISOString(), prevHash };
    const full: PredictionEntry = { ...base, entryHash: predHash(base) };
    fs.mkdirSync(OBJ_DIR, { recursive: true });
    fs.appendFileSync(PRED_BOOK, `${JSON.stringify(full)}\n`, "utf8"); // flush לפני-ההכרעה
    return { ok: true, entry: full };
  } catch (err) {
    return { ok: false, why: `PRED-APPEND-FAILED: ${String((err as Error)?.message ?? err).slice(0, 100)}` };
  }
}

export function closePrediction(predictionId: string, actual: { actualDecision: string; divergence?: string }): { ok: true; entry: PredictionEntry } | { ok: false; why: string } {
  try {
    const { entries, torn } = readPredBook();
    if (torn) return { ok: false, why: "PRED-BOOK-TORN" };
    const open = entries.find((e) => e.kind === "PREDICTION" && e.predictionId === predictionId);
    if (!open) return { ok: false, why: `PREDICTION-NOT-FOUND: ${predictionId}` };
    if (entries.some((e) => e.kind === "PREDICTION-CLOSE" && e.predictionId === predictionId)) return { ok: false, why: "ALREADY-CLOSED" };
    const match = open.expectedDecision === actual.actualDecision;
    const prevHash = entries[entries.length - 1]!.entryHash;
    const base: Omit<PredictionEntry, "entryHash"> = {
      kind: "PREDICTION-CLOSE", predictionId, boundary: open.boundary, objectiveId: open.objectiveId,
      expectedDecision: open.expectedDecision, actualDecision: actual.actualDecision, match,
      ...(actual.divergence ? { divergence: actual.divergence.slice(0, 300) } : {}),
      seq: (entries[entries.length - 1]!.seq ?? 0) + 1, at: new Date().toISOString(), prevHash,
    };
    const full: PredictionEntry = { ...base, entryHash: predHash(base) };
    fs.appendFileSync(PRED_BOOK, `${JSON.stringify(full)}\n`, "utf8");
    return { ok: true, entry: full };
  } catch (err) {
    return { ok: false, why: `PRED-CLOSE-FAILED: ${String((err as Error)?.message ?? err).slice(0, 100)}` };
  }
}

// ── טעינה-ואימות-המודל (§IV — כל דחייה fail-closed) ─────────────────
export type ModelReject =
  | "MODEL-FILE-MISSING" | "MODEL-JSON-BROKEN" | "MODEL-SCHEMA-INVALID"
  | "MODEL-PROVENANCE-BROKEN" | "MODEL-STALE" | "MODEL-OBJECTIVE-MALFORMED"
  | "FALSIFIER-MISSING" | "AUTHORITY-MAP-MALFORMED" | "AUTHORITY-MAP-UNANCHORED" | "MODEL-UNANCHORED"
  | "THRESHOLD-INVALID" | "EVIDENCE-HASH-DRIFT"
  | "RESOURCE-UNKNOWN-REQUIRED" | "UNIT-MISMATCH";

export interface MeasuredResource {
  value: UnitValue;
  requiredUnit: string;
}

export function loadModel(): { ok: true; model: Record<string, any>; hashes: Record<string, string> } | { ok: false; reject: ModelReject; detail: string } {
  const model: Record<string, any> = {};
  const hashes: Record<string, string> = {};
  for (const f of MODEL_FILES) {
    const p = `${OBJ_DIR}/${f}`;
    const raw = fs.readFileSync(p, "utf8"); // חסר ⇒ זריקה ⇒ MODEL-FILE-MISSING בקורא
    hashes[f] = sha256Buf(raw);
    let j: any;
    try { j = JSON.parse(raw); } catch { return { ok: false, reject: "MODEL-JSON-BROKEN", detail: f }; }
    const meta = j?._meta ?? {};
    if (!KNOWN_SCHEMAS.has(meta.schema)) return { ok: false, reject: "MODEL-SCHEMA-INVALID", detail: `${f}: ${meta.schema ?? "אין"}` };
    if (!meta.round || !meta.trace || !meta.builtAt || !meta.law) return { ok: false, reject: "MODEL-PROVENANCE-BROKEN", detail: `${f}: חסר round/trace/builtAt/law` };
    const built = new Date(meta.builtAt).getTime();
    if (Number.isNaN(built)) return { ok: false, reject: "MODEL-PROVENANCE-BROKEN", detail: `${f}: builtAt לא-תקין` };
    if (Date.now() - built > MODEL_MAX_AGE_DAYS * 24 * 3600 * 1000) return { ok: false, reject: "MODEL-STALE", detail: `${f}: builtAt ${meta.builtAt} > ${MODEL_MAX_AGE_DAYS} ימים` };
    model[f.replace(".json", "")] = j;
  }
  // מטרות-מפורמטות: כל רשומה חייבת id+statement+class+source
  for (const o of model.objectives?.objectives ?? []) {
    if (!o.id || !o.statement || !o.class || !o.source) return { ok: false, reject: "MODEL-OBJECTIVE-MALFORMED", detail: String(o.id ?? "?") };
  }
  // מפריך-חובה לרשומת-הכרעה (§IV: objective בלי מפריך נדחה ממשק-ההחלטה)
  const falsifiers = model.options?.armedCounterfactual?.falsifiers ?? null;
  if (!falsifiers || !falsifiers.alpha || !falsifiers.beta || !falsifiers.gamma || !falsifiers.delta) {
    return { ok: false, reject: "FALSIFIER-MISSING", detail: "options.armedCounterfactual.falsifiers חסר/חלקי" };
  }
  // מפת-סמכות: verdicts מערך לא-ריק
  if (!Array.isArray(model["authority-map"]?.verdicts) || model["authority-map"].verdicts.length === 0) {
    return { ok: false, reject: "AUTHORITY-MAP-MALFORMED", detail: "verdicts ריק/חסר" };
  }
  // §VIII R208R — עיגון-האש של מפת-הסמכות (trace 1a10dda614a62251):
  // פורמט-תקין ≠ סמכות-תקינה. המפה נצרכת רק אם בייטס-הדיסק זהים לעיגון-האחרון
  // בספר-העיגון (שרשרת-האש עצמאית). מוטציית-בייט/החזרת-מפה-ישנה ⇒ דחייה.
  const anchorPath = `${OBJ_DIR}/authority-anchor.jsonl`;
  let anchorRaw: string;
  try { anchorRaw = fs.readFileSync(anchorPath, "utf8"); } catch {
    return { ok: false, reject: "AUTHORITY-MAP-UNANCHORED", detail: "ספר-עיגון חסר — מקור-המפה לא מאומת (fail-closed)" };
  }
  const anchorLines = anchorRaw.trim() ? anchorRaw.trim().split("\n") : [];
  if (anchorLines.length === 0) return { ok: false, reject: "AUTHORITY-MAP-UNANCHORED", detail: "ספר-עיגון ריק" };
  let aPrev = "GENESIS"; let lastAnchor: { authorityMapSha256?: string } | null = null;
  for (const line of anchorLines) {
    let e: any; try { e = JSON.parse(line); } catch { return { ok: false, reject: "AUTHORITY-MAP-UNANCHORED", detail: "ספר-עיגון קרוע (fail-closed)" }; }
    const expect = sha256Buf(JSON.stringify({ ...e, entryHash: undefined }));
    if (e.prevHash !== aPrev || e.entryHash !== expect) return { ok: false, reject: "AUTHORITY-MAP-UNANCHORED", detail: "שרשרת-עיגון שבורה (fail-closed)" };
    aPrev = e.entryHash; lastAnchor = e;
  }
  const mapHash = hashes["authority-map.json"];
  if (!lastAnchor?.authorityMapSha256 || lastAnchor.authorityMapSha256 !== mapHash) {
    return { ok: false, reject: "AUTHORITY-MAP-UNANCHORED", detail: `בייטס-המפה (${String(mapHash).slice(0, 12)}) ≠ העיגון (${String(lastAnchor?.authorityMapSha256 ?? "?").slice(0, 12)}) — פורמט-תקין אינו סמכות-תקינה (§VIII)` };
  }
  // §IX R208R — עיגון-מלא: כשהעיגון-האחרון נושא האשים לארבעת-הקבצים —
  // כל-בייטס-המודל חייבים התאמה. שינוי-מודל-בלי-עדכון-עיגון ⇒ דחייה (fail-closed).
  const fullAnchor = (lastAnchor as { modelSha256?: Record<string, string> }).modelSha256 ?? null;
  if (fullAnchor && typeof fullAnchor === "object") {
    for (const f of MODEL_FILES) {
      const want = fullAnchor[f.replace(".json", "")];
      if (want && want !== hashes[f]) {
        return { ok: false, reject: "MODEL-UNANCHORED", detail: `${f}: בייטס-דיסק (${String(hashes[f]).slice(0, 12)}) ≠ עיגון (${String(want).slice(0, 12)}) — שינוי-מודל-בלי-התאמה-חתומה (§IX)` };
      }
    }
  }
  return { ok: true, model, hashes };
}

/**
 * תצוגת-ההחלטה הצרה לגבול grid-pool-seed. קריאה-בלבד למודל.
 * measuredSbd — המדידה החיה של צד-SBD (יחידה חובה). prefEvidence —
 * האסמכתאות החתומות בספר-ההעדפות (לאימות-האש מול-המודל הנוכחי).
 */
export function objectiveDecisionView(
  subject: string,
  opts: {
    measuredSbd?: { value: number; at: string; unit?: string } | null;
    prefEvidence?: { book: string; sha256: string }[];
    requireResource?: boolean; // §IV: משאב UNKNOWN כשההכרעה דורשת אותו ⇒ דחייה
  } = {},
): { view: ObjectiveView | null; reject: ModelReject | null; detail: string | null } {
  let loaded: ReturnType<typeof loadModel>;
  try {
    loaded = loadModel();
  } catch {
    return { view: null, reject: "MODEL-FILE-MISSING", detail: "קובץ-מודל חסר" };
  }
  if (!loaded.ok) return { view: null, reject: loaded.reject, detail: loaded.detail };
  const { model, hashes } = loaded;

  // אימות-אסמכתאות-ההעדפה מול-המודל שנצרך בפועל (שופט-חוץ: ההעדפה חתמה
  // על האש-בכתיבה). ההשוואה היא מול-ההאשים של הקבצים שנטענו כרגע —
  // המודל-הנצרך. סטייה ⇒ EVIDENCE-HASH-DRIFT ⇒ דחיית-התצוגה (fail-closed).
  for (const ev of opts.prefEvidence ?? []) {
    const base = ev.book.split("/").pop() ?? ev.book;
    const consumed = hashes[base];
    if (consumed && consumed !== ev.sha256) {
      return { view: null, reject: "EVIDENCE-HASH-DRIFT", detail: `${ev.book}: ההעדפה נחתמה על ${ev.sha256.slice(0, 12)} אך המודל-הנצרך כיום ${consumed.slice(0, 12)}` };
    }
  }

  // יחידות (§XV): מדידת-SBD חייבת להיות SBD — אין המרה-שקטה.
  // 0.1041 שמגיע כ-USD/STEEM (או כל יחידה אחרת) נדחה — לא מתפרש מחדש.
  let measured: UnitValue | null = null;
  if (opts.measuredSbd) {
    if (typeof opts.measuredSbd.value !== "number" || !Number.isFinite(opts.measuredSbd.value)) {
      return { view: null, reject: "RESOURCE-UNKNOWN-REQUIRED", detail: "מדידת-SBD לא-מספרית" };
    }
    // §XV — תקלי-חיישן-מאומתים (מעבדה r208-D): V6e/V8/V9c — אין יחידה-שקטה,
    // אין זמן-שקט, אין ערך-בלתי-סביר. כל שאלה-לא-ברורה = דחייה (fail-closed).
    if (!opts.measuredSbd.unit) {
      return { view: null, reject: "UNIT-MISMATCH", detail: "מדידה בלי-יחידה — היחידה חובה (לקח 0.1041); אין ברירת-מחדל-שקטה" };
    }
    if (opts.measuredSbd.value < 0 || opts.measuredSbd.value > 1e6) {
      return { view: null, reject: "RESOURCE-UNKNOWN-REQUIRED", detail: `מדידת-SBD מחוץ-לטווח-סביר (${opts.measuredSbd.value}) — לקח חיישן-powerdown ×4` };
    }
    const unit = opts.measuredSbd.unit;
    if (unit !== "SBD") {
      return { view: null, reject: "UNIT-MISMATCH", detail: `ההכרעה דורשת SBD אך המדידה נושאת ${unit} — אין המרה-שקטה (לקח 0.1041)` };
    }
    const atT = new Date(opts.measuredSbd.at || Date.now()).getTime();
    if (!Number.isFinite(atT)) {
      return { view: null, reject: "RESOURCE-UNKNOWN-REQUIRED", detail: `זמן-מדידה לא-תקין (${opts.measuredSbd.at}) — זקנה לא-ניתנת-לחישוב ⇒ UNKNOWN` };
    }
    // §X R208R — התקפת-שעון-עתידי: מדידה עם חותמת-עתיד (>60ש' סטייה) אינה
    // "טרייה" — היא חיישן-שעון-לא-אמין ⇒ UNKNOWN (לא סופרים אותה כ-0-זקנה).
    if (atT - Date.now() > 60_000) {
      return { view: null, reject: "RESOURCE-UNKNOWN-REQUIRED", detail: `זמן-מדידה בעתיד (${new Date(atT).toISOString()}) — שעון-חיישן לא-אמין ⇒ UNKNOWN (§X)` };
    }
    const at = new Date(atT).toISOString();
    measured = {
      value: opts.measuredSbd.value, unit: "SBD",
      source: "money-mover measure() ← /api/money sbdArming",
      at, stalenessSec: Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000)),
      transformation: "ישיר מהמדידה — אפס טרנספורמציה",
    };
    if (opts.requireResource && (measured.stalenessSec ?? 0) > 3600) {
      return { view: null, reject: "RESOURCE-UNKNOWN-REQUIRED", detail: `מדידת-SBD בת ${Math.round((measured.stalenessSec ?? 0) / 60)} דק' — נחשבת UNKNOWN להכרעה` };
    }
  } else if (opts.requireResource) {
    return { view: null, reject: "RESOURCE-UNKNOWN-REQUIRED", detail: "אין מדידת-SBD וההכרעה דורשת אותה" };
  }

  // פסק-דין-הזריעה מהמודל עצמו (לא-המצאה): options.json — A-prime
  // "לא-כשירה-כיום: חצי-מימון חסר" + unitErrorCorrection (סף ~160 WSTEEM).
  // המשאב המכריע: מימון-צד-WSBD (SBD).
  //
  // §VII R208R (trace 1a10dda614a62251) — הפרדת-הסף, אפס-קבוע-סמוי:
  //   · OBJECTIVE-PARAMETER: armingThreshold — חי במודל (options.json#_meta),
  //     בשינוי-אדג'ודיקטור-בלבד; שינויו משנה-הכרעה (צריכה-סיבתית) אך לעולם
  //     אינו יוצר סמכות (השערים אינם קוראים מודל).
  //   · SAFETY-CAP: טווח [0,1e6] + זקנה ≤3600ש' — קבועי-קוד; המודל אינו מזיזם.
  //   · AUTHORITY-CONDITION: מפת-הסמכות + tx-gate — חוץ-מודליים לחלוטין.
  const thr = model.options?._meta?.armingThreshold ?? null;
  if (!thr || typeof thr.value !== "number" || !Number.isFinite(thr.value) || thr.value <= 0 || thr.unit !== "SBD") {
    return { view: null, reject: "THRESHOLD-INVALID", detail: `options._meta.armingThreshold חסר/פגום — הסף חייב לחיות במודל עם יחידה (§VII)` };
  }
  const SBD_FUND_THRESHOLD: number = thr.value;
  const sbdFunded = measured ? measured.value >= SBD_FUND_THRESHOLD : false;
  const reqStatus: "SUFFICIENT" | "INSUFFICIENT" | "UNKNOWN" = measured ? (sbdFunded ? "SUFFICIENT" : "INSUFFICIENT") : "UNKNOWN";

  const depth = model.options?.unitErrorCorrection?.verified ?? "";
  const threshold = {
    seedWsteem: {
      value: 159.9, unit: "WSTEEM",
      source: "options.json#unitErrorCorrection.trueThreshold",
      at: model.options?._meta?.builtAt ?? "", stalenessSec: null,
      transformation: "depthUsd = reserveA × usdA × 2 ≥ $20 ⇒ ~160 WSTEEM (תיקון שגיאת-היחידות 96)",
    } as UnitValue,
    depthUsd: {
      value: 0.025024, unit: "USD",
      source: "options.json#unitErrorCorrection.verified (/api/exchange 17:46:45Z)",
      at: model.options?._meta?.builtAt ?? "", stalenessSec: null,
      transformation: "reserveA(0.2 WSTEEM) × usdA(0.0625 USD/STEEM) × 2",
    } as UnitValue,
  };
  // הערת-יחידות: 0.1041 הוא SBD/STEEM (פיד) — לעולם לא USD/STEEM (0.0625). §XV.
  void depth;

  const view: ObjectiveView = {
    subject,
    objectiveId: "O16+O20×options.decision (grid-pool-seed)",
    priority: {
      rank: "C1 > B > A′-עכשיו (justification-per-dollar — options.json#options[*].verdictNow)",
      verdictForSeed: reqStatus === "SUFFICIENT" ? "QUALIFIED-AFTER-ARMING" : "NOT-QUALIFIED-NOW",
      source: "options.json#options[A-prime].verdictNow + unitErrorCorrection",
    },
    metric: "depthUsd בריכת WSTEEM/WSBD",
    target: "depthOk ≥ $20 (dex-grid effectiveMode=live)",
    threshold,
    resourceRequirement: {
      status: reqStatus,
      why: reqStatus === "SUFFICIENT"
        ? "צד-SBD ממומן מדיד — התנאי-המכריע של המודל מתקיים"
        : measured
          ? `צד-SBD בלתי-ממומן מדיד (${measured.value.toFixed(3)} SBD < ${SBD_FUND_THRESHOLD.toFixed(1)}) — A′ לא-כשירה-כיום`
          : "אין מדידת-SBD",
      measured,
    },
    opportunityCost: {
      actionA: "זריעת-גל לעומק-בריכות (A′)",
      actionB: reqStatus === "SUFFICIENT" ? "זריעה-מותאמת ~160 WSTEEM + WSBD תואם (A ממומן)" : "החזקה-כרזרבה עד 11/10 והכרעה-במידע-מלא (B)",
      foregone: reqStatus === "SUFFICIENT" ? "גמישות-נזילות בחלון-הנחיתות (מהמודל)" : "4–5 ימי-למידה על בריכה-חיה (מהמודל options#B.opportunityCost)",
      learningValue: "קליברציית-בריכה חיה ראשונה (options#A-prime.learningValue)",
      risk: "חלון-הנחיתות בדיוק — גיוס-SBD מצד-אחד (options#A-prime.risk)",
      ordinal: "HIGHER", // הזריעה עדיפה רק כשהמודל מאשר מימון — אחרת UNKNOWN/החזקה
      source: "options.json#options[A-prime,B].opportunityCost",
    },
    alternative: ["A-prime (זריעה-מותאמת ~160)", "B (החזקה עד 11/10)", "C1 (פרוב ~20 WSTEEM)"],
    falsifier: model.options.armedCounterfactual.falsifiers,
    confidence: "medium",
    epistemicStatus: "VERIFIED",
    authorityStatus: authorityFor(model["authority-map"], "תנועת-הון"),
    contradictions: (model.objectives?.contradictions ?? []).map((c: any) => ({ id: c.id, statement: c.statement })),
    modelHashes: hashes,
    measuredAt: new Date().toISOString(),
  };
  return { view, reject: null, detail: null };
}

/**
 * §VII R208R — קורא-הסף-החוקי לכל-צרכן (המוביל בכללם): הסף נקרא מהמודל
 * בלבד — אפס-שכפול-קבוע בקוד. null ⇒ אין-ידיעת-סף ⇒ הקורא נמנע (לא ממציא).
 */
export function getArmingThresholdSbd(): { value: number; unit: string; source: string } | null {
  try {
    const j = JSON.parse(fs.readFileSync(`${OBJ_DIR}/options.json`, "utf8"));
    const t = j?._meta?.armingThreshold;
    if (t && typeof t.value === "number" && Number.isFinite(t.value) && t.value > 0 && t.unit === "SBD") {
      return { value: t.value, unit: t.unit, source: "options.json#_meta.armingThreshold (OBJECTIVE-PARAMETER, §VII)" };
    }
    return null;
  } catch { return null; }
}

/** סטטוס-סמכות לתחום ממפת-הסמכות (§V — קריאה בלבד; האכיפה בשער) */
function authorityFor(authorityMap: any, domain: string): ObjectiveView["authorityStatus"] {
  const v = (authorityMap?.verdicts ?? []).find((x: any) => x.domain === domain);
  if (!v) return { domain, forbidden: true, basis: "התחום לא-מוכר במפת-הסמכות — fail-closed", enforcement: "שער-האוטונומיה + tx-gate" };
  const may = String(v.may ?? "");
  const forbidden = may.includes("לא") && !may.includes("רק <$100") && !may.includes("פקודות-ספר");
  return {
    domain,
    forbidden,
    basis: `can: ${v.can} · may: ${v.may}`,
    enforcement: "שער-האוטונומיה + tx-gate נשארים הסמכות האוכפת; התצוגה אינה מעניקה היתר (§V)",
  };
}

/**
 * חוזה-התחזית (§VII): צפי-ההכרעה מחושב מהקלטות לבד — מימוש עצמאי
 * מזה של waveDecision (מבנה נפרד במודול נפרד; סתירה ביניהם = מפריך
 * נצפה PREDICTION-DIVERGENCE, לא הסתרה).
 */
export function predictWaveDecision(inp: {
  waveFires: boolean; prefDown: boolean; view: ObjectiveView | null; viewRejectReason: string | null; authorityForbidden: boolean;
}): string {
  if (!inp.waveFires) return "NO-WAVE";
  if (inp.authorityForbidden) return "BLOCKED_BY_AUTHORITY";
  if (inp.prefDown) return "WAIT-PREFERENCE";
  if (inp.view?.priority.verdictForSeed === "NOT-QUALIFIED-NOW") return "WAIT-MODEL";
  if (inp.viewRejectReason) return "WAIT-SAFETY";
  return "ACT";
}
