// ─────────────────────────────────────────────────────────────────────
// LEARNING SUBSTRATE — מצע-הלמידה הריבוני (r205, trace 1a10c5e73fbf4f89)
//
// הוראת-המפעיל (r205): "האם משהו שקורה היום משנה את מה שהמערכת תעשה מחר?
// אם לא — אין learning. יש logging."
//
// נמדד חי לפני-הבנייה (ההפרכה של r204-כהשערה → הוכחה):
//   money-mover כתב 9 פעמים רצופות ביום 05/10 (09:45→13:47) את אותו
//   expected ("הסולם מתיישר לפאריטה; מילויים אפשריים; הספר חי"),
//   ביצע, וקיבל REPRICE-FAIL זהה ("USD לא נמדד חי") — בלי שום שינוי
//   התנהגות. הלולאה נשברת בדיוק בין תוצאה להחלטה-עתידית.
//
// הלולאה הקוגניטיבית שנסגרת כאן (חוזה r205):
//   Prediction → Action → External Outcome → Evaluation →
//   → Learning signal → State change → Future decision change
//
// מודל-הלומד (נגזר מהאנטומיה, לא מהעדפה אדריכלית):
//   · יחידת-ניסיון  = ניסיון-פעולה אחד: דיון (תחזית) + תוצאה נמדדת.
//   · תחזית          = deliberation.expected — נכתבת לפני, משורשרת.
//   · תוצאה          = kind + error מהקבלה החיה של הפעולה עצמה.
//   · error          = תחזית-מופרת כאשר outcome = failed.
//   · signal/noise   = חתימה (signature) זהה חוזרת בזנב-הרצף:
//                      ≥3 רצופות זהות = מבני (signal); יחידה = רעש.
//   · confidence     = אורך-רצף-הזנב n — עולה רק עם ראיות חדשות.
//   · מספיק לשנות    = n≥3 + שרשרת-תקינה + שער-אוטונומיה ≠ PAUSED
//                      + יעד בתוך גבולות.
//   · לא מספיק       = n<3 (insufficient-evidence) · חתימות מעורבות
//                      (contradictory) · שרשרת שבורה (tamper) · PAUSED.
//   · זיכרון         = ספרי-JSONL משורשרים ב-disk + git — שורדים מוות;
//                      שחזור = רפליי updates.jsonl.
//   · מותר ללמוד     = קצב-ניסיון-חוזר בלבד (retryBackoffMin) של הגוף
//                      שצבר את הניסיון, בתוך [0,120] דק'.
//   · אסור ללמוד     = טריגרים, תקרות-תקציב, שערי-אוטונומיה, מפתחות,
//                      סמכות, חוקים — immutable (רק הקוד/המפעיל משנה).
//   · fail-closed    = שרשרת שבורה/זיכרון פגום ⇒ הערך-הנלמד מתאפס
//                      (בסיס-קוד שמרני) + השעיה גלויה — לעולם לא
//                      מיושם ידע שלא ניתן לאימות (זיכרון-מורעל נדחה).
//
// גבולות (סעיף IV בהנחיה — למידה בתוך סמכות):
//   reversible (איפוס עם כל ראיה-סותרת) · מדיד (קצב-פעימות) ·
//   מאומת (שרשרת-גיבוב) · ללא-bypass (כל השערים והתקרות קיימים) ·
//   ללא self-escalation (רק פרמטר-קצב אחד, מהנדס-החוק קבע את התחום).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const LEARN_DIR = "/home/z/my-project/sovereign/learning";
export const EXPERIENCE_FILE = `${LEARN_DIR}/experience.jsonl`;
export const UPDATES_FILE = `${LEARN_DIR}/updates.jsonl`;
export const POLICY_STATE_FILE = `${LEARN_DIR}/state.json`;

// גבולות-החוק (immutable — נקבעו בכתיבת החוק, לא נלמדים):
export const BACKOFF_MIN = 0;      // דק' — הבסיס (אין התאמה)
export const BACKOFF_MAX = 120;    // דק' — התקרה (צינון-אפקטיבי ≤150 עם בסיס-30)
export const BACKOFF_STEP = 30;    // דק' — צעד-האמונה
export const EVIDENCE_THRESHOLD = 3; // n רצופות זהות = מבני

// ── טיפוסים ──────────────────────────────────────────────────────────

export type Verdict = "success" | "failed" | "unresolvable" | "held";

/** r206 — ייחוס-אמת: הקודים שבהם הפעולה מעולם לא נגעה בעולם (סירוב-טרום-פעולה).
 *  התחזית במקרה כזה אינה "מופרכת" — היא אינה ניתנת-לבדיקה (untestable).
 *  נמדד חי (r206): 13 תחזיות שסומנו predictionViolated=true היו כולן סירובי-טרום-פעולה —
 *  אפס תחזיות שנבדקו בפועל מול העולם (r206-b). */
export const PRE_ACTION_REFUSAL_CODES = new Set([
  "NO-DELIBERATION",   // חוסר-דיון בשער (THINKING) — כישלון-חיווט של האורגניזם, לא של הסביבה
  "AUTONOMY-PAUSED",   // הסמכות עוצרה — לא ראיה על העולם
  "NO-USD-MARK",       // אין שער-ערך — הפעולה לא יצאה
  "NO-PARITY",         // רצפה לא-ניתנת-לאכיפה — הפעולה לא יצאה
  "NO-FUEL",           // אין דלק — הפעולה לא יצאה
  "NO-KEY",            // אין מפתח — לא שודר דבר (D-021)
]);

export interface DeliberationRef {
  seq: number;
  entryHash: string;
  expected: string;
  /** r206 — ההפרכה שנרשמה לפני-המעשה (מספר-הדיון) */
  falsifier?: string;
}

export interface ExperienceRec {
  seq: number;
  prevHash: string;
  entryHash: string;
  at: string;                    // זמן-התוצאה (המדידה)
  actor: string;
  action: string;
  prediction: { seq: number; entryHash: string; expected: string; falsifier?: string | null } | null; // null = ניסיון-טרום-ספר (provenance כנה)
  outcome: { kind: string; ok: boolean; error: string | null; code?: string | null };
  verdict: Verdict;
  signature: string;             // נרמול השגיאה — מפתח-הזיהוי של הכישלון
  predictionViolated: boolean;   // האם ה-expected הופרך
  epistemic: "observed";         // נמדד — לא הוסק
  provenance: { source: string; ref: string };
}

export interface UpdateRec {
  seq: number;
  prevHash: string;
  entryHash: string;
  at: string;
  kind: "BELIEF-UPDATE" | "ABSTAIN" | "SUSPEND" | "RESUME";
  param: string;
  from?: number;
  to?: number;
  actor?: string;
  action?: string;
  reason: string;
  evidence?: {
    experienceSeqs: number[];
    streak: number;
    signature: string;
    windowFrom: string;
    windowTo: string;
  };
  bounds?: { min: number; max: number; within: boolean };
  verdict?: "APPLIED" | "ABSTAINED" | "SUSPENDED" | "RESUMED";
  abstainReason?: string;
  gateMode?: string;
  /** r206 — תיקון-ייחוס: ראיה מספר-השער (TxGate) שהעדכון-שבוטל נבנה על ייחוס-שקר.
   *  אופציונלי — רק על רשומות-חדשות; רשומות-ישן בלעדיו נשארות תקפות. */
  misattribution?: {
    priorUpdateSeq: number;
    priorSignature: string;
    gateProof: string;
    auditedAt: string;
  };
}

export interface PolicyParamState {
  value: number;
  min: number;
  max: number;
  epistemic: "inferred-bounded" | "baseline";
  authority: string;
  updatedAt: string;
  updateSeq: number;
  evidence: {
    actor: string;
    action: string;
    streak: number;
    signature: string;
    experienceSeqs: number[];
    windowFrom: string;
    windowTo: string;
  } | null;
}

export interface LearningState {
  version: number;
  updatedAt: string;
  lastExperienceSeq: number;
  suspended: boolean;
  lastAbstain: { at: string; reason: string } | null;
  params: { retryBackoffMin: PolicyParamState };
}

export interface LearnedRead {
  backoffMin: number;
  epistemic: string;
  suspended: boolean;
  chainOk: boolean;
  evidence: PolicyParamState["evidence"];
  updatedAt: string | null;
}

// ── יסודות-שרשרת ─────────────────────────────────────────────────────

function hashLine(rec: object): string {
  const { entryHash: _omit, ...rest } = rec as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

function readJsonl<T>(file: string): T[] {
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return [];
    return raw.split("\n").map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

function appendJsonl(file: string, rec: object): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(rec)}\n`, "utf8");
}

export interface ChainCheck {
  ok: boolean;
  count: number;
  brokenAt: number | null; // seq הרשומה הראשונה שנכשלה
  torn?: boolean; // קו-קרוע (מ. 7 בהפרכה): קריעה אינה "ריק" — היא שבר
}

/** המאמת: קו-לא-JSON = שבר כנה (לא קובץ-ריק); prevHash→entryHash לכל רשומה */
export function verifyChain(file: string): ChainCheck {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: true, count: 0, brokenAt: null }; // אין-קובץ = ספר-חדש לגיטימי
  }
  const rawLines = raw.split("\n").filter((l, i, arr) => !(l === "" && i === arr.length - 1));
  const lines: Array<Record<string, unknown>> = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i]!.trim();
    if (!l) continue;
    try {
      lines.push(JSON.parse(l) as Record<string, unknown>);
    } catch {
      return { ok: false, count: rawLines.length, brokenAt: i + 1, torn: true }; // קו קרוע ≠ ריק
    }
  }
  let prevHash = "GENESIS";
  for (let i = 0; i < lines.length; i++) {
    const rec = lines[i]!;
    const expect = rec.entryHash;
    const actual = hashLine(rec);
    if (expect !== actual || rec.prevHash !== prevHash) {
      return { ok: false, count: lines.length, brokenAt: i + 1 };
    }
    prevHash = String(expect);
  }
  return { ok: true, count: lines.length, brokenAt: null };
}

// ── נרמול-חתימה: אותו כישלון מבני = אותה חתימה.
// r205-adv מ. 3: מספרים-חיים בתוך הודעת-שגיאה הופכים כישלון-מבני לרעש —
// המספרים נשטפים לפני-החתימה ("נזיל 7.959" ≡ "נזיל 8.1").

export function signatureOf(errorText: string | null | undefined, kind: string): string {
  const base = String(errorText ?? kind)
    .replace(/\d+\.?\d*/g, "#") // שטיפת-מספרים — הפרמטר החי אינו חלק-מהחתימה
    .replace(/\s+/g, " ")
    .trim();
  return base.slice(0, 64).toLowerCase();
}

// ── משפחת-פעולה: REPRICE/REPRICE-FAIL = משפחה אחת (r205-adv מ. 4 —
// כישלון-REPRICE לא נשבר על-ידי הצלחת FILL-DEPLOY; הרצף נשפט בתוך-משפחה)
export function familyOf(kind: string): string {
  return kind.replace(/-FAIL$/, "");
}

// ── רישום-ניסיון (Evaluation: תוצאה → רשומת-ניסיון משורשרת) ──────────

export function verdictOfOutcome(ok: boolean, code?: string | null): Verdict {
  if (ok) return "success";
  if (code === "GATE-QUEUED") return "unresolvable"; // ממתין-סמכות — לא הצלחה ולא כישלון-חזוי
  // r206 — ייחוס-אמת: סירובי-האורגניזם-עצמו (חוסר-דיון שהגיע לשער / סמכות עוצרה)
  // אינם ראיה על קצב-הסביבה — הם שקופים-לרצף (כמו GATE-QUEUED). הצינון לא יילמד
  // מחיווט-שבור: חיווט מתוקן, לא המתנה. (נמדד חי: 14/14 הסירובים היו NO-DELIBERATION —
  // והלומד בנה מהם צינון-120' על ייחוס-שקר "usd מת".)
  if (code === "NO-DELIBERATION" || code === "AUTONOMY-PAUSED") return "unresolvable";
  return "failed";
}

export interface OutcomeInput {
  actor: string;
  action: string;
  outcomeAt: string;
  kind: string;
  ok: boolean;
  error: string | null;
  code?: string | null;
  deliberation: DeliberationRef | null;
  source: string; // "act-receipt" | "history-seed"
  ref?: string;   // אימות-מקור (למשל historyAt)
}

/** idempotency לפי-זהות-האירוע (r205-adv מ. 2): אותו אירוע (גוף+זמן+סוג)
 *  לא נרשם פעמיים — בין-אם-הגיע כ-act-receipt ובין-אם-כ-history-seed.
 *  כך הריסטארט אינו מנפח את חלון-הראיות. */
function eventKeyOf(actor: string, outcomeAt: string, kind: string): string {
  return `${actor}|${outcomeAt}|${familyOf(kind)}`;
}

function experienceExistsByEvent(key: string): boolean {
  const all = readJsonl<ExperienceRec>(EXPERIENCE_FILE);
  return all.some((e) => eventKeyOf(e.actor, e.at, e.outcome.kind) === key);
}

export function appendExperience(input: OutcomeInput): ExperienceRec | null {
  const ref = input.ref ?? `${input.source}:${input.outcomeAt}`;
  const eventKey = eventKeyOf(input.actor, input.outcomeAt, input.kind);
  if (experienceExistsByEvent(eventKey)) return null; // אידמפוטנטי לפי-זהות-האירוע
  const all = readJsonl<ExperienceRec>(EXPERIENCE_FILE);
  const prev = all.length > 0 ? all[all.length - 1]! : null;
  const verdict = verdictOfOutcome(input.ok, input.code);
  // r206 — גזירת-ההפרכה: predictionViolated := failed ∧ תחזית-קיימת ∧ לא-סירוב-טרום-פעולה.
  // סירוב-טרום-פעולה ⇒ התחזית untestable (הפעולה לא נגעה בעולם) — לעולם לא "הופרכה".
  const predictionTestable =
    verdict === "failed" &&
    !!input.deliberation &&
    !(input.code && PRE_ACTION_REFUSAL_CODES.has(input.code));
  const rec: ExperienceRec = {
    seq: (prev?.seq ?? 0) + 1,
    prevHash: prev?.entryHash ?? "GENESIS",
    at: input.outcomeAt,
    actor: input.actor,
    action: input.action,
    prediction: input.deliberation
      ? {
          seq: input.deliberation.seq,
          entryHash: input.deliberation.entryHash,
          expected: input.deliberation.expected.slice(0, 200),
          ...(input.deliberation.falsifier ? { falsifier: input.deliberation.falsifier.slice(0, 200) } : {}),
        }
      : null,
    outcome: { kind: input.kind.slice(0, 40), ok: input.ok, error: input.error ? String(input.error).slice(0, 200) : null, code: input.code ?? null },
    verdict,
    signature: verdict === "failed" ? signatureOf(input.error, input.kind) : "",
    predictionViolated: predictionTestable,
    epistemic: "observed",
    provenance: { source: input.source, ref },
  };
  rec.entryHash = hashLine(rec);
  appendJsonl(EXPERIENCE_FILE, rec);
  return rec;
}

// ── זנב-הרצף: יחידת הראיה (signal/noise + contradiction) ────────────

export interface TailStreak {
  n: number;                      // אורך-רצף-הזנב של כישלונות זהים
  signature: string;
  experienceSeqs: number[];
  windowFrom: string | null;
  windowTo: string | null;
  lastVerdict: Verdict | "empty";
}

/** רצף-הזנב — אלגוריתם דו-שלבי מודע-משפחה (r205-adv מ. 4):
 *  שלב-א: משפחת-האמונה = המשפחה של **הכישלון האחרון** (זו האמונה שנשפטת).
 *  שלב-ב: מהכישלון-האחרון אחורה — רק אירועי-אותה-משפחה נראים (חוצי-משפחה
 *  ו-unresolvable שקופים לגמרי):
 *    · הצלחה באותה משפחה = ראיה-סותרת → איפוס (lastVerdict=success).
 *    · כישלונות אותה-חתימה+משפחה מצטברים (n).
 *    · חתימה-שונה/הצלחה-במשפחה עוצרים את הספירה.
 *  הצטברות רק על גוף-ניסיון אחד (actor+action). */
export function tailStreak(actor: string, action: string): TailStreak {
  const all = readJsonl<ExperienceRec>(EXPERIENCE_FILE).filter(
    (e) => e.actor === actor && e.action === action,
  );
  if (all.length === 0) return { n: 0, signature: "", experienceSeqs: [], windowFrom: null, windowTo: null, lastVerdict: "empty" };
  // שלב-א: משפחת-האמונה מהכישלון האחרון
  let fam: string | null = null;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]!.verdict === "failed") { fam = familyOf(all[i]!.outcome.kind); break; }
  }
  if (fam === null) {
    // אין כישלון בספר — אין אמונה-מבנית לשפוט
    return { n: 0, signature: "", experienceSeqs: [], windowFrom: null, windowTo: null, lastVerdict: "empty" };
  }
  // שלב-ב: הליכה אחורה תוך-המשפחה בלבד
  //  · האירוע המשפחתי הראשון מהזנב קובע: הצלחה → איפוס (n=0); כישלון → ספירה.
  //  · גבול-הרצף: הצלחה/חתימה-שונה עוצרים ספירה (n נשמר — "n כישלונות רצופים
  //    מאז-האירוע-המשפחתי-הקודם"), חוצי-משפחה/unresolvable שקופים.
  let n = 0;
  const seqs: number[] = [];
  let sig: string | null = null;
  let windowTo: string | null = null;
  let windowFrom: string | null = null;
  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i]!;
    if (familyOf(e.outcome.kind) !== fam) continue; // חוצה-משפחה — שקוף
    if (e.verdict === "unresolvable" || e.verdict === "held") continue; // ניטרלי
    if (e.verdict === "success") {
      if (sig === null) {
        return { n: 0, signature: "", experienceSeqs: [], windowFrom: null, windowTo: e.at, lastVerdict: "success" }; // הראיה-המשפחתי האחרון = הצלחה → איפוס
      }
      break; // גבול-הרצף: n כישלונות מאז-ההצלחה הזאת — הספירה נשמרת
    }
    // failed
    if (sig === null) { sig = e.signature; windowTo = e.at; }
    if (e.signature === sig) {
      n += 1;
      seqs.unshift(e.seq);
      windowFrom = e.at; // r206 — תיקון-חלון: ההליכה-אחורה מסתיימת בזקן — החלון חייב להשתרע זקן→חדש (נמדד חי: windowFrom קרס לנקודה אחת)
    } else break; // חתימה-אחרת באותה משפחה = הרצף נשבר
  }
  return {
    n,
    signature: sig ?? "",
    experienceSeqs: seqs,
    windowFrom,
    windowTo,
    lastVerdict: "failed",
  };
}

// ── קריאת-מצב-מדיניות + שחזור (הזיכרון ששורד מוות) ───────────────────

function defaultLearningState(): LearningState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    lastExperienceSeq: 0,
    suspended: false,
    lastAbstain: null,
    params: {
      retryBackoffMin: {
        value: BACKOFF_MIN,
        min: BACKOFF_MIN,
        max: BACKOFF_MAX,
        epistemic: "baseline",
        authority: "bounded-adaptation-law r205 — קצב-ניסיון-חוזר בלבד; טריגרים/תקרות/שערים immutable",
        updatedAt: new Date().toISOString(),
        updateSeq: 0,
        evidence: null,
      },
    },
  };
}

function validState(s: unknown): s is LearningState {
  if (!s || typeof s !== "object") return false;
  const st = s as LearningState;
  const p = st.params?.retryBackoffMin;
  return !!p && Number.isFinite(p.value) && p.value >= BACKOFF_MIN && p.value <= BACKOFF_MAX;
}

export function readLearningState(): LearningState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(POLICY_STATE_FILE, "utf8")) as LearningState;
    return validState(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** שחזור-מוות: רפליי ספר-העדכונים — הידע נבנה-מחדש מהראיות עצמן */
export function rebuildFromUpdates(): LearningState | null {
  const chain = verifyChain(UPDATES_FILE);
  if (!chain.ok) return null; // שרשרת-עדכונים שבורה — לא בונים ממנה (fail-closed)
  const updates = readJsonl<UpdateRec>(UPDATES_FILE).filter((u) => u.kind === "BELIEF-UPDATE" && u.verdict === "APPLIED");
  const st = defaultLearningState();
  for (const u of updates) {
    if (u.param !== "retryBackoffMin") continue;
    const to = Number(u.to);
    if (!Number.isFinite(to) || to < BACKOFF_MIN || to > BACKOFF_MAX) continue; // עדכון-חוץ-גבולות נדחה
    // r206 — הסיווג-האפיסטמי נשמר-נאמן בשחזור: ערך-0 = בסיס-החוק (אין התאמה
    // פעילה — כולל תיקון-ייחוס) ולא "היסק-חסום"; תיקון-מייחס נושא את סמכותו.
    st.params.retryBackoffMin = {
      value: to,
      min: BACKOFF_MIN,
      max: BACKOFF_MAX,
      epistemic: to === BACKOFF_MIN ? "baseline" : "inferred-bounded",
      authority: u.misattribution
        ? "bounded-adaptation-law r205 · תיקון-ייחוס r206 (ראיה: TxGate)"
        : "bounded-adaptation-law r205",
      updatedAt: u.at,
      updateSeq: u.seq,
      evidence: u.evidence
        ? {
            actor: u.actor ?? "money-mover",
            action: u.action ?? "grid-act",
            streak: u.evidence.streak,
            signature: u.evidence.signature,
            experienceSeqs: u.evidence.experienceSeqs,
            windowFrom: u.evidence.windowFrom,
            windowTo: u.evidence.windowTo,
          }
        : null,
    };
  }
  const expChain = verifyChain(EXPERIENCE_FILE);
  st.lastExperienceSeq = expChain.ok ? expChain.count : 0;
  return st;
}

function writeLearningState(st: LearningState): void {
  // r205-adv מ. 8: lastExperienceSeq מרענן בכל כתיבה — השדה חי, לא מת
  try { st.lastExperienceSeq = verifyChain(EXPERIENCE_FILE).count; } catch { /* משאיר ערך קיים */ }
  fs.mkdirSync(LEARN_DIR, { recursive: true });
  const tmp = `${POLICY_STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2));
  fs.renameSync(tmp, POLICY_STATE_FILE);
}

// ── רישום-עדכונים ────────────────────────────────────────────────────

function appendUpdate(u: Omit<UpdateRec, "seq" | "prevHash" | "entryHash" | "at"> & { at?: string }): UpdateRec {
  const all = readJsonl<UpdateRec>(UPDATES_FILE);
  const prev = all.length > 0 ? all[all.length - 1]! : null;
  const rec: UpdateRec = {
    seq: (prev?.seq ?? 0) + 1,
    prevHash: prev?.entryHash ?? "GENESIS",
    at: u.at ?? new Date().toISOString(),
    ...u,
  };
  rec.entryHash = hashLine(rec);
  appendJsonl(UPDATES_FILE, rec);
  return rec;
}

// ── קריאת-החלטה-חיה (fail-closed: זיכרון שלא ניתן לאימות = בסיס) ─────

// r205-adv מ. 9: דגל-השעיה חוצה-דורות — hot-reload לא מכפיל רישומי-SUSPEND
const G_LEARN = globalThis as unknown as { __LEARN_SUSPENDED_NOTIFIED__?: boolean };

export function readLearnedBackoff(): LearnedRead {
  try {
    const expChain = verifyChain(EXPERIENCE_FILE);
    if (!expChain.ok) {
      if (!G_LEARN.__LEARN_SUSPENDED_NOTIFIED__) {
        try {
          appendUpdate({
            kind: "SUSPEND",
            param: "retryBackoffMin",
            reason: `שרשרת-ספר-הניסיון נשברה ברשומה #${expChain.brokenAt}${expChain.torn ? " (קו-קרוע)" : ""} — הידע-הנלמד נדחה (fail-closed, זיכרון-מורעל נדחה)`,
            verdict: "SUSPENDED",
          });
        } catch { /* גם רישום-ההשעיה לא מפיל קורא-החלטה */ }
        G_LEARN.__LEARN_SUSPENDED_NOTIFIED__ = true;
      }
      return { backoffMin: BACKOFF_MIN, epistemic: "baseline", suspended: true, chainOk: false, evidence: null, updatedAt: null };
    }
    let st = readLearningState();
    if (!st) {
      // זיכרון-מצב חסר/פגום → שחזור מספר-העדכונים (הידע נבנה מהראיות)
      st = rebuildFromUpdates();
      if (st) {
        st.suspended = false;
        try { writeLearningState(st); } catch { /* כתיבת-שחזור נכשלה — הקריאה עצמה תקפה */ }
      }
    }
    if (!st) {
      return { backoffMin: BACKOFF_MIN, epistemic: "baseline", suspended: false, chainOk: true, evidence: null, updatedAt: null };
    }
    const p = st.params.retryBackoffMin;
    // אימות-קישוריות: העדכון מתייחס לראיות שקיימות באמת בספר-הניסיון
    if (p.evidence && p.evidence.experienceSeqs.some((s) => s > expChain.count)) {
      return { backoffMin: BACKOFF_MIN, epistemic: "baseline", suspended: true, chainOk: true, evidence: null, updatedAt: p.updatedAt };
    }
    return {
      backoffMin: p.value,
      epistemic: p.epistemic,
      suspended: st.suspended,
      chainOk: true,
      evidence: p.evidence,
      updatedAt: p.updatedAt,
    };
  } catch {
    return { backoffMin: BACKOFF_MIN, epistemic: "baseline", suspended: true, chainOk: false, evidence: null, updatedAt: null };
  }
}

// ── חוק-ההתאמה החסום (Infer → Update → Change) ───────────────────────

export interface AdaptationResult {
  verdict: "APPLIED" | "ABSTAINED" | "SUSPENDED" | "NO-CHANGE";
  reason: string;
  streak: number;
  from: number;
  to: number;
}

/**
 * הלומד: קורא זנב-רצף מספר-הניסיון ומעדכן את הפרמטר החסום.
 *   · n≥3 זהות רצופה → backoff = min(MAX, STEP*(n-2)) — עדכון-מרוסן.
 *   · הצלחה/חתימה-אחרת בזנב → backoff=0 — חזרה-מהירה (reversible).
 *   · n<3 → הימנעות (insufficient-evidence) — רעש לא מלמד.
 *   · שרשרת שבורה / PAUSED → השעיה/הימנעות — לא לומדים בזמן-עצירה.
 * כתיבה לספר-העדכונים רק כשהכרעה משתנה (אפס-רעש-ספר).
 */
export function runAdaptation(actor: string, action: string, gateMode: string): AdaptationResult {
  // r205-adv מ. 9: PAUSED נבדק ראשון — אף רישום/הימנעות/עדכון לא קורה בזמן-עצירה
  if (gateMode === "PAUSED") {
    const stPaused = readLearningState() ?? defaultLearningState();
    if (stPaused.lastAbstain?.reason !== "gate-paused") {
      appendUpdate({ kind: "ABSTAIN", param: "retryBackoffMin", actor, action, reason: "gate-paused — לא לומדים בזמן-עצירה (חוק-r197)", verdict: "ABSTAINED", abstainReason: "gate-paused", gateMode });
      stPaused.lastAbstain = { at: new Date().toISOString(), reason: "gate-paused" };
      try { writeLearningState(stPaused); } catch { /* כתיבה נכשלה — ההימנעות עצמה נרשמה */ }
    }
    return { verdict: "ABSTAINED", reason: "gate-paused", streak: 0, from: stPaused.params.retryBackoffMin.value, to: stPaused.params.retryBackoffMin.value };
  }
  const expChain = verifyChain(EXPERIENCE_FILE);
  if (!expChain.ok) {
    readLearnedBackoff(); // מפיק רישום-SUSPEND חד-פעמי
    return { verdict: "SUSPENDED", reason: `chain-broken#${expChain.brokenAt}`, streak: 0, from: BACKOFF_MIN, to: BACKOFF_MIN };
  }
  const st = readLearningState() ?? rebuildFromUpdates() ?? defaultLearningState();
  const current = st.params.retryBackoffMin.value;
  const streak = tailStreak(actor, action);
  let target = current;
  let reason = "";
  if (streak.lastVerdict === "success") {
    target = BACKOFF_MIN;
    reason = "ראיה-סותרת: הפעולה האחרונה הצליחה — הסביבה השתנתה; ההתאמה מתאפסת (reversible)";
    // r206 — מטא-קוגניציה: איפוס שמבטל עדכון-קיים נושא את העובדה שהלקח הקודם
    // אינו עוד מוצדק — הראיה החיה החדשה (מגע-אמת עם העולם) גוברת עליו.
    if (current > 0 && st.params.retryBackoffMin.evidence) {
      reason += ` · מטא-קוגניציה: עדכון #${st.params.retryBackoffMin.updateSeq} (חתימה "${st.params.retryBackoffMin.evidence.signature.slice(0, 48)}") אינו עוד מוצדק — ההצלחה הנמדדת היא מגע-אמת ראשון שמפריך את הלקח הקודם`;
    }
  } else if (streak.lastVerdict === "failed" && streak.n >= EVIDENCE_THRESHOLD) {
    target = Math.min(BACKOFF_MAX, BACKOFF_STEP * (streak.n - (EVIDENCE_THRESHOLD - 1)));
    reason = `${streak.n} כישלונות רצופים באותה חתימה מבנית (${streak.signature.slice(0, 48)}) — התאמת-קצב חוזר בתוך הגבולות`;
  } else if (streak.lastVerdict === "failed" && streak.n < EVIDENCE_THRESHOLD) {
    target = BACKOFF_MIN;
    reason = `insufficient-evidence: n=${streak.n} < ${EVIDENCE_THRESHOLD} — רעש לא מלמד`;
    if (current === target) {
      // סעיף XVII: הימנעות היא קוגניציה — נרשמת גלויה (פעם-אחת-לסיבה)
      recordAbstain(actor, action, "insufficient-evidence", streak.n, gateMode);
      return { verdict: "ABSTAINED", reason: "insufficient-evidence", streak: streak.n, from: current, to: current };
    }
  } else {
    // unresolvable/empty — אין ראיה
    return { verdict: "NO-CHANGE", reason: `אין-ראיה (${streak.lastVerdict})`, streak: 0, from: current, to: current };
  }
  if (target === current) {
    return { verdict: "NO-CHANGE", reason: "היעד-נלמד שווה לנוכחי", streak: streak.n, from: current, to: current };
  }
  const within = target >= BACKOFF_MIN && target <= BACKOFF_MAX;
  if (!within) {
    appendUpdate({ kind: "ABSTAIN", param: "retryBackoffMin", actor, action, reason: `יעד ${target} מחוץ-לגבולות [${BACKOFF_MIN},${BACKOFF_MAX}] — נדחה`, verdict: "ABSTAINED", abstainReason: "bounds-violation", gateMode });
    return { verdict: "ABSTAINED", reason: "bounds-violation", streak: streak.n, from: current, to: current };
  }
  const upd = appendUpdate({
    kind: "BELIEF-UPDATE",
    param: "retryBackoffMin",
    from: current,
    to: target,
    actor,
    action,
    reason,
    evidence: {
      experienceSeqs: streak.experienceSeqs,
      streak: streak.n,
      signature: streak.signature,
      windowFrom: streak.windowFrom ?? "",
      windowTo: streak.windowTo ?? "",
    },
    bounds: { min: BACKOFF_MIN, max: BACKOFF_MAX, within: true },
    verdict: "APPLIED",
    gateMode,
  });
  st.params.retryBackoffMin = {
    value: target,
    min: BACKOFF_MIN,
    max: BACKOFF_MAX,
    epistemic: "inferred-bounded",
    authority: "bounded-adaptation-law r205",
    updatedAt: upd.at,
    updateSeq: upd.seq,
    evidence: {
      actor,
      action,
      streak: streak.n,
      signature: streak.signature,
      experienceSeqs: streak.experienceSeqs,
      windowFrom: streak.windowFrom ?? "",
      windowTo: streak.windowTo ?? "",
    },
  };
  st.lastAbstain = null;
  st.updatedAt = upd.at;
  writeLearningState(st);
  return { verdict: "APPLIED", reason, streak: streak.n, from: current, to: target };
}

// ── תיקון-אמונה מטא-קוגניטיבי (r206 — append-only, fail-closed) ────────

export interface MisattributionProof {
  noDelibCount: number;   // כמה סירובי NO-DELIBERATION עם USD חי בחלון-הראיות
  maxUsd: number;         // הערכת-ה-USD הגבוהה בסירובים — הוכחת "השער לא היה מת"
  windowFrom: string;
  windowTo: string;
  auditedAt: string;
}

/**
 * r206 — האורגניזם מגלה שהעדכון-הנלמד שלו נבנה על ייחוס-שקר ומתקן אותו:
 *   · הראיה: ספר-השער (TxGate) — ספר-סמכות עצמאי, לא זיכרון-עצמי.
 *   · הכלל: כל הסירובים בחלון-הראיות היו NO-DELIBERATION עם הערכת-USD חיה
 *     ⇒ התחזיות מעולם לא נבדקו מול העולם ⇒ הסיבה האמיתית היא חיווט, לא קצב.
 *   · התיקון: BELIEF-UPDATE append-only עם ציטוט-ראיות (misattribution) —
 *     הספרים-הקיימים לא נגעים, ההיפוך ניתן-לשחזור מרפליי-העדכונים.
 *   · fail-closed: בלי ראיה-מלאה / שרשרת-שבורה / אין-אמונה-נלמדת ⇒ אין תיקון.
 */
export function applyMisattributionCorrection(proof: MisattributionProof): UpdateRec | null {
  try {
    const expChain = verifyChain(EXPERIENCE_FILE);
    if (!expChain.ok) return null; // שרשרת-שבורה — לא מתקנים דווקא עכשיו (fail-closed)
    const st = readLearningState() ?? rebuildFromUpdates();
    if (!st) return null;
    const p = st.params.retryBackoffMin;
    if (p.value <= 0 || !p.evidence) return null; // אין אמונה-נלמדת לתקן
    if (!p.evidence.signature.includes("usd לא נמדד")) return null; // הביקורת מכירה רק את הייחוס-המדוד — לא ממציאה אחרים
    if (proof.noDelibCount < EVIDENCE_THRESHOLD) return null; // ראיה-לא-מספקת
    const reason =
      `תיקון-ייחוס מטא-קוגניטיבי: העדכון #${p.updateSeq} (retryBackoffMin ${p.value}→0) נבנה על חתימה ` +
      `"${p.evidence.signature.slice(0, 56)}…" — ספר-השער (TxGate, ספר-סמכות עצמאי) מוכיח שכל הסירובים ` +
      `בחלון-הראיות (${proof.windowFrom.slice(11, 19)}→${proof.windowTo.slice(11, 19)}Z) היו ` +
      `autonomy:NO-DELIBERATION ×${proof.noDelibCount} עם הערכת-USD חיה (מקסימום $${proof.maxUsd.toFixed(2)}) — ` +
      `הפעולות מעולם לא נגעו בעולם: התחזיות לא הופרכו, הן לא נבדקו. הפרשנות-הסיבתית שלי ("שער-מת") היתה שגויה — ` +
      `הסיבה האמיתית: הדיון לא נסע לשער. הלמידה היתה אמיתית-מנגנונית, שקרית-תוכן; הקצב לא היה הבעיה — החיווט היה. ` +
      `האמונה מתוקנת, לא רק הערך.`;
    const upd = appendUpdate({
      kind: "BELIEF-UPDATE",
      param: "retryBackoffMin",
      from: p.value,
      to: BACKOFF_MIN,
      actor: "money-mover",
      action: "grid-act",
      reason,
      evidence: {
        experienceSeqs: p.evidence.experienceSeqs,
        streak: 0,
        signature: p.evidence.signature,
        windowFrom: p.evidence.windowFrom,
        windowTo: p.evidence.windowTo,
      },
      bounds: { min: BACKOFF_MIN, max: BACKOFF_MAX, within: true },
      verdict: "APPLIED",
      misattribution: {
        priorUpdateSeq: p.updateSeq,
        priorSignature: p.evidence.signature,
        gateProof: `TxGate: כל הסירובים בחלון REFUSED/autonomy:NO-DELIBERATION עם usdValue>0 (max $${proof.maxUsd.toFixed(2)}) · n=${proof.noDelibCount}`,
        auditedAt: proof.auditedAt,
      },
    });
    st.params.retryBackoffMin = {
      value: BACKOFF_MIN,
      min: BACKOFF_MIN,
      max: BACKOFF_MAX,
      epistemic: "baseline",
      authority: "bounded-adaptation-law r205 · תיקון-ייחוס r206 (ראיה: TxGate)",
      updatedAt: upd.at,
      updateSeq: upd.seq,
      evidence: null,
    };
    st.lastAbstain = null;
    st.updatedAt = upd.at;
    writeLearningState(st);
    return upd;
  } catch {
    return null; // התיקון לעולם לא מפיל את הקורא
  }
}

/** רישום-הימנעות גלויה (רק כשהסיבה חדשה — אפס-רעש-ספר) */
export function recordAbstain(actor: string, action: string, reason: string, streakN: number, gateMode: string): void {
  let st = readLearningState();
  if (st?.lastAbstain?.reason === reason) return;
  appendUpdate({
    kind: "ABSTAIN",
    param: "retryBackoffMin",
    actor,
    action,
    reason: `${reason} (n=${streakN})`,
    verdict: "ABSTAINED",
    abstainReason: reason,
    gateMode,
  });
  if (!st) {
    st = rebuildFromUpdates() ?? defaultLearningState();
    st.lastExperienceSeq = verifyChain(EXPERIENCE_FILE).ok ? verifyChain(EXPERIENCE_FILE).count : 0;
  }
  st.lastAbstain = { at: new Date().toISOString(), reason };
  try { writeLearningState(st); } catch { /* ההימנעות עצמה נרשמה בספר */ }
}
