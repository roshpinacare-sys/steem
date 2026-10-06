// ─────────────────────────────────────────────────────────────────────
// AUTONOMY LAW — חוק-העצירה והחשיבה (r197, trace 1a108e334b3129a9)
//
// הוראת-המפעיל (רגע-הולדת החוק): "האוטונומיה עובדת אוטומטית בלי לחשוב
// ולבדוק בכלל... חייב לעצור ולבחון מה הסוכנים עושים ושיחשבו תמיד לפני
// שהם עושים דברים כי הכל רץ אוטומטית בלי שכל ואינטילגנציה".
//
// החוק — שלושה מצבים, קובץ-אמת אחד (sovereign/autonomy/GATE.json):
//   · PAUSED   — עצירה מלאה: אף פעולה אוטונומית לא זזה (כסף, תגמולים,
//                גריד, שימוש-בחיילים). רק סיור-בריאות וקריאה חיים.
//   · THINKING — פעולה מותרת רק עם רשומת-דיון מלאה שנכתבה לפני:
//                מה עושים · למה · תוצאה-צפויה · סיכון · רולבק.
//                בלי דיון — סירוב. זהו "לחשוב לפני שעושים" בקוד.
//   · ACTIVE   — המצב הרגיל; כל פעולה עדיין רושמת דיון (עדות, לא מכשול).
//
// גבולות-חוק (כמו shared.ts):
//   · טהור לחלוטין — node:fs/node:crypto בלבד, אפס תלות, אפס רשת.
//   · fail-closed: קובץ-שער קרוע/לא-קריא ⇒ PAUSED (לא ACTIVE!) —
//     היעדר-אמת אינו היתר.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeJsonAtomic } from "./shared";

export const AUTONOMY_DIR = "/home/z/my-project/sovereign/autonomy";
export const GATE_FILE = `${AUTONOMY_DIR}/GATE.json`;
export const DELIB_FILE = `${AUTONOMY_DIR}/deliberations.jsonl`;

export type AutonomyMode = "PAUSED" | "THINKING" | "ACTIVE";

export interface AutonomyGate {
  mode: AutonomyMode;
  since: string;
  reason: string;
  setBy: string;
  updatedAt: string;
}

const VALID_MODES: AutonomyMode[] = ["PAUSED", "THINKING", "ACTIVE"];

/** ברירת-מחדל fail-closed — עצור עד שיש אמת */
export function defaultGate(): AutonomyGate {
  return {
    mode: "PAUSED",
    since: new Date().toISOString(),
    reason: "קובץ-השער לא נמצא/לא-קריא — fail-closed עד שער-תקין (חוק-r197)",
    setBy: "law:default",
    updatedAt: new Date().toISOString(),
  };
}

export function readGate(): AutonomyGate {
  try {
    const raw = JSON.parse(fs.readFileSync(GATE_FILE, "utf8")) as Partial<AutonomyGate>;
    if (!raw || !VALID_MODES.includes(raw.mode as AutonomyMode)) return defaultGate();
    return {
      mode: raw.mode as AutonomyMode,
      since: String(raw.since ?? new Date().toISOString()),
      reason: String(raw.reason ?? ""),
      setBy: String(raw.setBy ?? "unknown"),
      updatedAt: String(raw.updatedAt ?? raw.since ?? new Date().toISOString()),
    };
  } catch {
    return defaultGate();
  }
}

export function writeGate(next: { mode: AutonomyMode; reason: string; setBy: string }): AutonomyGate {
  const gate: AutonomyGate = {
    mode: next.mode,
    since: new Date().toISOString(),
    reason: String(next.reason ?? "").slice(0, 300),
    setBy: String(next.setBy ?? "unknown").slice(0, 80),
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(GATE_FILE, gate);
  return gate;
}

// ── רשומות-דיון — "לחשוב לפני שעושים" כמסמך-חי ──────────────────────

export interface Deliberation {
  seq?: number;
  prevHash?: string;
  entryHash?: string;
  at: string;
  action: string; // reward-pay | grid-place | fleet-use | withdraw | ...
  actor: string; // money-mover | market-maker | dex-grid | keeper | main-agent
  claim: string; // מה בדיוק עושים
  why: string; // למה זה נכון עכשיו (הנמקה עם נתון)
  expected: string; // תוצאה-צפויה
  risk: string; // מה יכול להישבר
  rollback: string; // איך מבטלים
  /** r206 — תחזית-מחלקה-ראשונה: מה יפריך את התחזית הזאת באופן מדיד.
   *  אופציונלי (רשומות-ישן בלעדיו נשארות תקפות — ה-hash מגובב מהנשמר). */
  falsifier?: string;
}

const REQUIRED_FIELDS: Array<keyof Deliberation> = ["action", "actor", "claim", "why", "expected", "risk", "rollback"];

export function validDeliberation(d: Partial<Deliberation> | undefined | null): d is Deliberation {
  if (!d) return false;
  for (const f of REQUIRED_FIELDS) {
    const v = d[f];
    if (typeof v !== "string" || v.trim().length < 8) return false;
  }
  return true;
}

function hashDeliberation(d: object): string {
  const { entryHash: _omit, ...rest } = d as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

export function readDeliberations(limit = 50): Deliberation[] {
  try {
    const raw = fs.readFileSync(DELIB_FILE, "utf8").trim();
    if (!raw) return [];
    const lines = raw.split("\n");
    return lines.slice(-limit).map((l) => JSON.parse(l) as Deliberation);
  } catch {
    return [];
  }
}

/** מציאת הדיון העדכני ביותר לפעולה-שחקן, תוך maxAgeMs (ברירת-מחדל 15 דק') */
export function latestDeliberation(action: string, actor: string, maxAgeMs = 15 * 60_000): Deliberation | null {
  const all = readDeliberations(200);
  const now = Date.now();
  for (let i = all.length - 1; i >= 0; i--) {
    const d = all[i]!;
    if (d.action !== action || d.actor !== actor) continue;
    const at = new Date(d.at).getTime();
    if (!Number.isFinite(at)) continue;
    if (now - at > maxAgeMs) return null;
    return d;
  }
  return null;
}

/** רישום דיון חדש — שרשרת-גיבוב כמו יומן-ההחלטות */
export function appendDeliberation(d: Omit<Deliberation, "seq" | "prevHash" | "entryHash" | "at"> & { at?: string }): Deliberation {
  fs.mkdirSync(AUTONOMY_DIR, { recursive: true });
  const all = readDeliberations(200);
  const prev = all.length > 0 ? all[all.length - 1]! : null;
  const rec: Deliberation = {
    seq: (prev?.seq ?? 0) + 1,
    prevHash: prev?.entryHash ?? "GENESIS",
    at: d.at ?? new Date().toISOString(),
    action: String(d.action).slice(0, 60),
    actor: String(d.actor).slice(0, 60),
    claim: String(d.claim).slice(0, 400),
    why: String(d.why).slice(0, 400),
    expected: String(d.expected).slice(0, 400),
    risk: String(d.risk).slice(0, 400),
    rollback: String(d.rollback).slice(0, 400),
    // r206 — הפרכה נרשמת לפני-המעשה (לא אחרי): תחזית שאינה ניתנת-לבדיקה אינה תחזית
    ...(typeof d.falsifier === "string" && d.falsifier.trim().length > 0
      ? { falsifier: String(d.falsifier).slice(0, 200) }
      : {}),
  };
  rec.entryHash = hashDeliberation(rec);
  fs.appendFileSync(DELIB_FILE, `${JSON.stringify(rec)}\n`, "utf8");
  return rec;
}

// ── שער-ההכרעה האחד ─────────────────────────────────────────────────

export interface AutonomyVerdict {
  allowed: boolean;
  why: string;
  mode: AutonomyMode;
}

/**
 * הכרעה לפעולה אוטונומית.
 *   PAUSED   → אסור תמיד (למעט סיור-בריאות שמסומן lifecycle:"patrol")
 *   THINKING → מותר רק עם דיון טרי לפעולה-שחקן
 *   ACTIVE   → מותר; הדיון נרשם אם קיים
 */
export function autonomyVerdict(action: string, actor: string, opts?: { lifecycle?: "patrol" | "action" }): AutonomyVerdict {
  const gate = readGate();
  const isPatrol = opts?.lifecycle === "patrol";
  if (gate.mode === "PAUSED") {
    if (isPatrol) return { allowed: true, why: "PAUSED — סיור-בריאות חי-תמיד (חוק-r197)", mode: gate.mode };
    return { allowed: false, why: `PAUSED — האוטונומיה עוצרה: ${gate.reason.slice(0, 120)}`, mode: gate.mode };
  }
  if (gate.mode === "THINKING") {
    const d = latestDeliberation(action, actor);
    if (!d) {
      return {
        allowed: false,
        why: `THINKING — אין רשומת-דיון טרייה (≤15 דק') לפעולה ${action} של ${actor} — כותבים דיון לפני שעושים (חוק-r197)`,
        mode: gate.mode,
      };
    }
    return { allowed: true, why: `THINKING — דיון מאושר seq=${d.seq}: ${d.claim.slice(0, 80)}`, mode: gate.mode };
  }
  return { allowed: true, why: "ACTIVE — מצב-רגיל", mode: gate.mode };
}
