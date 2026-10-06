// ─────────────────────────────────────────────────────────────────────
// /api/money — מוביל הכסף (R81 · THE MONEY-MOVER).
//
// הוראת המפעיל שיצרה את המערכת: "שנכנס אתמול כסף מה קרה איתו אני רואה
// שסתם הוא יושב מחכה.. גרוע מאוד. אין מצב שעושים תוכנית ואז מחכים למשהו
// תקוע שיזוז. המערכת צריכה להיות דינמית ומבינה בשוק חי ולא לחכות אלא
// לפעול ותמיד לחפש הזדמנויות טובות יותר."
//
// האבחנה שיצרה את R81 (נמדדה חי, 2026-09-22T00:20Z): תשלום הפאוורדאון
// (475.5 STEEM, 19/09) ישב 389.96 STEEM בתוך 3 פקודות מכירה שהוצבו
// לפי פאריטה חיצונית 0.1142 — ולא זזו מאז. השוק הפנימי נסחר 0.096–0.099,
// והפאריטה עצמה זזה ל-0.1189: הפקודות היו תקועות גם כלפי השוק וגם
// מתחת-לפאריטה-החיה. מנוע ה-grid שהציב אותן מת (Actions). R81 הוא
// התשובה: מוביל כסף חי.
//
// הפרדת הסמכויות (דוקטרינת R80, מורחבת לכסף):
//   · המוביל (mini-services/money, פורט 3034) — מחליט מתי. מדיניות
//     קשיחה: גרירת-פאריטה, קירור-30-דקות, תקציב-12-פעולות/יום,
//     פריסת-דלק אוטומטית בנחיתת פאוורדאון.
//   · העורק (ה-POST הזה) — מחליט איך: גוזר את מפתח-ה-active בזיכרון-
//     ההרצה בלבד מה-upload של המפעיל, מאמת ביט-מול-ביט מול הרשות
//     החיה, ואז משדר limit_order_cancel + limit_order_create חתומים.
//     המפתח לעולם לא נכתב, לא נדפס, לא נשמר.
//   · השרשרת (Steem) — השופטת. הספר הפתוח: פקודות, יתרות ומילויים
//     נקראים חסרי-מפתחות מ-api.steemit.com בכל מחזור. אין שום מצב
//     מקומי שהוא מקור-אמת.
//
// חוקי רצפת-הערך (hard-coded, לא המלצות):
//   1. לעולם לא מוצבת פקודת מכירה מתחת לפאריטה החיה (ערך-USD חיצוני
//      של STEEM) — רצפה נאכפת בקוד: אם הפאריטה לא נמדדת חי, הפעולה
//      מסורבת בכנות (אין שער — אין מסחר).
//   2. סולם חמש רמות (r145-a): פאריטה, +1%..+4% מעל למכירה · ‎-1%..-5% מתחת
//      לקנייה — כל ביד שיחצה את הקו ממלא רמה באופן מיידי; השוק עושה את
//      העבודה, הסולם הוא מלכודת-ערך. גרירת-הקו גוררת את שני הצדדים.
//   3. כשהפאריטה זזה >50bps מהסולם שהוצב — הסולם נגרר אליה
//      (cancel+replace). הכסף לעולם לא יושב על מחיר אתמול.
//   4. נחיתת דלק (פאוורדאון שבועי) מוצבת בסולם בתוך מחזור אחד.
//   5. כל פעולה מחזירה קבלה: txid לכל cancel, txid לכל create,
//      מחירים, סכומים — הכול ניתן למדידה-חוזרת מהשרשרת.
//
// מקורות חיים (חסרי-מפתחות): api.steemit.com (חשבון · פקודות · ספר ·
// היסטוריה) · api.binance.com (STEEMUSDT) · api.coingecko.com (SBD,
// עם נפילה-כנה ל-money.json) · apilist.tronscanapi.com (משמרת+פדיון).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { swrGet, cacheHeader, swrInvalidate } from "@/lib/live/swr";
import { operatorFromRequest } from "@/lib/operator-auth";
import { evaluateGate, settleGate } from "@/lib/weave/tx-gate";
import { readOwnerSource } from "@/lib/owner-key"; // r137 · D-026: מקור-מפתח דו-מצבי
import { evaluateBrake, brakeLogLine } from "@/lib/cognition/brake"; // R30: הבלם-הריבוני לפני-כל-שידור (trace 1a10d6f880df9255)

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACCOUNT = "headcorner"; // החותם — הזהות מוכרזת מהמפתח עצמו (R75)
// r137 · D-026: קריאת המפתח עברה לספריית owner-key המשותפת (OWNER_FILE שם)
const HOME = "/home/z/my-project";
const STATE_DIR = `${HOME}/sovereign/money`;
const STATE_FILE = `${STATE_DIR}/state.json`;
const HISTORY_FILE = `${STATE_DIR}/history.json`;

// ── חוזה התשובה (BE↔FE) ──────────────────────────────────────────────

export interface MoneyMark {
  steemUsd: number | null;
  sbdUsd: number | null;
  trxUsd: number | null;
  parity: number | null; // SBD per STEEM
  /** r137: פאריטה מהשוק-הפנימי עצמו (get_order_book mid) — מקור-השרשרת */
  parityInternal: number | null;
  /** r137: מקור-הפאריטה שהופעל בפועל — oracle או chain */
  paritySource: string | null;
  sources: Record<string, string>;
}

export interface BookLevel {
  price: number; // SBD per STEEM
  sbd: number;
  steem: number;
}

// ── r190 · חוק-טווח-הפקודות השמור למנוע-הגריד (חוזה-צי משותף עם mini-services/market-maker) ──
// הטווח [1_000_000_000, 1_500_000_000) שמור בלעדיות למנוע-הגריד; orderid-גריד =
// 1_000_000_000 + ((⌊ts/1000⌋×16 + level×2 + side) mod 500_000_000). orderid של
// money-mover הוא סכמת-יום (למשל 2026100491 ≈ 2.02G) — אין-חפיפה.
// כלל-הברזל: אף ביטול/נגיעה של המוביל בפקודה ש-orderid שלה בתוך הטווח השמור. לעולם.
// (r189-c נמדד חי: cancel-all של המוביל מחק 10 פקודות-גריד חיות מהשרשרת — ההתנגשות שחוק זה סוגר.)
// סכמת-המעבר של r189-v1 (ts×16 mod 2^31−1) יצרה ≈0.74–0.9G — מוגנת-גם-היא בתקופת-המעבר,
// כי פקודות כאלה עשויות-להיות-חיות על השרשרת עד פקיעתן בזמן שהמנוע עובר לטווח השמור.
export const GRID_ORDERID_BAND = { lo: 1_000_000_000, hi: 1_500_000_000 } as const;
export const GRID_ORDERID_LEGACY = { lo: 700_000_000, hi: 900_000_000 } as const;

/** r190 · בדיקת-טווח אחת: האם orderid שייך למנוע-הגריד (טווח-שמור או סכמת-מעבר ישנה) */
export function isGridOrder(orderid: number): boolean {
  const n = Number(orderid);
  if (!Number.isFinite(n)) return false;
  return (
    (n >= GRID_ORDERID_BAND.lo && n < GRID_ORDERID_BAND.hi) ||
    (n >= GRID_ORDERID_LEGACY.lo && n < GRID_ORDERID_LEGACY.hi)
  );
}

export interface OpenAsk {
  orderid: number;
  /** r190 · מקור הפקודה לפי טווח-ה-orderid: "grid" = בטווח השמור למנוע-הגריד (לא נוגעים) · "mover" = של המוביל */
  origin: "grid" | "mover";
  amount: number; // STEEM
  receive: number; // SBD
  price: number; // SBD per STEEM
  created: string;
  expiration: string;
  /** bps מהפאריטה החיה (שלילי = מתחת לרצפה — פקודה מיושנת שהמוביל אמור לגרור) */
  vsParityBps: number | null;
  sbdIfFilled: number;
  usdIfFilled: number | null;
}

// הצעת קנייה פתוחה שלנו — צד ה-SBD של המיקרו-גריד (R97)
export interface OpenBid {
  orderid: number;
  /** r190 · מקור הפקודה לפי טווח-ה-orderid: "grid" = בטווח השמור למנוע-הגריד (לא נוגעים) · "mover" = של המוביל */
  origin: "grid" | "mover";
  sbd: number; // כמה SBD מוצע
  steem: number; // כמה STEEM מתקבל
  price: number; // SBD per STEEM
  created: string;
  expiration: string;
  vsParityBps: number | null;
  usdIfFilled: number | null;
}

export interface FillReceipt {
  at: string;
  side: "sold-steem" | "bought-steem";
  paid: string;
  received: string;
  price: number | null;
}

export interface LadderLevel {
  level: 1 | 2 | 3 | 4 | 5;
  premiumBps: number;
  price: number | null;
}

export interface Opportunity {
  id: string;
  title: string;
  state: "HUNTING" | "ARMED" | "BLOCKED" | "FLOWING";
  detail: string;
  number: string | null;
}

// r147-a — קבועי-הסולם: מקור-אמת אחד לתצוגה ולפעולה (הדיבון money מחזיק תאום-מדוד ב-POLICY שלו).
// מדידה חי 10:23–11:04Z: היסטי-ביד 100..500 ישבו 130+bps מאחורי ראש-הספר — אפס מילויי-קנייה מאז-הרחבת r145
// מול 12 מילויי-מכירה · המכירות נמדדו מתרכזות מעל-פאריטה (66..126bps) — אף מכירה לא נשארת בפאריטה.
export const SELL_PREMIUMS_BPS: number[] = [50, 150, 250, 350, 450];
export const BID_OFFSETS_BPS: number[] = [20, 40, 80, 160, 320];

// r183 — חיווט census→money (D.2: פס-היצרן ללא-עמלות, מוזן מהמדידה):
// סולם-הביד אינו עוד קבוע — הוא נגרר אחר פער-הספר המדוד-חי (census market
// lens, Steem 188.4bps מול Hive 13.9bps נמדדו r179/r183):
//   · פער-מדוד > 320bps → הסולם מתרחב (עומק-ביד שובה-מוכרים-נסחפים);
//   · פער-מדוד < 160bps → הזנב (320) מתקצר — הון-טלה שלא ייפגע יושב
//     מתחת-לפאריטה בחינם.
// נכשל/חסר/מיושן (>6ש') → ברירת-מחדל הקבועה. fail-closed מן-המדידה.
export function bidOffsetsAdaptive(now: number = Date.now()): { offsets: number[]; source: string } {
  try {
    const census = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "sovereign", "revenue", "census.json"), "utf8"),
    ) as { market?: { steem?: { spreadBps?: number; at?: string } } };
    const spreadBps = Number(census?.market?.steem?.spreadBps ?? NaN);
    const measuredAt = Date.parse(String(census?.market?.steem?.at ?? ""));
    if (!Number.isFinite(spreadBps) || spreadBps <= 0) return { offsets: BID_OFFSETS_BPS, source: "default (no spread)" };
    if (!Number.isFinite(measuredAt) || now - measuredAt > 6 * 3600_000) {
      return { offsets: BID_OFFSETS_BPS, source: "default (census stale)" };
    }
    if (spreadBps > 320) {
      const deep = Math.min(640, Math.round((spreadBps * 0.8) / 20) * 20);
      return { offsets: [...BID_OFFSETS_BPS, deep], source: `census:spread ${spreadBps.toFixed(1)}bps → extended` };
    }
    if (spreadBps < 160) {
      return { offsets: BID_OFFSETS_BPS.slice(0, 4), source: `census:spread ${spreadBps.toFixed(1)}bps → tightened` };
    }
    return { offsets: BID_OFFSETS_BPS, source: `census:spread ${spreadBps.toFixed(1)}bps → static band` };
  } catch {
    return { offsets: BID_OFFSETS_BPS, source: "default (census unreadable)" };
  }
}

export interface MoverReceipt {
  at: string;
  kind: "REPRICE" | "DEPLOY" | "FUEL-IN" | "ARM-BUY" | "STOCK-SBD" | "FILL-DEPLOY" | "BID-ONLY";
  reason: string;
  parity: number | null;
  cancelled: Array<{ orderid: number; txid: string | null }>;
  placed: Array<{ orderid: number; sell: number; receive: number; price: number; txid: string | null; confirmedBy?: string }>;
  /** אימות-סוף מהשרשרת — השופט: מה באמת פתוח שם אחרי הפעולה */
  verify?:
    | { ordersNow: number; deployedNow: number; bidsNow?: number }
    | { sbdNow: number; gapClosed: boolean; premiumPaidBps: number | null }
    | null;
  /** r190 · מספר פקודות-הגריד שנראו בספר ולא נגעו בהן (חוק-טווח-הפקודות השמור) */
  gridSkipped?: number;
  error?: string;
}

export interface DaemonState {
  alive: boolean;
  bootedAt: string | null;
  beats: number | null;
  lastDecision: { at: string; kind: string; detail: string } | null;
  lastActionAt: string | null;
  actionsToday: number | null;
  nextEligibleAt: string | null;
  history: MoverReceipt[];
  fetchedVia: "http" | "file" | "down";
}

export interface MoneySense {
  ok: boolean;
  at: string;
  account: string;
  marks: MoneyMark;
  balances: { steem: number | null; sbd: number | null };
  keyPresent?: boolean; // r133 · D-021: בוליאן-נוכחות בלבד, אפס חשיפת-סוד
  book: {
    bids: BookLevel[];
    asks: BookLevel[];
    bestBid: number | null;
    bestAsk: number | null;
    mid: number | null;
    spreadBps: number | null;
  };
  orders: OpenAsk[];
  ourBids: OpenBid[];
  deployedSteem: number;
  idleSteem: number;
  valueFloor: {
    parity: number | null;
    asksBelowParity: number;
    steemBelowParity: number;
    worstBps: number;
    maxDriftLossSbd: number | null;
    maxDriftLossUsd: number | null;
    state: "HELD" | "DRIFT" | "UNMEASURED";
    noteHe: string;
  };
  ladder: LadderLevel[];
  /** r147-a — חשיפת-דלק מכירה: (נזיל + בפקודות) − תביעת-העטיפה (WSTEEM חברים + רזרבות-בריכות). חוק R111: הסולם לא מוכר את הגיבוי */
  fuel: {
    liquidSteem: number;
    inOrdersSteem: number;
    arenaClaimWsteem: number | null;
    totalFuel: number | null;
    state: "SELL-OK" | "SELL-FROZEN" | "UNMEASURED";
    noteHe: string;
  };
  /** r146-d — מדידת-מיצוב: מרחק-הספר-שלנו מהשוק החי (הוכחת-מיצוב לפני/אחרי) */
  positioning: {
    /** הפרש הפאריטה-האורקל מול מרכז-הספר החי (bps) — מקור-המיקום של הסולם */
    oracleVsMidBps: number | null;
    /** רמת-המכירה העליונה שלנו מול הביד החי הטוב ביותר (bps; ≤0 = בתוך-הביד — מילוי-מיידי) */
    topAskVsBestBidBps: number | null;
    /** הביד העליון שלנו מול הביד החי הטוב ביותר (bps) — כמה רחוקים מראש-הספר */
    topBidVsBestBidBps: number | null;
    /** עומק-המכירה שלנו בתוך 100bps מעל הביד החי (STEEM) — הסיכוי-למילוי המיידי */
    askDepthNearBidSteem: number;
    /** סה"כ עומק-מכירה מוצב (STEEM) */
    askDepthTotalSteem: number;
    /** סה"כ עומק-קנייה מוצב (SBD) */
    bidDepthTotalSbd: number;
    noteHe: string;
  };
  powerdown: {
    active: boolean | null;
    weeklySteem: number | null;
    nextPayment: string | null;
    paymentsLeft: number | null;
    totalRemainingSteem: number | null;
  };
  fills: FillReceipt[];
  fillsWindow24h: number;
  sbdArming: { balance: number; needed: number; commitable: number; state: "ARMED" | "WAIT" };
  redemption: {
    outboxTrx: number | null;
    custodyTrx: number | null;
    sendThresholdTrx: number;
    verdict: "WAIT" | "GO" | "UNKNOWN";
    detail: string;
  };
  diagnosis: {
    enteredSteem: number;
    whereItSits: { inOrders: number; liquid: number; sbd: number };
    staleHours: number | null;
    note: string;
  };
  opportunities: Opportunity[];
  daemon: DaemonState;
  doctrine: string[];
  /** נפל רק כשמשהו נפל בפועל — במחזור נקי השדה לא נשלח */
  down?: string[];
  cached: boolean;
  stale: boolean;
  cacheAgeSec: number;
  refreshing: boolean;
}

// ── רשת עם timeout (חסר-מפתחות) ─────────────────────────────────────

async function jget(url: string, timeoutMs = 9000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "the-weave-money-mover/1.0" },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// r137 · פאריטת-השרשרת: השוק-הפנימי של STEEM/SBD עצמו (condenser_api.
// get_order_book) — המקור-הכי-קרוב לשוק שבו הסולם באמת סוחר. מיד = מרכז
// הביד-האסק הטובים. צמתים נפלים-בתור (שיעור r136b: צומת-רפה אינו פסק-דין),
// User-Agent מזוהה (שיעור r136b: rpc.blurt.blog דוחה fetch אנונימי).
async function jpostChain(url: string, body: unknown, timeoutMs = 8000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "the-weave-money-mover/1.0 (sovereign; r137)",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const INTERNAL_MARKET_NODES = ["https://api.steemit.com", "https://api.justyy.com"];

async function internalMarketParity(): Promise<{ mid: number | null; node: string | null }> {
  for (const node of INTERNAL_MARKET_NODES) {
    try {
      const j = await jpostChain(node, { jsonrpc: "2.0", method: "condenser_api.get_order_book", params: [10], id: 1 });
      const bids: Array<{ real_price: string }> = j?.result?.bids ?? [];
      const asks: Array<{ real_price: string }> = j?.result?.asks ?? [];
      if (!bids.length || !asks.length) continue;
      const bestBid = Math.max(...bids.map((b) => parseFloat(b.real_price)).filter((n) => n > 0));
      const bestAsk = Math.min(...asks.map((a) => parseFloat(a.real_price)).filter((n) => n > 0));
      if (!(bestBid > 0) || !(bestAsk > 0) || bestAsk < bestBid) continue;
      const mid = Math.round(((bestBid + bestAsk) / 2) * 1e6) / 1e6;
      if (mid > 0.001 && mid < 1000) return { mid, node: new URL(node).hostname };
    } catch {
      /* הצומת-הבא בתור */
    }
  }
  return { mid: null, node: null };
}

// ── רב-צמתיות (R106): מדידת-הפאריטה היא הרצפה לחוק-1 — צומת בודד שנחנק
// משאיר את הסולם עיוור (נמדד חי 00:53Z: REPRICE-FAIL "הפאריטה לא נמדדה
// חי" למשך מחזור שלם). מעתה כל קריאת-מדידה מנסה את רשימת-הצמתים
// בסדר, עד שאחת עונה. רשימת-הצמתים — מקור אחד לכל המערכת (graphene).
import { STEEM_RPC_NODES } from "@/lib/weave/graphene";

async function steemRpcOnce(node: string, method: string, params: unknown[], timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(node, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`http ${res.status} @ ${node}`);
    const j = await res.json();
    if (j?.error) throw new Error(String(j.error.message ?? "rpc-error") + ` @ ${node}`);
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

async function steemRpc(method: string, params: unknown[]): Promise<any> {
  // סדר הניסיון: הצומת הרשמי ראשון; בכשל — המשך הרשימה. הקבלה כנה:
  // מקור-ההצלחה לא נרשם כטענה אלא נמדד בהנפקת השגיאה בלבד.
  let lastErr: unknown = null;
  for (let i = 0; i < STEEM_RPC_NODES.length; i++) {
    try {
      return await steemRpcOnce(STEEM_RPC_NODES[i], method, params, i === 0 ? 12_000 : 10_000);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all-steem-nodes-down");
}

// ── מדידות חיות ─────────────────────────────────────────────────────

async function steemSide(): Promise<{ a: any; openOrders: any[]; book: any }> {
  const [accts, openOrders, book] = await Promise.all([
    steemRpc("condenser_api.get_accounts", [[ACCOUNT]]),
    steemRpc("condenser_api.get_open_orders", [ACCOUNT]),
    steemRpc("condenser_api.get_order_book", [10]),
  ]);
  const a = accts?.[0];
  if (!a) throw new Error("account-empty");
  return { a, openOrders: openOrders ?? [], book };
}

// r146-d — חוק חלון-האמת (נמדד חי 10:00Z): הסריקה הישנה קראה רק 100 פעולות
// אחרונות — חלון שמכסה ~9.7 שעות בלבד (נמדד: idx 58947..59047 = 00:13→09:45).
// התוצאה: fillsWindow24h=9 מול אמת-שרשרת 23 מילויים ב-24ש' — הדאימון שילם
// תגמולי-עבודה על חלון-חסר והמדידה הרשמית דיווחה נפח-מסחר קטן מהאמת.
// מעתה: דפדוף אחורה עד קו-ה-24ש' בפועל — כל מילוי נספר מהשרשרת עצמה.
// אותו מקור-אמת של ה-FIFO.
const FILL_WINDOW_MS = 24 * 3_600_000;
// r146-d — תקרת-הדפדוף: 12 עמודים × 100 פעולות ≈ 1200 פעולות ≈ 36ש' בקצב-הפעילות
// הנוכחי (נמדד: ~760 פעולות/24ש') — כיסוי מלא של חלון-24ש' כולל מרווח-גידול.
// עלות-עליונה ידועה וחסומה; הלולאה עוצרת בקו-ה-24ש' בפועל.
const FILL_SCAN_MAX_PAGES = 12;

async function fillsSide(): Promise<{ recent: FillReceipt[]; window24h: number }> {
  const dayAgoIso = new Date(Date.now() - FILL_WINDOW_MS).toISOString().slice(0, 19);
  const out: FillReceipt[] = [];
  let start = -1;
  let reachedFloor = false;
  for (let page = 0; page < FILL_SCAN_MAX_PAGES && !reachedFloor; page++) {
    const hist = await steemRpc("condenser_api.get_account_history", [ACCOUNT, start, 100]);
    if (!Array.isArray(hist) || hist.length === 0) break;
    let minIdx = Infinity;
    let oldestTs = "";
    for (const [idx, rec] of hist) {
      minIdx = Math.min(minIdx, idx as number);
      const ts = String(rec?.timestamp ?? "");
      if (!oldestTs || ts < oldestTs) oldestTs = ts;
      const [type, data] = rec.op;
      if (type !== "fill_order") continue;
      const weAreCurrent = data?.current_owner === ACCOUNT;
      const weAreOpen = data?.open_owner === ACCOUNT;
      if (!weAreCurrent && !weAreOpen) continue;
      const paid = weAreCurrent ? String(data.current_pays ?? "") : String(data.open_pays ?? "");
      const received = weAreCurrent ? String(data.open_pays ?? "") : String(data.current_pays ?? "");
      const paidN = parseFloat(paid) || 0;
      const recvN = parseFloat(received) || 0;
      let price: number | null = null;
      if (paid.endsWith("STEEM") && received.endsWith("SBD") && paidN > 0) {
        price = Math.round((recvN / paidN) * 1e6) / 1e6;
      } else if (paid.endsWith("SBD") && received.endsWith("STEEM") && recvN > 0) {
        price = Math.round((paidN / recvN) * 1e6) / 1e6;
      }
      out.push({ at: (rec.timestamp ?? "") + "Z", side: paid.endsWith("SBD") ? "bought-steem" : "sold-steem", paid, received, price });
    }
    if (oldestTs.slice(0, 19) <= dayAgoIso || minIdx <= 1 || hist.length < 100) reachedFloor = true;
    else start = minIdx - 1;
  }
  out.reverse(); // חדשים לפני ישנים
  const window24h = out.filter((f) => new Date(f.at).getTime() >= Date.now() - FILL_WINDOW_MS).length;
  return { recent: out.slice(0, 12), window24h };
}

async function marksSide(): Promise<MoneyMark> {
  const sources: Record<string, string> = {};
  let steemUsd: number | null = null;
  let sbdUsd: number | null = null;
  let trxUsd: number | null = null;
  try {
    const j = await jget("https://api.binance.com/api/v3/ticker/price?symbol=STEEMUSDT", 8000);
    steemUsd = Number(j.price);
    sources.steem = "binance:STEEMUSDT";
  } catch {
    /* נפילה למטה */
  }
  try {
    const j = await jget("https://api.coingecko.com/api/v3/simple/price?ids=steem-dollars,tron&vs_currencies=usd", 9000);
    if (typeof j?.["steem-dollars"]?.usd === "number") {
      sbdUsd = j["steem-dollars"].usd;
      sources.sbd = "coingecko:steem-dollars";
    }
    if (typeof j?.tron?.usd === "number") {
      trxUsd = j.tron.usd;
      sources.trx = "coingecko:tron";
    }
  } catch {
    /* נפילה למטה */
  }
  if (sbdUsd == null || trxUsd == null) {
    // נפילה-כנה: money.json של הקונסולה (צופה נתיב-הכסף)
    try {
      const m = await jget("https://roshpinacare-sys.github.io/Console/dex/money.json", 8000);
      if (sbdUsd == null && typeof m?.marks?.sbdUsd === "number") {
        sbdUsd = m.marks.sbdUsd;
        sources.sbd = `console:money.json@${String(m.publishedAt ?? "?").slice(0, 16)}Z`;
      }
      if (trxUsd == null && typeof m?.marks?.trxUsd === "number") {
        trxUsd = m.marks.trxUsd;
        sources.trx = `console:money.json@${String(m.publishedAt ?? "?").slice(0, 16)}Z`;
      }
    } catch {
      /* בלי שער */
    }
  }
  let parity = steemUsd != null && sbdUsd != null && sbdUsd > 0 ? steemUsd / sbdUsd : null;
  let paritySource: string | null = parity != null ? "oracle:steemUsd/sbdUsd" : null;
  // r137 · פאריטת-השוק-הפנימי: נמדדת תמיד (שקיפות), וכשאין סימון-חוץ ל-SBD
  // היא הקו — כך הסולם, רצפת-הערך והמוביל לא נשארים עיוורים בכנות.
  const internal = await internalMarketParity();
  const parityInternal = internal.mid;
  if (parity == null && parityInternal != null) {
    parity = parityInternal;
    paritySource = `chain:internal-market-mid@${internal.node}`;
    if (steemUsd != null) {
      sbdUsd = Math.round((steemUsd / parityInternal) * 1e6) / 1e6;
      sources.sbd = "implied:steemUsd/parityInternal";
    }
  }
  if (parity != null) parity = Math.round(parity * 1e6) / 1e6;
  return { steemUsd, sbdUsd, trxUsd, parity, parityInternal, paritySource, sources };
}

async function tronSide(): Promise<{ outbox: number | null; custody: number | null }> {
  const out = { outbox: null as number | null, custody: null as number | null };
  const addrs: Array<[keyof typeof out, string]> = [
    ["outbox", "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn"],
    ["custody", "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy"],
  ];
  for (const [k, address] of addrs) {
    try {
      const j = await jget(`https://apilist.tronscanapi.com/api/account?address=${address}`, 8000);
      out[k] = Number(j?.balance ?? 0) / 1e6;
    } catch {
      /* down בכנות */
    }
  }
  return out;
}

// ── מצב המוביל (הדיבון) — קריאה כנה ─────────────────────────────────

function readHistory(): MoverReceipt[] {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as MoverReceipt[];
  } catch {
    return [];
  }
}

async function daemonSide(): Promise<DaemonState> {
  // א. HTTP חי (2.5 שנ׳) — אם המוביל למעלה
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch("http://localhost:3034/", { signal: ctrl.signal, cache: "no-store" });
      if (res.ok) {
        const j: any = await res.json();
        return {
          alive: true,
          bootedAt: j.bootedAt ?? null,
          beats: j.beats ?? null,
          lastDecision: j.lastDecision ?? null,
          lastActionAt: j.lastActionAt ?? null,
          actionsToday: j.actionsToday ?? null,
          nextEligibleAt: j.nextEligibleAt ?? null,
          history: Array.isArray(j.history) ? j.history : [],
          fetchedVia: "http",
        };
      }
    } finally {
      clearTimeout(t);
    }
  } catch {
    /* נפילה לקובץ */
  }
  // ב. הקובץ — המוביל כותב state.json בכל פעימה
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      alive: false,
      bootedAt: j.bootedAt ?? null,
      beats: j.beats ?? null,
      lastDecision: j.lastDecision ?? null,
      lastActionAt: j.lastActionAt ?? null,
      actionsToday: j.actionsToday ?? null,
      nextEligibleAt: j.nextEligibleAt ?? null,
      history: readHistory().slice(-10).reverse(),
      fetchedVia: "file",
    };
  } catch {
    return {
      alive: false,
      bootedAt: null,
      beats: null,
      lastDecision: null,
      lastActionAt: null,
      actionsToday: null,
      nextEligibleAt: null,
      history: [],
      fetchedVia: "down",
    };
  }
}

// ── הרכבת ה-sense ────────────────────────────────────────────────────

const SWR_KEY = "money:sense";
const SWR_TTL_MS = 45_000;

export async function GET() {
  const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, sense);
  return NextResponse.json(
    { ...value, cached: meta.cached, stale: meta.stale, cacheAgeSec: meta.cacheAgeSec, refreshing: meta.refreshing },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}

// sense מייצר את גוף ההמתנה בלבד — את שדות המטמון (cached/stale/…)
// מוסיף ה-GET מעל התוצאה; לכן ההבטחה כאן היא ה-Omit המדויק.
async function sense(): Promise<Omit<MoneySense, "cached" | "stale" | "cacheAgeSec" | "refreshing">> {
  const down: string[] = [];

  const [steemRes, fillsInfo, marks, tron, daemon] = await Promise.all([
    steemSide().catch((e) => {
      down.push(`steem: ${String(e.message).slice(0, 50)}`);
      return null;
    }),
    fillsSide().catch((e) => {
      down.push(`fills: ${String(e.message).slice(0, 50)}`);
      return { recent: [] as FillReceipt[], window24h: 0 };
    }),
    marksSide().catch((e) => {
      down.push(`marks: ${String(e.message).slice(0, 50)}`);
      return null;
    }),
    tronSide().catch((e) => {
      down.push(`tron: ${String(e.message).slice(0, 50)}`);
      return { outbox: null as number | null, custody: null as number | null };
    }),
    daemonSide(),
  ]);

  const parity = marks?.parity ?? null;
  const a = steemRes?.a;
  const balances = {
    steem: a ? parseFloat(a.balance) : null,
    sbd: a ? parseFloat(a.sbd_balance) : null,
  };

  // פקודות פתוחות שלנו — הפרדת צדדים (R97): base=STEEM → מכירה; base=SBD → קנייה.
  // עד R97 היו רק מכירות; מעתה סולם-הקנייה חי — ולכן כל מנה נספרת בנכס שלה.
  // r190 · תצוגה מלאה וכנה: כל הפקודות בחשבון נשארות כאן, וכל אחת נושאת origin
  // ("grid" = בטווח-ה-orderid השמור למנוע-הגריד · "mover" = של המוביל). הניהול
  // (ביטולים/חישובי-דלק ב-POST) רואה רק את של המוביל — התצוגה רואה הכול.
  const allOpen = (steemRes?.openOrders ?? []) as any[];
  const sellOpen = allOpen.filter((o) => String(o.sell_price?.base ?? "").trim().endsWith("STEEM"));
  const bidOpen = allOpen.filter((o) => String(o.sell_price?.base ?? "").trim().endsWith("SBD"));
  const orders: OpenAsk[] = sellOpen.map((o: any) => {
    const amount = Number(o.for_sale) / 1000;
    const baseN = parseFloat(String(o.sell_price?.base ?? "")) || 0;
    const quoteN = parseFloat(String(o.sell_price?.quote ?? "")) || 0;
    const price = baseN > 0 ? quoteN / baseN : 0;
    const receive = Math.round(amount * price * 1000) / 1000;
    return {
      orderid: o.orderid,
      origin: isGridOrder(o.orderid) ? ("grid" as const) : ("mover" as const),
      amount,
      receive,
      price: Math.round(price * 1e6) / 1e6,
      created: String(o.created ?? ""),
      expiration: String(o.expiration ?? ""),
      vsParityBps: parity != null && price > 0 ? Math.round((price / parity - 1) * 10_000) : null,
      sbdIfFilled: receive,
      usdIfFilled: marks?.sbdUsd != null ? Math.round(receive * marks.sbdUsd * 1000) / 1000 : null,
    };
  });
  // הצעות הקנייה שלנו — מוצגות בנפרד מסולם המכירה (R97)
  const ourBids: OpenBid[] = bidOpen.map((o: any) => {
    const bidBaseN = parseFloat(String(o.sell_price?.base ?? "")) || 0; // SBD שאנחנו מציעים
    const bidQuoteN = parseFloat(String(o.sell_price?.quote ?? "")) || 0; // STEEM שנקבל
    const bidPrice = bidQuoteN > 0 ? bidBaseN / bidQuoteN : 0; // SBD per STEEM
    return {
      orderid: o.orderid,
      origin: isGridOrder(o.orderid) ? ("grid" as const) : ("mover" as const),
      sbd: Math.round(bidBaseN * 1000) / 1000,
      steem: Math.round(bidQuoteN * 1000) / 1000,
      price: Math.round(bidPrice * 1e6) / 1e6,
      created: String(o.created ?? ""),
      expiration: String(o.expiration ?? ""),
      vsParityBps: parity != null && bidPrice > 0 ? Math.round((bidPrice / parity - 1) * 10_000) : null,
      usdIfFilled: marks?.sbdUsd != null ? Math.round(bidBaseN * marks.sbdUsd * 1000) / 1000 : null,
    };
  });

  const deployedSteem = Math.round(orders.reduce((s, o) => s + o.amount, 0) * 1000) / 1000;
  const idleSteem = balances.steem != null ? Math.round(balances.steem * 1000) / 1000 : 0;

  // r134 · רצפת-הערך — צבירת-אמת של דריפת-הרצפה: פקודות-מכירה שלנו שנשארו
  // מתחת לפאריטה החיצוני אחרי שהפאריטה זז (החוק נאכף בעת-הצבה; בלי מפתח
  // הגרירה מושהית-בכנות — LANE-BLOCKED D-021 — והחשיפה נמדדת ומוצגת).
  const belowParity = orders.filter((o) => o.vsParityBps != null && o.vsParityBps < 0);
  const maxDriftLossSbd =
    parity != null
      ? Math.round(belowParity.reduce((s, o) => s + o.amount * (parity - o.price), 0) * 10_000) / 10_000
      : null;
  // r141 · אמת-חיה: נוסחת-הדריפה מותנית בנוכחות-מפתח בפועל — כשהמפתח חי
  // הטענה "יאכף כשהמפתח יחזור" היתה מיושנת (המפתח חזר); הגרירה כעת מסלול-פעולה
  // של המוביל במסגרת הקצבה, לא המתנה ל-X-1.
  const houseKeyPresent = readOwnerKey() != null;
  const valueFloor = {
    parity: parity != null ? Math.round(parity * 1e6) / 1e6 : null,
    asksBelowParity: belowParity.length,
    steemBelowParity: Math.round(belowParity.reduce((s, o) => s + o.amount, 0) * 1000) / 1000,
    worstBps: belowParity.length > 0 ? Math.min(...belowParity.map((o) => o.vsParityBps as number)) : 0,
    maxDriftLossSbd,
    maxDriftLossUsd: maxDriftLossSbd != null && marks?.sbdUsd != null ? Math.round(maxDriftLossSbd * marks.sbdUsd * 10_000) / 10_000 : null,
    state: parity == null ? ("UNMEASURED" as const) : belowParity.length > 0 ? ("DRIFT" as const) : ("HELD" as const),
    noteHe:
      parity == null
        ? "אין פאריטה חיה — רצפת-הערך לא נמדדת כרגע (כנות, לא הנחה)"
        : belowParity.length > 0
          ? houseKeyPresent
            ? `דריפת-רצפה: ${belowParity.length} פקודות נשארו מתחת לפאריטה החיצוני אחרי שהוא זז — המפתח חי בבית והמוביל גורר את הסולם בחזרה בהזדמנות-הפעולה הבאה (קצבת-פעולות · L4); החשיפה נמדדת כאן בינתיים`
            : `דריפת-רצפה: ${belowParity.length} פקודות נשארו מתחת לפאריטה החיצוני אחרי שהוא זז — החוק ייאכף בגרירת-הסולם בחזרת-מפתח (X-1); עד אז החשיפה מדודה כאן`
          : "הרצפה מוחזקת: אף פקודת-מכירה שלנו לא מתחת לערך-החוץ",
  };

  // ספר הפקודות
  const bids: BookLevel[] = (steemRes?.book?.bids ?? []).map((b: any) => ({
    price: Number(b.real_price),
    sbd: Number(b.sbd) / 1000,
    steem: Number(b.steem) / 1000,
  }));
  const asks: BookLevel[] = (steemRes?.book?.asks ?? []).map((x: any) => ({
    price: Number(x.real_price),
    sbd: Number(x.sbd) / 1000,
    steem: Number(x.steem) / 1000,
  }));
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  const spreadBps =
    bestBid != null && bestAsk != null && bestBid > 0 ? Math.round(((bestAsk - bestBid) / bestBid) * 10_000) : null;

  // פאוורדאון — מדידה חיה מלאה (חשבון + props גלובליים)
  const powerdown = {
    active: null as boolean | null,
    weeklySteem: null as number | null,
    nextPayment: null as string | null,
    paymentsLeft: null as number | null,
    totalRemainingSteem: null as number | null,
  };
  if (a) {
    const rate = parseFloat(a.vesting_withdraw_rate ?? "0");
    const toWithdraw = Number(a.to_withdraw ?? 0) / 1e6;
    const next = a.next_vesting_withdrawal ? a.next_vesting_withdrawal + "Z" : null;
    powerdown.active = toWithdraw > 0 && next != null && new Date(next).getTime() > Date.now();
    powerdown.nextPayment = next;
    try {
      const g = await steemRpc("condenser_api.get_dynamic_global_properties", []);
      const fund = parseFloat(g.total_vesting_fund_steem);
      const shares = parseFloat(g.total_vesting_shares);
      const perVest = shares > 0 ? fund / shares : 0;
      powerdown.weeklySteem = Math.round(rate * perVest * 1000) / 1000;
      // r207 · תיקון-חיישן (ממצא r207-b, מדיד מהשרשרת 17:44Z): to_withdraw הוא הסכום-הכולל
      // ולא הנותר — הנוסחה הקודמת לא החסירה withdrawn וספרה 3 תשלומים שכבר בוצעו
      // (1,427.83 SP) שוב ⇒ «4 תשלומים / 1,903.77 SP» במקום האמת «1 / 475.94 SP».
      // יתרת-אמת = to_withdraw − withdrawn (אין-פגיעה בסמכות — חיישן בלבד).
      const withdrawn = Number(a.withdrawn ?? 0) / 1e6;
      const remainingVests = Math.max(0, toWithdraw - withdrawn);
      powerdown.paymentsLeft = rate > 0 ? Math.min(13, Math.ceil(remainingVests / rate)) : 0;
      powerdown.totalRemainingSteem = Math.round(remainingVests * perVest * 1000) / 1000;
    } catch {
      down.push("vesting-props: down");
    }
  }

  // חימוש SBD — צד הקנייה של הגריד
  const sbdArming = {
    balance: balances.sbd ?? 0,
    needed: 0.15,
    commitable: Math.round((balances.sbd ?? 0) * 0.9 * 1000) / 1000,
    state: (balances.sbd ?? 0) * 0.9 >= 0.15 ? ("ARMED" as const) : ("WAIT" as const),
  };

  // פדיון TRON
  const redemption = {
    outboxTrx: tron.outbox,
    custodyTrx: tron.custody,
    sendThresholdTrx: 1.05,
    verdict: ((): "WAIT" | "GO" | "UNKNOWN" => {
      if (tron.outbox == null) return "UNKNOWN";
      return tron.outbox >= 1.05 ? "GO" : "WAIT";
    })(),
    detail:
      tron.outbox == null
        ? "trongrid לא ענה — נמדד בכנות כלא-ידוע"
        : tron.outbox >= 1.05
          ? `הסף עבר (${tron.outbox.toFixed(6)} TRX ≥ 1.05) — שער השידור פתוח`
          : `ממתין: ${tron.outbox.toFixed(3)} TRX מתוך 1.05 TRX (חסר ${(1.05 - tron.outbox).toFixed(3)})`,
  };

  // אבחנת הכסף שנכנס — התשובה לשאלת המפעיל
  const oldestOrder = orders.reduce<string | null>(
    (oldest, o) => (!oldest || o.created < oldest ? o.created : oldest),
    null,
  );
  const staleHours =
    oldestOrder != null ? Math.round((Date.now() - new Date(oldestOrder + "Z").getTime()) / 3_600_000) : null;
  const diagnosis = {
    enteredSteem: Math.round((deployedSteem + idleSteem) * 1000) / 1000,
    whereItSits: { inOrders: deployedSteem, liquid: idleSteem, sbd: balances.sbd ?? 0 },
    staleHours,
    note:
      orders.length === 0 && idleSteem > 1
        ? "כל הדלק נזיל — הסולם ריק; המוביל אמור להציב אותו במחזור הקרוב"
        : orders.length > 0 && idleSteem > 1
          ? `הסולם פועל אך ${idleSteem.toFixed(3)} STEEM נזילים ממתינים לפריסה`
          : orders.length > 0
            ? `הדלק פרוס בסולם · גיל הפקודה הוותיקה ${staleHours ?? "?"} שעות`
            : "אין פקודות פתוחות",
  };

  // הזדמנויות חיות — ציד מתמשך, לא המתנה סבילה
  const opportunities: Opportunity[] = [];
  if (parity != null && bestBid != null) {
    const distBps = Math.round((parity / bestBid - 1) * 10_000);
    opportunities.push({
      id: "ladder-fill",
      title: "מלכודת הפאריטה — הסולם ממתין בקו",
      state: distBps <= 0 ? "FLOWING" : distBps <= 300 ? "ARMED" : "HUNTING",
      detail:
        distBps <= 0
          ? `הביד חצה את הפאריטה — רמה-1 מתמלאת עכשיו (${bestBid.toFixed(4)} ≥ ${parity.toFixed(4)})`
          : `הביד החי ${bestBid.toFixed(4)} רחוק ${distBps}bps מהקו (${parity.toFixed(4)}). הסולם צד: הוא אינו זז מהקו — השוק חייב לשלם ערך-חוץ כדי לגעת בכסף. כל ביד שיחצה נתפס מיד`,
      number: `${distBps}bps`,
    });
  }
  opportunities.push({
    id: "sbd-arming",
    title: "חימוש צד-הקנייה (SBD)",
    state: sbdArming.state === "ARMED" ? "ARMED" : "BLOCKED",
    detail:
      sbdArming.state === "ARMED"
        ? "מלאי ה-SBD חמוש — סולם הקנייה מתחת לפאריטה יוצב במילוי הבא"
        : "מילוי הסולם יזרים SBD; כשהקופה תעבור 0.15 — צד-הקנייה מתחת-לפאריטה יחומש (כל קנייה מתחת לקו = עודף נמדד). השער הזה נפתח רק ממילוי אמיתי — לא ממכירה מתחת לערך",
    number: `${sbdArming.commitable.toFixed(3)}/${sbdArming.needed}`,
  });
  if (powerdown.nextPayment) {
    const hours = Math.max(0, Math.round((new Date(powerdown.nextPayment).getTime() - Date.now()) / 3_600_000));
    opportunities.push({
      id: "fuel-in",
      title: "נחיתת דלק הבאה (פאוורדאון)",
      state: hours <= 2 ? "ARMED" : "HUNTING",
      detail: `תשלום של ~${powerdown.weeklySteem ?? "?"} STEEM צפוי ב-${powerdown.nextPayment.slice(0, 16).replace("T", " ")}Z — המוביל פורש אותו בסולם בתוך מחזור אחד מהנחיתה (חוק 4)`,
      number: `${hours}ש׳`,
    });
  }
  opportunities.push({
    id: "tron-redemption",
    title: "שער הפדיון (TRON)",
    state: redemption.verdict === "GO" ? "FLOWING" : "BLOCKED",
    detail: redemption.detail + " · המשמרת מגבהת את ה-WTRX ואינה נגעת",
    number: redemption.outboxTrx != null ? `${redemption.outboxTrx.toFixed(3)}/1.05 TRX` : null,
  });
  if (spreadBps != null) {
    opportunities.push({
      id: "spread",
      title: "רוחב השוק הפנימי",
      state: spreadBps <= 150 ? "ARMED" : "HUNTING",
      detail: `ביד ${bestBid?.toFixed(4)} / אסק ${bestAsk?.toFixed(4)} — ספרד ${spreadBps}bps. ספרד צר מגדיל סיכוי שביד יחצה את הקו`,
      number: `${spreadBps}bps`,
    });
  }

  // r146-d — מדידת-מיצוב (מרחק-הספר-שלנו מהשוק החי): הסולם ממוקם מהפאריטה-האורקל;
  // המדידה הזו מוכיחה אם הוא באמת במקום שבו הביקוש עומד. בלי זו, "הסולם מוצב" היתה
  // טענה בלי מספר-מרחק (חוק הראיה — גם למיצוב).
  const asksTotal = Math.round(orders.reduce((s, o) => s + o.amount, 0) * 1000) / 1000;
  const bidsTotal = Math.round(ourBids.reduce((s, b) => s + b.sbd, 0) * 1000) / 1000;
  const topAskPrice = orders.length > 0 ? Math.min(...orders.map((o) => o.price)) : null;
  const topBidPrice = ourBids.length > 0 ? Math.max(...ourBids.map((b) => b.price)) : null;
  const bps = (a: number, b: number) => Math.round((a / b - 1) * 10_000);
  const positioning = {
    oracleVsMidBps: parity != null && mid != null && mid > 0 ? bps(parity, mid) : null,
    topAskVsBestBidBps: topAskPrice != null && bestBid != null && bestBid > 0 ? bps(topAskPrice, bestBid) : null,
    topBidVsBestBidBps: topBidPrice != null && bestBid != null && bestBid > 0 ? bps(topBidPrice, bestBid) : null,
    askDepthNearBidSteem:
      topAskPrice != null && bestBid != null && bestBid > 0
        ? Math.round(orders.filter((o) => o.price <= bestBid * 1.01).reduce((s, o) => s + o.amount, 0) * 1000) / 1000
        : 0,
    askDepthTotalSteem: asksTotal,
    bidDepthTotalSbd: bidsTotal,
    noteHe:
      orders.length === 0
        ? `צד-המכירה ריק — אפס הסתברות-מילוי בחלון זה${idleSteem > 1 ? ` · ${idleSteem.toFixed(3)} STEEM נזילים מחוץ-לסולם` : ""}`
        : topAskPrice != null && bestBid != null && topAskPrice <= bestBid
          ? "רמת-המכירה העליונה בתוך-הביד — מילוי-מיידי צפוי"
          : topAskPrice != null && bestBid != null
            ? `רמת-המכירה העליונה ${bps(topAskPrice, bestBid)}bps מעל הביד החי — נדרשת תנועת-שוק`
            : "מיצוב לא נמדד",
  };

  const ladder: LadderLevel[] = SELL_PREMIUMS_BPS.map((premiumBps, i) => ({
    level: (i + 1) as 1 | 2 | 3 | 4 | 5,
    premiumBps,
    price: parity != null ? Math.round(parity * (1 + premiumBps / 10_000) * 1e6) / 1e6 : null,
  }));

  // r147-a — חשיפת-דלק (אותו חישוב של ה-POST · R111): דלק צד-המכירה =
  // (נזיל + בפקודות-מכירה) − תביעת-העטיפה (WSTEEM של חברים + רזרבות בריכות).
  // כשהתביעה שווה/גדולה מההון — הסולם יושב על דלק-אפס בכנות, וזו הראיה.
  const fuel = await (async (): Promise<MoneySense["fuel"]> => {
    const liquidHere = idleSteem;
    const inOrdersHere = deployedSteem;
    let claim: number | null = null;
    try {
      const { db } = await import("@/lib/db");
      const accts = await db.exchangeAccount.findMany();
      let c = 0;
      for (const acc of accts) {
        try {
          const bal = JSON.parse(acc.balances ?? "{}") as Record<string, unknown>;
          c += Number(bal.WSTEEM ?? 0) || 0;
        } catch { /* ספר ישן */ }
      }
      const pools = await db.exchangePool.findMany({ where: { assetA: "WSTEEM" } });
      for (const pool of pools) c += Number(pool.reserveA) || 0;
      claim = Math.max(0, Math.round(c * 1000) / 1000);
    } catch {
      claim = null; // r124 — ספר שלא נקרא אינו אפס
    }
    const raw = Math.round((liquidHere + inOrdersHere) * 1000) / 1000;
    const total = claim != null ? Math.round(Math.max(0, raw - claim) * 1000) / 1000 : null;
    const state: MoneySense["fuel"]["state"] =
      total == null ? "UNMEASURED" : total >= 0.004 ? "SELL-OK" : "SELL-FROZEN";
    return {
      liquidSteem: liquidHere,
      inOrdersSteem: inOrdersHere,
      arenaClaimWsteem: claim,
      totalFuel: total,
      state,
      noteHe:
        state === "SELL-FROZEN"
          ? `דלק-מכירה אפס: הון חי ${raw.toFixed(3)} STEEM מאחוריו תביעת-עטיפה ${claim?.toFixed(3)} WSTEEM (חוק R111: הסולם לא מוכר את הגיבוי) — צד-הקנייה ממשיך לעבוד והצד הזה ממתין לדלק חדש`
          : state === "SELL-OK"
            ? `דלק-מכירה חי: ${total?.toFixed(3)} STEEM מעל תביעת-העטיפה (${claim?.toFixed(3)} WSTEEM)`
            : "ספר-הזירה לא נקרא — הדלק לא נמדד (כנות)",
    };
  })();

  return {
    ok: down.length === 0,
    at: new Date().toISOString(),
    account: ACCOUNT,
    marks: {
      steemUsd: marks?.steemUsd ?? null,
      sbdUsd: marks?.sbdUsd ?? null,
      trxUsd: marks?.trxUsd ?? null,
      parity,
      parityInternal: marks?.parityInternal ?? null,
      paritySource: marks?.paritySource ?? null,
      sources: marks?.sources ?? {},
    },
    balances,
    // r133 · D-021: נוכחות-מפתח כבוליאני בלבד (בלי שום חשיפת-סוד) —
    // מאפשר למוביל-הסנדבוקס להבחין LANE-BLOCKED מול כישלון-אמת
    keyPresent: readOwnerKey() != null,
    book: { bids, asks, bestBid, bestAsk, mid, spreadBps },
    orders,
    ourBids,
    deployedSteem,
    idleSteem,
    valueFloor,
    ladder,
    fuel,
    positioning,
    powerdown,
    fills: fillsInfo.recent,
    fillsWindow24h: fillsInfo.window24h,
    sbdArming,
    redemption,
    diagnosis,
    opportunities,
    daemon,
    doctrine: [
      "רצפת-פאריטה קשיחה: שום מכירה מתחת לערך-ה-USD החיצוני של STEEM — נאכפת בקוד; בלי שער חי אין פעולה (סירוב-כנה).",
      "הסולם צד את השוק, לא להפך: חמש רמות על קו הפאריטה ומעליו למכירה וחמש מתחתיו לקנייה (r145-a); השוק משלם את הערך החיצוני או שהכסף נשאר שלנו.",
      "דינמיות = מעקב, לא המתנה: הפאריטה נמדדת כל מחזור; זזה >50bps — הסולם נגרר אליה; נחיתת דלק — מוצבת בתוך דקה.",
      "כל פעולה עם קבלה: txid לכל cancel ולכל create; הספר הפתוח של השרשרת הוא השופט.",
      "המפתח בזיכרון-ההרצה בלבד, מאומת ביט-מול-ביט מול הרשות החיה — ואף פעם לא נכתב.",
      "שער-העסקאות (R97): אוטונומיה מלאה מתחת ל-$100 — מעליו, שום פעולה לא רצה בלי אישור המפעיל; ה-USD נמדד חי בזמן ההחלטה.",
    ],
    down: down.length ? down : undefined,
  };
}

// ── POST — העורק: reprice אוטונומי ──────────────────────────────────

function bad(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function readOwnerKey(): { account: string; password: string; wif?: string } | null {
  // r137 · D-026: מקור-המפתח הדו-מצבי — מצב-אב (הדפוס המוכח) או מצב-wif
  // (ה-active שהמפעיל הדביק בדלת-ההפעלה). במצב-wif החתימה ישירה וה
  // אימות ביט-מול-ביט מול הרשות החיה נשאר כפי שהוא (חוק R75).
  const src = readOwnerSource();
  if (!src) return null;
  if (src.mode === "master" && src.master) return { account: src.account, password: src.master };
  if (src.mode === "wif" && src.activeWif) return { account: src.account, password: "", wif: src.activeWif };
  return null;
}

// r125a · חוק הראיה: הקבלה החיה היא השרשרת — כשל כתיבה אינו מפיל פעולת-
// שרשרת שכבר בוצעה (הקבלה היא ראיה, לא הפעולה). אבל הוא גם לא נבלע:
// התוצאה חוזרת לקורא ומתועדת בתשובה (receiptPersisted:false) — אובדן-
// הראיה מתועד בגלוי, הפעולה האמיתית מדווחת אמת.
function appendReceipt(receipt: MoverReceipt): boolean {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const history = readHistory();
    // עדכון-במקום: persist נקודתי אחרי כל פעולה אסור שייצור כפילויות —
    // קבלה חיה אחת לכל פעולה, עם מזהה הריצה (at). קריאה חוזרת על אותה
    // קבלה מעדכנת את השורה האחרונה במקום לדחוף חדשה.
    const lastIdx = history.length - 1;
    if (lastIdx >= 0 && history[lastIdx].at === receipt.at) {
      history[lastIdx] = receipt;
    } else {
      history.push(receipt);
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-200), null, 2) + "\n");
    let state: any = {};
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
      /* קובץ חדש */
    }
    state.lastReceipt = receipt;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

const ceil3 = (x: number) => Math.ceil(x * 1000) / 1000;

// R101c - single-flight per process (same law as the HIVE leg).
let steemMoneyInFlight = false;

export async function POST(req: Request) {
  if (steemMoneyInFlight) {
    return bad("another money action is executing - single-flight per process", 409, { code: "IN-FLIGHT" });
  }
  steemMoneyInFlight = true;
  try {
    return await POST_core(req);
  } finally {
    steemMoneyInFlight = false;
  }
}

async function POST_core(req: Request) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return bad("גוף הבקשה אינו JSON");
  }
  // R97: reprice (סולם המכירה) · arm-buy (סולם הקנייה) · stock-sbd (R101: מילוי מלאי חימוש)
  const action =
    payload?.action === "arm-buy"
      ? "arm-buy"
      : payload?.action === "reprice"
        ? "reprice"
        : payload?.action === "stock-sbd"
          ? "stock-sbd"
          : null;
  if (!action) {
    return bad("פעולה לא מוכרת — נתמכות: reprice · arm-buy · stock-sbd");
  }
  const reason = typeof payload.reason === "string" ? payload.reason.slice(0, 200) : "manual";
  // r206 — הדיון נוסע עם הפעולה: במצב THINKING השער מחייב deliberation מלא
  // (claim/why/expected/risk/rollback ≥8 תווים — אותו חוזה כמו validDeliberation).
  // נמדד חי: בלי זה 14/14 פעולות-דיבון נסרבו NO-DELIBERATION ויוחסו בשקר "usd מת".
  const deliberationBody = payload?.deliberation && typeof payload.deliberation === "object"
    ? ("claim why expected risk rollback falsifier".split(" ").reduce((acc, k) => {
        const v = (payload.deliberation as Record<string, unknown>)[k];
        if (typeof v === "string" && v.trim().length >= 8) acc[k] = v.slice(0, 400);
        return acc;
      }, {} as Record<string, string>))
    : {};
  const deliberationOk = ["claim", "why", "expected", "risk", "rollback"].every((k) => typeof deliberationBody[k] === "string");
  // r146-d — תג-מקור לקבלה: הדאימון מדווח FILL-DEPLOY כשההצבה נולדה ממילוי
  // אמיתי (fill_order) ולא מטריגר-זמן — הפרדת-סוגים בספר-הקבלות, אפס קוד-נוסף
  // במסלול-הביצוע (אותו reprice, אותם חוקים, רק תג-ראיה שונה).
  const triggerTag = payload?.tag === "fill-deploy" ? "FILL-DEPLOY" : null;

  // המפתח: בזיכרון-ההרצה בלבד
  const ownerKey = readOwnerKey();
  if (!ownerKey) {
    return bad("מפתח-האב אינו בסנדבוקס — העורק חסום בכנות. העלה את הסיסמה (upload) או הפעל מהענן.", 409, { code: "NO-KEY" });
  }

  const nodeRequire = createRequire(path.join(HOME, "package.json"));
  const steem = nodeRequire("steem");
  steem.api.setOptions({ url: "https://api.steemit.com" });

  // תיקון R94 (נתפס חי ב-dev.log כ-unhandledRejection ×6): steem-js מחזיר
  // promise פנימי גם במצב-callback — דחייתו (אותה שגיאת-RPC שכבר מטופלת
  // ב-callback שלנו) נותרת ללא מטפל ומפיצה unhandledRejection. ה-callback
  // הוא מקור-האמת — מה שמוחזר מהקריאה נבלע במפורש.
  const quiet = (ret: unknown): void => {
    if (ret && typeof (ret as { catch?: unknown }).catch === "function") {
      (ret as Promise<unknown>).catch(() => {});
    }
  };

  // מדידה חיה טרייה — לא מהמטמון: הפעולה מחליטה על סולם עכשיו
  const [accts, openOrders, marks] = await Promise.all([
    new Promise<any[]>((resolve, reject) =>
      quiet(
        steem.api.getAccounts([ownerKey.account], (err: Error | null, res: any[]) =>
          err || !res?.length ? reject(err ?? new Error("empty")) : resolve(res),
        ),
      ),
    ),
    new Promise<any[]>((resolve, reject) =>
      quiet(
        steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
          err ? reject(err) : resolve(res ?? []),
        ),
      ),
    ),
    marksSide(),
  ]).catch((e) => {
    throw Object.assign(new Error(`מדידה חיה נכשלה: ${String(e.message).slice(0, 120)}`), { statusCode: 502 });
  });

  // דוקטרינת R75: המפתח מכריז את החותם — אימות ביט-מול-ביט לפני כל שידור
  // r137 · D-026: מצב-wif → חתימה ישירה; מצב-אב → גזירה כמקודם.
  const wif = ownerKey.wif ?? steem.auth.toWif(ownerKey.account, ownerKey.password, "active");
  const liveActive = accts?.[0]?.active?.key_auths?.[0]?.[0];
  const derivedPub = steem.auth.wifToPublic(wif);
  if (!liveActive || derivedPub !== liveActive) {
    return bad("המפתח שנגזר אינו תואם את רשות-ה-active החיה — שום דבר לא שודר. זו סירוב-כנה.", 409, { code: "KEY-MISMATCH" });
  }

  // R30 (trace 1a10d6f880df9255) — הבלם-הריבוני בשפת-החתימה: לפני-כל-שידור.
  // STASIS + lane-guards (מה-cognition-beat, close-only) — fail-closed. אפס-סודות.
  const brake = evaluateBrake("money-mover");
  console.log(brakeLogLine(brake));
  if (brake.halt) {
    return bad(
      `הבלם-הריבוני עצר את נתיב-החתימה לפני השידור (STASIS/lane-guards) — אפס פעולות. זו סירוב-כנה. ${brake.reasons.join(" | ").slice(0, 300)}`,
      423,
      { code: "CAPITAL-BRAKE-HALT", lane: brake.lane, reasons: brake.reasons },
    );
  }

  // חוק 1: בלי פאריטה חיה — אין פעולה (אין שער, אין מסחר)
  const parity = marks.parity;
  if (parity == null || parity <= 0) {
    return bad("הפאריטה לא נמדדה חי (STEEM/SBD) — הרצפה אינה ניתנת לאכיפה, לכן שום פקודה לא הוצבה. סירוב-כנה.", 409, { code: "NO-PARITY" });
  }

  const account = accts[0];

  // R97 — הפרדת צדדים בספר הפתוח: base=STEEM → מכירה; base=SBD → קנייה.
  // עד R97 היו רק מכירות ולכן סכום for_sale היה תמיד STEEM; מעתה כל מנה
  // נספרת בנכס שלה — אחרת דלק המכירה היה מונה SBD כ-STEEM (באג מבני מונע).
  const allOpen = openOrders as any[];
  const sellOpen = allOpen.filter((o) => String(o.sell_price?.base ?? "").trim().endsWith("STEEM"));
  const bidOpen = allOpen.filter((o) => String(o.sell_price?.base ?? "").trim().endsWith("SBD"));
  // r190 · חוק-טווח-הפקודות: ניהול-המוביל רואה רק פקודות-מוביל. פקודות-הגריד
  // (טווח-ה-orderid השמור) לא שלו — לא בביטולים, לא בחישובי-דלק, לא בסקרי-האימות.
  // (r189-c נמדד חי: ה-cancel-all כאן מחק 10 פקודות-גריד חיות — ההתנגשות שמסננים אלה סוגרים.)
  const sellOpenMover = sellOpen.filter((o) => !isGridOrder(o.orderid));
  const bidOpenMover = bidOpen.filter((o) => !isGridOrder(o.orderid));
  const gridProtected = allOpen.length - sellOpenMover.length - bidOpenMover.length;

  // R97 — שער-העסקאות: מפעיל שהוציא את הפעולה = השער עצמו; הדיבון אוטונומי
  // רק מתחת לסף (הוראת המפעיל: "רק במקרים של עסקאות באמת גדולות $100 ומעלה")
  const session = operatorFromRequest(req);
  const issuedBy: "operator" | "daemon" = session ? "operator" : "daemon";

  const liquid = parseFloat(account.balance);
  // r190 · רק פקודות-המוביל: דלק-המוביל אינו כולל את ה-STEEM הנעול בסולם-הגריד
  // (הטווח השמור) — אחרת המוביל "רואה" דלק שאיננו שלו ומפריס עליו (שורש r189-c).
  const inOrders = sellOpenMover.reduce((s, o) => s + Number(o.for_sale) / 1000, 0); // מכירות-מוביל בלבד (R97 · r190)
  // R111 — חוק הגיבוי: הסולם לא מוכר את הגיבוי של הזירה.
  // הזירה עוטפת STEEM ל-WSTEEM נגד ההון החי באותו חשבון (וכך גם הפקדות
  // חוץ שנזקפות כ-WSTEEM לחברים) — תביעת הזירה כולה (מאזני חברים +
  // רזרבות בבריכות) מנוכה מדלק הפריסה, אחרת מכירת סולם שוברת את הבטחת
  // ה-1:1 של העטיפה. נולד מהזרמה כוזבת שנמדדה חי (95.327 WSTEEM מהון
  // סולם עומד) — החוק מונע את הנזק הבא, לא רק את האחרון.
  const arenaClaimWsteem = await (async (): Promise<number | null> => {
    try {
      const { db } = await import("@/lib/db");
      const accts = await db.exchangeAccount.findMany();
      let claim = 0;
      for (const a of accts) {
        try {
          const bal = JSON.parse(a.balances ?? "{}");
          claim += Number(bal.WSTEEM ?? 0) || 0;
        } catch { /* ספר ישן */ }
      }
      const pools = await db.exchangePool.findMany({ where: { assetA: "WSTEEM" } });
      for (const pool of pools) claim += Number(pool.reserveA) || 0;
      return Math.max(0, Math.round(claim * 1000) / 1000);
    } catch (e) {
      // r124 · חוק: כישלון-קריאה בחישוב-כסף הוא סירוב, לא אפס. ספר-הזירה
      // שלא נקרא היה מחזיר 0 תביעות → דלק מלא → reprice מפריס גיבוי של
      // WSTEEM שנתבע (הבטחת 1:1 של R111 נשברת בשקט). אפס מזויף = שקר.
      void e;
      return null;
    }
  })();
  if (arenaClaimWsteem == null) {
    return bad("ספר הזירה לא נקרא — תביעות ה-WSTEEM לא נמדדו, לכן שום פריסה לא תחושב. סירוב-כנה (חוק r124: כישלון-קריאה אינו אפס).", 503, { code: "ARENA-LEDGER-UNREADABLE" });
  }
  const totalFuelRaw = Math.round((liquid + inOrders) * 1000) / 1000;
  const totalFuel = Math.round(Math.max(0, totalFuelRaw - arenaClaimWsteem) * 1000) / 1000;
  const sbdLiquid = parseFloat(account.sbd_balance);
  const sbdCommitable = Math.floor(sbdLiquid * 0.9 * 1000) / 1000; // 0.9 — אותו פקטור-מחויבות כמו sbdArming
  // r145-a — הרחבת-הסולם (D-r145-O2): 3 → 5 רמות בשני הצדדים. יותר נקודות-מחיר
  // על הספר = יותר הזדמנויות-מילוי אמיתיות באותם ריילים בדיוק: רצפת-הערך בלי-שינוי
  // (כל מכירה ≥ פאריטה, כל קנייה < פאריטה), שער-$100 נשאר, גודל-פקודה חסום על-ידי
  // הדלק עצמו (perLevel = fuel/5 · perBid = commitable/רמות-שניתן למלא).
  // צד-הקנייה נשאר חוקי מ-0.15 SBD (רף R97) — עומק-הסולם מתאים את עצמו למלאי
  // החמוש (רמה אחת לכל 0.05 SBD, עד 5) — אין רעב, אין TOO-SMALL שקרי.
  // r147-a — הפרמיות וההיסטים עברו לקבועי-המודול SELL_PREMIUMS_BPS / BID_OFFSETS_BPS
  // (מדידה אחת, מקור-אחת — התצוגה והפעולה קוראים את אותו מספר).
  const premiums = SELL_PREMIUMS_BPS; // סולם המכירה: parity +50..+450bps (r147-a מהמדידה)
  const perLevel = Math.floor(totalFuel * 1000 / premiums.length) / 1000;
  const perBid = Math.floor(sbdCommitable * 1000 / 3) / 1000; // רק לבדיקת-סף ב-arm-buy; החוק החי ב-bidLadderLaw
  const { offsets: bidOffsets, source: bidSource } = bidOffsetsAdaptive();
  const bidLadderLaw = (commitable: number, par: number) => {
    const levels = Math.max(1, Math.min(bidOffsets.length, Math.floor(commitable / 0.05)));
    const per = Math.floor(commitable * 1000 / levels) / 1000;
    const prices = bidOffsets.slice(0, levels).map(
      (off) => Math.round(par * (1 - off / 10_000) * 1e6) / 1e6,
    );
    return { levels, per, prices };
  };

  // ── r147-a — חוק-הדלק הדו-צדדי (נמדד חי 10:23–11:04Z) ──────────────────
  // 7 פעולות REPRICE נדחו רצופות ב-"אין דלק לפריסה" בקצב 5-6 דק' — כל דחייה
  // שרפה 1/12 מתקציב-היום וכתבה רעש לספר-הקבלות, בזמן שצד-הקנייה (SBD —
  // לא צורך דלק-STEEM כלל) ישב מיושן בלי תחזוקה. חוק R111 (גיבוי-העטיפה)
  // מגביל רק את דלק צד-המכירה. מעתה:
  //   · דלק-מכירה חי → סולם דו-צדדי מלא (כמקודם).
  //   · דלק-מכירה אפס אך צד-הקנייה מיושן וממומן → תחזוקת-בידים-בלבד
  //     (אפס דלק-STEEM נשרף; הקבלה נושאת BID-ONLY בכנות).
  //   · דלק אפס וצד-הקנייה בריא → סירוב כנה (אין פעולה — אין שריפת תקציב).
  const sellFuelOk = totalFuel >= 0.004 && perLevel >= 0.001;
  // r190 · השערים נמדדים על פקודות-המוביל בלבד — הסולם של הגריד (הטווח השמור)
  // אינו קלט לשיקול-הדעת של המוביל (הוא לא "רואה" סולם שאיננו שלו)
  const bidLockedSbdGate = bidOpenMover.reduce((s, o) => s + (parseFloat(String(o.sell_price?.base ?? "")) || 0), 0);
  const potentialCommitableGate =
    Math.floor((parseFloat(account.sbd_balance) + bidLockedSbdGate) * 0.9 * 1000) / 1000;
  const lawGate = bidLadderLaw(potentialCommitableGate, parity);
  const bidPricesGate = bidOpenMover.map((o) => {
    const b = parseFloat(String(o.sell_price?.base ?? "")) || 0; // SBD
    const q = parseFloat(String(o.sell_price?.quote ?? "")) || 0; // STEEM
    return q > 0 ? b / q : 0;
  });
  const bidStaleGate =
    bidOpenMover.length !== lawGate.levels ||
    bidPricesGate.some((p) => {
      if (!(p > 0)) return true;
      const nearest = lawGate.prices.reduce(
        (best, lp) => (Math.abs(lp - p) < Math.abs(best - p) ? lp : best),
        lawGate.prices[0]!,
      );
      return Math.abs(nearest - p) / nearest > 0.005; // 50bps — אותו סף-סטייה
    });
  const bidOnly = !sellFuelOk && bidStaleGate && lawGate.per >= 0.05;
  if (action === "reprice" && !sellFuelOk && !bidOnly) {
    return bad(
      `אין דלק לפריסה (נזיל ${liquid.toFixed(3)} + בפקודות ${inOrders.toFixed(3)} · תביעת-עטיפה ${arenaClaimWsteem?.toFixed(3) ?? "unmeasured"}) — אין פעולה`,
      409,
      { code: "NO-FUEL" },
    );
  }
  if (action === "arm-buy" && sbdCommitable < 0.15) {
    return bad(`אין SBD חמוש לסולם קנייה (${sbdCommitable.toFixed(3)} < 0.15) — החימוש נפתח רק ממילוי אמיתי`, 409, { code: "NO-SBD" });
  }
  if (action === "arm-buy" && perBid < 0.05) {
    return bad("רמת קנייה קטנה מ-0.05 SBD — אין פעולה", 409, { code: "TOO-SMALL" });
  }

  // ── R111 · stock-sbd: רכישת-מלאי לחימוש צד-הקנייה ────────────────────
  // תיקון-שורש חי (R111, נמדד 04:46): הפקודה מוכרת STEEM לקבלת SBD —
  // ביצוע taker מתבצע מול צד ה-בידים, לא ה-שאלות. התמחור הישן חישב
  // את כמות ה-STEEM ממחיר-השאלה (גבוה מהביד) → min_to_receive גבוה
  // מהצעת הקנייה הטובה → הזמנת fill_or_kill לא מתמלאת אף-פעם בשוק
  // עם ספרד חיובי ("Cancelling order because it was not filled") —
  // וכל ניסיון כושל שרף תקציב-פעולות וצינון והרעיב את פריסת הסולם
  // ואת רגל HIVE (לולאת-הרעב). מעתה: הליכת-ספר אמיתית מול הבידים,
  // פרימיית-עלות נמדדת מול קו-הזהות בכיוון הנכון (parity/bid - 1 —
  // כמה STEEM משלמים מעל ההוגן עבור SBD), ותקרה 200bps נאכפת כנה.
  //   · כמות: רק הפער לחימוש (0.15), לעולם לא מעבר
  //   · fill_or_kill: פקודת-מילוי-מיידי או-בטל — לא נשארת בספר
  //   · שארת-דלק מינימלית נשמרת תמיד (0.5 STEEM)
  const stockGap = Math.ceil((0.15 - sbdCommitable) * 1000) / 1000;
  let stockBid: number | null = null; // המחיר הבר-ביצוע (צד הבידים)
  let stockSteemSell = 0;
  if (action === "stock-sbd") {
    if (stockGap <= 0.005) {
      return bad(`החימוש כבר שלם (${sbdCommitable.toFixed(3)}/0.15) — אין מה למלא`, 409, { code: "ALREADY-ARMED" });
    }
    const book = await new Promise<any>((resolve, reject) =>
      quiet(
        steem.api.getOrderBook(10, (err: Error | null, res: any) =>
          err ? reject(err) : resolve(res),
        ),
      ),
    ).catch(() => null);
    // r124 · חוק: כישלון-קריאה אינו "עומק דק" — ספר שלא נקרא הוא לא-נמדד,
    // ולא טענה על תוכנו. קוד נפרד מ-BOOK-TOO-THIN (שקר הסיבה נתפס ב-r124-a).
    if (book == null) {
      return bad("ספר-הבידים לא נקרא (RPC לא ענה) — לא נמדד, לא פעולה. סירוב-כנה.", 502, { code: "NO-BOOK-READ" });
    }
    const bidRows: Array<{ real_price?: string | number; sbd?: string | number }> = book?.bids ?? [];
    // הליכת-ספר: כמה STEEM צריך למכור דרך הבידים כדי לקבל בדיוק את הפער
    let remainSbd = stockGap;
    let walkSteem = 0;
    let lastBid = 0;
    for (const b of bidRows) {
      const px = Number(b.real_price);
      const sbd = Number(b.sbd) / 1000;
      if (!(px > 0) || !(sbd > 0)) continue;
      const take = Math.min(remainSbd, sbd);
      walkSteem += take / px;
      remainSbd -= take;
      lastBid = px;
      if (remainSbd <= 0.0005) break;
    }
    if (remainSbd > 0.0005) {
      return bad(
        `עומק הבידים לא מכסה את הפער (${stockGap.toFixed(3)} SBD, חסר ${remainSbd.toFixed(3)}) — לא מנוורים את הספר. סירוב-כנה.`,
        409,
        { code: "BOOK-TOO-THIN", gap: stockGap, short: Math.round(remainSbd * 1000) / 1000 },
      );
    }
    stockBid = lastBid > 0 ? lastBid : Number(bidRows[0]?.real_price) || null;
    if (stockBid == null || !(stockBid > 0)) {
      return bad("הספר לא נקרא — אין מחיר-ביד בר-ביצוע, אין פעולה. סירוב-כנה.", 502, { code: "NO-BOOK" });
    }
    // פרימיית-העלות האמיתית: מכירת STEEM בביד b מול קו-הזהות parity
    // (שניהם SBD-per-STEEM): SBD אחד עולה 1/b STEEM מול הוגן 1/parity.
    // premium = parity/b - 1 — חיובי = משלמים מעל ההוגן.
    const premiumBps = Math.round((parity / stockBid - 1) * 10_000);
    if (premiumBps > 200) {
      return bad(
        `הביד הבר-ביצוע ${stockBid.toFixed(6)} רחוק ${premiumBps}bps מתחת לקו-הזהות ${parity.toFixed(6)} (תקרה 200bps) — קניית המלאי תשלם STEEM מעל ההוגן. סירוב-כנה: החימוש ייבנה ממילוי-פרימיה.`,
        409,
        { code: "PREMIUM-TOO-HIGH", bid: stockBid, parity, premiumBps },
      );
    }
    stockSteemSell = Math.ceil(walkSteem * 1000) / 1000;
    if (liquid < stockSteemSell + 0.5) {
      return bad(
        `דלק נזיל לא מספיק למילוי (${liquid.toFixed(3)} STEEM < ${stockSteemSell.toFixed(3)} + שארה 0.5) — המלאי ייבנה עם הפאוורדאון/מילוי הבא`,
        409,
        { code: "NO-FUEL", liquid, need: stockSteemSell },
      );
    }
  }

  // ── שער-העסקאות (R97): הערכת-USD חיה בזמן ההחלטה, לפני כל נגיעה בכסף ──
  const gateUsd =
    action === "arm-buy"
      ? marks.sbdUsd != null && marks.sbdUsd > 0
        ? Math.round(sbdCommitable * marks.sbdUsd * 100) / 100
        : null
      : action === "stock-sbd"
        ? marks.steemUsd != null && marks.steemUsd > 0
          ? Math.round(stockSteemSell * marks.steemUsd * 100) / 100
          : null
        : marks.steemUsd != null && marks.steemUsd > 0
          ? Math.round(totalFuel * marks.steemUsd * 100) / 100
          : null;
  const gatePayloadBase: Record<string, unknown> =
    action === "arm-buy"
      ? { sbdCommitable, parity, offsetsBps: bidOffsets, offsetsSource: bidSource, reason }
      : action === "stock-sbd"
        ? { gap: stockGap, bid: stockBid, steemSell: stockSteemSell, parity, premiumCapBps: 200, reason }
        : { liquid, inOrders, totalFuel, parity, premiums, reason };
  if (deliberationOk) gatePayloadBase.deliberation = deliberationBody; // r206 — המחשבה מגיעה לשופט
  const gate = await evaluateGate({
    source: "money-mover",
    action,
    title:
      action === "arm-buy"
        ? `arm-buy — סולם קנייה מתחת לפאריטה · ${sbdCommitable} SBD`
        : action === "stock-sbd"
          ? `stock-sbd — מילוי מלאי חימוש · ${stockSteemSell} STEEM → ${stockGap} SBD במחיר-שאלה`
          : `reprice — סולם 3 רמות מעל הפאריטה · ${totalFuel} STEEM`,
    payload: gatePayloadBase,
    usdValue: gateUsd,
    usdBasis:
      gateUsd != null
        ? action === "arm-buy"
          ? `${sbdCommitable} SBD × $${marks.sbdUsd} (${marks.sources.sbd ?? "sbd-mark"})`
          : action === "stock-sbd"
            ? `${stockSteemSell} STEEM × $${marks.steemUsd} (${marks.sources.steem ?? "steem-mark"})`
            : `${totalFuel} STEEM × $${marks.steemUsd} (${marks.sources.steem ?? "steem-mark"})`
        : "usd-mark לא נמדד חי",
    issuedBy,
    reason,
  });
  if (gate.verdict === "REFUSED") {
    // r206 — ייחוס-אמת: לשער שלוש סיבות-סירוב נבדלות (PAUSED · NO-DELIBERATION ·
    // no-usd-mark) ואסור למפות את כולן ל"USD לא נמדד חי" — המיפוי-השקר הזה
    // הצית למידה כוזבת (14/14 סירובים דווחו "usd מת" בעוד ה-USD חי). הקוד האמיתי
    // עובר ללומד (signature נגזר מהטקסט) ולספר-ההיסטוריה.
    const decidedBy = String(gate.decidedBy ?? "unknown");
    const gateRef = `[שער#${String(gate.id).slice(0, 8)}]`;
    if (decidedBy === "autonomy:NO-DELIBERATION") {
      return bad(`THINKING — הפעולה הגיעה לשער בלי דיון מלא (מה/למה/צפי/סיכון/רולבק) — לחשוב לפני שעושים (חוק-r197) ${gateRef}`, 409, { code: "NO-DELIBERATION", gateId: gate.id, gateDecidedBy: decidedBy });
    }
    if (decidedBy === "autonomy:PAUSED") {
      return bad(`האוטונומיה עוצרה על-ידי המפעיל — אף פעולה אוטומטית לא זזה ${gateRef}`, 409, { code: "AUTONOMY-PAUSED", gateId: gate.id, gateDecidedBy: decidedBy });
    }
    if (decidedBy === "policy:no-usd-mark") {
      return bad(`USD לא נמדד חי — השער אינו יכול להעריך, לכן שום דבר לא זז (אין שער, אין מסחר) ${gateRef}`, 409, { code: "NO-USD-MARK", gateId: gate.id, gateDecidedBy: decidedBy });
    }
    return bad(`השער סירב (${decidedBy}) ${gateRef} — ${String(gate.reason ?? "").slice(0, 140)}`, 409, { code: "GATE-REFUSED", gateId: gate.id, gateDecidedBy: decidedBy });
  }
  if (gate.verdict === "QUEUED") {
    return NextResponse.json(
      {
        ok: false,
        code: "GATE-QUEUED",
        gateId: gate.id,
        usdValue: gate.usdValue,
        threshold: gate.threshold,
        error: "GATE-QUEUED",
        he: `הפעולה (${gate.usdValue?.toFixed(2)}$) מעל סף האוטונומיה $${gate.threshold} — הועברה לתור אישור המפעיל בשער העסקאות. שום כסף לא זז.`,
      },
      { status: 403 },
    );
  }

  const expiration = new Date(Date.now() + 27 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "");
  const receipt: MoverReceipt = {
    at: new Date().toISOString(),
    kind: triggerTag ?? (action === "arm-buy" ? "ARM-BUY" : action === "stock-sbd" ? "STOCK-SBD" : bidOnly ? "BID-ONLY" : inOrders === 0 ? "FUEL-IN" : "REPRICE"),
    reason,
    parity,
    cancelled: [],
    placed: [],
    // r190 · שקיפות-כנה: פקודות-הגריד שנראו בספר ונשארו בחיים (חוק-טווח-הפקודות השמור)
    gridSkipped: gridProtected,
  };
  const errors: string[] = [];
  const noteError = (msg: string) => {
    errors.push(msg);
    receipt.error = errors.slice(-3).join(" | ");
  };

  // לקח R98 (הוכח במעבדה מבודדת scripts/lab-broadcast-rejection.cjs + 80 מדידות
  // ב-dev.log): מצב-ה-callback של steem-js נכשל פעמיים — ההבטחה המוחזרת
  // היא undefined (אין מה לתפוס) ובדחיית-הכנה ה-callback אף לא מופעל.
  // הדפוס המוכח של קו-העוגן (graphene.ts, חי on-chain): broadcast.sendAsync —
  // ההבטחה היא מקור-האמת היחיד. תקרת-45ש' נשארת: שידור מתקבל בשרשרת
  // ב-~7-9 שנ׳ אך אישור steem-js מתעכב מעבר לזה — והשופט הסופי הוא
  // השרשרת (ה-verify בסוף הקבלה מודד מה באמת פתוח שם, לא מה שהאישורים אמרו).
  const broadcastOp = async <T,>(p: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("broadcast-timeout-45s")), 45_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // לקח-הריצה-הראשונה (נמדד 00:38–00:40Z): קבלה שנכתבת רק בסוף מתאפסת אם
  // ה-handler נקטע. מעתה — הקבלה מתעדכנת בקובץ אחרי כל פעולה בודדת:
  // גם אם העולם ייפול באמצע, מה שקרה על השרשרת מתועד.
  // r125a: ה-persist האחרון קובע — מה שנמצא על הדיסק הוא הראיה; אם נפל,
  // התשובה מגלה זאת (receiptPersisted:false) ולא מסתירה את אובדן-הראיה.
  let receiptPersisted = true;
  const persist = () => {
    receiptPersisted = appendReceipt(receipt);
  };

  try {
    if (action === "arm-buy") {
      // ═ ARM-BUY — צד הקנייה של המיקרו-גריד (R97 · הזדמנות O1) ═══════
      // סולם שלוש רמות מתחת לפאריטה (‎-1%/-2%/-3%): כל קנייה מתחת לקו היא
      // עודף נמדד מול ערך-חוץ. הגג נאכף בקוד: לעולם לא קונים מעל פאריטה.
      // שוק פנימי שנסחר מתחת לקו ימלא את ההצעות מיד — במחיר העומד,
      // לא במחיר ההצעה; השרשרת היא השופטת.
      // r190 · רק בידים של המוביל מבוטלות — פקודות-הגריד (טווח-שמור) לא נוגעות לעולם
      const bidCancelResults = await Promise.allSettled(
        bidOpenMover.map((o) =>
          broadcastOp<any>(
            steem.broadcast.sendAsync(
              { extensions: [], operations: [["limit_order_cancel", { owner: ownerKey.account, orderid: o.orderid }]] },
              [wif],
            ),
          ).then((res) => ({ orderid: o.orderid, txid: res?.id ?? null })),
        ),
      );
      bidOpenMover.forEach((o, i) => {
        const r = bidCancelResults[i];
        if (r.status === "fulfilled") {
          receipt.cancelled.push(r.value);
        } else {
          receipt.cancelled.push({ orderid: o.orderid, txid: null });
          noteError(`cancel-bid ${o.orderid}: ${String((r.reason as Error)?.message ?? r.reason).slice(0, 100)}`);
        }
      });
      persist();

      // המתנה שהביטולים ייעלמו מהספר (לקח R94 — ביטול ששודר ≠ ביטול שנכלל)
      // r190 · הסקר מחכה רק לפקודות-המוביל שבוטלו — פקודות-הגריד נשארות בספר בכוונה
      const bidCancelledIds = new Set(bidOpenMover.map((o) => Number(o.orderid)));
      if (bidCancelledIds.size > 0) {
        for (let poll = 0; poll < 4; poll++) {
          try {
            const os = await new Promise<any[]>((resolve, reject) =>
              quiet(
                steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
                  err ? reject(err) : resolve(res ?? []),
                ),
              ),
            );
            const stillThere = os.some((o: any) => bidCancelledIds.has(Number(o.orderid)));
            if (!stillThere) break;
          } catch {
            /* סקר שנכשל לא עוצר — השופט הסופי הוא ה-verify בסוף */
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
      }

      // הצבת סולם הקנייה — orderid ברווח 9X (מכירות = 01-05 · r145-a)
      const orderDay = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const bidLawArm = bidLadderLaw(sbdCommitable, parity);
      for (let i = 0; i < bidLawArm.levels; i++) {
        const price = bidLawArm.prices[i]!;
        const sbd = bidLawArm.per;
        const steemOut = Math.floor((sbd / price) * 1000) / 1000; // עיגול-מטה: אף פעם לא מעל המחיר
        const effPrice = steemOut > 0 ? sbd / steemOut : 0;
        if (effPrice >= parity) {
          noteError(`bid ${i + 1}: מחיר יעיל ${effPrice.toFixed(6)} אינו מתחת לפאריטה — לא הוצב (חוק הגג)`);
          continue;
        }
        const orderid = Number(`${orderDay}9${i + 1}`);
        try {
          const res = await broadcastOp<any>(
            steem.broadcast.sendAsync(
              {
                extensions: [],
                operations: [[
                  "limit_order_create",
                  {
                    owner: ownerKey.account,
                    orderid,
                    amount_to_sell: `${sbd.toFixed(3)} SBD`,
                    min_to_receive: `${steemOut.toFixed(3)} STEEM`,
                    fill_or_kill: false,
                    expiration,
                  },
                ]],
              },
              [wif],
            ),
          );
          receipt.placed.push({ orderid, sell: sbd, receive: steemOut, price: Math.round(effPrice * 1e6) / 1e6, txid: res?.id ?? null });
        } catch (e) {
          // לקח R87: timeout ≠ כישלון — השרשרת היא השופטת. סקר לפי orderid.
          let landed = false;
          for (let poll = 0; poll < 3 && !landed; poll++) {
            await new Promise((r) => setTimeout(r, 8000));
            try {
              const os = await new Promise<any[]>((resolve, reject) =>
                quiet(
                  steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
                    err ? reject(err) : resolve(res ?? []),
                  ),
                ),
              );
              const found = os.find((o: any) => Number(o.orderid) === orderid);
              if (found) {
                landed = true;
                receipt.placed.push({ orderid, sell: sbd, receive: steemOut, price: Math.round(effPrice * 1e6) / 1e6, txid: null, confirmedBy: "chain-read" });
              }
            } catch {
              /* סקר שנכשל לא מזיז כלום — השופט הסופי הוא ה-verify בסוף */
            }
          }
          if (!landed) noteError(`place bid ${i + 1}: ${String((e as Error).message).slice(0, 100)}`);
        }
        persist();
        await new Promise((r) => setTimeout(r, 400)); // ריווח בין שידורים — נחמד לצומת
      }

      // אימות-סוף מהשרשרת — השופט
      let bidVerify: { ordersNow: number; deployedNow: number; bidsNow?: number } | null = null;
      try {
        const after = await new Promise<any[]>((resolve, reject) =>
          quiet(
            steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
              err ? reject(err) : resolve(res ?? []),
            ),
          ),
        );
        // r190 · המוביל נמדד על פקודותיו בלבד — פקודות-הגריד (טווח-שמור) לא נספרות בהישג-ידו
        const sells = after.filter((o: any) => String(o.sell_price?.base ?? "").trim().endsWith("STEEM")).filter((o: any) => !isGridOrder(o.orderid));
        const bids = after.filter((o: any) => String(o.sell_price?.base ?? "").trim().endsWith("SBD")).filter((o: any) => !isGridOrder(o.orderid));
        bidVerify = {
          ordersNow: after.length,
          deployedNow: Math.round(sells.reduce((s: number, o: any) => s + Number(o.for_sale) / 1000, 0) * 1000) / 1000,
          bidsNow: bids.length,
        };
      } catch {
        /* אימות הוא שכבת-עדות — כשלו אינו מזים את הקבלה */
      }
      receipt.verify = bidVerify ?? undefined;
      persist();
      swrInvalidate(SWR_KEY);
      await settleGate(
        gate.id,
        "EXECUTED",
        issuedBy === "operator" ? "operator" : "policy:autonomous",
        { placed: receipt.placed.length, cancelled: receipt.cancelled.length, verify: bidVerify, gateUsd },
      );
      const bidsOk = (bidVerify?.bidsNow ?? 0) > 0;
      return NextResponse.json({
        ok: bidsOk || receipt.placed.length > 0,
        receipt,
        verify: bidVerify,
        receiptPersisted,
        he: (bidsOk
          ? `סולם הקנייה חי בשרשרת (נמדד): ${bidVerify?.bidsNow} הצעות · ${sbdCommitable} SBD מחויבות מתחת לקו ${parity.toFixed(4)} · בוטלו ${receipt.cancelled.length}`
          : `הוצבו ${receipt.placed.length} הצעות קנייה · בוטלו ${receipt.cancelled.length} · אימות שרשרת לא נקרא`) + (receiptPersisted ? "" : " · אזהרה: כתיבת הקבלה לדיסק נכשלה — הראיה על השרשרת בלבד"),
      });
    }

    // ═ STOCK-SBD — מילוי מלאי חימוש צד-הקנייה (R101 · שחרור החסימה המדודה) ═
    // פקודת fill_or_kill: מילוי-מיידי במחיר העומד או ביטול — לעולם לא נשארת
    // בספר כמייקר. הפרימייה ששולמה מעל קו-הזהות נמדדת ומתועדת בכנות:
    // זו עלות-לוגיסטיקה של חימוש, לא רווח-גריד.
    if (action === "stock-sbd") {
      const orderDayStock = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const orderid = Number(`${orderDayStock}7`); // 7 = stock (מכירות 01-03 · קניות 91-93)
      const iocExpiration = new Date(Date.now() + 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, "");
      try {
        const res = await broadcastOp<any>(
          steem.broadcast.sendAsync(
            {
              extensions: [],
              operations: [[
                "limit_order_create",
                {
                  owner: ownerKey.account,
                  orderid,
                  amount_to_sell: `${stockSteemSell.toFixed(3)} STEEM`,
                  min_to_receive: `${stockGap.toFixed(3)} SBD`,
                  fill_or_kill: true,
                  expiration: iocExpiration,
                },
              ]],
            },
            [wif],
          ),
        );
        receipt.placed.push({ orderid, sell: stockSteemSell, receive: stockGap, price: stockBid ?? 0, txid: res?.id ?? null, confirmedBy: "fill-or-kill" });
      } catch (e) {
        noteError(`stock order: ${String((e as Error).message).slice(0, 120)}`);
      }
      persist();

      // אימות-סוף — השרשרת השופטת: מה באמת נצבר
      let stockVerify: { sbdNow: number; gapClosed: boolean; premiumPaidBps: number | null } | null = null;
      try {
        const after = await new Promise<any[]>((resolve, reject) =>
          quiet(
            steem.api.getAccounts([ownerKey.account], (err: Error | null, res: any[]) =>
              err || !res?.length ? reject(err ?? new Error("empty")) : resolve(res),
            ),
          ),
        );
        const sbdNow = Math.floor(parseFloat(after[0].sbd_balance) * 1000) / 1000;
        stockVerify = {
          sbdNow,
          gapClosed: sbdNow >= 0.15,
          premiumPaidBps: stockBid != null ? Math.round((parity / stockBid - 1) * 10_000) : null,
        };
      } catch {
        /* השרשרת תישאר השופט בקריאה הבאה */
      }
      receipt.verify = stockVerify;
      persist();
      swrInvalidate(SWR_KEY);
      await settleGate(
        gate.id,
        "EXECUTED",
        issuedBy === "operator" ? "operator" : "policy:autonomous",
        { placed: receipt.placed.length, stock: stockVerify, gateUsd },
      );
      return NextResponse.json({
        ok: receipt.placed.length > 0,
        receipt,
        verify: stockVerify,
        receiptPersisted,
        he: (stockVerify?.gapClosed
          ? `מלאי החימוש נסגר: ${stockVerify.sbdNow} SBD — סולם הקנייה יחומש במחזור הבא`
          : `פקודת המילוי שודרה (${receipt.placed.length}) · SBD נוכחי ${stockVerify?.sbdNow ?? "?"} — השרשרת השופטת`) + (receiptPersisted ? "" : " · אזהרה: כתיבת הקבלה לדיסק נכשלה — הראיה על השרשרת בלבד"),
      });
    }

    // ═ REPRICE — סולם המכירה (R81; R97: ביטול מכירות בלבד — הקניות לא נפגעות) ═
    // r147-a — הצד הזה נאטם מאחורי sellFuelOk: בדלק-אפס (חוק R111) הפעולה
    // ממשיכה לתחזוקת צד-הקנייה בלבד (BID-ONLY) — אפס דלק-STEEM נשרף.
    const orderDay = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    if (sellFuelOk) {
    // א. ביטול פקודות המכירה הקיימות — במקביל (עצמאיות; הכסף חוזר לנזיל)
    // r190 · רק מכירות-המוביל מבוטלות — פקודות-הגריד (טווח-שמור) לא נוגעות לעולם
    const cancelResults = await Promise.allSettled(
      sellOpenMover.map((o) =>
        broadcastOp<any>(
          steem.broadcast.sendAsync(
            { extensions: [], operations: [["limit_order_cancel", { owner: ownerKey.account, orderid: o.orderid }]] },
            [wif],
          ),
        ).then((res) => ({ orderid: o.orderid, txid: res?.id ?? null })),
      ),
    );
    sellOpenMover.forEach((o, i) => {
      const r = cancelResults[i];
      if (r.status === "fulfilled") {
        receipt.cancelled.push(r.value);
      } else {
        receipt.cancelled.push({ orderid: o.orderid, txid: null });
        noteError(`cancel ${o.orderid}: ${String((r.reason as Error)?.message ?? r.reason).slice(0, 100)}`);
      }
    });
    persist();

    // תיקון R94 — שורש מחלקת "אין די כספים" שנמדדה ב-dev.log (6 דחיות):
    // ביטול ששודר אינו ביטול שנכלל בבלוק. השרשרת דוחה הצבה חדשה כל
    // עוד הכסף נעול בפקודות הישנות. תנאי-המתנה: ה-orderid שבוטלו
    // נעלמים מ-getOpenOrders (עד 4 סקרים × 5ש׳, קריאה בלבד) — ורק
    // אז מוצב הסולם. סקר שנכשל לא עוצר — הסקר הבא יגיד את האמת.
    // r190 · הסקר מחכה רק לפקודות-המוביל שבוטלו — פקודות-הגריד נשארות בספר בכוונה
    const cancelledIds = new Set(sellOpenMover.map((o) => Number(o.orderid)));
    if (cancelledIds.size > 0) {
      for (let poll = 0; poll < 4; poll++) {
        try {
          const os = await new Promise<any[]>((resolve, reject) =>
            quiet(
              steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
                err ? reject(err) : resolve(res ?? []),
              ),
            ),
          );
          const stillThere = os.some((o: any) => cancelledIds.has(Number(o.orderid)));
          if (!stillThere) break;
        } catch {
          /* סקר שנכשל לא עוצר — השופט הסופי הוא ה-verify בסוף */
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    // ב. הצבת הסולם החדש — רצפה נאכפת: כל מחיר ≥ פאריטה
    // r146-d — חוק-גיאומטריית-הסולם (נמדד חי 09:43:54Z): בגדלים-קטנים ceil3
    // מקריב את הפרמיות לרשת-0.001 SBD — הראיה: 5 רמות (0..400bps) קרסו
    // לשני מחירים (0.100251 ×3 רמות · 0.102757 ×2 רמות) כי receive=ceil3(sell×price)
    // אינו מסוגל לבטא צעדי-פרמיה של ~0.0004 SBD כש-λperLevel=0.399 STEEM.
    // תוצאה שנמדדה: שלוש פקודות על אותו מחיר בדיוק — ספר כפול-מחיר.
    // מעתה הסולם נבנה כמערך לפני-השידור: רמה שהמחיר-היעיל שלה זהה לקודמת
    // מתמזגת אליה (אותו מחיר, עומק-כפול: sell=Σsell · receive=Σreceive —
    // היחס נשמר ביט-מול-ביט) — אין שתי פקודות על אותו מחיר, וכל דלק נפרס.
    // ממוזג או לא: חוק-הרצפה נאכף על המחיר-היעיל הסופי (ממוצע-משוקלל של
    // שני יחסים מעל-הרצפה הוא מעל-הרצפה — אלגברה, לא הנחה).
    const ladderPlan: Array<{ premiumBps: number; sell: number; receive: number; effPrice: number }> = [];
    for (let i = 0; i < premiums.length; i++) {
      const price = parity * (1 + premiums[i] / 10_000);
      const sell = perLevel;
      const receive = ceil3(sell * price); // עיגול-מעלה: היחס לעולם לא יורד מהמחיר
      const effPrice = receive / sell;
      if (effPrice < parity * 0.999) {
        // חוק 1 — אם העיגול הוריד מתחת לקו (לא אמור לקרות), מוותרים על הצבה זו בכנות
        noteError(`level ${i + 1}: מחיר יעיל ${effPrice.toFixed(6)} מתחת לרצפה — לא הוצב`);
        continue;
      }
      const prev = ladderPlan[ladderPlan.length - 1];
      if (prev && prev.receive === receive) {
        // התנגשות-עיגול: אותו מחיר-יעיל — מיזוג עומק במקום פקודה-כפולה
        prev.sell = Math.round((prev.sell + sell) * 1000) / 1000;
        prev.receive = Math.round((prev.receive + receive) * 1000) / 1000;
        prev.effPrice = Math.round((prev.receive / prev.sell) * 1e6) / 1e6;
        continue;
      }
      ladderPlan.push({ premiumBps: premiums[i]!, sell, receive, effPrice: Math.round(effPrice * 1e6) / 1e6 });
    }
    for (let i = 0; i < ladderPlan.length; i++) {
      const { sell, receive, effPrice } = ladderPlan[i]!;
      const orderid = Number(`${orderDay}${String(i + 1).padStart(2, "0")}`);
      try {
        const res = await broadcastOp<any>(
          steem.broadcast.sendAsync(
            {
              extensions: [],
              operations: [[
                "limit_order_create",
                {
                  owner: ownerKey.account,
                  orderid,
                  amount_to_sell: `${sell.toFixed(3)} STEEM`,
                  min_to_receive: `${receive.toFixed(3)} SBD`,
                  fill_or_kill: false,
                  expiration,
                },
              ]],
            },
            [wif],
          ),
        );
        receipt.placed.push({ orderid, sell, receive, price: Math.round(effPrice * 1e6) / 1e6, txid: res?.id ?? null });
      } catch (e) {
        // R87: שידור שעבר את התקרה אינו בהכרח כישלון — השרשרת היא השופטת.
        // נמדד חי (03:47–03:49Z): הפקודות נוחתות על השרשרת תוך 15–45ש׳
        // בעוד ה-callback של steem-js מתעכב מעבר לתקרת-ה-45ש׳. לכן אחרי
        // timeout — סקר-שרשרת קצר לפי orderid: נחתה = מתועדת כהוצבה-ואומתה;
        // לא נמצאה אחרי 3 סקרים = שגיאה כנה כמקודם. הכסף לא משנה ידיים
        // בסקר — הוא קריאה בלבד, אותו מקור שה-verify בסוף כבר קורא.
        let landed = false;
        for (let poll = 0; poll < 3 && !landed; poll++) {
          await new Promise((r) => setTimeout(r, 8000));
          try {
            const os = await new Promise<any[]>((resolve, reject) =>
              quiet(
                steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
                  err ? reject(err) : resolve(res ?? []),
                ),
              ),
            );
            const found = os.find((o: any) => Number(o.orderid) === orderid);
            if (found) {
              landed = true;
              receipt.placed.push({
                orderid,
                sell,
                receive,
                price: Math.round(effPrice * 1e6) / 1e6,
                txid: null,
                confirmedBy: "chain-read",
              });
            }
          } catch {
            /* סקר שנכשל לא מזיז כלום — השופט הסופי הוא ה-verify בסוף */
          }
        }
        if (!landed) noteError(`place level ${i + 1}: ${String((e as Error).message).slice(0, 100)}`);
      }
      persist(); // קבלה אחרי כל הצבה — לא רק בסוף (לקח הריצה הראשונה)
      await new Promise((r) => setTimeout(r, 400)); // ריווח בין שידורים — נחמד לצומת
    }
    } else {
      // r147-a — כנות: דלק-מכירה אפס (תביעת-העטיפה שווה את ההון החי) —
      // צד-המכירה לא נוגעים; הפעולה ממשיכה לתחזוקת צד-הקנייה בלבד.
      noteError(`sell side skipped: NO-FUEL (R111 · נזיל ${liquid.toFixed(3)} + בפקודות ${inOrders.toFixed(3)} · תביעה ${arenaClaimWsteem?.toFixed(3) ?? "unmeasured"} WSTEEM) — BID-ONLY`);
    }

    // ═ r145-a — רגל-הקנייה בגרירת-הסולם (D-r145-O2 · הסולם דו-צדדי מאז R97) ═══
    // גרירת-הקו גוררת את שני צדדי הסולם — ספר שצד-אחד שלו יושב מיושן הוא חצי-ספר.
    // רק בידים ישנות נגררות: סטייה >50bps ממחיר-חוק-ההיסטים, או עומק חסר מול מה
    // שהמלאי החמוש מאפשר. בידים בריאות לא נוגעים (R97 נשמר במילואו). תקרות:
    // אותו חוק-גג (כל קנייה < פאריטה), אותו שער-$100 (נמדד על הפעולה כולה למעלה),
    // ו-perBid מהמאזן החי אחרי-הביטולים — השרשרת השופטת, לא חשבון מקומי.
    // r190 · מאזן-הבידים נמדד על פקודות-המוביל בלבד — הסולם של הגריד אינו קלט
    const bidLockedSbd = bidOpenMover.reduce((s, o) => s + (parseFloat(String(o.sell_price?.base ?? "")) || 0), 0);
    const potentialCommitable = Math.floor((sbdLiquid + bidLockedSbd) * 0.9 * 1000) / 1000;
    const lawPre = bidLadderLaw(potentialCommitable, parity);
    const liveBidPrices = bidOpenMover.map((o) => {
      const baseN = parseFloat(String(o.sell_price?.base ?? "")) || 0; // SBD מוצע
      const quoteN = parseFloat(String(o.sell_price?.quote ?? "")) || 0; // STEEM מתקבל
      return quoteN > 0 ? baseN / quoteN : 0;
    });
    const bidStale =
      bidOpenMover.length !== lawPre.levels ||
      liveBidPrices.some((p) => {
        if (!(p > 0)) return true;
        const nearest = lawPre.prices.reduce(
          (best, lp) => (Math.abs(lp - p) < Math.abs(best - p) ? lp : best),
          lawPre.prices[0]!,
        );
        return Math.abs(nearest - p) / nearest > 0.005; // 50bps — אותו סף-סטייה של צד-המכירה
      });
    if (bidStale && lawPre.per >= 0.05) {
      // א. ביטול הבידים הישנות — במקביל (אותו דפוס של צד-המכירה)
      // r190 · רק בידים של המוביל מבוטלות — פקודות-הגריד (טווח-שמור) לא נוגעות לעולם
      const bidCancelResults = await Promise.allSettled(
        bidOpenMover.map((o) =>
          broadcastOp<any>(
            steem.broadcast.sendAsync(
              { extensions: [], operations: [["limit_order_cancel", { owner: ownerKey.account, orderid: o.orderid }]] },
              [wif],
            ),
          ).then((res) => ({ orderid: o.orderid, txid: res?.id ?? null })),
        ),
      );
      bidOpenMover.forEach((o, i) => {
        const r = bidCancelResults[i];
        if (r.status === "fulfilled") {
          receipt.cancelled.push(r.value);
        } else {
          receipt.cancelled.push({ orderid: o.orderid, txid: null });
          noteError(`cancel-bid ${o.orderid}: ${String((r.reason as Error)?.message ?? r.reason).slice(0, 100)}`);
        }
      });
      persist();

      // ב. המתנה שהביטולים ייעלמו מהספר — ה-SBD חוזר לנזיל רק שם (R94)
      // r190 · הסקר מחכה רק לפקודות-המוביל שבוטלו — פקודות-הגריד נשארות בספר בכוונה
      const bidCancelledIds = new Set(bidOpenMover.map((o) => Number(o.orderid)));
      if (bidCancelledIds.size > 0) {
        for (let poll = 0; poll < 4; poll++) {
          try {
            const os = await new Promise<any[]>((resolve, reject) =>
              quiet(
                steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
                  err ? reject(err) : resolve(res ?? []),
                ),
              ),
            );
            const stillThere = os.some((o: any) => bidCancelledIds.has(Number(o.orderid)));
            if (!stillThere) break;
          } catch {
            /* סקר שנכשל לא עוצר — השופט הסופי הוא ה-verify בסוף */
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
      }

      // ג. מאזן-חי מהשרשרת אחרי-הביטולים — חוק-הסולם על האמת, לא על ההנחה
      const lawPost = await (async () => {
        try {
          const accts2 = await new Promise<any[]>((resolve, reject) =>
            quiet(
              steem.api.getAccounts([ownerKey.account], (err: Error | null, res: any[]) =>
                err || !res?.length ? reject(err ?? new Error("empty")) : resolve(res),
              ),
            ),
          );
          const sbdNow = parseFloat(accts2[0].sbd_balance);
          return bidLadderLaw(Math.floor(sbdNow * 0.9 * 1000) / 1000, parity);
        } catch {
          return lawPre; // נפילה כנה לחוק-הקדם-ביטול (מעוגן מטה — לעולם לא מעל)
        }
      })();
      // ד. הצבת סולם הקנייה החי — orderid ברווח 9X (מכירות 01-05 · קניות 91-95)
      for (let i = 0; i < lawPost.levels; i++) {
        const price = lawPost.prices[i]!;
        const sbd = lawPost.per;
        const steemOut = Math.floor((sbd / price) * 1000) / 1000; // עיגול-מטה: אף פעם לא מעל המחיר
        const effPrice = steemOut > 0 ? sbd / steemOut : 0;
        if (effPrice >= parity) {
          noteError(`rebid ${i + 1}: מחיר יעיל ${effPrice.toFixed(6)} אינו מתחת לפאריטה — לא הוצב (חוק הגג)`);
          continue;
        }
        const orderid = Number(`${orderDay}9${i + 1}`);
        try {
          const res = await broadcastOp<any>(
            steem.broadcast.sendAsync(
              {
                extensions: [],
                operations: [[
                  "limit_order_create",
                  {
                    owner: ownerKey.account,
                    orderid,
                    amount_to_sell: `${sbd.toFixed(3)} SBD`,
                    min_to_receive: `${steemOut.toFixed(3)} STEEM`,
                    fill_or_kill: false,
                    expiration,
                  },
                ]],
              },
              [wif],
            ),
          );
          receipt.placed.push({ orderid, sell: sbd, receive: steemOut, price: Math.round(effPrice * 1e6) / 1e6, txid: res?.id ?? null });
        } catch (e) {
          // R87 — timeout ≠ כישלון: סקר-שרשרת לפי orderid (אותו דפוס של צד-המכירה)
          let landed = false;
          for (let poll = 0; poll < 3 && !landed; poll++) {
            await new Promise((r) => setTimeout(r, 8000));
            try {
              const os = await new Promise<any[]>((resolve, reject) =>
                quiet(
                  steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
                    err ? reject(err) : resolve(res ?? []),
                  ),
                ),
              );
              const found = os.find((o: any) => Number(o.orderid) === orderid);
              if (found) {
                landed = true;
                receipt.placed.push({ orderid, sell: sbd, receive: steemOut, price: Math.round(effPrice * 1e6) / 1e6, txid: null, confirmedBy: "chain-read" });
              }
            } catch {
              /* סקר שנכשל לא מזיז כלום — השופט הסופי הוא ה-verify בסוף */
            }
          }
          if (!landed) noteError(`rebid place ${i + 1}: ${String((e as Error).message).slice(0, 100)}`);
        }
        persist(); // קבלה אחרי כל הצבה
        await new Promise((r) => setTimeout(r, 400));
      }
    } else if (bidStale) {
      // כנות: הבידים מיושנים אך המלאי החמוש לא מכסה רמה אחת ברת-הצבה — נשארים, נמדד
      noteError(`rebid: בידים מיושנים אך מלאי-החימוש קטן מרמה אחת (${potentialCommitable.toFixed(3)} SBD) — צד-הקנייה נשאר כמותו`);
    }

    // אימות-סוף מהשרשרת — השופט. אישורי-שידור יכולים להתעכב מעבר לתקרה
    // בזמן שהשרשרת כבר קיבלה את הפקודה (נמדד) — לכן קריטריון ההצלחה
    // הוא מה שפתוח שם באמת, לא מונה האישורים.
    let verify: { ordersNow: number; deployedNow: number; bidsNow?: number } | null = null;
    try {
      const after = await new Promise<any[]>((resolve, reject) =>
        quiet(
          steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
            err ? reject(err) : resolve(res ?? []),
          ),
        ),
      );
      // R97: deployedNow סופר מכירות בלבד (STEEM); הצעות הקנייה נספרות בנפרד.
      // r190 · ספירת-מוביל בלבד — פקודות-הגריד (הטווח השמור) אינן הישג-ידו של המוביל
      // ולא נספרות בהישג-הפעולה שלו; ordersNow נשאר אמת-החשבון המלאה (ראיה שקופה).
      const sells = after
        .filter((o: any) => String(o.sell_price?.base ?? "").trim().endsWith("STEEM"))
        .filter((o: any) => !isGridOrder(o.orderid));
      const bids = after
        .filter((o: any) => String(o.sell_price?.base ?? "").trim().endsWith("SBD"))
        .filter((o: any) => !isGridOrder(o.orderid));
      verify = {
        ordersNow: after.length,
        deployedNow: Math.round(sells.reduce((s: number, o: any) => s + Number(o.for_sale) / 1000, 0) * 1000) / 1000,
        bidsNow: bids.length,
      };
    } catch {
      /* אימות הוא שכבת-עדות — כשלו אינו מזים את הקבלה */
    }
    receipt.verify = verify ?? undefined;
    persist();
    swrInvalidate(SWR_KEY);
    await settleGate(
      gate.id,
      "EXECUTED",
      issuedBy === "operator" ? "operator" : "policy:autonomous",
      { placed: receipt.placed.length, cancelled: receipt.cancelled.length, verify, gateUsd },
    );
    const chainOk = bidOnly ? (verify?.bidsNow ?? 0) > 0 : (verify?.deployedNow ?? 0) > 0;
    return NextResponse.json({
      ok: chainOk || receipt.placed.length > 0,
      receipt,
      verify,
      receiptPersisted,
      he: (bidOnly
        ? `תחזוקת צד-הקנייה (BID-ONLY · דלק-מכירה אפס על-פי R111): ${receipt.placed.length} הוצבו · ${receipt.cancelled.length} בוטלו · בידים חיות בשרשרת: ${verify?.bidsNow ?? "?"}`
        : chainOk
        ? `הסולם חי בשרשרת (נמדד): ${verify?.ordersNow} פקודות / ${verify?.deployedNow} STEEM · פאריטה ${parity.toFixed(4)}–${(parity * 1.02).toFixed(4)} · בוטלו ${receipt.cancelled.length}`
        : `הוצבו ${receipt.placed.length} רמות · בוטלו ${receipt.cancelled.length} · אימוש שרשרת לא נקרא`) + (receiptPersisted ? "" : " · אזהרה: כתיבת הקבלה לדיסק נכשלה — הראיה על השרשרת בלבד"),
    });
  } catch (e) {
    receipt.error = String((e as Error).message).slice(0, 300);
    const persisted = appendReceipt(receipt);
    return bad(`הפעולה נכשלה בכנות: ${receipt.error.slice(0, 160)}`, 502, { code: "EXECUTE-FAILED", receipt, receiptPersisted: persisted });
  }
}
