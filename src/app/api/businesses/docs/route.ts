// ─────────────────────────────────────────────────────────────────────
// /api/businesses/docs — קטלוג-API-הציבור של הרשת (r148-d · B-4 דלפק-הפיד)
//
// המשטח המתועד של המוצר: קטלוג-עצמי (self-describing) של הנתיבים
// הציבוריים — קריאה-בלבד, אפס-סודות, אפס-אימות. חוקי-הקטלוג:
//   · רשימת-השדות נבדקה מול קוד-המקור של כל נתיב (src/app/api/**) ומול
//     תשובה-חיה — לא מומצאים שדות. מה שלא נמדד/לא קיים — מדווח בכנות.
//   · fail-soft מלא: הקטלוג סטטי (אפס I/O רשת בזמן-הגשה) — אין מה
//     להיכשל; אם מבנה נמדד משתנה, הכנות קודמת לנוחות.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type EndpointDoc = {
  path: string;
  method: "GET";
  purposeHe: string;
  sample: string;
  fields: string[];
  noteHe?: string;
};

const BASE = "http://127.0.0.1:3000";

const endpoints: EndpointDoc[] = [
  {
    path: "/api/public/pulse",
    method: "GET",
    purposeHe: "הפולס הציבורי של הרשת: PnL ממומש, משימת-הכנסה, ובריאות שרשרת-ההחלטות — כל מספר עם measuredAt+source",
    sample: `curl -s ${BASE}/api/public/pulse`,
    fields: [
      "ok", "at", "format", "usage{endpoint,requests,since}", "law",
      "pnl{measured,realizedSbd,realizedUsd,trips,fillsTotal,lastFillAt,ordersOpen,measuredAt,source}",
      "mission{targetUsdPerDay,usdPerDay7dAvg,daysRecorded,measuredAt,source}",
      "governance{chainOk,entries,brokenAt,measuredAt,source}",
      "note",
    ],
    noteHe: "פורמט public-pulse-feed-v1; מקור-נכשל מדווח null — לעולם לא 0 שנראה כמו מדידה",
  },
  {
    path: "/api/businesses",
    method: "GET",
    purposeHe: "משטח-האמת של חממת-העסקים: הרישום מהדיסק + מדידה-חיה לכל עסק (B-1 דלק · B-2 תדריך · B-3 אמת)",
    sample: `curl -s ${BASE}/api/businesses`,
    fields: [
      "ok", "at", "usage{endpoint,requests,since}", "law",
      "registry{format,createdAt,decisionId,lawHe,businesses[],capacityLawHe,nextReview}",
      "metrics{\"B-1-fuel-desk\"{measuredAt,source,fuelState,totalFuelSteem,arenaClaimWsteem,noteHe}}",
      "metrics{\"B-2-market-brief\"{measuredAt,source,fetchedAt,topTopic,externalVotes,externalRshares,replies,noteHe}}",
      "metrics{\"B-3-truth-desk\"{measuredAt,source,auditFile,auditAt,nearDuplicatePairs,noteHe}}",
    ],
    noteHe: "registry.businesses מהדיסק (sovereign/businesses/registry.json) — כרגע 4 עסקים; המדידות-החיות ב-metrics כוללות B-1..B-3",
  },
  {
    path: "/api/kpi",
    method: "GET",
    purposeHe: "משטח-האמת של הספר-היומי: בריאות המפקיד (:3041), קובץ-היום האחרון, חוק-הטריות והיסטוריית-הימים",
    sample: `curl -s ${BASE}/api/kpi`,
    fields: [
      "ok", "service", "at",
      "scribe{up,port,beats,alive,lastRecordDay,lastRecordAt,lastResult,lastCi}",
      "latest{day,format,green,at,measured,streak}",
      "freshness{lastRecordDay,expectedRecordDay,cadence,ageHours,fresh,note}",
      "historyDays", "historyCount",
    ],
    noteHe: "יום-חסר מוכרז STALE בכנות — לא \"הכל טוב\"; cadence: daily, first tick after 12:05Z (+catch-up)",
  },
  {
    path: "/api/businesses/docs",
    method: "GET",
    purposeHe: "קטלוג זה עצמו — משטח-התיעוד העצמי של ה-API הציבורי (self-describing)",
    sample: `curl -s ${BASE}/api/businesses/docs`,
    fields: ["ok", "format", "lawHe", "at", "endpoints[]{path,method,purposeHe,sample,fields,noteHe}", "measuredNotes[]"],
    noteHe: "אימות-עצמי: רשימת-השדות כאן נגזרה מקוד-המקור ומתשובות-חיות, לא מהצהרות",
  },
  {
    path: "/api/money/claim",
    method: "GET",
    purposeHe: "מדידת-התגמולים-הממתינים לחשבון-הרשת (STEEM/SBD/VESTS + מקבילת-SP מהפרופס הגלובלי) — אפס חומר-מפתח בתשובה",
    sample: `curl -s ${BASE}/api/money/claim`,
    fields: [
      "ok", "account", "rewardSteem", "rewardSbd", "rewardVests", "spEquivalent",
      "claimThresholdSp", "claimable", "measuredAt", "source", "error", "noteHe",
    ],
    noteHe:
      "GET = מדידה בלבד · POST — פנימי — דורש מפתח-רשת, לא ציבורי (שידור claim_rewards חתום-active, שמירת-מוצא-זהה + אנטי-כפילות 23ש') · קבלות-תביעה: sovereign/businesses/fuel-log.jsonl",
  },
  {
    path: "/api/money",
    method: "GET",
    purposeHe: "מוביל-הכסף: יתרות, ספר-פקודות, מילויים, powerdown — והמדידה של תביעת-העטיפה fuel.arenaClaimWsteem",
    sample: `curl -s ${BASE}/api/money`,
    fields: [
      "ok", "at", "account", "marks", "balances", "keyPresent", "book", "orders", "ourBids",
      "deployedSteem", "idleSteem", "valueFloor", "ladder",
      "fuel{liquidSteem,inOrdersSteem,arenaClaimWsteem,totalFuel,state,noteHe}",
      "positioning", "powerdown", "fills", "fillsWindow24h", "sbdArming", "redemption",
      "diagnosis", "opportunities", "daemon", "doctrine", "cached", "stale", "cacheAgeSec", "refreshing",
    ],
    noteHe:
      "POST /api/money — פנימי — דורש מפתח-רשת, לא ציבורי · תביעת-העטיפה של הסולם נמדדת כאן ב-fuel.arenaClaimWsteem (17.983 WSTEEM במדידת-האימות); תביעת-התגמולים-הממתינים נמדדת בנתיב נפרד: /api/money/claim",
  },
];

export async function GET() {
  return NextResponse.json({
    ok: true,
    format: "api-catalog-v1",
    at: new Date().toISOString(),
    lawHe:
      "קטלוג קריאה-בלבד, אפס-סודות, אפס-זיוף: כל נתיב ציבורי מתועד כאן עם שדות-אמת שנבדקו מול קוד-המקור ומול תשובה-חיה; פנימי מסומן פנימי; מה שלא קיים — נאמר שלא קיים",
    endpoints,
    measuredNotes: [
      "שדה usage (מוני-שימוש אמת) נוסף ל-/api/public/pulse ול-/api/businesses מ-r148-d; המונים חיים ב-sovereign/businesses/feed-metrics.json",
      "/api/money/claim — היסטוריית-מדידה כנה: 404 ב-12:57Z · נפתח חי (~13:10Z, חזית r148-a המקבילה) · 200 עם השדות-למעלה ב-13:12Z — הקטלוג מתועד מקוד-המקור שלו ומתשובה-חיה",
    ],
  });
}
