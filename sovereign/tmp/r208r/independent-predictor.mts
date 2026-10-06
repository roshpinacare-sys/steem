// ─────────────────────────────────────────────────────────────────────
// INDEPENDENT PREDICTOR — מנבא-עצמאי-קריאה-בלבד (§VI R208R, trace 1a10dda614a62251)
//
// התקפת-R208: «המנבא והמכריע — אותו-מחבר/אותו-מושב». הקובץ הזה הוא התשובה.
//
// חוקי-עצמאות (§VI):
//   P1  תהליך-נפרד — אפס-יבוא של קוד-ההכרעה (objective-consumer/wave-decision/
//       money/preferences אסורים; רק node:fs/node:crypto + קלט-סטנדרטי).
//   P2  טוען את-אותם-קלטים-אפיסטמיים (מודל/העדפות/מדידה) במימוש-משלו —
//       כתוב-מחדש מהחוזה-המתועד, לא מהקוד.
//   P3  לא קורא decide(), לא קורא לצרכן, לא משתמש-בענף-ההכרעה.
//   P4  מחשב את-ההכרעה-הצפויה בעצמו ומנפיק האש-תחזית-משלו.
//
// קלט: JSON ב-stdin: { objDir, prefDir, wave:{measCredible,waveDelta,idleNow,
//      totalSteemNow,lastStreamDay,today,waveSteem,share}, measured:{value,unit,at}|null }
// פלט: JSON ב-stdout: { expectedDecision, reason, predictionHash, checks{...} }
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import { createHash } from "node:crypto";

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

interface StdinSpec {
  objDir: string;
  prefDir: string;
  wave: { measCredible: boolean; waveDelta: number; idleNow: number; totalSteemNow: number; lastStreamDay: string | null; today: string; waveSteem: number; share: number };
  measured: { value: number; unit: string; at: string } | null;
}

function readStdin(): StdinSpec {
  const raw = fs.readFileSync(0, "utf8");
  return JSON.parse(raw) as StdinSpec;
}

// ── מימוש-עצמאי של טעינת-המודל (מהחוזה-המתועד §IV, לא מהקוד) ─────────
const SCHEMAS = new Set(["sovereign-objectives-v1", "sovereign-options-v1", "sovereign-capabilities-v1", "sovereign-authority-map-v1"]);
const FILES = ["objectives.json", "options.json", "capabilities.json", "authority-map.json"];
const MAX_AGE_DAYS = 7;

interface LoadOutcome {
  ok: boolean;
  reject?: string;
  threshold?: number; // מהמודל (options._meta.armingThreshold)
  authorityForbidden?: boolean;
  modelHashes?: Record<string, string>;
}

function loadModelIndependently(objDir: string): LoadOutcome {
  const hashes: Record<string, string> = {};
  const docs: Record<string, any> = {};
  for (const f of FILES) {
    let raw: string;
    try { raw = fs.readFileSync(`${objDir}/${f}`, "utf8"); } catch { return { ok: false, reject: "MODEL-FILE-MISSING" }; }
    hashes[f] = sha(raw);
    let j: any;
    try { j = JSON.parse(raw); } catch { return { ok: false, reject: "MODEL-JSON-BROKEN" }; }
    const meta = j?._meta ?? {};
    if (!SCHEMAS.has(meta.schema)) return { ok: false, reject: "MODEL-SCHEMA-INVALID" };
    if (!meta.round || !meta.trace || !meta.builtAt || !meta.law) return { ok: false, reject: "MODEL-PROVENANCE-BROKEN" };
    const built = new Date(meta.builtAt).getTime();
    if (Number.isNaN(built)) return { ok: false, reject: "MODEL-PROVENANCE-BROKEN" };
    if (Date.now() - built > MAX_AGE_DAYS * 24 * 3600 * 1000) return { ok: false, reject: "MODEL-STALE" };
    docs[f] = j;
  }
  for (const o of docs["objectives.json"]?.objectives ?? []) {
    if (!o.id || !o.statement || !o.class || !o.source) return { ok: false, reject: "MODEL-OBJECTIVE-MALFORMED" };
  }
  const fals = docs["options.json"]?.armedCounterfactual?.falsifiers ?? null;
  if (!fals?.alpha || !fals?.beta || !fals?.gamma || !fals?.delta) return { ok: false, reject: "FALSIFIER-MISSING" };
  const verdicts = docs["authority-map.json"]?.verdicts;
  if (!Array.isArray(verdicts) || verdicts.length === 0) return { ok: false, reject: "AUTHORITY-MAP-MALFORMED" };

  // עיגון-האש (§VIII) — מימוש-עצמאי: שרשרת + התאמת-בייטס + עיגון-מלא (§IX)
  let anchorRaw: string;
  try { anchorRaw = fs.readFileSync(`${objDir}/authority-anchor.jsonl`, "utf8"); } catch { return { ok: false, reject: "AUTHORITY-MAP-UNANCHORED" }; }
  const lines = anchorRaw.trim() ? anchorRaw.trim().split("\n") : [];
  if (!lines.length) return { ok: false, reject: "AUTHORITY-MAP-UNANCHORED" };
  let prev = "GENESIS"; let last: any = null;
  for (const line of lines) {
    let e: any; try { e = JSON.parse(line); } catch { return { ok: false, reject: "AUTHORITY-MAP-UNANCHORED" }; }
    if (e.prevHash !== prev || e.entryHash !== sha(JSON.stringify({ ...e, entryHash: undefined }))) return { ok: false, reject: "AUTHORITY-MAP-UNANCHORED" };
    prev = e.entryHash; last = e;
  }
  if (last?.authorityMapSha256 !== hashes["authority-map.json"]) return { ok: false, reject: "AUTHORITY-MAP-UNANCHORED" };
  const fullA = last?.modelSha256;
  if (fullA && typeof fullA === "object") {
    for (const f of FILES) {
      const want = fullA[f.replace(".json", "")];
      if (want && want !== hashes[f]) return { ok: false, reject: "MODEL-UNANCHORED" };
    }
  }

  // הסף — רק מהמודל (§VII); אין-קבוע-מקומי
  const thr = docs["options.json"]?._meta?.armingThreshold;
  if (!thr || typeof thr.value !== "number" || !Number.isFinite(thr.value) || thr.value <= 0 || thr.unit !== "SBD") {
    return { ok: false, reject: "THRESHOLD-INVALID" };
  }

  // סטטוס-סמכות לתחום-תנועת-הון: אסור אם התחום לא-מוכר או אם may שולל-לגמרי
  const v = verdicts.find((x: any) => x.domain === "תנועת-הון");
  let authorityForbidden = true; // fail-closed: תחום-לא-מוכר = אסור
  if (v) {
    const may = String(v.may ?? "");
    authorityForbidden = may.includes("לא") && !may.includes("רק <$100") && !may.includes("פקודות-ספר");
  }
  return { ok: true, threshold: thr.value, authorityForbidden, modelHashes: hashes };
}

// ── מימוש-עצמאי של קריאת-ההעדפות (I7) ───────────────────────────────
function activeDownIndependently(prefDir: string, subject: string): { active: boolean; why?: string } {
  let raw: string;
  try { raw = fs.readFileSync(`${prefDir}/preferences.jsonl`, "utf8"); } catch { return { active: false, why: "book-missing" }; }
  const lines = raw.trim() ? raw.trim().split("\n") : [];
  const entries: any[] = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch { return { active: false, why: "torn" }; }
  }
  // אימות-שרשרת מלא
  let prev = "GENESIS";
  for (const e of entries) {
    if (e.prevHash !== prev || e.entryHash !== sha(JSON.stringify({ ...e, entryHash: undefined }))) return { active: false, why: "chain-broken" };
    prev = e.entryHash;
  }
  // השעיה
  let suspended = false;
  try {
    const st = JSON.parse(fs.readFileSync(`${prefDir}/state.json`, "utf8"));
    suspended = st?.suspended === true;
  } catch { /* מדינה-חסרה אינה השעיה */ }
  if (suspended) return { active: false, why: "suspended" };
  let resumed = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === "SUSPEND") { if (!resumed) return { active: false, why: "suspended-entry" }; continue; }
    if (e.kind === "RESUME") { resumed = true; continue; }
    if (e.kind === "PREFERENCE-UPDATE" && e.subject === subject && e.direction === "DOWN") {
      if (e.expiresAt && new Date(e.expiresAt).getTime() < Date.now()) return { active: false, why: "expired" };
      return { active: true };
    }
    if (e.kind === "PREFERENCE-EXPIRE" && e.subject === subject) return { active: false, why: "released" };
  }
  return { active: false, why: "none" };
}

// ── מימוש-עצמאי של חוק-היחידות/זקנה (§XV) ───────────────────────────
function sensorVerdict(measured: StdinSpec["measured"]): { ok: true; value: number } | { ok: false; reject: string } {
  if (!measured) return { ok: false, reject: "RESOURCE-UNKNOWN-REQUIRED" };
  if (typeof measured.value !== "number" || !Number.isFinite(measured.value)) return { ok: false, reject: "RESOURCE-UNKNOWN-REQUIRED" };
  if (!measured.unit) return { ok: false, reject: "UNIT-MISMATCH" };
  if (measured.value < 0 || measured.value > 1e6) return { ok: false, reject: "RESOURCE-UNKNOWN-REQUIRED" };
  if (measured.unit !== "SBD") return { ok: false, reject: "UNIT-MISMATCH" };
  const atT = new Date(measured.at || Date.now()).getTime();
  if (!Number.isFinite(atT)) return { ok: false, reject: "RESOURCE-UNKNOWN-REQUIRED" };
  // §X R208R — שעון-עתידי: מדידה-מהעתיד (>60ש') = חיישן-לא-אמין ⇒ UNKNOWN
  if (atT - Date.now() > 60_000) return { ok: false, reject: "RESOURCE-UNKNOWN-REQUIRED" };
  const staleness = Math.max(0, Math.round((Date.now() - atT) / 1000));
  if (staleness > 3600) return { ok: false, reject: "RESOURCE-UNKNOWN-REQUIRED" };
  return { ok: true, value: measured.value };
}

// ── ההכרעה-הצפויה — מבנה-עצמאי: אוספים-את-כל-החוסמים ובוחרים לפי-סדר-החוק ──
function main(): void {
  const spec = readStdin();
  const blockers: Array<{ rank: number; decision: string; why: string }> = [];
  const inputsHash = sha(JSON.stringify(spec));

  // 0) גבול-לא-נחצה — אין-הכרעה-בכלל
  const { wave } = spec;
  const waveFires = wave.measCredible && wave.waveDelta >= wave.waveSteem && wave.idleNow >= wave.waveSteem && wave.lastStreamDay !== wave.today;
  if (!waveFires) {
    out(spec, blockers, "NO-WAVE", "אין גל-דלק מדיד (הגבול לא נחצה)", inputsHash);
    return;
  }

  // 1) המודל נטען בעצמאות
  const loaded = loadModelIndependently(spec.objDir);
  // 2) ההעדפה נקראת בעצמאות
  const pref = activeDownIndependently(spec.prefDir, "grid-pool-seed");
  // 3) החיישן נשפט בעצמאות
  const sensor = sensorVerdict(spec.measured);

  // סדר-החוזה-המתועד (§V R208 — אותו-סדר-חוקי, מימוש-עצמאי):
  // תצוגה-חיה = מודל-תקף + חיישן-כשיר. הסמכות נשפטת דרך-התצוגה בלבד;
  // תצוגה-מתה = אין-שופט-מודלי-ואין-קריאת-סמכות — ברירת-מחדל-בטוחה (WAIT-SAFETY).
  const viewAlive = loaded.ok && sensor.ok;
  if (viewAlive && loaded.authorityForbidden) blockers.push({ rank: 1, decision: "BLOCKED_BY_AUTHORITY", why: "מפת-הסמכות אוסרת על תחום-ההזרמה (דרך-תצוגה-חיה)" });
  if (pref.active) blockers.push({ rank: 2, decision: "WAIT-PREFERENCE", why: "העדפה-נלמדת grid-pool-seed DOWN פעילה" });
  if (viewAlive && spec.measured!.value < loaded.threshold!) blockers.push({ rank: 3, decision: "WAIT-MODEL", why: `המודל פוסק NOT-QUALIFIED-NOW (SBD ${spec.measured!.value} < ${loaded.threshold})` });
  if (!viewAlive) blockers.push({ rank: 4, decision: "WAIT-SAFETY", why: `תצוגת-מודל נדחית (${loaded.ok ? sensor.reject : loaded.reject}) — אין-פסק-דין-ואין-קריאת-סמכות` });

  if (blockers.length) {
    blockers.sort((a, b) => a.rank - b.rank);
    out(spec, blockers, blockers[0]!.decision, blockers[0]!.why, inputsHash);
    return;
  }
  out(spec, blockers, "ACT", "גל אמיתי + אין חוסם — חוק-הבסיס זורם 20% לעומק", inputsHash);
}

function out(spec: StdinSpec, blockers: unknown[], decision: string, reason: string, inputsHash: string): void {
  const predictionHash = sha(`${inputsHash}|${decision}`);
  process.stdout.write(JSON.stringify({ expectedDecision: decision, reason, predictionHash, blockersCount: (blockers as unknown[]).length, predictor: "independent-r208r", law: "§VI: אפס-יבוא-קוד-הכרעה" }) + "\n");
}

main();
