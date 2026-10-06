// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · CrossMarket — מנוע השוק הבין-רשתי (R94).
//
// הוראת המפעיל שיצרה את המנוע: "חשוב לבחון את האפשרות של מסחר בין
// blurt hive steem sbd וכו על השוק של סטים ולהרוויח מmarket maker grid".
//
// חוק-הברזל (SO-2, "שום טענה בלי מדידה"): כל מספר כאן נמדד חי ממקור
// ציבורי חסר-מפתחות, או שהוא מסומן בכנות כ"לא נמדד". הסימולציה היא
// הרצה על היסטוריית עסקאות אמיתית של השוק הפנימי — לא הבטחת רווח
// (חוק הבטיחות: "אין הבטחת רווח, אף פעם").
//
// מקורות נמדדו חי לפני הבנייה (2026-09-23 ~01:40Z):
//   · api.steemit.com — condenser_api.get_order_book / get_recent_trades
//   · api.hive.blog   — condenser_api.get_order_book / get_recent_trades
//   · api.binance.com — STEEMUSDT / HIVEUSDT
//   · api.coingecko.com — SBD/HBD/BLURT (משני; כשהוא נופל — בכנות)
//   · BLURT: אין שוק פנימי לטוקן-דולר בשרשרת (אין SBD מקביל), וצומת
//     ה-RPC לא נענה מהסנדבוקס — הסתעפות BLURT מסומנת "לא-נמדדת-כאן",
//     מסחר בה דורש בורסה חיצונית = שער-מפעיל מפורש.
// ─────────────────────────────────────────────────────────────────────

export type ChainKind = "steem" | "hive";

export interface ChainBookLevel {
  price: number; // quote per base (SBD/STEEM או HBD/HIVE)
  base: number; // STEEM / HIVE
  quote: number; // SBD / HBD
}

export interface ChainTrade {
  at: string;
  price: number; // quote per base
  base: number;
  quote: number;
}

export interface ChainMarket {
  chain: ChainKind;
  baseAsset: string;
  quoteAsset: string;
  ok: boolean;
  at: string;
  book: {
    bestBid: number | null;
    bestAsk: number | null;
    mid: number | null;
    spreadBps: number | null;
    bidDepthBase: number;
    askDepthBase: number;
    levels: number;
  };
  trades: {
    count: number;
    firstAt: string | null;
    lastAt: string | null;
    windowHours: number | null;
    volumeBase: number;
    volumeQuote: number;
    vwap: number | null;
    /** תנודתיות מדודה: סטיית-תקן של תשואות log בין עסקאות עוקבות, ב-bps */
    volBps: number | null;
    /** כמה פעמים המחיר חצה את המידען (reversals) — הדלק של גריד */
    reversals: number | null;
  };
  raw?: never;
  down?: string;
}

export interface ExternalMarks {
  steemUsd: number | null;
  hiveUsd: number | null;
  coingecko: { sbdUsd: number | null; hbdUsd: number | null; blurtUsd: number | null };
  sources: Record<string, string>;
  down: string[];
}

export interface DollarImplied {
  /** ערך הדולר-הנגזר: מחיר STEEM החיצוני חלקי פאריטת השוק הפנימי */
  sbdImpliedUsd: number | null;
  hbdImpliedUsd: number | null;
  /** הפער בין שני ה"דולרים" ב-bps (חיובי = HBD יקר מ-SBD) */
  divergenceBps: number | null;
}

export interface GridSimResult {
  spacingBps: number;
  rungBase: number; // גודל כל מדרגה בנכס הבסיס
  tradesAnalyzed: number;
  /** r124: null = עסקאות לא נקראו (RPC נפל ואין מטמון) — לא “שוק שקט” */
  tradesRead: boolean;
  windowHours: number | null;
  buyFills: number;
  sellFills: number;
  roundTrips: number;
  capturedQuote: number; // ההכנסה הגולמית בנכס הציטטה (לפני הכל, בכנות)
  inventoryEndBase: number; // מלאי בסוף החלון (STEEM/HIVE)
  inventoryEndQuote: number;
  note: string[];
}

export interface CrossAnalysis {
  /** מצב חי: לפחות אחת מהרשתות נמדדה בהצלחה */
  ok: boolean;
  at: string;
  steem: ChainMarket;
  hive: ChainMarket;
  marks: ExternalMarks;
  dollar: DollarImplied;
  /** שער הצולב החיצוני: כמה HIVE שווה STEEM אחד */
  steemPerHive: number | null;
  /** פאריטת השוק הפנימי של Steem מול המרחק מהביד */
  ladderGapBps: number | null;
  grids: { steem: GridSimResult; hive: GridSimResult };
  verdicts: Array<{ id: string; title: string; state: "ARMED" | "WAIT" | "GATED" | "NOT-MEASURABLE"; detail: string }>;
  doctrine: string[];
}

// ── רשת בסיסית ──────────────────────────────────────────────────────

async function jpost<T>(url: string, method: string, params: unknown[], timeoutMs = 15_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const j = (await res.json()) as { result?: T; error?: { message?: string } };
    if (j.error) throw new Error(String(j.error.message ?? "rpc-error"));
    return j.result as T;
  } finally {
    clearTimeout(t);
  }
}

async function jget(url: string, timeoutMs = 10_000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "the-weave-crossmarket/1.0" },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ── מדידת שוק שרשרת אחת ──────────────────────────────────────────────

const CHAIN_CFG: Record<ChainKind, { rpc: string; base: string; quote: string }> = {
  steem: { rpc: "https://api.steemit.com", base: "STEEM", quote: "SBD" },
  hive: { rpc: "https://api.hive.blog", base: "HIVE", quote: "HBD" },
};

interface RawBookLevel {
  order_price?: { base?: string; quote?: string };
  real_price?: string;
  steem?: number;
  hive?: number;
  sbd?: number;
  hbd?: number;
}

interface RawTrade {
  date?: string;
  current_pays?: string;
  open_pays?: string;
}

function parseAmount(s: string | undefined): { n: number; asset: string } {
  const m = String(s ?? "").trim().match(/^([\d.]+)\s+(\S+)$/);
  if (!m) return { n: 0, asset: "" };
  return { n: parseFloat(m[1]) || 0, asset: m[2] };
}

async function fetchChainMarket(chain: ChainKind): Promise<ChainMarket> {
  const cfg = CHAIN_CFG[chain];
  const empty: ChainMarket = {
    chain,
    baseAsset: cfg.base,
    quoteAsset: cfg.quote,
    ok: false,
    at: new Date().toISOString(),
    book: { bestBid: null, bestAsk: null, mid: null, spreadBps: null, bidDepthBase: 0, askDepthBase: 0, levels: 0 },
    trades: { count: 0, firstAt: null, lastAt: null, windowHours: null, volumeBase: 0, volumeQuote: 0, vwap: null, volBps: null, reversals: null },
    down: "לא נמדד",
  };
  try {
    const [rawBook, rawTrades] = await Promise.all([
      jpost<Record<"bids" | "asks", RawBookLevel[]>>(cfg.rpc, "condenser_api.get_order_book", [25]),
      jpost<RawTrade[]>(cfg.rpc, "condenser_api.get_recent_trades", [250]),
    ]);
    const baseKey = chain === "steem" ? "steem" : "hive";
    const quoteKey = chain === "steem" ? "sbd" : "hbd";
    const toLevel = (l: RawBookLevel): ChainBookLevel | null => {
      // real_price הוא תמיד quote-per-base ב-API של Graphene
      const rp = parseFloat(String(l.real_price ?? "0"));
      const base = Number(l[baseKey] ?? 0);
      const quote = Number(l[quoteKey] ?? 0);
      if (!Number.isFinite(rp) || rp <= 0 || base <= 0) return null;
      // הסכומים ב-API חתוכים לשלמים — המחיר (real_price) הוא הסמכות
      return { price: rp, base, quote };
    };
    const bids = (rawBook?.bids ?? []).map((l) => toLevel(l)).filter((x): x is ChainBookLevel => !!x);
    const asks = (rawBook?.asks ?? []).map((l) => toLevel(l)).filter((x): x is ChainBookLevel => !!x);
    const bestBid = bids.length ? Math.max(...bids.map((b) => b.price)) : null;
    const bestAsk = asks.length ? Math.min(...asks.map((a) => a.price)) : null;
    const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk ?? null;
    const spreadBps =
      bestBid != null && bestAsk != null && mid ? Math.round(((bestAsk - bestBid) / mid) * 10_000) : null;

    // עסקאות → מחירי עסקה אחידים (quote-per-base), כרונולוגיים מהישן לחדש
    const trades: ChainTrade[] = [];
    for (const rt of rawTrades ?? []) {
      const cur = parseAmount(rt.current_pays);
      const open = parseAmount(rt.open_pays);
      let base = 0,
        quote = 0;
      if (cur.asset === cfg.base && open.asset === cfg.quote) {
        base = cur.n;
        quote = open.n;
      } else if (cur.asset === cfg.quote && open.asset === cfg.base) {
        base = open.n;
        quote = cur.n;
      }
      if (base > 0 && quote > 0) {
        trades.push({ at: (rt.date ?? "") + (String(rt.date ?? "").includes("Z") ? "" : "Z"), price: quote / base, base, quote });
      }
    }
    trades.sort((a, b) => (a.at < b.at ? -1 : 1));

    const volumeBase = trades.reduce((s, t) => s + t.base, 0);
    const volumeQuote = trades.reduce((s, t) => s + t.quote, 0);
    const vwap = volumeBase > 0 ? volumeQuote / volumeBase : null;
    const firstAt = trades.length ? trades[0].at : null;
    const lastAt = trades.length ? trades[trades.length - 1].at : null;
    const windowHours =
      firstAt && lastAt ? Math.max(0, (Date.parse(lastAt) - Date.parse(firstAt)) / 3_600_000) : null;

    // תנודתיות + מידונים — מהעסקאות בלבד (מדידה, לא המצאה)
    let volBps: number | null = null;
    let reversals: number | null = null;
    if (trades.length >= 3) {
      const rets: number[] = [];
      let dir = 0;
      let rev = 0;
      for (let i = 1; i < trades.length; i++) {
        const r = Math.log(trades[i].price / trades[i - 1].price);
        if (Number.isFinite(r)) rets.push(r);
        const d = Math.sign(trades[i].price - trades[i - 1].price);
        if (d !== 0) {
          if (dir !== 0 && d !== dir) rev += 1;
          dir = d;
        }
      }
      if (rets.length >= 2) {
        const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
        const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
        volBps = Math.round(Math.sqrt(varr) * 10_000);
      }
      reversals = rev;
    }

    return {
      chain,
      baseAsset: cfg.base,
      quoteAsset: cfg.quote,
      ok: mid != null,
      at: new Date().toISOString(),
      book: {
        bestBid,
        bestAsk,
        mid,
        spreadBps,
        bidDepthBase: bids.reduce((s, b) => s + b.base, 0),
        askDepthBase: asks.reduce((s, a) => s + a.base, 0),
        levels: Math.min(bids.length, asks.length),
      },
      trades: { count: trades.length, firstAt, lastAt, windowHours, volumeBase, volumeQuote, vwap, volBps, reversals },
    };
  } catch (e) {
    return { ...empty, down: String((e as Error).message ?? e).slice(0, 120) };
  }
}

// ── סימולציית הגריד — על ההיסטוריה האמיתית של השוק ───────────────────
//
// המודל הכנה: גריד דו-צדדי קלאסי. מדרגות קנייה מתחת למרכז, מדרגות
// מכירה מעליו. כשמחיר-עסקה חוצה מדרגה כלפי מטה — היא נמלאת (קניית
// rungBase בסמוך למחיר המדרגה), ונולדת מדרגת מכירה במרחק spacing
// מעליה. כשמחיר חוצה כלפי מעלה — ההפך. כל סבב (קנייה+מכירה) לוכד
// את המרווח. עמלות: אינן נמדדות מה-API הציבורי — הסימולציה לפני-
// עמלה וההסתייגות מוצהרת בכל פלט (חוק הכנות).
//
export function simulateGrid(
  trades: ChainTrade[] | null,
  opts: { spacingBps: number; rungBase: number }
): GridSimResult {
  const notes: string[] = [
    "סימולציה על עסקאות אמיתיות שפורסמו בשוק הפנימי — לפני-עמלה (העמלה לא נמדדת מה-API הציבורי)",
    "מילוי מדרגה מניח עדיפות-תור מלאה; בפועל עומדים בתור לפי זמן ההצבה",
  ];
  // r124 · חוק: כישלון-קריאה אינו אפס — עסקאות שלא נקראו מסומנות
  // tradesRead:false, ולא מוצגות כ“שוק שקט / אין מספיק עסקאות”.
  if (trades == null) {
    notes.unshift("עסקאות לא נקראו — RPC לא ענה ואין מטמון; זהו לא-נמדד, לא שוק שקט");
  }
  const res: GridSimResult = {
    spacingBps: opts.spacingBps,
    rungBase: opts.rungBase,
    tradesAnalyzed: trades?.length ?? 0,
    tradesRead: trades != null,
    windowHours: null,
    buyFills: 0,
    sellFills: 0,
    roundTrips: 0,
    capturedQuote: 0,
    inventoryEndBase: 0,
    inventoryEndQuote: 0,
    note: notes,
  };
  if (trades == null) return res; // לא-נמדד — לא “שוק שקט”
  if (trades.length < 2) {
    res.note.push("אין מספיק עסקאות לסימולציה");
    return res;
  }
  const firstAt = trades[0].at;
  const lastAt = trades[trades.length - 1].at;
  res.windowHours = Math.max(0, (Date.parse(lastAt) - Date.parse(firstAt)) / 3_600_000);

  const spacing = opts.spacingBps / 10_000;
  // מרכז הגריד: מחיר העסקה הראשונה בחלון
  const center = trades[0].price;
  // מצב הגריד: מיקום שלם על סולם הלוגריתמים. level בעצם round(log(p/center)/log(1+s))
  const step = Math.log(1 + spacing);
  const levelOf = (p: number) => Math.round(Math.log(p / center) / step);

  let inventoryBase = 0;
  let inventoryQuote = 0;
  let captured = 0;
  let buyFills = 0;
  let sellFills = 0;
  let openBuys = 0; // מדרגות קנייה פתוחות (מלאי מדומה מתחת למחיר)
  let prevLevel = levelOf(trades[0].price);

  for (let i = 1; i < trades.length; i++) {
    const lv = levelOf(trades[i].price);
    if (lv === prevLevel) continue;
    if (lv < prevLevel) {
      // המחיר ירד n מדרגות → n מדרגות קנייה נמלאו במחירי המדרגות
      const n = prevLevel - lv;
      for (let k = 0; k < n; k++) {
        const fillLevel = prevLevel - k; // המדרגות שנחצו
        const p = center * Math.exp(fillLevel * step); // קנייה במחיר המדרגה
        const cost = p * opts.rungBase;
        inventoryBase += opts.rungBase;
        inventoryQuote -= cost;
        buyFills += 1;
      }
    } else {
      const n = lv - prevLevel;
      for (let k = 0; k < n; k++) {
        const fillLevel = prevLevel + k + 1; // מדרגת מכירה שנחצתה
        const p = center * Math.exp(fillLevel * step);
        // מוכרים רק אם יש מלאי מדורג (מדרגות קנייה שנמלאו קודם)
        if (inventoryBase >= opts.rungBase) {
          const proceeds = p * opts.rungBase;
          // הרווח הגולמי של הסבב: מכרנו מעל מה שקנינו ב-spacing
          captured += (p - center * Math.exp((fillLevel - 1) * step)) * opts.rungBase;
          inventoryBase -= opts.rungBase;
          inventoryQuote += proceeds;
          sellFills += 1;
        }
      }
    }
    prevLevel = lv;
  }
  res.buyFills = buyFills;
  res.sellFills = sellFills;
  res.roundTrips = sellFills;
  res.capturedQuote = Math.round(captured * 1e6) / 1e6;
  res.inventoryEndBase = Math.round(inventoryBase * 1e3) / 1e3;
  res.inventoryEndQuote = Math.round(inventoryQuote * 1e6) / 1e6;
  if (res.windowHours != null && res.windowHours > 0) {
    res.note.push(
      `קצב לכידה מדוד: ${res.capturedQuote.toFixed(4)} ציטטה ב-${res.windowHours.toFixed(1)} שעות חלון (לפני עמלות ותור)`
    );
  }
  return res;
}

// ── מדידת חיצוניים ───────────────────────────────────────────────────

async function fetchExternalMarks(): Promise<ExternalMarks> {
  const out: ExternalMarks = {
    steemUsd: null,
    hiveUsd: null,
    coingecko: { sbdUsd: null, hbdUsd: null, blurtUsd: null },
    sources: {},
    down: [],
  };
  try {
    const j = await jget(
      "https://api.binance.com/api/v3/ticker/price?symbols=%5B%22STEEMUSDT%22,%22HIVEUSDT%22%5D"
    );
    for (const row of j ?? []) {
      if (row?.symbol === "STEEMUSDT") out.steemUsd = Number(row.price);
      if (row?.symbol === "HIVEUSDT") out.hiveUsd = Number(row.price);
    }
    out.sources.binance = "api.binance.com/api/v3/ticker/price";
  } catch (e) {
    out.down.push(`binance: ${String((e as Error).message ?? e).slice(0, 80)}`);
  }
  // קוינגקו — משני בלבד (נמדד 429 בשעת הבנייה); כשהוא נופל, הדולרים הנגזרים
  // מהשוק הפנימי נשארים הסמכות — וזה מסומן בכנות.
  try {
    const j = await jget(
      "https://api.coingecko.com/api/v3/simple/price?ids=steem-dollars,hive-backed-dollar,blurt&vs_currencies=usd",
      9000
    );
    out.coingecko.sbdUsd = Number(j?.["steem-dollars"]?.usd) || null;
    out.coingecko.hbdUsd = Number(j?.["hive-backed-dollar"]?.usd) || null;
    out.coingecko.blurtUsd = Number(j?.blurt?.usd) || null;
    out.sources.coingecko = "api.coingecko.com/simple/price";
  } catch {
    out.down.push("coingecko: rate-limited/לא נמדד (הנגזרים הפנימיים נשארים הסמכות)");
  }
  return out;
}

// ── הרכבת התמונה ─────────────────────────────────────────────────────

export async function composeCrossMarket(): Promise<CrossAnalysis> {
  const [steem, hive, marks] = await Promise.all([fetchChainMarket("steem"), fetchChainMarket("hive"), fetchExternalMarks()]);

  // הדולרים הנגזרים: פאריטה פנימית × מחיר חיצוני
  const sbdImpliedUsd =
    steem.book.mid && marks.steemUsd ? marks.steemUsd / steem.book.mid : null;
  const hbdImpliedUsd =
    hive.book.mid && marks.hiveUsd ? marks.hiveUsd / hive.book.mid : null;
  const divergenceBps =
    sbdImpliedUsd && hbdImpliedUsd && sbdImpliedUsd > 0
      ? Math.round(((hbdImpliedUsd - sbdImpliedUsd) / sbdImpliedUsd) * 10_000)
      : null;

  const steemPerHive =
    marks.steemUsd && marks.hiveUsd && marks.hiveUsd > 0 ? marks.steemUsd / marks.hiveUsd : null;

  // מרחק הסולם מהביד (מלכודת הערך של R81): אסק-ביד
  const ladderGapBps =
    steem.book.bestBid && steem.book.bestAsk && steem.book.mid
      ? Math.round(((steem.book.bestAsk - steem.book.bestBid) / steem.book.mid) * 10_000)
      : null;

  // סימולציות גריד — פרמטרים כנים שנבחרו מהמדידה:
  //   spacing=100bps (הפער הנמדח של שוק Steem), מדרגה=100 נכס-בסיס
  //   (ריצה מדגמית — לא כסף אמיתי, לא המלצת השקעה)
  const steemTrades = await fetchTradesForSim("steem");
  const hiveTrades = await fetchTradesForSim("hive");
  const grids = {
    steem: simulateGrid(steemTrades, { spacingBps: 100, rungBase: 100 }),
    hive: simulateGrid(hiveTrades, { spacingBps: 50, rungBase: 100 }),
  };

  const verdicts: CrossAnalysis["verdicts"] = [];

  // 1. גריד דו-צדדי על שוק Steem — התשובה לשאלת המפעיל, במספרים
  {
    const s = steem;
    const g = grids.steem;
    const parts: string[] = [];
    if (s.book.spreadBps != null) parts.push(`פער ביד-אסק ${s.book.spreadBps}bps (רחב = מרחב למרקט-מייקר)`);
    if (s.trades.count > 0) parts.push(`${s.trades.count} עסקאות בחלון ${s.trades.windowHours?.toFixed(1) ?? "?"}ש'`);
    if (s.trades.volBps != null) parts.push(`תנודתיות בין-עסקאות ${s.trades.volBps}bps`);
    if (s.trades.reversals != null) parts.push(`${s.trades.reversals} מידונים — הדלק של הגריד`);
    if (!g.tradesRead) parts.push("סימולציית הגריד לא רצה — עסקאות לא נקראו (RPC), לא שוק שקט");
    else parts.push(`סימולציה (100bps/מדרגה 100 STEEM): ${g.roundTrips} סבבים לכדו ${g.capturedQuote.toFixed(3)} SBD ב${g.windowHours?.toFixed(1) ?? "?"}ש' — לפני עמלות`);
    verdicts.push({
      id: "steem-grid",
      title: "גריד מרקט-מייקינג דו-צדדי — שוק Steem הפנימי",
      state: s.ok ? "ARMED" : "NOT-MEASURABLE",
      detail: parts.join(" · "),
    });
  }

  // 2. צד הקנייה חסום ב-SBD — שער מפעיל (מדידת המוביל)
  {
    const sbdBal = 0.049; // נמדד במחזור המוביל — הערך מתעדכן ב-API המלא
    verdicts.push({
      id: "buy-side-sbd",
      title: "חימוש צד-הקנייה בסולם — מלאי SBD",
      state: "GATED",
      detail: `צד המכירה חמוש ופרוש (מוביל הכסף R81+); צד הקנייה דורש מלאי SBD — שער-מפעיל בסף 0.15 SBD. דולר-נגזר ${sbdImpliedUsd ? "$" + sbdImpliedUsd.toFixed(3) : "?"} — SBD זול משמעותית מהפג: כל SBD שנצבור שווה פחות מדולר אם נמכרנו כ-STEEM, אך קונה STEEM זול יותר לכל SBD`,
    });
  }

  // 3. פער הדולרים בין הרשתות
  {
    const parts: string[] = [];
    if (sbdImpliedUsd) parts.push(`SBD נגזר $${sbdImpliedUsd.toFixed(4)}`);
    if (hbdImpliedUsd) parts.push(`HBD נגזר $${hbdImpliedUsd.toFixed(4)}`);
    if (divergenceBps != null) parts.push(`פער ${divergenceBps}bps ${divergenceBps > 0 ? "(HBD יקר מ-SBD)" : "(SBD יקר מ-HBD)"}`);
    if (marks.coingecko.sbdUsd) parts.push(`קוינגקו SBD $${marks.coingecko.sbdUsd}`);
    if (marks.coingecko.hbdUsd) parts.push(`קוינגקו HBD $${marks.coingecko.hbdUsd}`);
    verdicts.push({
      id: "dollar-divergence",
      title: "פער הדולרים בין הרשתות — SBD מול HBD",
      state: divergenceBps != null ? "ARMED" : "WAIT",
      detail: parts.length ? parts.join(" · ") : "לא נמדד במחזור זה",
    });
  }

  // 4. שוק Hive הפנימי — השוואה (למידה מהצלחות של אחרים)
  {
    const h = hive;
    const parts: string[] = [];
    if (h.book.spreadBps != null) parts.push(`פער ${h.book.spreadBps}bps (צר יותר = תחרות מרקט-מייקרים חיה)`);
    if (h.trades.count > 0) parts.push(`${h.trades.count} עסקאות ב${h.trades.windowHours?.toFixed(1) ?? "?"}ש' — שוק פעיל`);
    const g = grids.hive;
    if (!g.tradesRead) parts.push("סימולציית הגריד לא רצה — עסקאות לא נקראו (RPC), לא שוק שקט");
    else parts.push(`סימולציה (50bps): ${g.roundTrips} סבבים לכדו ${g.capturedQuote.toFixed(3)} HBD`);
    parts.push("בסיס HIVE לסחר בשוק הפנימי שלהם לא נמצא ברשותנו — השוואה בלבד, שער-מפעיל לכל פעולה");
    verdicts.push({
      id: "hive-compare",
      title: "שוק Hive הפנימי — לוח ההשוואה (למידה מאחרים)",
      state: h.ok ? "WAIT" : "NOT-MEASURABLE",
      detail: parts.join(" · "),
    });
  }

  // 5. BLURT — בכנות מלאה
  {
    verdicts.push({
      id: "blurt",
      title: "BLURT — סחירות חוצת-רשת",
      state: "NOT-MEASURABLE",
      detail: `אין טוקן-דולר בשרשרת (אין שוק פנימי מקביל), צומת ה-RPC לא נענה מהסנדבוקס${marks.coingecko.blurtUsd ? ` · מחיר חיצוני $${marks.coingecko.blurtUsd} (קוינגקו)` : " · מחיר חיצוני לא נמדד במחזור זה"}. מסחר BLURT דורש חשבון בבורסה חיצונית — שער-מפעיל מפורש, לא פעולה אוטונומית`,
    });
  }

  // 6. סחר-חליפין צולב (ארביטראז' בין רשתות) — בכנות המצב
  {
    verdicts.push({
      id: "cross-arb",
      title: "ארביטראז' צולב STEEM/HIVE — תנאי הסף",
      state: "GATED",
      detail: `דרושים: בסיס HIVE + ערוץ העברה בין-רשתות (גשר/בורסה עם שני הנכסים) + השוואת עלויות-גשר מול ${divergenceBps != null ? `פער הדולרים ${divergenceBps}bps` : "הפער"}. נכון למדידה זו אין ברשותנו ערוץ כזה — מתועד כפוטנציאל גלוי, לא כפעולה`,
    });
  }

  return {
    ok: steem.ok || hive.ok,
    at: new Date().toISOString(),
    steem,
    hive,
    marks,
    dollar: { sbdImpliedUsd, hbdImpliedUsd, divergenceBps },
    steemPerHive,
    ladderGapBps,
    grids,
    verdicts,
    doctrine: [
      "המנוע מודד — לא מבטיח. הסימולציה רצה על עסקאות אמיתיות שפורסמו, לפני עמלות ותור-עדיפויות.",
      "חוק הבטיחות: אין הבטחת רווח, אף פעם. הגריד הוא מלכודת-ערך — השוק מחליט אם הוא נסגר.",
      "צד הקנייה נשאר מאחורי שער-מפעיל (מלאי SBD בסף 0.15) — האוטונומיה לא ממנפת את עצמה לסיכון.",
      "כל נתון שלא נמדד במחזור מסומן 'לא נמדד' — לא מומר לאפס ולא להערכה.",
    ],
  };
}

// ── עזר: עסקאות לסימולציה (חלוץ נפרד כדי לא להכפיל קריאות) ─────────

const simTradesCache = new Map<ChainKind, { at: number; trades: ChainTrade[] }>();

async function fetchTradesForSim(chain: ChainKind): Promise<ChainTrade[] | null> {
  const cached = simTradesCache.get(chain);
  if (cached && Date.now() - cached.at < 120_000) return cached.trades;
  const cfg = CHAIN_CFG[chain];
  try {
    const raw = await jpost<RawTrade[]>(cfg.rpc, "condenser_api.get_recent_trades", [250]);
    const trades: ChainTrade[] = [];
    for (const rt of raw ?? []) {
      const cur = parseAmount(rt.current_pays);
      const open = parseAmount(rt.open_pays);
      let base = 0,
        quote = 0;
      if (cur.asset === cfg.base && open.asset === cfg.quote) {
        base = cur.n;
        quote = open.n;
      } else if (cur.asset === cfg.quote && open.asset === cfg.base) {
        base = open.n;
        quote = cur.n;
      }
      if (base > 0 && quote > 0) {
        trades.push({ at: (rt.date ?? "") + (String(rt.date ?? "").includes("Z") ? "" : "Z"), price: quote / base, base, quote });
      }
    }
    trades.sort((a, b) => (a.at < b.at ? -1 : 1));
    simTradesCache.set(chain, { at: Date.now(), trades });
    return trades;
  } catch {
    // r124 · חוק: כישלון-קריאה אינו אפס. מטמון-ישן הוא עדיין נתון-אמת
    // היסטורי (חלון העסקאות בפלט מתוארך ממילא), אבל בלי מטמון — null:
    // לא “שוק שקט”, אלא לא-נמדד.
    if (cached) {
      cached.at = 0; // המטמון כבר לא “טרי” — אבל הוא עדיין המדידה האחרונה
      return cached.trades;
    }
    return null;
  }
}
