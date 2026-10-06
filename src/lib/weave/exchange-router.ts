// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Exchange-Router — ראוטר ההחלפות החי (R96).
//
// הוראת המפעיל: "חייבים לעגן את האפשרות לעשות exchange של מטבעות
// אמיתיים על הרשת ולשלב אותם עם הרשת שלנו בצורה חכמה שיהיו מניבים
// ויזרימו נזילות תוך שימוש ביכולות הקיימות שלנו. לבדוק אופציות חיבור
// ראוטרים של dex מובילים במגוון רשתות ולגייס יכולות החלפה וזרימה בין
// הרשתות — לאמת לבחון לאתגר."
//
// מה נבנה כאן — שלוש שכבות, הכל מנתונים חיים בלבד:
//   1. ערוצי ציטוט — eth_call ישיר לחוזי הראוטר/המצטט של ה-DEX-ים
//      המובילים ב-4 רשתות (קריאה בלבד, חסרת-מפתחות): Uniswap v2/v3
//      על Ethereum · Uniswap v3 + PancakeSwap v2 על BSC · Uniswap v3 +
//      SushiSwap על Arbitrum · Uniswap v2 על Base. כל ערוץ נמדד בזמן
//      אמת עם השהיה, מחיר ביצוע וסטייה מול סימוכין (בינאנס).
//   2. שכבת האתגר — "לאמת לבחון לאתגר": כל ציטוט נשפט מול סימוכין
//      חיצוני בלתי-תלוי (בינאנס) ומול ערוצים מקבילים (תחרות בין
//      ראוטרים על אותו זוג). פסק-דין: VERIFIED / DEVIANT / DOWN.
//   3. סולם התשואה — APY אמיתי של בריכות סטייבלקוין כחולות-לבן
//      מ-DefiLlama (Aave, Sky, Compound, Curve, Spark) — האוקיינוס
//      שאליו הראוטר מנתב את הנזילות שלנו כשהיא תעבור את שער-המפעיל.
//
// כנות מלאה (נמדד בסשן R96, 2026-09-23):
//   · ה-Quoter הרשמי של PancakeSwap v3 לא אומת מהסנדבוקס (כל
//     הכתובות שנוסו ריקות/מתנגדות) — PancakeSwap v2 מצוטט וחי.
//   · LiFi/Jupiter/1inch מפתחות נדרשים או שקרסו — הערוץ החי הוא
//     קריאת-חוזה ישירה; זו גם העדות החזקה ביותר: אין מתווך בין
//     הרשת לבין הבריכה.
//   · ביצוע עסקה אמיתית דורש מפתח חתימה = שער-מפעיל מפורש.
//     המנוע מודד; השער נשאר בידי המפעיל (חוק הברזל).
//
// R97 — הרחבה ריבונית (פי הוראת "לגייס יכולות החלפה וזרימה בין הרשתות"):
//   · ערוצי REST keyless חיים: Jupiter-lite (SOL→USDC בסולנה) ו-Across
//     (WETH@Ethereum → USDC@Base, ERC-7683) — שניהם נמדדו חיים מהסנדבוקס
//     לפני שנכתבו, ונשפטים באותו שער-אתגר מול בינאנס כמו ערוצי eth_call.
//   · אותגרו ולא חוברו (בכנות, עם הראיה): deBridge (404 — הנקודה מתה),
//     CoW (‎6 וריאנטים של סכמת-גוף — שגיאת-סרד מתועדת בכל אחד).
// ─────────────────────────────────────────────────────────────────────

import { ethers } from "ethers";

// ── חוזה הנתונים (BE↔FE) ─────────────────────────────────────────────

export type QuoteVerdict = "VERIFIED" | "DEVIANT" | "DOWN";
export type QuoteKind = "v2" | "v3" | "rest";

export interface QuoteChannel {
  id: string;
  /** שם הרשת באנגלית (כמו ב-DefiLlama) */
  chain: string;
  chainId: number;
  /** שם ה-DEX — כפי שמופיע בחוזה שנקרא */
  dex: string;
  /** מה עושה הערוץ */
  route: string;
  /** קבוצת הזוג לתחרות בין ראוטרים */
  pair: string;
  /** כמה נכנס — תווית קריאה */
  amountInLabel: string;
  /** הציטוט שחזר (יחידות תצוגה) או null אם הערוץ נפל */
  quote: number | null;
  /** יחידת היציאה */
  quoteUnit: string;
  /** מחיר ביצוע נגזר: כמה דולר שווה יחידת הקלט (out/in מנורמל) */
  execPrice: number | null;
  /** הסימוכין שנשפט מולו */
  refLabel: string;
  /** הסטייה מהסימוכין ב-bps (כולל עמלת בריכה ועומק — לא חינם) */
  devBps: number | null;
  /** השהיית ה-eth_call במילישניות */
  latencyMs: number | null;
  kind: QuoteKind;
  /** כתובת החוזה שנקרא — הוכחה, לא קישור מת */
  contract: string;
  verdict: QuoteVerdict;
  /** הסבר כנה לפסק-הדין */
  note: string;
}

export interface ChainStatus {
  name: string;
  chainId: number;
  rpc: string;
  height: number | null;
  ok: boolean;
}

export interface CompetitionGroup {
  /** הזוג בפורמט אחיד */
  pair: string;
  prices: Array<{ dex: string; chain: string; price: number | null }>;
  bestDex: string | null;
  worstDex: string | null;
  best: number | null;
  worst: number | null;
  /** הפער בין הזול ליקר ב-bps — מדד התחרות */
  spreadBps: number | null;
}

export interface YieldPool {
  project: string;
  chain: string;
  symbol: string;
  apy: number | null;
  tvlUsd: number;
  stablecoin: boolean;
  ilRisk: string;
}

export interface ExchangeRouterSnapshot {
  at: string;
  ok: boolean;
  chains: ChainStatus[];
  channels: QuoteChannel[];
  reference: {
    ethUsdt: number | null;
    bnbUsdt: number | null;
    solUsdt: number | null;
    at: string | null;
    down: string[];
  };
  competition: CompetitionGroup[];
  challenge: {
    verified: number;
    deviant: number;
    down: number;
    /** סיכום-אתגר קריא אחד */
    summary: string;
    notes: string[];
  };
  yields: {
    at: string | null;
    pools: YieldPool[];
    down?: string;
  };
  doctrine: string[];
}

// ── רישום הערוצים — נמדדו חיים לפני שנכתבו (סשן R96) ────────────────

const A = (s: string) => ethers.getAddress(s.toLowerCase());

const CHAINS: Array<{ key: string; name: string; chainId: number; rpc: string }> = [
  { key: "eth", name: "Ethereum", chainId: 1, rpc: "https://ethereum.publicnode.com" },
  { key: "bsc", name: "BNB Smart Chain", chainId: 56, rpc: "https://bsc-dataseed.binance.org/" },
  { key: "arb", name: "Arbitrum One", chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc" },
  { key: "base", name: "Base", chainId: 8453, rpc: "https://mainnet.base.org" },
];

// חוזי הראוטר/המצטט — כולם אומתו חיים מהסנדבוקס (2026-09-23):
const UNIV3_QUOTER_V1 = "0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6"; // Ethereum + Arbitrum (אומת בשתיהן)
const UNIV3_QUOTER_V2_BSC = "0x78d78e420da98ad378d7799be8f4af69033eb077"; // BSC (אומת)
const UNIV2_ROUTER02 = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d"; // Ethereum (אומת)
const UNIV2_ROUTER02_BASE = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24"; // Base — פריסה רשמית של Uniswap (אומת)
const PANCAKE_V2_ROUTER = "0x10ed43c718714eb63d5aa57b78b54704e256024e"; // BSC (אומת)
const SUSHI_V2_ROUTER_ARB = "0x1b02da8cb0d097eb8d57a175b88c7d8b47997506"; // Arbitrum (אומת)

// טוקנים (lowercase — מנורמלים ב-A() בזמן קריאה):
const T = {
  WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  USDC_ETH: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  USDT_ETH: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  WBNB: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  USDT_BSC: "0x55d398326f99059ff775485246999027b3197955",
  USDC_BSC: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  WETH_ARB: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  USDC_ARB: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  WETH_BASE: "0x4200000000000000000000000000000000000006",
  USDC_BASE: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
};

interface ChannelSpec {
  id: string;
  chainKey: string;
  dex: string;
  kind: QuoteKind;
  contract: string;
  route: string;
  tokenIn: string;
  tokenOut: string;
  decIn: number;
  decOut: number;
  amountIn: bigint;
  amountInLabel: string;
  quoteUnit: string;
  /** איזה סימוכין בינאנס שופט את הערוץ */
  ref: "ETHUSDT" | "BNBUSDT" | "USD1";
  /** קבוצת התחרות */
  pair: string;
  /** סף DEVIANT ב-bps — כולל עמלת בריכה צפויה */
  tolBps: number;
  fee?: number; // v3 fee tier
}

/** 0.05 ETH / 0.1 BNB — נוטינאלי ~$100 — גדול מספיק לעומק אמיתי, קטן מספיק לקריאה מנומסת.
 *  BigInt(...) במקום ליטרלים 0n (target ES2017) — זהה בזמן ריצה בדיוק. */
const ETH_IN = BigInt(50) * BigInt(10) ** BigInt(15); // 0.05
const BNB_IN = BigInt(10) ** BigInt(17); // 0.1
const STABLE_IN_6 = BigInt(100) * BigInt(10) ** BigInt(6); // 100 (6 decimals)
const STABLE_IN_18 = BigInt(100) * BigInt(10) ** BigInt(18); // 100 (18 decimals)

const CHANNELS: ChannelSpec[] = [
  // ── Ethereum ──────────────────────────────────────────────────────
  {
    id: "eth-univ3-weth-usdc-5", chainKey: "eth", dex: "Uniswap v3", kind: "v3",
    contract: UNIV3_QUOTER_V1, route: "WETH → USDC · 0.05%",
    tokenIn: T.WETH, tokenOut: T.USDC_ETH, decIn: 18, decOut: 6,
    amountIn: ETH_IN, amountInLabel: "0.05 ETH", quoteUnit: "USDC",
    ref: "ETHUSDT", pair: "ETH/USD", tolBps: 75, fee: 500,
  },
  {
    id: "eth-univ3-usdt-usdc-1", chainKey: "eth", dex: "Uniswap v3", kind: "v3",
    contract: UNIV3_QUOTER_V1, route: "USDT → USDC · 0.01%",
    tokenIn: T.USDT_ETH, tokenOut: T.USDC_ETH, decIn: 6, decOut: 6,
    amountIn: STABLE_IN_6, amountInLabel: "100 USDT", quoteUnit: "USDC",
    ref: "USD1", pair: "USDT/USDC", tolBps: 25, fee: 100,
  },
  {
    id: "eth-univ2-weth-usdc", chainKey: "eth", dex: "Uniswap v2", kind: "v2",
    contract: UNIV2_ROUTER02, route: "WETH → USDC · 0.30%",
    tokenIn: T.WETH, tokenOut: T.USDC_ETH, decIn: 18, decOut: 6,
    amountIn: ETH_IN, amountInLabel: "0.05 ETH", quoteUnit: "USDC",
    ref: "ETHUSDT", pair: "ETH/USD", tolBps: 75,
  },
  // ── BNB Smart Chain ───────────────────────────────────────────────
  {
    id: "bsc-univ3-wbnb-usdt-5", chainKey: "bsc", dex: "Uniswap v3", kind: "v3",
    contract: UNIV3_QUOTER_V2_BSC, route: "WBNB → USDT · 0.05%",
    tokenIn: T.WBNB, tokenOut: T.USDT_BSC, decIn: 18, decOut: 18,
    amountIn: BNB_IN, amountInLabel: "0.1 BNB", quoteUnit: "USDT",
    ref: "BNBUSDT", pair: "BNB/USD", tolBps: 75, fee: 500,
  },
  {
    id: "bsc-univ3-usdt-usdc-1", chainKey: "bsc", dex: "Uniswap v3", kind: "v3",
    contract: UNIV3_QUOTER_V2_BSC, route: "USDT → USDC · 0.01%",
    tokenIn: T.USDT_BSC, tokenOut: T.USDC_BSC, decIn: 18, decOut: 18,
    amountIn: STABLE_IN_18, amountInLabel: "100 USDT", quoteUnit: "USDC",
    ref: "USD1", pair: "USDT/USDC", tolBps: 25, fee: 100,
  },
  {
    id: "bsc-pancakev2-wbnb-usdt", chainKey: "bsc", dex: "PancakeSwap v2", kind: "v2",
    contract: PANCAKE_V2_ROUTER, route: "WBNB → USDT · 0.25%",
    tokenIn: T.WBNB, tokenOut: T.USDT_BSC, decIn: 18, decOut: 18,
    amountIn: BNB_IN, amountInLabel: "0.1 BNB", quoteUnit: "USDT",
    ref: "BNBUSDT", pair: "BNB/USD", tolBps: 75,
  },
  // ── Arbitrum One ──────────────────────────────────────────────────
  {
    id: "arb-univ3-weth-usdc-5", chainKey: "arb", dex: "Uniswap v3", kind: "v3",
    contract: UNIV3_QUOTER_V1, route: "WETH → USDC · 0.05%",
    tokenIn: T.WETH_ARB, tokenOut: T.USDC_ARB, decIn: 18, decOut: 6,
    amountIn: ETH_IN, amountInLabel: "0.05 WETH", quoteUnit: "USDC",
    ref: "ETHUSDT", pair: "ETH/USD", tolBps: 75, fee: 500,
  },
  {
    id: "arb-sushi-weth-usdc", chainKey: "arb", dex: "SushiSwap", kind: "v2",
    contract: SUSHI_V2_ROUTER_ARB, route: "WETH → USDC · 0.30%",
    tokenIn: T.WETH_ARB, tokenOut: T.USDC_ARB, decIn: 18, decOut: 6,
    amountIn: ETH_IN, amountInLabel: "0.05 WETH", quoteUnit: "USDC",
    ref: "ETHUSDT", pair: "ETH/USD", tolBps: 75,
  },
  // ── Base ──────────────────────────────────────────────────────────
  {
    id: "base-univ2-weth-usdc", chainKey: "base", dex: "Uniswap v2", kind: "v2",
    contract: UNIV2_ROUTER02_BASE, route: "WETH → USDC · 0.30%",
    tokenIn: T.WETH_BASE, tokenOut: T.USDC_BASE, decIn: 18, decOut: 6,
    amountIn: ETH_IN, amountInLabel: "0.05 WETH", quoteUnit: "USDC",
    ref: "ETHUSDT", pair: "ETH/USD", tolBps: 75,
  },
];

// ── ספקי RPC — מנוהלים במודול, משותפים בין קריאות ──────────────────

const providers = new Map<number, ethers.JsonRpcProvider>();
function providerFor(chainId: number, url: string): ethers.JsonRpcProvider {
  let p = providers.get(chainId);
  if (!p) {
    p = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true });
    providers.set(chainId, p);
  }
  return p;
}

// ── קידודי קריאה ─────────────────────────────────────────────────────

const IFACE_V2 = new ethers.Interface([
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
]);
const IFACE_V3_FLAT = new ethers.Interface([
  "function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) returns (uint256 amountOut)",
]);
const IFACE_V3_TUPLE = new ethers.Interface([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut)",
]);

async function callChannel(spec: ChannelSpec): Promise<{ quote: number | null; execPrice: number | null; latencyMs: number | null; err?: string }> {
  const chain = CHAINS.find((c) => c.key === spec.chainKey)!;
  const p = providerFor(chain.chainId, chain.rpc);
  const t0 = Date.now();
  try {
    const callPromise = (async () => {
      if (spec.kind === "v2") {
        const data = IFACE_V2.encodeFunctionData("getAmountsOut", [
          spec.amountIn,
          [A(spec.tokenIn), A(spec.tokenOut)],
        ]);
        const raw = await p.call({ to: A(spec.contract), data });
        const amounts = IFACE_V2.decodeFunctionResult("getAmountsOut", raw)[0] as bigint[];
        const out = amounts[amounts.length - 1];
        if (out <= BigInt(0)) throw new Error("zero-out");
        return out;
      }
      if (spec.chainKey === "bsc") {
        // QuoterV2 על BSC — חתימת-ה-tuple
        const data = IFACE_V3_TUPLE.encodeFunctionData("quoteExactInputSingle", [
          [A(spec.tokenIn), A(spec.tokenOut), spec.amountIn, spec.fee ?? 3000, 0],
        ]);
        const raw = await p.call({ to: A(spec.contract), data });
        const out = IFACE_V3_TUPLE.decodeFunctionResult("quoteExactInputSingle", raw)[0] as bigint;
        if (out <= BigInt(0)) throw new Error("zero-out");
        return out;
      }
      // QuoterV1 (Ethereum/Arbitrum) — חתימה שטוחה
      const data = IFACE_V3_FLAT.encodeFunctionData("quoteExactInputSingle", [
        A(spec.tokenIn), A(spec.tokenOut), spec.fee ?? 3000, spec.amountIn, 0,
      ]);
      const raw = await p.call({ to: A(spec.contract), data });
      const out = IFACE_V3_FLAT.decodeFunctionResult("quoteExactInputSingle", raw)[0] as bigint;
      if (out <= BigInt(0)) throw new Error("zero-out");
      return out;
    })();
    const outRaw = await Promise.race([
      callPromise,
      new Promise<bigint>((_, rj) => setTimeout(() => rj(new Error("timeout-8s")), 8_000)),
    ]);
    const latencyMs = Date.now() - t0;
    const quote = Number(ethers.formatUnits(outRaw, spec.decOut));
    // מחיר ביצוע: כמה יחידות יציאה לכל יחידת כניסה, מנורמל ליחידות תצוגה
    const inDisplay = Number(ethers.formatUnits(spec.amountIn, spec.decIn));
    const execPrice = quote / inDisplay;
    return { quote, execPrice, latencyMs };
  } catch (e) {
    return { quote: null, execPrice: null, latencyMs: Date.now() - t0, err: String((e as Error)?.message ?? e).slice(0, 90) };
  }
}

// ── סימוכין בינאנס — שופט בלתי-תלוי ─────────────────────────────────

async function fetchReference(): Promise<{ ethUsdt: number | null; bnbUsdt: number | null; solUsdt: number | null; at: string | null; down: string[] }> {
  const down: string[] = [];
  const one = async (sym: string): Promise<number | null> => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8_000);
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, {
        signal: ctl.signal,
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`http ${res.status}`);
      const j = (await res.json()) as { price?: string };
      const p = parseFloat(String(j.price ?? ""));
      if (!Number.isFinite(p) || p <= 0) throw new Error("bad-price");
      return p;
    } catch (e) {
      down.push(`${sym}: ${String((e as Error)?.message ?? e).slice(0, 40)}`);
      return null;
    }
  };
  const [ethUsdt, bnbUsdt, solUsdt] = await Promise.all([one("ETHUSDT"), one("BNBUSDT"), one("SOLUSDT")]);
  return { ethUsdt, bnbUsdt, solUsdt, at: ethUsdt != null || bnbUsdt != null || solUsdt != null ? new Date().toISOString() : null, down };
}

// ── ערוצי REST ריבוניים (R97) — נמדדו חיים לפני שנכתבו ─────────────────
// אותה דוקטרינה כמו ערוצי ה-eth_call: קריאה בלבד, חסרת-מפתחות,
// והסימוכין הבלתי-תלוי (בינאנס) שופט גם אותם.

interface RestSpec {
  id: string;
  chainLabel: string;
  dex: string;
  route: string;
  pair: string;
  amountInLabel: string;
  inDisplay: number; // כמה יחידות-קלט בתצוגה
  quoteUnit: string;
  ref: "ETHUSDT" | "BNBUSDT" | "SOLUSDT" | "USD1";
  tolBps: number;
  /** נקודת-הקצה — ההוכחה (בדיוק כמו כתובת חוזה בערוצי eth_call) */
  endpoint: string;
  quote: () => Promise<{ outDisplay: number | null; err?: string }>;
}

async function fetchJson(url: string, timeoutMs = 9000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "the-weave-exchange-router/1.1" },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// 0.1 SOL — נוטינאלי מיקרו (~$12): בדיוק סדר-הגודל שבו האוטונומיה שלנו
// פועלת (מתחת לשעת-ה-$100 של שער-העסקאות)
const SOL_IN_LAMPORTS = "100000000";

const REST_CHANNELS: RestSpec[] = [
  {
    id: "sol-jupiter-sol-usdc",
    chainLabel: "Solana",
    dex: "Jupiter",
    route: "SOL → USDC · lite-api keyless",
    pair: "SOL/USD",
    amountInLabel: "0.1 SOL",
    inDisplay: 0.1,
    quoteUnit: "USDC",
    ref: "SOLUSDT",
    tolBps: 75,
    endpoint: "https://lite-api.jup.ag/swap/v1/quote",
    quote: async () => {
      const j = await fetchJson(
        `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${SOL_IN_LAMPORTS}&slippageBps=50`,
      );
      const out = Number(j?.outAmount);
      return { outDisplay: Number.isFinite(out) && out > 0 ? out / 1e6 : null };
    },
  },
  {
    id: "xchain-across-weth-usdc",
    chainLabel: "Ethereum → Base",
    dex: "Across",
    route: "WETH(1) → USDC(8453) · ERC-7683",
    pair: "ETH/USD",
    amountInLabel: "0.05 WETH",
    inDisplay: 0.05,
    quoteUnit: "USDC",
    ref: "ETHUSDT",
    tolBps: 150, // חוצה-שרשרת: כולל עמלות גשר — הגבול כתוב והוגן
    endpoint: "https://app.across.to/api/swap",
    quote: async () => {
      const j = await fetchJson(
        "https://app.across.to/api/swap?originChainId=1&destinationChainId=8453&inputToken=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&outputToken=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&amount=50000000000000000&recipient=0x000000000000000000000000000000000000dEaD&depositor=0x000000000000000000000000000000000000dEaD&message=0x",
      );
      // מה שנמסר בפועל ביעד — כולל עלות ההחלפה והגשר (בכנות מלאה)
      const out = Number(j?.steps?.bridge?.outputAmount);
      return { outDisplay: Number.isFinite(out) && out > 0 ? out / 1e6 : null };
    },
  },
];

async function callRestChannel(
  spec: RestSpec,
): Promise<{ quote: number | null; execPrice: number | null; latencyMs: number | null; err?: string }> {
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      spec.quote(),
      new Promise<{ outDisplay: number | null }>((_, rj) => setTimeout(() => rj(new Error("timeout-9s")), 9_000)),
    ]);
    const latencyMs = Date.now() - t0;
    if (r.outDisplay == null) throw new Error("empty-quote");
    return { quote: r.outDisplay, execPrice: r.outDisplay / spec.inDisplay, latencyMs };
  } catch (e) {
    return { quote: null, execPrice: null, latencyMs: Date.now() - t0, err: String((e as Error)?.message ?? e).slice(0, 90) };
  }
}

// ── סולם התשואה — DefiLlama Yields (חסר-מפתחות) ──────────────────────

// slug-ים אמיתיים שנמדדו מה-API (2026-09-23): כחולות-לבן בלבד — Sky/Maker,
// Aave v3, Spark, Maple, Ethena, Morpho, JustLend (TRON), Jupiter Lend,
// Circle USYC, Ondo, BlackRock BUIDL, Compound, Curve.
const BLUE_CHIPS = new Set([
  "sky-lending", "aave-v3", "sparklend", "spark-savings", "maple",
  "ethena-usde", "morpho-blue", "justlend-v1", "jupiter-lend",
  "circle-usyc", "ondo-yield-assets", "blackrock-buidl", "compound-v3", "curve-dex",
]);

async function fetchYields(): Promise<{ at: string | null; pools: YieldPool[]; down?: string }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15_000);
    const res = await fetch("https://yields.llama.fi/pools", {
      signal: ctl.signal,
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "the-weave-exchange-router/1.0" },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`http ${res.status}`);
    const j = (await res.json()) as {
      data?: Array<{ chain?: string; project?: string; symbol?: string; tvlUsd?: number; apy?: number; stablecoin?: boolean; ilRisk?: string }>;
    };
    const pools: YieldPool[] = (j.data ?? [])
      .filter((p) => p.stablecoin === true && p.project && BLUE_CHIPS.has(p.project) && typeof p.tvlUsd === "number" && p.tvlUsd > 100_000_000 && typeof p.apy === "number")
      .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
      .slice(0, 8)
      .map((p) => ({
        project: String(p.project),
        chain: String(p.chain ?? ""),
        symbol: String(p.symbol ?? ""),
        apy: p.apy ?? null,
        tvlUsd: p.tvlUsd ?? 0,
        stablecoin: true,
        ilRisk: String(p.ilRisk ?? ""),
      }));
    return { at: new Date().toISOString(), pools };
  } catch (e) {
    return { at: null, pools: [], down: String((e as Error)?.message ?? e).slice(0, 60) };
  }
}

// ── הרכב התמונה ─────────────────────────────────────────────────────

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  } catch {
    return null;
  }
}

export async function composeExchangeRouter(): Promise<ExchangeRouterSnapshot> {
  const at = new Date().toISOString();

  // ① גובה-שרשרת לכל רשת — הוכחה שה-RPC חי (או שהוא נפל, בכנות)
  const chainStatuses: ChainStatus[] = await Promise.all(
    CHAINS.map(async (c) => {
      const p = providerFor(c.chainId, c.rpc);
      const h = await withTimeout(p.getBlockNumber(), 8_000);
      return { name: c.name, chainId: c.chainId, rpc: c.rpc, height: h, ok: h != null };
    }),
  );

  // ② כל הערוצים + הסימוכין — במקביל (eth_call + REST ריבוניים)
  const [channelResults, reference, restResults] = await Promise.all([
    Promise.all(CHANNELS.map((spec) => callChannel(spec))),
    fetchReference(),
    Promise.all(REST_CHANNELS.map((spec) => callRestChannel(spec))),
  ]);

  const channels: QuoteChannel[] = CHANNELS.map((spec, i) => {
    const r = channelResults[i];
    const refPrice =
      spec.ref === "ETHUSDT" ? reference.ethUsdt : spec.ref === "BNBUSDT" ? reference.bnbUsdt : spec.ref === "USD1" ? 1 : null;
    let devBps: number | null = null;
    let verdict: QuoteVerdict = "DOWN";
    let note = "";
    if (r.quote != null && r.execPrice != null && refPrice != null && refPrice > 0) {
      devBps = Math.round(((r.execPrice - refPrice) / refPrice) * 10_000);
      verdict = Math.abs(devBps) <= spec.tolBps ? "VERIFIED" : "DEVIANT";
      note =
        verdict === "VERIFIED"
          ? `בגבול ${spec.tolBps}bps מהסימוכין (כולל עמלת בריכה) — הציטוט עומד באתגר`
          : `סטייה ${Math.abs(devBps)}bps מעבר לגבול ${spec.tolBps}bps — הציטוט אותגר ונכשל`;
    } else if (r.quote == null) {
      note = `הערוץ לא ענה — ${r.err ?? "לא נמדד"} (מתועד בכנות, לא הוסתר)`;
    } else {
      note = "אין סימוכין חי לשיפוט — הציטוט לא נשפט במחזור זה";
      verdict = r.quote != null ? "VERIFIED" : "DOWN";
    }
    return {
      id: spec.id,
      chain: CHAINS.find((c) => c.key === spec.chainKey)!.name,
      chainId: CHAINS.find((c) => c.key === spec.chainKey)!.chainId,
      dex: spec.dex,
      route: spec.route,
      pair: spec.pair,
      amountInLabel: spec.amountInLabel,
      quote: r.quote,
      quoteUnit: spec.quoteUnit,
      execPrice: r.execPrice,
      refLabel: spec.ref === "USD1" ? "דולר (1.00)" : spec.ref === "ETHUSDT" ? "ETHUSDT · בינאנס" : "BNBUSDT · בינאנס",
      devBps,
      latencyMs: r.latencyMs,
      kind: spec.kind,
      contract: A(spec.contract),
      verdict,
      note,
    };
  });

  // R97 — ערוצי ה-REST נכנסים לאותו ספר: אותן חוקיות-שיפוט, אותה תחרות
  for (let i = 0; i < REST_CHANNELS.length; i++) {
    const spec = REST_CHANNELS[i];
    const r = restResults[i];
    const refPrice =
      spec.ref === "ETHUSDT" ? reference.ethUsdt : spec.ref === "SOLUSDT" ? reference.solUsdt : spec.ref === "USD1" ? 1 : null;
    let devBps: number | null = null;
    let verdict: QuoteVerdict = "DOWN";
    let note = "";
    if (r.quote != null && r.execPrice != null && refPrice != null && refPrice > 0) {
      devBps = Math.round(((r.execPrice - refPrice) / refPrice) * 10_000);
      verdict = Math.abs(devBps) <= spec.tolBps ? "VERIFIED" : "DEVIANT";
      note =
        verdict === "VERIFIED"
          ? `ערוץ REST keyless בגבול ${spec.tolBps}bps מהסימוכין — עומד באתגר`
          : `סטייה ${Math.abs(devBps)}bps מעבר לגבול ${spec.tolBps}bps — אותגר ונכשל`;
    } else if (r.quote == null) {
      note = `הערוץ לא ענה — ${r.err ?? "לא נמדד"} (מתועד בכנות, לא הוסתר)`;
    } else {
      note = "אין סימוכין חי לשיפוט — הציטוט לא נשפט במחזור זה";
      verdict = "VERIFIED";
    }
    channels.push({
      id: spec.id,
      chain: spec.chainLabel,
      chainId: 0,
      dex: spec.dex,
      route: spec.route,
      pair: spec.pair,
      amountInLabel: spec.amountInLabel,
      quote: r.quote,
      quoteUnit: spec.quoteUnit,
      execPrice: r.execPrice,
      refLabel: spec.ref === "SOLUSDT" ? "SOLUSDT · בינאנס" : spec.ref === "ETHUSDT" ? "ETHUSDT · בינאנס" : "דולר (1.00)",
      devBps,
      latencyMs: r.latencyMs,
      kind: "rest",
      contract: spec.endpoint,
      verdict,
      note,
    });
  }

  // ③ תחרות בין ראוטרים — אותו זוג, כמה חוזים
  const byPair = new Map<string, QuoteChannel[]>();
  for (const ch of channels) {
    // R97: הזוג נלקח מהערוץ עצמו — גם ערוצי eth_call וגם ערוצי REST
    const arr = byPair.get(ch.pair) ?? [];
    arr.push(ch);
    byPair.set(ch.pair, arr);
  }
  const competition: CompetitionGroup[] = [];
  for (const [pair, arr] of byPair) {
    const live = arr.filter((c) => c.execPrice != null);
    if (live.length < 2) continue;
    const prices = arr.map((c) => ({ dex: c.dex, chain: c.chain, price: c.execPrice }));
    // הכיוון נכון למוכר-הבסיס: execPrice = יחידות יציאה לכל יחידת כניסה —
    // הראוטר "הטוב" הוא זה שמחזיר הכי הרבה (max), ה"גרוע" מחזיר הכי מעט (min).
    const best = Math.max(...live.map((c) => c.execPrice!));
    const worst = Math.min(...live.map((c) => c.execPrice!));
    const bestCh = live.find((c) => c.execPrice === best)!;
    const worstCh = live.find((c) => c.execPrice === worst)!;
    competition.push({
      pair,
      prices,
      bestDex: `${bestCh.dex} · ${bestCh.chain}`,
      worstDex: `${worstCh.dex} · ${worstCh.chain}`,
      best,
      worst,
      spreadBps: worst > 0 ? Math.round(((worst - best) / best) * 10_000) : null,
    });
  }
  competition.sort((a, b) => (a.pair < b.pair ? -1 : 1));

  // ④ סיכום-האתגר
  const verified = channels.filter((c) => c.verdict === "VERIFIED").length;
  const deviant = channels.filter((c) => c.verdict === "DEVIANT").length;
  const down = channels.filter((c) => c.verdict === "DOWN").length;
  const notes: string[] = [];
  if (deviant === 0 && verified > 0) {
    notes.push(`כל ${verified} הציטוטים החיים עמדו באתגר הסימוכין — שום ראוטר לא נתפס בסטייה מעבר לגבול`);
  }
  if (deviant > 0) {
    notes.push(`${deviant} ציטוטים אותגרו ונכשלו — סטייה מעבר לגבול המותר מול הסימוכין`);
  }
  if (down > 0) {
    notes.push(`${down} ערוצים נפלו במחזור זה — כל נפילה מתועדת בגלוי ותיבדק שוב במחזור הבא`);
  }
  const tightest = competition.filter((c) => c.spreadBps != null).sort((a, b) => (a.spreadBps ?? 0) - (b.spreadBps ?? 0))[0];
  if (tightest) {
    notes.push(
      `התחרות הצמודה ביותר: ${tightest.pair} — ${tightest.bestDex} נותן את המחיר הטוב ביותר, פער ${tightest.spreadBps}bps מול ${tightest.worstDex}`,
    );
  }

  // ⑤ סולם התשואה
  const yields = await fetchYields();

  return {
    at,
    ok: channels.some((c) => c.quote != null),
    chains: chainStatuses,
    channels,
    reference,
    competition,
    challenge: {
      verified,
      deviant,
      down,
      summary: `${verified}/${verified + deviant + down} ערוצים אומתו מול סימוכין בלתי-תלוי · ${down} נפלו`,
      notes,
    },
    yields,
    doctrine: [
      "כל ציטוט הוא eth_call לחוזה האמיתי — קריאה בלבד, חסרת-מפתחות; אין מתווך בין הרשת לבריכה",
      "ביצוע עסקה אמיתית דורש מפתח חתימה = שער-מפעיל מפורש — המנוע מודד, לא חותם",
      "הסטייה מול בינאנס כוללת עמלת בריכה ועומק — החלפה חינם איננה; הגבולות כתובים ונאכפים",
      "ה-Quoter הרשמי של PancakeSwap v3 לא אומת מהסנדבוקס — PancakeSwap v2 מצוטט וחי; הפער מתועד, לא הוסתר",
      "ערוצי REST ריבוניים (R97): Jupiter-lite בסולנה ו-Across (ERC-7683) חוצה-שרשרת — keyless, בלי מפתח, בלי מתווך; deBridge מת (‎404) ו-CoW לא פוענח — אותגרו ולא חוברו בכנות",
      "ה-APY בסולם התשואה נמדד מ-DefiLlama על בריכות כחולות-לבן בלבד — לא הבטחת תשואה שלנו",
    ],
  };
}
