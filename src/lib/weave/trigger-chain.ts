// ─────────────────────────────────────────────────────────────────────
// TRIGGER-CHAIN — שרשרת-הטריגרים · דבר גורר דבר (R107)
//
// הוראת המפעיל: "איך נוכל לייצר עוד מגעים עם נזילות ולייצר טריגרים
// למכשירים שלנו שהכל ירוץ ויפעיל אחד את השני דבר גורר דבר והתפתחות
// מושכלת".
//
// החוקה: כל שרשרת היא רצף מדיד של טריגר→פעולה→טריגר הבא. הריצות
// נשמרות ב-ChainRun — שרשרת שאינה נמדדת אינה קיימת. שלושה שומרים
// חלים על כל צעד: צינון (לא יותר מ-X בין ריצות), תקציב (לא יותר
// מ-Y ביום), וכנות-כישלון (ריצה שנכשלה נרשמת ככישלון — אין
// "נניח שהצליח").
//
// שרשראות הקנון (מפת הדומינו):
//   1. עבודה→מטבע→עומק (compound):
//      מילוי-גריד ← reward-pay SAOS ← המרה חצי ל-USDS ← שני הצדדים
//      לבריכה ← העומק גדל ← ההחלפות הבאות זולות יותר ← עמלות
//      נאגרות בבריכה ← שווי-כל-מניית-LP צומח. הסוכן שעובד הופך
//      בעל-נזילות — העבודה עצמה בונה את השוק שמשלם לה.
//   2. מלאי→הטבעה→היצע (sbd-mint):
//      מילויי-מכירה מצטברים SBD באוצר ← מעל קו-החימוש (0.15) העודף
//      נעטף WSBD ← נטבע USDS 1:1 מול נעילה מלאה ← היצע-ה-USDS גדל
//      מהכנסה אמיתית ← יותר זיווג לבריכות. צוואר-ה-USDS-הנדיר נפתח
//      ממכניזם, לא מהבטחה.
//   3. גל→נזילות (stream):
//      פאוורדאון שבועי ← דלתא-דלק מעל קו-הבסיס ← 20% עומק בבריכות
//      ← השאר סולם ← מילויים ← (חוזר ל-1).
//   4. הפקדה→זיכוי (deposit):
//      הכסף נוגע בשרשרת ← הסריקה מזכה ← המאזן חי בזירה ← (עומק
//      זמין לכל השרשראות).
//   5. נזילות→יציאה (lp-exit):
//      מניות-LP ← חילוץ פרו-רטה ← המאזנים חוזרים ← סחירות שמורה.
//      הנזילות אף פעם לא נלכדת — זו ההבחנה בין זירה לכלוב.
// ─────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";

export const CHAINS = {
  compound: {
    titleHe: "עבודה→מטבע→עומק",
    steps: "מילוי-גריד ← תגמול SAOS ← המרה חצי ל-USDS ← שני הצדדים לבריכה (LP מניב עמלות)",
    cooldownMin: 360,
    budgetPerDay: 4,
  },
  "sbd-mint": {
    titleHe: "מלאי→הטבעה→היצע",
    steps: "מילויי-מכירה ← SBD מעל קו-החימוש ← עטיפה WSBD ← הטבעת USDS 1:1 מול נעילה מלאה",
    cooldownMin: 180,
    budgetPerDay: 6,
  },
  stream: {
    titleHe: "גל→נזילות",
    steps: "פאוורדאון ← דלתא-דלק ← 20% עומק בבריכות ← השאר סולם ← מילויים (חוזר להתחלה)",
    cooldownMin: 720,
    budgetPerDay: 1,
  },
  deposit: {
    titleHe: "הפקדה→זיכוי",
    steps: "כסף נוגע בשרשרת ← סריקה אוטונומית ← זיכוי למאזן הזירה ← עומק זמין לשרשראות",
    cooldownMin: 5,
    budgetPerDay: 288,
  },
  "lp-exit": {
    titleHe: "נזילות→יציאה",
    steps: "מניות-LP ← חילוץ פרו-רטה ← מאזנים חוזרים — הנזילות לעולם לא נלכדת",
    cooldownMin: 60,
    budgetPerDay: 8,
  },
  "pool-guard": {
    titleHe: "איזון-בריכות",
    steps: "סטיית בריכה מהשווי-החיצוני האמיתי ← האוצר סוגר את הפער ← הפרמייה נשארת בבית",
    cooldownMin: 30,
    budgetPerDay: 8,
  },
} as const;

export type ChainName = keyof typeof CHAINS;

export interface ChainGuardResult {
  allowed: boolean;
  reason: string;
}

/**
 * שומרי-שרשרת: צינון + תקציב יומי. נקרא לפני כל ריצה —
 * השרשרת שמפריעה לעצמה היא שרשרת שבורה.
 */
export async function chainGuard(chain: ChainName): Promise<ChainGuardResult> {
  const def = CHAINS[chain];
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [recent, today] = await Promise.all([
    db.chainRun.findFirst({ where: { chain, createdAt: { gte: new Date(now.getTime() - def.cooldownMin * 60_000) } }, orderBy: { createdAt: "desc" } }),
    db.chainRun.count({ where: { chain, createdAt: { gte: dayStart } } }),
  ]);
  if (recent) {
    const waitMin = Math.ceil((recent.createdAt.getTime() + def.cooldownMin * 60_000 - now.getTime()) / 60_000);
    return { allowed: false, reason: `WAIT-COOLDOWN · השרשרת ${chain} רצה לפני ${waitMin} דק' — עוד מחכים בסבלנות` };
  }
  if (today >= def.budgetPerDay) {
    return { allowed: false, reason: `WAIT-BUDGET · ${today}/${def.budgetPerDay} ריצות היום בשרשרת ${chain}` };
  }
  return { allowed: true, reason: "חופשי" };
}

/**
 * תיעוד-ריצה — השרשרת חיה רק אם היא נמדדת. כישלון נרשם ככישלון.
 */
export async function chainLog(
  chain: ChainName,
  step: string,
  firedBy: string,
  ok: boolean,
  detail: string,
): Promise<void> {
  try {
    await db.chainRun.create({ data: { chain, step, firedBy, ok, detail: detail.slice(0, 300) } });
  } catch {
    // התיעוד לעולם לא מפיל את הפעולה — אבל הפעולה שלא ניתנת לתיעוד
    // תיבדק בדיעבד (הספר הוא השופט)
  }
}

export interface ChainStateItem {
  chain: string;
  titleHe: string;
  steps: string;
  cooldownMin: number;
  budgetPerDay: number;
  runsToday: number;
  lastRun: { step: string; firedBy: string; ok: boolean; detail: string; at: string } | null;
}

/**
 * מפת-הדומינו החיה — לתצוגה ול-API. כל שרשרת עם מצבה הנוכחי:
 * מתי רצה לאחרונה, כמה ריצות היום, והאם היא חופשית עכשיו.
 */
export async function chainState(): Promise<Array<ChainStateItem & { free: boolean }>> {
  const out: Array<ChainStateItem & { free: boolean }> = [];
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const [chain, def] of Object.entries(CHAINS) as Array<[ChainName, (typeof CHAINS)[ChainName]]>) {
    const [last, today] = await Promise.all([
      db.chainRun.findFirst({ where: { chain }, orderBy: { createdAt: "desc" } }),
      db.chainRun.count({ where: { chain, createdAt: { gte: dayStart } } }),
    ]);
    const lastRun = last
      ? { step: last.step, firedBy: last.firedBy, ok: last.ok, detail: last.detail, at: last.createdAt.toISOString() }
      : null;
    const cooledDown = !last || now.getTime() - last.createdAt.getTime() >= def.cooldownMin * 60_000;
    out.push({
      chain,
      titleHe: def.titleHe,
      steps: def.steps,
      cooldownMin: def.cooldownMin,
      budgetPerDay: def.budgetPerDay,
      runsToday: today,
      lastRun,
      free: cooledDown && today < def.budgetPerDay,
    });
  }
  return out;
}
