// ─────────────────────────────────────────────────────────────────────
// /api/defi — הגלגל הריבוני: שוק-כספים, כספות, ומספרי הענקיות.
//
// דבר גורר דבר (v20): הגריד לבדו אינו מספיק — נדרשת ריבונות
// מלאה שמקיימת זרימת-מזומנים רציפה בין הכלים. ה-API הזה מחשב
// את מצב הכלים מהנתונים החיים בלבד:
//
//   world.json  — השרשרת הקנונית (בריכות, ארנקים, ארנה, מילויים)
//   money.json  — צופה נתיב-הכסף (powerdown, פדיון, אינווריאנטה)
//   grid.json   — הגריד החוץ (STEEM-internal-market)
//   watch.json  — ספר ההפקדות הפתוח (4 רשתות)
//   DefiLlama   — TVL חי של Aave/Compound/Uniswap/Curve/Yearn/Sky
//
// שום דבר לא מומצא: כל פרמטר נגזר מנתון חי או מוגדר כמדיניות
// גלויה (עקומת הריבית). מקור שנפל מסומן down בכנות.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";

export const dynamic = "force-dynamic";

const CONSOLE_BASE = "https://roshpinacare-sys.github.io/Console";

// ── עזר רשת עם timeout ──────────────────────────────────────────────

async function jget(url: string, timeoutMs = 9000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ── מדיניות שוק-הכספים (גלויה, בסטנדרט Aave-v3 kinked) ────────────────
//
// עקומת ריבית עם ברך (kink) בניצולת 80%, כמו Aave v3 על נכסי-יסוד:
//   U ≤ 80%:  R = R0 + slope × U
//   U > 80%:  R = R0 + slope × U + slope2 × (U − 80%)
// הפרמטרים כאן שמרניים בכוונה (רשת צעירה, סיכון-אמון גבוה):
//   R0 = 1% בסיס · slope = 4% · slope2 = 60% — עונש חד מעל הברך.

export const MM = {
  optimalUtilBps: 8000,
  baseApr: 0.01,
  slope1: 0.04,
  slope2: 0.6,
  reserveFactor: 0.1, // 10% מהריבית → אוצר (שקיפות מלאה)
  ltv: 0.5, // 50% LTV לנכסי-צד
  liquidationThreshold: 0.65,
  liquidationPenalty: 0.075,
} as const;

function borrowApr(util: number): number {
  const u = Math.min(1, Math.max(0, util));
  let r = MM.baseApr + MM.slope1 * u;
  if (u > MM.optimalUtilBps / 10000)
    r += MM.slope2 * (u - MM.optimalUtilBps / 10000);
  return r;
}

function aprToApy(apr: number, periodsPerYear: number): number {
  // ריבית-דריבית: APY = (1 + APR/n)^n − 1
  if (apr <= 0) return 0;
  return Math.pow(1 + apr / periodsPerYear, periodsPerYear) - 1;
}

// ── צד השרשרת החיה (world.json) ──────────────────────────────────────

interface WorldDoc {
  state?: {
    height?: number; treasuryProfit?: number; fills?: number; swaps?: number;
    liveOrders?: number; tps?: number; opsTotal?: number;
    // FIX(R46): המונה-המונוטוני-האמיתי — עולה-רק, לעולם-לא-נשחק-לדלק (היתרה-העובדת נשחקת
    // לסולם/גז-לפי-תכנון). נפרסם-על-ידי-dex-beat מ-R46; עד-שייפרסם — נפילה-כנה-ליתרה-העובדת.
    income?: { treasuryProfitEverMu?: number };
    // FIX(R47): THE-SAVE — קרן-החוסכים החיה: זרמי-ההכנסה המדודים + חלון-היום-האמיתי.
    // FIX(R48 · calibration-truth): apyBps עשוי-להיות null — חלון-הכיול שלאחר-מיגרציית-בסיס-ההכנסה
    // אינו-מפורסם-כשנתי לעולם (windows<2). windows/demoMu/dayMarkH מועברים-בשקיפות-מלאה.
    savings?: {
      potMu?: number; savers?: number; paidMu?: number; dayPaidMu?: number; dayPaidPrevMu?: number;
      apyBps?: number | null; opens?: number; closes?: number; incomeSourceMu?: number;
      windows?: number; demoMu?: number; dayMarkH?: number | null;
      incomeStreams?: { vaultInterestMu?: number; lendReserveMu?: number; feeShareMu?: number };
      dayWindowBlocks?: number; feeSharePct?: number;
    };
  };
  pools?: Array<{
    key: string; a?: string; b?: string; ra: number; rb: number; swaps: number;
    feeAccruedTreasury?: number; feeBps?: number; lpYieldBps?: number;
    polShareBps?: number; derived?: boolean;
  }>;
  wallets?: Array<{
    name: string; credits?: number;
    balances?: Record<string, number>;
    locked?: Record<string, number>;
  }>;
  markets?: Array<{ key: string; bestBid?: number; bestAsk?: number; spreadBps?: number }>;
}

function mu(v: number | undefined): number {
  // 1 יחידת-נכס = 1000µ — אותו סולם-מנוע של הקרנל (kernel.ts:8)
  return (v ?? 0) / 1000;
}

async function worldSide() {
  const w: WorldDoc = await jget(`${CONSOLE_BASE}/dex/world.json`);
  const pools = w.pools ?? [];
  const wallets = w.wallets ?? [];

  // ── אספקת USDS הזמינה לשוק-הכספים: ארנקי הרשת הפתוחים (אוצר+מפעיל)
  //    בלי ה-LP ובלי הנעילות — רק מזומן שאפשר להפקיד בלי לשבור כלום.
  const byName = new Map(wallets.map((x) => [x.name, x]));
  const treasuryUsds = mu(byName.get("treasury")?.balances?.USDS);
  const operatorUsds = mu(byName.get("operator")?.balances?.USDS);
  const arenaUsds = mu(byName.get("arena")?.balances?.USDS);
  const supply = treasuryUsds + operatorUsds + arenaUsds;

  // ── ביקוש ההלוואות החי: החיילים נועלים USDS כבטוחה בארנה — זו
  //    הלוואה אמיתית מהשרשרת (locked), לא המחשה.
  let borrowed = 0;
  for (const wl of wallets) {
    if (!wl.name.startsWith("soldier-")) continue;
    borrowed += mu(wl.locked?.USDS);
  }
  const util = supply > 0 ? Math.min(1, borrowed / supply) : 0;
  const bApr = borrowApr(util);
  // ריבית למלווה = ריבית הלוואה × (1 − גורם-היתרה) × ניצולת — כמו Aave
  const supplyApr = bApr * (1 - MM.reserveFactor) * util;

  // ── R44 · THE-MARKET: השוק-עצמו חי-על-השרשרת (state.lend ב-world.json).
  //    נתוני-השרשרת-האמיתיים גוברים-תמיד על-החישוב-התיאורטי — אמת-לפני-המחשה:
  //    אם קיים שוק-USDS-חי, הניצולת/APR/עמדות הם מה שהמנוע-כתב-בפועל.
  const lend = (w.state as any)?.lend as {
    markets?: Array<{ asset: string; sMu: number; bMu: number; utilBps: number; borrowAprBps: number; supplyAprBps: number }>;
    positions?: Array<{ who: string; supplies?: Array<{ asset: string; mu: number }>; borrows?: Array<{ asset: string; debtMu: number }> }>;
    treasury?: { suppliedMu: number; earnedMu: number; supplyAprBps: number };
    totals?: { suppliesMu: number; borrowsMu: number; interestPaidMu: number; resToTreasuryMu: number; opens: number; closes: number };
  } | undefined;
  const lendUsds = lend?.markets?.find((m) => m.asset === "USDS");
  const onChain = !!(lendUsds && lendUsds.sMu > 0);
  const realUtil = onChain ? lendUsds!.utilBps / 10_000 : util;
  const realBorrowApr = onChain ? lendUsds!.borrowAprBps / 10_000 : bApr;
  const realSupplyApr = onChain ? lendUsds!.supplyAprBps / 10_000 : supplyApr;
  const realSupply = onChain ? lendUsds!.sMu / 1000 : supply;
  const realBorrowed = onChain ? lendUsds!.bMu / 1000 : borrowed;

  return {
    height: w.state?.height ?? null,
    treasuryProfitUsds: mu(w.state?.treasuryProfit),
    treasuryProfitEverUsds: mu(w.state?.income?.treasuryProfitEverMu ?? w.state?.treasuryProfit),
    // FIX(R47): THE-SAVE — החיסכון על-השרשרת: קרן, הכנסה-מדודה, שיעור-יום-אמת
    savings: {
      potUsds: mu(w.state?.savings?.potMu),
      savers: w.state?.savings?.savers ?? 0,
      paidUsds: mu(w.state?.savings?.paidMu),
      dayPaidUsds: mu(w.state?.savings?.dayPaidMu),
      dayPaidPrevUsds: mu(w.state?.savings?.dayPaidPrevMu),
      apyBps: w.state?.savings?.apyBps ?? null,
      windows: w.state?.savings?.windows ?? 0,
      demoUsds: mu(w.state?.savings?.demoMu),
      dayMarkH: w.state?.savings?.dayMarkH ?? null,
      incomeSourceUsds: mu(w.state?.savings?.incomeSourceMu),
      incomeStreams: {
        vaultInterestUsds: mu(w.state?.savings?.incomeStreams?.vaultInterestMu),
        lendReserveUsds: mu(w.state?.savings?.incomeStreams?.lendReserveMu),
        feeShareUsds: mu(w.state?.savings?.incomeStreams?.feeShareMu),
      },
      dayWindowBlocks: w.state?.savings?.dayWindowBlocks ?? null,
      feeSharePct: w.state?.savings?.feeSharePct ?? null,
    },
    fills: w.state?.fills ?? 0,
    swaps: w.state?.swaps ?? 0,
    liveOrders: w.state?.liveOrders ?? 0,
    opsTotal: w.state?.opsTotal ?? 0,
    pools: (() => {
      // r125 — מימוש החוק שנכתב בהערה ולא בוצע: ra הוא צד-הנכס a (SAOS/USDS/ENERGY),
      // לא "USDS". ערך-צד ב-USDS: לבריכה עם צד USDS — הצד הזה; לבריכה בלי צד
      // USDS — תיווך דרך מחיר SAOS/USDS (עוגן-התמחור). ערך-בריכה מלא = שני
      // הצדדים (x·y=k — שווי הצדדים שווה במחיר הבריכה). אין-נתיב-תמחור = null כנה.
      const units = pools.map((p) => ({
        key: p.key, a: p.a ?? "?", b: p.b ?? "?",
        ra: mu(p.ra), rb: mu(p.rb),
        swaps: p.swaps,
        feeAccruedUsds: mu(p.feeAccruedTreasury),
        feeBps: p.feeBps ?? null,
        lpYieldBps: p.lpYieldBps ?? null,
        derived: p.derived ?? false,
      }));
      const saosUsds = units.find((p) => p.a === "SAOS" && p.b === "USDS");
      const saosMid = saosUsds && saosUsds.ra > 0 ? saosUsds.rb / saosUsds.ra : null; // USDS ל-SAOS — יחס-נטול-סקאלה
      return units.map((p) => {
        let usdsSide: number | null = null;
        let usdsBasis: string | null = null;
        if (p.a === "USDS") { usdsSide = p.ra; usdsBasis = "צד-USDS (a) — הציטוט"; }
        else if (p.b === "USDS") { usdsSide = p.rb; usdsBasis = "צד-USDS (b) — הציטוט"; }
        else if (saosMid != null && p.a === "SAOS" && p.ra > 0) { usdsSide = p.ra * saosMid; usdsBasis = "צד-SAOS × מחיר SAOS/USDS (תיווך)"; }
        else if (saosMid != null && p.b === "SAOS" && p.rb > 0) { usdsSide = p.rb * saosMid; usdsBasis = "צד-SAOS × מחיר SAOS/USDS (תיווך)"; }
        return { ...p, usdsSide, usdsBasis, usdsFull: usdsSide != null ? usdsSide * 2 : null };
      });
    })(),
    market: {
      supplyUsds: realSupply,
      treasuryUsds, operatorUsds, arenaUsds,
      borrowedUsds: realBorrowed,
      utilization: realUtil,
      borrowApr: realBorrowApr,
      supplyApr: realSupplyApr,
      policy: MM,
      // אמת-לפני-המחשה: הדגל אומר-מאיפה המספרים — מהשרשרת-עצמה או מחושבים-מיתרות
      onChain,
      onChainNote: onChain
        ? `נתוני-השרשרת-החיה (state.lend): ${lend?.positions?.length ?? 0} עמדות · אוצר ${((lend?.treasury?.suppliedMu ?? 0) / 1000).toFixed(0)}$ מוזרם · ${lend?.totals?.opens ?? 0} מחזורים`
        : "טרם-נולד — מחושב-מיתרות-הרשת",
      onChainTotals: lend?.totals
        ? {
            interestPaidUsds: lend.totals.interestPaidMu / 1000,
            reservesToTreasuryUsds: lend.totals.resToTreasuryMu / 1000,
            opens: lend.totals.opens,
            closes: lend.totals.closes,
            treasuryEarnedUsds: (lend.treasury?.earnedMu ?? 0) / 1000,
          }
        : null,
    },
    publishedAt: (w as any).publishedAt ?? null,
  };
}

// ── צד נתיב-הכסף (money.json + grid.json + watch.json) ────────────────

async function moneySide() {
  const [m, g, k] = await Promise.all([
    jget(`${CONSOLE_BASE}/dex/money.json`),
    jget(`${CONSOLE_BASE}/dex/grid.json`),
    jget(`${CONSOLE_BASE}/dex/watch.json`),
  ]);
  return {
    powerdown: {
      active: m?.fuel?.powerdown?.active ?? false,
      weeklySp: m?.fuel?.powerdown?.rateSp ?? null,
      nextPayout: m?.fuel?.powerdown?.nextPayout ?? null,
    },
    weeklyUsd: g?.fuel?.weeklyUsd ?? null,
    grid: {
      armed: g?.armed ?? false,
      verdict: g?.verdict ?? null,
      filledTotal: g?.run?.filledTotal ?? null,
      externalFlowUsd: g?.externalFlowUsd ?? null,
      blockers: g?.blocker ?? [],
    },
    deposits: {
      total: k?.depositsTotal ?? null,
      chains: k?.chains ?? null,
      watching: k?.watching ?? null,
      cadenceMin: k?.cadenceMin ?? null,
    },
    invariantHolds: m?.invariant?.holds ?? null,
    marks: m?.marks ?? null,
  };
}

// ── הענקיות (DefiLlama — TVL חי) ────────────────────────────────────

const GIANTS: Array<{ slug: string; he: string; what: string }> = [
  { slug: "aave-v3", he: "Aave v3", what: "שוק-כספים" },
  { slug: "compound-v3", he: "Compound v3", what: "שוק-כספים" },
  { slug: "uniswap-v3", he: "Uniswap v3", what: "בורסת AMM" },
  { slug: "curve-dex", he: "Curve", what: "בורסת stableswap" },
  { slug: "yearn-finance", he: "Yearn", what: "כספות-תשואה" },
  { slug: "sky-lending", he: "Maker/Sky", what: "CDP → סטייבלקוין" },
];

async function giantsSide() {
  const one = await jget("https://api.llama.fi/protocol/aave-v3", 9000).catch(() => null);
  const all = await jget("https://api.llama.fi/protocols", 12000).catch(() => null);
  if (!all || !Array.isArray(all)) {
    return { live: false, list: [] as Array<{ he: string; what: string; tvlUsd: number | null }> };
  }
  const bySlug = new Map<string, number>();
  for (const p of all) {
    if (p?.slug && typeof p.tvl === "number") bySlug.set(p.slug, p.tvl);
  }
  // aave-v3 מופיע גם בפרוטוקול הבודד — עדיף המספר העדכני שם
  if (one?.currentChainTvls) {
    const total = Object.values(one.currentChainTvls).reduce(
      (s: number, v: any) => s + (typeof v === "number" ? v : 0), 0);
    if (total > 0) bySlug.set("aave-v3", total);
  }
  return {
    live: true,
    list: GIANTS.map((g) => ({
      he: g.he, what: g.what,
      tvlUsd: bySlug.get(g.slug) ?? null,
    })),
  };
}

// ── מטמון SWR (stale-while-revalidate) ──────────────────────────────
//
// לקח-R53 (נמדד חי ביומן ה-dev): מטמון-TTL של 60 שניות מול polling של
// 90 שניות בתצוגת-הגלגל ⇒ כל קריאת-דפדפן הייתה miss של 1.4–1.9 שניות.
// מעתה: כל תשובה אחרי הראשונה מיידית (טריה או בשלה+רענון-רקע single-flight).
// כנות: cached/stale/cacheAgeSec/refreshing בגוף + header X-SAOS-Cache.

const SWR_KEY = "api:defi";
const SWR_TTL_MS = 60_000;

export async function GET() {
  const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, composeDefi);
  return NextResponse.json(
    {
      ...value,
      cached: meta.cached,
      stale: meta.stale,
      cacheAgeSec: meta.cacheAgeSec,
      refreshing: meta.refreshing,
    },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}

async function composeDefi() {
  const down: string[] = [];
  const [world, money, giants] = await Promise.all([
    worldSide().catch((e) => { down.push(`world: ${String(e.message).slice(0, 40)}`); return null; }),
    moneySide().catch((e) => { down.push(`money: ${String(e.message).slice(0, 40)}`); return null; }),
    giantsSide().catch((e) => { down.push(`giants: ${String(e.message).slice(0, 40)}`); return null; }),
  ]);

  // ── הכספות: אסטרטגיות מהבריכות החיות בלבד ─────────────────────────
  // התשואה נמדדת ב-bps מעל הון ה-LP (lpYieldBps) — לא הבטחה. ריבית-
  // דריבית יומית (harvest יומי, כמו Yearn): APY = (1+APR/365)^365−1.
  const vaults: any[] = [];
  if (world?.pools) {
    for (const p of world.pools) {
      if (p.lpYieldBps == null) continue;
      const apr = p.lpYieldBps / 10000;
      vaults.push({
        key: p.key,
        apr,
        apy: aprToApy(apr, 365),
        // r125 — חוק הצדדים: הון ה-LP = שני צדי הבריכה במחירה, לא צד-a שסומן USDS בטעות
        tvlUsds: p.usdsFull,
        tvlBasis: p.usdsBasis,
        feesAccruedUsds: p.feeAccruedUsds,
        swaps: p.swaps,
        feeBps: p.feeBps,
      });
    }
    vaults.sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0));
  }

  // ── מצב הגלגל: כל חוליה עם המספר החי שלה ───────────────────────────
  // R122 · חוק ה-null: מקור שנפל אינו אפס-נמדד — הערך נשאר null והתצוגה
  // מציגה "—" (r119/r121: null כנה, לא אפס מומצא). ה-down[] מגלה את הכשל.
  const flywheel = {
    deposits: {
      label: "הפקדות חוץ נכנסות",
      value: money?.deposits.total ?? null,
      unit: "הפקדות",
      detail: `4 כתובות ב-4 רשתות נצפות${money?.deposits.cadenceMin != null ? ` כל ${money.deposits.cadenceMin} דק׳` : ""} — ספר פתוח`,
    },
    credit: {
      label: "זיכוי USDS",
      value: money?.deposits.total == null ? null : money.deposits.total > 0 ? "מופעל" : "מוכן",
      unit: "",
      detail: "כל הפקדה שנטענת → תביעה חתומה → זיכוי בשער הרשת",
    },
    market: {
      label: "שוק-הכספים",
      value: world?.market.supplyUsds ?? null,
      unit: "USDS",
      detail: world
        ? `ניצולת ${(100 * (world.market.utilization ?? 0)).toFixed(1)}% · ריבית הלוואה ${((world.market.borrowApr ?? 0) * 100).toFixed(2)}% APR`
        : null,
    },
    liquidity: {
      label: "נזילות הבורסה",
      // r125 — חוק הצדדים: סך-הון בבריכות (שני הצדדים במחיר כל בריכה), לא Σ צד-a מעורבב
      value: world?.pools.some((p: any) => p.usdsFull != null)
        ? world.pools.reduce((s: number, p: any) => s + (p.usdsFull ?? 0), 0)
        : null,
      unit: "USDS",
      detail: world
        ? `${world.pools.length} בריכות · ${world.swaps ?? 0} החלפות · ${world.fills ?? 0} מילויים · ערך שני הצדדים במחיר הבריכה${world.pools.some((p: any) => p.usdsFull == null) ? " · חלקי: בריכה ללא נתיב-תמחור לא נספרה" : ""}`
        : null,
    },
    fees: {
      label: "עמלות זורמות",
      value: world?.pools.reduce((s: number, p: any) => s + (p.feeAccruedUsds ?? 0), 0) ?? null,
      unit: "USDS",
      detail: "עמלות נמדדות מכל החלפה — לא מובטחות, לא מומצאות",
    },
    treasury: {
      label: "אוצר מתעצם",
      value: world?.treasuryProfitEverUsds ?? world?.treasuryProfitUsds ?? null,
      unit: "USDS",
      detail: world
        ? `מצטבר-לנצח ${(world.treasuryProfitEverUsds ?? 0).toFixed(1)} (מונוטוני — לעולם לא נשחק לדלק) · יתרה-עובדת ${(world.treasuryProfitUsds ?? 0).toFixed(1)} (מזרימה-דלק-סולם) · +10% מריבית שוק-הכספים`
        : null,
    },
    save: {
      label: "חיסכון-USDS מרוויח",
      value: world?.savings?.potUsds ?? null,
      unit: "USDS",
      detail: world?.savings
        ? `קרן ${(world.savings.potUsds ?? 0).toFixed(0)}$ · שולם-לחוסכים ${(world.savings.paidUsds ?? 0).toFixed(2)}$ · הכנסה-מדודה ${(world.savings.incomeSourceUsds ?? 0).toFixed(2)}$ (30% חית-עמלות + ריבית-כספת + עתודת-שוק)`
        : null,
    },
    grid: {
      label: "הגריד מזרים",
      value: money?.grid.externalFlowUsd ?? null,
      unit: "USD",
      detail: money
        ? `${money.weeklyUsd != null ? `powerdown ≈$${money.weeklyUsd.toFixed(2)}/שבוע` : "powerdown לא נמדד"} · ${money.grid.filledTotal ?? "—"} מילויים`
        : null,
    },
  };

  const data = {
    ok: true,
    at: new Date().toISOString(),
    world, money, giants,
    vaults,
    flywheel,
    compounding: {
      note: "APY = (1+APR/n)^n−1 · הכספות מתומחרות יומית (harvest), שוק-הכספים רציף",
      marketApy: world ? aprToApy(world.market.supplyApr, 365) : null,
      marketBorrowApy: world ? aprToApy(world.market.borrowApr, 365) : null,
    },
    down,
    honesty:
      "כל מספר נמדד חי מהקונסולה הציבורית (world/money/grid/watch.json) ומ-DefiLlama. פרמטרי עקומת-הריבית גלויים ב-full. מקור שנפל מסומן ב-down. אף תשואה אינה מובטחת — זו רשת הוכחות, לא הבטחות.",
  };
  return data;
}
