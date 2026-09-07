import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";

export const dynamic = "force-dynamic";

/**
 * 117c — THE-SWAP-ONNET · הבורסה שלנו על הרשת שלנו.
 *
 * המנדט (המפעיל): ״שנוכל להחזיק מטבע אמיתי אחר על הרשת שלנו וגם להחליף אותו על
 * הרשת שלנו, גם אם זה לא STEEM · ומה בדיוק מגביל אותנו ריבונית — תגלה ותיישם״.
 *
 * כאן התשובה: WTRX (גיבוי-חי מול TRX-אמת-נמדד על דלתות-הגשר) נסחר בבריכת-AMM
 * אפס-עמלה מול WSTEEM — אפס-מינימום, אפס-אנרגיה, אפס-ספק-חוץ. הראיות:
 * theswap-attest.json (עדות-דלתות-כפולה) · theswap-state.json (זריעות+סוואפים)
 * · state-snapshot.json (הספר-עצמו — poolsX).
 *
 * אפס-סודות: כתובות-פומביות ומספרים בלבד. ה-POST מריץ את theswap.cjs (אותו-שער
 * מוגן: cap 30%-מעתודה · יתרות-נאכפות-בקרנל · inject דרך saosnet --inject).
 */
const ROOT = process.cwd();
const NODE = path.join(ROOT, "sovereign", "node");
const SNAPSHOT = path.join(NODE, "state-snapshot.json");
const ATTEST = path.join(NODE, "theswap-attest.json");
const STATE = path.join(NODE, "theswap-state.json");

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch (_) {
    return null;
  }
}

interface BookShape {
  st?: BookInner;
}
interface BookInner {
  poolsX?: Record<string, { a: number; b: number; lpSupply: number; feeBps: number; symA: string; symB: string }>;
  wrapped?: Record<string, { supply: number; refs: Record<string, unknown> }>;
  accounts?: Record<string, { saos: number; steem: number; wrapped: Record<string, number> }>;
  assetMeta?: Record<string, { bookScale?: number; decimals?: number; chain?: string }>;
  meta?: { height?: number; swapsX?: number };
}
interface AttestShape {
  at: string;
  protocol: string;
  prices: Record<string, number>;
  doors: { family: string; address: string; role?: string; agent?: string; trx: number | null; honest: string }[];
  legacyTrx: number;
  v2Trx: number;
  totalTrx: number;
  totalUsd: number | null;
  book: { WTRX_supply_units: number; WTRX_supply_trx: number };
  backing: { ratio: number | null; note: string };
}
interface SwapStateShape {
  startedAt?: string;
  lastAttest?: string;
  attests?: { at: string; totalTrx: number; totalUsd: number | null; backing: number | null; honest: string }[];
  seeded?: { at: string; pair: string; aU: number; bU: number; feeBps: number; prices: Record<string, number> }[];
  swaps?: {
    at: string; taker: string; pair: string; side: string;
    inUnits: number; inSym: string; inHuman: number;
    outUnits: number; outSym: string; outHuman: number;
    feeBps: number; quoteImpactPct: number | null;
  }[];
}

const scaleOf = (meta: BookInner["assetMeta"], sym: string): number => {
  const m = meta?.[sym];
  return m && Number.isInteger(m.bookScale) && m.bookScale >= 1 ? m.bookScale : 1000;
};

/* ציטוט-AMM — אותו-חוזה בדיוק כמו theswap.cjs quote() (מראה-עד: הקרנל הוא המבצע) */
function ammQuote(
  p: { a: number; b: number; feeBps: number; symA: string; symB: string },
  side: string,
  inUnits: number
) {
  const s = side === "A2B" ? "A2B" : side === "B2A" ? "B2A" : null;
  if (!s || !(inUnits > 0)) return { ok: false as const, err: "bad-input" };
  const inRes = s === "A2B" ? p.a : p.b;
  const outRes = s === "A2B" ? p.b : p.a;
  if (!(inRes > 0) || !(outRes > 0)) return { ok: false as const, err: "empty-pool" };
  const fee = Math.floor((inUnits * p.feeBps) / 10000);
  const net = inUnits - fee;
  const out = Math.floor((net * outRes) / (inRes + net));
  const px0 = outRes / inRes;
  const px1 = outRes > out ? (outRes - out) / (inRes + net) : null;
  const cap = Math.floor(inRes * 0.3);
  return {
    ok: true as const,
    side: s,
    feeBps: p.feeBps,
    inUnits,
    outUnits: out,
    priceBefore: +px0.toFixed(6),
    priceAfter: px1 !== null ? +px1.toFixed(6) : null,
    impactPct: px1 !== null ? +((1 - px1 / px0) * 100).toFixed(3) : null,
    cap,
    capOk: inUnits <= cap,
  };
}

function runCjs(args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    execFile("node", [path.join(NODE, "theswap.cjs"), ...args], { cwd: NODE, timeout: timeoutMs, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === "number" ? err.code : err ? 1 : 0, out: (stdout || "") + "\n" + (stderr || "") });
    });
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qPair = url.searchParams.get("pair");
  const qSide = url.searchParams.get("side");
  const qIn = url.searchParams.get("in");

  const book = readJson<BookShape>(SNAPSHOT);
  const st: BookInner = book?.st ?? (book as unknown as BookInner) ?? {};
  const attest = readJson<AttestShape>(ATTEST);
  const swapState = readJson<SwapStateShape>(STATE) ?? {};

  const scale = (sym: string) => scaleOf(st.assetMeta, sym);
  const priceOf = (sym: string): number | null => {
    if (!attest?.prices) return null;
    if (sym === "WTRX") return attest.prices.TRXUSDT ?? null;
    if (sym === "WSTEEM") return attest.prices.STEEMUSDT ?? null;
    if (sym === "WETH") return attest.prices.ETHUSDT ?? null;
    if (sym === "WSOL") return attest.prices.SOLUSDT ?? null;
    return null;
  };

  /* בריכות-חיות בלבד (שני-הצדדים > 0) ממוינות-לפי-עומק-דולרי */
  const pools = Object.entries(st.poolsX ?? {})
    .filter(([, p]) => p.a > 0 && p.b > 0)
    .map(([pair, p]) => {
      const aU = p.a / scale(p.symA);
      const bU = p.b / scale(p.symB);
      const pa = priceOf(p.symA);
      const pb = priceOf(p.symB);
      const depthUsd = pa !== null && pb !== null ? +(aU * pa + bU * pb).toFixed(4) : null;
      return {
        pair,
        symA: p.symA, symB: p.symB,
        reserveA: +aU.toFixed(6), reserveB: +bU.toFixed(6),
        feeBps: p.feeBps,
        priceBperA: p.a > 0 ? +(p.b / p.a).toFixed(6) : null,
        depthUsd,
      };
    })
    .sort((x, y) => (y.depthUsd ?? 0) - (x.depthUsd ?? 0));

  /* ציטוט-לפי-ביקוש (query params) */
  let quote: ReturnType<typeof ammQuote> | { ok: false; err: string } | null = null;
  if (qPair && qSide && qIn !== null) {
    const p = (st.poolsX ?? {})[qPair];
    const inUnits = Math.floor(Number(qIn)); // יחידות-ספר (ה-UI ממיר מיחידות-אנוש)
    quote = p ? ammQuote(p, qSide, inUnits) : { ok: false, err: "no-pair" };
  }

  const wtrx = st.wrapped?.WTRX;
  const hc = st.accounts?.headcorner;

  /* סקאלות-הסמלים-החיים (ה-UI ממיר יחידות-אנוש ⇄ יחידות-ספר) */
  const scaleSyms = new Set<string>();
  for (const p of Object.values(st.poolsX ?? {})) { scaleSyms.add(p.symA); scaleSyms.add(p.symB); }
  const scales: Record<string, number> = {};
  for (const s of scaleSyms) scales[s] = scaleOf(st.assetMeta, s);

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    height: st.meta?.height ?? null,
    swapsTotal: st.meta?.swapsX ?? null,
    pools,
    scales,
    quote,
    attest: attest
      ? {
          at: attest.at,
          protocol: attest.protocol,
          prices: attest.prices,
          legacyTrx: attest.legacyTrx,
          v2Trx: attest.v2Trx,
          totalTrx: attest.totalTrx,
          totalUsd: attest.totalUsd,
          doors: attest.doors.map((d) => ({ family: d.family, address: d.address, role: d.role ?? null, agent: d.agent ?? null, trx: d.trx, honest: d.honest })),
          backing: attest.backing,
          bookSupplyTrx: attest.book.WTRX_supply_trx,
        }
      : null,
    house: hc ? { WTRX: hc.wrapped?.WTRX ?? 0, WSTEEM: hc.wrapped?.WSTEEM ?? 0, saos: hc.saos ?? 0, steem: hc.steem ?? 0 } : null,
    wtrxBook: wtrx ? { supply: wtrx.supply, refs: Object.keys(wtrx.refs ?? {}).length } : null,
    seeded: swapState.seeded ?? [],
    swaps: (swapState.swaps ?? []).slice(0, 12),
    lastAttest: swapState.lastAttest ?? null,
  });
}

export async function POST(req: NextRequest) {
  let body: { action?: string; pair?: string; side?: string; in?: string | number; taker?: string } = {};
  try {
    body = await req.json();
  } catch (_) {}
  const action = body.action ?? "";

  if (action === "attest") {
    const r = await runCjs(["attest"], 300000);
    return NextResponse.json({ ok: r.code === 0, out: r.out.slice(0, 400), action });
  }

  if (action === "quote") {
    const pair = String(body.pair ?? "");
    const side = String(body.side ?? "");
    const inUnits = Math.floor(Number(body.in ?? 0));
    const book = readJson<BookShape>(SNAPSHOT);
    const st: BookInner = book?.st ?? (book as unknown as BookInner) ?? {};
    const p = (st.poolsX ?? {})[pair];
    return NextResponse.json({ ok: true, action, quote: p ? ammQuote(p, side, inUnits) : { ok: false, err: "no-pair" } });
  }

  if (action === "swap") {
    const pair = String(body.pair ?? "");
    const side = String(body.side ?? "");
    const inUnits = Math.floor(Number(body.in ?? 0));
    const taker = String(body.taker ?? "headcorner");
    if (!pair || !side || !(inUnits > 0)) return NextResponse.json({ ok: false, err: "bad-input", action }, { status: 400 });
    const r = await runCjs(["swap", "--pair", pair, "--side", side, "--in", String(inUnits), "--taker", taker], 180000);
    const done = /inject\[/i.test(r.out) && /OK/i.test(r.out.split("\n").find((l) => l.includes("inject[")) ?? "");
    return NextResponse.json({ ok: r.code === 0 && done, out: r.out.slice(0, 500), action });
  }

  return NextResponse.json({ ok: false, err: "unknown-action (attest|quote|swap)", action }, { status: 400 });
}
