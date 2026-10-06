// ─────────────────────────────────────────────────────────────────────
// WEAVE-ARBITRAGE · מנוע-המדידה הטהור (r192-d · פורט 3050)
//
// קריאה-בלבד (READ-ONLY): גלאי-הזדמנויות רישתי בין ספרי-השוק הפנימיים
// של Steem/Hive, בריכות ה-Sovereign Exchange, וציטוטי-CEX ייחוס.
// אין-ביצוע, אין-שידורים, אין-הצבת-פקודות — הביצוע נשאר במנועים
// הקיימים תחת קפסות-L4 (חוק-ר192-d).
//
// חוקי-הרשת הממומשים כאן:
//   · [L1] פדיון-אמת — הזדמנות מדווחת רק אם יש עומק בר-ביצוע בכל רגל-ספר;
//     מחירי-רגלי-בריכה = נוסחת-ה-CPMM של ה-exchange עצמו (quoteSwap), לא המצאה.
//   · [L3] מינימום-עסקה $2 — הזדמנות מתחת ל-$2 אינה מדווחת.
//   · [L5] כנות — רגל-CEX היא ייחוס-בלבד (מסומנת cexReference:true);
//     רגלי-peg 1:1 מסומנות peg (USDS מינט/שריפה מלא-רזרבה, WSBD/WHBD עטיפה 1:1).
//   · עמלות: שוק-פנימי 0.75% (75bps — חוזה-ר192-d; Hive בפועל 0.25% — 75bps
//     הוא-השמרני); בריכה feeBps-חי (30); CEX-ייחוס 10bps (הערכה, מסומנת);
//     gas≈0 (RC על Steem/Hive · Zero=$0 — חוק-L6).
//
// הקנון שהועתק מ- src/lib/weave/sovereign-exchange.ts (pricesUsdRaw):
//   SBD/USD ו-HBD/USD = CoinGecko תחילה; נפילה-ריבונית: מחיר-CEX של
//   STEEM/HIVE ÷ מחיר-הפאריטה-מהספר-הפנימי (השוק שלנו הוא המקור).
// ─────────────────────────────────────────────────────────────────────

// ── עמלות (bps) ──────────────────────────────────────────────────────
export const FEES = {
  steemInternalBps: 75, // חוזה-r192-d: 0.75% שוק-פנימי
  hiveInternalBps: 75, // שמרני (בפועל Hive 0.25%) — חוזה-r192-d
  cexReferenceBps: 10, // ייחוס בלבד — הערכת-taker, מסומנת cexReference
} as const;

/** מועמדי-גודל למדידה (USD) — רצפת-L3 היא $2; תקרה $50 להזדמנות-מדידה. */
export const SIZE_CANDIDATES_USD = [2, 5, 10, 20, 50] as const;
export const MIN_OPP_SIZE_USD = 2;

// ── ספר-פקודות מנורמל ────────────────────────────────────────────────
export interface BookLevel {
  /** מחיר-אמת: יחידות-stable (SBD/HBD) ליחידת-נכס (STEEM/HIVE) */
  price: number;
  /** כמות-נותרת של הנכס */
  qty: number;
  /** שווי-הרמה ב-stable (qty×price) */
  quote: number;
}

export interface Book {
  bids: BookLevel[]; // קונים של הנכס — יורד-מחיר
  asks: BookLevel[]; // מוכרים של הנכס — עולה-מחיר
}

export function sortBook(b: Book): Book {
  const asks = [...b.asks].sort((x, y) => x.price - y.price);
  const bids = [...b.bids].sort((x, y) => y.price - x.price);
  return { bids, asks };
}

/** הליכת-asks לקניית-נכס עד-תקרתהוצאה ב-stable. ok=false אם אין עומק מספיק (L1). */
export function walkBuy(
  b: Book,
  spendStable: number,
): { ok: boolean; vwap: number; got: number; spent: number; available: number } {
  const asks = sortBook(b).asks;
  let spent = 0;
  let got = 0;
  let available = 0;
  for (const lvl of asks) {
    if (!(lvl.qty > 0) || !(lvl.price > 0)) continue;
    available += lvl.quote;
    if (spent >= spendStable) continue;
    const takeQuote = Math.min(lvl.quote, spendStable - spent);
    spent += takeQuote;
    got += takeQuote / lvl.price;
  }
  const ok = spent >= spendStable * 0.999 && got > 0;
  return { ok, vwap: got > 0 ? spent / got : 0, got, spent, available };
}

/** הליכת-bids למכירת-נכס בכמות-נתונה. ok=false אם אין עומק מספיק (L1). */
export function walkSell(
  b: Book,
  qtyX: number,
): { ok: boolean; vwap: number; got: number; sold: number; available: number } {
  const bids = sortBook(b).bids;
  let sold = 0;
  let got = 0;
  let available = 0;
  for (const lvl of bids) {
    if (!(lvl.qty > 0) || !(lvl.price > 0)) continue;
    available += lvl.quote;
    if (sold >= qtyX) continue;
    const takeQty = Math.min(lvl.qty, qtyX - sold);
    sold += takeQty;
    got += takeQty * lvl.price;
  }
  const ok = sold >= qtyX * 0.999 && got > 0;
  return { ok, vwap: sold > 0 ? got / sold : 0, sold, got, available };
}

// ── CPMM — נוסחת-quoteSwap של ה-exchange (מקור: sovereign-exchange.ts:463) ──
export function cpmmOut(amountIn: number, rIn: number, rOut: number, feeBps: number): number {
  const inWithFee = amountIn * (10000 - feeBps);
  return (rOut * inWithFee) / (rIn * 10000 + inWithFee);
}

// ── עזרי-bps ─────────────────────────────────────────────────────────
export const netBps = (out: number, inUsd: number): number => (out / inUsd) * 10000 - 10000;

// ── אובייקט-הזדמנות ──────────────────────────────────────────────────
export interface OppLeg {
  venue: string;
  side: string;
  price: number; // מחיר-ממוצע-משוקלל ברגל זו (יחידות-יעד ליחידת-מקור)
  feeBps: number;
  cexReference?: boolean;
  peg?: boolean;
}

export interface Opportunity {
  id: string;
  klass: string;
  direction: string;
  sizeUsd: number; // הגודל הנבחר (הטוב-מבחינת-netUsd בין המועמדים)
  netBps: number;
  netUsd: number;
  maxFeasibleUsd: number; // העומק הבר-ביצוע המקסימלי שנמדד (L1)
  legs: OppLeg[];
  cexReference: boolean;
  at: string;
  notes: string;
}

interface CandidateSize {
  sizeUsd: number;
  ok: boolean;
  netUsd: number;
  legs: OppLeg[];
}

/** בוחר את הגודל-הטוב (max netUsd חיובי) מבין המועמדים הברי-ביצוע. */
export function pickBest(cands: CandidateSize[], id: string, klass: string, direction: string, at: string, notes: string): Opportunity | null {
  let best: CandidateSize | null = null;
  let maxFeasible = 0;
  for (const c of cands) {
    if (!c.ok) continue;
    if (c.sizeUsd > maxFeasible) maxFeasible = c.sizeUsd;
    if (c.netUsd > 0 && (best == null || c.netUsd > best.netUsd)) best = c;
  }
  if (!best || best.sizeUsd < MIN_OPP_SIZE_USD) return null;
  const out = best.sizeUsd + best.netUsd;
  return {
    id,
    klass,
    direction,
    sizeUsd: best.sizeUsd,
    netBps: Math.round(netBps(out, best.sizeUsd) * 10) / 10,
    netUsd: Math.round(best.netUsd * 10000) / 10000,
    maxFeasibleUsd: maxFeasible,
    legs: best.legs,
    cexReference: best.legs.some((l) => l.cexReference),
    at,
    notes,
  };
}

// ── הזדמנויות-2-רגל: ספר-פנימי מול CEX-ייחוס ─────────────────────────
/**
 * קנייה על הספר (asks, עמלת-שוק-פנימי) וסגירה ב-CEX (ייחוס).
 * USD → (÷sbdUsd) → SBD → [asks: SBD→X, fee] → X → [CEX: X→USD ref fee] → USD
 */
export function oppBookBuyVsCex(
  b: Book,
  cexUsd: number,
  stableUsd: number,
  feeBps: number,
  venue: string,
  cexVenue: string,
  at: string,
): Opportunity | null {
  const cands: CandidateSize[] = [];
  for (const S of SIZE_CANDIDATES_USD) {
    const spendStable = S / stableUsd;
    const w = walkBuy(b, spendStable);
    if (!w.ok) continue;
    const gotX = w.got * (1 - feeBps / 10000);
    const outUsd = gotX * cexUsd * (1 - FEES.cexReferenceBps / 10000);
    cands.push({
      sizeUsd: S,
      ok: true,
      netUsd: outUsd - S,
      legs: [
        { venue, side: "buy-asks", price: w.vwap, feeBps },
        { venue: cexVenue, side: "sell", price: cexUsd, feeBps: FEES.cexReferenceBps, cexReference: true },
      ],
    });
  }
  return pickBest(cands, `${venue}-buy-vs-cex`, "book-vs-cex", "buy-book/sell-cex", at, `VWAP-asks מול CEX ייחוס; stable=$${stableUsd}`);
}

/**
 * פתיחה ב-CEX (ייחוס) וסגירה על הספר (bids, עמלת-שוק-פנימי).
 * USD → [CEX: USD→X ref fee] → X → [bids: X→SBD, fee] → SBD → (×stableUsd) → USD
 */
export function oppBookSellVsCex(
  b: Book,
  cexUsd: number,
  stableUsd: number,
  feeBps: number,
  venue: string,
  cexVenue: string,
  at: string,
): Opportunity | null {
  const cands: CandidateSize[] = [];
  for (const S of SIZE_CANDIDATES_USD) {
    const gotX = (S * (1 - FEES.cexReferenceBps / 10000)) / cexUsd;
    const w = walkSell(b, gotX);
    if (!w.ok) continue;
    const gotStable = w.got * (1 - feeBps / 10000);
    const outUsd = gotStable * stableUsd;
    cands.push({
      sizeUsd: S,
      ok: true,
      netUsd: outUsd - S,
      legs: [
        { venue: cexVenue, side: "buy", price: cexUsd, feeBps: FEES.cexReferenceBps, cexReference: true },
        { venue, side: "sell-bids", price: w.vwap, feeBps },
      ],
    });
  }
  return pickBest(cands, `${venue}-sell-vs-cex`, "book-vs-cex", "buy-cex/sell-book", at, `CEX ייחוס מול VWAP-bids; stable=$${stableUsd}`);
}

// ── הזדמנות-3-רגל: ספר-Steem מול ספר-Hive (רגל-חיבור = CEX-ייחוס) ─────
/**
 * קניית STEEM על ספר-Steem (asks) → CEX-cross STEEM→HIVE (ייחוס) → מכירת
 * HIVE על ספר-Hive (bids) → HBD→USD. זו-הפאריטה-הרישתית בין שני-הספרים.
 */
export function oppSteemBookVsHiveBook(
  steem: Book,
  hive: Book,
  steemCexUsd: number,
  hiveCexUsd: number,
  sbdUsd: number,
  hbdUsd: number,
  at: string,
): Opportunity | null {
  const cands: CandidateSize[] = [];
  for (const S of SIZE_CANDIDATES_USD) {
    const spendSbd = S / sbdUsd;
    const wb = walkBuy(steem, spendSbd);
    if (!wb.ok) continue;
    const gotSteem = wb.got * (1 - FEES.steemInternalBps / 10000);
    // 1 STEEM = steemCexUsd USD = steemCexUsd/hiveCexUsd HIVE (צלב-CEX — ייחוס)
    const gotHive = gotSteem * (steemCexUsd / hiveCexUsd) * (1 - FEES.cexReferenceBps / 10000);
    const ws = walkSell(hive, gotHive);
    if (!ws.ok) continue;
    const gotHbd = ws.got * (1 - FEES.hiveInternalBps / 10000);
    const outUsd = gotHbd * hbdUsd;
    cands.push({
      sizeUsd: S,
      ok: true,
      netUsd: outUsd - S,
      legs: [
        { venue: "steem-internal", side: "buy-asks", price: wb.vwap, feeBps: FEES.steemInternalBps },
        { venue: "cex-cross", side: "steem→hive", price: hiveCexUsd / steemCexUsd, feeBps: FEES.cexReferenceBps, cexReference: true },
        { venue: "hive-internal", side: "sell-bids", price: ws.vwap, feeBps: FEES.hiveInternalBps },
      ],
    });
  }
  return pickBest(cands, "steem-vs-hive-books", "crosschain-parity", "buy-steem-book/sell-hive-book", at, "שני-הספרים הפנימיים; חיבור-STEEM↔HIVE ב-CEX ייחוס");
}

/** הכיוון-ההפוך של הפאריטה הרישתית: קניית HIVE על Hive → CEX-cross → מכירת STEEM על Steem. */
export function oppHiveBookVsSteemBook(
  steem: Book,
  hive: Book,
  steemCexUsd: number,
  hiveCexUsd: number,
  sbdUsd: number,
  hbdUsd: number,
  at: string,
): Opportunity | null {
  const cands: CandidateSize[] = [];
  for (const S of SIZE_CANDIDATES_USD) {
    const spendHbd = S / hbdUsd;
    const wb = walkBuy(hive, spendHbd);
    if (!wb.ok) continue;
    const gotHive = wb.got * (1 - FEES.hiveInternalBps / 10000);
    // 1 HIVE = hiveCexUsd USD = hiveCexUsd/steemCexUsd STEEM (צלב-CEX — ייחוס)
    const gotSteem = gotHive * (hiveCexUsd / steemCexUsd) * (1 - FEES.cexReferenceBps / 10000);
    const ws = walkSell(steem, gotSteem);
    if (!ws.ok) continue;
    const gotSbd = ws.got * (1 - FEES.steemInternalBps / 10000);
    const outUsd = gotSbd * sbdUsd;
    cands.push({
      sizeUsd: S,
      ok: true,
      netUsd: outUsd - S,
      legs: [
        { venue: "hive-internal", side: "buy-asks", price: wb.vwap, feeBps: FEES.hiveInternalBps },
        { venue: "cex-cross", side: "hive→steem", price: steemCexUsd / hiveCexUsd, feeBps: FEES.cexReferenceBps, cexReference: true },
        { venue: "steem-internal", side: "sell-bids", price: ws.vwap, feeBps: FEES.steemInternalBps },
      ],
    });
  }
  return pickBest(cands, "hive-vs-steem-books", "crosschain-parity", "buy-hive-book/sell-steem-book", at, "שני-הספרים הפנימיים; חיבור-STEEM↔HIVE ב-CEX ייחוס");
}

// ── הזדמנויות מול בריכת ה-exchange (CPMM חי) ─────────────────────────
export interface PoolLeg {
  /** למשל WSTEEM/WSBD */
  pair: string;
  assetA: string;
  assetB: string;
  reserveA: number;
  reserveB: number;
  feeBps: number;
}

/**
 * ספר-Steem מול בריכת WSTEEM/WSBD — שתי-הרגליים ברות-ביצוע:
 * קניית STEEM ב-asks → עטיפה WSTEEM (1:1 peg) → מכירה בבריכה ל-WSBD → שריפת-USDS 1:1 → USD.
 */
export function oppSteemBookVsExchangePool(
  steem: Book,
  pool: PoolLeg,
  sbdUsd: number,
  at: string,
): Opportunity | null {
  const cands: CandidateSize[] = [];
  for (const S of SIZE_CANDIDATES_USD) {
    const spendSbd = S / sbdUsd;
    const wb = walkBuy(steem, spendSbd);
    if (!wb.ok) continue;
    const gotWsteem = wb.got * (1 - FEES.steemInternalBps / 10000); // עטיפה 1:1 — peg
    const outW = cpmmOut(gotWsteem, pool.reserveA, pool.reserveB, pool.feeBps); // WSTEEM→WSBD (A2B)
    const outUsd = outW * sbdUsd; // WSBD→USDS 1:1 → USD (peg)
    cands.push({
      sizeUsd: S,
      ok: true,
      netUsd: outUsd - S,
      legs: [
        { venue: "steem-internal", side: "buy-asks", price: wb.vwap, feeBps: FEES.steemInternalBps },
        { venue: `exchange:${pool.pair}`, side: "sell-A2B", price: outW / gotWsteem, feeBps: pool.feeBps },
        { venue: "exchange:peg", side: "WSBD→USDS", price: 1, feeBps: 0, peg: true },
      ],
    });
  }
  return pickBest(cands, "steem-book-vs-pool", "book-vs-exchange", "buy-book/sell-pool", at, `בריכה ${pool.pair} רזרבות ${pool.reserveA}/${pool.reserveB}`);
}

/** ההפוך: קניית WSTEEM מהבריכה (B2A) → פדיון-אמיתי 1:1 → מכירת STEEM על הספר (bids). */
export function oppExchangePoolVsSteemBook(
  steem: Book,
  pool: PoolLeg,
  sbdUsd: number,
  at: string,
): Opportunity | null {
  const cands: CandidateSize[] = [];
  for (const S of SIZE_CANDIDATES_USD) {
    const inW = S / sbdUsd; // WSBD→USDS 1:1 → שריפה → קניית WSTEEM בבריכה (B2A: WSBD→WSTEEM)
    const outSteem = cpmmOut(inW, pool.reserveB, pool.reserveA, pool.feeBps);
    const ws = walkSell(steem, outSteem);
    if (!ws.ok) continue;
    const outSbd = ws.got * (1 - FEES.steemInternalBps / 10000);
    const outUsd = outSbd * sbdUsd;
    cands.push({
      sizeUsd: S,
      ok: true,
      netUsd: outUsd - S,
      legs: [
        { venue: "exchange:peg", side: "USDS→WSBD", price: 1, feeBps: 0, peg: true },
        { venue: `exchange:${pool.pair}`, side: "buy-B2A", price: inW / outSteem, feeBps: pool.feeBps },
        { venue: "steem-internal", side: "sell-bids", price: ws.vwap, feeBps: FEES.steemInternalBps },
      ],
    });
  }
  return pickBest(cands, "pool-vs-steem-book", "book-vs-exchange", "buy-pool/sell-book", at, `בריכה ${pool.pair} רזרבות ${pool.reserveA}/${pool.reserveB}`);
}

/** בריכה מול CEX-ייחוס: קניית WSBD→WSTEEM בבריכה, סגירה ב-CEX. */
export function oppExchangePoolVsCex(
  pool: PoolLeg,
  cexUsd: number,
  sbdUsd: number,
  at: string,
): Opportunity | null {
  const cands: CandidateSize[] = [];
  for (const S of SIZE_CANDIDATES_USD) {
    const inW = S / sbdUsd;
    const outSteem = cpmmOut(inW, pool.reserveB, pool.reserveA, pool.feeBps);
    const outUsd = outSteem * cexUsd * (1 - FEES.cexReferenceBps / 10000);
    cands.push({
      sizeUsd: S,
      ok: true,
      netUsd: outUsd - S,
      legs: [
        { venue: "exchange:peg", side: "USDS→WSBD", price: 1, feeBps: 0, peg: true },
        { venue: `exchange:${pool.pair}`, side: "buy-B2A", price: inW / outSteem, feeBps: pool.feeBps },
        { venue: "cex", side: "sell", price: cexUsd, feeBps: FEES.cexReferenceBps, cexReference: true },
      ],
    });
  }
  return pickBest(cands, "pool-vs-cex", "exchange-vs-cex", "buy-pool/sell-cex", at, `בריכה ${pool.pair} מול CEX ייחוס`);
}

// ── מדידות-פאריטה לאבחון (לא-הזדמנויות) ──────────────────────────────
export function parityBps(bookMid: number, refPrice: number): number | null {
  if (!(bookMid > 0) || !(refPrice > 0)) return null;
  return Math.round((bookMid / refPrice - 1) * 10000 * 10) / 10;
}

export function bookMid(b: Book): number | null {
  const s = sortBook(b);
  const bid = s.bids[0]?.price ?? 0;
  const ask = s.asks[0]?.price ?? 0;
  if (bid > 0 && ask > 0 && ask >= bid) return (bid + ask) / 2;
  return null;
}
