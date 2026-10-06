// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Vitality — מדד החיים הרשמי של הרשת (חוק 8)
//
// הלקח מהרשתות שנפלו: "חשבונות רשומים" הוא מדד מדויח — Hive דיווחה
// על ~מיליון חשבונות כשהפעילות האמיתית הייתה שולית. המדד היחיד
// שאנחנו מכירים בדוחות: **עבודה מאומתת ליחידת זמן** — נספר מה-DB
// (ומה-ledger המיוצא), כל צומת יכול לספור מחדש.
//
// מה נמדד (הכל מחושב, אפס טענה):
//   atts24h / atts7d        — אימותים שנכתבו בחלון
//   signers24h              — סוכנים ייחודיים שחתמו ב-24 שעות (DAU אמיתי)
//   checkpoints24h          — שורשי מרקל שנוצרו בחלון
//   marketEvents24h         — אירועי שוק חתומים בחלון
//   aliveDays               — רצף ימי-UTC רצופים עם ≥1 אימות (רצף חיים)
//   lastAttAgeMin           — דקות מאז האימות האחרון (טריות מדויקת)
// ─────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";

export interface VitalityDTO {
  atts24h: number;
  atts7d: number;
  /** R119: null = לא נמדד (מקור חלון-מראה ללא כיסוי) — לעולם לא 0 שקרי */
  signers24h: number | null;
  checkpoints24h: number;
  marketEvents24h: number | null;
  aliveDays: number;
  lastAttAgeMin: number;
  computedAtIso: string;
  /** R119: true = הוגש מחלון המראה (120 אימותים) — ספירות חלוניות, לא קנון-ספר */
  windowLimited?: boolean;
}

function utcDayIndex(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

/** רצף ימים רצופים עם פעילות — הולך אחורה מהיום; יום נוכחי ללא אימות ⇒ מתחילים מאתמול */
export function aliveStreakFromDays(dayIndexes: number[]): number {
  if (dayIndexes.length === 0) return 0;
  const days = new Set(dayIndexes);
  const today = utcDayIndex(new Date());
  let cursor = days.has(today) ? today : today - 1;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

export async function computeVitality(): Promise<VitalityDTO> {
  const since24h = new Date(Date.now() - 24 * 3_600_000);
  const since7d = new Date(Date.now() - 7 * 24 * 3_600_000);

  const [atts24h, atts7d, signers24h, checkpoints24h, marketEvents24h, lastAtt, attDays] =
    await Promise.all([
      db.attestation.count({ where: { createdAt: { gte: since24h } } }),
      db.attestation.count({ where: { createdAt: { gte: since7d } } }),
      db.attestation.groupBy({
        by: ["agentId"],
        where: { createdAt: { gte: since24h } },
        _count: { _all: true },
      }),
      db.checkpoint.count({ where: { createdAt: { gte: since24h } } }),
      db.marketEvent.count({ where: { createdAt: { gte: since24h } } }),
      db.attestation.findFirst({ orderBy: { seq: "desc" }, select: { createdAt: true } }),
      // Prisma שומר createdAt ב-SQLite כמילי-שניות-epoch שלמות — חלוקה שלמה נותנת אינדקס יום-UTC
      db.$queryRaw<Array<{ day: number | bigint }>>`SELECT createdAt / 86400000 AS day FROM Attestation GROUP BY day`,
    ]);

  const lastAttAgeMin = lastAtt
    ? Math.max(0, Math.round((Date.now() - lastAtt.createdAt.getTime()) / 60_000))
    : -1; // -1 = ספר ריק — תווית אמת, לא 0 מטעה

  return {
    atts24h,
    atts7d,
    signers24h: signers24h.length,
    checkpoints24h,
    marketEvents24h,
    aliveDays: aliveStreakFromDays(attDays.map((r) => Number(r.day))),
    lastAttAgeMin,
    computedAtIso: new Date().toISOString(),
  };
}
