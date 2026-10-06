// ─────────────────────────────────────────────────────────────────────
// /api/moment — הבנת-הרגע של הרשת הריבונית (R62).
//
// הדרישה: "לא תמיד לעבוד לפי תוכנית מסודרת אלא לחפש הבנות ויכולות
// ברשת ופוטנציאל ולבחון דרכי מימוש" — התשובה הכנה היא לא עוד תוכנית
// אלא קריאת-רגע חיה שמחליטה מה רלוונטי עכשיו, מתוך מדידה בלבד:
//
//   · משטר-השוק (BTC 24ש' + אינדקס פחד-ותאווה) — על מה אנחנו עומדים.
//   · קו-הזהות שלנו (parity ‏SBD/STEEM) מול הספר הפנימי החי — היתרון.
//   · מסלול-הדלק (powerdown) — הערך האמת שזורם פנימה.
//   · תובנות-רגע: חריגות שנמדדו עכשיו, כל אחת עם הסיבה.
//   · צליבת-הצי: מה סוכן הבנת-הרגע שבענן (moment-watch) פרסם.
//
// שום דבר לא מומר "מידע" — כל מקור שנפל מסומן בכנות (null + down).
// אין כאן ניבוי ואין הבטחה: רק מה שנמדד ברגע הקריאה.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";

export const dynamic = "force-dynamic";

// ── קבועי-מדיניות (מוצגים למפעיל — שקיפות מלאה) ─────────────────────

const THRESHOLDS = {
  btc24hPct: 4, // |±4%| ביממה = מהלך-שוק משמעותי
  fgLow: 25, // פחד-קיצוני
  fgHigh: 60, // תאווה
  steemMovePct: 5, // |±5%| STEEM = רלוונטי לסימוני-הגריד
  gridStaleHours: 26, // הגריד אמור לפעום כל-2ש' + יומי; מעבר לזה = מראה מעופשת
} as const;

const COMMANDER = "headcorner";

// ── עזרי-רשת (אותו דפוס שהוכח ב-/api/treasury) ───────────────────────

async function jget(url: string, ms = 12000): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function steemRpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch("https://api.steemit.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`steemit rpc -> ${r.status}`);
  const j = await r.json();
  if (j?.error) throw new Error(String(j.error.message ?? "rpc-error"));
  return j.result;
}

// ── מקורות-הרגע ──────────────────────────────────────────────────────

async function pricesSide() {
  const j = await jget(
    "https://api.coingecko.com/api/v3/simple/price?ids=steem,steem-dollars,bitcoin,ethereum,tron&vs_currencies=usd&include_24hr_change=true",
  );
  const pick = (id: string) => ({
    usd: j?.[id]?.usd ?? null,
    chg24h: j?.[id]?.usd_24h_change ?? null,
  });
  return {
    steem: pick("steem"),
    sbd: pick("steem-dollars"),
    btc: pick("bitcoin"),
    eth: pick("ethereum"),
    trx: pick("tron"),
  };
}

async function globalSide() {
  const j = await jget("https://api.coingecko.com/api/v3/global");
  const d = j?.data;
  return {
    totalMarketCapUsd: d?.total_market_cap?.usd ?? null,
    marketCapChg24hPct: d?.market_cap_change_percentage_24h_usd ?? null,
    btcDominance: d?.market_cap_percentage?.btc ?? null,
  };
}

async function fearGreedSide() {
  // מקור ציבורי בלי-מפתח; נפילה = null כן, לא המצאה
  const j = await jget("https://api.alternative.me/fng/?limit=1");
  const d = j?.data?.[0];
  return {
    value: d ? Number(d.value) : null,
    label: d?.value_classification ?? null,
  };
}

async function steemBookSide() {
  // הספר הפנימי הציבורי של STEEM/SBD — שם הגריד שלנו עובד
  const [book, accts, props] = await Promise.all([
    steemRpc("condenser_api.get_order_book", [21]),
    steemRpc("condenser_api.get_accounts", [[COMMANDER]]),
    steemRpc("condenser_api.get_dynamic_global_properties", []),
  ]);
  const fund = parseFloat(props.total_vesting_fund_steem);
  const shares = parseFloat(props.total_vesting_shares);
  const perVest = shares > 0 ? fund / shares : 0; // SP לכל VEST
  const a = accts?.[0];
  if (!a) throw new Error("commander account unreadable");
  const bestBid = book?.bids?.[0]?.real_price ? Number(book.bids[0].real_price) : null;
  const bestAsk = book?.asks?.[0]?.real_price ? Number(book.asks[0].real_price) : null;
  // הכמויות מגיעות במילי-יחידות (sbd: 3536 = 3.536 SBD) — מנרמלים
  const bidsDepthSbd = (book?.bids ?? []).reduce(
    (s: number, b: any) => s + Number(b?.sbd ?? 0),
    0,
  ) / 1000;
  const asksDepthSteem = (book?.asks ?? []).reduce(
    (s: number, o: any) => s + Number(o?.steem ?? 0),
    0,
  ) / 1000;
  return {
    orderBook: {
      bestBid,
      bestAsk,
      bidsDepthSbd,
      asksDepthSteem,
      levels: (book?.bids ?? []).length,
    },
    commander: {
      steem: parseFloat(a.balance),
      sbd: parseFloat(a.sbd_balance),
      sp: (parseFloat(a.vesting_shares) - parseFloat(a.delegated_vesting_shares)) * perVest,
      powerdown: {
        active: Number(a.to_withdraw ?? 0) > 0,
        weeklySp: parseFloat(a.vesting_withdraw_rate) * perVest,
        nextPayment: a.next_vesting_withdrawal || null,
        remainingSp: (Number(a.to_withdraw ?? 0) / 1e6) * perVest,
      },
    },
  };
}

// ── מראות-הצי (GitHub Pages — נקראות בזמן-הבקשה) ─────────────────────
//
// חוק-המראה הטרייה: שני בתים מפרסמים את ספר-הגריד (המנוע דוחף ל-Console;
// Domain מחזיק עותק) — אנחנו קוראים את שניהם ולוקחים את הטרייה לפי
// publishedAt. לעולם לא נסתמך על מראה קפואה רק בגלל שהיא קרובה.

const MIRROR = {
  grid: [
    "https://roshpinacare-sys.github.io/Domain/dex/grid.json",
    "https://roshpinacare-sys.github.io/Console/dex/grid.json",
  ],
  watch: [
    "https://roshpinacare-sys.github.io/Domain/dex/watch.json",
    "https://roshpinacare-sys.github.io/Console/dex/watch.json",
  ],
  moment: ["https://roshpinacare-sys.github.io/Domain/moment/moment.json"],
} as const;

async function firstOk(urls: readonly string[]): Promise<any | null> {
  for (const u of urls) {
    try {
      return await jget(u, 8000);
    } catch {
      /* המראה הבאה */
    }
  }
  return null;
}

/** המראה הטרייה זוכה — לפי publishedAt של המסמך עצמו */
async function freshestMirror(urls: readonly string[]): Promise<any | null> {
  let best: any = null;
  for (const u of urls) {
    try {
      const j = await jget(u, 8000);
      if (j?.publishedAt && (!best || new Date(j.publishedAt) > new Date(best.publishedAt))) {
        best = j;
      }
    } catch {
      /* המראה הבאה */
    }
  }
  return best;
}

// ── חישוב-הרגע ───────────────────────────────────────────────────────

interface Insight {
  kind: string;
  tone: "good" | "info" | "warn";
  text: string;
}

function classifyRegime(btc24h: number | null, fg: number | null) {
  const drivers: string[] = [];
  if (btc24h != null) drivers.push(`BTC ${btc24h >= 0 ? "+" : ""}${btc24h.toFixed(1)}% ביממה`);
  if (fg != null) drivers.push(`פחד-ותאווה ${fg}`);
  if (btc24h == null) {
    return { label: "UNKNOWN" as const, drivers, reason: "מחיר-BTC לא נמדד" };
  }
  if (btc24h <= -THRESHOLDS.btc24hPct || (fg != null && fg <= THRESHOLDS.fgLow)) {
    return { label: "RISK_OFF" as const, drivers };
  }
  if (btc24h >= THRESHOLDS.btc24hPct || (fg != null && fg >= THRESHOLDS.fgHigh)) {
    return { label: "RISK_ON" as const, drivers };
  }
  return { label: "NEUTRAL" as const, drivers };
}

async function composeMoment() {
  const down: string[] = [];
  // סוכן-הצי נקרא ראשון — גם לצליבה וגם כגיבוי-מחירים כשהחוץ נחנק
  const fleetMoment = await firstOk(MIRROR.moment).catch(() => null);
  const fleetFreshMin = fleetMoment?.publishedAt
    ? Math.round((Date.now() - new Date(fleetMoment.publishedAt).getTime()) / 6e4)
    : null;
  const [pricesRaw, global, fg, steem, grid, watch] = await Promise.all([
    pricesSide().catch((e) => {
      down.push(`coingecko: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    globalSide().catch(() => null),
    fearGreedSide().catch(() => null),
    steemBookSide().catch((e) => {
      down.push(`steem-book: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    freshestMirror(MIRROR.grid).catch(() => null),
    firstOk(MIRROR.watch).catch(() => null),
  ]);

  // גיבוי-ריבוני: אם המקור-החוץ נחנק וסוכן-הצי שלנו מדד לפני פחות מ-35 דק',
  // אנחנו משתמשים במדידה שלו — בסימון ברור של המקור. זה הצי כמישור-נתונים.
  let priceSource: "live" | "fleet-fallback" = "live";
  let prices = pricesRaw;
  if (
    !prices &&
    fleetMoment?.market?.steemUsd != null &&
    fleetFreshMin != null &&
    fleetFreshMin <= 35
  ) {
    prices = {
      steem: { usd: fleetMoment.market.steemUsd ?? null, chg24h: fleetMoment.market.steem24h ?? null },
      sbd: { usd: fleetMoment.market.sbdUsd ?? null, chg24h: null },
      btc: { usd: fleetMoment.market.btcUsd ?? null, chg24h: fleetMoment.market.btc24h ?? null },
      eth: { usd: null, chg24h: null },
      trx: { usd: null, chg24h: null },
    };
    priceSource = "fleet-fallback";
  }

  const steemUsd = prices?.steem?.usd ?? null;
  const sbdUsd = prices?.sbd?.usd ?? null;
  const btc24h = prices?.btc?.chg24h ?? null;
  const steem24h = prices?.steem?.chg24h ?? null;

  // קו-הזהות: שוויו של STEEM אחד מבוטא ב-SBD (steemUsd/sbdUsd —
  // אותה נוסחה של המנוע: 0.0554/0.4447=0.1246). מתחת לקו = קנייה בעודף.
  const paritySbdPerSteem = steemUsd && sbdUsd ? steemUsd / sbdUsd : null;

  // הספר הפנימי החי (RPC, עכשיו) מול קו-הזהות — היתרון המדוד.
  // bid מתחת לקו = עודף-קנייה; הגריד מוכר רק מעל הקו.
  const live = steem?.orderBook ?? null;
  const bidSurplusBps =
    live?.bestBid != null && paritySbdPerSteem
      ? ((live.bestBid - paritySbdPerSteem) / paritySbdPerSteem) * 10_000
      : null;
  const askPositionBps =
    live?.bestAsk != null && paritySbdPerSteem
      ? ((live.bestAsk - paritySbdPerSteem) / paritySbdPerSteem) * 10_000
      : null;

  // תמונת-המנוע האחרונה (מראה מזדקנת — הספר שלה נכתב בזמן הריצה)
  const gridBook = grid?.book ?? null;

  const regime = classifyRegime(btc24h, fg?.value ?? null);

  // מסלול-הדלק ואוצר-המפקד בסימון חי
  const cmd = steem?.commander ?? null;
  const weeklyUsd = cmd?.powerdown.weeklySp && steemUsd ? cmd.powerdown.weeklySp * steemUsd : null;
  const treasuryUsd =
    cmd && steemUsd
      ? cmd.steem * steemUsd + cmd.sbd * (sbdUsd ?? 0) + cmd.sp * steemUsd
      : null;

  // ── תובנות-הרגע: רק מה שנמדד, כל שורה עם המספר שלה ──
  const insights: Insight[] = [];

  if (bidSurplusBps != null) {
    insights.push({
      kind: "parity-edge",
      tone: bidSurplusBps < 0 ? "good" : "warn",
      text:
        bidSurplusBps < 0
          ? `עומק-קנייה חי ${Math.round(Math.abs(bidSurplusBps))}bps מתחת לקו-הזהות (best-bid ${live?.bestBid?.toFixed(4)} מול parity ${paritySbdPerSteem?.toFixed(4)}) — כל מילוי-קנייה שם הוא עודף מדוד, בדיוק היתרון שהגריד נבנה ללכוד.`
          : `הספר הפנימי החי נסחר ${Math.round(bidSurplusBps)}bps מעל קו-הזהות — אין עודף-קנייה כרגע; הגריד ימתין במקום לרדוף.`,
    });
  }

  const blocker = Array.isArray(grid?.blocker) ? grid.blocker[0] : null;
  if (blocker) {
    insights.push({
      kind: "sbd-inventory",
      tone: "warn",
      text: `צוואר-הקנייה של הגריד: ${blocker}`,
    });
  }

  if (steem24h != null && Math.abs(steem24h) >= THRESHOLDS.steemMovePct) {
    insights.push({
      kind: "steem-move",
      tone: "info",
      text: `STEEM זז ${steem24h >= 0 ? "+" : ""}${steem24h.toFixed(1)}% ביממה — הסימונים של הגריד (steemUsd/sbdUsd) נגזרים מחדש בפעימה הבאה; תוכניות-עבר עלולות להיות לא-רלוונטיות.`,
    });
  }

  if (cmd?.powerdown.nextPayment && weeklyUsd != null) {
    insights.push({
      kind: "fuel",
      tone: "info",
      text: `הדלק הבא נוחת ${cmd.powerdown.nextPayment.slice(0, 10)} — ≈${cmd.powerdown.weeklySp.toFixed(0)} SP ≈ ${weeklyUsd.toFixed(1)}$ בסימון חי; עוד ${Math.max(0, Math.round(cmd.powerdown.remainingSp / Math.max(cmd.powerdown.weeklySp, 0.01)))} תשלומים.`,
    });
  }

  const gridAgeH =
    grid?.publishedAt ? (Date.now() - new Date(grid.publishedAt).getTime()) / 3.6e6 : null;
  if (gridAgeH != null && gridAgeH > THRESHOLDS.gridStaleHours) {
    insights.push({
      kind: "grid-stale",
      tone: "warn",
      text: `מראת-הגריד מעופשת (${gridAgeH.toFixed(0)} שעות מאז ${grid.publishedAt}) — הלב אמור לפעום כל-2ש'; זו חריגה ממה שהובטח.`,
    });
  }

  const depositsTotal = watch?.depositsTotal ?? null;
  if (depositsTotal != null) {
    insights.push({
      kind: "deposits",
      tone: depositsTotal === 0 ? "info" : "good",
      text:
        depositsTotal === 0
          ? "אפס הפקדות-חוץ (נמדד בכל 20 דקות ב-4 שרשרות) — המעגל האמת טרם נסגר בכסף של מישהו אחר; הערך שזורם הוא הדלק ועודפי-הגריד בלבד."
          : `נמדדו ${depositsTotal} הפקדות-חוץ — כל אחת מאומתת מול השרשרת בטרם זיכוי.`,
    });
  }

  if (grid?.externalFlowUsd != null) {
    insights.push({
      kind: "external-flow",
      tone: "info",
      text: `זרימת-חוץ מצטברת של הגריד: ${grid.externalFlowUsd.toFixed(4)}$ מ-${grid?.run?.filledTotal ?? 0} מילויים — כל מילוי עם txid ועודף מדוד בספר הציבורי.`,
    });
  }

  // צליבת-הצי: מה פרסם סוכן הבנת-הרגע בענן
  const fleet = fleetMoment
    ? {
        url: MIRROR.moment[0],
        publishedAt: fleetMoment.publishedAt ?? null,
        regime: fleetMoment.regime?.label ?? null,
        call: fleetMoment.call ?? null,
        callStats: fleetMoment.callStats ?? null,
        fleetFreshMin: fleetMoment.publishedAt
          ? Math.round((Date.now() - new Date(fleetMoment.publishedAt).getTime()) / 6e4)
          : null,
      }
    : null;

  return {
    ok: down.length === 0,
    fetchedAt: new Date().toISOString(),
    down: down.length ? down : undefined,
    priceSource,
    thresholds: THRESHOLDS,
    market: {
      ...prices,
      global,
      fearGreed: fg,
      sources: ["api.coingecko.com", "api.alternative.me", "api.steemit.com", "github.io/Domain", "github.io/Console"],
    },
    paritySbdPerSteem,
    liveBook: live
      ? {
          ...live,
          bidSurplusBps: bidSurplusBps != null ? Math.round(bidSurplusBps) : null,
          askPositionBps: askPositionBps != null ? Math.round(askPositionBps) : null,
        }
      : null,
    engineBook: gridBook,
    grid: grid
      ? {
          verdict: grid.verdict ?? null,
          armed: grid.armed ?? null,
          blocker,
          externalFlowUsd: grid.externalFlowUsd ?? null,
          publishedAt: grid.publishedAt ?? null,
        }
      : null,
    runway: cmd
      ? {
          ...cmd.powerdown,
          weeklyUsd,
          treasuryUsd,
        }
      : null,
    orderBook: steem?.orderBook ?? null,
    regime,
    insights,
    fleet,
  };
}

// ── מטמון SWR: תשובה מיידית תמיד, רענון-רקע יחיד ─────────────────────

const SWR_KEY = "api:moment";
const SWR_TTL_MS = 120_000;

export async function GET() {
  const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, composeMoment);
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
