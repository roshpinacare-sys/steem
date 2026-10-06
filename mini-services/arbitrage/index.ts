// ─────────────────────────────────────────────────────────────────────
// WEAVE-ARBITRAGE · גלאי-הארביטראז הרישתי (r192-d · פורט 3050)
//
// מנוע-מודיעין קריאה-בלבד (READ-ONLY): כל 60ש' מודד —
//   (a) ספר-השוק-הפנימי של Steem (condenser_api.get_order_book — ה-RPC
//       הקנוני של הריפו: api.steemit.com ← api.justyy.com)
//   (b) ספר-השוק-הפנימי של Hive (api.hive.blog — הקנון של הריפו)
//   (c) מחירי ה-Sovereign Exchange החי מ-GET /api/exchange על 127.0.0.1:3000
//   (d) ייחוס-CEX — אותם price-feeds של הריפו (R105: Binance←Gate←OKX)
//
// מחשב הזדמנויות נטו-אחרי-עמלות (bps) עם דלק≈0, רצפת-גודל $2 (L3),
// ועומק-בר-ביצוע בכל רגל (L1 — אין-נזילות-מדומה). אפס-ביצוע, אפס-שידורים,
// אפס-הצבת-פקודות — הביצוע נשאר אצל המנועים הקיימים תחת קפסות-L4.
//
// קונבנציית-הצי: shared.ts (writeJsonAtomic · installDeadManWatch —
// חיישן-אמת שרושם-ומוציא exit(1); אין-רישום-אצל fleet-guard מפקודת-המפעיל —
// ההקמה-מחדש אחרי-יציאה תיעשה ידנית או בהוראת-מפעיל).
// מצב: זיכרון + state.json אטומי לרציפות-הפעלה.
// ─────────────────────────────────────────────────────────────────────

import os from "node:os";
import { writeJsonAtomic, installDeadManWatch } from "../shared";
import { spotUsd } from "../../src/lib/dex/price-feeds";
import {
  type Book,
  type Opportunity,
  type PoolLeg,
  bookMid,
  oppBookBuyVsCex,
  oppBookSellVsCex,
  oppExchangePoolVsCex,
  oppExchangePoolVsSteemBook,
  oppHiveBookVsSteemBook,
  oppSteemBookVsExchangePool,
  oppSteemBookVsHiveBook,
  parityBps,
  sortBook,
} from "./lib";

const PORT = Number(process.env.PORT || 3050);
const HOME = os.homedir();
const STATE_FILE = "/home/z/my-project/mini-services/arbitrage/state.json";
const BOOTED_AT = new Date().toISOString();

// קנון-הריפו — אותם צמתים כמו src/lib/weave/graphene.ts
const STEEM_RPC_NODES = ["https://api.steemit.com", "https://api.justyy.com"];
const HIVE_RPC = process.env.HIVE_RPC || "https://api.hive.blog";
const EXCHANGE_API = "http://127.0.0.1:3000/api/exchange";
const BOOK_LIMIT = 100;

// ── טיפוסי-מצב ───────────────────────────────────────────────────────
interface ScanMarkets {
  steem: "ok" | "fail";
  hive: "ok" | "fail";
  blurt: "ok" | "empty" | "fail";
  cex: "ok" | "fail";
  exchange: "ok" | "fail" | "skipped";
  stableUsd: "ok" | "derived" | "fail";
}

interface ScanHistoryEntry {
  at: string;
  ok: boolean;
  oppCount: number;
  best?: { klass: string; netBps: number; sizeUsd: number };
  parity?: { steemDevBps: number | null; hiveDevBps: number | null };
  ms: number;
}

interface State {
  bootedAt: string;
  scans: number;
  lastScanAt: string | null;
  lastScanOk: boolean;
  lastError: string | null;
  markets: ScanMarkets | null;
  opportunities: Opportunity[];
  parity: Record<string, number | null>;
  history: ScanHistoryEntry[]; // טבעת — הזיכרון מחזיק 200; הקובץ 50
}

const G = globalThis as unknown as { __ARB_STATE__?: State };
const state: State =
  G.__ARB_STATE__ ??
  (G.__ARB_STATE__ = {
    bootedAt: BOOTED_AT,
    scans: 0,
    lastScanAt: null,
    lastScanOk: false,
    lastError: null,
    markets: null,
    opportunities: [],
    parity: {},
    history: [],
  });

const log = (msg: string): void => {
  // שורה-אחת בלבד: stdout (נתפס ל-/tmp/arbitrage-3050.log ע"י nohup) — אין-כפילות-שורות
  console.log(`${new Date().toISOString()} ${msg}`);
};

// ── מביאי-נתונים (הכול קריאה-בלבד) ───────────────────────────────────
interface RawLevel {
  real_price?: string;
  sbd?: number;
  steem?: number;
  hive?: number;
  hbd?: number;
}

async function rpcBook(node: string, method: string): Promise<{ bids: RawLevel[]; asks: RawLevel[] }> {
  const res = await fetch(node, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params: [BOOK_LIMIT], id: 1 }),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { result?: { bids?: RawLevel[]; asks?: RawLevel[] } };
  const b = j.result;
  if (!b || !Array.isArray(b.bids) || !Array.isArray(b.asks)) throw new Error("bad-book");
  return { bids: b.bids, asks: b.asks };
}

/** condenser get_order_book → ספר מנורמל. השדות sbd/steem (או hbd/hive) במילי-יחידות. */
function normalizeLevels(raw: { bids: RawLevel[]; asks: RawLevel[] }, quoteField: "sbd" | "hbd", baseField: "steem" | "hive"): Book {
  const levelsOf = (ls: RawLevel[]): Book["bids"] =>
    ls
      .map((l) => {
        const price = Number(l.real_price ?? 0);
        const base = Number((baseField === "steem" ? l.steem : l.hive) ?? 0) / 1000;
        const quote = Number((quoteField === "sbd" ? l.sbd : l.hbd) ?? 0) / 1000;
        return { price, qty: base, quote };
      })
      .filter((x) => x.price > 0 && x.qty > 0 && x.quote > 0);
  // החלוקה הקנונית: bids = רשימת-ה-bids מה-RPC (קוני-הנכס), asks = רשימת-ה-asks (מוכרי-הנכס)
  return sortBook({ bids: levelsOf(raw.bids), asks: levelsOf(raw.asks) });
}

async function fetchSteemBook(): Promise<Book> {
  let lastErr: unknown = null;
  for (const node of STEEM_RPC_NODES) {
    try {
      return normalizeLevels(await rpcBook(node, "condenser_api.get_order_book"), "sbd", "steem");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("steem-book-failed");
}

async function fetchHiveBook(): Promise<Book> {
  return normalizeLevels(await rpcBook(HIVE_RPC, "condenser_api.get_order_book"), "hbd", "hive");
}

// r193 — מחיר-BLURT/USD מ-CoinGecko (אין-CEX-ואין-ספר-פנימי — נמדד-חי)
let blurtUsdCache: { at: number; v: number | null } | null = null;
async function fetchBlurtUsd(): Promise<number | null> {
  if (blurtUsdCache && Date.now() - blurtUsdCache.at < 60_000) return blurtUsdCache.v;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=blurt&vs_currencies=usd", {
      signal: AbortSignal.timeout(5_000),
      headers: { "user-agent": "saos-sovereign/1.0" },
    });
    if (!res.ok) { blurtUsdCache = { at: Date.now(), v: null }; return null; }
    const j = (await res.json()) as { blurt?: { usd?: number } };
    const v = typeof j?.blurt?.usd === "number" ? j.blurt.usd : null;
    blurtUsdCache = { at: Date.now(), v };
    return v;
  } catch { blurtUsdCache = { at: Date.now(), v: null }; return null; }
}

interface CexFeed {
  steem: number | null;
  hive: number | null;
  source: string | null;
}

async function fetchCex(): Promise<CexFeed> {
  const [s, h] = await Promise.all([spotUsd("STEEMUSDT"), spotUsd("HIVEUSDT")]);
  return { steem: s.price, hive: h.price, source: s.source ?? h.source };
}

/** SBD/HBD/USD — קנון pricesUsdRaw: CoinGecko תחילה; נפילה-ריבונית CEX÷פאריטה. */
async function fetchStableUsd(
  steemCex: number | null,
  hiveCex: number | null,
  steemBook: Book | null,
  hiveBook: Book | null,
): Promise<{ sbd: number | null; hbd: number | null; mode: "ok" | "derived" | "fail" }> {
  let sbd: number | null = null;
  let hbd: number | null = null;
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=steem-dollars,hive-backed-dollar&vs_currencies=usd", {
      headers: { "User-Agent": "saos-weave-rail/1.0" }, // חוק-הענן R103 — בלי UA חוסם
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as Record<string, { usd?: number }>;
    if (j["steem-dollars"]?.usd) sbd = j["steem-dollars"].usd;
    if (j["hive-backed-dollar"]?.usd) hbd = j["hive-backed-dollar"].usd;
  } catch {
    /* כנות — נפילה לנתיב-הריבוני */
  }
  let derived = false;
  if (sbd == null && steemCex != null && steemBook) {
    const mid = bookMid(steemBook);
    if (mid && mid > 0) {
      sbd = steemCex / mid;
      derived = true;
    }
  }
  if (hbd == null && hiveCex != null && hiveBook) {
    const mid = bookMid(hiveBook);
    if (mid && mid > 0) {
      hbd = hiveCex / mid;
      derived = true;
    }
  }
  const mode: "ok" | "derived" | "fail" = sbd != null || hbd != null ? (derived ? "derived" : "ok") : "fail";
  return { sbd, hbd, mode };
}

interface ExchangeSnapshot {
  ok: boolean;
  pools?: Array<{ pair: string; assetA: string; assetB: string; reserveA: number; reserveB: number; feeBps: number; depthUsd: number | null }>;
}

async function fetchExchange(): Promise<ExchangeSnapshot | null> {
  try {
    const res = await fetch(EXCHANGE_API, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return (await res.json()) as ExchangeSnapshot;
  } catch {
    return null;
  }
}

function poolFromSnapshot(snap: ExchangeSnapshot | null, pair: string): PoolLeg | null {
  const p = snap?.pools?.find((x) => x.pair === pair);
  if (!p || !(p.reserveA > 0) || !(p.reserveB > 0)) return null;
  return { pair: p.pair, assetA: p.assetA, assetB: p.assetB, reserveA: p.reserveA, reserveB: p.reserveB, feeBps: p.feeBps };
}

// ── הפעימה ───────────────────────────────────────────────────────────
async function scan(): Promise<void> {
  const t0 = Date.now();
  const at = new Date().toISOString();
  const opps: Opportunity[] = [];
  const markets: ScanMarkets = { steem: "fail", hive: "fail", blurt: "fail", cex: "fail", exchange: "skipped", stableUsd: "fail" };
  let steemDevBps: number | null = null;
  let hiveDevBps: number | null = null;
  try {
    const [steemBook, hiveBook, cex, exchangeSnap] = await Promise.all([
      fetchSteemBook().then(
        (b) => {
          markets.steem = "ok";
          return b;
        },
        () => null,
      ),
      fetchHiveBook().then(
        (b) => {
          markets.hive = "ok";
          return b;
        },
        () => null,
      ),
      fetchCex().then(
        (c) => {
          if (c.steem != null || c.hive != null) markets.cex = "ok";
          return c;
        },
        () => ({ steem: null, hive: null, source: null }) as CexFeed,
      ),
      fetchExchange().then(
        (e) => {
          if (e?.ok) markets.exchange = "ok";
          else markets.exchange = "fail";
          return e;
        },
        () => null,
      ),
    ]);
    const stable = await fetchStableUsd(cex.steem, cex.hive, steemBook, hiveBook);
    markets.stableUsd = stable.mode;
    if (stable.sbd == null && stable.hbd == null) throw new Error("no-stable-usd");
    const sbdUsd = stable.sbd ?? 1; // כנות: היסטורית SBD≈$1 — רק כבריר-מחדל-גיבוי לסייזינג
    const hbdUsd = stable.hbd ?? 1;

    // מדידות-פאריטה לאבחון (הספר מול CEX — bps)
    if (steemBook && cex.steem) {
      const mid = bookMid(steemBook);
      if (mid) steemDevBps = parityBps(mid, cex.steem / sbdUsd); // מחיר-STEEM ב-USD-אימפליציט מול CEX
    }
    if (hiveBook && cex.hive) {
      const mid = bookMid(hiveBook);
      if (mid) hiveDevBps = parityBps(mid, cex.hive / hbdUsd);
    }
    state.parity = { steemDevBps, hiveDevBps };

    // הזדמנויות — רק-קריאה; כל-רגל-בכנות
    if (steemBook && cex.steem && stable.sbd) {
      const o1 = oppBookBuyVsCex(steemBook, cex.steem, stable.sbd, 75, "steem-internal", "cex", at);
      if (o1) opps.push(o1);
      const o2 = oppBookSellVsCex(steemBook, cex.steem, stable.sbd, 75, "steem-internal", "cex", at);
      if (o2) opps.push(o2);
    }
    if (hiveBook && cex.hive && stable.hbd) {
      const o1 = oppBookBuyVsCex(hiveBook, cex.hive, stable.hbd, 75, "hive-internal", "cex", at);
      if (o1) opps.push(o1);
      const o2 = oppBookSellVsCex(hiveBook, cex.hive, stable.hbd, 75, "hive-internal", "cex", at);
      if (o2) opps.push(o2);
    }
    if (steemBook && hiveBook && cex.steem && cex.hive && stable.sbd && stable.hbd) {
      const o1 = oppSteemBookVsHiveBook(steemBook, hiveBook, cex.steem, cex.hive, stable.sbd, stable.hbd, at);
      if (o1) opps.push(o1);
      const o2 = oppHiveBookVsSteemBook(steemBook, hiveBook, cex.steem, cex.hive, stable.sbd, stable.hbd, at);
      if (o2) opps.push(o2);
    }
    const wsteemPool = poolFromSnapshot(exchangeSnap, "WSTEEM/WSBD");
    if (steemBook && wsteemPool && stable.sbd) {
      const o1 = oppSteemBookVsExchangePool(steemBook, wsteemPool, stable.sbd, at);
      if (o1) opps.push(o1);
      const o2 = oppExchangePoolVsSteemBook(steemBook, wsteemPool, stable.sbd, at);
      if (o2) opps.push(o2);
    }
    if (wsteemPool && cex.steem && stable.sbd) {
      const o = oppExchangePoolVsCex(wsteemPool, cex.steem, stable.sbd, at);
      if (o) opps.push(o);
    }
    // r193 — רגל-Blurt: אין-ספר-פנימי (rpc.blurt.blog — get_order_book חסר, נמדד-חי);
    // המחיר היחיד הוא CoinGecko → הזדמנות בריכת-WBLURT/USDS מול ייחוס-USD (peg=1).
    const wblurtPool = poolFromSnapshot(exchangeSnap, "WBLURT/USDS");
    const blurtUsd = await fetchBlurtUsd();
    markets.blurt = blurtUsd != null ? "ok" : "fail";
    if (wblurtPool && blurtUsd != null) {
      const o = oppExchangePoolVsCex(wblurtPool, blurtUsd, 1, at);
      if (o) opps.push(o);
    } else if (wblurtPool && blurtUsd == null) {
      markets.blurt = "fail";
    } else if (blurtUsd != null) {
      markets.blurt = "empty"; // בריכת-אבק — כנה
    }

    opps.sort((a, b) => b.netBps - a.netBps);
    state.opportunities = opps;
    state.scans += 1;
    state.lastScanAt = at;
    state.lastScanOk = true;
    state.lastError = null;
    state.markets = markets;
    const best = opps[0]
      ? { klass: opps[0].klass, netBps: opps[0].netBps, sizeUsd: opps[0].sizeUsd }
      : undefined;
    state.history.unshift({ at, ok: true, oppCount: opps.length, best, parity: { steemDevBps, hiveDevBps }, ms: Date.now() - t0 });
    if (state.history.length > 200) state.history.length = 200;
    log(`scan #${state.scans} ok ${Date.now() - t0}ms · opps=${opps.length} · steem-parity=${steemDevBps}bps · hive-parity=${hiveDevBps}bps`);
  } catch (e) {
    state.lastScanAt = at;
    state.lastScanOk = false;
    state.lastError = e instanceof Error ? e.message : String(e);
    state.history.unshift({ at, ok: false, oppCount: 0, ms: Date.now() - t0 });
    if (state.history.length > 200) state.history.length = 200;
    log(`scan FAILED: ${state.lastError}`);
  }
  persist();
}

function persist(): void {
  try {
    const fileState = { ...state, history: state.history.slice(0, 50), opportunities: state.opportunities.slice(0, 20) };
    writeJsonAtomic(STATE_FILE, fileState);
  } catch (e) {
    log(`persist FAILED: ${e instanceof Error ? e.message : e}`);
  }
}

// ── שרת — /status · /opps · /history ─────────────────────────────────
const B = globalThis as unknown as {
  Bun?: {
    serve: (opts: { port: number; hostname: string; fetch: (req: Request) => Response | Promise<Response> }) => unknown;
  };
};

function handle(req: Request): Response {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/status") {
    return Response.json({
      ok: true,
      service: "arbitrage",
      port: PORT,
      mode: "READ-ONLY — detection only; no execution, no broadcasts (r192-d)",
      bootedAt: state.bootedAt,
      now: new Date().toISOString(),
      scans: state.scans,
      lastScanAt: state.lastScanAt,
      lastScanOk: state.lastScanOk,
      lastError: state.lastError,
      markets: state.markets,
      parity: state.parity,
      oppCount: state.opportunities.length,
    });
  }
  if (p === "/opps") {
    return Response.json({ ok: true, count: state.opportunities.length, opportunities: state.opportunities, at: state.lastScanAt });
  }
  if (p === "/history") {
    const n = Math.min(Number(url.searchParams.get("n") ?? "50") || 50, 200);
    return Response.json({ ok: true, count: state.history.length, history: state.history.slice(0, n) });
  }
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
}

B.Bun?.serve({ port: PORT, hostname: "127.0.0.1", fetch: handle });
log(`arbitrage detector UP on 127.0.0.1:${PORT} — READ-ONLY (r192-d) · state=${STATE_FILE}`);

// ── פעימה-60ש' + מתג-איש-מת (חיישן-אמת בלבד — אין-רישום-אצל fleet-guard) ──
const G_T = globalThis as unknown as { __ARB_TIMER__?: ReturnType<typeof setInterval> };
if (G_T.__ARB_TIMER__) clearInterval(G_T.__ARB_TIMER__);
G_T.__ARB_TIMER__ = setInterval(() => {
  void scan().catch((e) => log(`scan threw: ${e instanceof Error ? e.message : e}`));
}, 60_000);
void scan().catch((e) => log(`boot-scan threw: ${e instanceof Error ? e.message : e}`));

installDeadManWatch({
  id: "arbitrage",
  lastMs: () => (state.lastScanAt ? Date.parse(state.lastScanAt) : Date.parse(state.bootedAt)),
  stallMs: 600_000, // max(3×60ש', 10דק') — חוק r143-c
  logFile: `${HOME}/sovereign/keeper/logs/arbitrage-daemon.log`,
});
