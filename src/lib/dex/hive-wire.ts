// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Hive Wire — חוק-החוט הנעלם (R99 · נבנה מחדש בקנון R101)
//
// החוק (נמדד ב-R99 מול שחזור חתימות אמיתיות מהשרשרת, הוכח בפקודות
// אמת עם txids ומילויים): HIVE מסדרת נכסי-מורשת תחת שמות-האב —
// "HIVE" על החוט = הבייטים של "STEEM", "HBD" = "SBD" (OBSOLETE /
// OBD_SYMBOL_SER — טריק התאימות של הפיצול). steem-js כותב את השם
// המילולי → digest שגוי → "missing required active authority" על
// מפתח נכון. התיקון: חתימה על הצורה הממופה, שידור בשמות האמיתיים —
// הצומת מסדר לאותם בייטים והחתימה עוברת.
//
// רשות: ACTIVE (limit_order_create/cancel הם אופי-כסף). המפתח נגזר
// מסיסמת-האב של המפעיל (upload/headcorner.txt) ומאומת ביט-מול-ביט מול
// השרשרת לפני כל שידור — לעולם לא מודפס, לא נכנס לגיט, לא נשמר.
// ─────────────────────────────────────────────────────────────────────

import steem from "steem";
import {
  HIVE_RPC,
  HIVE_CHAIN_ID,
  getDgp,
  rpcV4,
  hiveRcGate,
} from "@/lib/weave/graphene";

export const HIVE_ASSET_PRECISION = 3; // HIVE/HBD — אותן 3 ספרות כמו STEEM/SBD

/** פורמט סכום-נכס לחוט: 3 ספרות + שם (0.022 HBD) */
export function fmtAsset(amount: number, symbol: "HIVE" | "HBD"): string {
  return `${amount.toFixed(HIVE_ASSET_PRECISION)} ${symbol}`;
}

/** חוק-החוט: מיפוי שמות-נכסים לצורת-החתימה (HIVE→STEEM, HBD→SBD) —
 *  ההליכה עמוקה ובטוחה: מחרוזות "N HIVE"/"N HBD" בלבד מוחלפות. */
export function toDigestForm<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(
      /^(\d+(?:\.\d+)?) (HIVE|HBD)$/,
      (_m, n: string, sym: string) => `${n} ${sym === "HIVE" ? "STEEM" : "SBD"}`,
    ) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => toDigestForm(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toDigestForm(v);
    }
    return out as unknown as T;
  }
  return value;
}

export type GrapheneOp = [string, Record<string, unknown>];

/** בניית limit_order_create ל-HIVE (שמות אמיתיים — לשידור) */
export function hiveLimitOrder(
  seller: string,
  orderid: number,
  amountToSell: string, // "0.415 HIVE" או "0.011 HBD"
  minToReceive: string,
  expirationIso: string,
): GrapheneOp {
  return [
    "limit_order_create",
    {
      owner: seller,
      orderid,
      amount_to_sell: amountToSell,
      min_to_receive: minToReceive,
      fill_or_kill: false,
      expiration: expirationIso,
    },
  ];
}

/** בניית limit_order_cancel (אין נכסים — החוק לא נוגע) */
export function hiveCancel(owner: string, orderid: number): GrapheneOp {
  return ["limit_order_cancel", { owner, orderid }];
}

export interface HiveBroadcastResult {
  txid: string | null;
  accepted: boolean;
  note?: string;
}

/** השידור על פי חוק-החוט: חתימה על הצורה הממופה, שידור בשמות אמיתיים. */
export async function hiveSendMarket(
  ops: GrapheneOp[],
  wif: string,
): Promise<HiveBroadcastResult> {
  try {
    // שער ה-RC (דפוס 103 — דילוג-כנה, לא כשל)
    const owner = String(ops[0]?.[1]?.owner ?? "headcorner");
    const rc = await hiveRcGate(owner);
    if (!rc.ok) {
      return { txid: null, accepted: false, note: rc.reason };
    }
    const dgp = await getDgp(HIVE_RPC);
    const tx = {
      ref_block_num: dgp.head_block_number & 0xffff,
      ref_block_prefix: Buffer.from(dgp.head_block_id, "hex").readUInt32LE(4),
      expiration: new Date(new Date(dgp.time + "Z").getTime() + 60_000)
        .toISOString()
        .slice(0, 19),
      operations: toDigestForm(ops), // ← חוק-החוט: החתימה על הבייטים של האב
      extensions: [] as unknown[],
    };
    const prev = steem.config.get("chain_id");
    steem.config.set("chain_id", HIVE_CHAIN_ID);
    let signed: Record<string, unknown>;
    try {
      signed = steem.auth.signTransaction(tx, [wif]) as unknown as Record<string, unknown>;
    } finally {
      steem.config.set("chain_id", prev);
    }
    // השידור בשמות האמיתיים — הצומת מסדר לאותם בייטים של האב, החתימה עוברת
    const broadcast = { ...signed, operations: ops };
    await rpcV4(HIVE_RPC, "condenser_api.broadcast_transaction", [broadcast]);
    return { txid: null, accepted: true, note: "broadcast-accepted (history is the judge)" };
  } catch (e) {
    return {
      txid: null,
      accepted: false,
      note: String((e as Error).message || e).slice(0, 160),
    };
  }
}

// ── מדידה חיה של הרגל ────────────────────────────────────────────────

export interface HiveOrderRow {
  orderid: number;
  created: string;
  expiration: string;
  forSale: string; // "0.022 HBD" — מה שמוצע למכירה
  forSaleNum: number;
  forSaleSymbol: "HIVE" | "HBD";
  receiveNum: number;
  receiveSymbol: "HIVE" | "HBD";
  price: number; // HBD per HIVE (מנורמל)
}

export interface HiveFillRow {
  at: string;
  paid: string;
  received: string;
}

export interface HiveLegState {
  ok: boolean;
  at: string;
  account: string;
  balances: { hive: number; hbd: number };
  orders: HiveOrderRow[];
  book: { bestBid: number | null; bestAsk: number | null; mid: number | null; spreadBps: number | null };
  marks: {
    hiveUsd: number | null;
    hbdUsd: number | null;
    hbdUsdSource: "coingecko" | "implied-from-book" | "none";
    parity: number | null; // HBD per HIVE
  };
  fills: { window24h: number; rows: HiveFillRow[] };
  policy: {
    askOffsetsBps: number[];
    bidOffsetsBps: number[];
    minLevelHive: number;
    minLevelHbd: number;
  };
  rc: { ok: boolean; mana: number; max: number } | null;
  note?: string;
}

/** קריאת הספר הפנימי של HIVE (best bid/ask במחיר HBD-per-HIVE) */
async function readBook(): Promise<HiveLegState["book"]> {
  type Row = { order_price: { base: string; quote: string }; real_price: string };
  const r = await rpcV4<{ bids: Row[]; asks: Row[] }>(
    HIVE_RPC,
    "condenser_api.get_order_book",
    [12],
  ).catch(() => null);
  if (!r?.bids?.length || !r?.asks?.length) {
    return { bestBid: null, bestAsk: null, mid: null, spreadBps: null };
  }
  // bids: base=HBD quote=HIVE; asks: base=HIVE quote=HBD — שניהם למחיר HBD/HIVE
  const bp = (s: string) => parseFloat(s);
  const bestBid = Math.max(...r.bids.map((b) => bp(b.real_price)));
  const bestAsk = Math.min(...r.asks.map((a) => bp(a.real_price)));
  const mid = (bestBid + bestAsk) / 2;
  const spreadBps = mid > 0 ? Math.round(((bestAsk - bestBid) / mid) * 10_000) : null;
  return { bestBid, bestAsk, mid, spreadBps };
}

/** סימני-USD חיים: Binance HIVEUSDT + Coingecko HBD (נפילה → נגזר-מהספר, בכנות) */
async function readMarks(
  book: HiveLegState["book"],
): Promise<HiveLegState["marks"]> {
  let hiveUsd: number | null = null;
  let hbdUsd: number | null = null;
  let hbdUsdSource: HiveLegState["marks"]["hbdUsdSource"] = "none";
  try {
    const r = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbols=%5B%22HIVEUSDT%22%5D",
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    ).then((x) => x.json() as Promise<Array<{ symbol: string; price: string }>>);
    hiveUsd = Number(r?.[0]?.price) || null;
  } catch {
    hiveUsd = null;
  }
  if (hiveUsd == null) {
    try {
      const r = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=hive&vs_currencies=usd",
        { cache: "no-store", signal: AbortSignal.timeout(8000) },
      ).then((x) => x.json() as Promise<{ hive?: { usd?: number } }>);
      hiveUsd = r?.hive?.usd ?? null;
    } catch {
      hiveUsd = null;
    }
  }
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=hive-backed-dollar&vs_currencies=usd",
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    ).then((x) => x.json() as Promise<{ "hive-backed-dollar"?: { usd?: number } }>);
    hbdUsd = r?.["hive-backed-dollar"]?.usd ?? null;
    if (hbdUsd != null) hbdUsdSource = "coingecko";
  } catch {
    hbdUsd = null;
  }
  if (hbdUsd == null && hiveUsd != null && book.mid != null && book.mid > 0) {
    hbdUsd = hiveUsd / book.mid; // נגזר מהספר — כנות מלאה על המקור
    hbdUsdSource = "implied-from-book";
  }
  const parity =
    hiveUsd != null && hbdUsd != null && hbdUsd > 0 ? hiveUsd / hbdUsd : null;
  return { hiveUsd, hbdUsd, hbdUsdSource, parity };
}

/** קריאת מצב הרגל כולו — האמת החיה מהשרשרת ומהשווקים */
export async function readHiveLeg(account = "headcorner"): Promise<HiveLegState> {
  const [accts, openOrders, book] = await Promise.all([
    rpcV4<Array<{ balance: string; hbd_balance: string }>>(
      HIVE_RPC,
      "condenser_api.get_accounts",
      [[account]],
    ).catch(() => null),
    rpcV4<
      Array<{
        orderid: number;
        created: string;
        expiration: string;
        for_sale: number;
        sell_price: { base: string; quote: string };
      }>
    >(HIVE_RPC, "condenser_api.get_open_orders", [account]).catch(() => null),
    readBook(),
  ]);
  const marks = await readMarks(book);

  const balances = accts?.[0]
    ? {
        hive: parseFloat(accts[0].balance) || 0,
        hbd: parseFloat(accts[0].hbd_balance) || 0,
      }
    : { hive: 0, hbd: 0 };

  const orders: HiveOrderRow[] = (openOrders ?? []).map((o) => {
    const base = o.sell_price.base.split(" "); // "0.022 HBD" / "0.412 HIVE"
    const quote = o.sell_price.quote.split(" ");
    const baseNum = Number(base[0]);
    const quoteNum = Number(quote[0]);
    const isBid = base[1] === "HBD"; // מוכר HBD = קונה HIVE
    // price מנורמל ל-HBD-per-HIVE תמיד
    const price = isBid ? baseNum / quoteNum : quoteNum / baseNum;
    return {
      orderid: o.orderid,
      created: o.created,
      expiration: o.expiration,
      forSale: o.sell_price.base,
      forSaleNum: o.for_sale / 1000,
      forSaleSymbol: base[1] as "HIVE" | "HBD",
      receiveNum: quoteNum,
      receiveSymbol: quote[1] as "HIVE" | "HBD",
      price,
    };
  });

  // מילויים בחלון 24ש' — ההיסטוריה השופטת
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const fills: HiveFillRow[] = [];
  try {
    const hist = await rpcV4<
      Array<[number, { timestamp: string; op: [string, Record<string, string>]; trx_id: string }]>
    >(HIVE_RPC, "condenser_api.get_account_history", [account, -1, 200]).catch(() => null);
    for (const [, e] of hist ?? []) {
      if (e.op?.[0] !== "fill_order") continue;
      if (new Date(e.timestamp + "Z").getTime() < cutoff) continue;
      const d = e.op[1];
      fills.push({
        at: e.timestamp,
        paid: d.current_pays,
        received: d.open_pays,
      });
    }
  } catch {
    /* היסטוריה היא עדה — כישלונה לא מפיל את המדידה */
  }

  const rc = await hiveRcGate(account).catch(() => null);

  return {
    ok: Boolean(accts?.length),
    at: new Date().toISOString(),
    account,
    balances,
    orders,
    book,
    marks,
    fills: { window24h: fills.length, rows: fills.slice(-8) },
    policy: {
      askOffsetsBps: [100, 200, 300],
      bidOffsetsBps: [100, 200, 300],
      minLevelHive: 0.02, // לקח R99: רמות אבק מתחת ל-0.02 HIVE מעוותות מחיר
      minLevelHbd: 0.001,
    },
    rc: rc ? { ok: rc.ok, mana: rc.mana, max: rc.max } : null,
  };
}
