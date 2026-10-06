// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Route-Planner — ראוטר-העומק הריבוני (r193).
//
// הוראת המפעיל (trace 1a1060bf3883050d): "ראוטרים שנוכל לקבל ולהחליף
// גם כבר סכומים גדולים על כל רשת... שתוכל להחזיק מטבעות אמיתיים טוקנים
// של כל הרשתות וגם שלנו... שנוכל באמת להחליף למטבע האמיתי עם ערך ולא
// סתם שקר."
//
// מה זה — מתכנן-מסלולים רב-רגלי על כל הנכסים שהריבון מחזיק:
//   · רגלי-בריכה — CPMM חי מהרזרבות (feeBps מהבריכה, עמלה נשארת-בבריכה)
//   · רגלי-פג — W*↔רשת אמיתית 1:1 (WSTEEM↔STEEM, WSBD↔SBD, WHIVE↔HIVE,
//     WHBD↔HBD, WBLURT↔BLURT, WSOL↔SOL, WETH↔ETH) — עומק חסום בגיבוי
//     (wrapSupply-חי), פדיון-אמת לא שקר (חוק L1)
//   · רגלי-USDS — mint/burn 1:1 מול נעילת-WSBD/WHBD (עומק = הנעילה)
//   · רגלי-ספר — השוק הפנימי של Steem (SBD↔STEEM) ו-Hive (HBD↔HIVE),
//     הליכת-VWAP חיה עם עומק בר-ביצוע; ביצוע דרך פקודות-גריד הריבון
//     (רצועת-orderid השמורה — חוק L2)
//   · רגלי-פדיון — SBD→STEEM ו-HBD→HIVE דרך תור-ההמרות (3.5 ימים,
//     1:1 בפיד) — הערוץ המוכח (131.856 SBD בתור כרגע)
//   · Blurt — נמדד-חי: אין ספר פנימי (rpc.blurt.blog — get_order_book
//     חסר) ⇒ רגל-מחיר CoinGecko+בריכה בלבד, בכנות
//
// חוקים: L1 (כל רגל עם עומק בר-ביצוע או null כנה) · L3 (עמלות מצוינות
// פר-רגל) · L5 (CEX = ייחוס בלבד, לא רגל-ביצוע) · L4 (אין כאן ביצוע —
// המתכנן מתכנן; הביצוע בשערים הקיימים בלבד).
// ─────────────────────────────────────────────────────────────────────

import { exchangeSnapshot, pricesUsd } from "./sovereign-exchange";
import { db } from "@/lib/db";

// ── טיפוסים ───────────────────────────────────────────────────────────

export type PlannerAsset =
  | "USDS" | "SAOS" | "WSTEEM" | "WSBD" | "WHIVE" | "WHBD"
  | "WBLURT" | "WSOL" | "WETH"
  | "STEEM" | "SBD" | "HIVE" | "HBD" | "BLURT" | "SOL" | "ETH";

export interface RouteLeg {
  kind: "pool" | "peg" | "usds" | "book" | "convert";
  venue: string;
  pair: string;
  assetIn: string;
  assetOut: string;
  /** יחס ביצוע מקומי (out per in) בעומק-הרגל */
  rate: number;
  feeBps: number;
  /** עומק בר-ביצוע מקסימלי בנכס-הכניסה (יחידות) — null = לא נמדד */
  maxIn: number | null;
  settleTimeSec: number;
  executable: boolean;
  note: string;
}

export interface RoutePlanRoute {
  id: string;
  legs: RouteLeg[];
  amountIn: number;
  outAmount: number;
  /** עומק בר-הביצוע המחייב לאורך המסלול (מינימום-ה-maxIn של הרגליים) ביחידות-קלט */
  feasibleMaxIn: number | null;
  /** מחיר ביצוע אפקטיבי מול ייחוס-ה-USD (negative = גרוע מהשוק) */
  refBps: number | null;
  settleTimeSec: number;
  executableNow: boolean;
  honesty: string[];
}

export interface RouteSplit {
  parts: Array<{ routeId: string; amountIn: number; outAmount: number }>;
  amountIn: number;
  outAmount: number;
  refBps: number | null;
  note: string;
}

export interface RoutePlan {
  at: string;
  ok: boolean;
  from: string;
  to: string;
  amountIn: number;
  amountInLabel: string;
  /** יחס-ייחוס (out per in) ממחירי-USD החיים — null כנה אם חסר */
  referenceRate: number | null;
  routes: RoutePlanRoute[];
  split: RouteSplit | null;
  markets: {
    steemBook: string;
    hiveBook: string;
    blurtBook: string;
  };
  poolsUsed: number;
  note: string;
}

// ── מתמטיקה טהורה (נבדקת) ─────────────────────────────────────────────

/** CPMM זהה-ל-quoteSwap: out = rOut·f·in/(rIn·10000 + f·in), f=10000−feeBps */
export function cpmmOutPure(amountIn: number, rIn: number, rOut: number, feeBps: number): number {
  if (!(amountIn > 0) || !(rIn > 0) || !(rOut >= 0)) return 0;
  const f = 10_000 - Math.max(0, Math.min(9_999, Math.round(feeBps)));
  const inWithFee = amountIn * f;
  return (rOut * inWithFee) / (rIn * 10_000 + inWithFee);
}

export interface BookLevel { price: number; qty: number }

/** הליכת-אסקים (קונים נכנסים): in=בסיס, out=נגד. מחיר = יחידות-in ליחידת-out. */
export function vwapWalkAsks(levels: BookLevel[], amountIn: number): { out: number; ok: boolean; maxIn: number } {
  let inLeft = amountIn;
  let out = 0;
  let maxIn = 0;
  for (const l of levels) {
    if (!(l.price > 0) || !(l.qty > 0)) continue;
    const cost = l.price * l.qty;
    maxIn += cost;
    if (inLeft <= 1e-12) break;
    const takeCost = Math.min(cost, inLeft);
    out += takeCost / l.price;
    inLeft -= takeCost;
  }
  return { out, ok: inLeft <= 1e-9, maxIn };
}

/** הליכת-בידים (מוכרים נכנסים): מוכרים out=בסיס, מקבלים in. מחיר = יחידות-in ליחידת-out. */
export function vwapWalkBids(levels: BookLevel[], amountOut: number): { inAmount: number; ok: boolean; maxOut: number } {
  let outLeft = amountOut;
  let inAmount = 0;
  let maxOut = 0;
  for (const l of levels) {
    if (!(l.price > 0) || !(l.qty > 0)) continue;
    maxOut += l.qty;
    if (outLeft <= 1e-12) break;
    const takeQty = Math.min(l.qty, outLeft);
    inAmount += takeQty * l.price;
    outLeft -= takeQty;
  }
  return { inAmount, ok: outLeft <= 1e-9, maxOut };
}

/**
 * פיצול-מים חכם: מקצה amountIn בין מסלולים לפי תשואה-שולית.
 * טהור — routes כבר quote-ו (מסלול quote-מקומי), chunks מגביל עומק-חישוב.
 */
export function waterFillPure(
  routes: Array<{ id: string; maxIn: number | null; quoteAt: (a: number) => number }>,
  amountIn: number,
  chunks = 40,
): { parts: Array<{ routeId: string; amountIn: number; outAmount: number }>; outAmount: number } | null {
  if (routes.length < 2 || !(amountIn > 0)) return null;
  const capped = routes.map((r) => (r.maxIn != null ? { ...r, cap: r.maxIn } : { ...r, cap: amountIn }));
  const alloc = new Map<string, number>(capped.map((r) => [r.id, 0]));
  const step = amountIn / chunks;
  for (let i = 0; i < chunks; i++) {
    let bestIdx = -1;
    let bestMarginal = 0;
    for (let j = 0; j < capped.length; j++) {
      const r = capped[j]!;
      const used = alloc.get(r.id) ?? 0;
      if (used + step > r.cap + 1e-12) continue;
      const marginal = r.quoteAt(used + step) - r.quoteAt(used);
      if (marginal > bestMarginal) { bestMarginal = marginal; bestIdx = j; }
    }
    if (bestIdx < 0) break; // כל המסלולים רוויים — כנה
    const rb = capped[bestIdx]!;
    alloc.set(rb.id, (alloc.get(rb.id) ?? 0) + step);
  }
  const parts = capped
    .map((r) => {
      const a = alloc.get(r.id) ?? 0;
      return { routeId: r.id, amountIn: a, outAmount: a > 0 ? r.quoteAt(a) : 0 };
    })
    .filter((p) => p.amountIn > 1e-12);
  const outAmount = parts.reduce((s, p) => s + p.outAmount, 0);
  if (!parts.length || outAmount <= 0) return null;
  return { parts, outAmount };
}

// ── עזרי-חי ───────────────────────────────────────────────────────────

const MU = 1e9;
const roundMu = (x: number) => Math.round(x * MU) / MU;

async function assetSupply(asset: string): Promise<number | null> {
  try {
    const accts = await db.exchangeAccount.findMany();
    let supply = 0;
    for (const a of accts) {
      try {
        const bal = JSON.parse(a.balances ?? "{}") as Record<string, number>;
        supply += Number(bal[asset] ?? 0) || 0;
      } catch { /* ספר-ישן */ }
    }
    const poolsA = await db.exchangePool.findMany({ where: { assetA: asset } });
    for (const p of poolsA) supply += Number(p.reserveA) || 0;
    const poolsB = await db.exchangePool.findMany({ where: { assetB: asset } });
    for (const p of poolsB) supply += Number(p.reserveB) || 0;
    return roundMu(supply);
  } catch {
    return null;
  }
}

let snapCache: { at: number; snap: Awaited<ReturnType<typeof exchangeSnapshot>> } | null = null;
let usdCache: { at: number; usd: Record<string, number | null> } | null = null;
let steemBookCache: { at: number; bids: BookLevel[]; asks: BookLevel[]; note: string } | null = null;
let hiveBookCache: { at: number; bids: BookLevel[]; asks: BookLevel[]; note: string } | null = null;

const TAP = { snap: 15_000, usd: 60_000, book: 20_000, http: 4_000 };

async function fetchSnap(): Promise<Awaited<ReturnType<typeof exchangeSnapshot>>> {
  if (snapCache && Date.now() - snapCache.at < TAP.snap) return snapCache.snap;
  const snap = await exchangeSnapshot();
  snapCache = { at: Date.now(), snap };
  return snap;
}

async function fetchUsd(): Promise<Record<string, number | null>> {
  if (usdCache && Date.now() - usdCache.at < TAP.usd) return usdCache.usd;
  const usd = await pricesUsd();
  usdCache = { at: Date.now(), usd };
  return usd;
}

interface CondenserLevel { real_price?: string; steem?: string; hive?: string; sbd?: string; hbd?: string }
interface CondenserBook { bids: CondenserLevel[]; asks: CondenserLevel[] }

/** הפורמט-הקונדנסרי: real_price + שדות-בסיס/מדד במילי-יחידות (קנון-הגלאי :3050). */
function levelsFrom(raw: CondenserLevel[] | undefined, baseKey: "steem" | "hive", quoteKey: "sbd" | "hbd"): BookLevel[] {
  const lv: BookLevel[] = [];
  for (const l of raw ?? []) {
    const qty = Number((baseKey === "steem" ? l.steem : l.hive) ?? 0) / 1000;
    const quote = Number((quoteKey === "sbd" ? l.sbd : l.hbd) ?? 0) / 1000;
    const rp = Number(l.real_price ?? 0);
    if (!(qty > 0)) continue;
    const price = quote > 0 ? quote / qty : rp;
    if (!(price > 0)) continue;
    lv.push({ price, qty });
  }
  return lv;
}

// קריאת-ספר אמיתית — condenser_api.get_order_book מחזיר {bids,asks} עם price/steem/hive + sbd/hbd
async function fetchSteemBook(): Promise<{ bids: BookLevel[]; asks: BookLevel[]; note: string } | null> {
  if (steemBookCache && Date.now() - steemBookCache.at < TAP.book) return steemBookCache;
  const RPCS = ["https://api.steemit.com", "https://api.justyy.com"];
  for (const rpc of RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "saos-sovereign/1.0" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_order_book", params: [100], id: 1 }),
        signal: AbortSignal.timeout(TAP.http),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { result?: CondenserBook };
      if (!j?.result?.asks || !j?.result?.bids) continue;
      const out = {
        bids: levelsFrom(j.result.bids, "steem", "sbd"),
        asks: levelsFrom(j.result.asks, "steem", "sbd"),
        note: `${rpc} · bids=${j.result.bids.length} asks=${j.result.asks.length}`,
      };
      steemBookCache = { at: Date.now(), ...out };
      return out;
    } catch { /* ה-RPC הבא */ }
  }
  steemBookCache = { at: Date.now(), bids: [], asks: [], note: "DOWN" };
  return steemBookCache;
}

async function fetchHiveBook(): Promise<{ bids: BookLevel[]; asks: BookLevel[]; note: string } | null> {
  if (hiveBookCache && Date.now() - hiveBookCache.at < TAP.book) return hiveBookCache;
  try {
    const res = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "saos-sovereign/1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_order_book", params: [100], id: 1 }),
      signal: AbortSignal.timeout(TAP.http),
      cache: "no-store",
    });
    if (res.ok) {
      const j = (await res.json()) as { result?: CondenserBook };
      if (j?.result?.asks && j?.result?.bids) {
        const out = {
          bids: levelsFrom(j.result.bids, "hive", "hbd"),
          asks: levelsFrom(j.result.asks, "hive", "hbd"),
          note: `api.hive.blog · bids=${j.result.bids.length} asks=${j.result.asks.length}`,
        };
        hiveBookCache = { at: Date.now(), ...out };
        return out;
      }
    }
  } catch { /* כנה */ }
  hiveBookCache = { at: Date.now(), bids: [], asks: [], note: "DOWN" };
  return hiveBookCache;
}

// ── בניית-הגרף ────────────────────────────────────────────────────────

interface EdgeNode {
  kind: RouteLeg["kind"];
  venue: string;
  assetIn: string;
  assetOut: string;
  feeBps: number;
  settleTimeSec: number;
  executable: boolean;
  note: string;
  /** quote מקומי: כמה out בעומק-in זה */
  quote: (amountIn: number) => { out: number; maxIn: number | null };
}

const PEGS: Array<[string, string, string]> = [
  // [wrapped, real, רשת]
  ["WSTEEM", "STEEM", "steem"], ["WSBD", "SBD", "steem"],
  ["WHIVE", "HIVE", "hive"], ["WHBD", "HBD", "hive"],
  ["WBLURT", "BLURT", "blurt"], ["WSOL", "SOL", "solana"], ["WETH", "ETH", "ethereum"],
];

async function buildEdges(): Promise<{ edges: EdgeNode[]; markets: RoutePlan["markets"]; poolsUsed: number }> {
  const snap = await fetchSnap();
  const edges: EdgeNode[] = [];

  // 1) רגלי-בריכה — רק בריכות עם רזרבות (אבק אמיתי מדווח כנה ב-note)
  let poolsUsed = 0;
  for (const p of snap.pools) {
    const has = p.reserveA > 0 && p.reserveB > 0;
    if (has) poolsUsed += 1;
    edges.push({
      kind: "pool", venue: "saos-dex", assetIn: p.assetA, assetOut: p.assetB,
      feeBps: p.feeBps, settleTimeSec: 0, executable: true,
      note: has ? `בריכה חיה · fee ${p.feeBps}bps` : "בריכת-אבק — עומק-0 כנה",
      quote: (a) => ({
        out: roundMu(cpmmOutPure(a, p.reserveA, p.reserveB, p.feeBps)),
        maxIn: has ? roundMu(p.reserveA * 0.05) : 0,
      }),
    });
    edges.push({
      kind: "pool", venue: "saos-dex", assetIn: p.assetB, assetOut: p.assetA,
      feeBps: p.feeBps, settleTimeSec: 0, executable: true,
      note: has ? `בריכה חיה · fee ${p.feeBps}bps` : "בריכת-אבק — עומק-0 כנה",
      quote: (a) => ({
        out: roundMu(cpmmOutPure(a, p.reserveB, p.reserveA, p.feeBps)),
        maxIn: has ? roundMu(p.reserveB * 0.05) : 0,
      }),
    });
  }

  // 2) רגלי-פג — גיבוי-חי מהספר (wrapSupply) — פדיון-אמת 1:1 (חוק L1)
  for (const [w, real] of PEGS) {
    const supplyW = await assetSupply(w);
    const supplyR = await assetSupply(real);
    const cap = Math.min(supplyW ?? 0, supplyR ?? 0);
    for (const [a, b] of [[w, real], [real, w]] as const) {
      edges.push({
        kind: "peg", venue: "wrap-rail", assetIn: a, assetOut: b,
        feeBps: 0, settleTimeSec: 0, executable: true,
        note: supplyW == null || supplyR == null
          ? "גיבוי לא נמדד — רגל מסומנת ולא מדויקת (r124)"
          : `פדיון-אמת 1:1 · גיבוי ${roundMu(cap)}`,
        quote: (amt) => ({ out: roundMu(amt), maxIn: supplyW == null || supplyR == null ? null : roundMu(cap) }),
      });
    }
  }

  // 3) רגלי-USDS — mint/burn 1:1 מול נעילת-צמודים
  const usdsSupply = await assetSupply("USDS");
  for (const stable of ["WSBD", "WHBD"] as const) {
    const sSupply = await assetSupply(stable);
    const cap = Math.min(usdsSupply ?? 0, sSupply ?? 0);
    edges.push({
      kind: "usds", venue: "usds-rail", assetIn: stable, assetOut: "USDS",
      feeBps: 0, settleTimeSec: 0, executable: true,
      note: `burn 1:1 · נעילה ${roundMu(cap)}`,
      quote: (a) => ({ out: roundMu(a), maxIn: cap }),
    });
    edges.push({
      kind: "usds", venue: "usds-rail", assetIn: "USDS", assetOut: stable,
      feeBps: 0, settleTimeSec: 0, executable: true,
      note: `mint 1:1 · נעילה ${roundMu(cap)}`,
      quote: (a) => ({ out: roundMu(a), maxIn: cap }),
    });
  }

  // 4) רגלי-ספר — השווקים הפנימיים (ביצוע דרך מנועי-הגריד, רצועת-orderid-שמורה)
  const stBook = await fetchSteemBook();
  const hvBook = await fetchHiveBook();
  if (stBook && (stBook.asks.length || stBook.bids.length)) {
    edges.push({
      kind: "book", venue: "steem-internal", assetIn: "SBD", assetOut: "STEEM",
      feeBps: 0, settleTimeSec: 0, executable: true,
      note: `ספר-פנימי חי (${stBook.note}) — ביצוע דרך פקודות-גריד הריבון`,
      quote: (a) => { const w = vwapWalkAsks(stBook.asks, a); return { out: roundMu(w.out), maxIn: roundMu(w.maxIn) }; },
    });
    edges.push({
      kind: "book", venue: "steem-internal", assetIn: "STEEM", assetOut: "SBD",
      feeBps: 0, settleTimeSec: 0, executable: true,
      note: `ספר-פנימי חי (${stBook.note}) — ביצוע דרך פקודות-גריד הריבון`,
      quote: (a) => {
        // a ביחידות-STEEM (נכס-הכניסה); הבידים נסחרים STEEM→SBD
        const w = vwapWalkBids(stBook.bids, a);
        return { out: roundMu(w.inAmount), maxIn: roundMu(w.maxOut) };
      },
    });
  }
  if (hvBook && (hvBook.asks.length || hvBook.bids.length)) {
    edges.push({
      kind: "book", venue: "hive-internal", assetIn: "HBD", assetOut: "HIVE",
      feeBps: 0, settleTimeSec: 0, executable: true,
      note: `ספר-פנימי חי (${hvBook.note}) — ביצוע דרך פקודות-גריד הריבון`,
      quote: (a) => { const w = vwapWalkAsks(hvBook.asks, a); return { out: roundMu(w.out), maxIn: roundMu(w.maxIn) }; },
    });
    edges.push({
      kind: "book", venue: "hive-internal", assetIn: "HIVE", assetOut: "HBD",
      feeBps: 0, settleTimeSec: 0, executable: true,
      note: `ספר-פנימי חי (${hvBook.note}) — ביצוע דרך פקודות-גריד הריבון`,
      quote: (a) => {
        // a ביחידות-HIVE (נכס-הכניסה); הבידים נסחרים HIVE→HBD
        const w = vwapWalkBids(hvBook.bids, a);
        return { out: roundMu(w.inAmount), maxIn: roundMu(w.maxOut) };
      },
    });
  }

  // 5) רגלי-פדיון — תור-ההמרות (הערוץ-המוכח: 1:1 בפיד, 3.5 ימים)
  const stFeed = await fetchSteemFeedRate();
  if (stFeed) {
    edges.push({
      kind: "convert", venue: "convert-queue", assetIn: "SBD", assetOut: "STEEM",
      feeBps: 0, settleTimeSec: 302_400, executable: true,
      note: `המרת-SBD→STEEM בפיד ${stFeed.toFixed(6)} · 3.5 ימים · הערוץ-המוכח (131.856 SBD בתור)`,
      quote: (a) => ({ out: roundMu(a / stFeed), maxIn: null }),
    });
  }
  const hvFeed = await fetchHiveFeedRate();
  if (hvFeed) {
    edges.push({
      kind: "convert", venue: "convert-queue", assetIn: "HBD", assetOut: "HIVE",
      feeBps: 0, settleTimeSec: 302_400, executable: true,
      note: `המרת-HBD→HIVE בפיד ${hvFeed.toFixed(6)} · 3.5 ימים`,
      quote: (a) => ({ out: roundMu(a / hvFeed), maxIn: null }),
    });
  }

  const markets: RoutePlan["markets"] = {
    steemBook: stBook ? (stBook.asks.length || stBook.bids.length ? `חי (${stBook.note})` : "ריק כנה") : "לא זמין",
    hiveBook: hvBook ? (hvBook.asks.length || hvBook.bids.length ? `חי (${hvBook.note})` : "ריק כנה") : "לא זמין",
    blurtBook: "אין ספר-פנימי — נמדד-חי (rpc.blurt.blog: get_order_book חסר)",
  };
  return { edges, markets, poolsUsed };
}

let stFeedCache: { at: number; rate: number | null } | null = null;
async function fetchSteemFeedRate(): Promise<number | null> {
  // SBD ל-STEEM (מחיר-STEEM ב-SBD) — מהפיד החי
  if (stFeedCache && Date.now() - stFeedCache.at < TAP.book) return stFeedCache.rate;
  try {
    const res = await fetch("https://api.steemit.com", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "saos-sovereign/1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_current_median_history_price", params: [], id: 1 }),
      signal: AbortSignal.timeout(TAP.http),
      cache: "no-store",
    });
    const j = (await res.json()) as { result?: { base: string; quote: string } };
    const m = j?.result ? j.result.base.match(/^([\d.]+)\s+SBD$/) : null;
    const q = j?.result ? j.result.quote.match(/^([\d.]+)\s+STEEM$/) : null;
    const rate = m && q ? Number(m[1]) / Number(q[1]) : null;
    stFeedCache = { at: Date.now(), rate };
    return rate;
  } catch { return null; }
}

let hvFeedCache: { at: number; rate: number | null } | null = null;
async function fetchHiveFeedRate(): Promise<number | null> {
  if (hvFeedCache && Date.now() - hvFeedCache.at < TAP.book) return hvFeedCache.rate;
  try {
    const res = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "saos-sovereign/1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_current_median_history_price", params: [], id: 1 }),
      signal: AbortSignal.timeout(TAP.http),
      cache: "no-store",
    });
    const j = (await res.json()) as { result?: { base: string; quote: string } };
    const m = j?.result ? j.result.base.match(/^([\d.]+)\s+HBD$/) : null;
    const q = j?.result ? j.result.quote.match(/^([\d.]+)\s+HIVE$/) : null;
    const rate = m && q ? Number(m[1]) / Number(q[1]) : null;
    hvFeedCache = { at: Date.now(), rate };
    return rate;
  } catch { return null; }
}

// ── חיפוש-מסלולים ─────────────────────────────────────────────────────

const MAX_HOPS = 3;
const MAX_ROUTES = 6;

/** מחיר-USD מקנון-הריפו (מפתחות-קטניות) עם-מיפוי-עטיפות; USDS משווק-ל-SBD (גיבוי-1:1). */
function usdFor(asset: string, usd: Record<string, number | null>): number | null {
  const MAP: Record<string, string> = {
    WSTEEM: "steem", WSBD: "sbd", WHIVE: "hive", WHBD: "hbd",
    WBLURT: "blurt", WSOL: "sol", WETH: "eth",
    STEEM: "steem", SBD: "sbd", HIVE: "hive", HBD: "hbd",
    BLURT: "blurt", SOL: "sol", ETH: "eth",
    USDS: "sbd", // כנות-L5: USDS מגובה 1:1 ב-WSBD
  };
  const k = MAP[asset.toUpperCase()];
  return k ? (usd[k] ?? null) : null;
}

export async function planRoutes(from: string, to: string, amountIn: number): Promise<RoutePlan> {
  const at = new Date().toISOString();
  const amount = Math.max(0, Number(amountIn) || 0);
  if (!(amount > 0)) {
    return { at, ok: false, from, to, amountIn: amount, amountInLabel: "0", referenceRate: null, routes: [], split: null, markets: { steemBook: "—", hiveBook: "—", blurtBook: "—" }, poolsUsed: 0, note: "amountIn חייב להיות חיובי" };
  }
  const { edges, markets, poolsUsed } = await buildEdges();
  const usd = await fetchUsd();

  // יחס-ייחוס ממחירי-USD (מיפוי-עטיפות + מפתחות-קטניות)
  let referenceRate: number | null = null;
  const pFrom = usdFor(from, usd);
  const pTo = usdFor(to, usd);
  if (pFrom != null && pTo != null && pTo > 0) referenceRate = pFrom / pTo;

  // DFS עד 3 קפיצות
  const adj = new Map<string, EdgeNode[]>();
  for (const e of edges) {
    if (!adj.has(e.assetIn)) adj.set(e.assetIn, []);
    adj.get(e.assetIn)!.push(e);
  }
  const routes: RoutePlanRoute[] = [];
  const seen: string[] = [];

  const dfs = (asset: string, path: EdgeNode[], visited: Set<string>, hops: number): void => {
    if (hops > MAX_HOPS) return;
    if (asset === to && path.length > 0) {
      // quote לאורך המסלול
      let cur = amount;
      const legs: RouteLeg[] = [];
      let feasible = true;
      let feasibleMaxIn: number | null = null;
      let settle = 0;
      for (const e of path) {
        const q = e.quote(cur);
        if (!(q.out > 0)) { feasible = false; break; }
        legs.push({
          kind: e.kind, venue: e.venue, pair: `${e.assetIn}/${e.assetOut}`,
          assetIn: e.assetIn, assetOut: e.assetOut,
          rate: cur > 0 ? q.out / cur : 0, feeBps: e.feeBps,
          maxIn: q.maxIn, settleTimeSec: e.settleTimeSec,
          executable: e.executable, note: e.note,
        });
        if (q.maxIn != null) feasibleMaxIn = feasibleMaxIn == null ? q.maxIn : Math.min(feasibleMaxIn, q.maxIn);
        if (q.maxIn != null && cur > q.maxIn) feasible = false;
        settle += e.settleTimeSec;
        cur = q.out;
      }
      if (!legs.length) return;
      const outAmount = roundMu(cur);
      const refBps = referenceRate != null && referenceRate > 0
        ? Math.round(((outAmount / amount) / referenceRate - 1) * 1e4)
        : null;
      const honesty: string[] = [];
      if (!feasible) honesty.push("עומק-לא-מספיק-לכל-הסכום — כנה (L1); חצה-דרך-פיצול או סכום-קטן");
      if (legs.some((l) => l.settleTimeSec > 0)) honesty.push("כולל רגל-פדיון מושהית (תור-ההמרות ~3.5 ימים) — ערך-אמת, לא שקר");
      if (referenceRate == null) honesty.push("אין ייחוס-USD לאחד הצדדים — refBps כנה-null");
      if (legs.every((l) => l.executable)) honesty.push("כל-הרגליים בנתיבי-ביצוע-קיימים של הריבון");
      routes.push({
        id: `${path.map((p) => p.assetOut).join(">")}`,
        legs, amountIn: amount, outAmount,
        feasibleMaxIn: feasibleMaxIn == null ? null : roundMu(feasibleMaxIn),
        refBps, settleTimeSec: settle,
        executableNow: feasible && legs.every((l) => l.executable),
        honesty,
      });
      return;
    }
    if (visited.has(asset)) return;
    visited.add(asset);
    seen.push(asset);
    const outs = adj.get(asset) ?? [];
    for (const e of outs) {
      if (path.some((p) => p.venue === e.venue && p.assetIn === e.assetIn && p.assetOut === e.assetOut)) continue;
      path.push(e);
      dfs(e.assetOut, path, visited, hops + 1);
      path.pop();
    }
    visited.delete(asset);
    seen.pop();
  };

  dfs(from, [], new Set(), 0);

  // מיון: ברי-ביצוע קודם, אחר-כך לפי outAmount
  routes.sort((a, b) => {
    if (a.executableNow !== b.executableNow) return a.executableNow ? -1 : 1;
    return b.outAmount - a.outAmount;
  });
  const top = routes.slice(0, MAX_ROUTES);

  // פיצול-מים על שני-המסלולים-המובילים (חתימות-venue שונות)
  let split: RouteSplit | null = null;
  if (top.length >= 2 && referenceRate != null) {
    const a = top[0]!;
    const b = top[1]!;
    const sig = (r: RoutePlanRoute) => r.legs.map((l) => l.venue).join("+");
    if (sig(a) !== sig(b)) {
      const mkQuote = (r: RoutePlanRoute) => (x: number) => {
        let cur = x;
        for (const l of r.legs) {
          // הליכה-מחדש דרך אותן רגליים (rate מקומי לא לינארי בבריכות — מקורב דרך רגל-אחת)
          const edge = edges.find((e) => e.assetIn === l.assetIn && e.assetOut === l.assetOut && e.venue === l.venue);
          if (!edge) return 0;
          const q = edge.quote(cur);
          cur = q.out;
        }
        return cur;
      };
      const wf = waterFillPure(
        [{ id: a.id, maxIn: a.feasibleMaxIn, quoteAt: mkQuote(a) }, { id: b.id, maxIn: b.feasibleMaxIn, quoteAt: mkQuote(b) }],
        amount,
      );
      if (wf) {
        const singleBest = Math.max(a.outAmount, b.outAmount);
        if (wf.outAmount > singleBest + 1e-9) {
          split = {
            parts: wf.parts,
            amountIn: amount,
            outAmount: roundMu(wf.outAmount),
            refBps: Math.round(((wf.outAmount / amount) / referenceRate - 1) * 1e4),
            note: "פיצול-מים בין שני-המסלולים המובילים — מקסום-יציאה לסכום-גדול",
          };
        }
      }
    }
  }

  const note = top.length
    ? `${top.length} מסלולים נמדדו על עומק חי · poolsUsed=${poolsUsed}`
    : "אין מסלול — כנה (אפס-עומק בכל הרגליים האפשריות)";
  return { at, ok: top.length > 0, from, to, amountIn: amount, amountInLabel: `${amount}`, referenceRate, routes: top, split, markets, poolsUsed, note };
}
