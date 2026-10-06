// ─────────────────────────────────────────────────────────────────────
// GRID-PNL — כלכלת הגריד · מנוע ייחוס-הרווח (R95).
//
// הוראת המפעיל שיצרה את המנוע: "להרוויח מmarket maker grid... אני לא רוצה
// ריבונות עצלנית אני רוצה הוכחות התפתחות הבנה התייעלות".
//
// מה שהיה חסר (נמדד בפתיחת R95, 02:45Z): לרשת אין תשובה מדודה לשאלה
// "האם הגריד מרוויח?". הסולם חי (476.637 STEEM ב-3 פקודות), הפאריטה
// נמדדת — אבל אף אחד לא ספר את המילויים, לא ייחס סבבים, ולא פסק
// באיזה משטר כלכלי הסולם חי. סריקת-העומק הראשונה (3,030 רשומות מה-
// RPC) מצאה: 5 מילויים אי-פעם, האחרון 2026-09-13 — עשרה ימים של שקט.
// האמת הזו היא נקודת הפתיחה, לא סיפור הצלחה.
//
// ארבע שכבות (כולן מהשרשרת, חסרות-מפתחות):
//   1. סריקת-עומק אינקרמנטלית — get_account_history בעמודי 100
//      (לקח R91: מגבלת ה-API), צ'קפוינט לקובץ — מדידה מלאה פעם
//      אחת, אחר-כך רק החדש. היסטוריית החשבון append-only לפי אינדקס.
//   2. ייחוס מילויים — כל fill_order שלנו: כיוון, מחיר, גודל, maker/taker.
//   3. סבבים (FIFO) — קנייה שנסגרה במכירה = סבב; הלכידה נמדדת ב-SBD
//      וב-bps, גם כשהיא שלילית. מלאי פתוח לא נספר כרווח.
//   4. פסק-דין משטר — השוק הפנימי מול הפאריטה החיצונית: VALUE-TRAP
//      (השוק מתחת לפאריטה — מכירה בפאריטה לא נפגעת) או CAPTURE.
//
// חוקי-כנות:
//   · אין הבטחת רווח, אף פעם (חוק הבטיחות).
//   · "לא נמדד" נכתב כ"לא נמדד" — לא כאפס.
//   · המרה לדולר נעשית בשערים של היום בלבד, ומוצהרת ככזו.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

const HOME = "/home/z/my-project";
const SCAN_FILE = path.join(HOME, "sovereign/money/pnl-scan.json");
const STEEM_RPC = "https://api.steemit.com";
const ACCOUNT = "headcorner";
/** רצפת הסריקה המלאה — לפני עידן-הגריד (2026-09-10) אין מה לחפש */
const FULL_SCAN_FLOOR_ISO = "2026-09-01T00:00:00Z";
const MAX_PAGES = 40;

// ── טיפוסים (חוזה BE↔FE) ─────────────────────────────────────────────

export interface PnlFill {
  /** אינדקס היסטוריית-החשבון — יציב וייחודי, משמש מזהה */
  idx: number;
  at: string;
  side: "bought-steem" | "sold-steem";
  /** SBD תמורת STEEM — תמיד quote-per-base */
  price: number | null;
  steem: number;
  sbd: number;
  /** היינו הפקודה הרובצת (open) — maker */
  maker: boolean;
}

export interface PnlRoundTrip {
  openedAt: string;
  closedAt: string;
  steem: number;
  entryPrice: number;
  exitPrice: number;
  capturedSbd: number;
  capturedBps: number;
}

export interface GridPnl {
  at: string;
  account: string;
  ok: boolean;
  scan: {
    pagesThisRun: number;
    entriesScanned: number;
    downToIndex: number | null;
    maxIndex: number | null;
    fullScan: boolean;
    checkpointAt: string | null;
  };
  fills: PnlFill[];
  stats: {
    fillsTotal: number;
    bought: { count: number; steem: number; sbd: number; avgPrice: number | null };
    sold: { count: number; steem: number; sbd: number; avgPrice: number | null };
    netSteem: number;
    netSbd: number;
    roundTrips: number;
    capturedSbd: number;
    /** מלאי שנקנה וטרם נמכר — לא רווח, עמדה פתוחה */
    openLongSteem: number;
    firstFillAt: string | null;
    lastFillAt: string | null;
    quietDays: number | null;
  };
  market: {
    bestBid: number | null;
    bestAsk: number | null;
    internalMid: number | null;
    spreadBps: number | null;
    /** פאריטה חיצונית: steemUsd / sbdUsd */
    parity: number | null;
    /** שלילי = השוק הפנימי נסחר מתחת לפאריטה החיצונית */
    midVsParityBps: number | null;
    sbdUsd: number | null;
    steemUsd: number | null;
    /** מקור שער ה-SBD — כנות מלאה כשקוינגקו נופל ל-money.json של הקונסולה */
    sbdSource: string | null;
  };
  ladder: {
    orders: number;
    deployedSteem: number;
    lowestAsk: number | null;
    highestAsk: number | null;
    /** המרחק של המדרגה התחתונה מעל מרכז השוק — למה הסולם שקט */
    lowestAskVsMidBps: number | null;
  };
  /** יתרות נזילות מהשרשרת — מה זמין לגריד דו-צדדי */
  balances: { steem: number | null; sbd: number | null };
  regime: { verdict: "VALUE-TRAP" | "CAPTURE" | "UNKNOWN"; detail: string };
  opportunities: Array<{ id: string; title: string; state: "GATED" | "ARMED" | "WAIT"; detail: string }>;
  doctrine: string[];
  down: string[];
}

// ── רשת בסיסית (חסרת-מפתחות) ──────────────────────────────────────────

async function jpost<T>(method: string, params: unknown[], timeoutMs = 12_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(STEEM_RPC, {
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

async function jget(url: string, timeoutMs = 9_000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "the-weave-grid-pnl/1.0" },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function parseAmount(s: string | undefined): { n: number; asset: string } {
  const m = String(s ?? "").trim().match(/^([\d.]+)\s+(\S+)$/);
  if (!m) return { n: 0, asset: "" };
  return { n: parseFloat(m[1]) || 0, asset: m[2] };
}

// ── שכבה 1: סריקת-עומק אינקרמנטלית ────────────────────────────────────

interface ScanCheckpoint {
  savedAt: string;
  maxIndex: number;
  downToIndex: number;
  floorIso: string;
  fills: PnlFill[];
}

function loadCheckpoint(): ScanCheckpoint | null {
  try {
    const j = JSON.parse(fs.readFileSync(SCAN_FILE, "utf8"));
    if (typeof j?.maxIndex === "number" && Array.isArray(j?.fills)) return j;
    return null;
  } catch {
    return null;
  }
}

function saveCheckpoint(cp: ScanCheckpoint): void {
  try {
    fs.mkdirSync(path.dirname(SCAN_FILE), { recursive: true });
    // r146-d — חוק הכתיבה-האטומית (אותו חוק של state.json): צ'קפוינט שנקרא
    // בכל-דקה על-ידי הסנס/הדאימון/המבקר לא יכול להיקרא חצוי — .tmp ואז rename.
    const tmp = `${SCAN_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cp, null, 2));
    fs.renameSync(tmp, SCAN_FILE);
  } catch {
    /* כתיבת-צ'קפוינט נכשלה — הסריקה הבאה פשוט תעשה עבודה חוזרת */
  }
}

// r146-d — הצעת-המנוע לצרכנים-תדירים: סריקה אינקרמנטלית מהצ'קפוינט
// (בד"כ עמוד אחד) + שמירה אטומית. נולד מפער-חי שנמדד: הצ'קפוינט התקדם
// רק כשמישהו ביקר ב-/api/money/pnl — נמדד פער 8.7ש' (savedAt 01:04 מול
// מילויים חדשים ב-09:44) וספר-ה-FIFO הרשמי נשאר מאחורי האמת.
// single-flight לתהליך: הסנס של /api/money קורא את זה בכל-דקה.
let fillsRefreshInFlight = false;
export async function refreshFillsCheckpoint(): Promise<{
  ok: boolean;
  savedAt: string | null;
  maxIndex: number | null;
  fillsTotal: number | null;
  lastFillIdx: number | null;
  error?: string;
}> {
  if (fillsRefreshInFlight) {
    const cp = loadCheckpoint();
    return { ok: !!cp, savedAt: cp?.savedAt ?? null, maxIndex: cp?.maxIndex ?? null, fillsTotal: cp?.fills.length ?? null, lastFillIdx: cp?.maxIndex ?? null, error: "in-flight" };
  }
  fillsRefreshInFlight = true;
  try {
    const res = await deepFills();
    const last = res.fills.length ? res.fills[res.fills.length - 1]! : null;
    return { ok: true, savedAt: new Date().toISOString(), maxIndex: res.maxIndex, fillsTotal: res.fills.length, lastFillIdx: last?.idx ?? null };
  } catch (e) {
    return { ok: false, savedAt: null, maxIndex: null, fillsTotal: null, lastFillIdx: null, error: String((e as Error)?.message ?? e).slice(0, 120) };
  } finally {
    fillsRefreshInFlight = false;
  }
}

interface HistoryEntry {
  idx: number;
  timestamp?: string;
  op: [string, Record<string, unknown>];
}

function fillFromEntry(idx: number, rec: HistoryEntry): PnlFill | null {
  const [type, data] = rec.op;
  if (type !== "fill_order") return null;
  const weCurrent = (data as any)?.current_owner === ACCOUNT;
  const weOpen = (data as any)?.open_owner === ACCOUNT;
  if (!weCurrent && !weOpen) return null;
  const paid = weCurrent ? String((data as any)?.current_pays ?? "") : String((data as any)?.open_pays ?? "");
  const got = weCurrent ? String((data as any)?.open_pays ?? "") : String((data as any)?.current_pays ?? "");
  const p = parseAmount(paid);
  const g = parseAmount(got);
  if (p.n <= 0 || g.n <= 0) return null;
  let side: PnlFill["side"];
  let price: number | null = null;
  if (p.asset === "STEEM" && g.asset === "SBD") {
    side = "sold-steem";
    price = g.n / p.n;
  } else if (p.asset === "SBD" && g.asset === "STEEM") {
    side = "bought-steem";
    price = p.n / g.n;
  } else {
    return null;
  }
  return {
    idx,
    at: (rec.timestamp ?? "") + (String(rec.timestamp ?? "").includes("Z") ? "" : "Z"),
    side,
    price: price != null && Number.isFinite(price) ? Math.round(price * 1e6) / 1e6 : null,
    steem: side === "sold-steem" ? p.n : g.n,
    sbd: side === "sold-steem" ? g.n : p.n,
    maker: !weCurrent,
  };
}

async function deepFills(): Promise<{ fills: PnlFill[]; pages: number; entries: number; downToIndex: number | null; maxIndex: number | null; fullScan: boolean }> {
  const cp = loadCheckpoint();
  let pages = 0;
  let entries = 0;
  let start = -1;
  let downToIndex: number | null = null;
  let maxIndex: number | null = null;
  const found = new Map<number, PnlFill>();
  let stop = false;
  while (pages < MAX_PAGES && !stop) {
    const hist = await jpost<Array<[number, HistoryEntry]>>("condenser_api.get_account_history", [ACCOUNT, start, 100]);
    if (!hist || !hist.length) break;
    let minIdx = Infinity;
    let maxIdx = -1;
    let oldestTs = "";
    for (const [idx, rec] of hist) {
      minIdx = Math.min(minIdx, idx);
      maxIdx = Math.max(maxIdx, idx);
      if (idx > (cp?.maxIndex ?? -1)) {
        const f = fillFromEntry(idx, rec);
        if (f) found.set(idx, f);
      }
    }
    entries += hist.length;
    downToIndex = minIdx;
    maxIndex = maxIdx > (maxIndex ?? -1) ? maxIdx : maxIndex;
    const first = hist[0]?.[1];
    oldestTs = String((first as any)?.timestamp ?? "");
    // תנאי עצירה: הגענו לשטח שכבר נסרק, או מתחת לרצפת העידן, או סוף ההיסטוריה
    if (cp && minIdx <= cp.maxIndex) stop = true;
    else if (oldestTs && oldestTs < FULL_SCAN_FLOOR_ISO) stop = true;
    else if (hist.length < 100) stop = true;
    else if (minIdx <= 0) stop = true;
    else start = minIdx - 1;
    pages += 1;
  }
  const merged = new Map<number, PnlFill>();
  if (cp) for (const f of cp.fills) merged.set(f.idx, f);
  for (const [k, v] of found) merged.set(k, v);
  const fills = [...merged.values()].sort((a, b) => a.idx - b.idx);
  const fullScan = !cp || (cp.floorIso ?? "") !== FULL_SCAN_FLOOR_ISO;
  saveCheckpoint({
    savedAt: new Date().toISOString(),
    maxIndex: maxIndex ?? cp?.maxIndex ?? 0,
    downToIndex: downToIndex ?? cp?.downToIndex ?? 0,
    floorIso: FULL_SCAN_FLOOR_ISO,
    fills,
  });
  return { fills, pages, entries, downToIndex, maxIndex, fullScan };
}

// ── שכבה 3: סבבים (FIFO) ───────────────────────────────────────────────

function roundTrips(fills: PnlFill[]): { trips: PnlRoundTrip[]; openLongSteem: number } {
  const queue: Array<{ steem: number; price: number; at: string }> = [];
  const trips: PnlRoundTrip[] = [];
  for (const f of fills) {
    if (f.price == null) continue;
    if (f.side === "bought-steem") {
      queue.push({ steem: f.steem, price: f.price, at: f.at });
    } else {
      let remain = f.steem;
      while (remain > 1e-9 && queue.length) {
        const head = queue[0];
        const take = Math.min(remain, head.steem);
        const captured = (f.price - head.price) * take;
        trips.push({
          openedAt: head.at,
          closedAt: f.at,
          steem: Math.round(take * 1e3) / 1e3,
          entryPrice: head.price,
          exitPrice: f.price,
          capturedSbd: Math.round(captured * 1e6) / 1e6,
          capturedBps: Math.round(((f.price - head.price) / head.price) * 10_000),
        });
        head.steem -= take;
        remain -= take;
        if (head.steem <= 1e-9) queue.shift();
      }
    }
  }
  const openLongSteem = queue.reduce((s, q) => s + q.steem, 0);
  return { trips, openLongSteem: Math.round(openLongSteem * 1e3) / 1e3 };
}

// ── שכבה 4: שוק + סולם + משטר ─────────────────────────────────────────

async function marketSide(): Promise<{
  book: { bestBid: number | null; bestAsk: number | null; mid: number | null; spreadBps: number | null };
  orders: Array<{ steem: number; price: number }>;
  balances: { steem: number | null; sbd: number | null };
  marks: { steemUsd: number | null; sbdUsd: number | null };
  sbdSource: string | null;
  down: string[];
}> {
  const down: string[] = [];
  // null-ים מפורשים (number | null) — בלי זה `empty` מסיק את הטיפוס הליטרלי null
  // ומסרב לקבל את המילוי החי של הספר/היתרות בהמשך
  const empty = {
    book: { bestBid: null as number | null, bestAsk: null as number | null, mid: null as number | null, spreadBps: null as number | null },
    orders: [] as Array<{ steem: number; price: number }>,
    balances: { steem: null as number | null, sbd: null as number | null },
    marks: { steemUsd: null as number | null, sbdUsd: null as number | null },
    sbdSource: null as string | null,
  };
  const bookP = jpost<any>("condenser_api.get_order_book", [10]).catch((e) => {
    down.push(`book: ${String((e as Error).message).slice(0, 40)}`);
    return null;
  });
  const ordersP = jpost<any>("condenser_api.get_open_orders", [ACCOUNT]).catch((e) => {
    down.push(`orders: ${String((e as Error).message).slice(0, 40)}`);
    return null;
  });
  const acctP = jpost<any>("condenser_api.get_accounts", [[ACCOUNT]]).catch((e) => {
    down.push(`account: ${String((e as Error).message).slice(0, 40)}`);
    return null;
  });
  const binanceP = jget("https://api.binance.com/api/v3/ticker/price?symbol=STEEMUSDT", 8000)
    .then((j) => Number(j?.price))
    .catch(() => null);
  // קוינגקו מוגבל-קצב בחלק מהמחזורים — נפילה-כנה ל-money.json של הקונסולה
  // (אותו דפוס שמנוע-הכסף מוכיח מ-R81), עם הצהרת מקור.
  const cgP = jget("https://api.coingecko.com/api/v3/simple/price?ids=steem-dollars&vs_currencies=usd", 9000)
    .then((j) => (typeof j?.["steem-dollars"]?.usd === "number" ? { v: j["steem-dollars"].usd as number, src: "coingecko" } : null))
    .catch(() => null);
  const consoleP = cgP.then(async (r) => {
    if (r) return r;
    try {
      const m = await jget("https://roshpinacare-sys.github.io/Console/dex/money.json", 8000);
      if (typeof m?.marks?.sbdUsd === "number") {
        return { v: m.marks.sbdUsd as number, src: `console:money.json@${String(m.publishedAt ?? "?").slice(0, 16)}Z` };
      }
    } catch {
      /* בלי שער — נשאר null */
    }
    return null;
  });
  const [rawBook, rawOrders, rawAcct, steemUsd, sbd] = await Promise.all([bookP, ordersP, acctP, binanceP, consoleP]);
  const sbdUsd = sbd?.v ?? null;

  const out = {
    ...empty,
    orders: empty.orders,
    balances: empty.balances,
    marks: { steemUsd: steemUsd ?? null, sbdUsd },
    sbdSource: sbd?.src ?? null,
    down,
  };
  if (rawBook) {
    const bids = (rawBook?.bids ?? []).map((l: any) => parseFloat(String(l?.real_price ?? "0"))).filter((p: number) => p > 0);
    const asks = (rawBook?.asks ?? []).map((l: any) => parseFloat(String(l?.real_price ?? "0"))).filter((p: number) => p > 0);
    const bestBid = bids.length ? Math.max(...bids) : null;
    const bestAsk = asks.length ? Math.min(...asks) : null;
    const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk ?? null;
    out.book = {
      bestBid,
      bestAsk,
      mid,
      spreadBps: bestBid != null && bestAsk != null && mid ? Math.round(((bestAsk - bestBid) / mid) * 10_000) : null,
    };
  }
  if (rawOrders) {
    // דפוס מנוע-הכסף המוכח (R81+): sell_price.base/quote הם מחרוזות "158.879 STEEM"
    // r125 — חוק R97 מובא למנוע: הפרדת צדדים בספר הפתוח. base=STEEM → מכירה
    // (for_sale ב-STEEM, price=SBD/STEEM); base=SBD → קנייה — נספרת בנכס שלה,
    // אחרת דלק-הפריסה היה מונה SBD כ-STEEM והמחיר יוצא הפוך (באג מבני).
    out.orders = (rawOrders as any[])
      .filter((o: any) => String(o.sell_price?.base ?? "").trim().endsWith("STEEM"))
      .map((o: any) => {
        const steem = Number(o.for_sale) / 1000;
        const baseN = parseFloat(String(o.sell_price?.base ?? "")) || 0;
        const quoteN = parseFloat(String(o.sell_price?.quote ?? "")) || 0;
        const price = baseN > 0 ? quoteN / baseN : 0;
        return { steem, price: Math.round(price * 1e6) / 1e6 };
      })
      .filter((o: { steem: number; price: number }) => o.steem > 0 && o.price > 0);
  }
  if (rawAcct?.[0]) {
    out.balances = { steem: parseFloat(rawAcct[0].balance), sbd: parseFloat(rawAcct[0].sbd_balance) };
  }
  return out;
}

function regimeVerdict(
  mid: number | null,
  parity: number | null,
  lowestAsk: number | null
): { verdict: GridPnl["regime"]["verdict"]; detail: string } {
  if (mid == null || parity == null || parity <= 0) {
    return { verdict: "UNKNOWN", detail: "השוק הפנימי או הפאריטה לא נמדדו — אין פסק-דין. לא ממציאים משטר." };
  }
  const gapBps = Math.round(((mid - parity) / parity) * 10_000);
  if (gapBps < -300) {
    const pct = (Math.abs(gapBps) / 100).toFixed(1);
    const askBps =
      lowestAsk != null && mid > 0
        ? ` המדרגה התחתונה שלנו (${lowestAsk.toFixed(6)}) רחוקה ${Math.round(((lowestAsk - mid) / mid) * 10_000)} bps מעל מרכז השוק — הסולם לא ייפגע עד שהשוק יסגור את הפער.`
        : "";
    return {
      verdict: "VALUE-TRAP",
      detail: `השוק הפנימי נסחר ${pct}% מתחת לפאריטה החיצונית (${gapBps} bps). במשטר זה מכירה בפאריטה היא מלכודת-ערך שממתינה, לא מכירה שנפגעת — ההמתנה היא המחיר, וההגנה היא חוק הרצפה (לעולם לא מתחת לפאריטה).${askBps}`,
    };
  }
  return {
    verdict: "CAPTURE",
    detail: `השוק הפנימי קרוב לפאריטה החיצונית (${gapBps >= 0 ? "+" : ""}${gapBps} bps) — במשטר זה הסולם בפאריטה ממלא, וכל מילוי מוכר מעל הקו החיצוני.`,
  };
}

// ── הרכבת ה-P&L ───────────────────────────────────────────────────────

export async function composeGridPnl(): Promise<GridPnl> {
  const down: string[] = [];
  const [scan, market] = await Promise.all([
    deepFills().catch((e) => {
      down.push(`scan: ${String((e as Error).message).slice(0, 60)}`);
      return null;
    }),
    marketSide(),
  ]);
  down.push(...market.down);

  const fills = scan?.fills ?? [];
  const { trips, openLongSteem } = roundTrips(fills);
  const bought = fills.filter((f) => f.side === "bought-steem");
  const sold = fills.filter((f) => f.side === "sold-steem");
  const sum = (arr: PnlFill[], k: "steem" | "sbd") => arr.reduce((s, f) => s + f[k], 0);
  const avg = (arr: PnlFill[]) => {
    const w = arr.reduce((s, f) => s + f.steem, 0);
    return w > 0 ? arr.reduce((s, f) => s + (f.price ?? 0) * f.steem, 0) / w : null;
  };
  const capturedSbd = trips.reduce((s, t) => s + t.capturedSbd, 0);
  const lastFillAt = fills.length ? fills[fills.length - 1].at : null;
  const quietDays =
    lastFillAt != null ? Math.floor((Date.now() - Date.parse(lastFillAt)) / 86_400_000) : null;

  const parity =
    market.marks.steemUsd != null && market.marks.sbdUsd != null && market.marks.sbdUsd > 0
      ? market.marks.steemUsd / market.marks.sbdUsd
      : null;
  const midVsParityBps =
    market.book.mid != null && parity != null && parity > 0
      ? Math.round(((market.book.mid - parity) / parity) * 10_000)
      : null;

  const prices = market.orders.map((o) => o.price);
  const lowestAsk = prices.length ? Math.min(...prices) : null;
  const highestAsk = prices.length ? Math.max(...prices) : null;
  const deployedSteem = market.orders.reduce((s, o) => s + o.steem, 0);
  const lowestAskVsMidBps =
    lowestAsk != null && market.book.mid ? Math.round(((lowestAsk - market.book.mid) / market.book.mid) * 10_000) : null;

  const regime = regimeVerdict(market.book.mid, parity, lowestAsk);

  // ההזדמנויות — מדידה, לא הבטחה; שערים מפורשים
  const opportunities: GridPnl["opportunities"] = [];
  if (market.book.spreadBps != null) {
    opportunities.push({
      id: "O1",
      title: "גריד דו-צדדי בתוך הפער הפנימי",
      state: "GATED",
      detail: `הפער הפנימי נמדד ${market.book.spreadBps} bps — גריד שיקנה בביד וימכור באסק לוכד את המרווח לכל סבב, אך צד הקנייה דורש מלאי SBD (יתרה נמדדת: ${(market.balances.sbd ?? 0).toFixed(3)}). שער-מפעיל מפורש (סף 0.15 SBD מהקנון) — הרשת מודדת, המפעיל מחליט.`,
    });
  }
  if (market.marks.sbdUsd != null && market.book.mid != null && market.marks.steemUsd != null) {
    // מסלול ההנחה: דולר SBD חיצוני מול מה שהוא קונה בפנים
    const sbdInternalUsd = market.marks.steemUsd / market.book.mid;
    const loopBps = Math.round(((sbdInternalUsd - market.marks.sbdUsd) / market.marks.sbdUsd) * 10_000);
    if (Number.isFinite(loopBps) && Math.abs(loopBps) > 100) {
      opportunities.push({
        id: "O2",
        title: `מסלול ההנחה החוצה (SBD חיצוני → פנים → STEEM)`,
        state: "GATED",
        detail: `נמדד: SBD נקנה חיצונית ב-${market.marks.sbdUsd.toFixed(4)}$ ושווה בפנים ${sbdInternalUsd.toFixed(4)}$ (${loopBps >= 0 ? "+" : ""}${loopBps} bps לכל הסבב, בכפוף לשערי בורסה חיצוניים). כל הרגליים החיצוניות הן שער-מפעיל — אין לנו גישת-מפתח לבורסות, בכנות מלאה.`,
      });
    }
  }

  return {
    at: new Date().toISOString(),
    account: ACCOUNT,
    ok: scan != null || market.book.mid != null,
    scan: {
      pagesThisRun: scan?.pages ?? 0,
      entriesScanned: scan?.entries ?? 0,
      downToIndex: scan?.downToIndex ?? null,
      maxIndex: scan?.maxIndex ?? null,
      fullScan: scan?.fullScan ?? false,
      checkpointAt: null,
    },
    fills: fills.slice(-30),
    stats: {
      fillsTotal: fills.length,
      bought: {
        count: bought.length,
        steem: Math.round(sum(bought, "steem") * 1e3) / 1e3,
        sbd: Math.round(sum(bought, "sbd") * 1e3) / 1e3,
        avgPrice: avg(bought) != null ? Math.round((avg(bought) as number) * 1e6) / 1e6 : null,
      },
      sold: {
        count: sold.length,
        steem: Math.round(sum(sold, "steem") * 1e3) / 1e3,
        sbd: Math.round(sum(sold, "sbd") * 1e3) / 1e3,
        avgPrice: avg(sold) != null ? Math.round((avg(sold) as number) * 1e6) / 1e6 : null,
      },
      netSteem: Math.round((sum(bought, "steem") - sum(sold, "steem")) * 1e3) / 1e3,
      netSbd: Math.round((sum(sold, "sbd") - sum(bought, "sbd")) * 1e3) / 1e3,
      roundTrips: trips.length,
      capturedSbd: Math.round(capturedSbd * 1e6) / 1e6,
      openLongSteem,
      firstFillAt: fills.length ? fills[0].at : null,
      lastFillAt,
      quietDays,
    },
    market: {
      bestBid: market.book.bestBid,
      bestAsk: market.book.bestAsk,
      internalMid: market.book.mid,
      spreadBps: market.book.spreadBps,
      parity: parity != null ? Math.round(parity * 1e6) / 1e6 : null,
      midVsParityBps,
      sbdUsd: market.marks.sbdUsd,
      steemUsd: market.marks.steemUsd,
      sbdSource: market.sbdSource,
    },
    ladder: {
      orders: market.orders.length,
      deployedSteem: Math.round(deployedSteem * 1e3) / 1e3,
      lowestAsk: lowestAsk != null ? Math.round(lowestAsk * 1e6) / 1e6 : null,
      highestAsk: highestAsk != null ? Math.round(highestAsk * 1e6) / 1e6 : null,
      lowestAskVsMidBps,
    },
    balances: {
      steem: market.balances.steem != null ? Math.round(market.balances.steem * 1e3) / 1e3 : null,
      sbd: market.balances.sbd != null ? Math.round(market.balances.sbd * 1e3) / 1e3 : null,
    },
    regime,
    opportunities,
    doctrine: [
      "ה-P&L נמדד מהשרשרת (fill_order) — לא מזיכרון ולא מהמצאה",
      "סבב נסגר רק כשקנייה נסגרה במכירה; מלאי פתוח הוא עמדה, לא רווח",
      "ערכי דולר מומרים בשערים של היום בלבד — שער היסטורי לא נמדד כאן",
      "אין הבטחת רווח, אף פעם — המנוע מודד, השוק מחליט",
    ],
    down,
  };
}
