// MOMENT-WATCH — סוכן הבנת-הרגע של הרשת הריבונית (R62)
//
// הדרישה מהמפעיל: "לקבל הבנה של הרגע ולא תמיד לעבוד לפי תוכנית מסודרת
// אלא לחפש הבנות ויכולות ברשת ופוטנציאל ולבחון דרכי מימוש — כי תוכניות
// ישנות יכולות להיות לא רלוונטיות בשוק תזזיתי; הריבונות חייבת להיות
// אוטונומית-דינמית."
//
// התשובה הכנה: לא עוד תוכנית אלא קריאת-רגע חיה כל חצי-שעה, ממקורות
// ציבוריים בלבד, עם ארבעה כלים:
//   1. משטר-השוק — BTC 24ש' + אינדקס פחד-ותאווה (אם נופל — null כן).
//   2. קו-הזהות שלנו — parity ‏SBD/STEEM מול הספר הפנימי החי של Steem;
//      עומק-קנייה מתחת לקו = העודף המדוד שהגריד נבנה ללכוד.
//   3. תובנות-רגע — חריגות שנמדדו עכשיו (מלאי-SBD, תזוזת-STEEM, ישנות-מראה,
//      הפקדות, זרימה חיצונית), כל אחת עם המספר שלה.
//   4. אימון-כנון — קריאת-כיוון דטרמיניסטית על STEEM (סף ±3% ביממה)
//      שנרשמת ומוכרעת רק אחרי 6 שעות; כל קריאה שהוכרעה נספרת בסטטיסטיקה
//      גלויה. זה לא ניבוי ולא למידת-מכונה — זו מדידה של הקריאות שלנו
//      מול המציאות, שתישאר גם אם תצא גרועה. FLAT אינו נספר.
//
// אפס-מפתחות: CoinGecko · alternative.me · RPC ציבורי של Steem · המראות
// הציבוריות שלנו. כל נפילה נרשמת בכנות (null + סיבה) — שום דבר לא מדומה.
// הסוכן לא זז כסף, לא חותם ולא מזניק אף מכונה: הוא רואה, מבין, מתעד.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const OUT_DIR = "moment";
const STEEM_ACCOUNT = "headcorner";
const GRID_URL = "https://roshpinacare-sys.github.io/Console/dex/grid.json"; // המראה החיה של המנוע
const CALL_THRESHOLD_PCT = 3; // סף קריאת-כיוון: |±3%| STEEM ביממה
const CALL_HORIZON_H = 6;    // אופק הכרעה: 6 שעות
const HISTORY_CAP = 240;
const THRESHOLDS = { btc24hPct: 4, fgLow: 25, fgHigh: 60, steemMovePct: 5, gridStaleHours: 26 };

const num = (s) => parseFloat(String(s).replace(/[A-Za-z ]+/g, "")) || 0;
const r2 = (v) => Math.round(v * 100) / 100;

/* ═══ 1) מקורות-הרגע ═══ */

async function coingeckoPrices() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=steem,steem-dollars,bitcoin&vs_currencies=usd&include_24hr_change=true";
  let lastErr = null;
  // שני ניסיונות עם המתנה — הגבלות-קצב רגעיות הן שגרה ב-API החופשי
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "moment-watch" } });
      if (!r.ok) throw new Error(`coingecko -> ${r.status}`);
      const j = await r.json();
      return {
        steemUsd: j?.steem?.usd ?? null,
        steem24h: j?.steem?.usd_24h_change ?? null,
        sbdUsd: j?.["steem-dollars"]?.usd ?? null,
        btcUsd: j?.bitcoin?.usd ?? null,
        btc24h: j?.bitcoin?.usd_24h_change ?? null,
      };
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((res) => setTimeout(res, 15_000));
    }
  }
  throw lastErr;
}

async function fearGreed() {
  try {
    const r = await fetch("https://api.alternative.me/fng/?limit=1", {
      headers: { "User-Agent": "moment-watch" },
    });
    if (!r.ok) throw new Error(`fng -> ${r.status}`);
    const j = await r.json();
    const d = j?.data?.[0];
    return d ? { value: Number(d.value), label: d.value_classification ?? null } : null;
  } catch (e) {
    return { value: null, label: null, error: String(e.message).slice(0, 60) }; // נפילה כנה
  }
}

async function steemSide() {
  const post = async (method, params) => {
    const r = await fetch("https://api.steemit.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    if (!r.ok) throw new Error(`steemit rpc -> ${r.status}`);
    const j = await r.json();
    if (j?.error) throw new Error(String(j.error.message ?? "rpc-error"));
    return j.result;
  };
  const [book, accts, props] = await Promise.all([
    post("condenser_api.get_order_book", [21]),
    post("condenser_api.get_accounts", [[STEEM_ACCOUNT]]),
    post("condenser_api.get_dynamic_global_properties", []),
  ]);
  const fund = num(props.total_vesting_fund_steem);
  const shares = num(props.total_vesting_shares);
  const perVest = shares > 0 ? fund / shares : 0;
  const a = accts?.[0];
  if (!a) throw new Error("commander account unreadable");
  // כמויות הספר מגיעות במילי-יחידות; real_price = ‏SBD לכל STEEM
  const bestBid = book?.bids?.[0]?.real_price ? Number(book.bids[0].real_price) : null;
  const bestAsk = book?.asks?.[0]?.real_price ? Number(book.asks[0].real_price) : null;
  const bidsDepthSbd = (book?.bids ?? []).reduce((s, b) => s + num(b?.sbd ?? "0"), 0) / 1000;
  const asksDepthSteem = (book?.asks ?? []).reduce((s, o) => s + num(o?.steem ?? "0"), 0) / 1000;
  return {
    book: { bestBid, bestAsk, bidsDepthSbd: r2(bidsDepthSbd), asksDepthSteem: r2(asksDepthSteem), levels: (book?.bids ?? []).length },
    commander: {
      steem: num(a.balance),
      sbd: num(a.sbd_balance),
      sp: (num(a.vesting_shares) - num(a.delegated_vesting_shares)) * perVest,
      powerdown: {
        active: num(a.to_withdraw) > 0,
        weeklySp: num(a.vesting_withdraw_rate) * perVest,
        nextPayment: a.next_vesting_withdrawal || null,
        remainingSp: (num(a.to_withdraw) / 1e6) * perVest,
      },
    },
  };
}

async function gridMirror() {
  const r = await fetch(`${GRID_URL}?t=${Date.now()}`, { headers: { "User-Agent": "moment-watch" } });
  if (!r.ok) throw new Error(`grid mirror -> ${r.status}`);
  return r.json();
}

function localJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

/* ═══ 2) מדידה ═══ */

const prices = await coingeckoPrices().catch((e) => ({ error: String(e.message).slice(0, 90) }));
const fg = await fearGreed();
const steem = await steemSide().catch((e) => ({ error: String(e.message).slice(0, 90) }));
const grid = await gridMirror().catch((e) => null);
const money = localJson("dex/money.json");
const deposits = localJson("dex/deposits.json");

const steemUsd = prices.steemUsd ?? null;
const sbdUsd = prices.sbdUsd ?? null;
const parity = steemUsd && sbdUsd ? steemUsd / sbdUsd : null; // SBD לכל STEEM, כמו במנוע
const bestBid = steem.book?.bestBid ?? null;
const bidSurplusBps = bestBid != null && parity ? ((bestBid - parity) / parity) * 1e4 : null;

// משטר-השוק: דטרמיניסטי, ספים מפורסמים
const btc24h = prices.btc24h ?? null;
const fgVal = fg?.value ?? null;
const drivers = [];
if (btc24h != null) drivers.push(`BTC ${btc24h >= 0 ? "+" : ""}${btc24h.toFixed(1)}%`);
if (fgVal != null) drivers.push(`F&G ${fgVal}`);
let regimeLabel = "UNKNOWN";
if (btc24h != null) {
  if (btc24h <= -THRESHOLDS.btc24hPct || (fgVal != null && fgVal <= THRESHOLDS.fgLow)) regimeLabel = "RISK_OFF";
  else if (btc24h >= THRESHOLDS.btc24hPct || (fgVal != null && fgVal >= THRESHOLDS.fgHigh)) regimeLabel = "RISK_ON";
  else regimeLabel = "NEUTRAL";
}
const regime = { label: regimeLabel, drivers, thresholds: THRESHOLDS };

// מסלול-הדלק ואוצר בסימון חי
const cmd = steem.commander ?? null;
const weeklyUsd = cmd?.powerdown.weeklySp && steemUsd ? cmd.powerdown.weeklySp * steemUsd : null;
const treasuryUsd = cmd && steemUsd ? cmd.steem * steemUsd + cmd.sbd * (sbdUsd ?? 0) + cmd.sp * steemUsd : null;

/* ═══ 3) תובנות-הרגע ═══ */

const insights = [];
if (bidSurplusBps != null) {
  insights.push({
    kind: "parity-edge",
    tone: bidSurplusBps < 0 ? "good" : "warn",
    text: bidSurplusBps < 0
      ? `עומק-קנייה חי ${Math.round(Math.abs(bidSurplusBps))}bps מתחת לקו-הזהות (bid ${bestBid?.toFixed(4)} מול parity ${parity?.toFixed(4)}) — עודף מדוד לגריד.`
      : `הספר החי ${Math.round(bidSurplusBps)}bps מעל קו-הזהות — אין עודף-קנייה כרגע; הגריד ממתין.`,
  });
}
const blocker = Array.isArray(grid?.blocker) ? grid.blocker[0] : null;
if (blocker) insights.push({ kind: "sbd-inventory", tone: "warn", text: `צוואר-הקנייה של הגריד: ${blocker}` });
const steem24h = prices.steem24h ?? null;
if (steem24h != null && Math.abs(steem24h) >= THRESHOLDS.steemMovePct) {
  insights.push({ kind: "steem-move", tone: "info", text: `STEEM ${steem24h >= 0 ? "+" : ""}${steem24h.toFixed(1)}% ביממה — סימוני-הגריד ייגזרו מחדש בפעימה הבאה; תוכניות-עבר עלולות לא-רלוונטיות.` });
}
if (cmd?.powerdown?.nextPayment && weeklyUsd != null) {
  insights.push({ kind: "fuel", tone: "info", text: `דלק נוחת ${cmd.powerdown.nextPayment.slice(0, 10)} — ≈${cmd.powerdown.weeklySp.toFixed(0)} SP ≈ ${weeklyUsd.toFixed(1)}$ בסימון חי.` });
}
const gridAgeH = grid?.publishedAt ? (Date.now() - new Date(grid.publishedAt).getTime()) / 3.6e6 : null;
if (gridAgeH != null && gridAgeH > THRESHOLDS.gridStaleHours) {
  insights.push({ kind: "grid-stale", tone: "warn", text: `מראת-הגריד מעופשת (${gridAgeH.toFixed(0)}ש' מאז ${grid.publishedAt}) — חריגה מקצב הלב המובטח.` });
}
const depositsTotal = Array.isArray(deposits?.deposits) ? deposits.deposits.length : null;
if (depositsTotal != null) {
  insights.push({
    kind: "deposits",
    tone: depositsTotal === 0 ? "info" : "good",
    text: depositsTotal === 0
      ? "אפס הפקדות-חוץ (ספר ההפקדות הפתוח נקרא מהריפו) — המעגל האמיתי טרם נסגר בכסף של מישהו אחר."
      : `נמדדו ${depositsTotal} הפקדות-חוץ בספר הפתוח.`,
  });
}
if (grid?.externalFlowUsd != null) {
  insights.push({ kind: "external-flow", tone: "info", text: `זרימת-חוץ מצטברת: ${grid.externalFlowUsd.toFixed(4)}$ מ-${grid?.run?.filledTotal ?? 0} מילויים (txids בספר הציבורי).` });
}

// ═══ 4) אימון-כנון: קריאת-כיוון שנרשמת ומוכרעת ═══

// קריאה נרשמת רק עם מחיר-בסיס חי: קריאה בלי בסיס היא הבטחה שאין לה מדידה,
// והכרעתה תיצור hit מזויף (0/null → ∞). אין מחיר — אין קריאה.
let call = null; // אין קריאה כשאין מדידה
if (steem24h != null && steemUsd != null) {
  call = steem24h >= CALL_THRESHOLD_PCT ? "UP" : steem24h <= -CALL_THRESHOLD_PCT ? "DOWN" : "FLAT";
}

let history = localJson(`${OUT_DIR}/history.json`, []);
if (!Array.isArray(history)) history = [];
const now = Date.now();

// הכרעת קריאות שהגיעו לאופק — רק כשיש מחיר חי להכריע לפיו
let resolvedNow = 0;
if (steemUsd != null) {
  for (const h of history) {
    // רק קריאות עם בסיס נמדד מוכרעות; קריאה ללא בסיס אינה נספרת לעולם (הגנת-יושר)
    if (h.call && h.call !== "FLAT" && h.steemUsd != null && !h.resolved && now - new Date(h.at).getTime() >= CALL_HORIZON_H * 3.6e6) {
      const realizedPct = (steemUsd / h.steemUsd - 1) * 100;
      h.resolved = {
        at: new Date().toISOString(),
        realizedPct: r2(realizedPct),
        hit: (realizedPct > 0 && h.call === "UP") || (realizedPct < 0 && h.call === "DOWN"),
      };
      resolvedNow++;
    }
  }
}
const resolvedCalls = history.filter((h) => h.resolved);
const hits = resolvedCalls.filter((h) => h.resolved.hit).length;
const callStats = resolvedCalls.length
  ? { resolved: resolvedCalls.length, hits, hitRatePct: Math.round((hits / resolvedCalls.length) * 100), horizonH: CALL_HORIZON_H, thresholdPct: CALL_THRESHOLD_PCT }
  : { resolved: 0, hits: 0, hitRatePct: null, horizonH: CALL_HORIZON_H, thresholdPct: CALL_THRESHOLD_PCT };

// רישום הקריאה של עכשיו
history.push({
  at: new Date().toISOString(),
  steemUsd: steemUsd,
  steem24h: steem24h ?? null,
  regime: regimeLabel,
  call,
});
if (history.length > HISTORY_CAP) history = history.slice(-HISTORY_CAP);

/* ═══ 5) פרסום ═══ */

const doc = {
  ok: prices.error ? false : true,
  format: "moment-watch-v1",
  publishedAt: new Date().toISOString(),
  engine: "Domain/agents/moment-watch · R62 sovereign moment",
  role: "reads the live moment every 30 minutes (market regime, our parity line vs the live internal book, fuel runway, measured anomalies) and records a deterministic directional call that is only ever scored after its horizon has passed - training as measurement, never as promise",
  market: { ...prices, fearGreed: fg },
  paritySbdPerSteem: parity,
  liveBook: steem.error ? null : {
    ...steem.book,
    bidSurplusBps: bidSurplusBps != null ? Math.round(bidSurplusBps) : null,
  },
  regime,
  runway: steem.error ? null : {
    ...cmd.powerdown,
    weeklyUsd: weeklyUsd != null ? r2(weeklyUsd) : null,
    treasuryUsd: treasuryUsd != null ? r2(treasuryUsd) : null,
  },
  grid: grid ? { verdict: grid.verdict ?? null, armed: grid.armed ?? null, blocker, externalFlowUsd: grid.externalFlowUsd ?? null, publishedAt: grid.publishedAt ?? null } : null,
  moneyPath: money ? { fuel: money.fuel ?? null, redemption: money.redemption?.verdict ?? null } : null,
  call,
  callStats,
  resolvedNow,
  insights,
  sources: ["api.coingecko.com", "api.alternative.me", "api.steemit.com", "Console/dex/grid.json (live mirror)", "dex/money.json (self)", "dex/deposits.json (self)"],
  honesty: "כל נתון נמדד חי ממקורות ציבוריים; נפילת מקור מסומנת בכנות ואינה מוחלפת בהמצאה. קריאת-הכיוון דטרמיניסטית (±3% ביממה) ומוכרעת רק אחרי 6 שעות מול מחיר חי - גם כשהתוצאה גרועה. הסוכן אינו זז כסף, אינו חותם ואינו מזניק מכונות.",
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/moment.json`, JSON.stringify(doc, null, 1) + "\n");
writeFileSync(`${OUT_DIR}/history.json`, JSON.stringify(history, null, 1) + "\n");

const edgeLine = bidSurplusBps != null ? `${Math.round(bidSurplusBps)}bps` : "n/a";
const callLine = call ? `${call}${resolvedNow ? ` · ${resolvedNow} resolved` : ""}` : "none";
console.log(`[moment-watch] regime=${regimeLabel} steem=${steemUsd ?? "down"} parity=${parity?.toFixed(4) ?? "n/a"} bid-edge=${edgeLine}`);
console.log(`[moment-watch] call=${callLine} · stats ${callStats.resolved} resolved / ${callStats.hitRatePct ?? "–"}% hit`);
console.log(`[moment-watch] insights=${insights.length} sources=${prices.error ? "DEGRADED (coingecko down)" : "ok"}`);
