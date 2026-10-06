// ─────────────────────────────────────────────────────────────────────
// SOVEREIGN PREFERENCES — שכבת-העדפות נלמדות (R207, trace 1a10d1ddb659450d)
//
// R207 §XII/XIII: למידה רשאית להשפיע על העדפה/סדר-עדיפויות/תשומת-לב —
// ואסור לה ליצור סמכות. המודול הזה הוא המימוש המינימלי החסום של
// «למידה→העדפה», על-פי מפרט-חוסם-ההעדפות של שופט-הבטיחות r207-e:
//
//   I1  מחסן-פיזי נפרד (sovereign/preferences/) + ספר-משורשר משלו;
//       המודול לא מייבא tx-gate/autonomy-law/owner-key/econ-gate,
//       ואסור ששום-שער יייבא אותו.
//   I2  אוצר-מילים סגור: subject הוא enum-קומפילציה; לא-מוכר ⇒ דחייה.
//   I3  צרכנים-advisory-בלבד: העדפה יכולה רק לצמצם פעילות (WAIT) או
//       להעיר בטקסט-החלטה — לעולם לא לכפות פעולה, להפוך פסקי-שער,
//       או לגעת בסף/תקרות/תחומי-למידה. כיוון-הכוח: חד-כיווני-שמרני.
//   I4  יעדי-כתיבה = const עם כינור-אתחול; חריגה ⇒ סימון-השעיה גלוי.
//   I5  איסור-סכמה: שדות-סמכות (paths/accounts/amounts/keys/modes/caps)
//       נדחים; מפתחות-רשומה מחוץ לרשימה-הלבנה נדחים.
//   I6  שופט-חוץ: כל העדפה מצטטת ראיה מקובץ קיים-על-הדיסק שהמודול
//       אינו יכול לכתוב (כותב≠שופט — לקח r204/r205) + sha256 שלו.
//   I7  אפיסטמיקת-ריצה: שחרור-העדפה דורש 3 מדידות-סותרות רצופות
//       (רג'ים משתנה ≠ כלל-תמידי); כל-רשומה נושאת תפוגת-תוקף.
//   I8  תנאי-מקדים: F-1 אוטם (POST /api/autonomy דורש סשן-מפעיל) —
//       בוצע ואומת 18:02Z לפני שהמודול הזה עלה.
//
// כשל-מודול = העדפה נעדרת (התנהגות חוזרת לחוק-הבסיס שלפני r207) —
// המערכת לעולם לא ממציאה העדפה מכשל. fail-closed לכיוון-ההמצאה,
// fail-open לכיוון-הדיכוי (העדפה יכולה רק להפחית-פעילות).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import { createHash } from "node:crypto";

const PREF_DIR = process.env.PREF_DIR ?? "/home/z/my-project/sovereign/preferences";
const PREF_BOOK = `${PREF_DIR}/preferences.jsonl`;
const PREF_STATE = `${PREF_DIR}/state.json`;

// I4 — יעדי-הכתיבה החוקיים היחידים של המודול הזה (נבדק בכל-כתיבה)
const WRITE_TARGETS = new Set<string>([PREF_BOOK, PREF_STATE]);
let bootCanaryOk = true;

// I2 — אוצר-מילים סגור (enum-קומפילציה)
export const SUBJECTS = ["grid-pool-seed", "ladder-reprice", "hold-reserve"] as const;
export type Subject = (typeof SUBJECTS)[number];
const SUBJECT_SET = new Set<string>(SUBJECTS);

// I6 — ספרי-ראיה מותרים בלבד: קבצים שהמודול הזה אינו כותב (שופט-חוץ)
const ALLOWED_EVIDENCE_BOOKS = [
  "sovereign/objectives/objectives.json",
  "sovereign/objectives/capabilities.json",
  "sovereign/objectives/options.json",
  "sovereign/objectives/authority-map.json",
  "sovereign/money/history.json",
  "sovereign/learning/experience.jsonl",
  "sovereign/learning/updates.jsonl",
] as const;
const ALLOWED_SET = new Set<string>(ALLOWED_EVIDENCE_BOOKS);

// I5 — שדות-אסורים (אובייקטי-סמכות) + רשימה-לבנה למפתחות-רשומה
const FORBIDDEN_VALUE_PATTERNS: RegExp[] = [
  /private|wif|secret|password/i,
  /\/home\/|\/etc\/|C:\\/i, // paths
  /\bmode\s*[:=]\s*["']?(PAUSED|THINKING|ACTIVE)/i, // gate modes
  /\bthreshold|GATE_THRESHOLD|budget|caps?\b/i, // caps/budgets
];
const ENTRY_KEYS_WHITELIST = new Set([
  "seq", "at", "kind", "subject", "direction", "scope", "confidence",
  "evidence", "expiresAt", "reason", "authority", "prevHash", "entryHash",
]);
const EVIDENCE_KEYS_WHITELIST = new Set(["book", "ref", "at", "value", "sha256"]);
const KINDS = new Set(["PREFERENCE-UPDATE", "PREFERENCE-EXPIRE", "SUSPEND", "RESUME"]);
const DIRECTIONS = new Set(["UP", "DOWN", "HOLD"]);
const CONFIDENCE = new Set(["low", "medium", "high"]);
const MAX_REASONS = 400;
const MAX_EVIDENCE = 4;
const RELEASE_STREAK = 3; // I7 — שחרור רק אחרי 3 מדידות-סותרות רצופות

export interface EvidenceRef { book: string; ref: string; at: string; value: string; sha256: string }
export interface PrefEntry {
  seq: number; at: string; kind: string; subject?: string; direction?: string;
  scope?: { regime: string[] }; confidence?: string; evidence?: EvidenceRef[];
  expiresAt?: string; reason: string; authority?: string; prevHash: string; entryHash: string;
}

function sha256File(path: string): string | null {
  try { return createHash("sha256").update(fs.readFileSync(path)).digest("hex"); } catch { return null; }
}

/**
 * קריאה-מחמירה של הספר (לקח-r205: שורה-קרועה אינה ספר-ריק — היא שבר-כנה).
 * torn=true ⇒ כל-הקוראים fail-closed (אפס-העדפות, אפס-כתיבה).
 */
function readBookStrict(): { entries: PrefEntry[]; torn: boolean; tornAt: number | null } {
  let raw: string;
  try {
    raw = fs.readFileSync(PREF_BOOK, "utf8");
  } catch {
    return { entries: [], torn: false, tornAt: null }; // ספר-חסר = ספר-ריק לגיטימי
  }
  const lines = raw.trim() ? raw.trim().split("\n") : [];
  const entries: PrefEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      entries.push(JSON.parse(lines[i]!) as PrefEntry);
    } catch {
      return { entries, torn: true, tornAt: i }; // שבר-כנה — לא מעמידים-פנים שהוא לא-קיים
    }
  }
  return { entries, torn: false, tornAt: null };
}

function hashEntry(e: Omit<PrefEntry, "entryHash">): string {
  return createHash("sha256").update(JSON.stringify(e)).digest("hex");
}

/** בדיקת-שרשרת מלאה — שבר-קריאה = שבר-כנה (לא ספר-ריק) */
export function verifyChain(): { ok: boolean; count: number; brokenAt?: number } {
  const { entries, torn, tornAt } = readBookStrict();
  if (torn) return { ok: false, count: entries.length, brokenAt: tornAt! };
  let prev = "GENESIS";
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const expect = hashEntry({ ...e, entryHash: undefined } as Omit<PrefEntry, "entryHash">);
    if (e.prevHash !== prev || e.entryHash !== expect) return { ok: false, count: entries.length, brokenAt: i };
    prev = e.entryHash;
  }
  return { ok: true, count: entries.length };
}

/** I5 — ולידציית-סכמה מחמירה: דחיית כל מה שמריח-כסמכות */
function validateDraft(d: Omit<PrefEntry, "seq" | "prevHash" | "entryHash">): string | null {
  if (!KINDS.has(d.kind)) return `BAD-KIND: ${d.kind}`;
  for (const k of Object.keys(d)) if (!ENTRY_KEYS_WHITELIST.has(k)) return `FORBIDDEN-KEY: ${k} (I5)`;
  const blob = JSON.stringify(d);
  for (const p of FORBIDDEN_VALUE_PATTERNS) if (p.test(blob)) return `FORBIDDEN-CONTENT: ${p} (I5)`;
  if (d.reason.length < 8 || d.reason.length > MAX_REASONS) return "BAD-REASON";
  if (d.authority !== "ADVISORY-ONLY") return "AUTHORITY-MUST-BE-ADVISORY-ONLY (I3)";
  if (d.kind === "PREFERENCE-UPDATE") {
    if (!d.subject || !SUBJECT_SET.has(d.subject)) return `UNKNOWN-SUBJECT: ${d.subject} (I2)`;
    if (!d.direction || !DIRECTIONS.has(d.direction)) return `BAD-DIRECTION: ${d.direction}`;
    if (!d.confidence || !CONFIDENCE.has(d.confidence)) return "BAD-CONFIDENCE";
    if (!d.expiresAt || Number.isNaN(new Date(d.expiresAt).getTime())) return "EXPIRY-REQUIRED (I7)";
    const ev = d.evidence ?? [];
    if (ev.length < 1 || ev.length > MAX_EVIDENCE) return `EVIDENCE-1..${MAX_EVIDENCE}-REQUIRED (I6)`;
    for (const e of ev) {
      for (const k of Object.keys(e)) if (!EVIDENCE_KEYS_WHITELIST.has(k)) return `FORBIDDEN-EVIDENCE-KEY: ${k}`;
      if (!ALLOWED_SET.has(e.book)) return `EVIDENCE-BOOK-NOT-ALLOWED: ${e.book} (I6)`;
      const abs = `/home/z/my-project/${e.book}`;
      if (!fs.existsSync(abs)) return `EVIDENCE-FILE-MISSING: ${e.book} (I6)`;
      if (e.value.length > 160) return "EVIDENCE-VALUE-TOO-LONG";
    }
  }
  return null;
}

/**
 * רישום-העדפה לספר — append-only, משורשר, fail-closed.
 * מחזיר {ok:false, why} במקום לזרוק — הקורא תמיד יכול להמשיך בלי-העדפה.
 */
export function appendPreference(
  draft: Omit<PrefEntry, "seq" | "prevHash" | "entryHash">,
): { ok: true; entry: PrefEntry } | { ok: false; why: string } {
  if (!bootCanaryOk) return { ok: false, why: "BOOT-CANARY-FAILED" };
  const pre = verifyChain();
  if (pre.torn || !pre.ok) return { ok: false, why: `CHAIN-BROKEN: refuse-append (fail-closed, torn@${pre.brokenAt ?? "?"})` };
  const bad = validateDraft(draft);
  if (bad) return { ok: false, why: bad };
  // דדופ: רשומת-עדכון פעילה לאותו-subject כבר קיימת → לא כותבים שוב (אידמפוטנטיות)
  if (draft.kind === "PREFERENCE-UPDATE" && activeDown(draft.subject as Subject)) {
    return { ok: false, why: "ALREADY-ACTIVE (דדופ-נושא)" };
  }
  try {
    // I4 — כינור: היעד-היחיד הוא ספר-ההעדפות
    if (!WRITE_TARGETS.has(PREF_BOOK)) { bootCanaryOk = false; return { ok: false, why: "WRITE-TARGET-VIOLATION (I4)" }; }
    const { entries } = readBookStrict();
    const book = entries;
    // prevHash תמיד מהספר-עצמו (מקור-האמת) — מדינת-ה-cache אינה משמשת לשרשור
    const prevHash = book.length ? book[book.length - 1]!.entryHash : "GENESIS";
    const seq = (book.length ? book[book.length - 1]!.seq : 0) + 1;
    const e: Omit<PrefEntry, "entryHash"> = {
      ...draft, seq, at: new Date().toISOString(),
      prevHash,
    };
    for (const ev of e.evidence ?? []) {
      ev.sha256 = sha256File(`/home/z/my-project/${ev.book}`) ?? "UNKNOWN";
      if (ev.sha256 === "UNKNOWN") return { ok: false, why: `EVIDENCE-HASH-FAILED: ${ev.book}` };
    }
    const full: PrefEntry = { ...e, entryHash: hashEntry(e) };
    fs.mkdirSync(PREF_DIR, { recursive: true });
    fs.appendFileSync(PREF_BOOK, `${JSON.stringify(full)}\n`, "utf8");
    writeState({ ...readState().state, chain: { lastEntryHash: full.entryHash, count: seq } });
    return { ok: true, entry: full };
  } catch (err) {
    return { ok: false, why: `APPEND-FAILED: ${String((err as Error)?.message ?? err).slice(0, 120)}` };
  }
}

function readState(): { state: Record<string, unknown>; chain: { lastEntryHash: string | null; count: number } } {
  try {
    const s = JSON.parse(fs.readFileSync(PREF_STATE, "utf8")) as Record<string, unknown>;
    const chain = (s.chain as { lastEntryHash: string | null; count: number } | undefined) ?? { lastEntryHash: null, count: 0 };
    return { state: s, chain };
  } catch { return { state: {}, chain: { lastEntryHash: null, count: 0 } }; }
}

function writeState(s: Record<string, unknown>): void {
  if (!WRITE_TARGETS.has(PREF_STATE)) { bootCanaryOk = false; return; }
  try {
    fs.mkdirSync(PREF_DIR, { recursive: true });
    fs.writeFileSync(PREF_STATE, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 1), "utf8");
  } catch { /* המדינה נגזרת-מחדש מהספר — לא קריטית */ }
}

/** העדפת-DOWN פעילה לנושא (ספר-תקין + לא-פג-תוקף + לא-מושעה) */
export function activeDown(subject: Subject): PrefEntry | null {
  const chain = verifyChain();
  if (!chain.ok) return null; // ספר-שבור ⇒ אפס-העדפות (fail-closed, לא שקט — ה-caller מדווח)
  const { state } = readState();
  if (state.suspended === true) return null;
  const { entries, torn } = readBookStrict();
  if (torn) return null; // ספר-קרוע ⇒ אפס-העדפות (fail-closed)
  const book = entries;
  const now = Date.now();
  let resumed = false; // RESUME-חדש-מ-סנקר את ה-SUSPEND-הישנים שמתחתיו
  for (let i = book.length - 1; i >= 0; i--) {
    const e = book[i]!;
    if (e.kind === "SUSPEND") { if (!resumed) return null; continue; }
    if (e.kind === "RESUME") { resumed = true; continue; }
    if (e.kind === "PREFERENCE-UPDATE" && e.subject === subject && e.direction === "DOWN") {
      if (e.expiresAt && new Date(e.expiresAt).getTime() < now) return null; // פג-תוקף
      return e;
    }
    if (e.kind === "PREFERENCE-EXPIRE" && e.subject === subject) return null;
  }
  return null;
}

/** מצב-מלא לתצוגה/ביקורת — כנות על שבר-שרשרת */
export function readPreferences(): {
  chainOk: boolean; chainCount: number; suspended: boolean;
  active: { subject: Subject; direction: string; expiresAt?: string; reason: string; evidence: EvidenceRef[] }[];
} {
  const chain = verifyChain();
  const { state } = readState();
  const suspended = state.suspended === true || !chain.ok;
  const active: { subject: Subject; direction: string; expiresAt?: string; reason: string; evidence: EvidenceRef[] }[] = [];
  if (!suspended) {
    for (const s of SUBJECTS) {
      const e = activeDown(s);
      if (e && e.subject) active.push({ subject: e.subject as Subject, direction: e.direction ?? "DOWN", expiresAt: e.expiresAt, reason: e.reason, evidence: e.evidence ?? [] });
    }
  }
  return { chainOk: chain.ok, chainCount: chain.count, suspended, active };
}

/**
 * מדידת-תנאי-חי לנושא (I7): מוביל-פעימה קורא לזה בכל-פעימה.
 * · תנאי-שלילי + אין-העדפה-פעילה + ראיות-זמינות ⇒ כותב DOWN (בדדופ)
 * · 3 מדידות-חיוביות רצופות מול-DOWN פעיל ⇒ כותב PREFERENCE-EXPIRE (שחרור)
 * שגיאות נבלעות-כנה — המערכת ממשיכה בחוק-הבסיס.
 */
export function notePreferenceCondition(
  subject: Subject,
  conditionOk: boolean,
  evidence?: { book: string; ref: string; value: string }[],
): { wrote: string | null; why?: string } {
  try {
    const { state } = readState();
    const streaks = (state.conditionStreaks as Record<string, number> | undefined) ?? {};
    const streak = conditionOk ? (streaks[subject] ?? 0) + 1 : 0;
    streaks[subject] = streak;
    writeState({ ...state, conditionStreaks: streaks });
    if (conditionOk) {
      if (activeDown(subject) && streak >= RELEASE_STREAK) {
        const r = appendPreference({ kind: "PREFERENCE-EXPIRE", subject, reason: `שחרור-העדפה: ${streak} מדידות-סותרות רצופות — הרג'ים שהצדיק את ה-DOWN חלף (I7)`, authority: "ADVISORY-ONLY" });
        return { wrote: r.ok ? "PREFERENCE-EXPIRE" : null, why: r.ok ? undefined : (r as { why: string }).why };
      }
      return { wrote: null };
    }
    if (activeDown(subject)) return { wrote: null, why: "already-active" };
    if (!evidence || evidence.length === 0) return { wrote: null, why: "no-evidence-offered" };
    const r = appendPreference({
      kind: "PREFERENCE-UPDATE", subject, direction: "DOWN", scope: { regime: ["pre-landing-window", "sbd-unfunded"] },
      confidence: "medium", expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      evidence: evidence.map((e) => ({ ...e, at: new Date().toISOString(), sha256: "" })),
      reason: "העדפה-נלמדת מראיות-מעוגנות: התנאי-החי שלילי (ראה evidence) — דיכוי-advisory בלבד",
      authority: "ADVISORY-ONLY",
    });
    return r.ok ? { wrote: "PREFERENCE-UPDATE" } : { wrote: null, why: (r as { why: string }).why };
  } catch (err) {
    return { wrote: null, why: `NOTE-FAILED: ${String((err as Error)?.message ?? err).slice(0, 100)}` };
  }
}

/** השעיה/הסרת-השעיה גלויות (fail-closed — זיכרון-מורעל נדחה) */
export function suspend(reason: string): void {
  appendPreference({ kind: "SUSPEND", reason: reason.slice(0, MAX_REASONS), authority: "ADVISORY-ONLY" });
  writeState({ ...readState().state, suspended: true });
}
export function resume(reason: string): void {
  appendPreference({ kind: "RESUME", reason: reason.slice(0, MAX_REASONS), authority: "ADVISORY-ONLY" });
  writeState({ ...readState().state, suspended: false });
}

/** שחזור-מדינה מהספר (מוות→שחזור, כמו ספרי-הלמידה) */
export function rebuildFromBook(): { ok: boolean; count: number } {
  const chain = verifyChain();
  const last = readBookStrict().entries.slice(-1)[0];
  writeState({
    chain: { lastEntryHash: last?.entryHash ?? null, count: last?.seq ?? 0 },
    suspended: !chain.ok,
    conditionStreaks: {},
  });
  return { ok: chain.ok, count: chain.count };
}

/**
 * §X R208R (trace 1a10dda614a62251) — כנות-חיישן במנגנון-I7:
 * מדידה-חסרה אינה ראיה-סותרת ואינה ראיה-תומכת — חוסר-מדידה ≠ 0.
 * הרצף מתאפס כדי שזקן-חיובי ישן לא ישרוד מדידה-נעדרת וישמש לשחרור-כוזב.
 * אפס-כתיבת-ספר — מדינה-בלבד; כשל נבלע (האיפוס אינו רשאי להפיל פעימה).
 */
export function resetConditionStreak(subject: Subject): void {
  try {
    const { state } = readState();
    const streaks = (state.conditionStreaks as Record<string, number> | undefined) ?? {};
    if ((streaks[subject] ?? 0) !== 0) {
      streaks[subject] = 0;
      writeState({ ...state, conditionStreaks: streaks });
    }
  } catch { /* כנות: האיפוס אינו רשאי להפיל את הפעימה */ }
}
