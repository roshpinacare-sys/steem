// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Sovereign Exchange — זירת-המסחר הריבונית (R102)
//
// הוראת המפעיל: "להפוך את השוק שלנו לחי אמיתי תוך שילוב והפקה של מה
// שצריך כדי לגרום לזרימה אמיתית וטיפול ראוי במטבעות הפנימיים שלנו כדי
// לשמור על הערך שלהם ועדיין לייצר יכולת להחליף אותם ולשמש אותם עבור
// המערכת ליצירת ערך."
//
// החוקה (מנגנון, לא הבטחה):
//   · ספר-פנים hash-chained — entryHash = keccak(prevHash‖seq‖kind‖member‖
//     payload) — אותה שיטת ספר של האימותים והשוק; כל פעולה קנונית וניתנת
//     לחישוב-חדש מה-DB.
//   · נכסים-עטופים 1:1 — WSTEEM/WSBD/WHIVE/WHBD/WBLURT נזקפים רק מול
//     הפקדות אמיתיות (רייל-המזכר "wx:<member>") או מהון-אוצר נמדד;
//     המשיכה שורפת את העטיפה ומשדררת העברה אמיתית בשרשרת.
//   · USDS בגיבוי-רזרבה מלא — הטבעה רק מול נעילת SBD/HBD (1:1), פדיון
//     שורף 1:1. היצע = רזרבה, תמיד. שמירת-הערך במבנה, לא בהבטחה.
//   · בריכות AMM קבועות-מכפלה — עמלת 30bps נשארת בתוך הבריכה (ערך
//     ה-LP של האוצר צומח מהעמלות): "העמלות ייגזרו בבריכות שלנו".
//   · שער-$100 — משיכה מתחת לסף מבוצעת אוטונומית; מהסף — תור-מפעיל.
//
// כנות מובנית: עומק הבריכות = ההון הריאלי הפנוי בלבד. הזירה לא מציגה
// נזילות שאיננה; היא מציגה מנגנון אמיתי שגדל ממילויי-גריד והפקדות.
// ─────────────────────────────────────────────────────────────────────

import { createRequire } from "node:module";
import path from "node:path";
import { db } from "@/lib/db";
import { hashText } from "@/lib/weave/chain";
import { steemBroadcast, rpcV4, STEEM_RPC_NODES, HIVE_RPC, HIVE_CHAIN_ID, signGrapheneTx } from "@/lib/weave/graphene";
import { openVaultKey } from "@/lib/dex/wallet-vault";
import { blurtSendTransfer, BLURT_RPC } from "@/lib/dex/blurt-wire";
import { evaluateGate, settleGate } from "@/lib/weave/tx-gate";
import { saosLiveTransferOut, foldLiveState } from "@/lib/weave/saos-rail";
import { solSend, solBalance, solRpc, decodeBase58Utf8, isValidSolPubkey, SOL_TREASURY_PUB } from "@/lib/dex/sol-wire";
import { ethSend, ethBalanceOf, ETH_TREASURY_ADDR } from "@/lib/dex/evm-wire";
import { spotUsdAll } from "@/lib/dex/price-feeds";
import { chainGuard, chainLog, chainState, type ChainName } from "@/lib/weave/trigger-chain";
import { evaluateBrake, brakeLogLine } from "@/lib/cognition/brake"; // R30b: הבלם גם-בכל-נתיבי-המשיכה (Adversary-A census fix)

const HOME = "/home/z/my-project";
const nodeRequire = createRequire(path.join(HOME, "package.json"));
const steem = nodeRequire("steem") as {
  auth: { toWif(a: string, p: string, r: string): string };
  broadcast: { sendAsync(tx: unknown, keys: string[]): Promise<{ id?: string }> };
};
const fs = nodeRequire("node:fs") as typeof import("node:fs");

const TREASURY = "headcorner"; // חשבון-האוצר על השרשרת (המפעיל)
const FEE_BPS = 30; // 0.3% — העמלה שלנו בבריכה שלנו
const KEEP_FUEL_RATIO = 0.1; // 10% מהנוזלי נשמר כדלק-שידור (חוק שימור-הון)
const ARM_KEEP_SBD = 0.15; // R107 — קו-החימוש: SBD מתחת לזה שייך לצד-הקנייה של הגריד, לא להטבעה
export const EXCHANGE_ASSETS = ["WSTEEM", "WSBD", "WHIVE", "WHBD", "WBLURT", "WSOL", "WETH", "USDS", "SAOS"] as const;
export type ExchangeAsset = (typeof EXCHANGE_ASSETS)[number];

// ── ספר hash-chained ────────────────────────────────────────────────

export interface ChainedEvent {
  seq: number;
  kind: string;
  member: string;
  payload: string;
  prevHash: string;
  hash: string;
}

async function lastEvent(): Promise<ChainedEvent | null> {
  const r = await db.exchangeEvent.findFirst({ orderBy: { seq: "desc" } });
  return r ? { seq: r.seq, kind: r.kind, member: r.member, payload: r.payload, prevHash: r.prevHash, hash: r.hash } : null;
}

async function chainEvent(kind: string, member: string, payload: Record<string, unknown>, usdValue: number | null): Promise<ChainedEvent> {
  const prev = await lastEvent();
  const seq = (prev?.seq ?? 0) + 1;
  const canonical = JSON.stringify(payload);
  const hash = hashText(`${prev?.hash ?? "0"}|${seq}|${kind}|${member}|${canonical}`);
  const row = await db.exchangeEvent.create({
    data: {
      seq,
      kind,
      member,
      payload: canonical,
      prevHash: prev?.hash ?? "0",
      hash,
      ...(usdValue != null ? { usdValue } : {}),
    },
  });
  return { seq: row.seq, kind: row.kind, member: row.member, payload: row.payload, prevHash: row.prevHash, hash: row.hash };
}

async function eventExists(kind: string, txid: string): Promise<boolean> {
  const n = await db.exchangeEvent.count({ where: { kind, payload: { contains: txid } } });
  return n > 0;
}

// ── R128 — מגע-ראשון: חיישן פער הלקוחות ─────────────────────────────
// ממצא 2-d: לקוח/מבקר חיצוני בזירה — אפס מטפל, אין מדידה. ההפקדה
// הראשונה של חשבון חיצוני היא המדד-המוביל של פער הלקוחות (r127:
// "אפס לקוחות" נטען אך לא נמדד). אירוע FIRST-TOUCH נכתב פעם אחת
// לכל חשבון — השוואת חברים ברשתות-הגרפן (steem/hive/blurt חולקות
// מרחב-שמות) וכתובות-האוצר של SOL/ETH לא נספרות כלקוחות (הפקדה
// עצמית אינה מגע-לקוח). חשבונות חוץ שהפקידו לפני החיישן אינם
// נספרים כחדשים — הבדיקה רואה גם את רישומי ההיסטוריה.

/** חשבונות הרשת שלנו — הפקדה מהם היא העברה פנימית, לא מגע-לקוח */
const FIRST_TOUCH_EXCLUDE = new Set(["headcorner", "cashmachine", "haran", "lsa", "macrame", "saos"]);

/** האם חשבון-חוץ נראה כבר בספר? שתי בדיקות: אירוע FIRST-TOUCH קיים
 *  לחשבון (member מדויק), או רישום הפקדה היסטורי שנושא את החשבון
 *  ב-payload. הבדיקה חייבת לרוץ לפני כתיבת זיכוי-ההפקדה של
 *  אותו חשבון — אחרת האירוע שלנו עצמו היה "רואה" אותו. */
async function accountSeenBefore(account: string): Promise<boolean> {
  if (!account) return true; // אין חשבון למדידה — לא מגע-ראשון (כנות)
  const touched = await db.exchangeEvent.findFirst({ where: { kind: "FIRST-TOUCH", member: account } });
  if (touched) return true;
  const n = await db.exchangeEvent.count({
    where: { kind: "DEPOSIT_CREDIT", payload: { contains: `"from":"${account}"` } },
  });
  return n > 0;
}

/** בדיקת-קריאה בלבד: האם ההפקדה הזאת היא מגע-ראשון של החשבון? */
async function isFirstTouchCandidate(chain: string, account: string): Promise<boolean> {
  if (!account) return false;
  if (chain !== "solana" && chain !== "ethereum" && FIRST_TOUCH_EXCLUDE.has(account)) return false;
  if (account === SOL_TREASURY_PUB) return false;
  if (account.toLowerCase() === ETH_TREASURY_ADDR.toLowerCase()) return false;
  return !(await accountSeenBefore(account));
}

/** כתיבת אירוע המגע-הראשון — member = החשבון החיצוני (מפתח
 *  האידמפוטנטיות המדויק לשאילתא). usdValue null: זהו מדד-לקוח,
 *  לא סכום-כסף. */
async function writeFirstTouch(chain: string, account: string, member: string, asset: ExchangeAsset, amount: number): Promise<void> {
  await chainEvent("FIRST-TOUCH", account, {
    account, chain, member, asset, amount,
    note: `מגע-ראשון — ההפקדה הראשונה של ${account} (${chain}) לזירה, במזכיר wx:${member}`,
  }, null);
}

// ── מאזנים ───────────────────────────────────────────────────────────

type Balances = Partial<Record<ExchangeAsset, number>>;

async function getAccountRow(member: string) {
  let row = await db.exchangeAccount.findUnique({ where: { member } });
  if (!row) row = await db.exchangeAccount.create({ data: { member, balances: "{}" } });
  return row;
}

async function readBalances(member: string): Promise<Balances> {
  const row = await getAccountRow(member);
  try { return JSON.parse(row.balances) as Balances; } catch { return {}; }
}

async function writeBalances(member: string, b: Balances): Promise<void> {
  const clean: Balances = {};
  for (const [k, v] of Object.entries(b)) if (v && v > 0) clean[k as ExchangeAsset] = v;
  // upsert — השורה עשויה להיווצר כאן לראשונה (ג'נזיס/הפקדה ראשונה)
  await db.exchangeAccount.upsert({
    where: { member },
    create: { member, balances: JSON.stringify(clean) },
    update: { balances: JSON.stringify(clean) },
  });
}

async function adjust(member: string, asset: ExchangeAsset, delta: number): Promise<number> {
  const b = await readBalances(member);
  const next = Math.round(((b[asset] ?? 0) + delta) * 1e9) / 1e9; // דיוק נאיבי של µ
  if (next < -1e-9) throw new Error(`INSUFFICIENT: ל-${member} אין מספיק ${asset}`);
  b[asset] = next;
  await writeBalances(member, b);
  return next;
}

// ── מדידות חיות (הזנת הג'נזיס והתצוגה) ───────────────────────────────

export interface TreasuryMeasure {
  steem: number;
  sbd: number;
  hive: number;
  hbd: number;
  blurt: number;
  sol: number;
  eth: number;
  rpc: { steem: boolean; hive: boolean; blurt: boolean; sol: boolean; eth: boolean };
  at: string;
}

async function measureTreasury(): Promise<TreasuryMeasure | null> {
  try {
    const steemAcct = await rpcV4<Array<{ balance: string; sbd_balance: string }>>(
      STEEM_RPC_NODES[0], "condenser_api.get_accounts", [[TREASURY]],
    );
    const hiveAcct = await rpcV4<Array<{ balance: string; hbd_balance: string }>>(
      HIVE_RPC, "condenser_api.get_accounts", [[TREASURY]],
    ).catch(() => null);
    const blurtAcct = await fetch("https://rpc.blurt.blog", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "saos-weave-rail/1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [[TREASURY]] }),
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.json() as Promise<{ result?: Array<{ balance: string }> }>).catch(() => null);
    // R105 — רגלי העולם הלא-גרפן: אוצר SOL/ETH = cashmachine (שם ההון חי,
    // אותו מפתח-אב; כתובות ציבוריות — אין בהן סוד)
    const [solBal, ethBal] = await Promise.all([
      solBalance(SOL_TREASURY_PUB),
      ethBalanceOf(ETH_TREASURY_ADDR),
    ]);
    if (!steemAcct || !steemAcct.length) return null;
    return {
      steem: parseFloat(steemAcct[0].balance) || 0,
      sbd: parseFloat(steemAcct[0].sbd_balance) || 0,
      hive: hiveAcct?.[0] ? parseFloat(hiveAcct[0].balance) || 0 : 0,
      hbd: hiveAcct?.[0] ? parseFloat(hiveAcct[0].hbd_balance) || 0 : 0,
      blurt: blurtAcct?.result?.[0] ? parseFloat(blurtAcct.result[0].balance) || 0 : 0,
      sol: solBal.error ? 0 : solBal.sol,
      eth: ethBal.error ? 0 : ethBal.eth,
      rpc: { steem: true, hive: !!hiveAcct, blurt: !!blurtAcct?.result, sol: !solBal.error, eth: !ethBal.error },
      at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// R108 — מטמון-מחירים מרובה: CoinGecko בתעריף-חינמי חוסם 429 לסירוגין
// (בדיוק כמו Binance ב-R105). כל טעינת-מראה של הבראוזר שרפה את המנה —
// עכשיו מטמון 5 דקות מגן על המכסה ומשמר את המדידה האחרונה הטובה
// מכל מקור (מקור חלקי מקבל שדה שנעלם מהתשובה החדשה).
const PRICE_CACHE_TTL_MS = 5 * 60_000;
let priceCache: { at: number; prices: Record<string, number | null> } | null = null;

async function pricesUsdRaw(): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = { steem: null, sbd: null, hive: null, hbd: null, blurt: null, sol: null, eth: null };
  // R105 — מקורות-מחיר עמידים: Binance ← Gate ← OKX (לקח חי
  // מהשטח: איסור-418 זמני של Binance השתק מדיה). מקור יחיד = חוסק-פעילות מובנה.
  try {
    const feeds = await spotUsdAll(["STEEMUSDT", "HIVEUSDT", "SOLUSDT", "ETHUSDT"]);
    const map: Record<string, keyof typeof out> = {
      STEEMUSDT: "steem", HIVEUSDT: "hive", SOLUSDT: "sol", ETHUSDT: "eth",
    };
    for (const [pair, key] of Object.entries(map)) {
      const f = feeds[pair];
      if (f?.price != null) out[key] = f.price as number;
    }
  } catch { /* כנות: לא נמדד */ }
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=steem-dollars,hive-backed-dollar,blurt&vs_currencies=usd", {
      headers: { "User-Agent": "saos-weave-rail/1.0" }, // חוק-הענן (R103): בלי UA חוסם
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as Record<string, { usd?: number }>;
    if (j["steem-dollars"]?.usd) out.sbd = j["steem-dollars"].usd;
    if (j["hive-backed-dollar"]?.usd) out.hbd = j["hive-backed-dollar"].usd;
    if (j.blurt?.usd) out.blurt = j.blurt.usd;
  } catch { /* כנות: לא נמדד */ }
  // נתיב-ריבוני: גזירת SBD/HBD מפריטת השוק הפנימי החי — השוק שלנו הוא המקור.
  // 1 STEEM = P SBD (real_price מ-market_history_api) ו-STEEM=$X (בינאנס) ⟹ SBD = $X/P.
  if (out.sbd == null && out.steem != null) {
    try {
      const book = await rpcV4<{ bids?: Array<{ real_price?: string }>; asks?: Array<{ real_price?: string }> }>(
        STEEM_RPC_NODES[0], "market_history_api.get_order_book", { limit: 5 },
      );
      const bestBid = Number(book?.bids?.[0]?.real_price ?? 0);
      const bestAsk = Number(book?.asks?.[0]?.real_price ?? 0);
      if (bestBid > 0 && bestAsk > 0) {
        const parity = (bestBid + bestAsk) / 2; // SBD per STEEM
        if (parity > 0) out.sbd = out.steem / parity;
      }
    } catch { /* נשאר null — כנות */ }
  }
  if (out.hbd == null && out.hive != null) {
    try {
      const book = await rpcV4<{ bids?: Array<{ real_price?: string }>; asks?: Array<{ real_price?: string }> }>(
        HIVE_RPC, "market_history_api.get_order_book", { limit: 5 },
      );
      const bestBid = Number(book?.bids?.[0]?.real_price ?? 0);
      const bestAsk = Number(book?.asks?.[0]?.real_price ?? 0);
      if (bestBid > 0 && bestAsk > 0) {
        const parity = (bestBid + bestAsk) / 2; // HBD per HIVE
        if (parity > 0) out.hbd = out.hive / parity;
      }
    } catch { /* נשאר null — כנות */ }
  }
  return out;
}

/** מטריצת-המטמון: קריאות מורדות מקבלות את המדידה הטרייה; מקור-מידה אחד לכל 5 דקות.
 *  r192-c — מיוצאת לשער-הסוכנים (/api/exchange/agent): נוטינאל-עסקה ב-$ לקפסות
 *  L4 ולעמלת-x402 מוצהרת נמדדים מאותה מטריצה — מדידה אחת לכל הנתיבים. */
export async function pricesUsd(): Promise<Record<string, number | null>> {
  if (priceCache && Date.now() - priceCache.at < PRICE_CACHE_TTL_MS) return priceCache.prices;
  const fresh = await pricesUsdRaw();
  // מיזוג כן: שדה שנעלם במקור הטרי אבל היה חי במטמון — משומר (מדידה טרייה עדיפה על אין-מדידה)
  if (priceCache) {
    for (const [k, v] of Object.entries(priceCache.prices)) {
      if (v != null && fresh[k] == null) fresh[k] = v;
    }
  }
  priceCache = { at: Date.now(), prices: fresh };
  return fresh;
}

// ── ג'נזיס — זריעה מהון-אוצר נמדד בלבד ────────────────────────────────

let genesisPromise: Promise<boolean> | null = null;

export async function ensureExchange(): Promise<boolean> {
  if (!genesisPromise) {
    genesisPromise = doGenesis().catch(() => false);
    // כשל ג'נזיס (RPC למשל) — לא נשמר במטמון: הקריאה הבאה מנסה שוב בכנות
    genesisPromise.finally(() => {
      void genesisPromise?.then((ok) => {
        if (!ok) genesisPromise = null;
      });
    });
  }
  return genesisPromise;
}

async function doGenesis(): Promise<boolean> {
  const existing = await db.exchangeEvent.findFirst({ where: { kind: "GENESIS" } });
  if (existing) return true;
  const m = await measureTreasury();
  if (!m) return false; // אין מדידה — אין ג'נזיס (כנות: ננסה שוב בקריאה הבאה)
  const usable = 1 - KEEP_FUEL_RATIO;
  // 1) האוצר נזקף בנכסים-עטופים מול ההון הנמדד (90% — 10% דלק)
  const wSteem = Math.floor(m.steem * usable * 1000) / 1000;
  const wSbd = Math.floor(m.sbd * usable * 1000) / 1000;
  const wHive = Math.floor(m.hive * usable * 1000) / 1000;
  const wHbd = Math.floor(m.hbd * usable * 1000) / 1000;
  const wBlurt = Math.floor(m.blurt * 1) / 1; // BLURT — אין דלק-שידור, הכל נזקף
  await chainEvent("GENESIS", "treasury", {
    what: "זירת-המסחר הריבונית — ספר hash-chained, גיבוי-רזרבה מלא ל-USDS, AMM בעמלת-אוצר",
    measured: m,
    wrappedCredits: { WSTEEM: wSteem, WSBD: wSbd, WHIVE: wHive, WHBD: wHbd, WBLURT: wBlurt },
    keepFuelRatio: KEEP_FUEL_RATIO,
    saosBacking: "126,682 SAOS על שרשרת SAOS-LIVE (headcorner) — התביעה הפנימית נגזרת ממנה",
  }, null);
  await writeBalances("treasury", {
    WSTEEM: wSteem, WSBD: wSbd, WHIVE: wHive, WHBD: wHbd, WBLURT: wBlurt, SAOS: 126682,
  });
  // 2) USDS ג'נזיס — הטבעה מול נעילת SBD (עד 80% מה-WSBD שנזקף — השאר לבריכת ה-SBD/STEEM)
  const lockSbd = Math.floor(wSbd * 0.8 * 1000) / 1000;
  if (lockSbd > 0) {
    await adjust("treasury", "WSBD", -lockSbd);
    await adjust("reserve", "WSBD", lockSbd);
    await chainEvent("USDS_MINT", "treasury", { lockedSbd: lockSbd, mintedUsds: lockSbd, rate: "1:1" }, null);
    await adjust("reserve", "USDS", lockSbd);
    await adjust("treasury", "USDS", lockSbd);
  }
  // 3) זריעת בריכות מהאוצר — מחירי-פתיחה מוכרזים, השוק יכריע מכאן
  await seedPool("SAOS/USDS", "SAOS", "USDS", 400, Math.min(0.02, lockSbd / 2 || 0.001));
  await seedPool("WBLURT/USDS", "WBLURT", "USDS", Math.min(8, wBlurt), Math.min(0.008, lockSbd / 4 || 0.0004));
  await seedPool("WSTEEM/WSBD", "WSTEEM", "WSBD", Math.min(0.2, wSteem), Math.min(0.022, wSbd - lockSbd));
  return true;
}

async function seedPool(pair: string, assetA: string, assetB: string, amtA: number, amtB: number): Promise<void> {
  if (!(amtA > 0) || !(amtB > 0)) {
    await db.exchangePool.upsert({
      where: { pair },
      create: { pair, assetA, assetB, reserveA: 0, reserveB: 0, feeBps: FEE_BPS },
      update: {},
    });
    return;
  }
  await adjust("treasury", assetA as ExchangeAsset, -amtA);
  await adjust("treasury", assetB as ExchangeAsset, -amtB);
  await db.exchangePool.upsert({
    where: { pair },
    create: { pair, assetA, assetB, reserveA: amtA, reserveB: amtB, feeBps: FEE_BPS },
    update: { reserveA: amtA, reserveB: amtB },
  });
  await chainEvent("LP_SEED", "treasury", { pair, assetA, assetB, reserveA: amtA, reserveB: amtB, note: "זריעת-פתיחה מהון-אוצר נמדד; ערך ה-LP של האוצר" }, null);
}

// ── R105 — חיבור העולם הלא-גרפן: WSOL/WETH בזירה ─────────────────────

let networkAddPromise: Promise<boolean> | null = null;

/**
 * הרחבת-ג'נזיס לרשתות הלא-גרפניות, אידמפוטנטית לנצח (הספר שופט).
 *
 * ההון הקיים של cashmachine ב-SOL/ETH (אותו מפתח-אב) נזקף לאוצר
 * ב-WSOL (90% — 10% דלק-אגרה) וב-WETH (אבק → אפס נזקף, בכנות).
 * קווי-הבסיס להזרמה נקבעים באותו רגע — רק תזרים עתידי יוזרם לעומק.
 */
export async function ensureNetworkAdd(): Promise<boolean> {
  if (!networkAddPromise) {
    networkAddPromise = doNetworkAdd().catch(() => false);
    networkAddPromise.finally(() => {
      void networkAddPromise?.then((ok) => {
        if (!ok) networkAddPromise = null; // כישלון מדידה — ניסיון חדש בקריאה הבאה
      });
    });
  }
  return networkAddPromise;
}

async function doNetworkAdd(): Promise<boolean> {
  const existing = await db.exchangeEvent.findFirst({ where: { kind: "NETWORK_ADD" } });
  if (existing) return true;
  const m = await measureTreasury();
  if (!m) return false; // אין מדידה — אין חיבור (כנות; הקריאה הבאה תנסה שוב)
  const usable = 1 - KEEP_FUEL_RATIO;
  const wSol = Math.floor(m.sol * usable * 1e9) / 1e9;
  const wEth = 0; // ETH אבק — הדלת חיה, ההון לא; אפס נזקף בכנות
  await chainEvent("NETWORK_ADD", "treasury", {
    what: "העולם הלא-גרפן מתחבר לזירה — WSOL/WETH נכסי-זירה, דלתות הפקדה בחמש רשתות, ריילי משיכה",
    // r125a · חשיפת דגל ה-rpc: sol/eth=0 עם rpc-down אינו "אפס נמדד" —
    // הקנון מבחין בין הון-אפס אמיתי לבין רגל שלא נמדדה.
    measured: { sol: m.sol, eth: m.eth, rpc: { sol: m.rpc.sol, eth: m.rpc.eth } },
    credited: { WSOL: wSol, WETH: wEth },
    treasurySolAccount: "cashmachine",
    treasuryEthAccount: "cashmachine",
    keepFuelRatio: KEEP_FUEL_RATIO,
    honesty: m.eth > 0 && wEth === 0 ? `ETH=${m.eth.toPrecision(4)} — אבק; נזקף 0 WETH. הדלת חיה, ההון עוד לא הגיע` : undefined,
  }, null);
  if (wSol > 0) await adjust("treasury", "WSOL", wSol);
  // קווי-בסיס להזרמה: ההון הקיים נזקף לעיל — רק תזרים עתידי יוזרם
  await chainEvent("TREASURY_WRAP", "treasury", {
    asset: "sol", wrap: "WSOL", amount: 0, measuredBalance: m.sol, baseline: 0, delta: 0, share: 0,
    note: "קו-בסיס NETWORK_ADD — ההון הקיים נזקף לאוצר; רק תזרים עתידי יוזרם לעומק",
  }, null);
  await chainEvent("TREASURY_WRAP", "treasury", {
    asset: "eth", wrap: "WETH", amount: 0, measuredBalance: m.eth, baseline: 0, delta: 0, share: 0,
    note: "קו-בסיס NETWORK_ADD",
  }, null);
  return true;
}

// ── AMM ──────────────────────────────────────────────────────────────

export interface SwapQuote {
  pair: string;
  side: "A2B" | "B2A";
  amountIn: number;
  minOut: number;
  expectedOut: number;
  price: number;
  feeBps: number;
  reserveA: number;
  reserveB: number;
  usdValue: number | null;
}

export interface SwapResult {
  ok: boolean;
  detail: string;
  event?: ChainedEvent;
  quote?: SwapQuote;
  txid?: string | null;
}

export async function quoteSwap(pair: string, side: "A2B" | "B2A", amountIn: number): Promise<SwapQuote | { ok: false; detail: string }> {
  const pool = await db.exchangePool.findUnique({ where: { pair } });
  if (!pool) return { ok: false, detail: "NO-POOL: הבריכה לא נזרעה" };
  const { reserveA, reserveB } = pool;
  if (reserveA <= 0 || reserveB <= 0) return { ok: false, detail: "EMPTY-POOL: אין רזרבות — הבריכה ממתינה להפקדה" };
  if (!(amountIn > 0)) return { ok: false, detail: "BAD-AMOUNT" };
  const inA = side === "A2B";
  const rIn = inA ? reserveA : reserveB;
  const rOut = inA ? reserveB : reserveA;
  const inWithFee = amountIn * (10000 - pool.feeBps);
  const out = (rOut * inWithFee) / (rIn * 10000 + inWithFee);
  const prices = await pricesUsd();
  const assetIn = inA ? pool.assetA : pool.assetB;
  const priceKey = assetIn === "WSTEEM" ? "steem" : assetIn === "WSBD" ? "sbd" : assetIn === "WHIVE" ? "hive" : assetIn === "WHBD" ? "hbd" : assetIn === "WBLURT" ? "blurt" : null;
  const usdValue = priceKey ? (prices[priceKey] ?? null) ? amountIn * (prices[priceKey] as number) : null : null;
  return {
    pair, side, amountIn,
    minOut: 0,
    expectedOut: Math.floor(out * 1e9) / 1e9,
    price: rOut / rIn,
    feeBps: pool.feeBps,
    reserveA, reserveB,
    usdValue,
  };
}

export async function swap(params: {
  member: string;
  pair: string;
  side: "A2B" | "B2A";
  amountIn: number;
  minOut?: number;
}): Promise<SwapResult> {
  try {
    const q = await quoteSwap(params.pair, params.side, params.amountIn);
    if (!("expectedOut" in q)) return { ok: false, detail: (q as { detail: string }).detail };
    const minOut = params.minOut ?? 0;
    if (q.expectedOut < minOut) {
      return { ok: false, detail: `SLIPPAGE: המוצא ${q.expectedOut} מתחת למינימום ${minOut} — הגנת-הזזה עצרה` };
    }
    const pool = await db.exchangePool.findUnique({ where: { pair: params.pair } });
    if (!pool) return { ok: false, detail: "NO-POOL" };
    const inA = params.side === "A2B";
    const assetIn = (inA ? pool.assetA : pool.assetB) as ExchangeAsset;
    const assetOut = (inA ? pool.assetB : pool.assetA) as ExchangeAsset;
    await adjust(params.member, assetIn, -params.amountIn);
    await adjust(params.member, assetOut, q.expectedOut);
    // עדכון רזרבות — העמלה נשארת בבריכה (ערך ה-LP של האוצר צומח)
    const rA = pool.reserveA + (inA ? params.amountIn : -q.expectedOut);
    const rB = pool.reserveB + (inA ? -q.expectedOut : params.amountIn);
    await db.exchangePool.update({
      where: { pair: params.pair },
      data: {
        reserveA: Math.floor(rA * 1e9) / 1e9,
        reserveB: Math.floor(rB * 1e9) / 1e9,
        volumeA: { increment: inA ? params.amountIn : 0 },
        volumeB: { increment: inA ? 0 : params.amountIn },
        swaps: { increment: 1 },
      },
    });
    const ev = await chainEvent("SWAP", params.member, {
      pair: params.pair, side: params.side, amountIn: params.amountIn, amountOut: q.expectedOut,
      assetIn, assetOut, minOut, feeBps: pool.feeBps,
      reservesAfter: { a: rA, b: rB },
    }, q.usdValue);
    // R128 — אירוע FEE: העמלה שנשארת בבריכה נכתבת סוף סוף לספר. עד כאן
    // swap() תיעד feeBps בתוך אירוע ה-SWAP אך לעולם לא כתב אירוע FEE —
    // ו-income.ts מסכם רק kind:"FEE" (ממצא 2-a: עמלות הזירה היו בלתי-נראות
    // לנצח, $0 גם כשנפח יבוא). החישוב (x·y=k): העמלה נגבית מהצד הנכנס —
    // fee = amountIn × feeBps/10000; ההמרה לדולר בשער החי של נכס-הקלט
    // ברגע ההחלפה. אין שער → usdValue null בכנות, ההערה מתעדת את החישוב.
    const feeIn = (params.amountIn * pool.feeBps) / 10000;
    const feeUsd = q.usdValue != null ? (q.usdValue * pool.feeBps) / 10000 : null;
    await chainEvent("FEE", params.member, {
      pair: params.pair, side: params.side, assetIn, feeBps: pool.feeBps, feeIn,
      swapSeq: ev.seq,
      note: `fee = amountIn × feeBps/10000 = ${params.amountIn} × ${pool.feeBps}/10000 ${assetIn} — נשאר בבריכה (ערך ה-LP של האוצר צומח)`,
      usdNote: feeUsd == null
        ? "אין שער חי לנכס הנכנס בעת ההחלפה — usdValue לא נמדד בכנות"
        : `usdValue = feeIn × שער-חי של ${assetIn} בעת ההחלפה`,
    }, feeUsd);
    return { ok: true, detail: `הוחלף ${params.amountIn} ${assetIn} ← ${q.expectedOut} ${assetOut} (עמלה ${pool.feeBps}bps לבריכה)`, event: ev, quote: q };
  } catch (e) {
    return { ok: false, detail: "SWAP-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

// ── r192-c — סליקת-סוופ-סוכן: עמלת-x402 לאוצר + רישום-נוטינאל לקפסות ───

/** סליקת סוופ-סוכן (שער /api/exchange/agent):
 *  1) חיוב-עמלת-x402 מחבר-הסוכן וזיכוי-האוצר (בספר, בנכס העמלה שהוצהר) —
 *     אירוע FEE עם usdValue נספר כהכנסה אמיתית ב-income.ts.
 *  2) אירוע AGENT_SWAP עם usdValue = נוטינאל-הקלט ב-$ — זה המקור שממנו
 *     נמדדת תקרת-היום לסוכן (L4) — מהספר, לא מזיכרון-שרת.
 *  אם אין לסוכן מספיק נכס-עמלה אחרי הסוופ — אירוע FEE_DUE בכנות (חוב
 *  מתועד), הסוופ עצמו נשאר תקף. */
export async function agentSwapSettle(params: {
  agentId: string;
  member: string; // agent:<name> — חבר-הספר של הסוכן
  feeAsset: "USDS" | "SAOS";
  feeAmount: number;
  feeUsd: number | null;
  notionalUsd: number | null;
  pair: string;
  side: "A2B" | "B2A";
  swapSeq: number | null; // seq של אירוע ה-SWAP שקדם — קישור-ביקורת
}): Promise<SwapResult> {
  try {
    if (!(params.feeAmount > 0)) return { ok: false, detail: "BAD-FEE: עמלה חייבת להיות חיובית" };
    await adjust(params.member, params.feeAsset, -params.feeAmount);
    await adjust("treasury", params.feeAsset, params.feeAmount);
    await chainEvent("FEE", params.member, {
      source: "x402-agent-api",
      agentId: params.agentId,
      pair: params.pair,
      side: params.side,
      asset: params.feeAsset,
      fee: params.feeAmount,
      swapSeq: params.swapSeq,
      note: `עמלת-x402 ${params.feeAmount} ${params.feeAsset} מ-${params.member} → אוצר (מוצהר בציטוט, נגבה בפועל)`,
    }, params.feeUsd);
    const rec = await chainEvent("AGENT_SWAP", params.member, {
      agentId: params.agentId,
      pair: params.pair,
      side: params.side,
      notionalUsd: params.notionalUsd,
      swapSeq: params.swapSeq,
      note: "נוטינאל-קלט ב-$ — מדד תקרת-היום לסוכן (L4), נמדד מהספר",
    }, params.notionalUsd);
    return { ok: true, detail: `עמלת-x402 ${params.feeAmount} ${params.feeAsset} → אוצר · נוטינאל נרשם לקפסות`, event: rec };
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    try {
      await chainEvent("FEE_DUE", params.member, {
        source: "x402-agent-api",
        agentId: params.agentId,
        pair: params.pair,
        asset: params.feeAsset,
        feeDue: params.feeAmount,
        error: msg.slice(0, 100),
        note: "חוב-עמלה מתועד בכנות — הסוופ בוצע אך החיוב נכשל",
      }, null);
    } catch { /* הספר עצמו נפל — נחזיר את השגיאה המקורית */ }
    return { ok: false, detail: "SETTLE-ERROR: " + msg.slice(0, 140) };
  }
}

// ── USDS — גיבוי-רזרבה מלא ────────────────────────────────────────────

export async function usdsMint(member: string, stable: "WSBD" | "WHBD", amount: number): Promise<SwapResult> {
  try {
    if (!(amount > 0)) return { ok: false, detail: "BAD-AMOUNT" };
    await adjust(member, stable, -amount);
    await adjust("reserve", stable, amount);
    await adjust("reserve", "USDS", -amount); // הרזרבה "מנפיקה" — ההתחייבות שלה
    await adjust(member, "USDS", amount);
    const ev = await chainEvent("USDS_MINT", member, { stable, locked: amount, minted: amount, rate: "1:1" }, null);
    // R107 — שרשרת מלאי→הטבעה→היצע: ההטבעה היא שלב בדומינו, ולכן
    // נרשמת במנוע-השרשרת ממקור-אמת אחד (בין אם הגיעה מהזרם, מ-API
    // או מהסוכן) — מדידה אחת לכל נתיב.
    await chainLog("sbd-mint", "mint", "usdsMint", true, `${member}: +${amount} USDS מול נעילת ${amount} ${stable} — היצע מהכנסה אמיתית`);
    return { ok: true, detail: `נטבעו ${amount} USDS מול נעילת ${amount} ${stable} — גיבוי-רזרבה מלא`, event: ev };
  } catch (e) {
    await chainLog("sbd-mint", "mint", "usdsMint", false, `${member}: ${String((e as Error).message ?? e).slice(0, 100)}`).catch(() => {});
    return { ok: false, detail: "MINT-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

export async function usdsBurn(member: string, stable: "WSBD" | "WHBD", amount: number): Promise<SwapResult> {
  try {
    if (!(amount > 0)) return { ok: false, detail: "BAD-AMOUNT" };
    await adjust(member, "USDS", -amount);
    await adjust("reserve", "USDS", amount);
    await adjust("reserve", stable, -amount);
    await adjust(member, stable, amount);
    const ev = await chainEvent("USDS_BURN", member, { stable, unlocked: amount, burned: amount, rate: "1:1" }, null);
    return { ok: true, detail: `נשרפו ${amount} USDS ושוחררו ${amount} ${stable} מהרזרבה — 1:1, תמיד`, event: ev };
  } catch (e) {
    return { ok: false, detail: "BURN-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

// ── רייל-ההפקדות — דלת הציבור על שלוש רשתות (memo: wx:<member>) ────────

const DEPOSIT_MEMO = /^wx:([a-z0-9.-]{3,16})$/;

export interface DepositScanResult {
  ok: boolean;
  scanned: number;
  credited: number;
  details: string[];
  detail: string;
}

export async function depositScan(limit = 60): Promise<DepositScanResult> {
  const details: string[] = [];
  let credited = 0;
  let scanned = 0;

  // האוצר הוא headcorner בכל שלוש הרשתות (חוק המפתח-הראשי — R99):
  // STEEM (api.steemit.com) · HIVE (api.hive.blog) · BLURT (rpc.blurt.blog, UA!)
  type HistEntry = [number, { op?: [string, Record<string, unknown>]; trx_id?: string }];
  const legs: Array<{
    chain: string;
    hist: HistEntry[] | null;
    mapAsset: (amount: string) => ExchangeAsset | null;
  }> = [];

  const steemHist = await rpcV4<HistEntry[]>(
    STEEM_RPC_NODES[0], "condenser_api.get_account_history", [TREASURY, -1, limit],
  ).catch(() => null);
  legs.push({
    chain: "steem",
    hist: Array.isArray(steemHist) ? steemHist : null,
    mapAsset: (amt) => (/STEEM/i.test(amt) ? "WSTEEM" : /SBD/i.test(amt) ? "WSBD" : null),
  });

  const hiveHist = await rpcV4<HistEntry[]>(
    HIVE_RPC, "condenser_api.get_account_history", [TREASURY, -1, limit],
  ).catch(() => null);
  legs.push({
    chain: "hive",
    hist: Array.isArray(hiveHist) ? hiveHist : null,
    mapAsset: (amt) => (/HIVE/i.test(amt) ? "WHIVE" : /HBD/i.test(amt) ? "WHBD" : null),
  });

  // BLURT — UA מפורש (ענן-הגנה של הצומת, לקח R101)
  const blurtHist = await fetch(BLURT_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "saos-weave-rail/1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_account_history", params: [TREASURY, -1, limit] }),
    signal: AbortSignal.timeout(12_000),
  }).then((r) => r.json() as Promise<{ result?: HistEntry[] }>).catch(() => null);
  legs.push({
    chain: "blurt",
    hist: blurtHist?.result ?? null,
    mapAsset: (amt) => (/BLURT/i.test(amt) ? "WBLURT" : null),
  });

  for (const leg of legs) {
    if (!Array.isArray(leg.hist)) {
      details.push(`${leg.chain}: RPC-DOWN — הרגל נדלגה בכנות`);
      continue;
    }
    scanned += leg.hist.length;
    for (const [, entry] of leg.hist) {
      const op = entry.op;
      if (!op || op[0] !== "transfer") continue;
      const t = op[1] as { from?: string; to?: string; amount?: string; memo?: string };
      if (t.to !== TREASURY) continue;
      const mm = DEPOSIT_MEMO.exec(String(t.memo ?? "").trim().toLowerCase());
      if (!mm) continue;
      const member = mm[1];
      const amt = String(t.amount ?? "");
      const num = parseFloat(amt) || 0;
      if (!(num > 0)) continue;
      const txid = String(entry.trx_id ?? "");
      if (await eventExists("DEPOSIT_CREDIT", txid)) continue;
      const asset = leg.mapAsset(amt);
      if (!asset) continue;
      // R128 — מגע-ראשון: הבדיקה לפני כתיבת הזיכוי (אחרת האירוע שלנו עצמו יספור את החשבון)
      const from = String(t.from ?? "");
      const firstTouch = await isFirstTouchCandidate(leg.chain, from);
      await adjust(member, asset, num);
      await chainEvent("DEPOSIT_CREDIT", member, {
        txid, from, asset, amount: num, memo: t.memo, chain: leg.chain,
        evidence: `${leg.chain}:get_account_history(${TREASURY}) trx_id=${txid}`,
      }, null);
      if (firstTouch) {
        await writeFirstTouch(leg.chain, from, member, asset, num);
        details.push(`${leg.chain}: מגע-ראשון — ${from} (לקוח חדש בזירה)`);
      }
      credited++;
      details.push(`${leg.chain}: ${t.from} → ${member}: ${num} ${asset} (txid ${txid.slice(0, 10)}…)`);
    }
  }

  // ── R105 — רגל SOL: סריקת חתימות נטולת-מפתחות (השרשרת שופטת) ───
  // המזכר נקרא מהוראת spl-memo (base58→utf8); הזיהוי לפי התוכן —
  // לא לפי תוכנית — חוסן מול כל גרסת memo. העברה מזוהה מהוראת
  // system-transfer המנותחת. העברה ללא מזכר — אין ייחוס, לא נזקפת.
  try {
    const sigs = await solRpc<Array<{ signature: string; err: unknown } | null>>(
      "getSignaturesForAddress", [SOL_TREASURY_PUB, { limit: Math.min(40, limit) }],
    );
    const list = (Array.isArray(sigs) ? sigs : []).filter((s): s is { signature: string; err: unknown } => !!s?.signature);
    scanned += list.length;
    for (const s of [...list].reverse()) { // ישן→חדש: סדר קנוני לספר
      if (s.err != null) continue; // העברה שנכשלה — השרשרת דחתה
      if (await eventExists("DEPOSIT_CREDIT", s.signature)) continue;
      const tx = await solRpc<{
        meta?: { err?: unknown } | null;
        transaction?: { message?: { instructions?: Array<Record<string, unknown>> } };
      } | null>("getTransaction", [s.signature, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }]).catch(() => null);
      if (!tx || tx.meta?.err != null) continue; // טרם-finalized או נכשל — הסריקה הבאה תראה
      const instrs = tx.transaction?.message?.instructions ?? [];
      let lamportsIn = 0;
      let solSource = ""; // R128 — כתובת-השולח לחיישן מגע-ראשון ולרישום
      for (const ins of instrs) {
        const parsed = ins.parsed as { type?: string; info?: { destination?: unknown; lamports?: number; source?: unknown } } | undefined;
        if (parsed?.type === "transfer" && String(parsed.info?.destination ?? "") === SOL_TREASURY_PUB) {
          lamportsIn += Number(parsed.info?.lamports ?? 0);
          if (!solSource) solSource = String(parsed.info?.source ?? "");
        }
      }
      if (lamportsIn <= 0) continue;
      let member: string | null = null;
      for (const ins of instrs) {
        // נתיב-א (נמדד בשטח, R105): הוראת spl-memo המנותחת מגיעה עם
        // parsed=מחרוזת-המזכר עצמה (בלי data גולמי).
        if (typeof ins.parsed === "string") {
          const mm = DEPOSIT_MEMO.exec(ins.parsed.trim().toLowerCase());
          if (mm) { member = mm[1]; break; }
        }
        // נתיב-ב: הוראה גולמת — המזכר ב-data (base58→utf8)
        const data = typeof ins.data === "string" ? ins.data : null;
        if (!data) continue;
        try {
          const mm = DEPOSIT_MEMO.exec(decodeBase58Utf8(data).trim().toLowerCase());
          if (mm) { member = mm[1]; break; }
        } catch { /* לא bs58 — לא הוראת מזכר */ }
      }
      if (!member) continue; // העברה ללא מזכר — אין ייחוס, בכנות לא נזקפת
      const amt = lamportsIn / 1e9;
      if (!(amt > 0)) continue;
      // R128 — מגע-ראשון לפני כתיבת הזיכוי; from נשמר גם ברישום (חיישן היסטורי)
      const firstTouch = await isFirstTouchCandidate("solana", solSource);
      await adjust(member, "WSOL", amt);
      await chainEvent("DEPOSIT_CREDIT", member, {
        txid: s.signature, from: solSource, asset: "WSOL", amount: amt, memo: `wx:${member}`, chain: "solana",
        evidence: `solana:getSignaturesForAddress+getTransaction(${SOL_TREASURY_PUB}) sig=${s.signature}`,
      }, null);
      if (firstTouch) {
        await writeFirstTouch("solana", solSource, member, "WSOL", amt);
        details.push(`solana: מגע-ראשון — ${solSource.slice(0, 10)}… (לקוח חדש בזירה)`);
      }
      credited++;
      details.push(`solana: ${amt} SOL → ${member}: WSOL (sig ${s.signature.slice(0, 10)}…)`);
    }
  } catch {
    details.push("solana: RPC-DOWN — הרגל נדלגה בכנות");
  }

  // ── R105 — רגל ETH: Blockscout (ציבורי, חסר-מפתחות) ──────────
  // המזכר בשדה input-data (hex→utf8) — הדרך המקובלת להעברת native-ETH
  // עם נתונים. עסקה מאושרת בלבד; העברה ללא מזכר — אין ייחוס.
  try {
    const r = await fetch(`https://eth.blockscout.com/api/v2/addresses/${ETH_TREASURY_ADDR}/transactions`, {
      signal: AbortSignal.timeout(12_000),
    });
    const j = (await r.json()) as {
      items?: Array<{ hash?: string; from?: { hash?: string } | null; to?: { hash?: string } | null; value?: string; status?: string; result?: string; input?: string }>;
    };
    const items = j.items ?? [];
    scanned += items.length;
    for (const t of items) {
      const hash = String(t.hash ?? "");
      if (!hash) continue;
      if (String(t.to?.hash ?? "").toLowerCase() !== ETH_TREASURY_ADDR.toLowerCase()) continue;
      if (t.result !== "success" && t.status !== "ok") continue;
      const ethVal = Number(String(t.value ?? "0")) / 1e18;
      if (!(ethVal > 0)) continue;
      if (await eventExists("DEPOSIT_CREDIT", hash)) continue;
      let member: string | null = null;
      try {
        const hex = String(t.input ?? "").replace(/^0x/, "");
        if (hex.length > 0 && hex.length % 2 === 0) {
          const mm = DEPOSIT_MEMO.exec(Buffer.from(hex, "hex").toString("utf8").trim().toLowerCase());
          if (mm) member = mm[1];
        }
      } catch { /* אין מזכר */ }
      if (!member) continue; // העברה ללא מזכר — אין ייחוס, בכנות לא נזקפת
      // R128 — מגע-ראשון לפני כתיבת הזיכוי; from נשמר גם ברישום (חיישן היסטורי)
      const fromEth = String(t.from?.hash ?? "");
      const firstTouch = await isFirstTouchCandidate("ethereum", fromEth);
      await adjust(member, "WETH", ethVal);
      await chainEvent("DEPOSIT_CREDIT", member, {
        txid: hash, from: fromEth, asset: "WETH", amount: ethVal, memo: `wx:${member}`, chain: "ethereum",
        evidence: `blockscout:eth address=${ETH_TREASURY_ADDR} hash=${hash}`,
      }, null);
      if (firstTouch) {
        await writeFirstTouch("ethereum", fromEth, member, "WETH", ethVal);
        details.push(`ethereum: מגע-ראשון — ${fromEth.slice(0, 10)}… (לקוח חדש בזירה)`);
      }
      credited++;
      details.push(`ethereum: ${ethVal} ETH → ${member}: WETH (txid ${hash.slice(0, 10)}…)`);
    }
  } catch {
    details.push("ethereum: BLOCKSCOUT-DOWN — הרגל נדלגה בכנות");
  }

  if (credited > 0) {
    // R107 — שרשרת הפקדה→זיכוי: כסף שנגע בשרשרת נזקף מיד — הדומינו נמדד
    await chainLog("deposit", "credit", "deposit-scan", true, `${credited} הפקדות נזקפו: ${details.slice(0, 2).join(" · ").slice(0, 160)}`);
  }
  return {
    ok: true,
    scanned,
    credited,
    details,
    detail: credited > 0 ? `${credited} הפקדות נזקפו (5 רשתות)` : "אין הפקדות חדשות בחלון (5 רשתות)",
  };
}

// ── רייל-המשיכות — שריפת עטיפה → העברה אמיתית בשרשרת ──────────────────

function activeWif(): string | null {
  try {
    // r137 · D-026: מקור-המפתח הדו-מצבי — מצב-wif חותם ישירות, מצב-אב גוזר.
    const raw = fs.readFileSync(path.join(HOME, "upload", "headcorner.txt"), "utf8").trim();
    const [account, ...rest] = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const secret = rest[0] ?? "";
    if (secret.startsWith("wif:")) return secret.slice(4).trim() || null;
    return steem.auth.toWif(account, secret, "active");
  } catch {
    return null;
  }
}

function fmtAsset3(amount: number, symbol: "STEEM" | "SBD" | "HIVE" | "HBD"): string {
  return `${amount.toFixed(3)} ${symbol}`;
}

export interface WithdrawResult {
  ok: boolean;
  detail: string;
  gate?: { verdict: string; id: string; usdValue: number | null };
  txid?: string | null;
  event?: ChainedEvent;
}

/** R104 — רייל-משיכת SAOS-LIVE: שריפת תביעה פנימית ← העברה חתומה
 *  מהאוצר על שרשרת SAOS-LIVE החיה (custom_json ב-STEEM). השרשרת היא
 *  השופט: הכתובת חייבת להיות רשומה, מאזן האוצר נמדד בקיפול, ושער-$100
 *  מכסה — מחיר ה-SAOS נגזר מהבריכה הפנימית החיה (השוק שלנו הוא המקור). */
async function saosWithdrawRail(params: {
  member: string;
  amount: number;
  toAddress: string;
  issuedBy: "operator" | "daemon";
}): Promise<WithdrawResult> {
  const { member, amount, toAddress, issuedBy } = params;
  // מחיר SAOS — מהבריכה הפנימית בלבד (נתיב ריבוני; אין ל-SAOS מחיר חיצוני)
  const poolPrice = await saosUsdPrice();
  const usdValue = poolPrice != null ? amount * poolPrice : null;
  // אין שער-מחיר? אין עסקה (חוק המדידה) — כלום לא זז
  if (usdValue == null) {
    return { ok: false, detail: "NO-PRICE: מחיר SAOS לא נמדד מהבריכה הפנימית — אין שער, אין משיכה" };
  }
  // 1) שער-$100 קודם — תור-מפעיל פירושו שכלום לא זז עדיין
  const gate = await evaluateGate({
    source: "sovereign-exchange",
    action: "withdraw",
    title: `משיכה ${amount} SAOS ל-${toAddress.slice(0, 18)}… (${usdValue.toFixed(2)}$)`,
    payload: { member, asset: "SAOS", amount, toAddress },
    usdValue,
    usdBasis: `internal pool SAOS/USDS ${poolPrice?.toPrecision(4) ?? "?"}`,
    issuedBy,
    reason: "משיכת SAOS — שריפת תביעה פנימית והעברה חתומה על SAOS-LIVE",
  });
  if (gate.verdict !== "ALLOWED") {
    return {
      ok: false,
      detail: gate.verdict === "QUEUED" ? `המשיכה ${usdValue.toFixed(2)}$ ≥ 100$ — הועברה לתור אישור המפעיל` : `השער סירב (${String(gate.decidedBy ?? "unknown")}) — ${String(gate.reason ?? "").slice(0, 120)}`, // r206 ייחוס-אמת
      gate: { verdict: gate.verdict, id: gate.id, usdValue },
    };
  }
  // 2) שריפת התביעה הפנימית — עכשיו, לפני השידור (סדר הפעולות עסקה)
  await adjust(member, "SAOS", -amount);
  // 3) הרייל: חתימת אוצר + שידור custom_json על STEEM — השרשרת היא השופט
  const rail = await saosLiveTransferOut({ toAddress, amount });
  if (!rail.ok) {
    // שידור נכשל — התביעה מוחזרת במלואה (אותו חוק כמו ריילי HIVE/BLURT)
    await adjust(member, "SAOS", amount);
    return { ok: false, detail: rail.note, gate: { verdict: "ALLOWED", id: gate.id, usdValue } };
  }
  // 4) הספר — אירוע משורשר עם ה-txid האמיתי
  const ev = await chainEvent("WITHDRAW_EXEC", member, {
    asset: "SAOS",
    amount,
    toAddress,
    txid: rail.txid ?? null,
    envelopeId: rail.envelopeId ?? null,
    treasury: rail.treasuryAddr ?? null,
    note: "rail SAOS-LIVE — token.transfer on-chain (custom_json saos.weave.live.v1)",
  }, usdValue);
  return {
    ok: true,
    detail: `SAOS נמשך דרך שרשרת SAOS-LIVE — txid ${rail.txid?.slice(0, 14) ?? "?"}… · הקיפול יזקוף בבלוק הבא`,
    txid: rail.txid ?? null,
    event: ev,
    gate: { verdict: "ALLOWED", id: gate.id, usdValue },
  };
}

/** R105 — רייל משיכה לא-גרפני: שריפת עטיפה ← שידור אמתי
 * מאוצר cashmachine (אותו מפתח-אב). SOL: legacy-tx חתומה ed25519
 * (הוכחה חיה 5amYdKAC…). ETH: EIP-1559 בקבלת NO-GAS כנה
 * עד הגעת הון-גז. סדר הפעולות עסקה: שער ← שריפה ← שידור ←
 * החזרה מלאה בכל כשל. */
async function nonGrapheneWithdrawRail(params: {
  member: string;
  asset: "WSOL" | "WETH";
  amount: number;
  toAccount: string;
  issuedBy: "operator" | "daemon";
}): Promise<WithdrawResult> {
  const { member, asset, amount, toAccount, issuedBy } = params;
  const prices = await pricesUsd();
  const priceKey = asset === "WSOL" ? "sol" : "eth";
  const price = prices[priceKey];
  if (price == null) {
    return { ok: false, detail: "NO-PRICE: USD לא נמדד חי — אין שער, אין משיכה" };
  }
  // ואלידציה של היעד: SOL = base58 של 32 בייט; ETH = 0x-hex של 40
  if (asset === "WSOL" && !isValidSolPubkey(toAccount)) {
    return { ok: false, detail: "BAD-ACCOUNT: כתובת סולנה שגויה" };
  }
  if (asset === "WETH" && !/^0x[0-9a-fA-F]{40}$/.test(toAccount)) {
    return { ok: false, detail: "BAD-ACCOUNT: כתובת EVM שגויה" };
  }
  const usdValue = amount * price;
  const gate = await evaluateGate({
    source: "sovereign-exchange",
    action: "withdraw",
    title: `משיכה ${amount} ${asset} ל-${toAccount.slice(0, 14)}… (${usdValue.toFixed(2)}$)`,
    payload: { member, asset, amount, toAccount },
    usdValue,
    usdBasis: `binance ${priceKey} ${price}`,
    issuedBy,
    reason: "משיכת רייל לא-גרפני — שריפת עטיפה ושידור מאוצר cashmachine",
  });
  if (gate.verdict !== "ALLOWED") {
    return {
      ok: false,
      detail: gate.verdict === "QUEUED" ? `המשיכה ${usdValue.toFixed(2)}$ ≥ 100$ — הועברה לתור אישור המפעיל` : `השער סירב (${String(gate.decidedBy ?? "unknown")}) — ${String(gate.reason ?? "").slice(0, 120)}`, // r206 ייחוס-אמת
      gate: { verdict: gate.verdict, id: gate.id, usdValue },
    };
  }
  // שריפת העטיפה קודם לשידור (סדר הפעולות עסקה — לקח R104)
  // R30b — הבלם-הריבוני לפני-השידור (מסילת general): בדיקה אחרי שער-ה-$100 ולפני שריפת-העטיפה,
  // כך שסירוב-בלם לא שורף עטיפה (אפס-תופעת-לוואי) ולא משדר.
  const brakeNg = evaluateBrake("exchange-non-graphene-send");
  console.log(brakeLogLine(brakeNg));
  if (brakeNg.halt) {
    return {
      ok: false,
      detail: `CAPITAL-BRAKE-HALT: הבלם-הריבוני עצר את המשיכה לפני השידור — אפס שידורים, העטיפה לא נשרפה. ${brakeNg.reasons.join(" | ").slice(0, 240)}`,
      gate: { verdict: "BRAKE-HALT", id: null, usdValue },
    };
  }
  await adjust(member, asset, -amount);
  const send = asset === "WSOL"
    ? await solSend("cashmachine", toAccount, amount)
    : await ethSend("cashmachine", toAccount, amount);
  if (!send.ok) {
    await adjust(member, asset, amount); // השידור לא התקבל — העטיפה מוחזרת במלואה
    return {
      ok: false,
      detail: `SEND-FAILED: ${send.detail} — העטיפה הוחזרה, כלום לא נשרף`,
      gate: { verdict: "SEND-FAILED", id: gate.id, usdValue },
    };
  }
  const ev = await chainEvent("WITHDRAW_EXEC", member, {
    asset, amount, toAccount, txid: send.txid ?? null,
    note: `rail ${asset === "WSOL" ? "solana legacy-tx (ed25519)" : "ethereum EIP-1559"} — העטיפה נשרפה, ההעברה שודרה מאוצר cashmachine`,
    usdValue, gateId: gate.id,
  }, usdValue);
  await settleGate(gate.id, "EXECUTED", "sovereign-exchange:live", { txid: send.txid ?? null, eventHash: ev.hash });
  return {
    ok: true,
    detail: `נמשכו ${amount} ${asset} ל-${toAccount.slice(0, 14)}… — העטיפה נשרפה, ההעברה שודרה`,
    gate: { verdict: "EXECUTED", id: gate.id, usdValue },
    txid: send.txid ?? null,
    event: ev,
  };
}

export async function withdraw(params: {
  member: string;
  asset: ExchangeAsset;
  amount: number;
  toAccount: string;
  issuedBy: "operator" | "daemon";
}): Promise<WithdrawResult> {
  try {
    const { member, asset, amount, toAccount, issuedBy } = params;
    if (!(amount > 0)) return { ok: false, detail: "BAD-AMOUNT" };
    // R104 — רייל SAOS-LIVE: היעד הוא כתובת שרשרת-חיה (saos1…), לא שם-חשבון גרפן
    if (asset === "SAOS") {
      return await saosWithdrawRail({ member, amount, toAddress: toAccount, issuedBy });
    }
    // R105 — ריילי העולם הלא-גרףן: WSOL/WETH יוצאים לכתובת שרשרת
    if (asset === "WSOL" || asset === "WETH") {
      return await nonGrapheneWithdrawRail({ member, asset, amount, toAccount, issuedBy });
    }
    if (!/^[a-z0-9.-]{3,16}$/.test(toAccount)) return { ok: false, detail: "BAD-ACCOUNT: יעד שרשרת שגוי" };
    const prices = await pricesUsd();
    const priceKey = asset === "WSTEEM" ? "steem" : asset === "WSBD" ? "sbd" : asset === "WHIVE" ? "hive" : asset === "WHBD" ? "hbd" : asset === "WBLURT" ? "blurt" : null;
    const usdValue = priceKey && prices[priceKey] != null ? amount * (prices[priceKey] as number) : null;

    // נכסים שאינם ניתנים למשיכה ישירה — בכנות
    if (asset === "USDS") return { ok: false, detail: "USDS נפדה בשריפה (usds-burn) ל-WSBD/WHBD — ואז מושך" };

    if (usdValue == null) {
      return { ok: false, detail: "NO-PRICE: USD לא נמדד חי — אין שער, אין מסחר" };
    }
    const gate = await evaluateGate({
      source: "sovereign-exchange",
      action: "withdraw",
      title: `משיכה ${amount} ${asset} ל-${toAccount} (${usdValue.toFixed(2)}$)`,
      payload: { member, asset, amount, toAccount },
      usdValue,
      usdBasis: `binance/coingecko/parity ${priceKey} ${priceKey ? prices[priceKey] : "?"}`,
      issuedBy,
      reason: "משיכה מזירת-המסחר — שריפת עטיפה והעברה אמיתית",
    });
    if (gate.verdict !== "ALLOWED") {
      return {
        ok: false,
        detail: gate.verdict === "QUEUED" ? `המשיכה ${usdValue.toFixed(2)}$ ≥ 100$ — הועברה לתור אישור המפעיל` : `השער סירב (${String(gate.decidedBy ?? "unknown")}) — ${String(gate.reason ?? "").slice(0, 120)}`, // r206 ייחוס-אמת
        gate: { verdict: gate.verdict, id: gate.id, usdValue },
      };
    }
    // שריפת העטיפה + שידור אמיתי
    // R30b — הבלם-הריבוני לפני-השידור (מסילת general): לפני שריפת-העטיפה — אפס-תופעת-לוואי.
    const brakeWx = evaluateBrake("exchange-withdraw");
    console.log(brakeLogLine(brakeWx));
    if (brakeWx.halt) {
      return {
        ok: false,
        detail: `CAPITAL-BRAKE-HALT: הבלם-הריבוני עצר את המשיכה לפני השידור — אפס שידורים, העטיפה לא נשרפה. ${brakeWx.reasons.join(" | ").slice(0, 240)}`,
        gate: { verdict: "BRAKE-HALT", id: gate.id, usdValue },
      };
    }
    await adjust(member, asset, -amount);
    let send: { txid?: string | null; accepted?: boolean; note?: string } = { txid: null };
    if (asset === "WSTEEM" || asset === "WSBD") {
      const wif = activeWif();
      if (!wif) { await adjust(member, asset, amount); return { ok: false, detail: "NO-KEY: מקור-המפתח חסר" }; }
      const symbol = asset === "WSTEEM" ? "STEEM" : "SBD";
      const res = await steemBroadcast(
        [["transfer", { from: TREASURY, to: toAccount, amount: fmtAsset3(amount, symbol), memo: "wx-out (sovereign-exchange)" }]] as never,
        wif,
      );
      send = res;
    } else if (asset === "WHIVE" || asset === "WHBD") {
      const v = openVaultKey("hive", TREASURY, "active");
      if (!v.ok || !v.wif) { await adjust(member, asset, amount); return { ok: false, detail: `NO-KEY: ${v.detail}` }; }
      const symbol = asset === "WHIVE" ? "HIVE" : "HBD";
      // חוק-החוט (R99): HIVE חותם נכסים בשמות-האב — מיפוי לפני החתימה
      const op = ["transfer", { from: TREASURY, to: toAccount, amount: fmtAsset3(amount, symbol), memo: "wx-out (sovereign-exchange)" }] as never;
      const mapped = JSON.parse(JSON.stringify(op).replace(/(\d+\.\d+) HIVE/g, "$1 STEEM").replace(/(\d+\.\d+) HBD/g, "$1 SBD")) as never;
      const signed = await signGrapheneTx(HIVE_RPC, HIVE_CHAIN_ID, mapped, v.wif);
      await rpcV4(HIVE_RPC, "condenser_api.broadcast_transaction", [signed]);
      send = { txid: null, accepted: true, note: "hive broadcast-accepted" };
    } else if (asset === "WBLURT") {
      // רייל BLURT (R103) — חוק-החוט המילולי הוכח במעבדה + בשרשרת:
      // הנכס נסדר כ-"N.NNN BLURT" (בלי מיפוי-מורשת), chain_id מ-get_config.
      const v = openVaultKey("blurt", TREASURY, "active");
      if (!v.ok || !v.wif) { await adjust(member, asset, amount); return { ok: false, detail: `NO-KEY: ${v.detail}` }; }
      const r = await blurtSendTransfer({
        from: TREASURY, to: toAccount, amount, memo: "wx-out (sovereign-exchange)", wif: v.wif,
      });
      send = { txid: r.txid, accepted: r.accepted, note: r.note };
    }
    const okSend = asset === "WSTEEM" || asset === "WSBD" ? !!send.txid : !!send.accepted;
    if (!okSend) {
      await adjust(member, asset, amount); // החזרה — השידור לא התקבל; ההחלטה נשארת ALLOWED, הקבלה בתשובה
      return { ok: false, detail: `SEND-FAILED: ${send.note ?? "השרשרת דחתה"} — העטיפה הוחזרה, כלום לא נשרף`, gate: { verdict: "SEND-FAILED", id: gate.id, usdValue } };
    }
    const ev = await chainEvent("WITHDRAW_EXEC", member, {
      asset, amount, toAccount, txid: send.txid ?? null, note: send.note ?? undefined,
      usdValue, gateId: gate.id,
    }, usdValue);
    await settleGate(gate.id, "EXECUTED", "sovereign-exchange:live", { txid: send.txid ?? null, eventHash: ev.hash });
    return { ok: true, detail: `נמשכו ${amount} ${asset} ל-${toAccount} — העטיפה נשרפה, ההעברה שודרה`, gate: { verdict: "EXECUTED", id: gate.id, usdValue }, txid: send.txid ?? null, event: ev };
  } catch (e) {
    return { ok: false, detail: "WITHDRAW-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

// ── רייל-התגמול: עבודה → מטבע → נזילות (R103) ─────────────────────────

/** מחיר SAOS חי מהבריכה שלנו — השוק הפנימי הוא המקור */
async function saosUsdPrice(): Promise<number | null> {
  const pool = await db.exchangePool.findUnique({ where: { pair: "SAOS/USDS" } });
  if (!pool || pool.reserveA <= 0) return null;
  return pool.reserveB / pool.reserveA;
}

/**
 * חלוקת SAOS לסוכן — ישירות למאזן הזירה (R103).
 *
 * סגירת המעגל: הסוכן עובד (מילויי-גריד אמיתיים) ← מקבל SAOS כתביעה
 * פנימית ← מחליף אותה ב-USDS בבריכה שלנו ← נזילות אמיתית. התגמול
 * יוצא ממאזן האוצר (הגיבוי החי), והוא מתועד בספר ה-hash-chained.
 */
// ── תקרות-תגמול יומיות (R108) — השרת אוכף, לא הפונה ───────────────────
// דיבוני-הצי מזוהים באמת מקובצי-המצב שלהם (מוביל-הכסף קורא ומשלם),
// אבל שכבת-הרשת חייבת הגנה עצמאית: טענת "אני השומר" מהרשת חסומה
// בתקרה. התקרות לפי תדירות-העבודה האמיתית של כל סוכן.
const REWARD_DAILY_CAPS: Record<string, number> = {
  "money-mover": 48, // מילויי-גריד: פרץ אפשרי, נדיר
  keeper: 6, // החיית-דיבון: אירוע נדיר ויקר
  pulse: 4, // שידור-שרשרת יומי
  student: 2, // סיור-בחינות יומי
  hunter: 2, // ציד-הזדמנויות יומי
};
const REWARD_WINDOW_HOURS = 24;

export async function rewardPay(params: {
  member: string;
  amount: number;
  note: string;
  issuedBy: "operator" | "daemon";
}): Promise<SwapResult> {
  try {
    const { member, amount, note, issuedBy } = params;
    if (!/^[a-z0-9.-]{3,16}$/.test(member)) return { ok: false, detail: "BAD-MEMBER" };
    if (!(amount > 0)) return { ok: false, detail: "BAD-AMOUNT" };
    // R108 — תקרת-יום לכל חבר: הספר זוכר הכל, השרת אוכף
    const cap = REWARD_DAILY_CAPS[member];
    if (cap == null && issuedBy !== "operator") {
      return { ok: false, detail: `NO-CAP: ל-${member} אין מסלול-תגמול מוגדר — תגמול ידני מחייב מפעיל` };
    }
    if (cap != null) {
      const since = new Date(Date.now() - REWARD_WINDOW_HOURS * 3600_000);
      const prior = await db.exchangeEvent.findMany({
        where: { kind: "REWARD_PAY", member, createdAt: { gte: since } },
        orderBy: { seq: "desc" },
      });
      let paid24h = 0;
      // r125a · אמת-התקרה: תשלום קודם שלא נפענח אינו "שולם 0" — ספר שלא
      // נקרא במלואו מכשיל את אימות התקרה. סירוב-כנה: לא מכסים יתר
      // (להתעלם מהתשלום) ולא מזייפים חיסכון (לספור 0). חוק r124:
      // כישלון-קריאה בחישוב-כסף הוא סירוב, לא אפס.
      let ledgerUnreadable = false;
      for (const e of prior) {
        try {
          const pl = JSON.parse(e.payload) as { amount?: unknown } | null;
          if (pl == null || typeof pl.amount !== "number" || !Number.isFinite(pl.amount)) {
            ledgerUnreadable = true;
          } else {
            paid24h += pl.amount;
          }
        } catch {
          ledgerUnreadable = true; /* ספר ישן שבור — לא נבלע כאפס */
        }
      }
      if (ledgerUnreadable) {
        return {
          ok: false,
          detail: `REWARD-LEDGER-UNREADABLE: ספר-התגמולים של ${member} ב-24ש' לא נקרא במלואו — התקרה ${cap} אינה ניתנת לאימות; התשלום נדחה בכנות`,
        };
      }
      if (paid24h + amount > cap) {
        return { ok: false, detail: `CAP: ${member} קיבל ${paid24h}/${cap} SAOS ב-24ש' — התקרה אוכפת (הגנת-דילול)` };
      }
    }
    const price = await saosUsdPrice();
    if (price == null || price <= 0) return { ok: false, detail: "NO-PRICE: אין בריכת SAOS/USDS — אין שער" };
    const usdValue = amount * price;
    const gate = await evaluateGate({
      source: "sovereign-exchange",
      action: "reward-pay",
      title: `תגמול ${amount} SAOS ל-${member} (${usdValue.toFixed(2)}$)`,
      payload: { member, amount, note },
      usdValue,
      usdBasis: `saos/usds-pool ${price.toPrecision(4)}`,
      issuedBy,
      reason: `עבודה→מטבע→נזילות: ${note}`,
    });
    if (gate.verdict !== "ALLOWED") {
      return {
        ok: false,
        detail: gate.verdict === "QUEUED" ? `התגמול ${usdValue.toFixed(2)}$ ≥ 100$ — תור המפעיל` : `השער סירב (${String(gate.decidedBy ?? "unknown")}) — ${String(gate.reason ?? "").slice(0, 120)}`, // r206 ייחוס-אמת
      };
    }
    // האוצר משלם — הספר מתעד
    await adjust("treasury", "SAOS", -amount);
    await adjust(member, "SAOS", amount);
    const ev = await chainEvent("REWARD_PAY", member, {
      amount, note, usdValue, gateId: gate.id,
      rail: "treasury→member (arena balance) — תביעה פנימית מגובה-אוצר",
    }, usdValue);
    await settleGate(gate.id, "EXECUTED", "sovereign-exchange:live", { eventHash: ev.hash });
    return {
      ok: true,
      detail: `שולם ${amount} SAOS ל-${member} מהאוצר — התביעה חיה בזירה (מחליף ב-USDS בבריכה)`,
      event: ev,
    };
  } catch (e) {
    return { ok: false, detail: "REWARD-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

// ── רייל-הנזילות: דלק → עומק בריכות אמיתי (R103) ─────────────────────

// ── מניות-LP (R107) — הנזילות היא נכס, לא תרומה ─────────────────────

function readLpShares(raw: string | null | undefined): Record<string, number> {
  try { return JSON.parse(raw ?? "{}") as Record<string, number>; } catch { return {}; }
}

function totalLpShares(shares: Record<string, number>): number {
  return Object.values(shares).reduce((s, v) => s + (v > 0 ? v : 0), 0);
}

/**
 * הגירה — בריכות שנזרעו לפני מניות-LP מקבלות את מלוא הבעלות לאוצר
 * (הן נזרעו מהון-אוצר נמדד בג'נזיס). אידמפוטנטי — פועל פעם אחת
 * לכל בריכה עם רזרבות וללא מניות תקועות.
 */
async function ensureLpShares(pool: { pair: string; reserveA: number; reserveB: number; lpShares: string | null }): Promise<Record<string, number>> {
  const shares = readLpShares(pool.lpShares);
  const total = totalLpShares(shares);
  if (total > 0) return shares;
  if (pool.reserveA <= 0 || pool.reserveB <= 0) return shares; // ריקה — אין בעלים עדיין
  const genesis: Record<string, number> = { treasury: Math.sqrt(pool.reserveA * pool.reserveB) };
  await db.exchangePool.update({ where: { pair: pool.pair }, data: { lpShares: JSON.stringify(genesis) } });
  await chainEvent("LP_MIGRATE", "treasury", {
    pair: pool.pair, shares: genesis.treasury,
    note: "זריעה היסטורית מהון-אוצר — הבעלות מתועדת אחורה בכנות",
  }, null);
  return genesis;
}

/**
 * הוספת נזילות דו-צדדית לבריכה קיימת (ביחס הנוכחי) או זריעת בריכה
 * חדשה במחיר מוכרז. העמלות נשארות בתוך הבריכה — ערך ה-LP צומח
 * מהעמלות, וכל מניה ניתנת לחילוץ פרו-רטה בכל עת (R107 — מסילת
 * היציאה: removeLiquidity). הסוכן/האוצר שמוסיף עומק נשאר בעליו.
 */
export async function addLiquidity(params: {
  member: string;
  pair: string;
  maxA: number;
  maxB: number;
}): Promise<SwapResult> {
  try {
    const { member, pair, maxA, maxB } = params;
    if (!(maxA > 0) || !(maxB > 0)) return { ok: false, detail: "BAD-AMOUNTS" };
    let pool = await db.exchangePool.findUnique({ where: { pair } });
    if (!pool) {
      // בריכה חדשה — המחיר המוכרז = maxB/maxA, מכאן השוק יכריע
      const [assetA, assetB] = pair.split("/") as [ExchangeAsset, ExchangeAsset];
      if (!assetA || !assetB || !(EXCHANGE_ASSETS as readonly string[]).includes(assetA) || !(EXCHANGE_ASSETS as readonly string[]).includes(assetB) || assetA === assetB) {
        return { ok: false, detail: "BAD-PAIR" };
      }
      await adjust(member, assetA, -maxA);
      await adjust(member, assetB, -maxB);
      const minted = Math.sqrt(maxA * maxB); // המניות הראשונות — שורש המכפלה
      pool = await db.exchangePool.create({
        data: { pair, assetA, assetB, reserveA: maxA, reserveB: maxB, feeBps: FEE_BPS, lpShares: JSON.stringify({ [member]: minted }) },
      });
      const ev = await chainEvent("LP_SEED", member, { pair, assetA, assetB, reserveA: maxA, reserveB: maxB, sharesMinted: minted, note: "זריעת בריכה חדשה — המחיר המוכרז, השוק יכריע מכאן" }, null);
      return { ok: true, detail: `נזרעה בריכה חדשה ${pair}: ${maxA} × ${maxB} · ${minted.toPrecision(6)} מניות-LP ל-${member}`, event: ev };
    }
    if (pool.reserveA <= 0 || pool.reserveB <= 0) {
      // בריכה ריקה — זריעה מחדש במחיר המוצע
      await adjust(member, pool.assetA as ExchangeAsset, -maxA);
      await adjust(member, pool.assetB as ExchangeAsset, -maxB);
      const minted = Math.sqrt(maxA * maxB);
      await db.exchangePool.update({ where: { pair }, data: { reserveA: maxA, reserveB: maxB, lpShares: JSON.stringify({ [member]: minted }) } });
      const ev = await chainEvent("LP_SEED", member, { pair, reserveA: maxA, reserveB: maxB, sharesMinted: minted, note: "זריעה מחדש לבריכה ריקה" }, null);
      return { ok: true, detail: `הבריכה ${pair} נזרעה מחדש: ${maxA} × ${maxB} · ${minted.toPrecision(6)} מניות ל-${member}`, event: ev };
    }
    // הגירה (בריכות טרום-LP) — לפני כל חישוב בעלות
    const shares = await ensureLpShares(pool);
    // בריכה חיה — הוספה ביחס הקיים (הצד הקטן קובע)
    const ratio = pool.reserveB / pool.reserveA;
    let amtA = maxA;
    let amtB = amtA * ratio;
    if (amtB > maxB) { amtB = maxB; amtA = amtB / ratio; }
    amtA = Math.floor(amtA * 1e9) / 1e9;
    amtB = Math.floor(amtB * 1e9) / 1e9;
    if (amtA <= 0 || amtB <= 0) return { ok: false, detail: "DUST: סכומים מתחת לרצפה" };
    await adjust(member, pool.assetA as ExchangeAsset, -amtA);
    await adjust(member, pool.assetB as ExchangeAsset, -amtB);
    await db.exchangePool.update({
      where: { pair },
      data: {
        reserveA: { increment: amtA },
        reserveB: { increment: amtB },
      },
    });
    // טביעת מניות פרו-רטה: sharesMinted = total × amtA/reserveA (לפני ההוספה)
    const totalBefore = totalLpShares(shares);
    const minted = (totalBefore * amtA) / pool.reserveA;
    const nextShares = { ...shares, [member]: Math.round(((shares[member] ?? 0) + minted) * 1e9) / 1e9 };
    await db.exchangePool.update({ where: { pair }, data: { lpShares: JSON.stringify(nextShares) } });
    const ev = await chainEvent("LP_ADD", member, {
      pair, addedA: amtA, addedB: amtB, sharesMinted: minted,
      memberSharesAfter: nextShares[member],
      reservesAfter: { a: pool.reserveA + amtA, b: pool.reserveB + amtB },
      note: "עומק אמיתי גדל — העמלות נשארות בבריכה, המניות ניתנות לחילוץ",
    }, null);
    return { ok: true, detail: `נוסף עומק ל${pair}: ${amtA} × ${amtB} (ביחס השוק החי) · נטבעו ${minted.toPrecision(4)} מניות-LP ל-${member}`, event: ev };
  } catch (e) {
    return { ok: false, detail: "LP-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

/**
 * מסילת-היציאה לנזילות (R107) — חילוץ פרו-רטה לפי מניות-LP.
 *
 * ההוראה שהנחתה: "טיפול ראוי במטבעות הפנימיים... ועדיין לייצר יכולת
 * להחליף אותם" — עד R107 ההוספה לבריכה הייתה חד-סטרית: העומק נתרם
 * לבריכה ללא דרך חזרה. מעתה מניות-LP הן נכס סחיר: חילוץ שורף מניות
 * ומחזיר רזרבות ביחס המדויק, כולל העמלות שנצברו מאז ההפקדה —
 * שווי-כל-מניה רק צומח.
 */
// R111 — רייל היפוך-עטיפה: החזרת עטיפה מוטעית לספר ביושר.
// נולד מהזרמה כוזבת שנמדדה חי (04:15): גל-שקר עטף 95.327 WSTEEM מהון-סולם
// עומד שהתחזה לדלתא (קו-בסיס ג'נזיס נמדד כשההון היה נעול בפקודות). הרייל:
//   · מזהה את אירוע ה-TREASURY_WRAP המקורי לפי seq — לא ממציאים סכומים
//   · מחלץ קודם את מניות-ה-LP של האוצר מבריכת הזיווג (העומק חוזר)
//   · מקטין את יתרת האוצר בנכס העטיפה עד לגבול הקיים — בכנות מלאה
//   · מסרב לעטיפות הטבעה (WSBD/WHBD) — הפוכן דורש שריפת USDS קודם
//   · כל צעד מתועד בשרשרת-הספר (TREASURY_UNWRAP) עם הפניה למקור
export async function treasuryUnwrap(params: {
  seq: number;
  reason: string;
  issuedBy: "operator" | "daemon";
}): Promise<{ ok: boolean; detail: string; events: string[] }> {
  const events: string[] = [];
  try {
    const orig = await db.exchangeEvent.findUnique({ where: { seq: params.seq } });
    if (!orig || orig.kind !== "TREASURY_WRAP") {
      return { ok: false, detail: `NO-WRAP: seq#${params.seq} אינו אירוע TREASURY_WRAP`, events };
    }
    let pl: { asset?: string; wrap?: string; amount?: number };
    try {
      pl = JSON.parse(orig.payload) as typeof pl;
    } catch {
      return { ok: false, detail: "BAD-PAYLOAD: אירוע המקור לא ניתן לפענוח", events };
    }
    const wrap = pl.wrap as ExchangeAsset | undefined;
    const amount = Number(pl.amount ?? 0);
    if (!wrap || !(amount > 0)) {
      return { ok: false, detail: "BAD-WRAP: חסר נכס או סכום באירוע המקור", events };
    }
    if (wrap === "WSBD" || wrap === "WHBD") {
      return {
        ok: false,
        detail: "MINT-WRAP: עטיפת הטבעה (USDS נטבע מולה 1:1) — ההיפוך דורש שריפת ה-USDS קודם (רייל נפרד)",
        events,
      };
    }
    // שלב א׳ — חילוץ מניות-האוצר מבריכת הזיווג (העומק חוזר למאזן)
    const pair = `${wrap}/USDS`;
    const pool = await db.exchangePool.findUnique({ where: { pair } });
    if (pool) {
      const shares = await ensureLpShares(pool);
      const mine = shares["treasury"] ?? 0;
      if (mine > 0) {
        const r = await removeLiquidity({ member: "treasury", pair, sharePct: 100 });
        events.push(r.ok ? `חולצו מניות-LP מ-${pair}` : `חילוץ LP מ-${pair}: ${r.detail}`);
      }
    }
    // שלב ב׳ — הקטנת יתרת האוצר בנכס העטיפה עד הגבול הקיים
    const balances = await readBalances("treasury");
    const have = Number(balances[wrap] ?? 0);
    const toReturn = Math.min(amount, Math.max(0, have));
    if (toReturn > 0) await adjust("treasury", wrap, -toReturn);
    const shortfall = Math.max(0, Math.round((amount - toReturn) * 1e9) / 1e9);
    // שלב ג׳ — תיעוד בשרשרת-הספר
    await chainEvent("TREASURY_UNWRAP", "treasury", {
      originalSeq: params.seq,
      asset: pl.asset ?? wrap.toLowerCase(),
      wrap,
      amountRequested: amount,
      amountReturned: Math.round(toReturn * 1e9) / 1e9,
      shortfall,
      reason: params.reason.slice(0, 300),
      issuedBy: params.issuedBy,
      evidence: `reversal of wrap seq#${params.seq}`,
    }, null);
    events.push(
      shortfall > 0
        ? `הופרכו ${toReturn} ${wrap} (חסר ${shortfall} — כבר לא בידי האוצר, בכנות)`
        : `הופרכו ${toReturn} ${wrap} במלואם`,
    );
    return {
      ok: true,
      detail: `היפוך עטיפה seq#${params.seq} הושלם: ${toReturn} ${wrap} הוחזרו לספר`,
      events,
    };
  } catch (e) {
    return { ok: false, detail: `UNWRAP-ERROR: ${String((e as Error).message).slice(0, 120)}`, events };
  }
}

export async function removeLiquidity(params: {
  member: string;
  pair: string;
  sharePct: number; // 1..100 מהמניות של החבר
}): Promise<SwapResult> {
  try {
    const { member, pair } = params;
    const sharePct = Math.min(100, Math.max(0.01, params.sharePct));
    const pool = await db.exchangePool.findUnique({ where: { pair } });
    if (!pool) return { ok: false, detail: "NO-POOL" };
    const shares = await ensureLpShares(pool);
    const mine = shares[member] ?? 0;
    if (mine <= 0) return { ok: false, detail: `NO-SHARES: ל-${member} אין מניות-LP ב-${pair}` };
    const total = totalLpShares(shares);
    if (total <= 0) return { ok: false, detail: "EMPTY-BOOK: ספר המניות ריק" };
    const burnShares = Math.min(mine, (mine * sharePct) / 100);
    const frac = burnShares / total;
    const outA = Math.floor(pool.reserveA * frac * 1e9) / 1e9;
    const outB = Math.floor(pool.reserveB * frac * 1e9) / 1e9;
    if (outA <= 0 && outB <= 0) return { ok: false, detail: "DUST: החילוץ מתחת לרצפה — צבר עוד מניות" };
    await adjust(member, pool.assetA as ExchangeAsset, outA);
    await adjust(member, pool.assetB as ExchangeAsset, outB);
    const nextShares = { ...shares, [member]: Math.round((mine - burnShares) * 1e9) / 1e9 };
    if (nextShares[member] <= 0) delete nextShares[member];
    await db.exchangePool.update({
      where: { pair },
      data: {
        reserveA: Math.max(0, Math.round((pool.reserveA - outA) * 1e9) / 1e9),
        reserveB: Math.max(0, Math.round((pool.reserveB - outB) * 1e9) / 1e9),
        lpShares: JSON.stringify(nextShares),
      },
    });
    const ev = await chainEvent("LP_REMOVE", member, {
      pair, burnedShares: burnShares, outA, outB,
      memberSharesAfter: nextShares[member] ?? 0,
      reservesAfter: { a: pool.reserveA - outA, b: pool.reserveB - outB },
      note: "חילוץ פרו-רטה — הנזילות חוזרת לבעליה, העמלות שנצברו אצלו",
    }, null);
    return { ok: true, detail: `חולצו ${outA} ${pool.assetA} + ${outB} ${pool.assetB} מ-${pair} (שריפת ${burnShares.toPrecision(4)} מניות)`, event: ev };
  } catch (e) {
    return { ok: false, detail: "LP-EXIT-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

/**
 * שרשרת הגלגול האוטונומית (R107 · compound) — הסוכן שעובד הופך בעל-נזילות.
 *
 * הדומינו: תגמולי-SAOS יושבים במאזן הסוכן ← השרשרת ממירה את המחצית
 * ל-USDS בבריכה (נזילות מיידית, עמלה נשארת בבריכה) ← שני הצדדים
 * נכנסים כעומק-LP (מניות נטבעות לסוכן) ← ההחלפות הבאות זולות יותר
 * ← העמלות מנפחות את שווי-מנייתו. עבודה→מטבע→נזילות→בעלות.
 *
 * שומרים: צינון 6 שעות · תקציב 4 ביום · מינימום 4 SAOS לגלגול (מתחת
 * לזה הגלגול שוחק דיוק). כישלון נרשם ככישלון.
 */
export async function agentCompound(params: {
  member: string;
  firedBy: string;
}): Promise<{ ok: boolean; detail: string; steps?: string[] }> {
  const steps: string[] = [];
  const chain: ChainName = "compound";
  const guard = await chainGuard(chain);
  if (!guard.allowed) return { ok: false, detail: guard.reason };
  try {
    const { member } = params;
    const MIN_COMPOUND = 4; // SAOS — מתחת לזה הגלגול שוחק דיוק
    const bal = await readBalances(member);
    const saos = bal.SAOS ?? 0;
    if (saos < MIN_COMPOUND) {
      await chainLog(chain, "hold", params.firedBy, true, `מחזיק: ${saos} SAOS מתחת לרף ${MIN_COMPOUND} — צוברים בסבלנות`);
      return { ok: true, detail: `HOLD · ל-${member} יש ${saos} SAOS — מתחת לרף הגלגול (${MIN_COMPOUND}); צוברים`, steps: ["מחזיק מתחת לרף — כנות"] };
    }
    // שלב 1: המרת המחצית ל-USDS — נזילות מיידית מהעבודה
    const swapAmt = Math.floor((saos / 2) * 1e6) / 1e6;
    const sw = await swap({ member, pair: "SAOS/USDS", side: "A2B", amountIn: swapAmt });
    if (!sw.ok) {
      await chainLog(chain, "swap", params.firedBy, false, `המרה נכשלה: ${sw.detail}`);
      return { ok: false, detail: `SWAP-STEP-FAIL: ${sw.detail}` };
    }
    steps.push(`הומרו ${swapAmt} SAOS ← USDS (עמלה נשארה בבריכה)`);
    // שלב 2: שני הצדדים כעומק — הסוכן הופך בעל-נזילות
    const bal2 = await readBalances(member);
    const saosLeft = bal2.SAOS ?? 0;
    const usdsNow = bal2.USDS ?? 0;
    const lp = await addLiquidity({ member, pair: "SAOS/USDS", maxA: saosLeft, maxB: usdsNow });
    if (!lp.ok) {
      await chainLog(chain, "lp-add", params.firedBy, false, `הוספת-נזילות נכשלה: ${lp.detail} (ההמרה בוצעה — הנזילות במאזן)`);
      return { ok: false, detail: `LP-STEP-FAIL: ${lp.detail}`, steps };
    }
    steps.push(lp.detail);
    await chainLog(chain, "lp-add", params.firedBy, true, `${member}: ${steps.join(" · ")}`);
    return {
      ok: true,
      detail: `השרשרת הושלמה: ${steps.join(" · ")} — העבודה הפכה בעלות-נזילות מניבה`,
      steps,
    };
  } catch (e) {
    const detail = "COMPOUND-ERROR: " + String((e as Error).message ?? e).slice(0, 120);
    await chainLog(chain, "error", params.firedBy, false, detail);
    return { ok: false, detail };
  }
}

/**
 * טריגר איזון-הבריכות (R108 · pool-guard) — הפרמייה נשארת בבית.
 *
 * הבעיה שנמדדה: בריכות האוצר נזרעו ב"מחיר מוכרז" — ומאז השוק זז.
 * סטייה בין מחיר-הבריכה לשווי-החיצוני היא חלון-ערבוב: מי שסוגר
 * אותו לוקח את הפער. בלי שומר — הפער נלקח על ידי ערבוב-חוץ; עם
 * שומר — האוצר סוגר אותו בעצמו והערך נשאר בבית.
 *
 * העוגן-אמת (חידוש R108): סטיית הבריכה נמדדת במונחי-USD אמיתיים —
 * כי USDS איננו דולר ולא מתחזה להיות: הוא תביעה על רזרבת-סטייבל
 * נעולה (SBD/HBD). שווי-הUSDS הכנה = השווי החיצוני של הרזרבה שמאחוריו,
 * נמדח לפי ההרכב. ברירה שקרנית ("USDS=$1") הייתה מציגה סטייה של +44%
 * ב-WBLURT/USDS בזמן שהאמת היא ~-7% — הפוכה לגמרי, ומי שהיה בונה
 * עליה היה מפסיד.
 *
 * החוקים:
 *   · רצפת-USDS-שוק: האוצר לעולם לא מרוקן מתחת לרצפה — השוק הפנימי
 *     חי מהנזילות הזו.
 *   · תקרת-נפח: 2% מרזרבת הבריכה לפעולה — הסטייה נסגרת בהדרגה,
 *     בלי להפיל את המחיר על המשתמשים.
 *   · רווח נקי: פעולה יורה רק אם מחיר-הביצוע (כולל עמלה+החלקה,
 *     בנוסחת ה-AMM עצמה) עדיין בצד הנכון של העוגן.
 *   · אין עוגן → אין מסקנה (SAOS נשפט רק בשוק-הפנים שלו).
 */
export async function poolGuard(params: {
  issuedBy: "operator" | "daemon";
  bandBps?: number;
}): Promise<{ ok: boolean; detail: string; pools: Array<{ pair: string; action: string; devBps: number | null; note: string }> }> {
  const out: Array<{ pair: string; action: string; devBps: number | null; note: string }> = [];
  try {
    const guard = await chainGuard("pool-guard");
    if (!guard.allowed) return { ok: false, detail: guard.reason, pools: out };
    const bandBps = params.bandBps ?? 500;
    const prices = await pricesUsd();
    const reserveBal = await readBalances("reserve");
    const sbdLocked = reserveBal.WSBD ?? 0;
    const hbdLocked = reserveBal.WHBD ?? 0;
    // עוגן-האמת של USDS: שווי-החוץ של הנעילה — לפי ההרכב בפועל
    let usdsUsd: number | null = null;
    if (sbdLocked + hbdLocked > 0 && prices.sbd != null) {
      const hbdP = hbdLocked > 0 ? (prices.hbd ?? prices.sbd) : null;
      const numerator = sbdLocked * (prices.sbd as number) + hbdLocked * (hbdP ?? 0);
      usdsUsd = numerator / (sbdLocked + hbdLocked);
    }
    if (usdsUsd == null) {
      return { ok: false, detail: "NO-USDS-MARK: אין עוגן חי לשווי הרזרבה — אין מסקנה, אין פעולה (כנות)", pools: out };
    }

    const pools = await db.exchangePool.findMany();
    const USDS_FLOOR = 0.003; // רצפת-השוק: ה-USDS שמשרת את המסחר הפנימי
    const SIZE_CAP_FRAC = 0.02; // 2% מהבריכה לפעולה — סגירה הדרגתית
    const wrapToPriceKey: Record<string, keyof typeof prices> = {
      WSTEEM: "steem", WHIVE: "hive", WBLURT: "blurt", WSOL: "sol", WETH: "eth",
    };

    for (const p of pools) {
      if (p.assetB !== "USDS") continue; // שומר-בריכות USDS-צמודות בשלב זה
      const priceKey = wrapToPriceKey[p.assetA];
      const extUsd = priceKey ? (prices[priceKey] ?? null) : null;
      if (!extUsd || p.reserveA <= 0 || p.reserveB <= 0) {
        out.push({ pair: p.pair, action: "SKIP", devBps: null, note: p.assetA === "SAOS" ? "SAOS נשפט בשוק-הפנים שלו — אין עוגן חיצוני ואין כזה צריך" : "אין מחיר חיצוני חי — אין מסקנה" });
        continue;
      }
      const poolPrice = p.reserveB / p.reserveA; // USDS ליחידת assetA
      const extInUsds = extUsd / usdsUsd; // העוגן במונחי USDS-אמת
      const devBps = Math.round((poolPrice / extInUsds - 1) * 10_000);
      if (Math.abs(devBps) < bandBps) {
        out.push({ pair: p.pair, action: "HOLD", devBps, note: `בתוך הטווח (±${bandBps}bps)` });
        continue;
      }
      const cheap = devBps < 0; // הבריכה מוכרת את assetA מתחת לשווי
      const treasuryBal = await readBalances("treasury");
      const treasUsds = treasuryBal.USDS ?? 0;
      const treasA = (treasuryBal as Balances)[p.assetA as ExchangeAsset] ?? 0;
      // תקרת הנפח: 2% מהצד הרלוונטי — הכיוון שנסחר בו
      const capA = p.reserveA * SIZE_CAP_FRAC;

      if (cheap) {
        // הבריכה זולה ← האוצר קונה assetA בהנחה מהשוק הפנימי שלו עצמו
        const budgetUsds = Math.max(0, treasUsds - USDS_FLOOR);
        if (budgetUsds <= 0) {
          out.push({ pair: p.pair, action: "HOLD", devBps, note: `הבריכה זולה (${devBps}bps) אבל האוצר ברצפת-USDS — ההנחה נשארת לשוק (כנות)` });
          continue;
        }
        // כמה assetA אפשר לקנות: מוגבל בתקרה ובתקציב (במחיר הבריכה בערך)
        const wantA = Math.min(capA, budgetUsds / poolPrice);
        if (wantA <= 0) { out.push({ pair: p.pair, action: "HOLD", devBps, note: "אבק — מתחת לרצפת פעולה" }); continue; }
        // בדיקת רווח-נקי: מחיר-הביצוע מנוסחת ה-AMM עצמה (עמלה בפנים)
        const inUsds = wantA * poolPrice;
        const inWithFee = inUsds * (10000 - p.feeBps) / 10000;
        const execOutClean = (p.reserveA * inWithFee) / (p.reserveB + inWithFee);
        if (execOutClean <= 0) { out.push({ pair: p.pair, action: "HOLD", devBps, note: "חישוב-ביצוע נכשל" }); continue; }
        const execPrice = inUsds / execOutClean;
        if (execPrice >= extInUsds) {
          out.push({ pair: p.pair, action: "HOLD", devBps, note: `סטייה ${devBps}bps אך ההחלקה מוחקת את הרווח — ממתינים (ביצוע ${execPrice.toPrecision(4)} ≥ עוגן ${extInUsds.toPrecision(4)})` });
          continue;
        }
        const sw = await swap({ member: "treasury", pair: p.pair, side: "B2A", amountIn: inUsds });
        if (!sw.ok) { await chainLog("pool-guard", "buy", params.issuedBy, false, `${p.pair}: ${sw.detail}`); out.push({ pair: p.pair, action: "BUY-FAIL", devBps, note: sw.detail }); continue; }
        await chainLog("pool-guard", "buy", params.issuedBy, true, `${p.pair}: נקנו ${execOutClean.toPrecision(4)} ${p.assetA} ב-${execPrice.toPrecision(4)} USDS מול עוגן ${extInUsds.toPrecision(4)} (${devBps}bps סטייה נסגרה חלקית)`);
        out.push({ pair: p.pair, action: "BUY", devBps, note: `האוצר קנה ${execOutClean.toPrecision(4)} ${p.assetA} מתחת לעוגן — ההנחה נשארת בבית` });
      } else {
        // הבריכה יקרה ← האוצר מוכר assetA בפרימייה — USDS (נדיר) זורם לאוצר
        const haveA = Math.min(treasA, capA);
        if (haveA <= 0) { out.push({ pair: p.pair, action: "HOLD", devBps, note: `הבריכה יקרה (${devBps}bps) אבל אין מלאי-אוצר למכירה` }); continue; }
        // בדיקת רווח-נקי לכיוון מכירה
        const inWithFee = haveA * (10000 - p.feeBps) / 10000;
        const execOutUsds = (p.reserveB * inWithFee) / (p.reserveA + inWithFee);
        if (execOutUsds <= 0) continue;
        const execPrice = execOutUsds / haveA;
        if (execPrice <= extInUsds) {
          out.push({ pair: p.pair, action: "HOLD", devBps, note: `סטייה +${devBps}bps אך ההחלקה מוחקת את הרווח — ממתינים` });
          continue;
        }
        const sw = await swap({ member: "treasury", pair: p.pair, side: "A2B", amountIn: haveA });
        if (!sw.ok) { await chainLog("pool-guard", "sell", params.issuedBy, false, `${p.pair}: ${sw.detail}`); out.push({ pair: p.pair, action: "SELL-FAIL", devBps, note: sw.detail }); continue; }
        await chainLog("pool-guard", "sell", params.issuedBy, true, `${p.pair}: נמכרו ${haveA} ${p.assetA} ב-${execPrice.toPrecision(4)} USDS מעל עוגן ${extInUsds.toPrecision(4)} — הפרימייה לאוצר`);
        out.push({ pair: p.pair, action: "SELL", devBps, note: `האוצר מכר בפרימייה — USDS נדיר נכנס לאוצר` });
      }
    }
    return { ok: true, detail: `איזון-בריכות נמדד · ${out.length} בריכות · USDS-עוגן $${usdsUsd.toFixed(4)}`, pools: out };
  } catch (e) {
    const detail = "POOL-GUARD-ERROR: " + String((e as Error).message ?? e).slice(0, 140);
    await chainLog("pool-guard", "error", params.issuedBy, false, detail);
    return { ok: false, detail, pools: out };
  }
}

/**
 * הזרמת דלק-שרשרת לבריכות (R103) — הפאוורדאון השבועי הופך לעומק.
 *
 * החוק: הכסף החי על השרשרת שטרם נצרף (הדלתא מעל האירוע-WRAP האחרון)
 * מתגלגל בחלקו לעטיפה (W*) ומזווג ל-USDS במחיר השוק החי. מה שאין
 * לו זיווג נשאר במאזן האוצר — כנות: העומק גדל רק מכסף אמיתי.
 */
// R111 — היצע עטיפה כולל: מאזני כל החברים בנכס + רזרבות הבריכות בצד שלו.
// זו התביעה המלאה על ההון החי בשרשרת — הבסיס לשומר-הגיבוי.
// r125a · כנות: ספר שלא נקרא אינו "0 תביעות" — אי-מדידה (null). השומר
// מסרב כשאינו יכול למדוד את התביעה — חוק r124: כישלון-קריאה בחישוב-
// כסף הוא סירוב, לא אפס.
async function wrapSupply(asset: string): Promise<number | null> {
  try {
    const accts = await db.exchangeAccount.findMany();
    let supply = 0;
    for (const a of accts) {
      try {
        const bal = JSON.parse(a.balances ?? "{}") as Record<string, number>;
        supply += Number(bal[asset] ?? 0) || 0;
      } catch { /* ספר ישן */ }
    }
    const poolsA = await db.exchangePool.findMany({ where: { assetA: asset } });
    for (const p of poolsA) supply += Number(p.reserveA) || 0;
    const poolsB = await db.exchangePool.findMany({ where: { assetB: asset } });
    for (const p of poolsB) supply += Number(p.reserveB) || 0;
    return Math.round(supply * 1e9) / 1e9;
  } catch {
    return null;
  }
}

export async function liquidityStream(params: {
  share?: number; // חלק הדלתא שיוזרם (ברירת מחדל 0.2)
  issuedBy: "operator" | "daemon";
}): Promise<{ ok: boolean; detail: string; events: string[] }> {
  try {
    const share = Math.min(1, Math.max(0, params.share ?? 0.2));
    const m = await measureTreasury();
    if (!m) return { ok: false, detail: "NO-MEASURE: השרשרת לא ענתה — אין הזרמה", events: [] };
    const events: string[] = [];
    // r125a · כנות-מדידה: רגל RPC שנפלה מגיעה כ-0 — אבל 0 שאינו מדידה אינו
    // "אין הון". הדגל נחשף בפלט (events) כדי שחוסר-המדידה לא ייקרא
    // עובדה נמדדת; הכיוון שמרני (אין הזרמה על רגל שלא נמדדה).
    for (const leg of ["sol", "eth"] as const) {
      if (!m.rpc[leg]) events.push(`מדידת-אוצר חלקית: rpc ${leg} למטה — יתרת ${leg} לא נמדדה (0 שמרני, לא מדידה)`);
    }

    // הדלתא: המאזן החי מעל מה שכבר נצרף (אירועי WRAP מתועדים)
    const wrapped = new Map<string, number>();
    const wrapEvents = await db.exchangeEvent.findMany({ where: { kind: "TREASURY_WRAP" }, orderBy: { seq: "asc" } });
    for (const e of wrapEvents) {
      try {
        const pl = JSON.parse(e.payload) as { asset?: string; measuredBalance?: number };
        if (pl.asset && typeof pl.measuredBalance === "number") {
          wrapped.set(pl.asset, Math.max(wrapped.get(pl.asset) ?? 0, pl.measuredBalance));
        }
      } catch { /* ספר ישן — דלתא מהג'נזיס */ }
    }
    // ג'נזיס: המאזן שנמדד אז הוא קו הבסיס
    const genesis = await db.exchangeEvent.findFirst({ where: { kind: "GENESIS" } });
    if (genesis) {
      try {
        const pl = JSON.parse(genesis.payload) as { measured?: Record<string, number> };
        const base = pl.measured ?? {};
        for (const [k, v] of Object.entries(base)) {
          if (typeof v === "number" && !wrapped.has(k)) wrapped.set(k, v);
        }
      } catch { /* כנות */ }
    }

    // נכסי ההזרמה: STEEM (פאוורדאון) · HIVE · BLURT · SOL · ETH — כולם בעלי דלתא-דלק חוצה-רשתות
    // (R105: SOL/ETH מצטרפים; רצפות-דלתא לפי סדר-גודל היחידה — 1 STEEM ≠ 1 ETH)
    // R107 — שרשרת מלאי→הטבעה→היצע: SBD/HBD מעל קו-החימוש נעטפים
    // ומומרים ל-USDS ב-1:1 מול נעילה מלאה. צוואר-ה-USDS-הנדיר נפתר
    // מהכנסה (מילויי-המכירה מצטברים SBD) — לא מהבטחה. חוק-העדיפות:
    // קו-החימוש (0.15 SBD) אף פעם לא נשחק — צד-הקנייה של הגריד קודם.
    const streamAssets: Array<{ live: number; key: string; wrap: ExchangeAsset; priceKey: string; minDelta: number; minWrap: number; keep?: number; mintUsds?: boolean }> = [
      { live: m.sbd, key: "sbd", wrap: "WSBD", priceKey: "sbd", minDelta: 0.005, minWrap: 0.001, keep: ARM_KEEP_SBD, mintUsds: true },
      { live: m.hbd, key: "hbd", wrap: "WHBD", priceKey: "hbd", minDelta: 0.005, minWrap: 0.001, mintUsds: true },
      { live: m.steem, key: "steem", wrap: "WSTEEM", priceKey: "steem", minDelta: 1, minWrap: 0.001 },
      { live: m.hive, key: "hive", wrap: "WHIVE", priceKey: "hive", minDelta: 1, minWrap: 0.001 },
      { live: m.blurt, key: "blurt", wrap: "WBLURT", priceKey: "blurt", minDelta: 1, minWrap: 1 },
      { live: m.sol, key: "sol", wrap: "WSOL", priceKey: "sol", minDelta: 0.01, minWrap: 0.001 },
      { live: m.eth, key: "eth", wrap: "WETH", priceKey: "eth", minDelta: 0.0005, minWrap: 0.00005 },
    ];
    const prices = await pricesUsd();
    let totalWrapped = 0;

    for (const a of streamAssets) {
      const baseline = Math.max(wrapped.get(a.key) ?? 0, a.keep ?? 0);
      const delta = a.live - baseline;
      if (delta < a.minDelta) continue; // אין דלק חדש — כנות
      const shareHere = a.mintUsds ? 1 : share; // SBD/HBD: העודף המלא — כל יחידה נעולה 1:1
      const toWrap = Math.floor(delta * shareHere * 1000) / 1000;
      if (toWrap < a.minWrap) continue;
      if (a.mintUsds) {
        // R107 — שרשרת מלאי→הטבעה→היצע: עטיפה ואז הטבעה 1:1 מול נעילה
        // מלאה. לא צריך מחיר חיצוני — היחס הוא חוק הרזרבה. הסחירות
        // נשמרת דו-כיוונית: usdsBurn משחרר את הנעילה בכל עת.
        const guardMint = await chainGuard("sbd-mint");
        if (!guardMint.allowed) { events.push(`${a.key}: ${guardMint.reason}`); continue; }
        await adjust("treasury", a.wrap, toWrap);
        await chainEvent("TREASURY_WRAP", "treasury", {
          asset: a.key, wrap: a.wrap, amount: toWrap, measuredBalance: a.live, baseline, delta,
          share: shareHere, evidence: `chain-balance(${a.key})=${a.live}`,
        }, null);
        const mint = await usdsMint("treasury", a.wrap as "WSBD" | "WHBD", toWrap);
        if (mint.ok) {
          events.push(`נטבעו ${toWrap} USDS מול נעילת ${toWrap} ${a.wrap} — גיבוי-רזרבה מלא 1:1`);
        } else {
          events.push(`הטבעת USDS מ-${a.key} נכשלה: ${mint.detail}`);
        }
        totalWrapped += 1;
        continue;
      }
      const price = prices[a.priceKey];
      if (price == null) { events.push(`${a.key}: אין מחיר חי — הדלתא (${delta.toFixed(6)}) ממתינה בכנות`); continue; }
      // R111 — שומר-הגיבוי: היצע העטיפה כולו (מאזני חברים + רזרבות בבריכות)
      // חייב להישאר מתחת להון החי על השרשרת גם אחרי העטיפה הזו — אחרת
      // הבטחת ה-1:1 נשברת ברגע שההון זז (מכירת סולם · משיכה). נולד
      // מהזרמה כוזבת שנמדדה חי (95.327 WSTEEM מהון סולם עומד שהתחזה לדלתא).
      // r125a: תביעה שלא נמדדה (null) = סירוב-כנה — לא עטיפה בעיוורון.
      const claimBefore = await wrapSupply(a.wrap);
      if (claimBefore == null) {
        events.push(`${a.key}: שומר-הגיבוי לא קרא את היצע ${a.wrap} (ספר לא-נקרא) — העטיפה נדחית בכנות: הבטחת 1:1 קודמת לעומק`);
        continue;
      }
      if (claimBefore + toWrap > a.live + 1e-9) {
        events.push(`${a.key}: שומר-הגיבוי סירב — תביעה ${(claimBefore + toWrap).toFixed(3)} מעל הון חי ${a.live.toFixed(3)} — ההבטחה 1:1 קודמת לעומק`);
        continue;
      }
      // עטיפה — האוצר מקבל W* מול ההון החי שנמדד
      await adjust("treasury", a.wrap, toWrap);
      // R105 — תיקון-שורש (נתפס לפני שגל-הפאוורדאון הגיע): ה-WRAP נכתב תחת
      // מפתח-השרשרת (a.key) כמו שהקורא מחפש — לא תחת שם-העטיפה. בלי
      // התיקון, קו-הבסיס לא התקדם לעולם ואותה דלתא הייתה נעטפת שוב
      // ושוב — עטיפת-יתר מול הון אמיתי.
      const ev = await chainEvent("TREASURY_WRAP", "treasury", {
        asset: a.key, wrap: a.wrap, amount: toWrap, measuredBalance: a.live, baseline, delta,
        share, evidence: `chain-balance(${a.key})=${a.live}`,
      }, null);
      events.push(`עוטף ${toWrap} ${a.wrap} מדלתא ${delta.toFixed(3)} ${a.key} (חלק ${Math.round(share * 100)}%)`);

      // זיווג ל-USDS: בריכת W*/USDS — נבנית אם איננה (במחיר השוק החי)
      const pair = `${a.wrap}/USDS`;
      const pool = await db.exchangePool.findUnique({ where: { pair } });
      const usdsNeed = toWrap * price; // כמה USDS שווה הצד שלנו
      const treasuryBal = await readBalances("treasury");
      const usdsAvail = treasuryBal.USDS ?? 0;
      if (usdsAvail <= 0) { events.push(`${pair}: אין USDS לזיווג — ה-W* ממתין במאזן האוצר (כנות)`); continue; }
      if (!pool || pool.reserveA <= 0) {
        // בריכה חדשה במחיר השוק החי
        let amtA = toWrap, amtB = Math.min(usdsAvail, usdsNeed);
        if (amtB < usdsNeed) amtA = amtB / price; // מה שיש — לא הבטחה
        if (amtA < 0.001 || amtB < 0.000001) { events.push(`${pair}: אבק — דלג בכנות`); continue; }
        await addLiquidity({ member: "treasury", pair, maxA: amtA, maxB: amtB });
        events.push(`נזרעה ${pair}: ${amtA.toFixed(3)} × ${amtB.toFixed(6)} (מחיר פתיחה ${price.toPrecision(4)}$)`);
      } else {
        await addLiquidity({ member: "treasury", pair, maxA: toWrap, maxB: usdsAvail });
        events.push(`עומק ${pair} גדל (${toWrap.toFixed(3)} ${a.wrap} + זיווג USDS)`);
      }
      totalWrapped += 1;
    }
    if (totalWrapped === 0 && events.length === 0) {
      return { ok: true, detail: "אין דלק חדש מעל קו-הבסיס — אין מה להזרים (כנות)", events };
    }
    // r125a: אפס-הזרמות עם רישומים (גילוי-rpc, סירובי-שומר) אינו "הוזרם
    // עומק אמיתי: 0" — הכנות נשמרת גם בכותרת הפלט.
    return {
      ok: true,
      detail:
        totalWrapped === 0
          ? `אף נכס לא הוזרם במחזור זה · ${events.length} רישומי-כנות/סירובים`
          : `הוזרם עומק אמיתי: ${totalWrapped} נכסים · ${events.length} פעולות`,
      events,
    };
  } catch (e) {
    return { ok: false, detail: "STREAM-ERROR: " + String((e as Error).message ?? e).slice(0, 120), events: [] };
  }
}

// ── תמונת-הזירה ──────────────────────────────────────────────────────

export interface ExchangeSnapshot {
  ok: boolean;
  at: string;
  genesis: boolean;
  pools: Array<{
    pair: string;
    assetA: string;
    assetB: string;
    reserveA: number;
    reserveB: number;
    price: number;
    priceLabel: string;
    feeBps: number;
    volumeA: number;
    volumeB: number;
    swaps: number;
    depthUsd: number | null;
    lpShares: Record<string, number>;
    lpTotal: number;
  }>;
  chains: Awaited<ReturnType<typeof chainState>>;
  backingMark: {
    usdsUsd: number | null; // עוגן-האמת: שווי-החוץ של הגיבוי שמאחורי כל USDS
    sbdUsd: number | null;
    hbdUsd: number | null;
    wsbd: number;
    whbd: number;
    note: string;
  };
  reserve: { usdsSupply: number; sbdLocked: number; hbdLocked: number; ratio: string };
  treasury: Balances;
  members: Array<{ member: string; balances: Balances }>;
  prices: Record<string, number | null>;
  recentEvents: Array<ChainedEvent & { usdValue?: number | null; createdAt?: string; truthClass?: "SIM" }>;
  bookIntegrity: { events: number; headHash: string | null; recomputeOk: boolean | null };
  /** r145-a — חוק אמת-הספרים: הזירה הזאת היא ספר-תביעות פנימי (SIM-class) —
   *  המדינות המלאות (realBooks/simBooks + מונים) חשופות בשדה truth */
  truth: Awaited<ReturnType<typeof import("@/lib/weave/book-truth").bookTruth>>;
  depositDoor: { memo: string; treasury: string; chain: string; doors: Array<{ chain: string; account?: string; address?: string; hint?: string }> };
  note: string;
}

export async function exchangeSnapshot(): Promise<ExchangeSnapshot> {
  const at = new Date().toISOString();
  const genesis = await ensureExchange();
  await ensureNetworkAdd(); // R105 — חיבור SOL/ETH לזירה (אידמפוטנטי)
  const pools = await db.exchangePool.findMany({ orderBy: { pair: "asc" } });
  const prices = await pricesUsd();
  const poolRows = pools.map((p) => {
    const priceKeyA = p.assetA === "WSTEEM" ? "steem" : p.assetA === "WBLURT" ? "blurt" : p.assetA === "SAOS" ? null : p.assetA === "WHIVE" ? "hive" : null;
    const priceKeyB = p.assetB === "WSBD" ? "sbd" : p.assetB === "WHBD" ? "hbd" : p.assetB === "WSTEEM" ? "steem" : p.assetB === "WBLURT" ? "blurt" : null;
    const usdA = priceKeyA ? (prices[priceKeyA] ?? null) : null;
    const usdB = priceKeyB ? (prices[priceKeyB] ?? null) : null;
    let depthUsd: number | null = null;
    if (usdA != null) depthUsd = p.reserveA * usdA * 2;
    else if (usdB != null) depthUsd = p.reserveB * usdB * 2;
    const price = p.reserveA > 0 ? p.reserveB / p.reserveA : 0;
    const lpShares = readLpShares(p.lpShares);
    return {
      pair: p.pair, assetA: p.assetA, assetB: p.assetB,
      reserveA: p.reserveA, reserveB: p.reserveB,
      price, priceLabel: `${price.toPrecision(4)} ${p.assetB}/${p.assetA}`,
      feeBps: p.feeBps, volumeA: p.volumeA, volumeB: p.volumeB, swaps: p.swaps,
      depthUsd,
      lpShares, lpTotal: totalLpShares(lpShares),
    };
  });
  const reserveBal = await readBalances("reserve");
  const treasuryBal = await readBalances("treasury");
  const accts = await db.exchangeAccount.findMany({ orderBy: { member: "asc" } });
  const events = await db.exchangeEvent.findMany({ orderBy: { seq: "desc" }, take: 20 });
  // שלמות הספר — חישוב-חדש של השרשרת כולה
  const all = await db.exchangeEvent.findMany({ orderBy: { seq: "asc" } });
  let prev = "0";
  let recomputeOk = true;
  let headHash: string | null = null;
  for (const e of all) {
    const h = hashText(`${prev}|${e.seq}|${e.kind}|${e.member}|${e.payload}`);
    if (h !== e.hash || e.prevHash !== prev) { recomputeOk = false; break; }
    prev = e.hash;
    headHash = e.hash;
  }
  // R107 — אמת-ההיצע: USDS במחזור = מאזני חברים (למעט סיר-הרזרבה) +
  // צדדי-הUSDS בבריכות. סיר-הרזרבה (reserve.USDS) איננו כסף במחזור —
  // הוא קיבולת הפדיון. ההצגה הקודמת קראה לסיר "היצע" והציגה מספר
  // שקטן ככל שמטביעים יותר — ההפך מהאמת. הספר שופט: מחזור = נעילה.
  let circulatingUsds = 0;
  for (const a of accts) {
    if (a.member === "reserve") continue;
    try { circulatingUsds += (JSON.parse(a.balances)?.USDS ?? 0) || 0; } catch { /* ספר ישן */ }
  }
  for (const p of pools) {
    if (p.assetB === "USDS") circulatingUsds += p.reserveB;
    if (p.assetA === "USDS") circulatingUsds += p.reserveA;
  }
  const lockedUsds = (reserveBal.WSBD ?? 0) + (reserveBal.WHBD ?? 0);
  const ratioOk = Math.abs(circulatingUsds - lockedUsds) < 1e-9;
  return {
    ok: true,
    at,
    genesis,
    pools: poolRows,
    chains: await chainState(),
    backingMark: (() => {
      const wsbd = reserveBal.WSBD ?? 0;
      const whbd = reserveBal.WHBD ?? 0;
      const sbdUsd = prices.sbd ?? null;
      const hbdUsd = prices.hbd ?? null;
      let usdsUsd: number | null = null;
      if (wsbd + whbd > 0 && sbdUsd != null) {
        const hbdP = whbd > 0 ? (hbdUsd ?? sbdUsd) : 0;
        usdsUsd = (wsbd * sbdUsd + whbd * hbdP) / (wsbd + whbd);
      }
      return {
        usdsUsd,
        sbdUsd,
        hbdUsd,
        wsbd,
        whbd,
        note: usdsUsd == null
          ? "אין מדידת-חוץ חיה לרזרבה — אין עוגן, אין מסקנה"
          : `USDS = תביעה על רזרבה נעולה — שוויה-היציאה הכנה $${usdsUsd.toFixed(4)} לפי מדידת-חוץ חיה`,
      };
    })(),
    reserve: {
      usdsSupply: circulatingUsds,
      sbdLocked: reserveBal.WSBD ?? 0,
      hbdLocked: reserveBal.WHBD ?? 0,
      ratio: ratioOk
        ? "1:1 מאומת בספר (מחזור = נעילה, תמיד)"
        : `פער נמדח ${(circulatingUsds - lockedUsds).toFixed(9)} USDS — הספר שופט, נחקר`,
    },
    treasury: treasuryBal,
    members: accts.map((a) => ({ member: a.member, balances: JSON.parse(a.balances) as Balances })),
    prices,
    recentEvents: events.map((e) => ({
      seq: e.seq, kind: e.kind, member: e.member, payload: e.payload, prevHash: e.prevHash, hash: e.hash,
      usdValue: e.usdValue ?? null, createdAt: e.createdAt?.toISOString?.() ?? String(e.createdAt),
      // r145-a — תיוג-שורה מפורש: כל אירוע בספר הזה SIM-class (ספר-תביעות
      // פנימי hash-chained) — אף צופה לא יכול לקרוא לו פעילות-שרשרת.
      truthClass: "SIM" as const,
    })),
    bookIntegrity: { events: all.length, headHash, recomputeOk: all.length > 0 ? recomputeOk : null },
    // r145-a — אמת-הספרים: הספר הזה SIM-class — המדינות נמדדות ונחשפות כאן
    truth: await (async () => {
      const { bookTruth } = await import("@/lib/weave/book-truth");
      return bookTruth();
    })(),
    depositDoor: {
      memo: "wx:<member>",
      treasury: TREASURY,
      chain: "STEEM+HIVE+BLURT (גרפן) · SOL+ETH (לא-גרפניות) — 5 דלתות חיות (R105)",
      doors: [
        { chain: "STEEM", account: TREASURY },
        { chain: "HIVE", account: TREASURY },
        { chain: "BLURT", account: TREASURY },
        { chain: "SOL", address: SOL_TREASURY_PUB, hint: "מזכר בהוראת spl-memo" },
        { chain: "ETH", address: ETH_TREASURY_ADDR, hint: "מזכר בשדה input-data (utf8)" },
      ],
    },
    note: genesis
      ? "הזירה חיה: ספר hash-chained, USDS בגיבוי-רזרבה מלא, עמלות בבריכות שלנו. עומק = ההון הריאלי בלבד — לא מציגים נזילות שאיננה."
      : "הג'נזיס ממתין למדידת-אוצר חיה (RPC) — כנות: בלי מדידה אין זריעה",
  };
}
