// ─────────────────────────────────────────────────────────────────────
// /api/exchange/agent — שער-הסוופ לסוכני-AI (r192-c)
//
// ERC-8004 identity-gated + x402-style paid swap על הזירה הריבונית.
// זהו היתרון-הייחודי מול התחרות: נזילות מגודרת-זהות לסוכנים עם
// תמחור-מוצהר (402 + accepts) וקפסות-קוד — לא "API חינם עם הבטחות".
//
// GET  (ציבורי — פרסום, לא ביצוע):
//   ?action=...                       — אין פרמטרים: תיאור-שירות מלא
//   ?action=agents                    — 13 זהויות ERC-8004 (מטא-דאטה ציבורי)
//   ?action=challenge&agentId=...     — nonce חתימה (סוכן רשום בלבד)
//   ?action=usage&agentId=...         — צבירת-היום של הסוכן (מהספר)
//   ?pair=SAOS/USDS&side=A2B&amountIn=100
//   | ?sell=SAOS&buy=USDS&amountIn=100 — ציטוט + לוח-עמלות x402 מוצהר
//     פנימי = בריכות-הזירה (בר-ביצוע אמיתי) · חוץ = quote-only (L4)
//
// POST (מגודר — זהות + תשלום):
//   headers: X-Agent-Id · X-Agent-Signature (personal_sign) · X-PAYMENT
//   body: { intent: { pair|sell/buy, side, amountIn, minOut, feeAsset,
//          feeAmount, nonce, issuedAt }, dryRun?: boolean }
//
// סדר-השערים (מתועד, נבדק):
//   503 kill-switch (L4, בכל בקשה) → 402 אין-תשלום (x402) → 402 תשלום
//   פגום → 401 אין-זהות / 403 זהות-לא-מוכרת → 400 זוג/כוונה →
//   400 מינימום-$2 (L3) → 429 קפסות (L4; שער-מקדים קריאה-בלבד) →
//   401 חתימה → 402 תקרת-עמלה → dryRun מוצהר (L5) | ביצוע בספר.
//
// כנות: אין ביצוע-חוץ (L4 — קפסות-ראוטר עדיין לא ממומנות-הכנסה);
// עמלת-x402 נגבית בספר (USDS/SAOS) לאוצר ונכתבת FEE + AGENT_SWAP.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ensureExchange,
  quoteSwap,
  swap,
  agentSwapSettle,
  pricesUsd,
  EXCHANGE_ASSETS,
  type ExchangeAsset,
} from "@/lib/weave/sovereign-exchange";
import {
  X402_VERSION,
  X402_FEE_BPS,
  X402_FEE_MIN_USDS,
  MIN_NOTIONAL_USD,
  AGENT_PER_TX_CAP_USD,
  AGENT_DAILY_CAP_USD,
  IDENTITY_REQUIRED_HEADERS,
  readKillSwitch,
  loadRegistry,
  lookupAgent,
  agentBookMember,
  agentFeeUsd,
  capDecision,
  verifyAgentSignature,
  issueNonce,
  parsePaymentHeader,
  type SwapIntent,
} from "@/lib/weave/agent-exchange";
import type { CompetitionGroup } from "@/lib/weave/exchange-router";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── מצבי-עזר ─────────────────────────────────────────────────────────

function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function killResponse() {
  const k = readKillSwitch();
  return j(
    {
      ok: false,
      error: "DEX-KILL",
      killed: true,
      reason: k.reason,
      at: k.at,
      note: "kill-switch ~/.sovereign/dex-kill קיים — השער עוצר כל תנועה עד הסרה (L4)",
    },
    503,
  );
}

/** מחיר-ביניים של SAOS מול USDS — מהספר (בריכת SAOS/USDS), לא מהמצאה */
async function saosMidUsd(): Promise<number | null> {
  const pool = await db.exchangePool.findUnique({ where: { pair: "SAOS/USDS" } });
  if (!pool) return null;
  const mid = pool.assetA === "SAOS" ? pool.reserveB / pool.reserveA : pool.reserveA / pool.reserveB;
  return Number.isFinite(mid) && mid > 0 ? mid : null;
}

/** נוטינאל-קלט ב-$ — המדידה שממנה עמלת-x402 וקפסות. null = אין שער
 *  חי (מסרבים בכנות — לא מבצעים עסקה שלא ניתן למדוד, L4). */
async function notionalUsdOf(asset: ExchangeAsset, amount: number): Promise<number | null> {
  if (asset === "USDS") return amount; // peg-רזרבה-מלאה $1
  if (asset === "SAOS") {
    const mid = await saosMidUsd();
    return mid == null ? null : amount * mid;
  }
  const key = asset === "WSTEEM" ? "steem"
    : asset === "WSBD" ? "sbd"
    : asset === "WHIVE" ? "hive"
    : asset === "WHBD" ? "hbd"
    : asset === "WBLURT" ? "blurt"
    : asset === "WSOL" ? "sol"
    : asset === "WETH" ? "eth"
    : null;
  if (!key) return null;
  const prices = await pricesUsd();
  const p = prices[key] ?? null;
  return p == null ? null : amount * p;
}

/** עמלה בנכס-העמלה: USDS = עמלת-$ ישירה; SAOS = המרה במחיר-ביניים מהספר */
async function feeInAsset(feeAsset: "USDS" | "SAOS", notionalUsd: number): Promise<{ amount: number; usd: number } | null> {
  const feeUsd = agentFeeUsd(notionalUsd);
  if (feeAsset === "USDS") return { amount: feeUsd, usd: feeUsd };
  const mid = await saosMidUsd();
  if (mid == null || mid <= 0) return null;
  return { amount: Math.round((feeUsd / mid) * 1e6) / 1e6, usd: feeUsd };
}

async function agentUsageTodayUsd(agentId: string): Promise<{ usedTodayUsd: number; events: number; since: string }> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const member = agentBookMember(agentId);
  const agg = await db.exchangeEvent.aggregate({
    _sum: { usdValue: true },
    where: { kind: "AGENT_SWAP", member, createdAt: { gte: since } },
  });
  const events = await db.exchangeEvent.count({ where: { kind: "AGENT_SWAP", member, createdAt: { gte: since } } });
  return {
    usedTodayUsd: Math.round((agg._sum.usdValue ?? 0) * 1e6) / 1e6,
    events,
    since: since.toISOString(),
  };
}

// ── זיווג-זוגות: פנימי (בריכה) / חוץ (quote-only) / אין ──────────────

async function resolveInternalPair(sell: string, buy: string): Promise<{ pair: string; side: "A2B" | "B2A"; assetIn: ExchangeAsset; assetOut: ExchangeAsset } | null> {
  const S = sell.toUpperCase();
  const B = buy.toUpperCase();
  if (!(EXCHANGE_ASSETS as readonly string[]).includes(S) || !(EXCHANGE_ASSETS as readonly string[]).includes(B)) return null;
  const pools = await db.exchangePool.findMany();
  const direct = pools.find((p) => p.assetA === S && p.assetB === B);
  if (direct) return { pair: direct.pair, side: "A2B", assetIn: S as ExchangeAsset, assetOut: B as ExchangeAsset };
  const reverse = pools.find((p) => p.assetA === B && p.assetB === S);
  if (reverse) return { pair: reverse.pair, side: "B2A", assetIn: S as ExchangeAsset, assetOut: B as ExchangeAsset };
  return null;
}

function normExternal(a: string): string | null {
  const u = a.trim().toUpperCase();
  if (u === "WETH" || u === "ETH") return "ETH";
  if (u === "WSOL" || u === "SOL") return "SOL";
  if (u === "WBNB" || u === "BNB") return "BNB";
  if (u === "USDS" || u === "USDT" || u === "USDC" || u === "USD") return "USD";
  return null;
}

// ציטוט-חוץ — סנפט 90 שניות (ראוטר מודד RPC חי; קריאה-בלבד תמיד)
let routerCache: { at: number; groups: CompetitionGroup[]; err: string | null } | null = null;
const ROUTER_TTL_MS = 90_000;

async function externalQuoteOnly(sell: string, buy: string): Promise<{
  mode: "quote-only";
  requested: string;
  external: { pair: string; direction: "direct" | "inverted"; best: { dex: string; chain: string; price: number } | null; prices: Array<{ dex: string; chain: string; price: number | null }>; spreadBps: number | null; note: string };
  execution: { allowed: false; reason: string };
} | null> {
  const nS = normExternal(sell);
  const nB = normExternal(buy);
  if (!nS || !nB || nS === nB) return null;
  const wantDirect = `${nS}/${nB}`;
  const wantInverted = `${nB}/${nS}`;
  const stableToStable = nS === "USD" && nB === "USD";
  const target = stableToStable ? "USDT/USDC" : wantDirect;
  const targetInverted = stableToStable ? null : wantInverted;
  if (!routerCache || Date.now() - routerCache.at > ROUTER_TTL_MS) {
    try {
      const { composeExchangeRouter } = await import("@/lib/weave/exchange-router");
      const snap = await composeExchangeRouter();
      routerCache = { at: Date.now(), groups: snap.competition ?? [], err: null };
    } catch (e) {
      routerCache = { at: Date.now(), groups: [], err: String((e as Error).message ?? e).slice(0, 120) };
    }
  }
  if (routerCache.groups.length === 0) return null;
  const g = routerCache.groups.find((x) => x.pair === target) ?? (targetInverted ? routerCache.groups.find((x) => x.pair === targetInverted) : undefined);
  if (!g) return null;
  const inverted = g.pair === targetInverted && !stableToStable;
  const conv = (p: number | null) => (p == null ? null : inverted ? (p > 0 ? 1 / p : null) : p);
  const prices = g.prices.map((p) => ({ dex: p.dex, chain: p.chain, price: conv(p.price) }));
  const priced = prices.filter((p): p is { dex: string; chain: string; price: number } => p.price != null && p.price > 0);
  const best = priced.length ? priced.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  return {
    mode: "quote-only",
    requested: `${sell.toUpperCase()}/${buy.toUpperCase()}`,
    external: {
      pair: `${g.pair}${inverted ? " (הפוך)" : ""}`,
      direction: inverted ? "inverted" : "direct",
      best,
      prices,
      spreadBps: g.spreadBps,
      note: "ציטוט-חוץ מ-exchange-router (Uniswap/PancakeSwap/SushiSwap/Jupiter/Across) — מדידה חיה, אפס ביצוע",
    },
    execution: {
      allowed: false,
      reason: "L4: ביצוע-חוץ סגור עד שקפסות-הראוטר ממומנות-הכנסה — quote-only בכנות; אין גביית עמלה על ציטוט",
    },
  };
}

// ── פרסת-בקשת-POST ───────────────────────────────────────────────────

interface PostBody {
  intent?: Partial<SwapIntent> & { sell?: string; buy?: string };
  dryRun?: boolean;
}

function resolvePairInputs(intent: Partial<SwapIntent> & { sell?: string; buy?: string }): { sell: string; buy: string } | null {
  if (typeof intent.pair === "string" && intent.pair.includes("/")) {
    const [a, b] = intent.pair.split("/").map((s) => s.trim());
    if (a && b) return { sell: a, buy: b };
  }
  if (typeof intent.sell === "string" && typeof intent.buy === "string") {
    return { sell: intent.sell.trim(), buy: intent.buy.trim() };
  }
  return null;
}

/** לוח-העמלות x402 — הצורה הסטנדרטית (accepts) + הרחבות-כנות */
function x402Accepts(args: { feeAmount: number; feeAsset: string; notionalUsd: number | null; member: string; book: "x-weave:book" }) {
  return [
    {
      scheme: "exact",
      network: args.book,
      asset: args.feeAsset,
      payTo: "treasury",
      maxAmountRequired: String(args.feeAmount),
      maxAmountRequiredNum: args.feeAmount,
      resource: "/api/exchange/agent",
      description: "Sovereign Exchange agent swap — declared x402 fee, credited to treasury in the internal book",
      mimeType: "application/json",
      maxTimeoutSeconds: 60,
      extra: {
        feeBps: X402_FEE_BPS,
        feeMinUsds: X402_FEE_MIN_USDS,
        notionalUsd: args.notionalUsd,
        member: args.member,
        poolFeeNote: "עמלת-בריכה 30bps נפרדת ונשארת בבריכה (ערך-ה-LP) — העמלה הזאת היא דמי-השער לסוכנים",
        assetAlt: args.feeAsset === "USDS" ? "SAOS" : "USDS",
      },
    },
  ];
}

function identityBlock() {
  const { count } = loadRegistry();
  return {
    standard: "ERC-8004 (Trustless Agents) — רישום sovereign/agents/erc8004-registry.json",
    registryCount: count,
    scheme: "erc8004-personal-signature-v1 (lightweight: חתימת personal_sign על הודעת-כוונה קנונית, טריות ≤10 דק', nonce single-use best-effort; EIP-712/EIP-3009 מלא — המשך-דרך מתועד)",
    requiredHeaders: IDENTITY_REQUIRED_HEADERS,
    challengeEndpoint: "/api/exchange/agent?action=challenge&agentId=<agentId>",
    bookMember: "agent:<agentId> — ממתין למימון דרך האוצר (רייל-ההפקדות wx: לחבר אנושי)",
  };
}

function capsBlock(usage?: { usedTodayUsd: number; events: number; since: string }) {
  return {
    perTxUsd: AGENT_PER_TX_CAP_USD,
    perDayUsd: AGENT_DAILY_CAP_USD,
    minNotionalUsd: MIN_NOTIONAL_USD,
    lawNote: "L3/L4 — מוגדר-קוד; צבירת-היום נמדדת מאירועי AGENT_SWAP בספר (לא מזיכרון)",
    ...(usage ? { usageToday: usage } : {}),
  };
}

// ── GET ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (readKillSwitch().killed) return killResponse();
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "agents") {
    const { agents, count } = loadRegistry();
    return j({
      ok: true,
      at: new Date().toISOString(),
      registryCount: count,
      agents: [...agents.values()].map((a) => ({ name: a.name, role: a.role, status: a.status, hasAddress: !!a.address, address: a.address })),
      note: "מטא-דאטה ERC-8004 ציבורי (כתובות ותפקידים בלבד — אפס סודות, כפי שהרישום עצמו מגדיר)",
    });
  }

  if (action === "challenge") {
    const agentId = url.searchParams.get("agentId") ?? "";
    const agent = lookupAgent(agentId);
    if (!agent) return j({ ok: false, error: "UNKNOWN-AGENT", detail: `אין זהות ERC-8004 בשם "${agentId}" — אין אתגר לזרים` }, 403);
    const { nonce, issuedAt, ttlSec } = issueNonce(agentId);
    // הודעת-עזר: האימות ב-POST בונה את ההודעה מחדש מהכוונה שבגוף —
    // החתימה קושרת את הכוונה האמיתית (זוג/סכום/עמלה), לא רק את הנונסה
    return j({
      ok: true,
      agentId,
      address: agent.address,
      member: agentBookMember(agentId),
      nonce,
      issuedAt,
      ttlSec,
      signingScheme: "personal_sign over buildIntentMessage(intent) — הפורמט הקנוני מתועד ב-src/lib/weave/agent-exchange.ts",
    });
  }

  if (action === "usage") {
    const agentId = url.searchParams.get("agentId") ?? "";
    if (!lookupAgent(agentId)) return j({ ok: false, error: "UNKNOWN-AGENT" }, 403);
    return j({ ok: true, agentId, caps: capsBlock(await agentUsageTodayUsd(agentId)) });
  }

  // ציטוט (ללא-זהות — פרסום; הביצוע המגודר הוא POST)
  const pairParam = url.searchParams.get("pair") ?? "";
  const sell = url.searchParams.get("sell") ?? pairParam.split("/")[0] ?? "";
  const buy = url.searchParams.get("buy") ?? pairParam.split("/")[1] ?? "";
  const amountIn = Number(url.searchParams.get("amountIn") ?? "0");

  if (!sell || !buy) {
    // תיאור-שירות — נקודת-התגלית לסוכנים
    const { count } = loadRegistry();
    return j({
      ok: true,
      service: "THE WEAVE · Sovereign Exchange — Agent Gate (ERC-8004 + x402)",
      at: new Date().toISOString(),
      endpoints: {
        quote: "GET /api/exchange/agent?sell=<A>&buy=<B>&amountIn=<n> (או pair=A/B&side=A2B|B2A)",
        challenge: "GET /api/exchange/agent?action=challenge&agentId=<id>",
        usage: "GET /api/exchange/agent?action=usage&agentId=<id>",
        agents: "GET /api/exchange/agent?action=agents",
        swap: "POST /api/exchange/agent — headers X-Agent-Id/X-Agent-Signature/X-PAYMENT, body {intent, dryRun?}",
      },
      internalAssets: [...EXCHANGE_ASSETS],
      pools: (await db.exchangePool.findMany()).map((p) => `${p.pair} (fee ${p.feeBps}bps)`),
      feeSchedule: { scheme: "exact", asset: "USDS", feeBps: X402_FEE_BPS, feeMinUsds: X402_FEE_MIN_USDS, payTo: "treasury", network: "x-weave:book" },
      caps: capsBlock(),
      identity: identityBlock(),
      killSwitch: "~/.sovereign/dex-kill — כל בקשה נבדקת (L4)",
      honesty: "ציטוט פנימי = בר-ביצוע בספר (L1) · ציטוט חוץ = quote-only (L4) · dry-run מוצהר זמין (L5)",
      registryCount: count,
    });
  }

  await ensureExchange();
  const internal = await resolveInternalPair(sell, buy);
  if (internal) {
    if (!(amountIn > 0)) {
      return j({ ok: false, error: "BAD-AMOUNT", detail: "נדרש amountIn>0 לציטוט פנימי — הציטוט חייב להיות בר-ביצוע, לא תיאורי (L1)", internalAssets: [...EXCHANGE_ASSETS] }, 400);
    }
    const side = url.searchParams.get("side") === "B2A" ? "B2A" : "A2B";
    const q = await quoteSwap(internal.pair, internal.side, amountIn);
    if (!("expectedOut" in q)) return j({ ok: false, error: "NO-QUOTE", detail: (q as { detail: string }).detail }, 400);
    const notional = await notionalUsdOf(internal.assetIn, amountIn);
    const fee = notional == null ? null : await feeInAsset("USDS", notional);
    return j({
      ok: true,
      at: new Date().toISOString(),
      mode: "internal",
      requested: { sell: sell.toUpperCase(), buy: buy.toUpperCase(), amountIn, side: internal.side, requestedSide: side },
      pair: internal.pair,
      quote: q,
      notionalUsd: notional,
      x402: {
        version: X402_VERSION,
        accepts: fee ? x402Accepts({ feeAmount: fee.amount, feeAsset: "USDS", notionalUsd: notional, member: "agent:<agentId>", book: "x-weave:book" }) : [],
        feeError: fee ? null : "אין שער-חי לנוטינאל — העמלה לא מוצהרת ולא תיגבה (כנות)",
        identity: identityBlock(),
        paymentAbsentBehavior: "POST בלי X-PAYMENT יחזיר 402 עם הלוח הזה",
      },
      caps: capsBlock(),
    });
  }

  const external = await externalQuoteOnly(sell, buy);
  if (external) return j({ ok: true, at: new Date().toISOString(), ...external });
  return j(
    {
      ok: false,
      error: "NO-ROUTE",
      detail: `אין בריכה פנימית ל-${sell.toUpperCase()}/${buy.toUpperCase()} ואין ערוץ-חוץ ממופה — הזירה לא מציגה נזילות שאיננה (L1)`,
      internalAssets: [...EXCHANGE_ASSETS],
    },
    400,
  );
}

// ── POST ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const at = new Date().toISOString();
  // ① kill-switch — לפני הכול (L4)
  if (readKillSwitch().killed) return killResponse();

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return j({ ok: false, at, error: "BAD-BODY: גוף הבקשה אינו JSON תקין" }, 400);
  }
  const intentRaw = body.intent ?? {};
  const pairIO = resolvePairInputs(intentRaw);

  // ② אין-תשלום → 402 בצורת-x402 הסטנדרטית (עם עמלה אמיתית אם הכוונה מלאה)
  const paymentHeader = req.headers.get("X-PAYMENT") ?? req.headers.get("x-payment");
  if (!paymentHeader) {
    let accepts = x402Accepts({ feeAmount: X402_FEE_MIN_USDS, feeAsset: "USDS", notionalUsd: null, member: "agent:<agentId>", book: "x-weave:book" });
    if (pairIO) {
      const internal = await resolveInternalPair(pairIO.sell, pairIO.buy);
      if (internal) {
        const notional = await notionalUsdOf(internal.assetIn, Number(intentRaw.amountIn ?? 0));
        const fee = notional == null ? null : await feeInAsset("USDS", notional);
        if (fee) accepts = x402Accepts({ feeAmount: fee.amount, feeAsset: "USDS", notionalUsd: notional, member: "agent:<agentId>", book: "x-weave:book" });
      }
    }
    return j(
      {
        x402Version: X402_VERSION,
        error: "X402-PAYMENT-REQUIRED",
        detail: "הבקשה ללא כותרת X-PAYMENT — זהו הלוח המוצהר; שלח מחדש עם X-PAYMENT (base64url JSON {scheme,asset,amount})",
        accepts,
        identity: identityBlock(),
        caps: capsBlock(),
        at,
      },
      402,
    );
  }

  // ③ פרסת-התשלום — פגום → 402 עם השגיאה
  const payment = parsePaymentHeader(paymentHeader);
  if (!payment.ok) {
    return j(
      {
        x402Version: X402_VERSION,
        error: "X402-PAYMENT-INVALID",
        detail: payment.error ?? "תשלום לא קריא",
        accepts: x402Accepts({ feeAmount: X402_FEE_MIN_USDS, feeAsset: "USDS", notionalUsd: null, member: "agent:<agentId>", book: "x-weave:book" }),
        at,
      },
      402,
    );
  }
  if (payment.scheme !== "exact" || (payment.asset !== "USDS" && payment.asset !== "SAOS")) {
    return j(
      {
        x402Version: X402_VERSION,
        error: "X402-PAYMENT-SCHEME-UNSUPPORTED",
        detail: `scheme="${payment.scheme}" asset="${payment.asset}" — נתמך: scheme=exact, asset=USDS|SAOS (בספר הפנימי)`,
        accepts: x402Accepts({ feeAmount: X402_FEE_MIN_USDS, feeAsset: "USDS", notionalUsd: null, member: "agent:<agentId>", book: "x-weave:book" }),
        at,
      },
      402,
    );
  }

  // ④ זהות — חייבת ראשית; לא-מוכרת = 403
  const agentId = req.headers.get("X-Agent-Id") ?? req.headers.get("x-agent-id") ?? "";
  if (!agentId) {
    return j({ ok: false, at, error: "AUTH-IDENTITY-REQUIRED", detail: "נדרש כותרת X-Agent-Id — זהות ERC-8004 רשומה", identity: identityBlock() }, 401);
  }
  const agent = lookupAgent(agentId);
  if (!agent) {
    return j({ ok: false, at, error: "UNKNOWN-AGENT", detail: `"${agentId}" אינו ברישום ERC-8004 — השער נעול לזרים`, registryCount: loadRegistry().count }, 403);
  }

  // ⑤ כוונה תקינה + זיווג-זוג
  if (!pairIO) return j({ ok: false, at, error: "BAD-INTENT", detail: 'intent חייב pair="A/B" או sell+buy' }, 400);
  const amountIn = Number(intentRaw.amountIn ?? 0);
  const minOut = Number(intentRaw.minOut ?? 0);
  if (!(amountIn > 0)) return j({ ok: false, at, error: "BAD-AMOUNT", detail: "amountIn חייב להיות חיובי" }, 400);
  const feeAsset = (payment.asset === "SAOS" ? "SAOS" : "USDS") as "USDS" | "SAOS";

  const internal = await resolveInternalPair(pairIO.sell, pairIO.buy);
  if (!internal) {
    const external = await externalQuoteOnly(pairIO.sell, pairIO.buy);
    if (external) {
      return j({
        ok: true,
        at,
        ...external, // mode:"quote-only" — מהמבנה-עצמו (אין כפילות)
        payment: { taken: false, note: "אף עמלה לא נגבתה — אין ביצוע, אין נגיעה בספר (L4)" },
      });
    }
    return j({ ok: false, at, error: "NO-ROUTE", detail: `אין בריכה פנימית ל-${pairIO.sell.toUpperCase()}/${pairIO.buy.toUpperCase()} ואין ערוץ-חוץ (L1)` }, 400);
  }

  // ⑥ נוטינאל + L3 מינימום + L4 קפסות (שער-מקדים: קריאה-בלבד, לפני-חתימה)
  const notional = await notionalUsdOf(internal.assetIn, amountIn);
  if (notional == null) {
    return j({ ok: false, at, error: "NO-PRICE", detail: `אין שער-חי ל-${internal.assetIn} — לא מבצעים עסקה שלא ניתן למדוד (L4)` }, 400);
  }
  if (notional < MIN_NOTIONAL_USD) {
    return j({ ok: false, at, error: "MIN-NOTIONAL", detail: `נוטינאל $${notional.toFixed(6)} מתחת למינימום $${MIN_NOTIONAL_USD} (L3)`, notionalUsd: notional }, 400);
  }
  const usage = await agentUsageTodayUsd(agentId);
  const caps = capDecision(notional, usage.usedTodayUsd);
  if (!caps.ok) {
    return j({ ok: false, at, error: caps.code, detail: caps.detail, caps: capsBlock(usage), notionalUsd: notional }, 429);
  }

  // ⑦ חתימה — חובה לפני כל שינוי-מצב
  const signature = req.headers.get("X-Agent-Signature") ?? req.headers.get("x-agent-signature") ?? "";
  const intent: SwapIntent = {
    agentId,
    pair: internal.pair,
    side: internal.side,
    amountIn,
    minOut,
    feeAsset,
    feeAmount: Number(intentRaw.feeAmount ?? payment.amount ?? 0),
    nonce: String(intentRaw.nonce ?? ""),
    issuedAt: String(intentRaw.issuedAt ?? ""),
  };
  if (!signature || !intent.nonce || !intent.issuedAt) {
    return j({ ok: false, at, error: "AUTH-SIGNATURE-REQUIRED", detail: "נדרש X-Agent-Signature (personal_sign על הודעת-הכוונה) + intent.nonce + intent.issuedAt", identity: identityBlock() }, 401);
  }
  const sig = verifyAgentSignature(intent, signature);
  if (!sig.ok) {
    const status = sig.code === "UNKNOWN-AGENT" ? 403 : 401;
    return j({ ok: false, at, error: sig.code, detail: sig.detail }, status);
  }

  // ⑧ תקרת-עמלה מוצהרת: העמלה-בפועל נמדדת עכשיו; אם עלתה מעל ההצהרה → 402 (הסוכן מצטט מחדש)
  const feeNow = await feeInAsset(feeAsset, notional);
  if (!feeNow) return j({ ok: false, at, error: "NO-PRICE", detail: "אין שער להמרת עמלת-SAOS — צטט מחדש" }, 400);
  if (intent.feeAmount < feeNow.amount) {
    return j(
      {
        x402Version: X402_VERSION,
        error: "X402-FEE-MOVED",
        detail: `העמלה-בפועל ${feeNow.amount} ${feeAsset} מעל המוצהר ${intent.feeAmount} — maxAmountRequired הוא תקרה; צטט מחדש (GET) ושלח שוב`,
        accepts: x402Accepts({ feeAmount: feeNow.amount, feeAsset, notionalUsd: notional, member: agentBookMember(agentId), book: "x-weave:book" }),
        at,
      },
      402,
    );
  }
  const chargedFee = feeNow.amount; // נגבים את המדידה-בפועל, לעולם לא מעל התקרה

  // ⑨ dry-run מוצהר (L5) — כל השערים עברו; אפס כתיבה לספר
  if (body.dryRun === true) {
    const q = await quoteSwap(internal.pair, internal.side, amountIn);
    if (!("expectedOut" in q)) return j({ ok: false, at, error: "NO-QUOTE", detail: (q as { detail: string }).detail }, 400);
    return j({
      ok: true,
      at,
      dryRun: true,
      truthClass: "SIM",
      wouldExecute: { pair: internal.pair, side: internal.side, amountIn, minOut, quote: q },
      fee: { declared: intent.feeAmount, charged: chargedFee, asset: feeAsset, usd: feeNow.usd, ceiling: intent.feeAmount },
      bookPlan: {
        debit: { member: agentBookMember(agentId), asset: internal.assetIn, amount: amountIn },
        credit: { member: agentBookMember(agentId), asset: internal.assetOut, amount: q.expectedOut },
        poolFee: { staysIn: "pool", bps: q.feeBps, note: "עמלת-בריכה נשארת בבריכה (ערך-ה-LP של האוצר צומח)" },
        x402Fee: {
          debit: { member: agentBookMember(agentId), asset: feeAsset, amount: chargedFee },
          credit: { member: "treasury", asset: feeAsset, amount: chargedFee },
          usd: feeNow.usd,
        },
      },
      identity: { verified: true, address: sig.address, nonceWasIssued: sig.nonceWasIssued },
      caps: capsBlock(usage),
      note: "dry-run מוצהר (L5) — כל השערים עברו, אפס כתיבה. הסר dryRun לביצוע אמיתי בספר.",
    });
  }

  // ⑩ ביצוע — סוופ בספר + סליקת-עמלה לאוצר
  const r = await swap({ member: agentBookMember(agentId), pair: internal.pair, side: internal.side, amountIn, minOut });
  if (!r.ok) {
    return j({ ok: false, at, error: "SWAP-FAILED", detail: r.detail, pair: internal.pair }, 409);
  }
  const settle = await agentSwapSettle({
    agentId,
    member: agentBookMember(agentId),
    feeAsset,
    feeAmount: chargedFee,
    feeUsd: feeNow.usd,
    notionalUsd: notional,
    pair: internal.pair,
    side: internal.side,
    swapSeq: r.event?.seq ?? null,
  });
  return j({
    ok: true,
    at,
    mode: "internal",
    executed: true,
    member: agentBookMember(agentId),
    pair: internal.pair,
    side: internal.side,
    amountIn,
    swap: { detail: r.detail, seq: r.event?.seq ?? null, hash: r.event?.hash ?? null, quote: r.quote },
    fee: {
      charged: chargedFee,
      asset: feeAsset,
      usd: feeNow.usd,
      declared: intent.feeAmount,
      creditedTo: "treasury",
      settled: settle.ok,
      settleSeq: settle.event?.seq ?? null,
      detail: settle.detail,
    },
    identity: { verified: true, address: sig.address },
    caps: capsBlock(await agentUsageTodayUsd(agentId)),
    honesty: "סוופ-ספר פנימי (ספר-תביעות SIM-class) — עמלת-x402 נגבה ונרשמה FEE + AGENT_SWAP",
  });
}
