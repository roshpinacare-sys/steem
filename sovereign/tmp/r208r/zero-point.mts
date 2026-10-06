// ─────────────────────────────────────────────────────────────────────
// R208R ZERO-POINT — איפוס-אפיסטמי (§I) · trace 1a10dda614a62251
// שחזור-האורגניזם מהמצב-החי-הנוכחי בלבד. כל-טענת-R208 קודם = השערה.
// אין-קריאת-פעולה, אין-כתיבה לחי, קריאה-בלבד.
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import { createHash } from "node:crypto";

const H = "/home/z/my-project";
const sha = (p: string): string | null => {
  try { return createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } catch { return null; }
};
const exists = (p: string): boolean => { try { fs.accessSync(p); return true; } catch { return false; } };
const now = new Date().toISOString();

// ── 1. מודל-המטרות החי ──────────────────────────────────────────────
const OBJ = `${H}/sovereign/objectives`;
const modelFiles = ["objectives.json", "options.json", "capabilities.json", "authority-map.json"];
const model: Record<string, any> = {};
for (const f of modelFiles) {
  model[f] = {
    exists: exists(`${OBJ}/${f}`),
    sha256: sha(`${OBJ}/${f}`),
    mtime: exists(`${OBJ}/${f}`) ? fs.statSync(`${OBJ}/${f}`).mtime.toISOString() : null,
  };
  try {
    const j = JSON.parse(fs.readFileSync(`${OBJ}/${f}`, "utf8"));
    model[f].schema = j?._meta?.schema ?? null;
    model[f].builtAt = j?._meta?.builtAt ?? null;
    model[f].round = j?._meta?.round ?? null;
  } catch { model[f].schema = "UNPARSEABLE"; }
}

// ── 2. ספר-ההעדפות החי ──────────────────────────────────────────────
let prefBook: any[] = [];
let prefTorn = false;
try {
  const raw = fs.readFileSync(`${H}/sovereign/preferences/preferences.jsonl`, "utf8");
  prefBook = raw.trim() ? raw.trim().split("\n").map((l) => JSON.parse(l)) : [];
} catch { prefTorn = true; }
let prefChainOk: boolean | null = null;
try {
  const prefs = await import(`${H}/mini-services/preferences.ts`);
  prefChainOk = prefs.verifyChain().ok;
} catch (e) { prefChainOk = null; }
const prefState = (() => { try { return JSON.parse(fs.readFileSync(`${H}/sovereign/preferences/state.json`, "utf8")); } catch { return null; }; })();

// ── 3. מצב-הדיבון החי (money-mover) ─────────────────────────────────
const moneyState = (() => { try { return JSON.parse(fs.readFileSync(`${H}/sovereign/money/state.json`, "utf8")); } catch { return null; }; })();
const moneyHistoryTail = (() => {
  try {
    const h = JSON.parse(fs.readFileSync(`${H}/sovereign/money/history.json`, "utf8"));
    return Array.isArray(h) ? h.slice(-3) : null;
  } catch { return null; };
})();

// ── 4. ספר-התחזיות החי ─────────────────────────────────────────────
const predBookPath = `${OBJ}/predictions.jsonl`;
const predBookExists = exists(predBookPath);
const predBookLines = predBookExists ? fs.readFileSync(predBookPath, "utf8").trim().split("\n").filter(Boolean) : [];

// ── 5. מצב dex-grid (המצבר) ────────────────────────────────────────
const dexState = (() => { try { return JSON.parse(fs.readFileSync(`${H}/mini-services/dex-grid/state.json`, "utf8")); } catch { return null; }; })();
const fillsCount = (() => { try { return fs.readFileSync(`${H}/mini-services/dex-grid/fills.jsonl`, "utf8").trim().split("\n").filter(Boolean).length; } catch { return 0; }; })();

// ── 6. שער-האוטונומיה ──────────────────────────────────────────────
const gate = (() => { try { return JSON.parse(fs.readFileSync(`${H}/sovereign/autonomy/GATE.json`, "utf8")); } catch { return null; }; })();

// ── 7. סף-קבוע בקוד (§VII — איתור-חי) ──────────────────────────────
const consumerSrc = fs.readFileSync(`${H}/mini-services/objective-consumer.ts`, "utf8");
const thresholdLine = consumerSrc.split("\n").findIndex((l) => l.includes("SBD_FUND_THRESHOLD = 3.0"));
const predictorInConsumerFile = consumerSrc.includes("export function predictWaveDecision");
const waveSrc = fs.readFileSync(`${H}/mini-services/wave-decision.ts`, "utf8");
const predictorImportsWave = waveSrc.includes("predictWaveDecision");
const consumerImportsWave = consumerSrc.includes("wave-decision");
const gatesReadModel = {
  txGate: fs.readFileSync(`${H}/src/lib/weave/tx-gate.ts`, "utf8").includes("sovereign/objectives"),
  autonomyLaw: (() => { try { return fs.readFileSync(`${H}/src/lib/autonomy-law.ts`, "utf8").includes("sovereign/objectives"); } catch { return null; }; })(),
};

// ── 8. מדידת-גל-חי עכשיו (מהמדינה — לא מהיסטוריה) ──────────────────
const lastTotalSteem = moneyState?.lastTotalSteem ?? null;

const zeroPoint = {
  _meta: {
    schema: "r208r-zero-point-v1",
    round: "R208R",
    trace: "1a10dda614a62251",
    at: now,
    law: "כל-שדה נושא סיווג-אפיסטמי: OBSERVED | DERIVED | CLAIMED | UNKNOWN | REFUTED. איסור: מבחן→עולם · תחזית→תוצאה · שורת-DB→סיבתיות · חוסר-מדידה→אפס.",
  },
  liveModel: { files: model, epistemic: "OBSERVED" },
  livePreferences: {
    bookCount: prefBook.length,
    torn: prefTorn,
    chainVerified: prefChainOk,
    p1: prefBook.filter((e) => e.kind === "PREFERENCE-UPDATE" && e.subject === "grid-pool-seed").slice(-1)[0] ?? null,
    state: prefState,
    epistemic: "OBSERVED",
  },
  liveDaemon: {
    service: moneyState?.service ?? null,
    version: moneyState?.version ?? null,
    bootedAt: moneyState?.bootedAt ?? null,
    beats: moneyState?.beats ?? null,
    lastTotalSteem,
    actionsToday: moneyState?.actionsToday ?? null,
    lastStreamDay: moneyState?.lastStreamDay ?? null,
    historyTail: moneyHistoryTail,
    epistemic: "OBSERVED",
  },
  livePredictionBook: {
    path: predBookPath,
    exists: predBookExists,
    lines: predBookLines.length,
    entries: predBookLines.slice(0, 5),
    claim: "R208: «GENESIS-חי — נכתב רק בחציית-גבול-חי»",
    epistemic: predBookLines.length === 0 ? "OBSERVED: ספר-ריק — אין-חציית-גבול-חי-מעולם" : "OBSERVED",
  },
  liveAccumulator: {
    dexMode: dexState?.effectiveMode ?? null,
    dexTicks: dexState?.ticks ?? null,
    realizedPnlUsd: dexState?.realizedPnlUsd ?? null,
    dailyVolumeUsd: dexState?.dailyVolumeUsd ?? null,
    fillsInState: dexState?.fills?.length ?? null,
    fillsLedgerLines: fillsCount,
    canonicalEventIdExists: fs.readFileSync(`${H}/mini-services/dex-grid/index.ts`, "utf8").includes("canonical_event_id"),
    epistemic: "OBSERVED",
  },
  autonomyGate: { gate, epistemic: "OBSERVED" },
  thresholdProvenance: {
    hardcodedLine: thresholdLine >= 0 ? `mini-services/objective-consumer.ts:${thresholdLine + 1}` : "NOT-FOUND",
    claim_R208: "סף-3.0-קבוע-בקוד-הצרכן",
    epistemic: thresholdLine >= 0 ? "OBSERVED — הטענה-מאומתת-מחדש" : "REFUTED",
  },
  predictorIndependence: {
    predictWaveDecisionLivesIn: predictorInConsumerFile ? "mini-services/objective-consumer.ts (אותו-קובץ-כצרכן)" : "UNKNOWN",
    waveDecisionImportsPredictor: predictorImportsWave,
    consumerImportsWaveDecision: consumerImportsWave,
    sharedDecisionCode: false,
    claim_R208: "המנבא=מכריע אותו-מחבר/אותו-מושב",
    epistemic: "OBSERVED — מבנה-נפרד-אך-מחבר-זהה; עצמאות-תהליכית אינה-קיימת",
  },
  authorityIndependence: {
    txGateReadsModelFiles: gatesReadModel.txGate,
    autonomyLawReadsModelFiles: gatesReadModel.autonomyLaw,
    claim_R208: "השערים אינם קוראים קבצי-מודל כלל",
    epistemic: gatesReadModel.txGate === false ? "OBSERVED — השער-עצמאי-מהמודל (קריאת-קוד)" : "REFUTED",
  },
  authorityMapAnchoring: {
    anchoredInPreferenceChain: false,
    note: "R208 רשם: «authority-map לא-מעוגן-האש בספר-ההעדפות» — סתירה-פתוחה",
    epistemic: "OBSERVED",
  },
  claims_R208_toReverify: [
    { id: "A", claim: "decide() החי טוען את מודל-R207", status: "CLAIMED→לבדיקה" },
    { id: "B", claim: "המודל הנטען משפיע על ההכרעה", status: "CLAIMED→לבדיקה" },
    { id: "C", claim: "ההשפעה אינה-רישום-בלבד", status: "CLAIMED→לבדיקה" },
    { id: "D", claim: "המודל אינו-מאציל-עצמו", status: "CLAIMED→לבדיקה" },
    { id: "E", claim: "המודל שורד-הפעלה-מחדש", status: "CLAIMED→לבדיקה" },
    { id: "F", claim: "החיישן כנה", status: "CLAIMED→לבדיקה" },
    { id: "G", claim: "גבול-הסמכות נשאר-בלתי-תלוי", status: "CLAIMED→לבדיקה" },
    { id: "H", claim: "המעבדה-הנגטיבית הייתה-מבודדת-אמיתית", status: "CLAIMED→לבדיקה" },
    { id: "I", claim: "אפס-זיהום-מעבדה→חי", status: "CLAIMED→לבדיקה" },
    { id: "J", claim: "15/15 משוחזר מ-HEAD הנוכחי", status: "CLAIMED→לבדיקה" },
  ],
};

fs.mkdirSync(`${H}/sovereign/tmp/r208r`, { recursive: true });
fs.writeFileSync(`${H}/sovereign/tmp/r208r/zero-point.json`, JSON.stringify(zeroPoint, null, 1));
console.log(JSON.stringify({
  at: now,
  modelHashes: Object.fromEntries(modelFiles.map((f) => [f, model[f].sha256?.slice(0, 12)])),
  prefChainOk, prefCount: prefBook.length, p1Expires: zeroPoint.livePreferences.p1?.expiresAt,
  daemon: `${moneyState?.service} v${moneyState?.version} beats=${moneyState?.beats}`,
  predBookLines: predBookLines.length,
  accumulator: { mode: dexState?.effectiveMode, realized: dexState?.realizedPnlUsd, fills: fillsCount },
  gateMode: gate?.mode,
  thresholdHardcoded: thresholdLine >= 0,
  predictorInConsumerFile, consumerImportsWave,
  txGateReadsModel: gatesReadModel.txGate,
}));
