// ─────────────────────────────────────────────────────────────────────
// price-feeds — מקורות-מחיר עמידים (R105)
//
// לקח חי מהשטח (2026-09-24): Binance הטילה איסור-משקל זמני על ה-IP
// (418: "Way too much request weight") — וכל מדידת המחירים של הכלכלה
// השתתקה לרגע. חוק-המסקנה: מקור-יחיד הוא חוסר-פעילות מובנה.
// מעתה: Binance (ראשי) ← Gate.io (מגבה מלא) ← OKX (שכבה שלישית ל-SOL/ETH).
// הכל ציבורי, נטול-מפתחות, וכל קריאה נושאת פס-קצה משלה.
// ─────────────────────────────────────────────────────────────────────

/** זוג ספוט (בסיס-USDT) במפתח המקומי של כל בורסה */
export type SpotPair = "SOLUSDT" | "ETHUSDT" | "STEEMUSDT" | "HIVEUSDT";

interface FeedResult {
  price: number | null;
  source: string | null;
}

async function withTimeout(ms: number): Promise<AbortSignal> {
  return AbortSignal.timeout(ms);
}

/** Binance — הראשי (משקל-בקשה נמוך: ticker יחיד) */
async function binanceSpot(pair: SpotPair): Promise<FeedResult> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`, {
      signal: await withTimeout(6000),
    });
    if (!res.ok) return { price: null, source: null };
    const j = (await res.json()) as { price?: string };
    const p = Number(j.price);
    return Number.isFinite(p) && p > 0 ? { price: p, source: "binance" } : { price: null, source: null };
  } catch {
    return { price: null, source: null };
  }
}

/** Gate.io — המגבה המלא (SOL/ETH/STEEM/HIVE — נמדדו חיים) */
async function gateSpot(pair: SpotPair): Promise<FeedResult> {
  const gatePair = pair.replace("USDT", "_USDT");
  try {
    const res = await fetch(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${gatePair}`, {
      signal: await withTimeout(6000),
    });
    if (!res.ok) return { price: null, source: null };
    const j = (await res.json()) as Array<{ last?: string }>;
    const p = Number(j?.[0]?.last);
    return Number.isFinite(p) && p > 0 ? { price: p, source: "gate" } : { price: null, source: null };
  } catch {
    return { price: null, source: null };
  }
}

/** OKX — השכבה השלישית (SOL/ETH בלבד; STEEM/HIVE לא רשומים שם) */
async function okxSpot(pair: SpotPair): Promise<FeedResult> {
  if (pair === "STEEMUSDT" || pair === "HIVEUSDT") return { price: null, source: null };
  const okxInst = pair.replace("USDT", "-USDT");
  try {
    const res = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${okxInst}`, {
      signal: await withTimeout(6000),
    });
    if (!res.ok) return { price: null, source: null };
    const j = (await res.json()) as { code?: string; data?: Array<{ last?: string }> };
    const p = Number(j?.data?.[0]?.last);
    return Number.isFinite(p) && p > 0 ? { price: p, source: "okx" } : { price: null, source: null };
  } catch {
    return { price: null, source: null };
  }
}

/** מחיר ספוט חי — Binance ← Gate ← OKX. null כנה רק אם כולם שתקו. */
export async function spotUsd(pair: SpotPair): Promise<FeedResult> {
  const b = await binanceSpot(pair);
  if (b.price != null) return b;
  const g = await gateSpot(pair);
  if (g.price != null) return { ...g, source: `${g.source} (fallback: binance חסום)` };
  const o = await okxSpot(pair);
  if (o.price != null) return { ...o, source: `${o.source} (fallback-2)` };
  return { price: null, source: null };
}

/** צרור — כל הזוגות בסבב אחד (מקור-אחד לכל זוג, בלי פיצוץ משקל) */
export async function spotUsdAll(pairs: SpotPair[]): Promise<Record<string, { price: number | null; source: string | null }>> {
  const out: Record<string, { price: number | null; source: string | null }> = {};
  await Promise.all(pairs.map(async (p) => {
    out[p] = await spotUsd(p);
  }));
  return out;
}
