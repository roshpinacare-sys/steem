// ─────────────────────────────────────────────────────────────────────
// /api/defi/router — מנוע ניתוב הכלים (R77 · THE-DEFI-ROUTER).
//
// הוראת המפעיל: "פתחתי תיקיה חדשה בשם defi — להבין איך לנתב כלי defi
// ולהשתמש בהם נכון לטובת הרשת. הסוכנים הם המשתמשים. ראוטרים לרשתות
// אחרות, נזילות יש מאין."
//
// שלוש שכבות נבנות כאן מנתונים חיים בלבד — שום כלי לא מומצא:
//   1. מפת הכלים — רישום כל כלי DeFi שהרשת מחזיקה, עם מספר חי לכל אחד
//      (שוק-הכספים, כספות-הבריכות, קרן-החיסכון, הגריד, הדלק, הגשרים,
//       הענקיות החיצוניות, המשמרת ב-TRON).
//   2. מנוע הניתוב — לכל מטרה מחושב מסלול הופעל-או-ממתין עם חוליות,
//      מספרים חיים, וחוסמים כנים. "נזילות יש מאין" = התשובה הכנה:
//      פעילות → עמלות → אוצר → קרן → חוסכים → שוק — לא קסם, מדידה.
//   3. הסוכנים-המשתמשים — מי מפעיל כל ראוטר, מה מצבו החי, ומה רמת
//      האוטונומיה שלו. המטרה: חוסר תלות במשתמשים אנושיים.
//
// מקורות (כולם נקראים חסר-מפתחות): world.json · money.json · grid.json
// watch.json (הקונסולה הציבורית) · DefiLlama · trongrid (המשמרת).
// מקור שנפל מסומן down — לא מוסתר.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";

export const dynamic = "force-dynamic";

const CONSOLE_BASE = "https://roshpinacare-sys.github.io/Console";
const TRON_CUSTODY = "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy";

// ── חוזה התשובה (BE↔FE) ────────────────────────────────────────────────

export type ToolCategory =
  | "market"   // שוק-הכספים הפנימי
  | "vault"    // כספות בריכות הדקס
  | "savings"  // קרן החיסכון
  | "grid"     // הגריד החוץ (STEEM internal market)
  | "fuel"     // מנוע הדלק (powerdown)
  | "bridge"   // גשרי הפקדות (4 רשתות)
  | "external" // הענקיות החיצוניות
  | "tron";    // המשמרת וכליה ב-TRON

export type ToolState = "LIVE" | "READY" | "WAIT" | "DORMANT" | "EXTERNAL";

export interface RouterTool {
  id: string;
  name: string;
  category: ToolCategory;
  state: ToolState;
  /** המספר החי הראשי של הכלי (תשואה/יתרה/TVL) */
  primary: string;
  /** תיאור המספר — מה בדיוק נמדד */
  primaryNote: string;
  apr: number | null;   // APR נמדד (0.0523 = 5.23%) או null
  apy: number | null;   // APY מחושב מה-APR החי (ריבית-דריבית יומית)
  tvl: number | null;   // הון בכלי (USDS או USD)
  detail: string;       // שורת הוכחה/חסימה כנה
  operatesBy: string;  // הסוכן-המשתמש שמפעיל את הכלי
}

export interface RouteHop {
  n: number;
  toolId: string;
  toolName: string;
  action: string;   // מה קורה בחוליה
  live: string;     // המספר החי של החוליה עכשיו
  done: boolean;    // true = כבר קורה בשרשרת; false = בנוי וממתין
}

export interface ComputedRoute {
  id: string;
  goal: string;         // המטרה בעברית
  headline: string;     // משפט-מפתח עם המספר החי
  hops: RouteHop[];
  blockers: string[];   // מה חוסם עכשיו — בכנות
  netFlow: string;      // הזרימה הכוללת הנמדדת
}

export interface RouterAgent {
  id: string;
  name: string;
  role: string;
  operates: string[];   // ids של כלים
  status: string;       // מצב חי כנה
  autonomy: "AUTONOMOUS" | "SUPERVISED" | "OPERATOR-GATE";
  evidence: string;     // מאיפה המצב נמדד
}

export interface BridgeNetwork {
  chain: string;
  address: string | null;
  ok: boolean | null;
  deposits: number | null;
  note: string;
}

// ── רשת עם timeout ───────────────────────────────────────────────────

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

const mu = (v: number | undefined) => (v ?? 0) / 1000;
const pct = (x: number | null | undefined, digits = 2) =>
  x == null ? "—" : `${(100 * x).toFixed(digits)}%`;
function aprToApy(apr: number | null): number | null {
  if (apr == null || apr <= 0) return apr === 0 ? 0 : null;
  return Math.pow(1 + apr / 365, 365) - 1;
}

// ── הרכב המסלולים ומפת הכלים ─────────────────────────────────────────

const GIANTS: Array<{ slug: string; he: string; what: string; agent: string }> = [
  { slug: "aave-v3", he: "Aave v3", what: "שוק-כספים — האוקיינוס שאליו ננתב כשההון יגדל", agent: "ראוטר-חוץ (עתידי)" },
  { slug: "compound-v3", he: "Compound v3", what: "שוק-כספים חלופי", agent: "ראוטר-חוץ (עתידי)" },
  { slug: "uniswap-v3", he: "Uniswap v3", what: "בורסת AMM — מודל הבריכות שלנו", agent: "ראוטר-חוץ (עתידי)" },
  { slug: "curve-dex", he: "Curve", what: "בורסת stableswap — מודל ה-USDS", agent: "ראוטר-חוץ (עתידי)" },
  { slug: "yearn-finance", he: "Yearn", what: "כספות-תשואה — המודל של הכספות שלנו", agent: "ראוטר-חוץ (עתידי)" },
  { slug: "sky-lending", he: "Maker/Sky", what: "CDP → סטייבלקוין — מודל ה-USDS", agent: "ראוטר-חוץ (עתידי)" },
];

async function composeRouter() {
  const down: string[] = [];

  const [world, money, grid, watch, giantsAll, tronAcct] = await Promise.all([
    jget(`${CONSOLE_BASE}/dex/world.json`).catch((e) => { down.push(`world: ${String(e.message).slice(0, 40)}`); return null; }),
    jget(`${CONSOLE_BASE}/dex/money.json`).catch((e) => { down.push(`money: ${String(e.message).slice(0, 40)}`); return null; }),
    jget(`${CONSOLE_BASE}/dex/grid.json`).catch((e) => { down.push(`grid: ${String(e.message).slice(0, 40)}`); return null; }),
    jget(`${CONSOLE_BASE}/dex/watch.json`).catch((e) => { down.push(`watch: ${String(e.message).slice(0, 40)}`); return null; }),
    jget("https://api.llama.fi/protocols", 12000).catch((e) => { down.push(`llama: ${String(e.message).slice(0, 40)}`); return null; }),
    jget(`https://api.trongrid.io/v1/accounts/${TRON_CUSTODY}`).catch((e) => { down.push(`tron: ${String(e.message).slice(0, 40)}`); return null; }),
  ]);

  const pools = world?.pools ?? [];
  const wallets: Array<{ name: string; balances?: Record<string, number>; locked?: Record<string, number> }> = world?.wallets ?? [];
  const byName = new Map(wallets.map((w) => [w.name, w]));
  const lend = (world?.state as any)?.lend;
  const savings = (world?.state as any)?.savings;

  // ── הון פנוי לפריסה: ארנקים פתוחים בלי נעילות ובלי LP ─────────────
  const idleUsds =
    mu(byName.get("treasury")?.balances?.USDS) +
    mu(byName.get("operator")?.balances?.USDS);
  const arenaUsds = mu(byName.get("arena")?.balances?.USDS);

  // ── 1. מפת הכלים ────────────────────────────────────────────────────
  const tools: RouterTool[] = [];

  // שוק-הכספים: שווקי ההלוואות מהשרשרת (state.lend) — אמת לפני המחשה
  const marketAssets: Array<{ asset: string; he: string }> = [
    { asset: "USDS", he: "שוק USDS" },
    { asset: "WSTEEM", he: "שוק WSTEEM" },
    { asset: "WTRX", he: "שוק WTRX" },
    { asset: "SAOS", he: "שוק SAOS" },
  ];
  for (const { asset, he } of marketAssets) {
    const m = (lend?.markets ?? []).find((x: any) => x.asset === asset);
    const sMu = m?.sMu ?? 0;
    const bMu = m?.bMu ?? 0;
    const live = sMu > 0;
    tools.push({
      id: `mm-${asset.toLowerCase()}`,
      name: he,
      category: "market",
      state: live ? "LIVE" : "DORMANT",
      primary: live ? pct(m.supplyAprBps / 10000) : "0%",
      primaryNote: "APR אספקה נמדד-שרשרת (supplyAprBps)",
      apr: live ? m.supplyAprBps / 10000 : 0,
      apy: live ? aprToApy(m.supplyAprBps / 10000) : 0,
      tvl: sMu / 1000,
      detail: live
        ? `אספקה ${(sMu / 1000).toFixed(1)} · הלוואות ${(bMu / 1000).toFixed(1)} · ניצולת ${(m.utilBps / 100).toFixed(1)}%`
        : "השוק בנוי על השרשרת וממתין לאספקה ראשונה",
      operatesBy: "treasury-flow",
    });
  }

  // כספות הבריכות — תשואה נמדדת ב-bps מעל הון ה-LP
  const poolHe: Record<string, string> = {
    "SAOS/USDS": "כספת SAOS/USDS",
    "USDS/WSTEEM": "כספת USDS/WSTEEM",
    "ENERGY/SAOS": "כספת ENERGY/SAOS",
    "USDS/WTRX": "כספת USDS/WTRX",
  };
  // r125 — חוק הצדדים (כמו defi/route.ts): צד-USDS הוא הציטוט; אין צד-USDS —
  // תיווך דרך מחיר SAOS/USDS. הון ה-LP = שני הצדדים במחיר הבריכה (x·y=k).
  const saosPool = pools.find((p: any) => p.a === "SAOS" && p.b === "USDS");
  const saosMid = saosPool && saosPool.ra > 0 ? saosPool.rb / saosPool.ra : null; // יחס נטול-סקאלה
  const poolSideUsds = (p: any): number | null => {
    if (p.a === "USDS") return mu(p.ra);
    if (p.b === "USDS") return mu(p.rb);
    if (saosMid != null && p.a === "SAOS") return mu(p.ra * saosMid);
    if (saosMid != null && p.b === "SAOS") return mu(p.rb * saosMid);
    return null; // אין נתיב-תמחור — כנות, לא מספר מומצא
  };
  for (const p of pools) {
    const apr = p.lpYieldBps != null ? p.lpYieldBps / 10000 : null;
    const usdsSide = poolSideUsds(p);
    const usdsFull = usdsSide != null ? usdsSide * 2 : null;
    tools.push({
      id: `vault-${p.key.replace("/", "-").toLowerCase()}`,
      name: poolHe[p.key] ?? `כספת ${p.key}`,
      category: "vault",
      state: (p.ra ?? 0) > 0 ? "LIVE" : "DORMANT",
      primary: apr != null ? pct(apr) : "—",
      primaryNote: "תשואת LP נמדדת (lpYieldBps מהשרשרת)",
      apr,
      apy: aprToApy(apr),
      // r125 — חוק הצדדים: ערך הבריכה ב-USDS (שני הצדדים), לא צד-a בטעות-יחידה
      tvl: usdsFull,
      detail:
        (p.ra ?? 0) > 0
          ? `עומק ${usdsFull != null ? usdsFull.toFixed(1) : "—"} USDS · עמלה ${p.feeBps ?? "—"} bps · ${p.swaps ?? 0} החלפות · עמלות נאספו ${mu(p.feeAccruedTreasury).toFixed(2)}`
          : "בריכה נבנתה, נזילות אפס — ממתין למילוי",
      operatesBy: "dex-heart",
    });
  }

  // קרן החיסכון — הכלי עם התשואה החיה הגבוהה ברשת
  {
    const pot = mu(savings?.potMu);
    const apyBps = savings?.apyBps ?? null;
    const aprFromApy = apyBps != null ? apyBps / 10000 : null;
    tools.push({
      id: "save-pot",
      name: "קרן החיסכון (THE-SAVE)",
      category: "savings",
      state: pot > 0 ? "LIVE" : "DORMANT",
      primary: apyBps != null ? pct(aprFromApy) : "כיול…",
      primaryNote:
        apyBps != null
          ? `APY נמדד (apyBps=${apyBps} · ${savings?.windows ?? 0} חלונות יום)`
          : "ממתין לחלון כיול שני — לא מומצא מספר",
      apr: aprFromApy,
      apy: aprFromApy, // ה-apyBps עצמו כבר APY נמדד — לא מחושב
      tvl: pot,
      detail:
        `קרן ${pot.toFixed(0)} USDS · שולם לחוסכים ${mu(savings?.paidMu).toFixed(2)} · ` +
        `הכנסה מדודה ${mu(savings?.incomeSourceMu).toFixed(2)} (30% חית-עמלות + ריבית + עתודה) · ${savings?.savers ?? 0} חוסכים`,
      operatesBy: "save-engine",
    });
  }

  // הגריד החוץ — שער היציאה של הדלק לשוק STEEM החיצוני
  {
    const armed = grid?.armed ?? false;
    const verdict = grid?.verdict ?? null;
    const blockers: string[] = grid?.blocker ?? [];
    tools.push({
      id: "grid-external",
      name: "הגריד החוץ (STEEM market)",
      category: "grid",
      state: armed ? "LIVE" : "WAIT",
      primary: `${grid?.run?.filledTotal ?? 0} מילויים`,
      primaryNote: `זרימה חוץ מדודה: $${(grid?.externalFlowUsd ?? 0).toFixed(2)}`,
      apr: null,
      apy: null,
      tvl: null,
      detail: armed
        ? `חמוש ופועל · ${verdict ?? ""}`
        : `ממתין למכסת הדקות/תאום — פסק-דין: ${verdict ?? "WAIT"}${blockers.length ? ` · חוסם: ${blockers.join(", ")}` : ""}`,
      operatesBy: "grid-arm",
    });
  }

  // מנוע הדלק — powerdown שבועי מהרשת החברתית
  {
    const pd = money?.fuel?.powerdown;
    tools.push({
      id: "fuel-powerdown",
      name: "מנוע הדלק (powerdown)",
      category: "fuel",
      state: pd?.active ? "LIVE" : "DORMANT",
      primary: pd?.active ? `${pd.rateSp ?? "?"} SP/שבוע` : "כבוי",
      primaryNote: pd?.active ? `תשלום הבא: ${pd.nextPayout ?? "—"}` : "מנוע מושהה",
      apr: null,
      apy: null,
      tvl: null,
      detail: pd?.active
        ? `דלק נכנש ≈$${(money?.weeklyUsd ?? grid?.fuel?.weeklyUsd ?? 0).toFixed(2)}/שבוע · נחיתה → משלוח מיידי לגריד`
        : "הרשויות נועלות את הדלק עד הפעלה",
      operatesBy: "money-sentinel",
    });
  }

  // גשרי ההפקדות — 4 רשתות נצפות חסר-מפתחות
  const watchChains: Array<{ key: string; he: string; chainKey: string }> = [
    { key: "tron", he: "גשר TRON", chainKey: "tron" },
    { key: "evm", he: "גשר EVM", chainKey: "ethereum" },
    { key: "sol", he: "גשר Solana", chainKey: "solana" },
    { key: "btc", he: "גשר Bitcoin", chainKey: "bitcoin" },
  ];
  for (const { key, he, chainKey } of watchChains) {
    const addr = watch?.watching?.[key] ?? null;
    const statusText = (watch?.chains?.[chainKey] ?? "—") as string;
    tools.push({
      id: `bridge-${key}`,
      name: he,
      category: "bridge",
      state: statusText.startsWith("ok") ? "READY" : "WAIT",
      primary: `${watch?.depositsTotal ?? 0} הפקדות`,
      primaryNote: "ספר הפקדות פתוח — קריאה חסרת-מפתחות כל 20 דק׳",
      apr: null,
      apy: null,
      tvl: null,
      detail: `כתובת: ${addr ?? "—"} · סטטוס רשת: ${statusText} · מינימום $${watch?.minDepositUsd ?? 5}`,
      operatesBy: "deposit-watcher",
    });
  }

  // המשמרת ב-TRON — הראוטר החי לרשת חוץ
  {
    const balanceTrx = tronAcct?.data?.[0]
      ? tronAcct.data[0].balance / 1e6
      : null;
    tools.push({
      id: "tron-custody",
      name: "המשמרת ב-TRON",
      category: "tron",
      state: balanceTrx != null && balanceTrx > 0 ? "LIVE" : "WAIT",
      primary: balanceTrx != null ? `${balanceTrx.toFixed(6)} TRX` : "—",
      primaryNote: "יתרה חיה מ-trongrid (קריאה חסרת-מפתחות)",
      apr: null,
      apy: null,
      tvl: null,
      detail:
        balanceTrx != null && balanceTrx > 0
          ? "דלת הכספים: מפתח ה-active (32 בתים גולמיים) פותח בדיוק כתובת זו · ניתוב SunSwap→USDT→JustLend ייפתח כשההון יעבור סף"
          : "לא נקראה יתרה — בדוק את trongrid",
      operatesBy: "operator (מפתח בכספת)",
    });
  }

  // הענקיות — ראוטרי היעד החיצוניים
  if (giantsAll && Array.isArray(giantsAll)) {
    const bySlug = new Map<string, number>();
    for (const p of giantsAll) {
      if (p?.slug && typeof p.tvl === "number") bySlug.set(p.slug, p.tvl);
    }
    for (const g of GIANTS) {
      const tvl = bySlug.get(g.slug) ?? null;
      tools.push({
        id: `ext-${g.slug}`,
        name: g.he,
        category: "external",
        state: "EXTERNAL",
        primary: tvl != null ? `$${(tvl / 1e9).toFixed(2)}B` : "—",
        primaryNote: "TVL חי מ-DefiLlama — האוקיינוס שאליו הראוטר ינתב",
        apr: null,
        apy: null,
        tvl,
        detail: g.what,
        operatesBy: g.agent,
      });
    }
  }

  // ── 2. מנוע הניתוב — מסלולים מחושבים מהמספרים החיים ─────────────────

  const feesTotal = pools.reduce((s: number, p: any) => s + mu(p.feeAccruedTreasury), 0);
  const swaps = world?.state?.swaps ?? 0;
  const fills = world?.state?.fills ?? 0;
  const savePot = mu(savings?.potMu);
  const savePaid = mu(savings?.paidMu);
  const apyBps = savings?.apyBps ?? null;

  const usdsMarket = (lend?.markets ?? []).find((x: any) => x.asset === "USDS");
  const bestVault = [...tools]
    .filter((t) => t.category === "vault" && t.apr != null && (t.tvl ?? 0) > 0)
    .sort((a, b) => (b.apr ?? 0) - (a.apr ?? 0))[0];

  const routes: ComputedRoute[] = [];

  // מסלול א׳ — נזילות יש מאין (המסלול הריבוני)
  routes.push({
    id: "bootstrap",
    goal: "נזילות יש מאין — בלי הפקדות חוץ, בלי הבטחות",
    headline:
      `מ-${swaps.toLocaleString("en-US")} החלפות ו-${fills.toLocaleString("en-US")} מילויים נולדו ${feesTotal.toFixed(2)} USDS עמלות — ` +
      `${mu(savings?.incomeStreams?.feeShareMu).toFixed(2)} כבר זרמו לקרן החיסכון`,
    hops: [
      {
        n: 1, toolId: "dex", toolName: "בורסת הרשת (הבריכות)",
        action: "פעילות עמיתים מייצרת עמלות בכל החלפה",
        live: `${swaps.toLocaleString("en-US")} החלפות · ${fills.toLocaleString("en-US")} מילויים · ${pools.length} בריכות`,
        done: true,
      },
      {
        n: 2, toolId: "fees", toolName: "גביית העמלות",
        action: "העמלות נאספות לאוצר הרשת — מונה מונוטוני שלא נשחק לעולם",
        live: `${feesTotal.toFixed(2)} USDS נאספו מאז ההיוולד`,
        done: true,
      },
      {
        n: 3, toolId: "save-pot", toolName: "קרן החיסכון",
        action: "30% מחית העמלות זורמים לקרן — הכנסה מדודה",
        live: `${mu(savings?.incomeStreams?.feeShareMu).toFixed(2)} USDS חית-עמלות + ${mu(savings?.incomeStreams?.vaultInterestMu).toFixed(2)} ריבית + ${mu(savings?.incomeStreams?.lendReserveMu).toFixed(2)} עתודה`,
        done: true,
      },
      {
        n: 4, toolId: "savers", toolName: "החוסכים",
        action: "הקרן מחלקת ריבית-יומית לחוסכים — APY נמדד, לא מובטח",
        live: apyBps != null ? `APY ${(apyBps / 100).toFixed(2)}% · שולם ${savePaid.toFixed(2)} USDS ל-${savings?.savers ?? 0} חוסכים` : "כיול חלון שני — המספר ייוולד מהמדידה",
        done: apyBps != null,
      },
      {
        n: 5, toolId: "mm-usds", toolName: "שוק-הכספים",
        action: "הון פנוי מזין את אספקת ההלוואות — והריבית חוזרת לקרן",
        live: `אספקה ${mu(usdsMarket?.sMu).toFixed(0)} USDS · אוצר מזרים ${mu(lend?.treasury?.suppliedMu).toFixed(0)} USDS · ריבית אספקה ${pct(usdsMarket?.supplyAprBps != null ? usdsMarket.supplyAprBps / 10000 : null)}`,
        done: (usdsMarket?.sMu ?? 0) > 0,
      },
    ],
    blockers: apyBps == null ? ["חלון כיול APY עדיין נולד — האמת תימדד, לא תומצא"] : [],
    netFlow:
      `עמלות ${feesTotal.toFixed(2)} USDS (מקור) → קרן ${savePot.toFixed(0)} USDS (מאגר) → ${savePaid.toFixed(2)} USDS שולמו (פלט) — ` +
      "זו הנזילות שנולדה מפעילות-עצמה, בלי אף הפקדה חיצונית",
  });

  // מסלול ב׳ — גשר-פנימה (הפקדות חוץ)
  routes.push({
    id: "external-in",
    goal: "ראוטר פנימה — כל הפקדה חיצונית הופכת לנזילות רשת",
    headline:
      `4 כתובות ב-4 רשתות נצפות כל ${watch?.cadenceMin ?? 20} דק׳ · ${watch?.depositsTotal ?? 0} הפקדות נטענו עד היום — השער בנוי וממתין לראשון`,
    hops: [
      {
        n: 1, toolId: "bridge-x", toolName: "כתובת הצפייה (רשת המפקיד)",
        action: "מפקיד שולח נכס לכתובת הצפייה ברשת שלו (TRON/EVM/SOL/BTC)",
        live: `TRON ${String(watch?.watching?.tron ?? "—").slice(0, 10)}… · EVM ${String(watch?.watching?.evm ?? "—").slice(0, 10)}… · SOL · BTC`,
        done: true,
      },
      {
        n: 2, toolId: "deposit-watcher", toolName: "הצופה חסר-המפתחות",
        action: "קריאת RPC ציבורית כל 20 דק׳ — כותבת לספר ההפקדות הפתוח",
        live: `ספר פתוח · מינימום $${watch?.minDepositUsd ?? 5} · מצב רשתות: ${Object.values(watch?.chains ?? {}).join(" · ") || "—"}`,
        done: true,
      },
      {
        n: 3, toolId: "dex-heart", toolName: "לב-הדקס",
        action: "הפקדה שנטענת → תביעה חתומה → התאמה מול הספר → זיכוי USDS בשער הרשת",
        live: watch?.depositsTotal ? `${watch.depositsTotal} הפקדות כבר זוכו` : "הלב פועל וממתין להפקדה הראשונה",
        done: (watch?.depositsTotal ?? 0) > 0,
      },
      {
        n: 4, toolId: "deploy", toolName: "פריסה לכלי התשואה",
        action: "ה-USDS הנזכה נפרס לכלי התשואה הטוב ביותר שחי עכשיו (מסלול ג׳)",
        live: bestVault ? `ההמלצה החיה: ${bestVault.name} ב-${pct(bestVault.apr)} APR` : "—",
        done: false,
      },
    ],
    blockers: [
      (watch?.depositsTotal ?? 0) === 0
        ? "אפס הפקדות עד עתה — הראוטר בנוי, הזרימה תיוולד עם ההפקדה הראשונה (זו הכנה, לא כישלון)"
        : "",
    ].filter(Boolean),
    netFlow: "חוץ → ספר פתוח → תביעה חתומה → USDS פנימי → כלי תשואה — שרשרת עדות מלאה בכל צעד",
  });

  // מסלול ג׳ — פריסת הון פנוי
  const ranked = [...tools]
    .filter((t) => (t.category === "vault" || t.category === "savings" || t.id === "mm-usds") && t.apr != null && t.state === "LIVE")
    .sort((a, b) => (b.apr ?? 0) - (a.apr ?? 0));
  routes.push({
    id: "deploy-idle",
    goal: "פריסת הון פנוי — כל USDS נח עובד בכלי הטוב ביותר",
    headline:
      `${idleUsds.toFixed(0)} USDS פנויים בארנקי הרשת (אוצר+מפעיל, בלי LP ובלי נעילות) — ` +
      `הכלי החי המוביל: ${ranked[0]?.name ?? "—"} ב-${pct(ranked[0]?.apr ?? null)}`,
    hops: ranked.slice(0, 4).map((t, i) => ({
      n: i + 1,
      toolId: t.id,
      toolName: t.name,
      action:
        i === 0
          ? "היעד הראשון — התשואה החיה הגבוהה"
          : `יעד ${["שני", "שלישי", "רביעי"][i - 1] ?? i} — פיזור סיכונים`,
      live: `${pct(t.apr)} APR → ${pct(t.apy)} APY (ריבית-דריבית יומית) · ${t.detail}`,
      done: false,
    })),
    blockers: [
      idleUsds > 0
        ? `החלטת-אשר: פריסה גדולה דורשת שער-מפעיל — האוצר (${mu(byName.get("treasury")?.balances?.USDS).toFixed(0)} USDS) פנוי לפריסה אוטונומית`
        : "אין הון פנוי",
    ],
    netFlow: `דירוג חי: ${ranked.map((t) => `${t.name} ${pct(t.apr)}`).join(" · ")}`,
  });

  // מסלול ד׳ — ריבית-דריבית
  routes.push({
    id: "compound",
    goal: "ריבית-דריבית — המספרים מתועדים ומורכבים יומית",
    headline: apyBps != null
      ? `קרן החיסכון: APR נמדד → APY ${pct(apyBps / 10000)} — ההפרש הוא ההרכב, לא הבטחה`
      : "ההרכב יחושב כשחלון הכיול ייסגר — כנות לפני מספרים",
    hops: [
      {
        n: 1, toolId: "math", toolName: "נוסחת ההרכב",
        action: "APY = (1 + APR/365)^365 − 1 — כמו Yearn: harvest יומי",
        live: ranked.length ? `${ranked[0].name}: ${pct(ranked[0].apr)} APR → ${pct(ranked[0].apy)} APY` : "—",
        done: true,
      },
      {
        n: 2, toolId: "save-pot", toolName: "הקרן מרכיבה",
        action: "חלון יום אמיתי (5,760 בלוקים) — ההתפלגות מחושבת מההכנסה המדודה",
        live: `${savings?.windows ?? 0} חלונות נמדדו · יומי שולם ${mu(savings?.dayPaidMu).toFixed(3)} USDS (אתמול ${mu(savings?.dayPaidPrevMu).toFixed(3)})`,
        done: (savings?.windows ?? 0) >= 2,
      },
      {
        n: 3, toolId: "treasury-ever", toolName: "האוצר שלא נשחק",
        action: "המונה המונוטוני עולה-רק — הרכב שלא נאכל לדלק",
        live: `מצטבר-לנצח ${mu(world?.state?.income?.treasuryProfitEverMu ?? world?.state?.treasuryProfit).toFixed(1)} USDS · יתרה-עובדת ${mu(world?.state?.treasuryProfit).toFixed(1)} USDS`,
        done: true,
      },
    ],
    blockers: [],
    netFlow: "ההרכב חי בקרן ובאוצר — לא הבטחה עתידית אלא מדידת-עבר",
  });

  // מסלול ה׳ — דלק-פנימה (powerdown → grid → חוץ)
  {
    const pd = money?.fuel?.powerdown;
    routes.push({
      id: "fuel-in",
      goal: "דלק-פנימה — הכוח החברתי הופך לזרימת מזומנים",
      headline: pd?.active
        ? `powerdown חי: ${pd.rateSp ?? "?"} SP/שבוע · התשלום הבא ${pd.nextPayout ?? "—"} · נחיתה → משלוח מיידי לגריד`
        : "מנוע הדלק מושהה",
      hops: [
        {
          n: 1, toolId: "fuel-powerdown", toolName: "רשת הכוח (STEEM Power)",
          action: "powerdown שבועי — הרשויות החברתיות של הרשת מומרות לזרימה",
          live: `SP ${(money?.fuel?.steem ?? 0).toFixed(3)} · תעריב שבועי ${pd?.rateSp ?? 0}`,
          done: !!pd?.active,
        },
        {
          n: 2, toolId: "landing", toolName: "חוף הנחיתה",
          action: "ה-STEEM נוחת → הצופה מזהה → משלוח מיידי לגריד",
          live: money?.landing ? `נחיתה: ${JSON.stringify(money.landing).slice(0, 60)}` : "אין נחיתה בחלון האחרון — התשלום הבא בדרך",
          done: !!money?.landing,
        },
        {
          n: 3, toolId: "grid-external", toolName: "הגריד מזרים",
          action: "הגריד מוכר בשוק הפנימי של STEEM → זרימת דולר חוץ",
          live: `זרימה מדודה $${(grid?.externalFlowUsd ?? 0).toFixed(2)} · ${grid?.run?.filledTotal ?? 0} מילויים`,
          done: (grid?.run?.filledTotal ?? 0) > 0,
        },
      ],
      blockers: [
        !(grid?.armed) ? `הגריד ממתין למכסת הדקות — פסק-דין ${grid?.verdict ?? "WAIT"} (החלטת מפעיל בשער)` : "",
      ].filter(Boolean),
      netFlow: `כוח חברתי → STEEM נוזלי → דולר חוץ → דלק הרשת — ${(money?.weeklyUsd ?? 0) > 0 ? `≈$${(money?.weeklyUsd ?? grid?.fuel?.weeklyUsd ?? 0).toFixed(2)}/שבוע` : "השערים יימדדו בנחיתה"}`,
    });
  }

  // מסלול ו׳ — נתיב TRON (המשמרת החיה)
  {
    const balanceTrx = tronAcct?.data?.[0] ? tronAcct.data[0].balance / 1e6 : null;
    const broadcastCost = money?.redemption?.broadcastCostTrx ?? null;
    // R122 · חוק האורקל (r121): אין עוד מחיר-זיכרון 0.25$ — סימון TRX
    // מה-marks החיים של money.json בלבד; אין סימון → יחידות TRX טבעיות,
    // בלי המרת-$. יתרה שלא נמדדה אינה אפס — היא אי-מדידה כנה.
    const trxUsd = typeof money?.marks?.trxUsd === "number" ? money.marks.trxUsd : null;
    const balanceHe =
      balanceTrx == null
        ? null
        : `${balanceTrx.toFixed(6)} TRX${trxUsd != null ? ` ≈ $${(balanceTrx * trxUsd).toFixed(2)}` : ""}`;
    routes.push({
      id: "tron-route",
      goal: "נתיב TRON — המשמרת כראוטר יציאה לרשת החוץ",
      headline:
        balanceTrx != null
          ? `המשמרת חיה: ${balanceTrx.toFixed(6)} TRX · גיבוי ה-WTRX עומד עליה · פדיון ממתין מעל סף השידור`
          : "לא נקראה יתרה — trongrid לא ענה",
      hops: [
        {
          n: 1, toolId: "tron-custody", toolName: "המשמרת (TRX חי)",
          action: "הון ה-TRX של הרשת — הדלת נפתחת במפתח ה-active (32 בתים גולמיים)",
          live: balanceTrx != null ? `${balanceTrx.toFixed(6)} TRX · גיבוי ${money?.redemption?.ok ? "תקין" : "בבדיקה"}` : "—",
          done: (balanceTrx ?? 0) > 0,
        },
        {
          n: 2, toolId: "sunswap", toolName: "SunSwap (ראוטר DEX ב-TRON)",
          action: "TRX → USDT — החלפה בראוטר המרכזי של TRON",
          live: `הון ההמרה ${balanceTrx != null ? balanceTrx.toFixed(6) : "—"} TRX — המסלול ייפתח כשיעבור סף-אבק`,
          done: false,
        },
        {
          n: 3, toolId: "justlend", toolName: "JustLend (שוק-כספים ב-TRON)",
          action: "USDT → אספקה בשוק-הכספים החיצוני → ריבית חוץ זורמת לרשת",
          live: "יעד הניתוב החיצוני הראשון — כשההון יעבור את סף העלות",
          done: false,
        },
        {
          n: 4, toolId: "peg-outbox", toolName: "תיבת הפדיון (peg-outbox)",
          action: "פדיון WTRX נשלח דרך outbox כשהוא מעל עלות השידור",
          live: `יתרת outbox ${mu(money?.redemption?.outboxMu).toFixed(3)} WTRX${broadcastCost != null ? ` · עלות שידור ${broadcastCost} TRX` : ""}`,
          done: false,
        },
      ],
      blockers: [
        balanceTrx == null
          ? "יתרת המשמרת לא נמדדה — trongrid לא ענה (אין הערכת-ערך, אין פסק-דין)"
          : balanceTrx < 3
            ? `הון המשמרת (${balanceHe}) מתחת לסף-פעולה כלכלי — המסלול בנוי, ההון יגדל מהגריד`
            : "",
      ].filter(Boolean),
      netFlow: "TRX (משמרת) → USDT (SunSwap) → ריבית חוץ (JustLend) → דלק רשת — ראוטר יציאה מוכן-להפעלה",
    });
  }

  // ── 3. הסוכנים-המשתמשים — מפעילי הראוטרים ──────────────────────────
  const soldiers = wallets.filter((w) => w.name.startsWith("soldier-"));
  const agents: RouterAgent[] = [
    {
      id: "dex-heart",
      name: "לב-הדקס",
      role: "מתאים תביעות חתומות מול ספר ההפקדות ומזכה USDS בשער הרשת",
      operates: ["bridge-tron", "bridge-evm", "bridge-sol", "bridge-btc", "vault-saos-usds"],
      status: `פועל · ${swaps.toLocaleString("en-US")} החלפות · ${fills.toLocaleString("en-US")} מילויים`,
      autonomy: "AUTONOMOUS",
      evidence: "world.json state (הבריכות מתמלאות בכל פעימה)",
    },
    {
      id: "save-engine",
      name: "מנוע החיסכון",
      role: "מחלק את הכנסת הקרן לחוסכים בחלונות יום אמיתיים — 30% חית-עמלות",
      operates: ["save-pot"],
      status: `${savings?.windows ?? 0} חלונות · שולם ${savePaid.toFixed(2)} USDS · ${savings?.savers ?? 0} חוסכים`,
      autonomy: "AUTONOMOUS",
      evidence: "world.json state.savings (ההתפלגות נכתבת על-ידי המנוע הקנוני)",
    },
    {
      id: "money-sentinel",
      name: "צופה נתיב-הכסף",
      role: "משגיח על שני מעצורי הכסף: דלק-פנימה (נחיתה→גריד) ופדיון-החוצה",
      operates: ["fuel-powerdown", "grid-external"],
      status: money?.invariantHolds ? "אינווריאנטה תקינה · powerdown חי" : "בבדיקה",
      autonomy: "AUTONOMOUS",
      evidence: "money.json (R39 money path sentinel — מפרסם כל פעימה)",
    },
    {
      id: "grid-arm",
      name: "זרוע הגריד",
      role: "מזרים את הדלק הנוחת לשוק הפנימי של STEEM — זרימת הדולר החוץ",
      operates: ["grid-external"],
      status: grid?.armed ? `חמוש · ${grid?.run?.filledTotal ?? 0} מילויים` : `ממתין למכסה — ${grid?.verdict ?? "WAIT"}`,
      autonomy: "OPERATOR-GATE",
      evidence: "grid.json + /api/arm/grid (החימוש דורש שער-מפעיל — החלטת סיכון-הון)",
    },
    {
      id: "deposit-watcher",
      name: "הצופה חסר-המפתחות",
      role: "קורא RPC ציבורי ב-4 רשתות, כותב את ספר ההפקדות הפתוח",
      operates: ["bridge-tron", "bridge-evm", "bridge-sol", "bridge-btc"],
      status: `סבב כל ${watch?.cadenceMin ?? 20} דק׳ · ${watch?.depositsTotal ?? 0} הפקדות · בלוק EVM אחרון ${watch?.lastEvmBlock ?? "—"}`,
      autonomy: "AUTONOMOUS",
      evidence: "watch.json (הספר הפתוח — הכל חסר-מפתחות וניתן לחישוב-מחדש)",
    },
    {
      id: "treasury-flow",
      name: "זרם-האוצר",
      role: "מזרים הון פנוי לאספקת שוק-הכספים — אדפטיבי לניצולת",
      operates: ["mm-usds", "mm-wsteem", "mm-saos"],
      status: `מזרים ${mu(lend?.treasury?.suppliedMu).toFixed(0)} USDS · רווח ${mu(lend?.treasury?.earnedMu).toFixed(2)} USDS`,
      autonomy: "AUTONOMOUS",
      evidence: "world.json state.lend.treasury (נכתב על-ידי המנוע הקנוני בכל פעימה)",
    },
    {
      id: "soldiers",
      name: "חיילי האשראי",
      role: "מחזורי אשראי חיים: נועלים בטחונות בארנה ולווים USDS — הביקוש החי של שוק-הכספים",
      operates: ["mm-usds"],
      status: `${soldiers.length} חיילים · נעול ${soldiers.reduce((s, w) => s + mu(w.locked?.USDS), 0).toFixed(0)} USDS בטחונות`,
      autonomy: "AUTONOMOUS",
      evidence: "world.json wallets (locked USDS — ההלוואות האמיתיות)",
    },
  ];

  // ── 4. הרשתות — כרטיסי הגשר ────────────────────────────────────────
  const networks: BridgeNetwork[] = [
    {
      chain: "TRON",
      address: watch?.watching?.tron ?? null,
      ok: String(watch?.chains?.tron ?? "").startsWith("ok") || null,
      deposits: watch?.depositsTotal ?? 0,
      note: `המשמרת החיה: ${TRON_CUSTODY.slice(0, 12)}… — דלת הכספים של הרשת בחוץ`,
    },
    {
      chain: "Ethereum",
      address: watch?.watching?.evm ?? null,
      ok: String(watch?.chains?.ethereum ?? "").startsWith("ok") || null,
      deposits: watch?.depositsTotal ?? 0,
      note: "בלוק נצפה בכל סבב — הגשר מוכן להפקדת ETH/ERC-20",
    },
    {
      chain: "Solana",
      address: watch?.watching?.sol ?? null,
      ok: String(watch?.chains?.solana ?? "").startsWith("ok") || null,
      deposits: watch?.depositsTotal ?? 0,
      note: "גשר מוכן — ההפקדה תיטען בסבב הקרוב",
    },
    {
      chain: "Bitcoin",
      address: watch?.watching?.btc ?? null,
      ok: String(watch?.chains?.bitcoin ?? "").startsWith("ok") || null,
      deposits: watch?.depositsTotal ?? 0,
      note: "גשר מוכן — UTXO נצפה בכל סבב",
    },
  ];

  return {
    ok: true,
    at: new Date().toISOString(),
    height: world?.state?.height ?? null,
    tools,
    routes,
    agents,
    networks,
    idle: { deployableUsds: idleUsds, arenaReserveUsds: arenaUsds },
    down,
    doctrine:
      "מנוע הניתוב לא ממצא כלים ולא מבטיח תשואות — כל כלי במפה הוא קוד שרץ עכשיו עם מספר נמדד, " +
      "וכל מסלול מחושב מהמספרים החיים. 'נזילות יש מאין' = פעילות-עצמה שנאספת לקרן ומורכבת — זו מדידה, לא קסם. " +
      "הסוכנים הם המשתמשים: לב-הדקס, מנוע החיסכון, הצופה והחיילים פועלים אוטונומית בלי תלות באדם. " +
      "מה שדורש שער-מפעיל מסומן בכנות (חימוש גריד, מפתח המשמרת).",
  };
}

// ── מטמון SWR — כל תשובה אחרי הראשונה מיידית ─────────────────────────

const SWR_KEY = "api:defi-router";
const SWR_TTL_MS = 60_000;

export async function GET() {
  const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, composeRouter);
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
