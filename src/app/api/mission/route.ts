// ─────────────────────────────────────────────────────────────────────
// /api/mission — מנוע-המשימה · הסולם הכן אל $1,000/יום (Task 9, 2026-09-28)
//
// הוראת המפעיל (2026-09-28): "צריך לאמת ולהפעיל את כל המערכת ולהוכיח
// אותה לרמת המשימה של 1000$ ביום והדרך לביצוע."
//
// החוק היחיד של המנוע הזה: **כנות.** אין כאן הבטחה אחת. יש כאן מדידה
// של היום, מתמטיקה גלויה של הפער, והמכונות שצריך לחמש בכל מדרגה.
// כל מספר נושא מקור. כל מקור שנפל — מסומן בכנות, לא מומצא.
//
// מקורות האמת (כולם קריאה-בלבד):
//   · sovereign/income/daily-*.json  — הספר היומי הנמדד (income-day-v1)
//   · GET /api/money (self, פסק-זמן קצר) — יתרות-אוצר חיות + שערי-שוק
//   · ChainRun (DB)                  — ריצות שרשראות-הטריגר בפועל
//   · צי הדיבונים (TCP 3033-3040)    — חיות הצי ברגע הקריאה
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAEMONS: Array<{ name: string; port: number }> = [
  { name: "pulse", port: 3033 },
  { name: "money", port: 3034 },
  { name: "hunter", port: 3035 },
  { name: "keeper", port: 3036 },
  { name: "student", port: 3037 },
  { name: "fleet-verify", port: 3038 },
  { name: "weblift", port: 3039 },
  { name: "curation", port: 3040 },
  { name: "kpi", port: 3041 },
];

// סדרות-גודל של תשואה-שנתית נטו על הון DeFi — לא הבטחות: זהו טווח
// המציאות המוכר בשווקים (ריבית-ספק נמוכה; מסחר-גריד גבוה ותלוי-תנודתיות).
const APR_TIERS = [
  { id: "conservative", apr: 0.08, noteHe: "ריבית-ספק/הלוואות בפרוטוקולים מבוססים" },
  { id: "moderate", apr: 0.2, noteHe: "בריכות-נזילות + עמלות + אוצרות" },
  { id: "aggressive", apr: 0.5, noteHe: "מסחר-גריד אקטיבי — תלוי תנודתיות, אינו מובטח" },
] as const;

// מדרגות המשימה. מדרגה נחשבת "נגישה" רק כשהמדידה החיה עומדת בה
// בחלון הנדרש — המנוע לעולם לא מכריז "הושגה" מתמטיקה בלבד.
const RUNGS = [1, 10, 100, 1000] as const;

interface IncomeDay {
  date: string;
  totals?: { usdToday?: number | null };
}

function readIncomeDays(): { days: IncomeDay[]; source: string } {
  const dir = path.join(process.cwd(), "sovereign", "income");
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /^daily-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
    : [];
  const days: IncomeDay[] = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (j && j.format === "income-day-v1") days.push(j);
    } catch {}
  }
  return { days, source: "sovereign/income/daily-*.json (income-day-v1)" };
}

function tcpAlive(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new net.Socket();
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
    s.connect(port, "127.0.0.1");
  });
}

interface MoneyMarks {
  steemUsd: number | null;
  sbdUsd: number | null;
  balances: { steem?: number; sbd?: number } | null;
  steemInOrders: number | null;
  sbdInBids: number | null;
}

async function readMoneyMarks(): Promise<{ data: MoneyMarks | null; noteHe: string }> {
  try {
    const r = await fetch("http://127.0.0.1:3000/api/money", {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!r.ok)
      return {
        data: null,
        noteHe: "מוביל-הכסף לא ענה — ההון לא נמדד בקריאה זו (אין שער — אין מספר)",
      };
    const j = await r.json();
    const marks = j?.marks ?? {};
    // r133 · אמת-הון מלאה: ההון הוא נוזלי + מוצב בפקודות פתוחות (מכירות STEEM והצעות-קנייה SBD) —
    // לא רק הנוזלי (D-012 עקביות: מדידה מלאה, פירוט גלוי, אפס הסתרה).
    const ordersTotalSteem = Array.isArray(j?.orders)
      ? (j.orders as Array<{ amount?: number }>).reduce((s, o) => s + (typeof o?.amount === "number" ? o.amount : 0), 0)
      : null;
    const bidsTotalSbd = Array.isArray(j?.ourBids)
      ? (j.ourBids as Array<{ sbd?: number }>).reduce((s, b) => s + (typeof b?.sbd === "number" ? b.sbd : 0), 0)
      : null;
    return {
      data: {
        steemUsd: typeof marks.steemUsd === "number" ? marks.steemUsd : null,
        sbdUsd: typeof marks.sbdUsd === "number" ? marks.sbdUsd : null,
        balances: j?.balances ?? null,
        steemInOrders: ordersTotalSteem !== null ? Math.round(ordersTotalSteem * 1000) / 1000 : null,
        sbdInBids: bidsTotalSbd !== null ? Math.round(bidsTotalSbd * 1000) / 1000 : null,
      },
      noteHe: "מוביל-הכסף · שערי binance/coingecko + יתרות שרשרת חיות",
    };
  } catch {
    return {
      data: null,
      noteHe: "מוביל-הכסף לא ענה בזמן — ההון לא נמדד בקריאה זו (אין שער — אין מספר)",
    };
  }
}

export async function GET() {
  const at = new Date().toISOString();

  // 0) רצף-הירוק של L0 — נספר מקבצי KPI-history המקומיים שמפקיד ה-KPI (Z-9) כותב.
  //    יום חסר שובר את הרצף בכנות — בדיוק כמו במפקיד.
  let l0Streak = 0;
  let l0TodayGreen: boolean | null = null;
  let l0HistoryDays = 0;
  try {
    const histDir = path.join(process.cwd(), "sovereign", "kpi", "history");
    const today = new Date().toISOString().slice(0, 10);
    let cursor = new Date(`${today}T00:00:00Z`);
    for (let i = 0; i < 60; i++) {
      const d = cursor.toISOString().slice(0, 10);
      try {
        const j = JSON.parse(fs.readFileSync(path.join(histDir, `${d}.json`), "utf8"));
        if (i === 0) l0HistoryDays = 1;
        else l0HistoryDays++;
        // צורה קנונית kpi-day-v1: { last: { green, ... }, runs: [...] } — וליתר-ביטחון גם j.green
        const greenToday = (j?.last?.green ?? j?.green) === true;
        if (i === 0) l0TodayGreen = greenToday;
        if (greenToday) l0Streak++;
        else break;
      } catch {
        break;
      }
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
  } catch {
    /* אין היסטוריה עדיין — הרצף 0, כנות */
  }

  // 1) הכנסה נמדדת — חלונות 7 ו-30 יום מהספר היומי
  const { days, source: incomeSource } = readIncomeDays();
  const usdOf = (d: IncomeDay) =>
    typeof d?.totals?.usdToday === "number" ? (d.totals.usdToday as number) : 0;
  const sumLast = (n: number) => days.slice(-n).reduce((a, d) => a + usdOf(d), 0);
  const sum7 = sumLast(7);
  const sum30 = sumLast(30);
  const measuredDaily7 = days.length ? sum7 / Math.min(7, days.length) : 0;
  const measuredDaily30 = days.length ? sum30 / Math.min(30, days.length) : 0;

  // 2) הון חי — נוזלי + מוצב בפקודות (r133: אמת-הון מלאה, לא רק נוזלי)
  const money = await readMoneyMarks();
  const steemBal = money.data?.balances?.steem ?? null;
  const steemUsd = money.data?.steemUsd ?? null;
  const sbdBal = money.data?.balances?.sbd ?? null;
  const sbdUsd = money.data?.sbdUsd ?? null;
  const steemInOrders = money.data?.steemInOrders ?? null;
  const sbdInBids = money.data?.sbdInBids ?? null;
  const steemTotal =
    steemBal !== null && steemInOrders !== null
      ? Math.round((steemBal + steemInOrders) * 1000) / 1000
      : steemBal;
  const sbdTotal =
    sbdBal != null && sbdInBids !== null
      ? Math.round((sbdBal + sbdInBids) * 1000) / 1000
      : sbdBal;
  const capitalUsd =
    steemTotal != null && steemUsd !== null
      ? steemTotal * steemUsd + (sbdTotal != null && sbdUsd != null ? sbdTotal * sbdUsd : 0)
      : null;

  // 3) ריצות שרשראות-הטריגר — הדומינו בפועל
  const since24 = new Date(Date.now() - 24 * 3600_000);
  const chainRows = await db.chainRun.groupBy({
    by: ["chain"],
    _count: { _all: true },
    _max: { createdAt: true },
    where: { createdAt: { gte: since24 } },
  });
  const okRows = await db.chainRun.groupBy({
    by: ["chain"],
    _count: { _all: true },
    where: { createdAt: { gte: since24 }, ok: true },
  });
  const okMap = new Map(okRows.map((r) => [r.chain, r._count._all]));
  const chains24h = chainRows
    .map((r) => ({
      chain: r.chain,
      runs24h: r._count._all,
      ok24h: okMap.get(r.chain) ?? 0,
      lastRunAt: r._max.createdAt ? r._max.createdAt.toISOString() : null,
    }))
    .sort((a, b) => b.runs24h - a.runs24h);

  // 4) חיות הצי
  const daemonChecks = await Promise.all(
    DAEMONS.map(async (d) => ({ ...d, alive: await tcpAlive(d.port) })),
  );
  const daemonsUp = daemonChecks.filter((d) => d.alive).length;

  // 5) הסולם — מתמטיקה גלויה: הון-נדרש = יעד-יומי / (APR/365)
  const dailyTarget = measuredDaily7 > 0 ? measuredDaily7 : measuredDaily30;
  const ladder = RUNGS.map((rung) => ({
    rungUsdPerDay: rung,
    requiredCapitalUsd: APR_TIERS.map((t) => ({
      tier: t.id,
      apr: t.apr,
      capitalUsd: Math.round((rung / (t.apr / 365)) * 100) / 100,
    })),
    stateHe:
      dailyTarget >= rung
        ? "המדידה עומדת במדרגה — נדרש אישור חלון רציף לפני הכרזה"
        : "הפער נמדד — ראה gap",
  }));

  const body = {
    ok: true,
    at,
    mission: {
      targetUsdPerDay: 1000,
      targetHe:
        "משימת $1,000/יום — הדרך היחידה שלנו: מדידה ← מכונות ← הון. אין קסם, יש סולם.",
      honestyHe:
        "אף תשואה אינה מובטחת. טירי-ה-APR הם סדרי-גודל לתכנון הון, לא הבטחת-רווח. כל מדרגה מוכרזת רק ממדידה חיה רציפה.",
    },
    measured: {
      incomeSource,
      daysRecorded: days.length,
      usd7d: Math.round(sum7 * 10000) / 10000,
      usd30d: Math.round(sum30 * 10000) / 10000,
      usdPerDay7dAvg: Math.round(measuredDaily7 * 100000) / 100000,
      usdPerDay30dAvg: Math.round(measuredDaily30 * 100000) / 100000,
      baselineHe:
        "הבסיס הנמדד — המספר הכן שממנו מתחיל הסולם. הוא קטן וזו בדיוק הנקודה: המכונות חיות, ההון עוד לא.",
    },
    capital: {
      sourceNoteHe: money.noteHe,
      steemBalance: steemBal,
      steemInOrders,
      steemTotal,
      sbdTotal,
      steemUsd,
      capitalUsd: capitalUsd !== null ? Math.round(capitalUsd * 100) / 100 : null,
      breakdownNoteHe:
        "ההון = נוזלי + מוצב בפקודות פתוחות (סולם-המכירה והצעות-הקנייה). זו מדידה מלאה ולא הגדלה: הפקודות הן הון עובד שאפשר לבטל ולהחזיר. SBD מומר בשער-ה-SBD הנמדד.",
    },
    triggers: {
      windowHe: "24 שעות אחרונות — דבר גורר דבר, כפי שנרשם בספר (ChainRun)",
      chains: chains24h,
      totalRuns24h: chains24h.reduce((a, c) => a + c.runs24h, 0),
      okRuns24h: chains24h.reduce((a, c) => a + c.ok24h, 0),
    },
    fleet: {
      daemons: daemonChecks,
      up: daemonsUp,
      total: DAEMONS.length,
    },
    l0: {
      consecutiveGreenDays: l0Streak,
      requiredDays: 7,
      todayGreen: l0TodayGreen,
      historyDays: l0HistoryDays,
      noteHe:
        "L0 = הוכחת-מנוע: צי מלא + רשת בריאה + grid טרי + CI ירוק, 7 ימים רצופים. הרצף נספר מ-KPI-history שמפקיד ה-KPI (Z-9) מפקיד יומית — יום חסר שובר את הרצף בכנות.",
    },
    ladder,
    gap: {
      dailyNowUsd: Math.round(dailyTarget * 100000) / 100000,
      dailyTargetUsd: 1000,
      ratio: dailyTarget > 0 ? Math.round((1000 / dailyTarget) * 10) / 10 : null,
      requiredCapitalUsdAtModerateApr: Math.round((1000 / (0.2 / 365)) * 100) / 100,
      capitalNowUsd: capitalUsd,
      capitalGapUsd:
        capitalUsd !== null
          ? Math.round((1000 / (0.2 / 365) - capitalUsd) * 100) / 100
          : null,
      gapHe:
        "הפער הוא הון + זמן-הוכחה, לא קסם: ב-$50K ו-APR 20% מגיעים ל-$27/יום; ב-$500K — $274/יום; ב-$1.83M — $1,000/יום. כל מדרגת-סולם שנכבשת מקטינה את הסיכון להון הבא.",
    },
    nextMachinesHe: [
      "M0→M1 ($1/יום): אוצרות 10/יום × 2% על 4.4K-SP (חי) + מילויי-גריד יומיים (חי) — נמדד בספר היומי",
      "M1→M2 ($10/יום): חימוש שער-המפעיל לגריד-מיקרו נוסף + הגדלת עומק בריכות מהעמלות הנאגרות",
      "M2→M3 ($100/יום): הון חוץ (עוגן-הפקדות) + נתיב TRON (SunSwap→JustLend) מעבר לסף-העלות",
      "M3 ($1,000/יום): הון ~$1.83M ב-APR 20% או שילוב מסחר אקטיבי — בלי קיצורי-דרך, בלי שקרים",
    ],
  };

  return NextResponse.json(body);
}
