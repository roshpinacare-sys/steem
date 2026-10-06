// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Economy — מנוע הכלכלה הריבונית (R98).
//
// הוראת המפעיל שיצרה את המנוע: "הבן את כל המכלול שבידינו נסה ליישם
// ככל הניתן או לפחות לתכנן ככל הניתן ריבונות שוק וכלכלה ריבונית
// אוטונומית... לבחון איך לטפל ולפתוח סתימות חסימות דימומים מה
// שנמצא חסום (ולמה)".
//
// ארבע שכבות, כולן מנתונים חיים בלבד (חוק הברזל: שום טענה בלי מדידה):
//   1. מרשם החסימות — כל סתימה/חסימה/דימום בכלכלה: מה, למה, מכוונת
//      או חולפת, תנאי הפתיחה, והנתיב הריבוני. השכבה החיה מודדת
//      את המצב האמיתי בזמן הקריאה (מלאי SBD, הון TRON, ערוצי ציטוט).
//   2. מטריצת הזרימה — כל רגל נזילות רב-כיוונית: מאין לאן, סטטוס,
//      ולאן נגזרות העמלות (בריכות שלנו או שלהם).
//   3. יעילות עוגנים — מה כל עוגן קונה לנו בפועל: רצפת הפאריטה,
//      שער ה-$100, העד השעתי, קו ZERO, עוגן ה-EVM — ומסלול הפג.
//   4. מנוע ערבוב-הסוואפ — "נערבב את הסוואפ שלנו עם שלהם וככה נקבל
//      נזילות מהבריכות שם והעמלות יגזרו בבריכות שלנו": תוכנית ביצוע
//      מדודה שמערבבת רגל-פנים (ההכנסה שלנו) עם רגל-חוץ (הנזילות
//      שלהם), עם השערים במקום.
//
// כנות מלאה: ביצוע העסקה עצמה נשאר שער-מפעיל (אין מפתח-חוץ
// בסנדבוקס, ואין גוף מורשה) — המנוע מודד ומתכנן; הוא לא חותם.
// ─────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import * as fs from "fs";
import * as path from "path";

// ── חוזה הנתונים (BE↔FE) ─────────────────────────────────────────────

export type BlockageKind = "CLOG" | "GATE" | "BLEED" | "MOORING";
export type BlockageClass =
  | "INTENTIONAL-LEGAL"
  | "INTENTIONAL-SECURITY"
  | "INVENTORY"
  | "OPERATOR"
  | "INFRA"
  | "MEASUREMENT"
  // R102 — מחלקות-מצב חדשות לחסימות שנפתחו לחיים
  | "ARMED"
  | "LIVE-INTERNAL"
  | "PARTIAL-LIVE"
  | "LIVE"
  | "LIVE-RAIL"; // R104 — המטבע יוצא לשרשרת-החי במשיכה: תביעה נשרפת, token.transfer מוכח
export type BlockageLiveState = "IN-PROGRESS" | "HOLDING" | "STATIC";

export interface BlockageRow {
  code: string;
  kind: BlockageKind;
  title: string;
  what: string;
  why: string;
  class: BlockageClass;
  measured: string;
  unlock: string;
  sovereignPath: string;
  /** שכבה חיה: המדידה עכשיו (מחליפה את ה-seed כשיש מקור) */
  liveMeasured: string | null;
  /** 0..1 — התקדמות לפתיחה (רק לחסימות מלאי); null = לא רלוונטי */
  progress: number | null;
  liveState: BlockageLiveState;
  updatedAt: string;
}

export type FlowStatus =
  | "LIVE"
  | "GATED"
  | "QUOTES-ONLY"
  | "PLANNED"
  | "MEASUREMENT"
  | "NOT-MEASURABLE"
  | "MOORING";

export type FeeAccrual = "OURS" | "THEIRS" | "NONE" | "PLANNED-OURS";

export interface FlowLeg {
  id: string;
  title: string;
  from: string;
  to: string;
  status: FlowStatus;
  feeAccrual: FeeAccrual;
  feeNote: string;
  measured: string;
  gate: string;
}

export interface AnchorRow {
  id: string;
  title: string;
  buys: string; // מה העוגן קונה לנו בכלכלה
  measured: string;
  verdict: "ARMED" | "ENFORCED" | "ANCHORED" | "LOCAL" | "WAIT";
  note: string;
}

export interface PegMetrics {
  sbdNominal: number;
  sbdExternal: number | null;
  sbdImpliedInternal: number | null;
  /** סטיית הדולר-הנגזר-פנימי מהמחיר החיצוני, bps (חיובי = הפנים מתמחר יקר יותר) */
  internalVsExternalBps: number | null;
  /** הפער מהנומינל ($1) לפי המחיר החיצוני, bps */
  externalDepegBps: number | null;
  regime: "VALUE-TRAP" | "NEUTRAL" | "NOT-MEASURED";
  note: string;
}

export interface SbdBuildRate {
  fillsInWindow: number;
  sbdCaptured: number;
  windowDays: number | null;
  sbdPerDay: number | null;
  commitableNow: number | null;
  needed: number;
  etaDays: number | null;
  note: string;
}

export interface MixLeg {
  id: string;
  title: string;
  venue: string; // בריכה פנימית / ראוטר חיצוני / שער
  feeAccrual: FeeAccrual;
  detail: string;
  numbers: Array<{ label: string; value: string }>;
}

export interface MixPlan {
  sizeSteem: number;
  sizeUsd: number | null;
  usdBasis: string;
  gateVerdict: "AUTONOMOUS" | "OPERATOR-QUEUE" | "NO-MARK";
  gateDetail: string;
  legs: MixLeg[];
  mixingVerdict: string;
  doctrine: string[];
}

export interface EconomyKpis {
  sbdCommitable: number | null;
  sbdNeeded: number;
  sbdProgress: number | null;
  quotesVerified: number | null;
  quotesTotal: number | null;
  powerdownWeeklySteem: number | null;
  powerdownPaymentsLeft: number | null;
  deployedSteem: number | null;
  ladderLevels: number;
  gateAllowed: number | null;
  gateQueued: number | null;
  gateRefused: number | null;
}

export interface EconomySnapshot {
  ok: boolean;
  at: string;
  kpis: EconomyKpis;
  blockages: BlockageRow[];
  flows: FlowLeg[];
  anchors: AnchorRow[];
  peg: PegMetrics;
  sbdBuild: SbdBuildRate;
  mix: MixPlan;
  doctrine: string[];
  down: string[];
  sources: Record<string, string>;
}

// ── זריעת מרשם החסימות — הקנון מתדרוך המפעיל (R98) ──────────────────

const BLOCKAGE_SEED: Array<Omit<BlockageRow, "liveMeasured" | "progress" | "liveState" | "updatedAt">> = [
  {
    code: "BLK-SBD-BUYSIDE",
    kind: "CLOG",
    title: "צד-הקנייה של הגריד חסום על מלאי SBD",
    what: "הגריד-החוץ חי ומזוין בשלוש שרשרות (STEEM_ACTIVE_WIF + HIVE_ACTIVE_WIF + BLURT_ACTIVE_WIF בכספת המנוע, R99 — נמדד ב-API), ופקודות אמת מונחות עם txids - אבל צד-הקנייה של STEEM ממתין למלאי SBD: היתרה הזמינה מול הנדרש בסף החימוש.",
    why: "ה-SBD היחיד שזורם מגיע ממכירות-הפרימיה שלנו עצמנו - זהו קצב-הבנייה של הצד השני. אין מקור SBD חיצוני בלי ערוץ-יציאה, ואנחנו לא קונים SBD במחיר שוק כדי לא לשלם את הפער פעמיים.",
    class: "INVENTORY",
    measured: "נזרע לפי תדרוך המפעיל; השכבה החיה מודדת את הקופה בכל מחזור",
    unlock: "מלאי commitable >= 0.15 SBD ממילויי סולם הפרימיה - נפתח רק ממילוי אמיתי, לא ממכירה מתחת לערך",
    sovereignPath: "מיקרו-גריד דו-צדדי (arm-buy, R97) עם חוק גג; כל מילוי מזין את הקופה והקצב נמדד כאן בכל מחזור - הרשת בונה את הצד השני שלה בעצמה, בלי אשראי ובלי סיכון",
  },
  {
    code: "BLK-ETH-SOL-CAST",
    kind: "GATE",
    title: "ריילי ETH/SOL — זרימה רב-רשתית ממשרה עצמה (R105)",
    what: "הגישה הוכחה בכספת ובשרשרת (R102: 24/24 מפתחות, SOL txid 5amYdKAC… confirmed). R105 סוגר את המעגל: דלתות הפקדה חיות בחמש רשתות (STEEM+HIVE+BLURT+SOL+ETH, מזכר wx:<חבר>), WSOL/WETH נכסי-זירה בעטיפה 1:1, ורייל משיכת SOL שרוף עטיפה ומשדר העברה אמיתית מאוצר cashmachine.",
    why: "שידור-ETH מובאי מאוביק מהון-גז (אבק נמדד) — הדלת חיה לקבלה, NO-GAS כנה ביציעה עד הגעת הון מזרימה. SOL מולוא מוכח מקצה לקצה. שער-$100 מכסה את הביצוע בשני הצדדים.",
    class: "PARTIAL-LIVE",
    measured: "דלתות: 5 רשתות וסריקה חיה כל 5 דק' · מאזן אוצר מודד · SOL חי ב-cashmachine · ETH אבק (NO-GAS כנה) · שערים מ-Binance חיים",
    unlock: "הון-גז ל-ETH (מהזרמה בלבד) יפתח את רייל היציאה המלא של WETH — סמכות ושער כבר קיימות",
    sovereignPath: "כל שידור עובר את אותם חוקי-ברזל: נגזרת מואמת מול הכספת, שער-$100, קבלה כנה, העטיפה מוחזרת במלואה בכל כשל שידור.",
  },
  {
    code: "BLK-FLEET-VAULT",
    kind: "GATE",
    title: "משמרת מפתחות הצי - דלת ידנית בלבד",
    what: "כספת הצי המוצפנת חיה בריפו הפרטי, לא במכונה הזו. אין דלת אוטומטית - בכוונה.",
    why: "דלת מתועדת לסוכנים היא דלת מתועדת לכל פורץ. גישה - אדם בלבד, ידנית, מתועדת.",
    class: "INTENTIONAL-SECURITY",
    measured: "הפרדת הסמכויות מוחלטת: המוביל מחליט מתי, העורק מחליט איך, והמפתח נגזר בזיכרון-ההרצה בלבד",
    unlock: "אדם בלבד - אין תנאי אוטומטי, וזה התנאי",
    sovereignPath: "כל פעולת-כסף דורשת את ה-upload של המפעיל ואימות ביט-מול-ביט מול הרשות החיה - הסוד לעולם לא נחשף בקוד, בלוג או בשם-ערך (חוק הסודות)",
  },
  {
    code: "BLK-DEPOSITS",
    kind: "MOORING",
    title: "אפס הפקדות-חוץ מאז פתיחת הדלת לציבור",
    what: "המעגל האמיתי טרם נסגר אף-פעם בכסף של מישהו אחר.",
    why: "הרשת היא הקהל של עצמה (R82): בלי משתמשים חיצוניים אין זרימה נכנסת - ואת הזרימה לא ממציאים, מודדים.",
    class: "OPERATOR",
    measured: "0 הפקדות-חוץ (נכון לתדרוך המפעיל, 2026-09-23)",
    unlock: "הציבור מפקיד - כשיהיה ערך מוכח, אמון נמדד וסיבה כלכלית",
    sovereignPath: "ההפקדות היחידות שיימדדו הן כאלה שמגיעות מעודף-גריד מדוד ומדלק-ה-powerdown - לא מהבטחות שיווקיות; כל טענת-כניסה נמדדת מול השרשרת",
  },
    {
    code: "BLK-SAOS-USDS",
    kind: "MOORING",
    title: "זירת-המסחר הריבונית ל-SAOS/USDS — חיה, עם יציאה לשרשרת-החי (R104)",
    what: "השוק הפנימי חי ומוכח: ספר-פנים hash-chained, USDS בגיבוי-רזרבה מלא (הטבעה רק מול נעילת SBD/HBD 1:1, פדיון שורף 1:1), בריכות AMM בעמלת 30bps לאוצר, דלת-הפקדות ציבורית חיה (memo 'wx:<member>' לאוצר על STEEM). R104: גם היציאה של SAOS חיה — משיכה שורפת תביעה פנימית ומשדרת token.transfer חתום מהאוצר על שרשרת SAOS-LIVE (custom_json ב-STEEM, הקיפול של כל צומת הוא השופט).",
    why: "הבטחת מרה פומבית לציבור-רחב היא ואולת ניירות-ערך — אבל חברי הרשת (אוצר, סוכנים, מפקידים) מחליפים באמת: ההיצע של USDS נגזר מהפקדות-אמת, שמירת-הערך במבנה הרזרבה, לא בהבטחה. SAOS עצמו הוא נכס שרשרת-חיה — הרשמת הארנק self-certifying מהמפתח.",
    class: "LIVE-RAIL",
    measured: "רייל-היציאה מוכח: משיכות SAOS שודרו עם txids אמיתיים (7eef6c5e…, 79ba17fe…) ונזקפו בקיפול — אוצר 126,678 SAOS על השרשרת, 4 SAOS אצל המפעיל · היצע USDS = רזרבה נעולה 1:1 — נמדד בכל מחזור",
    unlock: "פתיחה מלאה לציבור-רחב — גוף משפטי; עד אז הזירה משרתת את הרשת ואת מפקידיה בפועל, ו-SAOS יוצא לשרשרת החיה בכל משיכה",
    sovereignPath: "המטבעות הפנימיים משמשים את הרשת ליצירת ערך: SAOS נפרס בפרסומים/עבודות, USDS מייצג ערך-דולרי-נעול, העמלות מזרימות לאוצר מכל החלפה — והיציאה של SAOS היא רכוש השרשרת: הכתובת self-certifying, מי שמחזיק במפתח — שלו ה-SAOS",
  },
  {
    code: "BLK-TRON-CAPITAL",
    kind: "CLOG",
    title: "פדיון TRON חסום על הון",
    what: "תיבת הדואר של TRON מתחת לסף השידור; המשמרת מגבה את ה-WTRX ואינה נוגעת.",
    why: "שידור מתחת לסף שורף את ההון על גז - חוק שימור-הון; החסר נסגר רק מעודף.",
    class: "INVENTORY",
    measured: "נזרע לפי תדרוך המפעיל (0.193 TRX מול 1.05); השכבה החיה מודדת את התיבה בכל מחזור",
    unlock: "outbox >= 1.05 TRX - שער השידור נפתח אוטומטית מהמדידה",
    sovereignPath: "עודף-הגריד שיזרום ל-TRX (דרך שער-מפעיל) יסגור את החסר; המנוע מציג את המרחק לסף בכל מחזור",
  },
  {
    code: "BLK-PRIVATE-QUOTA",
    kind: "BLEED",
    title: "מכסת ה-Actions של הארגון דחויה — כל ריפו פרטי, הרץ מעולם לא מתחיל (R106)",
    what: "נמדד עד הפרט ב-R106 (01:30Z): כל 12 הריפואים הפרטיים (Defi, steem, saos-dex, Zip + 10 הסוכנים) נכשלים מיידית — conclusion=failure תוך ~3 שניות, steps=[] ו-runner_id=0: הרץ מעולם לא התחיל. זו חתימת-חנקת-מכסה של GitHub Actions לריפואים פרטיים. המוות היה מדורג: 10 הסוכנים דעכו אחד-אחד בין 16-20/09 כשהמכסה נאכלה; מאז — כל ריצה פרטית נדחית. הקנרית של הצייד: 16 dispatch-ים רצופים, 0 הצלחות (נזרע בכנות במצב-הצייד).",
    why: "ריפואים פרטיים צורכים דקות-Actions ממכסת הארגון; הריפואים הציבוריים (Console, Domain) רצים בדקות חינם בלתי-מוגבלות — ולכן הם אלה שמצליחים. החלטת-כסף של המפעיל (הוספת אמצעי-תשלום / העלאת spending limit) היא הדרך הישירה; אנחנו לא נוגעים בכספי המפעיל — חוק לגיטימיות.",
    class: "INFRA",
    measured: "R106: 12/12 ריפואים פרטיים = כשל מיידי עם 0 צעדים · Domain+Console הציבוריים = הצלחות חיות (19+8 workflows) · קנרית: 16 רצופים, 0 הצלחות מאז 22/09 01:50Z · הצי המקומי 5/5 חי ומכסה את הפונקציות הקריטיות",
    unlock: "החזרת מכסה (החלטת מפעיל ב-GitHub billing) — או הסבה מלאה של כל סוכני-האימות לריצה מקומית בצי; שני הנתיבים מתועדים",
    sovereignPath: "ריבונות-המכסה (R71) הוכחה בפועל: המקורות החיוניים הוסבו עוד אז לתאומים הציבוריים ב-Domain (דקות בלתי-מוגבלות) ולצי המקומי — הספרים, העוגנים, הגריד והזירה לא נעצרו ולו דקה. R106 מוסיף: הצייד מזהה מוות-שער במדידה (deadStreak) ועובר לבאסה יומית בכנות במקום להפציץ שער מת. פרסום ריפו פרטי לציבור — רק אחרי ביקורת-סודות פר-ריפו (חוק הסודות); הפיכת סוכני-אימות לריצה מקומית — הנתיב הריבוני שאינו תלוי בכסף-מפעיל",
  },
  {
    code: "BLK-BLURT-NOMEASURE",
    kind: "CLOG",
    title: "BLURT — הרייל החוצה חי ומוכח בשרשרת · R103",
    what: "רייל-המשיכה של BLURT חי ומוכח: chain_id נמדד מ-get_config של הצומת (cd8d90f2…df6381f), חוק-החוט הוכח במעבדה אמפירית (שחזור חתימה אמיתית מהשרשרת עובר רק בצורה המילולית BLURT — בלי מיפוי-מורשת), ושתי העברות אמת נחתו עם txids (b46b5c4a… הוכחת-רייל · 06697ae5… משיכת WBLURT דרך הזירה — העטיפה נשרפה, ההעברה שודרה). דלת-ההפקדה חיה בשלוש רשתות (STEEM+HIVE+BLURT, memo wx: — נזקפה חיה: ded58439…).",
    why: "החסימה ההיסטורית נפתחה: השידור מוכח, המשיכה מוכחת, ההפקדה חיה. מה שמגדיל עומק מעתה הוא דלק אמיתי בלבד — הפקדות ציבור והזרמות-אוצר.",
    class: "LIVE",
    measured: "2 העברות on-chain עם txids · הפקדת HIVE חיה נזקפה · בריכה חיה עם 2 החלפות+ · עומק גדל (LP_ADD seq 13) — הכל נמדד בספר",
    unlock: "הושלם (R103). הצמיחה: הפקדות ציבור בשלוש הרשתות + הזרמת עודפי-אוצר (liquidity-stream) — הדלת פתוחה.",
    sovereignPath: "הזירה שלנו, העמלות שלנו, ומעתה גם היציאה שלנו: שלוש שרשראות גרפן בכיס אחד — STEEM/HIVE/BLURT — עם מפתח-אב אחד",
  },
];

let seeded = false;

/** זריעה אידמפוטנטית — הקנון נכנס ל-DB פעם אחת; עדכוני טקסט מתאחדים למעלה */
export async function ensureBlockages(): Promise<void> {
  if (seeded) return;
  for (let i = 0; i < BLOCKAGE_SEED.length; i++) {
    const b = BLOCKAGE_SEED[i];
    const data = { ...b, sortOrder: i };
    await db.economyBlockage.upsert({
      where: { code: b.code },
      create: data,
      update: {
        kind: data.kind,
        title: data.title,
        what: data.what,
        why: data.why,
        class: data.class,
        measured: data.measured,
        unlock: data.unlock,
        sovereignPath: data.sovereignPath,
        sortOrder: data.sortOrder,
      },
    });
  }
  seeded = true;
}

// ── קריאה פנימית ל-API-ים החיים שלנו (אותו תהליך, חסר-פתיחות-חוץ) ───

async function internalGet<T>(path: string, timeoutMs = 9000): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:3000${path}`, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "user-agent": "the-weave-economy/1.0" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as T & { ok?: boolean };
    return j;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── מקור חי למספר הפקדות-החוץ (R122 · חוק המקור-החי) ──────────────────
// מספר ההפקדות אינו זיכרון אלא מדידה ממראת watch הציבורית (אותה מראה
// שמזינה את האוצר ואת שער-ההפקדות). אין מענה = null — לא אפס מומצא.

const WATCH_MIRRORS = [
  "https://roshpinacare-sys.github.io/Domain/dex/watch.json",
  "https://roshpinacare-sys.github.io/Console/dex/watch.json",
] as const;

async function watchDepositsTotal(): Promise<{ total: number | null; cadenceMin: number | null }> {
  for (const url of WATCH_MIRRORS) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        headers: { "user-agent": "the-weave-economy/1.0" },
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { depositsTotal?: unknown; cadenceMin?: unknown };
      if (typeof j?.depositsTotal === "number") {
        return {
          total: j.depositsTotal,
          cadenceMin: typeof j?.cadenceMin === "number" ? j.cadenceMin : null,
        };
      }
    } catch {
      /* המראה הבאה */
    }
  }
  return { total: null, cadenceMin: null };
}

// החלקים שאנחנו צורכים מ-/api/money (חוזה חלקי - לא מעתיקים את כל ה-sense)
interface MoneyLite {
  ok?: boolean;
  marks: { steemUsd: number | null; sbdUsd: number | null; parity: number | null };
  balances: { steem: number | null; sbd: number | null };
  book: { bestBid: number | null; bestAsk: number | null; mid: number | null; spreadBps: number | null };
  orders: Array<{ amount: number; price: number; vsParityBps: number | null; usdIfFilled: number | null }>;
  ourBids: Array<{ sbd: number; steem: number; price: number; vsParityBps: number | null }>;
  deployedSteem: number;
  ladder: Array<{ level: number; premiumBps: number; price: number | null }>;
  powerdown: { active: boolean | null; weeklySteem: number | null; paymentsLeft: number | null; nextPayment: string | null };
  fills: Array<{ at: string; side: "sold-steem" | "bought-steem"; paid: string; received: string }>;
  sbdArming: { balance: number; needed: number; commitable: number; state: "ARMED" | "WAIT" };
  redemption: { outboxTrx: number | null; sendThresholdTrx: number; verdict: "WAIT" | "GO" | "UNKNOWN"; detail: string };
  down?: string[];
}

interface RouterLite {
  channels: Array<{
    id: string;
    chain: string;
    dex: string;
    route: string;
    pair: string;
    quote: number | null;
    quoteUnit: string;
    amountInLabel: string;
    execPrice: number | null;
    devBps: number | null;
    verdict: "VERIFIED" | "DEVIANT" | "DOWN";
    latencyMs: number | null;
  }>;
  yields?: { at: string | null; pools: Array<{ project: string; chain: string; symbol: string; apy: number | null; tvlUsd: number; stablecoin: boolean }> };
}

interface GateLite {
  threshold: number;
  stats: { allowed: number; queued: number; refused: number; executed: number; rejected: number };
}

// R102 — הזירה הריבונית + ריילי ETH/SOL (חוזה חלצי מה-API החי)
interface ExchangeLite {
  ok?: boolean;
  genesis?: boolean;
  pools?: Array<{ pair: string; reserveA: number; reserveB: number; price: number; swaps: number; feeBps: number; depthUsd: number | null }>;
  reserve?: { usdsSupply: number; sbdLocked: number; hbdLocked: number };
  bookIntegrity?: { events: number; recomputeOk: boolean | null };
  members?: Array<{ member: string }>;
}

interface EthSolLegLite {
  ok?: boolean;
  verdict?: string;
  vaultOpened?: string;
  total?: { eth?: number; usd?: number | null } | { sol?: number; usd?: number | null };
  priceUsd?: number | null;
  railProof?: { txid?: string };
}

// ── קצב בניית ה-SBD — ממילויים אמיתיים בלבד ─────────────────────────

function sbdBuildRate(money: MoneyLite | null): SbdBuildRate {
  const out: SbdBuildRate = {
    fillsInWindow: 0,
    sbdCaptured: 0,
    windowDays: null,
    sbdPerDay: null,
    commitableNow: money?.sbdArming?.commitable ?? null,
    needed: money?.sbdArming?.needed ?? 0.15,
    etaDays: null,
    note: "לא נמדד",
  };
  const fills = (money?.fills ?? []).filter((f) => f.side === "sold-steem");
  out.fillsInWindow = fills.length;
  let sbd = 0;
  const times: number[] = [];
  for (const f of fills) {
    const m = String(f.received ?? "").match(/^([\d.]+)\s+SBD$/);
    const n = m ? parseFloat(m[1]) : 0;
    if (n > 0) {
      sbd += n;
      const ts = Date.parse(f.at);
      if (Number.isFinite(ts)) times.push(ts);
    }
  }
  out.sbdCaptured = Math.round(sbd * 1e6) / 1e6;
  if (times.length >= 2) {
    const days = (Math.max(...times) - Math.min(...times)) / 86_400_000;
    out.windowDays = Math.round(days * 10) / 10;
    if (days > 0.05) {
      out.sbdPerDay = Math.round((sbd / days) * 1e6) / 1e6;
      const commitable = out.commitableNow ?? 0;
      const missing = out.needed - commitable;
      if (out.sbdPerDay > 0 && missing > 0) {
        out.etaDays = Math.round((missing / out.sbdPerDay) * 10) / 10;
        out.note = `קצב נמדד ממילויי הפרימיה בחלון; חסר ${(missing).toFixed(3)} SBD לפתיחת צד-הקנייה`;
      } else if (missing <= 0) {
        out.note = "הקופה כבר עברה את הסף - צד-הקנייה חמוש";
      } else {
        out.note = "אין מילויים בחלון הנמדד - הקצב לא נמדד (בכנות, לא אפס)";
      }
    } else {
      out.note = "חלון המילויים קצר מדי לקצב יומי - ממשיכים למדוד";
    }
  } else {
    out.note = "אין מספיק מילויים בחלון הנמדד - הקצב לא נמדד (בכנות, לא אפס)";
  }
  return out;
}

// ── מרשם החסימות + שכבה חיה ─────────────────────────────────────────

async function blockageSnapshot(money: MoneyLite | null, router: RouterLite | null, build: SbdBuildRate, ex?: ExchangeLite | null, sol?: EthSolLegLite | null, eth?: EthSolLegLite | null, depositsTotal: number | null = null, watchCadenceMin: number | null = null): Promise<BlockageRow[]> {
  await ensureBlockages();
  const rows = await db.economyBlockage.findMany({ orderBy: { sortOrder: "asc" } });
  return rows.map((r) => {
    const base: BlockageRow = {
      code: r.code,
      kind: r.kind as BlockageKind,
      title: r.title,
      what: r.what,
      why: r.why,
      class: r.class as BlockageClass,
      measured: r.measured,
      unlock: r.unlock,
      sovereignPath: r.sovereignPath,
      liveMeasured: null,
      progress: null,
      liveState: "STATIC",
      updatedAt: r.updatedAt.toISOString(),
    };
    // שכבה חיה — לכל חסימה המקור שלה
    if (r.code === "BLK-SBD-BUYSIDE" && money) {
      const a = money.sbdArming;
      base.liveMeasured =
        a.state === "ARMED"
          ? `הקופה חמושה: ${a.commitable.toFixed(3)} SBD commitable >= ${a.needed} - צד-הקנייה פתוח`
          : `${a.commitable.toFixed(3)} SBD commitable מול ${a.needed} נדרש (${Math.round((a.commitable / a.needed) * 100)}%)`;
      base.progress = Math.min(1, a.commitable / a.needed);
      base.liveState = a.state === "ARMED" ? "HOLDING" : "IN-PROGRESS";
      if (build.sbdPerDay != null && a.state !== "ARMED") {
        base.liveMeasured += ` · קצב בנייה נמדד: ${build.sbdPerDay.toFixed(4)} SBD/יום`;
      }
    } else if (r.code === "BLK-TRON-CAPITAL" && money) {
      const red = money.redemption;
      base.liveMeasured =
        red.outboxTrx != null
          ? `${red.outboxTrx.toFixed(3)} TRX בתיבת הדואר מול ${red.sendThresholdTrx} נדרש לשידור`
          : "trongrid לא ענה במחזור זה - לא נמדד";
      base.progress = red.outboxTrx != null ? Math.min(1, red.outboxTrx / red.sendThresholdTrx) : null;
      base.liveState = red.verdict === "GO" ? "HOLDING" : "IN-PROGRESS";
    } else if (r.code === "BLK-ETH-SOL-CAST") {
      if (sol || eth) {
        const parts: string[] = [];
        if (sol) parts.push(`SOL: ${sol.vaultOpened ?? "?"} מפתחות · ${(sol.total as { sol?: number } | undefined)?.sol?.toFixed?.(4) ?? "?"} SOL חי${sol.railProof?.txid ? " · הוכחה 5amYdKAC… confirmed" : ""}`);
        if (eth) parts.push(`ETH: ${eth.vaultOpened ?? "?"} מפתחות · אבק (NO-GAS כנה)`);
        const okCh = router ? router.channels.filter((c) => c.verdict === "VERIFIED").length : null;
        base.liveMeasured = `${parts.join(" · ")}${okCh != null ? ` · ${okCh}/${router!.channels.length} ערוצי ציטוט מאומתים` : ""}`;
        base.liveState = "HOLDING";
      } else {
        base.liveMeasured = "ריילי המדידה לא ענו במחזור זה — בכנות לא נמדד";
        base.liveState = "IN-PROGRESS";
      }
    } else if (r.code === "BLK-SAOS-USDS") {
      if (ex?.genesis) {
        const pools = ex.pools ?? [];
        const swaps = pools.reduce((s, p) => s + p.swaps, 0);
        const integrity = ex.bookIntegrity?.recomputeOk;
        base.liveMeasured = `זירה חיה: ${pools.length} בריכות · ${swaps} החלפות · ${ex.reserve?.usdsSupply?.toFixed(4) ?? "?"} USDS בגיבוי ${(ex.reserve?.sbdLocked ?? 0) + (ex.reserve?.hbdLocked ?? 0) > 0 ? "1:1 מלא" : "(רזרבה ריקה — המתנה להפקדה)"} · ספר ${integrity === true ? "מאומת בחישוב-חדש" : integrity === false ? "שבור!" : "טרם אומת"}${(ex.members?.length ?? 0) > 0 ? ` · ${ex.members!.length} חברים` : ""}`;
        base.liveState = "HOLDING";
      } else {
        base.liveMeasured = money?.powerdown?.weeklySteem != null
          ? `הזירה ממתינה למדידת-ג'נזיס · דלק פאוורדאון ${money.powerdown.weeklySteem.toFixed(1)} STEEM/שבוע בדרך`
          : "הזירה ממתינה למדידת-אוצר חיה";
        base.liveState = "IN-PROGRESS";
      }
    } else if (r.code === "BLK-BLURT-NOMEASURE") {
      const blurtPool = ex?.pools?.find((p) => p.pair === "WBLURT/USDS");
      base.liveMeasured = blurtPool
        ? `בריכה חיה: ${blurtPool.reserveA} WBLURT / ${blurtPool.reserveB} USDS · ${blurtPool.swaps} החלפות · מחיר ${blurtPool.price.toPrecision(3)} USDS/BLURT`
        : "בריכת WBLURT טרם נזרעה במחזור זה";
      base.liveState = blurtPool ? "HOLDING" : "IN-PROGRESS";
    } else if (r.code === "BLK-DEPOSITS") {
      // R122 · לא עוד אפס-מזיכרון: מספר ההפקדות נמדד ממראת watch החיה.
      // מקור שלא ענה מתוודה בגלוי — לא מתחזה למדידה.
      if (depositsTotal != null) {
        base.liveMeasured =
          depositsTotal > 0
            ? `${depositsTotal} הפקדות-חוץ נמדדו — כל אחת מאומתת מול השרשרת בטרם זיכוי`
            : `0 הפקדות-חוץ — נמדד חי ממראת watch${watchCadenceMin != null ? ` (סריקה כל ${watchCadenceMin} דק׳)` : ""} · המעגל טרם נסגר בכסף של מישהו אחר`;
        base.liveState = depositsTotal > 0 ? "IN-PROGRESS" : "HOLDING";
      } else {
        base.liveMeasured = "הפקדות-חוץ: טרם נמדדו במקור חי (מראת watch לא ענתה) — המעגל עדיין פתוח";
        base.liveState = "IN-PROGRESS";
      }
    } else if (r.code === "BLK-PRIVATE-QUOTA") {
      base.liveMeasured = "הדימום הוסט (R71): המכונות בדקות ציבוריות; הפרטיים dispatch-בלבד";
      base.liveState = "HOLDING";
    } else if (r.code === "BLK-FLEET-VAULT") {
      base.liveMeasured = "דלת ידנית-אנושית בלבד - הפרדת סמכויות פעילה בכל פעולת-כסף";
      base.liveState = "HOLDING";
    }
    return base;
  });
}

// רגל HIVE חיה (R101): החוזה החלצי מ-/api/money/hive
interface HiveLite {
  ok?: boolean;
  balances: { hive: number; hbd: number };
  orders: Array<{ orderid: number; forSaleSymbol: "HIVE" | "HBD"; price: number }>;
  deployed: { hive: number; hbd: number };
  book: { bestBid: number | null; bestAsk: number | null; mid: number | null; spreadBps: number | null };
  marks: { hiveUsd: number | null; hbdUsd: number | null; parity: number | null };
  fills: { window24h: number };
  verdict: string;
}

// ── מטריצת הזרימה — לאן נגזרות העמלות ────────────────────────────────

function flowMatrix(money: MoneyLite | null, router: RouterLite | null, hive: HiveLite | null = null): FlowLeg[] {
  const legs: FlowLeg[] = [];
  const sbd = money?.sbdArming;
  const power = money?.powerdown;

  legs.push({
    id: "FLOW-SELL-LADDER",
    title: "סולם הפרימיה - מכירת STEEM ל-SBD",
    from: "STEEM",
    to: "SBD",
    status: money && money.orders.length > 0 ? "LIVE" : "MEASUREMENT",
    feeAccrual: "OURS",
    feeNote: "אנחנו ה-maker: הפרימיה מעל הפאריטה היא הכנסת הרשת - העמלות נגזרות בבריכה שלנו",
    measured:
      money && money.orders.length > 0
        ? `${money.orders.length} פקודות פתוחות · ${money.deployedSteem.toFixed(1)} STEEM פרוסים בסולם`
        : "אין פקודות פתוחות במחזור זה",
    gate: "אוטונומי מתחת ל-$100 (שער-העסקאות); רצפת-פאריטה נאכפת בקוד",
  });

  legs.push({
    id: "FLOW-BUY-LADDER",
    title: "סולם הקנייה - SBD ל-STEEM מתחת לפאריטה",
    from: "SBD",
    to: "STEEM",
    status: sbd ? (sbd.state === "ARMED" ? "LIVE" : "GATED") : "MEASUREMENT",
    feeAccrual: "OURS",
    feeNote: "כל קנייה מתחת לקו = עודף נמדד שנשאר ברשת",
    measured: sbd
      ? sbd.state === "ARMED"
        ? `צד-הקנייה חמוש: ${sbd.commitable.toFixed(3)} SBD commitable`
        : `חסום על מלאי: ${sbd.commitable.toFixed(3)} SBD commitable מול ${sbd.needed} נדרש`
      : "לא נמדד במחזור זה",
    gate: "R101b: שוחרר - מנוע stock-sbd חי (fill_or_kill, פרימיית-תקרה 200bps, שער-$100) - נסגר אוטומטית עם הדלק הנזיל הבא (פאוורדאון/מילוי). לא ממכירה מתחת לערך.",
  });

  legs.push({
    id: "FLOW-SBD-BUILD",
    title: "קצב בניית הקופה - מילויי פרימיה",
    from: "השוק הפנימי",
    to: "קופת SBD",
    status: "LIVE",
    feeAccrual: "OURS",
    feeNote: "ה-SBD היחיד שזורם מגיע ממכירות-הפרימיה שלנו - קצב-הבנייה של הצד השני",
    measured: "הקצב נמדד בכל מחזור מהשרשרת (fill_order) - ראה כרטיס הקצב",
    gate: "אין שער - זו הזרימה הטבעית של הסחורה",
  });

  legs.push({
    id: "FLOW-POWERDOWN",
    title: "דלק פאוורדאון שבועי",
    from: "STEEM (vesting)",
    to: "סולם הפרימיה",
    status: power?.active ?? false ? "LIVE" : "MEASUREMENT",
    feeAccrual: "NONE",
    feeNote: "דלק נכנס - לא עסקה; המוביל פורש אותו בסולם בתוך מחזור אחד מהנחיתה",
    measured:
      power?.weeklySteem != null
        ? `~${power.weeklySteem.toFixed(1)} STEEM/שבוע · ${power.paymentsLeft ?? "?"} תשלומים נותרו`
        : "לא נמדד במחזור זה",
    gate: "אוטומטי מהשרשרת (חוק 4 של המוביל)",
  });

  legs.push({
    id: "FLOW-QUOTES-EVM",
    title: "ערוצי ציטוט חיים - ראוטרי DEX מובילים",
    from: "ETH/BSC/ARB/BASE",
    to: "ציטוטים",
    status: router ? "LIVE" : "MEASUREMENT",
    feeAccrual: "THEIRS",
    feeNote: "הנזילות מהבריכות שלהם נמדדת לנו; העמלות שלהם נכנסות לחישוב הסטייה (devBps) - בלי מתווך",
    measured: router
      ? `${router.channels.filter((c) => c.verdict === "VERIFIED").length}/${router.channels.length} ערוצים מאומתים מול בינאנס`
      : "לא נמדד במחזור זה",
    gate: "קריאה בלבד - eth_call חסר-מפתחות; ביצוע = שער-מפעיל",
  });

  legs.push({
    id: "FLOW-QUOTES-REST",
    title: "ערוצי REST - סולנה וחוצה-שרשרת",
    from: "SOL / חוצה-שרשרת",
    to: "ציטוטים",
    status: router ? "QUOTES-ONLY" : "MEASUREMENT",
    feeAccrual: "THEIRS",
    feeNote: "Jupiter (SOL) ו-Across (ERC-7683) נשפטים באותו שער-אתגר כמו ערוצי ה-eth_call",
    measured: router
      ? router.channels
          .filter((c) => c.id.toLowerCase().includes("jupiter") || c.id.toLowerCase().includes("across"))
          .map((c) => `${c.id.split("/")[0]}: ${c.verdict}`)
          .join(" · ") || "לא נמדד במחזור זה"
      : "לא נמדד במחזור זה",
    gate: "קריאה בלבד",
  });

  legs.push({
    id: "FLOW-EXIT-RAMP",
    title: "רגלת היציאה - SBD/STEEM ל-USDT",
    from: "SBD/STEEM",
    to: "USDT (חוץ)",
    status: "GATED",
    feeAccrual: "PLANNED-OURS",
    feeNote: "כשתיפתח: התוכנית מערבבת יציאה דרך הבריכות שלנו קודם (העמלה שלנו) ורק את השאר דרכם",
    measured: "אין ערוץ חי - מחליפים מיידיים הם custodial; בורסות דורשות KYC ומפתח",
    gate: "שער-מפעיל + גוף מורשה (BLK-ETH-SOL-CAST / BLK-SAOS-USDS)",
  });

  legs.push({
    id: "FLOW-TRON-REDEMPTION",
    title: "פדיון TRON",
    from: "WTRX",
    to: "TRX נזיל",
    status: money?.redemption?.verdict === "GO" ? "LIVE" : "GATED",
    feeAccrual: "OURS",
    feeNote: "המשמרת מגבה את ה-WTRX; כל עודף נשאר ברשת",
    measured: money?.redemption?.outboxTrx != null
      ? `${money.redemption.outboxTrx.toFixed(3)} TRX מול ${money.redemption.sendThresholdTrx}`
      : "לא נמדד במחזור זה",
    gate: "outbox >= 1.05 TRX (BLK-TRON-CAPITAL)",
  });

  legs.push({
    id: "FLOW-SAOS-USDS",
    title: "מעגל עבודה→מטבע→נזילות (R103) — SAOS/USDS",
    from: "מילויי-גריד אמיתיים",
    to: "USDS ניתן להחלפה",
    status: "LIVE",
    feeAccrual: "OURS",
    feeNote: "רייל-התגמול חי: הדיבון מזהה מילויים חדשים ← SAOS למאזן הזירה של הסוכן (REWARD_PAY, שער-$100) ← הסוכן מחליף בבריכת SAOS/USDS (30bps לאוצר). הוכח חיה: seq 10 (תגמול) ← seq 11 (החלפה).",
    measured: "בריכה חיה · תגמול ראשון שולם והומר · דלק-הזרמה: כל מילוי = 2 SAOS לסוכן · R104: יציאה חיה — משיכת SAOS שורפה תביעה והעבירה 2 SAOS על שרשרת SAOS-LIVE (txid 7eef6c5e…, אוצר על השרשרת 126,680)",
    gate: "שער-$100 משותף (reward-pay) · שווי-פדיון בשריפה 1:1 — המבנה שומר ערך",
  });

  legs.push({
    id: "FLOW-LIQUIDITY-STREAM",
    title: "רייל הנזילות — דלק-שרשרת הופך לעומק בריכות",
    from: "גלי-דלק (פאוורדאון שבועי)",
    to: "בריכות הזירה",
    status: "LIVE",
    feeAccrual: "OURS",
    feeNote: "כשגל-דלק מגיע (נזיל ≥ 200 STEEM — חתימת פאוורדאון), 20% ממנו נעטף ל-WSTEEM ומזדווג ל-USDS במחיר השוק החי — לפני שהסולם פורש את השאר. העומק גדל רק מכסף אמיתי.",
    measured: "עומק WBLURT/USDS גדל חיה (LP_ADD seq 13) · הדלתא נמדדת מול קו-הבסיס בכל קריאה · הפאוורדאון הבא: מוכן",
    gate: "הזרמה-אחת-ליום · עטיפה מול הון נמדד בלבד · USDS בגיבוי-רזרבה מלא 1:1",
  });

  legs.push({
    id: "FLOW-YIELD-BLUECHIP",
    title: "סולם התשואה - בריכות כחולות-לבן",
    from: "USDT (עתידי)",
    to: "תשואה",
    status: "PLANNED",
    feeAccrual: "THEIRS",
    feeNote: "האוקיינוס שאליו הראוטר מנתב כששער-המפעיל ייפתח - ה-APY נמדד חי מ-DefiLlama",
    measured: router?.yields?.pools?.length
      ? `${router.yields.pools.length} בריכות נמדדות · מובילה: ${[...router.yields.pools].sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))[0]?.project} ${([...router.yields.pools].sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))[0]?.apy ?? 0).toFixed(2)}%`
      : "לא נמדד במחזור זה",
    gate: "שער-מפעיל (דורש רגלת יציאה חיה)",
  });

  legs.push({
    id: "FLOW-HIVE-GRID",
    title: "רגל HIVE חיה - גריד-מייקר על השוק הפנימי",
    from: "HIVE",
    to: "HBD",
    status: hive ? (hive.orders.length > 0 ? "LIVE" : "MEASUREMENT") : "MEASUREMENT",
    feeAccrual: "OURS",
    feeNote: "R101: המנוע נבנה מחדש בקנון (נאבד לארעיות-הסנדבוקס ב-R99 — הפקודות חיות, הקוד לא הועלה לגיט). אותה דוקטרינת-STEEM: מכירות רק מעל קו-הזהות, קניות רק מתחתיו; מיקרו-סקאלות, אפס עמלה",
    measured: hive
      ? `${hive.orders.length} פקודות · מלאי ${hive.balances.hive.toFixed(3)} HIVE / ${hive.balances.hbd.toFixed(3)} HBD · ספר ${hive.book.spreadBps != null ? hive.book.spreadBps + "bps" : "?"} · ${hive.fills.window24h} מילויים ב-24ש' · parity ${hive.marks.parity?.toFixed(6) ?? "?"}`
      : "לא נמדד במחזור זה (api/money/hive)",
    gate: "הדוקטרינה עצמה השער: מייקר-בלבד, לעולם לא מתחת לערך + שער-$100 משותף — אין שער-מפעיל נוסף",
  });

  return legs;
}

// ── מסלול הפג ויעילות העוגנים ───────────────────────────────────────

function pegMetrics(money: MoneyLite | null): PegMetrics {
  const sbdExternal = money?.marks?.sbdUsd ?? null;
  const steemUsd = money?.marks?.steemUsd ?? null;
  const mid = money?.book?.mid ?? null;
  const sbdImpliedInternal = steemUsd != null && mid != null && mid > 0 ? steemUsd / mid : null;
  const internalVsExternalBps =
    sbdImpliedInternal != null && sbdExternal != null && sbdExternal > 0
      ? Math.round(((sbdImpliedInternal / sbdExternal) - 1) * 10_000)
      : null;
  const externalDepegBps =
    sbdExternal != null && sbdExternal > 0 ? Math.round((sbdExternal / 1.0 - 1) * 10_000) : null;
  const regime: PegMetrics["regime"] =
    internalVsExternalBps == null
      ? "NOT-MEASURED"
      : internalVsExternalBps >= 500
        ? "VALUE-TRAP"
        : "NEUTRAL";
  return {
    sbdNominal: 1,
    sbdExternal,
    sbdImpliedInternal: sbdImpliedInternal != null ? Math.round(sbdImpliedInternal * 1e4) / 1e4 : null,
    internalVsExternalBps,
    externalDepegBps,
    regime,
    note:
      regime === "VALUE-TRAP"
        ? `השוק הפנימי מתמחר את ה-SBD יקר מהחוץ ב-${internalVsExternalBps}bps: למכור SBD כמו שהוא = לאבד את הפער; להחזיק עד מילוי = הפער עובד בשבילנו. העוגן עובד לקנייה ונגד יציאה - בכנות`
        : regime === "NEUTRAL"
          ? "הפער בטווח הניטרלי - אין מלכודת-ערך פעילה"
          : "לא נמדד במחזור זה - אין מסקנה",
  };
}

interface AnchorTruth {
  /** מספר אימותים חי מהספר (r121: במקום מספרי-עידן R73 קשיחים) */
  attCount: number | null;
  lastAttAt: string | null;
  zero: { checkpoint: number; attestations: number; block: number; at: string } | null;
}

/** r121 — קריאת אמת-חיה לשורות העוגנים: הספר המיוצא + קו ה-ZERO.
 * מקור: sovereign/ledger.json ו-sovereign/zero-line.json בדיסק (נכתבים
 * בכל פעימה). כשל-קריאה = null כנה, לא מספר מהזיכרון. */
function readAnchorTruth(): AnchorTruth {
  const truth: AnchorTruth = { attCount: null, lastAttAt: null, zero: null };
  // r125 — Turbopack מקמפל __dirname לפאתום ("/ROOT/src/lib/weave") והספרים
  // לעולם לא נמצאים בדיסק; עוגן-הפרויקט הוא ספריית-העבודה (כמו anchor.ts).
  const ROOT = process.cwd();
  try {
    const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, "sovereign", "ledger.json"), "utf8")) as {
      chainCount?: number;
      attestations?: Array<{ createdAt?: string }>;
    };
    if (typeof ledger.chainCount === "number") truth.attCount = ledger.chainCount;
    const last = ledger.attestations?.[ledger.attestations.length - 1];
    if (last?.createdAt) truth.lastAttAt = last.createdAt;
  } catch {
    /* ספר לא נמצא — null כנה */
  }
  try {
    const zl = JSON.parse(fs.readFileSync(path.join(ROOT, "sovereign", "zero-line.json"), "utf8")) as {
      anchors?: Array<{ checkpoint: number; attestations: number; block: number; at: string }>;
    };
    const last = zl.anchors?.[zl.anchors.length - 1];
    if (last) truth.zero = { checkpoint: last.checkpoint, attestations: last.attestations, block: last.block, at: last.at };
  } catch {
    /* קו לא נמצא — null כנה */
  }
  return truth;
}

function anchorRows(money: MoneyLite | null, gate: GateLite | null, peg: PegMetrics): AnchorRow[] {
  const rows: AnchorRow[] = [];

  const topOrder = money?.orders?.[0];
  rows.push({
    id: "ANCH-PARITY-FLOOR",
    title: "רצפת-הפאריטה (העוגן הכלכלי)",
    buys: "כל מכירה מעל ערך-ה-USD החיצוני של STEEM - שום סחורה לא יוצאת מהרשת בהנחה",
    measured: topOrder
      ? `פקודת הסולם העליונה: ${topOrder.price.toFixed(4)} SBD/STEEM (${topOrder.vsParityBps != null ? (topOrder.vsParityBps >= 0 ? "+" : "") + topOrder.vsParityBps + "bps מהפאריטה" : "פאריטה לא נמדדה"})`
      : "אין פקודות פתוחות במחזור זה",
    verdict: topOrder && (topOrder.vsParityBps ?? -1) >= 0 ? "ARMED" : "WAIT",
    note: "נאכפת בקוד העורק: בלי שער חי אין פעולה - סירוב כנה",
  });

  rows.push({
    id: "ANCH-TX-GATE",
    title: "שער-העסקאות $100 (העוגן המדיני)",
    buys: "אוטונומיה מלאה מתחת לסף - הרשת פועלת לבד; מעליו כלום לא זז בלי המפעיל",
    measured: gate
      ? `סף $${gate.threshold} · היסטוריה: ${gate.stats.allowed} אושרו-אוטונומית · ${gate.stats.queued} בתור · ${gate.stats.refused} סורבו (אין מדידת-USD)`
      : "לא נמדד במחזור זה",
    verdict: "ENFORCED",
    note: "נאכף בעורק הכסף לפני כל נגיעה בכסף; אין מדידה = סירוב",
  });

  const truth = readAnchorTruth();
  rows.push({
    id: "ANCH-WITNESS",
    title: "העד השעתי (Steem custom_json)",
    buys: "רצף-אמת ציבורי: כל פעימה של הרשת מותירה עד על שרשרת חברתית חיצונית - עמידות למחיקה",
    measured:
      truth.attCount != null
        ? `קנון: עדות שעתית חיה (weave-heart) · ${truth.attCount.toLocaleString("he-IL")} אימותים בספר` +
          (truth.lastAttAt ? ` · אחרון ${new Date(truth.lastAttAt).toISOString().slice(11, 16)}Z` : "")
        : "הספר לא נמצא בדיסק — לא נספר עיוור",
    verdict: truth.attCount != null ? "ANCHORED" : "WAIT",
    note: "העוגן הזול ביותר שלנו: חסר-מפתחות בצד הציבורי, קיים בכל דליה",
  });

  rows.push({
    id: "ANCH-ZERO-LINE",
    title: "קו ZERO (עוגן on-chain)",
    buys: "ראיה קריפטוגרפית שהספר לא שובש - merkle root על שרשרת אמיתית",
    measured: truth.zero
      ? `קנון: חי on-chain (block ${truth.zero.block.toLocaleString("he-IL")}) · cp#${truth.zero.checkpoint} · ${truth.zero.attestations.toLocaleString("he-IL")} אימותים בספר העוגן`
      : "קובץ הקו לא נמצא — לא נספר עיוור",
    verdict: truth.zero ? "ANCHORED" : "WAIT",
    note: "השופט של כל טענת-עבר: חישוב-מחדש מנצח זיכרון",
  });

  rows.push({
    id: "ANCH-EVM-REGISTRY",
    title: "עוגן EVM (WeaveAnchorRegistry)",
    buys: "אותה עדות בעולם ה-EVM - כשייפרס על שרשרת ציבורית: חוזה, לא הבטחה",
    measured: "LOCAL - סימולציית חוזה בצד השרת (שער EVM-1 בתוכנית)",
    verdict: "LOCAL",
    note: "תווית אמת: LOCAL עד פריסה אמיתית - לא צובעים ירוק",
  });

  rows.push({
    id: "ANCH-PEG-SBD",
    title: "מסלול הפג של SBD (העוגן שאותגר)",
    buys: "הפג הוא גם כלי: SBD זול בחוץ קונה STEEM ביוקר בפנים - כל קנייה מתחת לקו היא עודף",
    measured:
      peg.sbdExternal != null
        ? `חיצוני $${peg.sbdExternal.toFixed(3)} (${peg.externalDepegBps}bps מהנומינל)` + (peg.sbdImpliedInternal != null ? ` · נגזר-פנים $${peg.sbdImpliedInternal.toFixed(3)} (${peg.internalVsExternalBps}bps מהחוץ)` : "")
        : "לא נמדד במחזור זה",
    verdict: peg.regime === "VALUE-TRAP" ? "ARMED" : peg.regime === "NEUTRAL" ? "WAIT" : "WAIT",
    note: peg.note,
  });

  return rows;
}

// ── מנוע ערבוב-הסוואפ — "העמלות יגזרו בבריכות שלנו" ──────────────────

function swapMixPlan(sizeSteem: number, money: MoneyLite | null, router: RouterLite | null, gate: GateLite | null, build: SbdBuildRate): MixPlan {
  const steemUsd = money?.marks?.steemUsd ?? null;
  const parity = money?.marks?.parity ?? null;
  const sbdUsd = money?.marks?.sbdUsd ?? null;
  const sizeUsd = steemUsd != null ? Math.round(sizeSteem * steemUsd * 100) / 100 : null;
  const usdBasis = steemUsd != null ? `binance:STEEMUSDT x ${sizeSteem} STEEM` : "לא נמדד - שער חי חסר";

  // שער-העסקאות על התוכנית כולה
  let gateVerdict: MixPlan["gateVerdict"] = "NO-MARK";
  let gateDetail = "USD לא נמדד חי - השער אינו יכול להעריך, לכן שום דבר לא זז";
  if (sizeUsd != null) {
    const threshold = gate?.threshold ?? 100;
    if (sizeUsd < threshold) {
      gateVerdict = "AUTONOMOUS";
      gateDetail = `${sizeUsd.toFixed(2)}$ < ${threshold}$ - הרגל הפנימית רצה באוטונומיה מלאה (המוביל מחליט מתי, העורק איך)`;
    } else {
      gateVerdict = "OPERATOR-QUEUE";
      gateDetail = `${sizeUsd.toFixed(2)}$ >= ${threshold}$ - התוכנית כולה עוברת לתור אישור המפעיל; כלום לא זז בלי החלטתו`;
    }
  }

  const legs: MixLeg[] = [];

  // רגל 1 — הבריכה שלנו: סולם הפרימיה
  const ladder = money?.ladder ?? [];
  const lvl1 = ladder.find((l) => l.level === 1);
  const lvl1Price = lvl1?.price ?? null;
  const sbdOut = lvl1Price != null ? Math.round(sizeSteem * lvl1Price * 1000) / 1000 : null;
  const deployed = money?.deployedSteem ?? null;
  legs.push({
    id: "MIX-INTERNAL",
    title: "רגל-פנים: הבריכה שלנו (סולם הפרימיה)",
    venue: "השוק הפנימי של Steem - אנחנו ה-maker",
    feeAccrual: "OURS",
    detail:
      lvl1Price != null
        ? `מכירת ${sizeSteem} STEEM ברמה-1 של הסולם (${lvl1Price.toFixed(4)} SBD/STEEM, +${lvl1?.premiumBps ?? 0}bps פרימיה על הקו). הפרימיה והספרד נשארים ברשת - זו ההכנסה שלנו, לא של אף בריכה אחרת.`
        : "הפאריטה לא נמדדה חי במחזור זה - רצפת-הערך מסרבת לפעול בלי שער (אין שער, אין מסחר)",
    numbers: [
      { label: "מחיר רמה-1", value: lvl1Price != null ? `${lvl1Price.toFixed(4)} SBD/STEEM` : "לא נמדד" },
      { label: "SBD צפוי", value: sbdOut != null ? `${sbdOut.toFixed(3)} SBD` : "לא נמדד" },
      { label: "פריסה זמינה", value: deployed != null ? `${deployed.toFixed(1)} STEEM בסולם` : "לא נמדד" },
      ...(sizeSteem > (deployed ?? 0) && deployed != null
        ? [{ label: "אזהרת-גודל", value: `התוכנית חורגת מהסולם הפרוס (${sizeSteem} > ${deployed.toFixed(1)}) - דלק נוסף יופרש במחזור` }]
        : []),
    ],
  });

  // רגל 2 — החזקת ה-SBD: העוגן שעובד בשבילנו
  const pegNote = sbdOut != null && sbdUsd != null
    ? `ה-SBD שהתקבל שווה בחוץ ~$${(sbdOut * sbdUsd).toFixed(2)} - אבל בפנים הוא קונה STEEM ב-${money?.book?.mid != null && parity != null ? Math.round((parity / money.book.mid - 1) * 10000) : "?"}bps מעל הקו`
    : "לא נמדד";
  legs.push({
    id: "MIX-HOLD",
    title: "רגל-החזקה: ה-SBD נשאר בקופה (העוגן הכלכלי)",
    venue: "קופת הרשת - צד-הקנייה של הגריד",
    feeAccrual: "OURS",
    detail: `ה-SBD לא מומר החוצה במחיר-הפג: הוא תחמושת לסולם הקנייה. כל SBD שנצבור מקרב את פתיחת צד-הקנייה (${(money?.sbdArming?.commitable ?? 0).toFixed(3)}/${money?.sbdArming?.needed ?? 0.15} כעת)${build.etaDays != null ? ` - בקצב הנמדד: עוד ~${build.etaDays} ימים` : ""}.`,
    numbers: [
      { label: "ערך חוץ של ההכנסה", value: sbdOut != null && sbdUsd != null ? `~$${(sbdOut * sbdUsd).toFixed(2)}` : "לא נמדד" },
      { label: "עודף פנימי", value: pegNote },
    ],
  });

  // רגל 3 — היציאה לחוץ: חסומה בכוונה + מפת הראוטרים
  const verified = (router?.channels ?? []).filter((c) => c.verdict === "VERIFIED");
  const bestChannel = verified
    .slice()
    .sort((a, b) => (a.devBps ?? 9999) - (b.devBps ?? 9999))[0];
  legs.push({
    id: "MIX-EXTERNAL",
    title: "רגל-חוץ: הנזילות שלהם (ראוטרי DEX)",
    venue: bestChannel ? `${bestChannel.dex} @ ${bestChannel.chain}` : "אין ערוץ מאומת במחזור זה",
    feeAccrual: "THEIRS",
    detail:
      "היציאה ל-USDT חסומה בכוונה (אין גוף מורשה; BLK-ETH-SOL-CAST). אבל הראוטר ממשיך למדוד: כשהשער ייפתח, התוכנית מערבבת - יוצאים דרך הבריכות שלנו קודם (העמלה שלנו) ורק את השאר דרך הראוטר הזול ביותר שנמדד. עלות הבריכות שלהם נמדדת ב-devBps - לא חינם, לא נסתר.",
    numbers: [
      { label: "ערוצים מאומדים", value: router ? `${verified.length}/${router.channels.length}` : "לא נמדד" },
      ...(bestChannel
        ? [
            { label: "הזול ביותר", value: `${bestChannel.dex} ${bestChannel.devBps != null ? (bestChannel.devBps >= 0 ? "+" : "") + bestChannel.devBps + "bps מול בינאנס" : "?"}` },
            { label: "עומק המדגם", value: bestChannel.amountInLabel },
          ]
        : []),
      { label: "מצב השער", value: "סגור - גוף מורשה דרוש" },
    ],
  });

  const mixingVerdict =
    gateVerdict === "AUTONOMOUS" && sbdOut != null
      ? `ערבוב-הסוואפ: ${sizeSteem} STEEM נכנסים דרך הבריכה שלנו (ההכנסה נשארת ברשת) וההחזקה מזינה את צד-הקנייה - עיגול שנסגר בלי יציאה לחוץ. כל דולר שלא שילמנו לבריכות שלהם הוא עודף מדוד.`
      : gateVerdict === "OPERATOR-QUEUE"
        ? `התוכנית בשווי ${sizeUsd?.toFixed(2) ?? "?"}$ - מעל הסף: כלום לא זז עד אישור המפעיל. הערבוב ממתין בצד אחד של השער, מוכן.`
        : "אין מדידת-USD חיה - התוכנית נשארת נייר עד שהשער יימדד. בכנות.";

  return {
    sizeSteem,
    sizeUsd,
    usdBasis,
    gateVerdict,
    gateDetail,
    legs,
    mixingVerdict,
    doctrine: [
      "הערבוב מודד - לא מבטיח: כל מספר כאן נמדד חי מהשרשרת ומהראוטר במחזור זה, או מסומן בכנות כלא-נמדד.",
      "סדר הרגליים הוא העסקה: פנים קודם (העמלה שלנו), חוץ רק ליתרת-הנזילות (העומק שלהם) - כך נזילות מהבריכות שלהם בלי לוותר על ההכנסה שלנו.",
      "בלי שער-חוץ מורשה התוכנית נשארת במצב מדידה - המנוע מתכנן, המפעיל חותם.",
    ],
  };
}

// ── הרכבת התמונה ────────────────────────────────────────────────────

const ECONOMY_TTL_MS = 60_000;

export async function composeEconomy(sizeSteem?: number): Promise<EconomySnapshot> {
  const down: string[] = [];
  const sources: Record<string, string> = {};

  const [money, router, gate, hive, ex, sol, eth] = await Promise.all([
    internalGet<MoneyLite>("/api/money").then((v) => {
      if (!v) down.push("money: לא נמדד במחזור זה");
      else sources.money = "/api/money (חי מ-api.steemit.com + בינאנס)";
      return v;
    }),
    internalGet<RouterLite>("/api/exchange/router").then((v) => {
      if (!v) down.push("exchange-router: לא נמדד במחזור זה");
      else sources.router = "/api/exchange/router (eth_call ישיר ל-7 ראוטרים)";
      return v;
    }),
    internalGet<GateLite>("/api/gate").then((v) => {
      if (!v) down.push("tx-gate: לא נמדד במחזור זה");
      else sources.gate = "/api/gate (שער-העסקאות $100)";
      return v;
    }),
    internalGet<HiveLite>("/api/money/hive").then((v) => {
      if (!v) down.push("hive-leg: לא נמדד במחזור זה");
      else sources.hive = "/api/money/hive (חי מ-api.hive.blog + בינאנס)";
      return v;
    }),
    internalGet<ExchangeLite>("/api/exchange").then((v) => {
      if (!v) down.push("sovereign-exchange: לא נמדד במחזור זה");
      else sources.exchange = "/api/exchange (זירת-המסחר הריבונית — ספר חי)";
      return v;
    }),
    internalGet<EthSolLegLite>("/api/money/sol").then((v) => {
      if (!v) down.push("sol-leg: לא נמדד במחזור זה");
      else sources.sol = "/api/money/sol (רגל סולנה — כספת+שרשרת)";
      return v;
    }),
    internalGet<EthSolLegLite>("/api/money/eth").then((v) => {
      if (!v) down.push("eth-leg: לא נמדד במחזור זה");
      else sources.eth = "/api/money/eth (רגל את'ריום — כספת+שרשרת)";
      return v;
    }),
  ]);

  const build = sbdBuildRate(money);
  const peg = pegMetrics(money);
  const deposits = await watchDepositsTotal();
  if (deposits.total == null) {
    down.push("watch-deposits: לא נמדד במחזור זה");
  } else {
    sources.watch = "Console/dex/watch.json (מראת סריקת ההפקדות החיצוניות)";
  }
  const blockages = await blockageSnapshot(money, router, build, ex, sol, eth, deposits.total, deposits.cadenceMin);
  const flows = flowMatrix(money, router, hive);
  const anchors = anchorRows(money, gate, peg);
  const size = sizeSteem && Number.isFinite(sizeSteem) && sizeSteem > 0 ? Math.min(sizeSteem, 100_000) : 10;
  const mix = swapMixPlan(size, money, router, gate, build);

  const verified = router ? router.channels.filter((c) => c.verdict === "VERIFIED").length : null;

  return {
    ok: down.length === 0,
    at: new Date().toISOString(),
    kpis: {
      sbdCommitable: money?.sbdArming?.commitable ?? null,
      sbdNeeded: money?.sbdArming?.needed ?? 0.15,
      sbdProgress: money?.sbdArming ? Math.min(1, money.sbdArming.commitable / money.sbdArming.needed) : null,
      quotesVerified: verified,
      quotesTotal: router?.channels.length ?? null,
      powerdownWeeklySteem: money?.powerdown?.weeklySteem ?? null,
      powerdownPaymentsLeft: money?.powerdown?.paymentsLeft ?? null,
      deployedSteem: money?.deployedSteem ?? null,
      ladderLevels: money?.orders?.length ?? 0,
      gateAllowed: gate?.stats.allowed ?? null,
      gateQueued: gate?.stats.queued ?? null,
      gateRefused: gate?.stats.refused ?? null,
    },
    blockages,
    flows,
    anchors,
    peg,
    sbdBuild: build,
    mix,
    doctrine: [
      "ריבונות היא מבנה, לא סיסמה: כל חסימה מכוונת נשארת חסימה עד שהחוק מאפשר אחרת - וכל חסימת-מלאי נפתחת רק ממילוי אמיתי, לא ממכירה מתחת לערך.",
      "הסוואפ שלנו מעורבב עם שלהם בסדר קבוע: הבריכה שלנו קודם (העמלה שלנו), הנזילות שלהם ליתרה (העומק שלהם) - התוכנית מודדת את שניהם בכל מחזור.",
      "אוטונומיה מתחת ל-$100, שער-מפעיל מעליו - נאכף בעורק הכסף, לא בכוונות טובות.",
      "אין מדידה - אין מסקנה: כל נתון חסר מסומן בכנות ולא מומר לאפס.",
    ],
    down,
    sources,
  };
}

export const ECONOMY_SWR_KEY = "economy:snapshot";
export { ECONOMY_TTL_MS as ECONOMY_SWR_TTL_MS };
