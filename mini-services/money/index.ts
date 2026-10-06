// ─────────────────────────────────────────────────────────────────────
// MONEY-MOVER — מוביל הכסף · דיבון סולם-הפאריטה (R81, rebuilt R90)
//
// החוזה: המוח הפיננסי חי ב-/api/money (Next.js) — הדיבון הוא לב-פעימה
// בלבד: מודד כל 60ש', מפעיל REPRICE כשהקו זז, וכותב את המצב לספרים.
//
// R97: טריגר שלישי — ARM-BUY: SBD חמוש (≥0.15 מחויב) → סולם קנייה
// מתחת לפאריטה (המיקרו-גריד נעשה דו-צדדי · הזדמנות O1). כל פעולה
// עוברת את שער-העסקאות ב-/api/money: מתחת ל-$100 — אוטונומיה;
// מעל — GATE-QUEUED, כלום לא זז עד אישור המפעיל (הוראת המפעיל).
//
// R101: רגל HIVE חוזרת לקנון — המנוע שנבנה ב-R99 אבד לארעיות-הסנדבוקס
// (הפקודות חיות על השרשרת; הקוד לא הועלה לגיט). הדיבון מעתה מנהל שתי
// רגליים: STEEM (הסולם הגדול) + HIVE (המיקרו-גריד הצמוד) — אותו
// צינון, אותו תקציב, אותו שער-$100. חוק-החוט ב-hive-wire.
//
// R103: שני ריילים חדשים למעגל הכלכלה החיה:
//   · reward-pay — מילויי-גריד אמיתיים (עבודה) ← SAOS למאזן הזירה
//     של הסוכן (מטבע) ← ניתן להחלפה ב-USDS בבריכה (נזילות).
//     סגירת המעגל עבודה→מטבע→נזילות — הוראת המפעיל.
//   · liquidity-stream — גל-דלק (פאוורדאון שבועי ~475 STEEM) ←
//     20% ממנו הופך לעומק בריכות הזירה לפני פריסת הסולם.
//
// חוקי-ברזל (מהקנון):
//   · טריגרים: סטיית-פאריטה >50bps מהמדרגה · נזיל ≥1 STEEM
//   · צינון 30 דק' בין פעולות · תקציב 12 פעולות/יום
//   · acting=true בזמן פעולה — השומר לעולם לא הורג באמצע (חוק הפעולה)
//   · כנות: מדידה שנכשלה נרשמת ככישלון — אין "נניח שבסדר"
//   · הקנון מקבל קבלה אחרי כל פעולה, אחרי שער-סודות
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import { readGate, autonomyVerdict, appendDeliberation, readDeliberations } from "../autonomy";
// r205 — מצע-הלמידה: סגירת-הלולאה הקוגניטיבית (תחזית→מעשה→תוצאה→הערכה→
// →אות-למידה→שינוי-מצב→החלטה-עתידית-שונה). החיבור כולו fail-closed:
// כל שגיאת-למידה נבלעת — הדיבון ממשיך בדיוק כמו לפני (בסיס-החוק).
import { appendExperience, runAdaptation, readLearnedBackoff, applyMisattributionCorrection, PRE_ACTION_REFUSAL_CODES, type DeliberationRef } from "../learning";
// r207 — שכבת-ההעדפות הנלמדות (trace 1a10d1ddb659450d · מפרט-חוסם I1–I8 של שופט-הבטיחות):
// advisory-only · חד-כיוונית-שמרנית (יכולה רק לדכא פעולה ל-WAIT — לעולם לא לכפות) ·
// אוצר-מילים סגור · שופט-חוץ (ראיות מספרים-שהמודול לא כותב) · תפוגת-תוקף + שחרור ב-3 מדידות-סותרות.
// כשל-מודול = אפס-העדפות = חוק-הבסיס שלפני-r207 (fail-open לדיכוי-בלבד).
import { notePreferenceCondition, activeDown, rebuildFromBook, resetConditionStreak } from "../preferences";
import {
  appendIntent,
  closeIntent,
  bootReconcileIntents,
  isSuppressed,
  verifyIntentsBook,
} from "./intents"; // R208P — ספר-כוונות write-ahead: חלון-הכפילות intent-last נסגר (הכרעת trace 1a10e219d0860c0d)
// r208 — חוזה-צריכת-מטרות (trace 1a10d7a051e822d1): המודל נטען-מאומת דרך
// ממשק-צר בלבד; גבול-הגל הוא פונקציה-טהורה ניתנת-לשחזור; תחזית-טרום-פעולה
// (§VII) נכתבת לפני-ההכרעה. המודל משפיע על העדפה בלבד — הסמכות נשארת בשער.
import { appendPrediction, closePrediction, objectiveDecisionView, predictWaveDecision, getArmingThresholdSbd } from "../objective-consumer";
import { waveDecision } from "../wave-decision";
import { createHash } from "node:crypto";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה (כמו במפעל-האימות)
declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/money/state.json`;
const HISTORY_FILE = `${HOME}/sovereign/money/history.json`;
const PORT = 3034;
// r205 — גוף-הניסיון של הלומד: ניסיונות grid-act של המוביל בלבד
const LEARN_ACTOR = "money-mover";
const LEARN_ACTION = "grid-act";
const CHECK_INTERVAL_SEC = 60;
const API = "http://127.0.0.1:3000/api/money";
const HIVE_API = "http://127.0.0.1:3000/api/money/hive";
const EXCHANGE_API = "http://127.0.0.1:3000/api/exchange";
const POLICY = {
  triggers: { parityDriftBps: 50, floorBps: -50, idleTriggerSteem: 1 },
  cooldownMin: 30,
  actionsBudgetPerDay: 12,
  // r146-d — FILL-DEPLOY (נמדד חי): זמן-בין-מילויים חציוני 29.9 דק' == הצינון
  // בן 30 הדק' בדיוק — קצב-המילויים היה קשור-צינון, לא קשור-ביקוש. לאחר מילוי
  // אמיתי (fill_order) הספר יושב ריק עד תום הצינון — אפס הסתברות-מילוי בדיוק
  // כשהביקוש הוכיח את עצמו. מעתה: מילוי מקצר את הצינון ל-5 דק' להצבה-הבאה
  // (אותו תקציב 12/יום, אותן מסילות: רצפת-ערך, שער-$100, פרמיות 0..400bps).
  // מטרת-הצינון היא אנטי-שחיקה של ספר-בריא — לא השארת-ספר-ריק אחרי עבודה.
  fillDeploy: { cooldownMin: 5 },
  // r147-a — סולם-הקנייה צמוד-שוק (D-r147-ECO, מדידה חי): היסטי ה-bidLadderLaw
  // עברו מ-[100..500] ל-[20,40,80,160,320] bps — אפס מילויי-קנייה מאז-הרחבת r145
  // מול 12 מילויי-מכירה; הבידים הישנים ישבו 130+bps מאחורי ראש-הספר החי.
  // אותו מקור-אמת של ה-route (BID_OFFSETS_BPS ב-/api/money) — מדידה אחת.
  armBuy: { minSbd: 0.30, offsetsBps: [20, 40, 80, 160] }, // R97 — צד הקנייה של המיקרו-גריד · r145-a: 5 רמות · r147-a: צמוד-שוק · r151: הידוק מהמדידה — קצץ 320bps (תופסת-סכין, ניתוח pnl-scan: קנייה-avg 0.1056 מול מכירה-avg 0.1019) + רף-חימוש 0.15→0.30 (פחות-גלגולים, יותר-מובהקות)
  hive: { driftBps: 50 },
  stockSbd: { premiumCapBps: 200, keepSteem: 0.5 }, // R101b - arming-inventory stock (bounded taker) // R101 — סטיית רגל-HIVE מהסולם
  rewards: { saosPerFill: 2, member: "money-mover" }, // R103 — עבודה→מטבע→נזילות
  liquidityStream: { waveSteem: 200, share: 0.2 }, // R103 — גל-פאוורדאון → 20% עומק בריכות
  truthSource: "api.steemit.com · get_open_orders/get_accounts (via /api/money) + api.hive.blog (via /api/money/hive)",
};

type Decision = { at: string; kind: string; detail: string };

type MoneyState = {
  learning?: { backoffMin: number; epistemic: string; suspended: boolean; streak?: number; updatedAt: string | null } | null; // r205 — המדיניות-הנלמדה (תצוגה; מקור-האמת ב-sovereign/learning/state.json)
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  checkIntervalSec: number;
  policy: typeof POLICY;
  lastActionAt: string | null;
  actionsToday: number;
  actionDay: string;
  acting: boolean;
  lastDecision: Decision | null;
  fillsSeen?: number; // R103 — סימן-מים לתגמול מילויים חדשים
  fillDeployPending?: boolean; // r146-d — מילוי חדש נמדד מאז-הפעולה האחרונה → צינון-מקוצר להצבה הבאה
  lastActionOk?: boolean; // r147-a — הצינון-המקוצר (5 דק') חל רק אחרי הצלחה; אחרי דחייה — הצינון המלא (הלקח: 7 דחיות NO-FUEL בקצב 5-6 דק')
  lastDepositScanAt?: string | null; // R105 — סריקת הפקדות אחרונה (כל 5 דק')
  lastPoolGuardAt?: string | null;
  lastFleetSweepAt?: string | null; // R108 — סריקת גלגול-צי (כל 5 דק') // R108 — איזון-בריכות אחרון (כל 10 דק')
  lastStreamDay?: string; // R103 — הזרמת-נזילות אחת לכל היום ביותר
  lastTotalSteem?: number; // R111 — חתימת הון-כולל לטריגר הגל (נזיל+פרוס)
  noKeySince?: string | null; // r133 · D-021: המעבר חסום בכנות — אין מפתח-אב בסנדבוקס; backoff 4ש' + ביטול מיידי כשמפתח חוזר
  fleetSeen?: { keeperRestartAt?: string; pulseDay?: string; studentDay?: string }; // R108 — סימני-מים לגוב-הצי
  autonomyMode?: string; // r197 — מצב-שער-האוטונומיה הגלובלי (PAUSED/THINKING/ACTIVE) — נמדד בכל פעימה
  autonomyHeldCount?: number; // r197 — כמה פעולות נעצרו על-ידי שער-העצירה (כנות)
  canonLast: { at: string; ok: boolean; path: string } | null;
  history?: Array<Record<string, unknown>>;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

const sha256s = (s: string): string => createHash("sha256").update(s).digest("hex");

// §IX R208R (trace 1a10dda614a62251) — חישוב-האש-המשולב מחדש על בייטס-הדיסק
// הנוכחיים (אותו-נוסחה כמו objectiveSnapshotHash). null ⇒ קריאה-נכשלה (כנות).
const MODEL_FILES_AUDIT = ["objectives.json", "options.json", "capabilities.json", "authority-map.json"] as const;
function loadModelHashesForAudit(): string | null {
  try {
    const parts = MODEL_FILES_AUDIT.map((f) => sha256s(fs.readFileSync(`${HOME}/sovereign/objectives/${f}`, "utf8")));
    return sha256s(parts.join("|"));
  } catch { return null; }
}

function readState(): MoneyState {
  const base: MoneyState = {
    service: "money-mover",
    version: "1.13.0", // r208 — צריכת-מטרות חוזית בגבול-הגל (ממשק-צר + תחזית-טרום-פעולה) · המודל משפיע-עדפה, לא סמכות
    bootedAt: new Date().toISOString(),
    beats: 0,
    checkIntervalSec: CHECK_INTERVAL_SEC,
    policy: POLICY,
    lastActionAt: null,
    actionsToday: 0,
    actionDay: utcDay(),
    acting: false,
    lastDecision: null,
    canonLast: null,
  };
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    // המשכיות אמיתית: מונים, תקציבים וצינון שורדים restart/hot-reload (לקח R84)
    return {
      ...base,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      lastActionAt: prev.lastActionAt ?? null,
      actionsToday: prev.actionDay === utcDay() ? (prev.actionsToday ?? 0) : 0,
      actionDay: prev.actionDay === utcDay() ? prev.actionDay : utcDay(),
      acting: false, // אתחול: תהליך חדש — אין פעולה בטיסה. אם פעולה קודמת נתקעה mid-flight, היא הסתיימה עם מות התהליך.
      lastDecision: prev.lastDecision ?? null,
      canonLast: prev.canonLast ?? null,
      // R108 — שידור-סימני-מים ברילוד: ללא השורות האלה, כל טעינה-חמה של מודול מאפסרת את המאידות של תשלום — והתקרות שערו את הנזק (נתפס חי: שומר שולם 3×2 ברילודים; פרצו-גבול עצרו בדיוק). מתעתה: מי שוחור לצין מי שולח — גם אחרי restart.
      fillsSeen: prev.fillsSeen ?? 0,
      fillDeployPending: prev.fillDeployPending ?? false,
      lastActionOk: prev.lastActionOk ?? true,
      lastDepositScanAt: prev.lastDepositScanAt ?? null,
      lastStreamDay: prev.lastStreamDay ?? null,
      lastTotalSteem: prev.lastTotalSteem ?? null,
      fleetSeen: prev.fleetSeen ?? {},
      lastPoolGuardAt: prev.lastPoolGuardAt ?? null,
      lastFleetSweepAt: prev.lastFleetSweepAt ?? null,
      autonomyMode: prev.autonomyMode ?? null,
      autonomyHeldCount: prev.autonomyHeldCount ?? 0,
      learning: prev.learning ?? null,
    };
  } catch (e: any) {
    // כנות (R123): state קיים אך בלתי-קריא אינו נבלע בשקט — האיתחול נרשם
    // כהחלטה גלויה. קובץ שאינו קיים = עלייה ראשונה כנה. (הלקח נולד חי
    // ב-R112: איתחול מקובץ-קונפליקט איפס את המצב בשקט.)
    if (fs.existsSync(STATE_FILE)) {
      return {
        ...base,
        lastDecision: {
          at: new Date().toISOString(),
          kind: "STATE-RESET",
          detail: `קובץ-המצב קיים אך לא נקרא (${String(e?.message ?? e).slice(0, 80)}) — אותחל מצב חדש בכנות; אין prevTotal = אין גל-שקר, ותקרות השרת שומרות על הכסף`,
        },
      };
    }
    return base;
  }
}

// R124 — ציר-עולם למצב הדיבון (דפוס weblift): bun --hot מעריך את המודול מחדש
// בכל עריכה; קריאה-מחדש מהדיסק בכל דור גרמה ל-last-writer-wins בין דורות
// — דור שנטען מקובץ קפוא שכתב את lastActionAt של הדור החי והפר את הצינון
// (נמדד חי: שתי פעולות REPRICE במרווח 44 שניות מול מדיניות 30 דק').
// החוק: אובייקט-מצב אחד לכל חיי התהליך; דור חם יורש את האובייקט החי
// מציר-העולם, ורק עלייה קרה (תהליך חדש) קוראת מהדיסק.
const G_MONEY = globalThis as unknown as { __MONEY_STATE__?: MoneyState };
let state: MoneyState = G_MONEY.__MONEY_STATE__ ?? readState();
G_MONEY.__MONEY_STATE__ = state;
// r146-d — מדיניות-החוק החיה תמיד בספר: הציר-העולם שומר אובייקט-מצב חוצה-דורות;
// בלי השורה הזו state.policy היה נתקע על ה-POLICY של העלייה-הקרה הראשונה
// (נמדד: fillDeploy חסר מה-GET בריאות אחרי hot-reload — החוק פעל, התיעוד ישן).
state.policy = POLICY;

// R208P · intent-first — יישוב-עלייה: כל כוונה-פתוחה שנותרה מהדור-הקודם
// נסגרת כ-UNRESOLVED-AT-BOOT (תוצאת-חוץ = UNKNOWN — לעולם לא מומצאת)
// ומושתק ירי-חוזר של אותה (action,target) עד שקט-עולם (30 דק').
{
  const rec = bootReconcileIntents();
  if (rec.closed > 0) {
    state.lastDecision = {
      at: new Date().toISOString(),
      kind: "INTENT-RECONCILED",
      detail: `כוונות-פתוחות מהדור-הקודם: ${rec.closed} (${rec.suppressed.join(", ")}) — נסגרו UNKNOWN-כנה · ירי-חוזר מושתק 30 דק' (intent-first R208P)`,
    };
    saveState();
  }
  if (!verifyIntentsBook()) {
    console.error("[intents] שרשרת-ספר-הכוונות שבורה — דרוש ניפוי; הפעולות נמשכות אך ההפרה נרשמת");
  }
}

function saveState() {
  fs.mkdirSync(`${HOME}/sovereign/money`, { recursive: true });
  // R107b — חוק הכתיבה-האטומית (כמו בשומר): .tmp ואז rename — רגע-מוות
  // באמצע כתיבה לא משאיר ליורש קובץ-מצב חצוי (הלקח נלמד חי בכסף עצמו).
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

// r145-a — חלון-ספר-הקבלות מאוחד עם העורק (/api/money appendReceipt כותב 200):
// היה 60 — הדיבון קיצץ בשקט את קבלות-העורק עם ה-txids (ראיה!) כל שהצי שילם
// FLEET-PAY. ספר-ראיה שמוחק את הראיה שלו — לא ספר. 200 = יום-פעילות מלא.
function appendHistory(entry: Record<string, unknown>, cap = 200) {
  try {
    let h: Array<Record<string, unknown>> = [];
    try {
      h = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
      if (!Array.isArray(h)) h = [];
    } catch {}
    h.push({ at: new Date().toISOString(), ...entry });
    // R107b — אטומי גם כאן: היסטוריית-הקבלות היא ראיה; כתיבה חצויה לא
    // תאפס אותה בשקט בקריאה הבאה.
    const tmp = `${HISTORY_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(h.slice(-cap), null, 2));
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (e) {
    // R123 — כנות: כישלון כתיבת-דיסק נרשם ביומן, לא נבלע בשקט (כמו ב-weblift)
    console.error(`[money-mover] appendHistory נכשל — קבלה לא נשמרה לדיסק: ${String((e as Error)?.message ?? e)}`);
  }
}

// r197 — שער-האוטונומיה לפעולת-כסף: דיון נכתב לפני, ההכרעה נמדדת, סירוב נרשם בכנות — ואז הפעולה לא רצה.
// r205 — הדיון חוזר כרף-תחזית (seq+hash+expected) כדי שהלומד יוכל לקשר
// תחזית→תוצאה ברשומת-ניסיון משורשרת (provenance מלא).
// r206 — הדיון גם **נוסע** לשער (thought) — נמדד חי: בלי זה השער במצב THINKING
// סירב 14/14 פעולות עם ייחוס-שקר "usd מת" — המחשבה לא הגיעה לשופט.
interface ThoughtBody { claim: string; why: string; expected: string; risk: string; rollback: string; falsifier?: string }
function gateFleetAction(action: string, d: ThoughtBody): { allowed: boolean; why: string; deliberation?: DeliberationRef; thought?: ThoughtBody } {
  let delib: DeliberationRef | null = null;
  try {
    const rec = appendDeliberation({ action, actor: "money-mover", ...d });
    if (rec?.seq && rec?.entryHash) delib = { seq: rec.seq, entryHash: rec.entryHash, expected: rec.expected, ...(rec.falsifier ? { falsifier: rec.falsifier } : {}) };
  } catch { /* רישום-דיון לא מפיל את הפעימה */ }
  const v = autonomyVerdict(action, "money-mover");
  return { allowed: v.allowed, why: v.why, deliberation: delib ?? undefined, thought: d };
}

// r205 — ליבת-הלולאה: תוצאה → רשומת-ניסיון משורשרת → חוק-ההתאמה → מצב-נלמד.
// לעולם לא זורק — הלמידה לא מפילה את הפעולה (fail-closed לבסיס-החוק).
function learnFromOutcome(k: { at: string; kind: string; ok: boolean; error: string | null; code?: string | null; deliberation?: DeliberationRef }): void {
  try {
    const exp = appendExperience({
      actor: LEARN_ACTOR,
      action: LEARN_ACTION,
      outcomeAt: k.at,
      kind: k.kind,
      ok: k.ok,
      error: k.error,
      code: k.code ?? null,
      deliberation: k.deliberation ?? null,
      source: "act-receipt",
      ref: `act-receipt:${k.at}`,
    });
    if (exp) {
      const gate = readGate();
      runAdaptation(LEARN_ACTOR, LEARN_ACTION, gate.mode);
      const lb = readLearnedBackoff();
      state.learning = { backoffMin: lb.backoffMin, epistemic: lb.epistemic, suspended: lb.suspended, streak: lb.evidence?.streak ?? undefined, updatedAt: lb.updatedAt };
    }
  } catch { /* הלמידה כולה אינה רשאית להפיל את הפעימה */ }
}

/** קריאת-הצינון-האפקטיבי: בסיס-החוק + ההתאמה-הנלמדת (עם-ראיות) */
function effectiveCooldown(): { base: number; learned: number; total: number; evidence: string } {
  try {
    const lb = readLearnedBackoff();
    const learned = lb.suspended || !lb.chainOk ? 0 : lb.backoffMin;
    const ev = learned > 0 && lb.evidence
      ? `ראיות: ${lb.evidence.streak} כישלונות רצופים זהים (exp#${lb.evidence.experienceSeqs[0]}–#${lb.evidence.experienceSeqs[lb.evidence.experienceSeqs.length - 1]})`
      : lb.suspended ? "הלמידה מושעית (שרשרת-זיכרון לא-מאומתת) — בסיס-חוק"
      : "";
    return { base: POLICY.cooldownMin, learned, total: POLICY.cooldownMin + learned, evidence: ev };
  } catch {
    return { base: POLICY.cooldownMin, learned: 0, total: POLICY.cooldownMin, evidence: "" };
  }
}

// r205 — זריעת-הניסיון ההיסטורי (סעיף VIII בהנחיה: הכישלונות שכבר נצפו
// הם חומר-המבחן — לא דמו מלאכותי). אידמפוטנטי לגמרי (ref = זמן-התוצאה).
// קישור-תחזית כנה: דיון-חי ≤5 דק' לפני-התוצאה; מחוץ-לספר = null (כנות).
function seedHistoryExperiences(): void {
  try {
    const h: Array<Record<string, unknown>> = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    if (!Array.isArray(h)) return;
    const delibs = readDeliberations(200);
    const isGridAct = (k: string) => /^(REPRICE|ARM-BUY|STOCK-SBD|ARENA-STREAM|HIVE-REPRICE|GATE-QUEUED|FILL-DEPLOY|BID-ONLY)/.test(k);
    let seeded = 0;
    for (const e of h) {
      const kind = String(e.kind ?? "");
      if (!isGridAct(kind)) continue;
      const at = String(e.at ?? "");
      if (!at || Number.isNaN(Date.parse(at))) continue;
      const isFail = kind.endsWith("-FAIL");
      const t = Date.parse(at);
      const delib = delibs
        .filter((x) => x.action === "grid-act" && x.actor === "money-mover" && Date.parse(x.at) <= t && t - Date.parse(x.at) <= 5 * 60_000)
        .pop();
      const rec = appendExperience({
        actor: LEARN_ACTOR,
        action: LEARN_ACTION,
        outcomeAt: at,
        kind,
        ok: !isFail && kind !== "GATE-QUEUED",
        error: isFail ? String(e.error ?? kind) : null,
        // r206 — ייחוס-אמת: קוד-הסירוב זורע מההיסטוריה (שדה-חדש) — הלומד רואה את הסיבה
        code: kind === "GATE-QUEUED" ? "GATE-QUEUED" : (typeof e.code === "string" && e.code ? e.code : null),
        deliberation: delib && delib.seq && delib.entryHash ? { seq: delib.seq, entryHash: delib.entryHash, expected: delib.expected } : null,
        source: "history-seed",
        ref: `history-seed:${at}`,
      });
      if (rec) seeded += 1;
    }
    if (seeded > 0) {
      const gate = readGate();
      runAdaptation(LEARN_ACTOR, LEARN_ACTION, gate.mode);
      console.log(`[money-mover] r205: זריעת-ניסיון ${seeded} רשומות → התאמה חושבה`);
    }
    const lb = readLearnedBackoff();
    state.learning = { backoffMin: lb.backoffMin, epistemic: lb.epistemic, suspended: lb.suspended, streak: lb.evidence?.streak ?? undefined, updatedAt: lb.updatedAt };
    saveState();
  } catch { /* זריעה לא מפילה עלייה */ }
}

// ── שער-סודות לקנון: שום מפתח לא עובר ─────────────────────────────
function secretsGate(text: string): { ok: boolean; reason?: string } {
  if (/[5JKLMNPQRSTUVWXYZ123456789]{50,52}/.test(text)) {
    return { ok: false, reason: "base58-wif-shape" };
  }
  if (/gh[pousr]_[A-Za-z0-9]{20,}/.test(text)) {
    return { ok: false, reason: "github-token-shape" };
  }
  if (/(pat|token|wif|password)\s*[:=]\s*\S{16,}/i.test(text)) {
    return { ok: false, reason: "secret-assignment-shape" };
  }
  return { ok: true };
}

function readPat(): string | null {
  try {
    const t = fs.readFileSync(`${HOME}/upload/pat.env`, "utf8").trim();
    return t.length > 20 ? t : null;
  } catch {
    return null;
  }
}

// R112 — law of the bounded wait (caught live 06:14): canonPush fetches
// were the ONLY un-timeouted network calls in the daemon. A hung GitHub
// connection (no RST, no FIN) froze the whole tick: `ticking` stayed true
// forever, every later beat no-op'd at the guard, and the daemon died
// silently at beats=813 while its HTTP server kept answering. The keeper
// saw ZOMBIE but its daily restart budget was already burned (12/12 by
// 03:26) — so nothing revived it. Two laws born from this:
//   (1) every fetch in every daemon carries a deadline (this fix);
//   (2) a wedged tick costs one cycle, not the daemon (watchdog below).
async function canonPush(path: string, content: string): Promise<boolean> {
  const gate = secretsGate(content);
  if (!gate.ok) {
    state.canonLast = { at: new Date().toISOString(), ok: false, path: `${path} (BLOCKED: ${gate.reason})` };
    return false;
  }
  const pat = readPat();
  if (!pat) {
    // כנות: כישלון נרשם — לא משאירים canonLast ישן {ok:true} מהצלחה קודמת
    state.canonLast = { at: new Date().toISOString(), ok: false, path: `${path} (NO-PAT)` };
    return false;
  }
  const url = `https://api.github.com/repos/roshpinacare-sys/Defi/contents/${path}`;
  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "money-mover-daemon",
  };
  try {
    let sha: string | undefined;
    const cur = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (cur.ok) {
      const j = await cur.json();
      sha = j.sha;
    }
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `money-mover: reprice receipt ${new Date().toISOString()}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const ok = res.ok;
    state.canonLast = { at: new Date().toISOString(), ok, path };
    return ok;
  } catch {
    state.canonLast = { at: new Date().toISOString(), ok: false, path };
    return false;
  }
}

// ── החלטה ───────────────────────────────────────────────────────────
async function decide(meas: any): Promise<{ act: boolean; reason: string; action?: "reprice" | "arm-buy" | "stock-sbd" | "arena-stream"; tag?: "fill-deploy" }> {
  const now = new Date();
  // r146-d — תג-מילוי: מילוי נמדד מאז-הפעולה האחרונה → הפעולה הבאה נולדה מעבודה
  // אמיתית ונושאת FILL-DEPLOY בספר-הקבלות (וצינון-מקוצר — ראה POLICY.fillDeploy).
  const fillTag: "fill-deploy" | undefined = state.fillDeployPending ? "fill-deploy" : undefined;
  // day roll
  if (state.actionDay !== utcDay(now)) {
    state.actionDay = utcDay(now);
    state.actionsToday = 0;
  }
  // r133 · D-021 תיאום-מעברים: אין מפתח-אב בסנדבוקס ← המעבר הזה חסום בכנות.
  // backoff 4ש' בלי שריפת תקציב-פעולות ובלי זיהום-ספר בכישלונות זהים; כשמפתח חוזר
  // (מדידת keyPresent במדידה החיה) החסימה מתבטלת מיד והמעבר חוזר לעבוד.
  const KEY_BACKOFF_MIN = 240;
  if (state.noKeySince) {
    const keyBack = meas?.keyPresent === true
      ? 0
      : (now.getTime() - new Date(state.noKeySince).getTime()) / 60_000;
    if (meas?.keyPresent === true) {
      state.noKeySince = null; // המפתח חזר — המעבר מתעורר מיד (תיאום D-021)
      appendHistory({ kind: "LANE-UNBLOCKED", reason: "מפתח-אב נמדד בסנדבוקס — המעבר חוזר לזרימה", parity: null, placed: 0, cancelled: 0, error: null });
    } else if (keyBack < KEY_BACKOFF_MIN) {
      const remainMin = Math.max(1, Math.ceil(KEY_BACKOFF_MIN - keyBack));
      return { act: false, reason: `LANE-BLOCKED · אין מפתח-אב (D-021: המעבר-החי מוסיף לעבוד) · בדיקה-חוזרת בעוד ${remainMin} דק'` };
    }
  }
  // צינון — r146-d: מילוי-מאומת מאז-הפעולה האחרונה מקצר את הצינון ל-5 דק'
  // (הספר ריק/חסר בדיוק כשהביקוש הוכיח את עצמו; תקציב 12/יום נשאר החוסם-העליון)
  // r147-a — תיקון-לולאה נמדדת: הצינון-המקוצר חל רק אחרי פעולה שהצליחה.
  // המדידה: 7 דחיות NO-FUEL רצופות בקצב 5-6 דק' (fillDeployPending נשאר חמוש
  // תמידי אחרי מילוי, והדחיות הקציבו את הלולאה) — אחרי דחייה הצינון המלא חוזר.
  if (state.lastActionAt) {
    const sinceMin = (now.getTime() - new Date(state.lastActionAt).getTime()) / 60_000;
    const shortCool = state.fillDeployPending && state.lastActionOk !== false;
    // r205 — צינון-אפקטיבי: בסיס-החוק + התאמה-נלמדת (רק על נתיב-הניסיון-החוזר;
    // צינון-המילוי המקוצר נותר-שלם — הוא מופעל על-ידי ביקוש-חי, לא על-ידי הניסיונות שלנו)
    const lc = shortCool ? { base: POLICY.fillDeploy.cooldownMin, learned: 0, total: POLICY.fillDeploy.cooldownMin, evidence: "" } : effectiveCooldown();
    const cooldownNow = lc.total;
    if (sinceMin < cooldownNow) {
      return { act: false, reason: `WAIT-COOLDOWN · עוד ${Math.ceil(cooldownNow - sinceMin)} דק'${shortCool ? " · FILL-DEPLOY חמוש (מילוי נמדד)" : ""}${lc.learned > 0 ? ` · צינון-נלמד +${lc.learned}' (${lc.evidence})` : ""}` };
    }
  }
  // תקציב
  if (state.actionsToday >= POLICY.actionsBudgetPerDay) {
    return { act: false, reason: "WAIT-BUDGET · 12/12 פעולות היום — התקציב נאכל" };
  }
  // R103 — LIQUIDITY-STREAM: גל-דלק (חתימת פאוורדאון: נזיל ≥ 200 STEEM
  // בבת אחת) ← 20% ממנו הופך לעומק בבריכות הזירה לפני שהסולם פורש
  // את השאר. הזרמה אחת ליום בלבד — חוק התקציב.
  // R111 - law of the total-capital signature: liquid>=200 alone is NOT a
  // wave. Measured live 04:15: standing ladder capital re-appeared liquid
  // after order churn and masqueraded as a powerdown wave -> false wrap of
  // 95.327 WSTEEM from ladder capital. A true wave is a rise in the TOTAL
  // capital (liquid + deployed in orders) above the previous beat's total.
  // Cancels and re-deploys never change the total and cannot fire it.
  const idleNow = Number(meas?.idleSteem ?? 0);
  const totalSteemNow = Math.round((idleNow + Number(meas?.deployedSteem ?? 0)) * 1000) / 1000;
  const measCredible =
    !!meas && typeof meas === "object" && typeof meas?.idleSteem === "number" && totalSteemNow > 0;
  const prevTotal = state.lastTotalSteem ?? null;
  if (measCredible) state.lastTotalSteem = totalSteemNow; // wave = rise vs previous picture
  const today = utcDay();
  const waveDelta = prevTotal != null ? Math.round((totalSteemNow - prevTotal) * 1000) / 1000 : 0;
  if (
    measCredible &&
    waveDelta >= POLICY.liquidityStream.waveSteem &&
    idleNow >= POLICY.liquidityStream.waveSteem &&
    state.lastStreamDay !== today
  ) {
    // r208 — צריכת-מטרות חוזית (trace 1a10d7a051e822d1): המודל נטען ונאומת
    // (סכמה/היוחסות/זקנה/אסמכתאות-חתומות/מפריך/משאב-דרוש) דרך ממשק-צר בלבד.
    // סדר-ההכרעה בגבול: סמכות (§V) → העדפה (I3, r207) → מודל (WAIT-MODEL) →
    // ברירת-מחדל-בטוחה על מודל-פגום (§XIII/XVII) → חוק-הבסיס (r103).
    // תחזית-טרום-פעולה (§VII) נכתבת לספר ומרוסקת-לדיסק לפני-ההכרעה, ונסגרת
    // מולה — סתירה בין חוזה-התחזית להכרעה נרשמת כ-PREDICTION-DIVERGENCE.
    // המודל לעולם לא מעניק סמכות — רק מדכא/מתייג; כשל-חוזה = חוק-הבסיס.
    try {
      const prefEntry = activeDown("grid-pool-seed");
      const prefDown = prefEntry
        ? {
            seq: prefEntry.seq,
            expiresAt: String(prefEntry.expiresAt ?? ""),
            evidenceBooks: (prefEntry.evidence ?? []).map((e) => e.book.split("/").pop() ?? e.book),
            confidence: String(prefEntry.confidence ?? "medium"),
          }
        : null;
      const sbdRaw = (meas as any)?.sbdArming?.balance;
      // כנות-חיישן (§XV): מדידה-חסרה היא null — לא אפס. ההכרעה דורשת מדידה
      // ⇒ UNKNOWN ⇒ דחייה וברירת-מחדל-בטוחה. אין הופכים חוסר-מידה ל-0.000.
      const sbdNow = typeof sbdRaw === "number" && Number.isFinite(sbdRaw)
        ? { value: sbdRaw, at: String((meas as any)?.at ?? (meas as any)?.measuredAt ?? new Date().toISOString()), unit: "SBD" }
        : null;
      const { view, reject, detail } = objectiveDecisionView("grid-pool-seed", {
        measuredSbd: sbdNow,
        prefEvidence: prefEntry?.evidence ?? [],
        requireResource: true, // §IV: ההכרעה דורשת מדידת-SBD — UNKNOWN ⇒ דחייה
      });
      const waveFires = true; // הגענו לגבול — הסף נבדק למעלה
      const expectedDecision = predictWaveDecision({
        waveFires,
        prefDown: !!prefDown,
        view,
        viewRejectReason: reject,
        authorityForbidden: view?.authorityStatus?.forbidden === true,
      });
      const prediction = appendPrediction({
        kind: "PREDICTION",
        predictionId: `PRED-R208-${Date.now()}`,
        boundary: "money-mover/decide#liquidity-wave",
        objectiveId: view?.objectiveId ?? "UNAVAILABLE",
        objectiveSnapshotHash: view ? sha256s(Object.values(view.modelHashes).join("|")) : undefined,
        resourceSnapshotHash: sha256s(JSON.stringify({ idleNow, totalSteemNow, waveDelta, sbdNow })),
        decisionInputHash: sha256s(JSON.stringify({ waveFires, prefDown: !!prefDown, reject, seedVerdict: view?.priority?.verdictForSeed ?? null, authorityForbidden: view?.authorityStatus?.forbidden ?? null })),
        expectedDecision,
        expectedReason: view ? `${view.priority.rank} → ${view.priority.verdictForSeed}` : `reject=${reject}:${String(detail).slice(0, 120)}`,
        expectedOutcome: view?.falsifier?.delta ?? "שורת-החלטה אחת עם תוצאה-מפורשת",
        falsifier: "PREDICTION-DIVERGENCE: ההכרעה בפועל ≠ expectedDecision · receipt.ok=false ⇒ תחזית-התוצאה מופרכת",
        confidence: "medium",
      });
      const wd = waveDecision({
        now: new Date().toISOString(),
        today,
        measCredible,
        waveDelta,
        idleNow,
        totalSteemNow,
        lastStreamDay: state.lastStreamDay ?? null,
        waveSteem: POLICY.liquidityStream.waveSteem,
        share: POLICY.liquidityStream.share,
        prefDown,
        view,
        viewRejectReason: reject,
        fillTag,
      });
      if (prediction.ok) {
        const closed = closePrediction(prediction.entry.predictionId, {
          actualDecision: wd.kind,
          divergence: wd.kind === prediction.entry.expectedDecision ? undefined : `expected=${prediction.entry.expectedDecision} · actual=${wd.kind}`,
        });
        if (closed.ok && closed.entry.match === false) {
          appendHistory({ kind: "PREDICTION-DIVERGENCE", reason: `expected ${prediction.entry.expectedDecision} · actual ${wd.kind}`, parity: null, placed: 0, cancelled: 0, error: null });
        }
      } else {
        // r208-A — כשל-כתיבת-תחזית אינו שקט: ארטיפקט-גלוי בהיסטוריה (ביקורת-מפריך A)
        appendHistory({ kind: "PREDICTION-WRITE-FAIL", reason: `appendPrediction נדחה: ${String((prediction as { why?: string }).why ?? "?").slice(0, 140)}`, parity: null, placed: 0, cancelled: 0, error: String((prediction as { why?: string }).why ?? "?").slice(0, 140) });
      }
      if (wd.kind === "WAIT-PREFERENCE" || wd.kind === "WAIT-MODEL" || wd.kind === "WAIT-SAFETY" || wd.kind === "BLOCKED_BY_AUTHORITY") {
        return { act: false, reason: wd.reason };
      }
      if (wd.kind === "ACT") {
        // §IX R208R — הוכחת-בייטס-נצרכים (trace 1a10dda614a62251): קבלת-ההכרעה
        // מזהה את בייטס-המודל שגרמו לה (objectiveSnapshotHash). אם הבייטס
        // בדיסק השתנו בין-הטעינה-להכרעה (TOCTOU) — ארטיפקט-גלוי, והקבלה
        // ממשיכה להעיד על הבייטס-המקוריים (ההכרעה נשארת קשורה למה שנצרך).
        try {
          const rehash = loadModelHashesForAudit();
          if (rehash && view && rehash !== sha256s(Object.values(view.modelHashes).join("|"))) {
            appendHistory({ kind: "MODEL-CHANGED-MIDCYCLE", reason: `בייטס-המודל השתנו בין-צריכה-להכרעה — הקבלה מעידה על הבייטס-הנצרכים (§IX)`, parity: null, placed: 0, cancelled: 0, error: null });
          }
        } catch { /* ביקורת-האש אינה רשאית להפיל את ההכרעה */ }
        return { act: true, action: wd.action, reason: wd.reason, tag: wd.tag };
      }
      // NO-WAVE כאן לא אמור לקרות (הסף נבדק למעלה) — נופל לחוק-הבסיס בכנות.
    } catch (err) {
      // r208-A — כשל-חוזה לא שקט: ארטיפקט-גלוי ואז חוק-הבסיס (r103).
      // fail-open לכיוון-הבסיס בלבד — אין סמכות-חדשה, אין דיכוי-מאויל.
      try {
        appendHistory({ kind: "PRED-CONTRACT-FAIL", reason: `חוזה-המטרות נפל — חוזרים לחוק-הבסיס: ${String((err as Error)?.message ?? err).slice(0, 140)}`, parity: null, placed: 0, cancelled: 0, error: String((err as Error)?.message ?? err).slice(0, 140) });
      } catch { /* ההיסטוריה לא מפילה את הפעימה */ }
    }
    return {
      act: true,
      action: "arena-stream",
      reason: `גל דלק אמיתי: ההון-הכולל עלה ${waveDelta.toFixed(3)} STEEM מעל המדידה הקודמת (${totalSteemNow.toFixed(3)} סך · נזיל ${idleNow.toFixed(0)}) — ${Math.round(POLICY.liquidityStream.share * 100)}% הופכים לעומק בבריכות הזירה לפני פריסת הסולם`,
    };
  }
  // R101b - STOCK-SBD (before the idle trigger - order is the deal):
  // if the arming inventory is short and idle fuel can close the gap,
  // close it at the ask first; only then spread the rest into the ladder.
  // R111 - pre-check law (born from a live starvation loop): the fire is
  // checked against the executable bid from the measurement itself BEFORE
  // burning action-budget and cooldown on it. True cost premium:
  // parity/bid - 1 (how many STEEM above fair one SBD costs when executing
  // into bids). Above the cap the decision honestly falls through (ladder
  // deploy, HIVE leg) instead of looping on a guaranteed refusal.
  const armStock = meas?.sbdArming;
  const parityStock = Number(meas?.marks?.parity);
  const bidPxStock = Number(meas?.book?.bids?.[0]?.price);
  const premiumBpsStock =
    Number.isFinite(parityStock) && parityStock > 0 && Number.isFinite(bidPxStock) && bidPxStock > 0
      ? Math.round((parityStock / bidPxStock - 1) * 10_000)
      : null;
  if (
    armStock?.state === "WAIT" &&
    Number.isFinite(parityStock) &&
    parityStock > 0 &&
    premiumBpsStock != null &&
    premiumBpsStock <= POLICY.stockSbd.premiumCapBps
  ) {
    const gapStock = Math.max(0, Number(armStock.needed ?? 0.15) - Number(armStock.commitable ?? 0));
    const steemNeedStock = (gapStock / parityStock) * 1.5 + POLICY.stockSbd.keepSteem;
    if (gapStock > 0.005 && Number(meas?.idleSteem ?? 0) >= steemNeedStock) {
      return {
        act: true,
        action: "stock-sbd",
        reason: `SBD arming gap ${Number(armStock.commitable).toFixed(3)}/${armStock.needed} - executable bid ${bidPxStock.toFixed(6)} within cap (premium ${premiumBpsStock}bps <= ${POLICY.stockSbd.premiumCapBps}) - closing at the bid (bounded stock)`,
      };
    }
  }
  // R127 — חוק צד-הקנייה (נולד מהרעבה שנמדדה חי): ARM-BUY היה אחרון
  // בעץ ההחלטה — אחרי טריגרי הנזיל והסטייה שתופסים קודם את התור
  // ואת הצינון שלאחריהם. תוצאה נמדדת 27/09: ourBids=[] במשך ימים
  // בזמן ש-16.3 SBD חמושים יושבים בטלים — דפוס ההרעבה של r111-B,
  // הפעם על צד הקנייה. התיקון: פריסת צד-הקנייה חדשה (סולם ריק)
  // קודמת לתחזוקת צד-המכירה. אידמפוטנטי: ברגע שהסולם הוצב
  // (ourBids>0) הענף שוקט לנצח והתחזוקה חוזרת להיות ראשונה.
  const bidsLive = (Array.isArray(meas?.ourBids) ? meas.ourBids : []).length;
  const arm127 = meas?.sbdArming;
  if (
    arm127?.state === "ARMED" &&
    Number(arm127?.commitable ?? 0) >= POLICY.armBuy.minSbd &&
    bidsLive === 0
  ) {
    return {
      act: true,
      action: "arm-buy",
      reason: `SBD חמוש ${Number(arm127.commitable).toFixed(3)} וסולם הקנייה ריק — נפרס לפני תחזוקת המכירה (חוק R127: אין רעבת-צד)`,
    };
  }
  // טריגר: נזיל
  const idle = Number(meas?.idleSteem ?? 0);
  if (idle >= POLICY.triggers.idleTriggerSteem) {
    return { act: true, tag: fillTag, reason: `נזיל ${idle.toFixed(3)} STEEM יושב מחוץ לסולם — נפרס לעבודה (חוק 2)${fillTag ? " · FILL-DEPLOY: מילוי אמיתי נמדד — הספר חוזר לקו במקום להמתין צינון" : ""}` };
  }
  // טריגר: סטיית פאריטה מהמדרגה שהוצבה בפועל (R93).
  // לקח-הבאג החי (נמדד 00:19Z): ה-ladder מה-API הוא הסולם *המומלץ* —
  // מחושב מהפאריטה עצמה, ולכן השוואת פאריטה מול ladder[1] היא השוואת
  // הפאריטה אל עצמה: drift=0 תמידי, והטריגר היה קוד-מת במשך 20 שעות
  // בזמן שהקו זז +240bps. האמת היא הפקודות הפתוחות על השרשרת
  // (get_open_orders): המדרגה התחתונה — הראשונה להיפגע — היא הבסיס.
  const parity = Number(meas?.marks?.parity);
  const placedPrices: number[] = (Array.isArray(meas?.orders) ? meas.orders : [])
    .map((o: { price?: number | string }) => Number(o?.price))
    .filter((p: number) => Number.isFinite(p) && p > 0);
  if (typeof parity === "number" && parity > 0 && placedPrices.length > 0) {
    const base = Math.min(...placedPrices); // המדרגה התחתונה — הראשונה למכירה
    const driftBps = Math.round(((parity - base) / base) * 10_000);
    if (Math.abs(driftBps) > POLICY.triggers.parityDriftBps) {
      return {
        act: true,
        tag: fillTag,
        reason: `הפאריטה זזה ${driftBps > 0 ? "+" : ""}${driftBps}bps מעל הסולם שהוצב (${base.toFixed(6)} → קו ${parity.toFixed(6)}) — הסולם נגרר אליה (חוק 3)${fillTag ? " · FILL-DEPLOY" : ""}`,
      };
    }
  }
  // r141 — חוק-הרצפה החי (L4): אף פקודת-מכירה לא יושבת מתחת לערך-החוץ.
  // הפער שנתפס חי: הטריגר הגס (±50bps) השאיר פקודות בין -50bps ל-0 יושבות
  // מתחת לקו בלי גרירה — ה-DRIFT ש-valueFloor מודד היה מתויג "ייגרר בהזדמנות
  // הבאה" אך אף הזדמנות כזו לא היתה נולדת (טריגר-מת בין -50 ל-0). מעתה:
  // פסק-דין רצפה מדויק מהפקודות הפתוחות (vsParityBps מה-API) — כל פקודה
  // מתחת לפאריטה מעבר לאפסילון 2bps (נגד רעש-עיגול) ← reprice. הצינון
  // (30 דק') והקצבה (12/יום) הם חוסמי-השחיקה; החשיפה נמדדת בכל פעימה.
  const worstBelowBps = (Array.isArray(meas?.orders) ? meas.orders : [])
    .map((o: { vsParityBps?: number | null }) => Number(o?.vsParityBps))
    .filter((b: number) => Number.isFinite(b))
    .reduce((min: number, b: number) => (b < min ? b : min), 0);
  if (worstBelowBps < -2) {
    return {
      act: true,
      tag: fillTag,
      reason: `חוק-הרצפה (L4): פקודת-מכירה ${worstBelowBps}bps מתחת לערך-החוץ — הסולם נגרר אל הקו (הצינון והקצבה חוסמי-שחיקה)${fillTag ? " · FILL-DEPLOY" : ""}`,
    };
  }
  // טריגר R97 — ARM-BUY: SBD חמוש → סולם קנייה מתחת לפאריטה (O1).
  // הגריד נעשה דו-צדדי: המכירות מעל הקו צדות ערך; הקניות מתחתיו
  // תופסות את הפער הפנימי המדוד (VALUE-TRAP ההפוך). החימוש נפתח
  // רק ממילוי אמיתי — לא ממכירה מתחת לערך.
  const arm = meas?.sbdArming;
  if (arm?.state === "ARMED" && Number(arm?.commitable ?? 0) >= POLICY.armBuy.minSbd) {
    return {
      act: true,
      action: "arm-buy",
      reason: `SBD חמוש ${Number(arm.commitable).toFixed(3)} — סולם קנייה מתחת לפאריטה (מיקרו-גריד דו-צדדי · O1)`,
    };
  }
  // שקט כנה
  return { act: false, reason: "הסולם על הקו — אין פעולה נדרשת" };
}

// ── רגל HIVE (R101): מדידה, החלטה, פעולה — אותם חוקים ────────────────

async function measureHive(): Promise<any | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${HIVE_API}`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.ok ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function decideHive(hive: any): Promise<{ act: boolean; reason: string }> {
  if (!hive || typeof hive !== "object") return { act: false, reason: "HIVE לא נמדדה — לא מתיירים על נתוני-רפא" };
  const drift = Number(hive?.maxDriftBps);
  const orders = Array.isArray(hive?.orders) ? hive.orders.length : 0;
  const hiveBal = Number(hive?.balances?.hive ?? 0);
  const hbdBal = Number(hive?.balances?.hbd ?? 0);
  // טריגר 1: דלק יושב מחוץ לסולם
  if (orders === 0 && (hiveBal >= 0.02 || hbdBal >= 0.001)) {
    return {
      act: true,
      reason: `רגל HIVE: דלק יושב מחוץ לסולם (${hiveBal.toFixed(3)} HIVE / ${hbdBal.toFixed(3)} HBD) — נפרס לעבודה`,
    };
  }
  // טריגר 2: סטיית הפקודות מהקו (אותו סף-50bps של STEEM)
  if (orders > 0 && Number.isFinite(drift) && Math.abs(drift) > POLICY.hive.driftBps) {
    return {
      act: true,
      reason: `רגל HIVE: הקו זז ${drift > 0 ? "+" : ""}${drift}bps מהסולם — הסולם נגרר אליו`,
    };
  }
  return { act: false, reason: `רגל HIVE על הקו (${orders} פקודות · drift ${Number.isFinite(drift) ? drift : "?"}bps) — אין פעולה` };
}

async function measure(): Promise<any | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${API}?fresh=1`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.ok ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function act(
  reason: string,
  action: "reprice" | "arm-buy" | "stock-sbd" | "arena-stream" = "reprice",
  target: "steem" | "hive" = "steem",
  tag?: "fill-deploy",
  deliberation?: DeliberationRef, // r205 — רף-התחזית שנכתבה לפני (לקישור-ניסיון)
  thought?: ThoughtBody, // r206 — הדיון המלא נוסע לשער (THINKING מחייב אותו ב-payload)
): Promise<boolean> {
  // R208P · intent-first — שער-ירי: אם כוונה קודמת של אותו (action,target)
  // נותרה בלתי-פתורה (מוות-בין-שידור-לתוצאה), הירי-החוזר אסור עד שקט-עולם.
  // ההכרעה: בטיחות-על-פני-פעילות (לא מייעלים-ל-A — מייעלים-לאמת).
  if (isSuppressed(action, target)) {
    state.lastDecision = {
      at: new Date().toISOString(),
      kind: "WAIT-INTENT-SUPPRESS",
      detail: `ירי-חוזר של ${action}/${target} מושתק — כוונה-קודמת נותרה בלתי-פתורה (תוצאת-חוץ UNKNOWN) · ממתין לשקט-עולם 30 דק' (intent-first R208P)`,
    };
    saveState();
    appendHistory({ kind: "WAIT-INTENT-SUPPRESS", reason, parity: null, placed: 0, cancelled: 0, error: "intent-open · ירי-חוזר אסור" });
    return false;
  }
  state.acting = true;
  actStartedAt = Date.now();
  // R93 — חוק הירי-היחיד חוצה-הפעלות: הצינון נספר מתחילת הפעולה, לא
  // מסופה. נולד מתקרית חיה (00:34:52Z): restart של הדיבון באמצע act()
  // איפס את הדגלים הזכרוניים (acting/ticking) — וההרצה החדשה לא ראתה
  // פעולה בטיסה כי lastActionAt עודכן רק בסוף. התוצאה: שני POSTs
  // back-to-back (00:34:29 + 00:34:54). מעתה: lastActionAt נכתב בהתחלה —
  // restart באמצע פעולה נתקל בצינון כנה במקום בירי כפול.
  state.lastActionAt = new Date().toISOString();
  state.lastDecision = { at: state.lastActionAt, kind: "ACTING", detail: reason };
  saveState();
  // R208P · write-ahead intent — הכוונה נרשמת לפני השידור-החוץ.
  // מות-תהליך מכאן-ואילך משאיר כוונה-פתוחה שהיורש מיישב כ-UNKNOWN.
  const intentId = appendIntent({ action, target, tag: tag ?? null, reason });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 180_000); // פעולת-כסף: חלון רחב (3 דק'), שידור Steem איטי
  let result: Record<string, unknown> = {};
  try {
    if (action === "arena-stream") {
      // R103 — ההזרמה הולכת לזירת-המסחר, לא למוח הכסף
      const res = await fetch(EXCHANGE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "liquidity-stream", share: POLICY.liquidityStream.share }),
        signal: ctl.signal,
      });
      result = (await res.json()) as Record<string, unknown>;
    } else {
    // r206 — הדיון נוסע עם הפעולה: השער (THINKING) דורש deliberation ב-payload —
    // נמדד חי: בלי זה 14/14 פעולות נסרבו NO-DELIBERATION ויוחסו בשקר "usd מת".
    const deliberationBody = thought
      ? { claim: thought.claim, why: thought.why, expected: thought.expected, risk: thought.risk, rollback: thought.rollback, ...(thought.falsifier ? { falsifier: thought.falsifier } : {}) }
      : undefined;
    const res = await fetch(target === "hive" ? HIVE_API : API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        reason,
        ...(tag && target === "steem" && action === "reprice" ? { tag } : {}),
        ...(deliberationBody ? { deliberation: deliberationBody } : {}),
      }),
      signal: ctl.signal,
    });
    result = (await res.json()) as Record<string, unknown>;
    }
  } catch (e: any) {
    result = { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
  state.actionsToday += 1;
  const finishedAt = new Date().toISOString();
  state.acting = false;
  // r147-a — אמת-תקציב (המשך D-021): פעולה שנדחתה לפני שידור לא הזיזה כסף —
  // היא לא שורפת תקציב. נמדד חי: 7 דחיות NO-FUEL שרפו 7/12 מהתקציב היומי על
  // סירובים. ההחזר כאן (כמו NO-KEY למטה); הצלחה שורפת כרגיל.
  const refusedPreBroadcast = !(result as any)?.ok && (result as any)?.code !== "GATE-QUEUED";
  if (refusedPreBroadcast) {
    state.actionsToday = Math.max(0, state.actionsToday - 1);
    state.lastActionOk = false; // צינון-מלא לניסיון הבא — אין לולאת-דחיות בקצב 5 דק'
  } else {
    state.lastActionOk = true;
  }
  // r146-d — תג-המילוי נצרך רק בהצלחה: פעולה שנכשלה (וגם NO-KEY) לא שינתה את
  // הספר — חלון-ה-FILL-DEPLOY נשאר חמוש והצינון-המקוצר יחול בניסיון הבא (כנות).
  const r = (result as any) ?? {};
  if (r?.ok) state.fillDeployPending = false;
  // R93 — תיקון קבלה: ה-API מחזיר {ok, receipt:{placed,cancelled,...}, verify}
  // ולא placed ברמה העליונה. הקבלה תעדוק את האמת מעכשיו (לקח R87 —
  // "הוצבו 0" שקרי — הפעם בצד הדיבון).
  // r133 · D-021 אמת-תקציב: NO-KEY אינו פעולה — שום דבר לא ניסה לזוז על-השרשרת.
  // מחזירים את מנת-התקציב ומציבים חסימת-מעבר (backoff 4ש', ביטול מיידי כשמפתח חוזר).
  if (!r.ok && r.code === "NO-KEY") {
    state.actionsToday = Math.max(0, state.actionsToday - 1);
    if (!state.noKeySince) state.noKeySince = finishedAt;
    const lastH = state.history?.[state.history.length - 1];
    state.lastDecision = {
      at: finishedAt,
      kind: "LANE-BLOCKED",
      detail: `אין מפתח-אב בסנדבוקס — המעבר חסום בכנות (D-021: המעבר-החי ממשיך). תקציב נשמר (${state.actionsToday}/${POLICY.actionsBudgetPerDay}).`,
    };
    saveState();
    if (lastH?.kind !== "LANE-BLOCKED") {
      appendHistory({ kind: "LANE-BLOCKED", reason, parity: null, placed: 0, cancelled: 0, error: "NO-KEY · backoff 4ש'", });
    }
    closeIntent(intentId, "LANE-BLOCKED", false); // R208P — הכוונה נסגרת: לא שודר כלל (אין מפתח)
    return (result as any) ?? {};
  }
  // כנות (תיקון ביקורת): יום-ההזרמה נרשם רק כשההזרמה באמת הצליחה —
  // כישלון שרף יום שלם בשקט והגל לא נורה שוב לעולם.
  if (action === "arena-stream" && r.ok) state.lastStreamDay = utcDay();
  // נרמול קבלה: STEEM מחזיר מערכים; HIVE (R101) מחזיר מונים — אחת לכל צורה
  const normList = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === "number" ? Array.from({ length: v }) : []);
  const placed: unknown[] = normList(r.placed).length
    ? normList(r.placed)
    : normList(r.receipt?.placed);
  const cancelled: unknown[] = normList(r.cancelled).length
    ? normList(r.cancelled)
    : normList(r.receipt?.cancelled);
  const parityAt = r.parity ?? r.receipt?.parity ?? null;
  // r191 · חוק-ייחוס-פקודות: פקודות-זרות שהמוביל ראה חיות בספר ודילג עליהן —
  // עולה להחלטה ולספרים בכנות (שקיפות-התיאום-בין-הסוכנים)
  const foreignSkippedCount = Number((r.receipt as any)?.foreignSkipped?.count ?? 0) || 0;
  const foreignSkippedNote = foreignSkippedCount > 0 ? ` · דולגו ${foreignSkippedCount} זרות (חוק-הייחוס r191)` : "";
  // R97: קבלה מבחינה סוג-פעולה; GATE-QUEUED היא הכרעה, לא כישלון —
  // הפעולה מעל סף האוטונומיה וממתינה למפעיל בשער-העסקאות.
  const actionKind = r.ok
    ? String(r.receipt?.kind ?? r.kind ?? (action === "arm-buy" ? "ARM-BUY" : action === "arena-stream" ? "ARENA-STREAM" : target === "hive" ? "HIVE-REPRICE" : "REPRICE"))
    : r.code === "GATE-QUEUED"
      ? "GATE-QUEUED"
      : action === "arm-buy"
        ? "ARM-BUY-FAIL"
        : action === "arena-stream"
          ? "ARENA-STREAM-FAIL"
          : target === "hive"
            ? "HIVE-REPRICE-FAIL"
            : "REPRICE-FAIL";
  state.lastDecision = {
    at: finishedAt,
    kind: actionKind,
    detail: r.ok
      ? `הוצבו ${placed.length} · בוטלו ${cancelled.length}${foreignSkippedNote} · ${reason}`
      : r.code === "GATE-QUEUED"
        ? `הפעולה (${typeof r.usdValue === "number" ? r.usdValue.toFixed(2) : "?"}$) ≥ סף $${r.threshold} — ממתינה לאישור המפעיל בשער העסקאות. שום כסף לא זז.`
        : `כישלון כנה: ${String(r.error ?? r.receipt?.error ?? "לא ידוע").slice(0, 120)}`,
  };
  saveState();
  closeIntent(intentId, actionKind, !!r.ok); // R208P — הכוונה נסגרת בתוצאה-אמיתית (intent-first: הפער פתוח-לעולם-מתועד)
  appendHistory({
    at: finishedAt, // r205-adv מ.2 — זהות-האירוע מאוחדת: ההיסטוריה ורשומת-הניסיון חולקות את אותו חותמת → אין-כפילות-ראיות בזריעה
    kind: state.lastDecision.kind,
    reason,
    parity: parityAt,
    placed: placed.length, // counts only - no fake arrays (R101c receipt-honesty fix)
    cancelled: cancelled.length,
    // r191 · חוק-ייחוס-פקודות: ספירת-פקודות-זרות שדולגו (כנות-תיאום בין-סוכנים)
    foreignSkipped: foreignSkippedCount,
    error: r.error ?? r.receipt?.error ?? null,
    // r206 — ייחוס-אמת: קוד-הסירוב האמיתי נשמר בהיסטוריה — הזריעה ההיסטורית
    // תפסיק לאבד-ייחוס (נמדד חי: code=null בכל 33 רשומות-הספר)
    code: (r.code as string | undefined) ?? null,
  });
  // r205 — סגירת-הלולאה: התוצאה הנמדדת הופכת ניסיון משורשר (תחזית→תוצאה),
  // הניסיון עשוי לשנות את מדיניות-הקצב העתידית בתוך גבולות-החוק,
  // וההחלטה-הבאה קוראת את המדיניות-הנלמדת. זה ההבדל בין logging ל-learning.
  learnFromOutcome({
    at: finishedAt,
    kind: state.lastDecision.kind,
    ok: !!r.ok,
    error: (r.error ?? r.receipt?.error ?? null) as string | null,
    code: (r.code ?? null) as string | null,
    deliberation,
  });
  // קבלה לקנון אחרי כל פעולה (שער-סודות בפנים)
  const receipt = [
    `# קבלת מוביל-הכסף · ${finishedAt}`,
    "",
    `- **סיבה**: ${reason}`,
    `- **תוצאה**: ${state.lastDecision.kind} · הוצבו ${placed.length} · בוטלו ${cancelled.length}`,
    `- **דילוג-זרות (חוק-הייחוס r191)**: ${foreignSkippedCount} — פקודות שלא ניתן לייחסן למוביל לא נגעו לעולם`,
    `- **פאריטה בזמן הפעולה**: ${parityAt ?? "לא נמדד"}`,
    `- **פעולות היום**: ${state.actionsToday}/${POLICY.actionsBudgetPerDay}`,
    `- **כנות**: ${r.error ?? r.receipt?.error ? `שגיאה: ${String(r.error ?? r.receipt?.error).slice(0, 200)}` : "אין"}`,
    "",
    `_מופק אוטונומית על-ידי money-mover v${state.version} (R101 · HIVE leg + stock-sbd + vault)._`,
  ].join("\n");
  // Z-30-c NOISE LAW (cross-agent mutual review 2026-10-02): the daily receipt
  // file is overwritten via the contents API — every call = one commit. FAIL
  // ticks were committing a receipt every ~6min (11/12 budget burned on
  // REPRICE-FAIL with zero placements), burying real commits in the shared
  // repo. Gate: commit when the tick MOVED something or ≥60min since the last
  // receipt commit; every decision still lands in history — honesty without spam.
  {
    const moved = placed.length > 0 || cancelled.length > 0;
    const lastAt = state.canonLast?.at ? Date.parse(state.canonLast.at) : 0;
    const due = moved || Date.now() - (isNaN(lastAt) ? 0 : lastAt) >= 60 * 60_000;
    if (due) await canonPush(`reports/money-${utcDay()}.md`, receipt);
  }
  return !!r.ok; // אמת-הפעולה עולה לקורא (גם ל-/act) — לא "הוזנק" בלבד
}

let ticking = false;
// r143-c — חותמת-הפעימה האחרונה — מזינה את מתג-איש-המת בסוף-הקובץ
let lastBeatAt = Date.now();
// R112 — tick watchdog (the live-freeze law): the interval itself watches
// the guard it lives behind. A tick stuck longer than TICK_MAX_MS is
// force-released with an honest history note — the hung await is orphaned
// (if it ever wakes it can still mutate state; every fetch is deadline-
// bounded, so the exposure window is time-bounded, not power-removed).
// Caught live: money froze at beats=813 for 20+ minutes while HTTP kept
// answering.
let tickStartedAt = 0;
let actStartedAt = 0;
const TICK_MAX_MS = 5 * 60_000;
const ACTING_MAX_MS = 10 * 60_000;
async function tick() {
  if (ticking || state.acting) return; // לולאה-יחידה (לקח R80)
  ticking = true;
  tickStartedAt = Date.now();
  try {
    state.beats += 1;
    lastBeatAt = Date.now(); // r143-c — הוכחת-החיים נמדדת כאן
    const meas = await measure();
    // שער שלמות-מדידה (R90): balances.steem === null → RPC נכשל → אין אמת, אין פעולה.
    // לעולם לא מפרשים "לא נמדד" כ"0 נזיל" — כסף לא זז על נתוני-רפא.
    if (!meas || meas?.balances?.steem == null) {
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "HONEST-FAIL",
        detail: "מדידה חיה נכשלה — לא מתיירים, לא פועלים על נתוני אתמול",
      };
      saveState();
      return;
    }
    // r197 — חוק-העצירה והחשיבה (הוראת-המפעיל trace 1a108e334b3129a9):
    // PAUSED → אף פעולה אוטונומית לא זזה: לא תגמולים, לא גוב-צי, לא גלגולים,
    // לא סולם. המדידה חיה והכנות חיות — הכסף קפוא עד שהשער נפתח.
    // THINKING → הפעולות רצות רק עם רשות-דיון מלאה שנכתבת קודם.
    const gate = readGate();
    state.autonomyMode = gate.mode;
    if (gate.mode === "PAUSED") {
      state.autonomyHeldCount = (state.autonomyHeldCount ?? 0) + 1;
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "AUTONOMY-PAUSED",
        detail: `שער-העצירה סגור (${state.autonomyHeldCount} פעימות עצורות) — הוראת המפעיל: לעצור ולבחון לפני שעושים · ${gate.reason.slice(0, 100)}`,
      };
      saveState();
      return;
    }
    // R103 — רייל התגמול: מילויים חדשים בחלון = עבודה אמיתית = SAOS לזירה.
    // הספירה היא סימן-מים עולה: ירידת החלון לא מתגמלת פעמיים.
    try {
      // R128 — חגורת-צורה: ה-API מחזיר fillsWindow24h כמספר; אם חסר (צורה ישנה/גרסת-רפא)
      // מחושב מהמערך עצמו. עד R128 הדאימון קרא fills.window24h שלא היה קיים בתשובה
      // ורייל R103 מעולם לא ירה (0 SAOS-REWARD בהיסטוריה כולה).
      let fillsNow = Number(meas?.fillsWindow24h ?? meas?.fills?.window24h);
      if (!Number.isFinite(fillsNow) && Array.isArray(meas?.fills)) {
        const dayAgo = Date.now() - 86_400_000;
        fillsNow = (meas.fills as Array<{ at?: string }>).filter(
          (f) => new Date(f?.at ?? 0).getTime() >= dayAgo,
        ).length;
      }
      if (Number.isFinite(fillsNow)) {
        const seen = state.fillsSeen ?? 0;
        if (fillsNow > seen) {
          const newFills = fillsNow - seen;
          state.fillsSeen = fillsNow;
          // r146-d — FILL-DEPLOY: מילוי אמיתי נמדד — ההצבה הבאה זכאית לצינון-מקוצר
          // (הספר לא נשאר ריק חצי-שעה אחרי שהביקוש הוכיח את עצמו)
          state.fillDeployPending = true;
          // r197 — דיון לפני תגמול: למה משלמים, כמה, מה הסיכון
          appendDeliberation({
            action: "reward-pay", actor: "money-mover",
            claim: `לשלם ${Math.max(1, newFills * POLICY.rewards.saosPerFill)} SAOS ל-${POLICY.rewards.member} על ${newFills} מילויי-גריד נמדדים`,
            why: "עבודה אמיתית נמדדה (סימן-מים עולה) — חוק עבודה→מטבע→נזילות R103",
            expected: "מאזן-הזירה של החבר עולה; האוצר יורד; הספר מתעד",
            risk: `תקרת-יום בשרת (REWARD_DAILY_CAPS) עוצרת דילול; שער-החוק: ${gate.mode}`,
            rollback: "הקבלה בספר hash-chained — אין היפוך-תגמול; התקרה חוסמת חזרות",
          });
          const avRew = autonomyVerdict("reward-pay", "money-mover");
          if (!avRew.allowed) {
            appendHistory({ kind: "AUTONOMY-HELD", reason: avRew.why });
          } else {
          const rew = await fetch(EXCHANGE_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "reward-pay",
              member: POLICY.rewards.member,
              amount: Math.max(1, newFills * POLICY.rewards.saosPerFill),
              note: `grid-fills ×${newFills} (window 24h) — עבודה→מטבע→נזילות`,
            }),
            signal: AbortSignal.timeout(30_000),
          }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
          if (rew?.ok) {
            appendHistory({ kind: "SAOS-REWARD", reason: `מילויים ×${newFills}`, saos: newFills * POLICY.rewards.saosPerFill });
            // R107 — שרשרת הגלגול: תגמול שולם ← הגלגול נורה מעצמו.
            // דבר גורר דבר: מילוי ← תגמול ← המרה ל-USDS ← עומק-LP ←
            // עמלות מנפחות מניות. השומרים (צינון/תקציב) במנוע-השרשרת.
            try {
              const comp = await fetch(EXCHANGE_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "agent-compound", member: POLICY.rewards.member, note: "grid-fill domino" }),
                signal: AbortSignal.timeout(45_000),
              }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
              if (comp?.ok) {
                appendHistory({ kind: "CHAIN-COMPOUND", reason: String(comp.detail ?? "").slice(0, 140) });
              } else if (comp) {
                appendHistory({ kind: "CHAIN-COMPOUND-FAIL", reason: String(comp.detail ?? comp.error ?? "לא צוין").slice(0, 120) });
              }
            } catch { /* הגלגול לעולם לא מפיל את המדידה */ }
          } else {
            // R123 — כנות: תגמול על עבודה מוכחת שנכשל — נרשם, לא נבלע
            appendHistory({ kind: "SAOS-REWARD-FAIL", reason: `מילויים ×${newFills}`, error: String(rew?.error ?? "הקריאה לא נענתה").slice(0, 120) });
          }
          } // r197 — סוף ענף-התגמול המותר (השער האוטונומי)
        } else if (fillsNow < seen) {
          state.fillsSeen = fillsNow; // החלון התנקה — סימן-המים בעקבות האמת
        }
      }
    } catch { /* התגמול לעולם לא מפיל את המדידה */ }
    // R105 — סריקת דלת-ההפקדות בפעימה (חוק חיים):
    // עד R105 הסריקה הייתה ידנית בלבד — הפקדות המתינו בזמן שהמנוע חי.
    // עכשיו: כל 5 דקות פותחות המפוגה — חמש רשתות, שוקדפות נזקפות מהרגע שהכסף נוגע לשרשרת.
    try {
      const lastScan = state.lastDepositScanAt ? new Date(state.lastDepositScanAt).getTime() : 0;
      if (Date.now() - lastScan >= 5 * 60_000) {
        state.lastDepositScanAt = new Date().toISOString();
        const dep = await fetch(EXCHANGE_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deposit-scan" }),
          signal: AbortSignal.timeout(45_000),
        }).then((x) => x.json() as Promise<{ ok?: boolean; credited?: number; detail?: string }>).catch(() => null);
        if (dep?.credited && dep.credited > 0) {
          appendHistory({ kind: "DEPOSIT-CREDIT", reason: dep.detail ?? `${dep.credited} deposits credited`, placed: dep.credited });
        }
      }
    } catch { /* הסריקה לעולם לא מפילה את המדידה */ }
    // R108 — גוב-הצי: עבודה מוכחת מקבצי-המצב של הדיבונים ← SAOS ← זירה.
    // הזיהוי באמת-מקומית (קריאת המצב, לא טענת-רשת) והתקרות נאכפות בשרת
    // (REWARD_DAILY_CAPS). שלושה סוגי-עבודה נספרים: החיית-דיבון (שומר)
    // · שידור-שרשרת יומי (דופק) · סיור-בחינות רציף (תלמיד — פעם ביום,
    // התדירות היא העבודה). אחר-כך גלגול-צי ואיזון-בריכות.
    try {
      const readJson = (p: string): any | null => {
        try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
      };
      const wm = state.fleetSeen ?? {};
      // (א) שומר — החייה מוכחת בהיסטוריה שלו
      const ks = readJson(`${HOME}/sovereign/keeper/state.json`);
      if (ks && Array.isArray(ks.history)) {
        const restarts = (ks.history as Array<{ at: string; kind: string; detail: string }>)
          .filter((h) => h.kind === "RESTART")
          .sort((a, b) => a.at.localeCompare(b.at));
        const last = restarts[restarts.length - 1];
        if (last && last.at !== wm.keeperRestartAt) {
          const isNew = !wm.keeperRestartAt || last.at > wm.keeperRestartAt;
          if (isNew) {
            wm.keeperRestartAt = last.at;
            state.fleetSeen = wm;
            const gK = gateFleetAction("reward-pay", { claim: `לשלם 2 SAOS ל-keeper על החייה: ${last.detail.slice(0, 60)}`, why: "RESTART אמיתי בהיסטוריית השומר — עבודה נמדדת", expected: "מאזן keeper +2 מהאוצר; הספר מתעד", risk: "כפילות-רילוד — סימן-מים + תקרת-יום 6 חוסמים", rollback: "קבלה בספר; התקרה חוסמת חזרות" });
            if (!gK.allowed) {
              appendHistory({ kind: "AUTONOMY-HELD", reason: gK.why });
            } else {
            const rew = await fetch(EXCHANGE_API, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "reward-pay", member: "keeper", amount: 2, note: `החיית דיבון מוכחת: ${last.detail.slice(0, 80)}` }),
              signal: AbortSignal.timeout(30_000),
            }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
            if (rew?.ok) appendHistory({ kind: "FLEET-PAY", reason: `keeper: ${last.detail.slice(0, 100)}`, saos: 2 });
            } // r197 — סוף ענף-התשלום המותר
          }
        }
      }
      // (ב) דופק — שידור-שרשרת יומי מוכח
      const ps = readJson(`${HOME}/sovereign/pulse/state.json`);
      if (ps?.lastPublishUtcDay && ps.lastPublishUtcDay !== wm.pulseDay) {
        wm.pulseDay = ps.lastPublishUtcDay;
        state.fleetSeen = wm;
        const gP = gateFleetAction("reward-pay", { claim: `לשלם 2 SAOS ל-pulse על שידור יומי ${ps.lastPublishUtcDay}`, why: "שידור-שרשרת יומי מוכח במצב-הדופק — עבודה נמדדת", expected: "מאזן pulse +2 מהאוצר; הספר מתעד", risk: "כפילות-יום — סימן-מים pulseDay + תקרת-יום 4 חוסמים", rollback: "קבלה בספר; התקרה חוסמת חזרות" });
        if (!gP.allowed) {
          appendHistory({ kind: "AUTONOMY-HELD", reason: gP.why });
        } else {
        const rew = await fetch(EXCHANGE_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reward-pay", member: "pulse", amount: 2, note: `שידור יומי לשרשרת ${ps.lastPublishUtcDay}` }),
          signal: AbortSignal.timeout(30_000),
        }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
        if (rew?.ok) appendHistory({ kind: "FLEET-PAY", reason: `pulse: שידור ${ps.lastPublishUtcDay}`, saos: 2 });
        } // r197 — סוף ענף-התשלום המותר
      }
      // (ג) תלמיד — סיור-בחינות רציף (פעם ביום — התדירות היא העבודה)
      const ss = readJson(`${HOME}/sovereign/student/state.json`);
      if (ss?.lastExamAt) {
        const examDay = String(ss.lastExamAt).slice(0, 10);
        const fresh = Date.now() - new Date(ss.lastExamAt).getTime() < 2 * 3600_000; // בחינה בשעתיים האחרונות = סיור חי
        if (fresh && examDay !== wm.studentDay) {
          wm.studentDay = examDay;
          state.fleetSeen = wm;
          const gS = gateFleetAction("reward-pay", { claim: `לשלם 1 SAOS ל-student על סיור-בחינות ${examDay}`, why: "בחינה חיה בשעתיים האחרונות — התדירות היא העבודה", expected: "מאזן student +1 מהאוצר; הספר מתעד", risk: "כפילות-יום — סימן-מים studentDay + תקרת-יום 2 חוסמים", rollback: "קבלה בספר; התקרה חוסמת חזרות" });
          if (!gS.allowed) {
            appendHistory({ kind: "AUTONOMY-HELD", reason: gS.why });
          } else {
          const rew = await fetch(EXCHANGE_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reward-pay", member: "student", amount: 1, note: `סיור-בחינות רציף ${examDay}` }),
            signal: AbortSignal.timeout(30_000),
          }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
          if (rew?.ok) appendHistory({ kind: "FLEET-PAY", reason: `student: סיור ${examDay}`, saos: 1 });
          } // r197 — סוף ענף-התשלום המותר
        }
      }
      // (ד) גלגול-צי — כל 5 דקות (סריקת המאזנים כבדה; חלונות במים במקומץ)
      const lastSweep = state.lastFleetSweepAt ? new Date(state.lastFleetSweepAt).getTime() : 0;
      if (Date.now() - lastSweep < 5 * 60_000) { state.fleetSeen = wm; } else {
      state.lastFleetSweepAt = new Date().toISOString();
      const fleetBal = await fetch(EXCHANGE_API, { signal: AbortSignal.timeout(20_000) })
        .then((x) => x.json() as Promise<{ members?: Array<{ member: string; balances: Record<string, number> }> }>).catch(() => null);
      const compoundable = (fleetBal?.members ?? []).filter(
        (m) => !["treasury", "reserve", "operator"].includes(m.member) && (m.balances?.SAOS ?? 0) >= 4,
      );
      if (compoundable.length > 0) {
        const gFC = gateFleetAction("fleet-compound", { claim: `לגלגל ${compoundable.length} מאזני-צי (≥4 SAOS) לעומק-בריכות`, why: "סריקת-מאזנים חיה מצאה יתרות-עבודה מעל הסף", expected: "SAOS מומר ל-USDS; עומק-בריכות עולה; מניות-LP מתעדות", risk: "דילול-אוצר — ההמרה מגובה במחיר-חי; שער-$100 חוסם חריגה", rollback: "מניות-LP מתועדות לכל מי שהפקיד — ניתנות למשיכה" });
        if (!gFC.allowed) {
          appendHistory({ kind: "AUTONOMY-HELD", reason: gFC.why });
        } else {
        const fc = await fetch(EXCHANGE_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "fleet-compound" }),
          signal: AbortSignal.timeout(60_000),
        }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
        if (fc?.ok) appendHistory({ kind: "FLEET-COMPOUND", reason: String(fc.detail ?? "").slice(0, 120) });
        } // r197 — סוף ענף-הגלגול המותר
      }
      } // סוף שער הגלגול-צי
      // (ה) איזון-בריכות — סטיות נמדדות ונסגרות (R108) — כל 10 דק'
      const lastGuard = state.lastPoolGuardAt ? new Date(state.lastPoolGuardAt).getTime() : 0;
      if (Date.now() - lastGuard >= 10 * 60_000) {
        state.lastPoolGuardAt = new Date().toISOString();
        const pg = await fetch(EXCHANGE_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pool-guard" }),
          signal: AbortSignal.timeout(45_000),
        }).then((x) => x.json() as Promise<{ ok?: boolean; detail?: string }>).catch(() => null);
        if (pg?.ok && pg.detail) appendHistory({ kind: "POOL-GUARD", reason: String(pg.detail).slice(0, 120) });
      }
      state.fleetSeen = wm;
    } catch { /* גוב-הצי לעולם לא מפיל את המדידה */ }

    // r207 — מדידת-תנאי-ההעדפה בכל-פעימה (I7): רג'ים-ה-SBD. תנאי-שלילי + ראיות-מעוגנות
    // ⇒ כתיבת-העדפה (דדופ-מובנה); 3 מדידות-חיוביות רצופות ⇒ שחרור. כשל נבלע-כנה.
    try {
      // §X R208R — כנות-חיישן בנתיב-ההעדפה (trace 1a10dda614a62251):
      // מדידה-חסרה = UNMEASURED — לעולם לא 0. אין כותבים DOWN מ"0.000" מדומה,
      // ואין משאירים רצף-חיובי ישן מול מדידה-נעדרת (שחרור-כוזב).
      // §VII R208R — הסף נקרא מהמודל (OBJECTIVE-PARAMETER) — אפס-שכפול-קבוע.
      const sbdRawPref = (meas as any)?.sbdArming?.balance;
      const sbdFinite = typeof sbdRawPref === "number" && Number.isFinite(sbdRawPref);
      const thrSbd = getArmingThresholdSbd();
      if (!sbdFinite || !thrSbd) {
        resetConditionStreak("grid-pool-seed");
        if (!thrSbd) appendHistory({ kind: "PREF-THRESHOLD-UNKNOWN", reason: "סף-ההעדפה לא-ניתן-לקריאה מהמודל — נמנעים, אין-המצאה (§VII)", parity: null, placed: 0, cancelled: 0, error: null });
      } else {
        const prefRes = notePreferenceCondition("grid-pool-seed", sbdRawPref >= thrSbd.value, sbdRawPref < thrSbd.value ? [
          { book: "sovereign/objectives/options.json", ref: "unitErrorCorrection", value: "סף-זריעה אמיתי ~160 WSTEEM (תיקון-שגיאת-יחידות 96) · צד-SBD בלתי-ממומן" },
          { book: "sovereign/objectives/capabilities.json", ref: "C5", value: `SBD מדיד ${sbdRawPref.toFixed(3)} — מתחת-למימון-צד-העטיפה` },
        ] : undefined);
        if (prefRes.wrote) appendHistory({ kind: `PREF-${prefRes.wrote === "PREFERENCE-UPDATE" ? "DOWN" : "RELEASE"}`, reason: `grid-pool-seed: ${prefRes.wrote} (advisory)`, parity: null, placed: 0, cancelled: 0, error: null });
      }
    } catch { /* ההעדפות לעולם לא מפילות את הפעימה */ }

    const d = await decide(meas);
    const now = new Date();
    if (d.act) {
      const gA = gateFleetAction("grid-act", {
        claim: `להריץ ${d.action ?? "reprice"} על רגל-steem: ${d.reason.slice(0, 90)}`,
        why: "טריגר נמדד חי בפעימה (סטיית-פאריטה/רצפה/גל) — מדידה חיה",
        expected: "הסולם מתיישר לפאריטה; מילויים אפשריים; הספר חי",
        risk: "שחיקת-ספר בסטייה — רצפת-ערך + תקרת-יום 12 חוסמים; שער-$100 בשרת",
        rollback: "cancel-all זמין; קבלות עם txids בספר",
        // r206 — ההפרכה נרשמת לפני-המעשה: תחזית שאינה ניתנת-לבדיקה אינה תחזית
        falsifier: "receipt.ok=false ⇒ תחזית מופרכת · סירוב-טרום-פעולה (code NO-*/PAUSED/QUEUED) אינו הפרכה — הפעולה לא נגעה בעולם",
      });
      if (!gA.allowed) {
        state.lastDecision = { at: new Date().toISOString(), kind: "AUTONOMY-HELD", detail: gA.why };
        saveState();
      } else {
        await act(d.reason, d.action ?? "reprice", "steem", d.tag, gA.deliberation, gA.thought); // r205+206 — התחזית נוסעת עם הפעולה · הדיון נוסע לשער
      }
    } else {
      // R101c — חוק-הברזל לשתי הרגליים: צינון + תקציב חלים גם על HIVE.
      // (נלמד מתקרית חיה: ללא השערות האלה הרגל שרפה 28 פעולות ביום —
      // כל פעימה עם סטייה>50bps שידרה מחדש. אותם חוקים, אותו מוח.)
      const sinceMin = state.lastActionAt
        ? (now.getTime() - new Date(state.lastActionAt).getTime()) / 60_000
        : null;
      // r205 — התצוגה כנה: הצינון האפקטיבי כולל את ההתאמה-הנלמדת + הראיות
      const lcDisplay = effectiveCooldown();
      const cooldownBlock =
        sinceMin != null && sinceMin < lcDisplay.total
          ? `WAIT-COOLDOWN · עוד ${Math.ceil(lcDisplay.total - sinceMin)} דק'${lcDisplay.learned > 0 ? ` · צינון-נלמד +${lcDisplay.learned}' (${lcDisplay.evidence})` : ""}`
          : null;
      const budgetBlock =
        state.actionsToday >= POLICY.actionsBudgetPerDay
          ? `WAIT-BUDGET · ${state.actionsToday}/${POLICY.actionsBudgetPerDay} פעולות היום — התקציב נאכל`
          : null;
      if (cooldownBlock ?? budgetBlock) {
        state.lastDecision = {
          at: new Date().toISOString(),
          kind: (cooldownBlock ?? budgetBlock ?? "").split(" ·")[0],
          detail: `${d.reason} · ${cooldownBlock ?? budgetBlock}`,
        };
        saveState();
      } else {
        // R101 — רגל HIVE: נבדקת רק כשאין פעות-STEEM בפעימה זו (צינון-יחידה).
        // אותם חוקים: צינון, תקציב, שער-$100 — במוח שלה (api/money/hive).
        const hive = await measureHive();
        const dh = await decideHive(hive);
        if (dh.act) {
          const gH = gateFleetAction("grid-act", {
            claim: `להריץ reprice על רגל-hive: ${dh.reason.slice(0, 90)}`,
            why: "סטיית-פאריטה נמדדה חי ברגל-hive",
            expected: "המיקרו-גריד מתיישר לפאריטה; הספר חי",
            risk: "שחיקת-ספר — צינון + תקציב חלים גם על hive; שער-$100 בשרת",
            rollback: "cancel-all זמין; קבלות בספר",
            falsifier: "receipt.ok=false ⇒ תחזית מופרכת · סירוב-טרום-פעולה (code NO-*/PAUSED/QUEUED) אינו הפרכה",
          });
          if (!gH.allowed) {
            state.lastDecision = { at: new Date().toISOString(), kind: "AUTONOMY-HELD", detail: gH.why };
            saveState();
          } else {
            await act(dh.reason, "reprice", "hive", undefined, gH.deliberation, gH.thought); // r205+206 — התחזית נוסעת עם הפעולה · הדיון נוסע לשער
          }
        } else {
          state.lastDecision = {
            at: new Date().toISOString(),
            kind: d.reason.startsWith("WAIT") ? d.reason.split(" ·")[0] : "HOLD",
            detail: `${d.reason} · ${dh.reason}`,
          };
          saveState();
        }
      }
    }
  } catch (e: any) {
    state.lastDecision = { at: new Date().toISOString(), kind: "ERROR", detail: String(e?.message ?? e).slice(0, 160) };
    saveState();
  } finally {
    ticking = false;
  }
}

// ── שרת-בריאות (השומר קורא את זה כל 30ש') ─────────────────────────
// R124 — שרת-היחיד חוצה-דורות (חוק weblift מ-r123): bun --hot שמעריך את
// המודול מחדש נתקל ב-EADDRINUSE מול השרת של הדור הקודם וההערכה נעצרת
// לפני שהטיימר חומש. שרת אחד לכל חיי התהליך; ה-handler קורא את המצב החי
// מציר-העולם (G_MONEY.__MONEY_STATE__) — זהה לאובייקט של הדור החי.
const G_MONEY_SRV = globalThis as unknown as { __MONEY_SERVER__?: unknown };
if (G_MONEY_SRV.__MONEY_SERVER__) {
  // שרת חי מדור קודם — ממשיך להגיש; המצב שלו הוא אובייקט ציר-העולם.
} else {
  G_MONEY_SRV.__MONEY_SERVER__ = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // R123 — פקודות-כסף (/act) נשלחות מ-localhost בלבד — לא נחשפות לרשת החוץ
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return Response.json({ ...state, ok: true, alive: true, now: new Date().toISOString() });
    }
    if (url.pathname === "/act" && req.method === "POST") {
      // פקודת-מפעיל ידנית (דרך שער המפעיל) — אותן פעולות, אותם חוקים
      if (state.acting) return Response.json({ ok: false, error: "already-acting" }, { status: 409 });
      const body = await req.json().catch(() => ({}));
      const target = body?.target === "hive" ? "hive" : "steem";
      const manualAction = (body?.action === "arm-buy" ? "arm-buy" : body?.action === "stock-sbd" ? "stock-sbd" : body?.action === "arena-stream" ? "arena-stream" : "reprice") as "arm-buy" | "stock-sbd" | "arena-stream" | "reprice";
      const manualReason = String(body?.reason ?? "manual operator command").slice(0, 200);
      // r206 — גם פקודה-ידנית נחשבת ב-THINKING: דיון כנה על יחסות-מפעיל שהדיבון מבצע
      const gM = gateFleetAction("manual-act", {
        claim: `פקודת-מפעיל ידנית: ${manualAction} על רגל-${target} — ${manualReason.slice(0, 90)}`,
        why: "פקודת-מפעיל חיה דרך שער-המפעיל של הדיבון — הדיבון מבצע יחסות, הסמכות במפעיל",
        expected: "הפעולה מבוצעת; קבלה עם txids בספר",
        risk: "פקודה-ידנית — כל החוסמים חלים (צינון/תקרות/שער-$100/סודות)",
        rollback: "קבלה בספר; cancel-all זמין",
      });
      if (!gM.allowed) {
        state.lastDecision = { at: new Date().toISOString(), kind: "AUTONOMY-HELD", detail: gM.why };
        saveState();
        return Response.json({ ok: false, lastDecision: state.lastDecision, error: gM.why }, { status: 403 });
      }
      const actOk = await act(manualReason, manualAction, target, undefined, gM.deliberation, gM.thought);
      // אמת ברמת ה-HTTP: ok משקף את תוצאת הפעולה עצמה (לא "הוזנק בהצלחה")
      // — ההחלטה המלאה והכנה ב-lastDecision המצורף.
      return Response.json({ ok: actOk, lastDecision: state.lastDecision });
    }
    return new Response("not found", { status: 404 });
  },
  });
}

// ── r206 · ביקורת-הייחוס העצמית (מטא-קוגניציה) ─────────────────────
// האורגניזם מצליב את אמונתו-הנלמדת (ספר-העדכונים) מול ספר-השער (TxGate —
// ספר-סמכות עצמאי ב-DB). אם כל הסירובים בחלון-הראיות שבנו את האמונה היו
// NO-DELIBERATION עם הערכת-USD חיה — האמונה "שער-מת" נבנתה על ייחוס-שקר,
// והיא מתוקנת ברשומת-עדכון חדשה עם ציטוט-הראיות. אפס-שכתוב-היסטוריה.
// fail-closed: שער-לא-נגיש / ראיה-מעורבת / אין-מספיק — אין תיקון, ההימנעות כנה.
const G_AUDIT = globalThis as unknown as { __MONEY_AUDIT_RUNNING__?: boolean };
async function auditMisattribution(): Promise<void> {
  if (G_AUDIT.__MONEY_AUDIT_RUNNING__) return; // טעינה-חמה לא מכפילה ביקורת
  G_AUDIT.__MONEY_AUDIT_RUNNING__ = true;
  try {
    const lb = readLearnedBackoff();
    if (lb.backoffMin <= 0 || !lb.evidence) return; // אין אמונה-נלמדת לתקן
    if (!lb.evidence.signature.includes("usd לא נמדד")) return; // רק את הייחוס-המדוד
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20_000);
    let recent: Array<{ verdict: string; decidedBy?: string; usdValue: number | null; createdAt: string }> = [];
    try {
      const res = await fetch("http://127.0.0.1:3000/api/gate", { signal: ctl.signal, cache: "no-store" });
      if (!res.ok) return; // אין ספר-שער — אין ביקורת (fail-closed, לא ממציאים ראיות)
      const j = (await res.json()) as { recent?: typeof recent };
      recent = Array.isArray(j?.recent) ? j.recent : [];
    } finally {
      clearTimeout(t);
    }
    if (recent.length === 0) return;
    const from = Date.parse(lb.evidence.windowFrom) - 5_000;
    const to = Date.parse(lb.evidence.windowTo) + 5_000;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    const inWindow = recent.filter((x) => {
      const tt = Date.parse(x.createdAt);
      return Number.isFinite(tt) && tt >= from && tt <= to;
    });
    const noDelib = inWindow.filter((x) => x.verdict === "REFUSED" && x.decidedBy === "autonomy:NO-DELIBERATION" && x.usdValue != null && Number(x.usdValue) > 0);
    const other = inWindow.filter((x) => !(x.verdict === "REFUSED" && x.decidedBy === "autonomy:NO-DELIBERATION" && x.usdValue != null && Number(x.usdValue) > 0));
    if (noDelib.length < 3 || other.length > 0) return; // ראיה-לא-מספקת/מעורבת — האמונה לא הוכחה כשקרית במלואה
    const maxUsd = Math.max(...noDelib.map((x) => Number(x.usdValue)));
    const upd = applyMisattributionCorrection({
      noDelibCount: noDelib.length,
      maxUsd,
      windowFrom: lb.evidence.windowFrom,
      windowTo: lb.evidence.windowTo,
      auditedAt: new Date().toISOString(),
    });
    if (upd) {
      console.log(`[money-mover] r206: תיקון-ייחוס מטא-קוגניטיבי — עדכון #${upd.seq}: retryBackoffMin →0 (ראיה: TxGate NO-DELIBERATION ×${noDelib.length} ב-USD חי ≤$${maxUsd.toFixed(2)})`);
      const lb2 = readLearnedBackoff();
      state.learning = { backoffMin: lb2.backoffMin, epistemic: lb2.epistemic, suspended: lb2.suspended, streak: lb2.evidence?.streak ?? undefined, updatedAt: lb2.updatedAt };
      saveState();
    }
  } catch { /* הביקורת לעולם לא מפילה את העלייה */ }
  finally { G_AUDIT.__MONEY_AUDIT_RUNNING__ = false; }
}

saveState();
// r207 — שחזור-שכבת-ההעדפות מהספר לפני-הפעימה-הראשונה (התאמה לספרי-הלמידה:
// מוות→שחזור · שרשרת-שבורה ⇒ suspended fail-closed, אף-העדפה לא מומצאת מחדש)
try { rebuildFromBook(); } catch { /* כשל-שחזור = אפס-העדפות (חוק-בסיס) */ }
seedHistoryExperiences(); // r205 — הניסיון ההיסטורי זורע לפני-הפעימה הראשונה
void auditMisattribution(); // r206 — ביקורת-ייחוס עצמית מול ספר-השער (append-only · fail-closed · אידמפוטנטי)
console.log(`[money-mover] חי על פורט ${PORT} · beats=${state.beats} · actionsToday=${state.actionsToday} · r205 לולאת-למידה חיה (backoff=${state.learning?.backoffMin ?? 0}')`);
tick();
// R111 — law of the single timer (R109 lesson, applied to money):
// bun --hot re-evaluates the module but does NOT clear the old interval —
// two live closures then double-fire acts (measured live 05:16: old decide()
// fired stock-sbd with the pre-R111 reason while the new code was already
// deployed). The singleton guard captures the previous timer and clears it.
const G = globalThis as unknown as { __MONEY_TIMER__?: ReturnType<typeof setInterval> };
if (G.__MONEY_TIMER__) clearInterval(G.__MONEY_TIMER__);
G.__MONEY_TIMER__ = setInterval(() => {
  // R112 — שומר-הפעימה: הפעימה התלויה עולה במחיר מחזור אחד, לא במחיר הדיבון
  const nowMs = Date.now();
  if (ticking && tickStartedAt && nowMs - tickStartedAt > TICK_MAX_MS) {
    ticking = false;
    appendHistory({ kind: "WATCHDOG-RELEASE", reason: `tick נעול >${Math.round(TICK_MAX_MS / 60000)} דק' — הנעילה שוחררה; ה-await התלוי יתום: אם יתעורר, יכולת-הכתיבה שלו לא נשללה (כל ה-fetches deadline-bound — חלון הסיכון חסום-זמן בלבד)` });
    saveState();
  }
  if (state.acting && actStartedAt && nowMs - actStartedAt > ACTING_MAX_MS) {
    state.acting = false;
    state.lastDecision = { at: new Date().toISOString(), kind: "WATCHDOG-ACTING-RELEASE", detail: `acting נעול >${Math.round(ACTING_MAX_MS / 60000)} דק' — שוחרר בכוח בכנות; חוקי הצינון והתקציב עודם שומרים על הכסף` };
    saveState();
  }
  tick();
}, CHECK_INTERVAL_SEC * 1000);

// ── r143-c · מתג-איש-מת ─────────────────────────────────────
// זומבי חי שנמדד (keeper, r143): HTTP עונה בזמן שהפעימות קפואות.
// כל 60ש' נמדדת התקדמות-הלולאה; שתיקה מעל 15 דק' ⇒ שורה כנה ביומן
// ויציאה (exit 1) — fleet-guard יקים תהליך-טרי. הסף 15 דק' ולא 10:
// פעולת-כסף חיה (acting) מותרת להתארך עד ACTING_MAX_MS = 10 דק' ובזמנה
// הפעימות נעצרות בכנות (חוק הפעולה — לא שולחים פעימה חדשה בזמן פעולה)
// — פעימה איטית אחת לעולם לא הורגת דיבון בריא. הטיימר במשמר-גלובלי
// (חוק הטיימר-היחיד) — טעינה-חמה לא מכפילה שומרים.
const DEAD_MAN_TICK_MS = 60_000;
const DEAD_MAN_STALL_MS = 15 * 60_000;
const DEAD_MAN_LOG = `${HOME}/sovereign/keeper/logs/money-daemon.log`;
const G_DM = globalThis as unknown as { __MONEY_DEADMAN__?: ReturnType<typeof setInterval> };
if (G_DM.__MONEY_DEADMAN__) clearInterval(G_DM.__MONEY_DEADMAN__);
G_DM.__MONEY_DEADMAN__ = setInterval(() => {
  if (Date.now() - lastBeatAt <= DEAD_MAN_STALL_MS) return;
  const msg = "dead-man: beats stalled >15min — exiting for revival";
  try {
    fs.mkdirSync(`${HOME}/sovereign/keeper/logs`, { recursive: true });
    fs.appendFileSync(DEAD_MAN_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log(msg);
  clearInterval(G_DM.__MONEY_DEADMAN__);
  process.exit(1);
}, DEAD_MAN_TICK_MS);
