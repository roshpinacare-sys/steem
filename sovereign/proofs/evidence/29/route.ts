// ─────────────────────────────────────────────────────────────────────
// /api/treasury — מלאי-הכסף האמת של הרשת, מדידה חיה מהשרשרות.
//
// שום דבר לא מומר "מידע" — כל מספר כאן נקרא מ-RPC ציבורי או מ-API
// ציבורי בזמן הבקשה (או ממטמון 60 שניות). שרשרת שנפלה מסומנת
// "down" בכנות — אף מספר לא מומצא, אף טענה לא מתקבלת מסתם.
//
// מקורות: api.steemit.com · api.hive.blog · apilist.tronscanapi.com ·
// ethereum-rpc.publicnode.com · solana-rpc.publicnode.com ·
// blockchain.info · api.binance.com · הקונסולה הציבורית שלנו.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";

export const dynamic = "force-dynamic";

// ── כתובות-הצי (כולן פומביות, אומתו מול המניפסט ומול השרשרות) ────────

const STEEM_FLEET = [
  "headcorner",
  "cashmachine",
  "haran",
  "lsa",
  "macrame",
  "siq",
  "tov",
  "wic",
  "wog",
  "woq",
  "ynet",
  "israelnews",
  "powerspan",
] as const;

const TRON_ADDRS = [
  { label: "כתובת-ההפקדה (TRON)", address: "TVESRr1TX1RaKzsN6TKszutJBFDPEGPx1e" },
  { label: "משמורת-הדלת (2 TRX · הגיבוי של WTRX)", address: "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy" },
  { label: "headcorner (idx=2)", address: "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn" },
  { label: "headcorner (R11-derive)", address: "TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU" },
] as const;

const EVM_ADDRS = [
  { label: "כתובת-ההפקדה (EVM)", address: "0x9978ab0f642bbf0b75e92db0e639ee863e053ac4" },
  { label: "headcorner (idx=2)", address: "0x2767e8146c11bad1d9b0784f11325375195c1b0f" },
  { label: "סוכן-הלב (0x0FB6)", address: "0x0fb6c1807d8d7945b5e3a14ea3679e19795cb545" },
] as const;

const SOL_ADDRS = [
  { label: "כתובת-ההפקדה (SOL)", address: "8SGkrAjepscF3ttD5UzxyFwX8DgREUBD3cjNe5ZEmnCk" },
  { label: "headcorner (idx=2)", address: "9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL" },
  { label: "headcorner (R11-derive)", address: "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj" },
] as const;

const BTC_ADDRS = [
  { label: "כתובת-ההפקדה (BTC)", address: "bc1qpgfuznfxncqqvs3j20p3p38kesu4ljsqhha58c" },
  { label: "headcorner (idx=2)", address: "bc1qf7czhpnpkc8mwx32r5gleqw0kj99j823822pmg" },
] as const;

const EVM_RPC = "https://ethereum-rpc.publicnode.com";
const SOL_RPC = "https://solana-rpc.publicnode.com";

// ── עזרי-רשת: טיימאאוט אמת, ניסיון-כפול רק לרשתות-החלושות ────────────
// R86: הכפול ממומש סוף-סוף. TRON (429 תכוף) ו-Hive (נפילות-רגע) הן
// הרשתות החלשות שנמדדו בשטח — בלי ניסיון-כפול הן הפילו את האוצר
// ל-"down" גם כשהרגע-לפני הכול היה תקין (נמדד חי: 03:57Z). השופט
// נשאר השקף: מקור שלא ענה גם אחרי ניסיון-כפול — לא נספר, בכנות.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jget(url: string, ms = 12000, tries = 1): Promise<any> {
  let lastErr: unknown = null;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { signal: ac.signal, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(1200 + i * 800);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

async function jpost(url: string, body: unknown, ms = 12000, tries = 1): Promise<any> {
  let lastErr: unknown = null;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(1200 + i * 800);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

async function rpcCall(url: string, method: string, params: unknown[], tries = 1): Promise<any> {
  const j = await jpost(url, { jsonrpc: "2.0", id: 1, method, params }, 12000, tries);
  if (j?.error) throw new Error(String(j.error.message ?? "rpc-error"));
  return j.result;
}

// ── שרשראות ──────────────────────────────────────────────────────────

async function steemSide() {
  const [accts, props] = await Promise.all([
    rpcCall("https://api.steemit.com", "condenser_api.get_accounts", [[...STEEM_FLEET]], 3),
    rpcCall("https://api.steemit.com", "condenser_api.get_dynamic_global_properties", [], 3),
  ]);
  const fund = parseFloat(props.total_vesting_fund_steem);
  const shares = parseFloat(props.total_vesting_shares);
  const perVest = shares > 0 ? fund / shares : 0;
  const head = accts.find((a: any) => a.name === "headcorner");
  const toWithdraw = Number(head?.to_withdraw ?? 0) / 1e6;
  const rate = parseFloat(head?.vesting_withdraw_rate ?? "0");
  const paymentsLeft = rate > 0 ? Math.min(13, Math.ceil(toWithdraw / rate)) : 0;
  const next = head?.next_vesting_withdrawal ? new Date(head.next_vesting_withdrawal + "Z") : null;
  const rows = accts.map((a: any) => {
    const steem = parseFloat(a.balance);
    const sbd = parseFloat(a.sbd_balance);
    const vests = parseFloat(a.vesting_shares) - parseFloat(a.delegated_vesting_shares);
    const sp = vests * perVest;
    const received = parseFloat(a.received_vesting_shares) * perVest;
    return { name: a.name, steem, sbd, sp, receivedSp: received };
  });
  // R85 fix: הכסף הפרוס בסולם-המכירה (פקודות פתוחות) חדל להיות בלתי-נראה.
  // "דולר בנזיל = דולר אמיתי" — ודולר בפקודה חיה הוא דולר עובד: הוא נספר,
  // בדלי משלו, לעולם לא ב"נזיל" (ביטול אפשרי אבל הוא לא מזומן עכשיו).
  // r125a · כנות-חלקיות: ארנק שלא ענה לא נספר — אבל גם לא נעלם: החשבון
  // נרשם ב-openOrdersUnreadable כדי ש"אין פקודות" לא ייקרא "נמדד
  // אפס פקודות" (ה-deployed עלול להיות חסר — הסמן מגלה זאת).
  const openOrdersUnreadable: string[] = [];
  const orderLists = await Promise.all(
    rows.map(async (r) => {
      if (r.steem <= 0 && r.sbd <= 0) return [];
      try {
        const os = await rpcCall(
          "https://api.steemit.com",
          "condenser_api.get_open_orders",
          [r.name],
          3,
        );
        return (os ?? []).map((o: any) => {
          const forSale = Number(o.for_sale) / 1000;
          const base = String(o.sell_price?.base ?? "");
          const quote = String(o.sell_price?.quote ?? "");
          const asset = base.endsWith("STEEM") ? "STEEM" : base.endsWith("SBD") ? "SBD" : null;
          const quoteAsset = quote.endsWith("SBD") ? "SBD" : quote.endsWith("STEEM") ? "STEEM" : null;
          const quoteAmt = parseFloat(quote) || 0;
          return {
            account: r.name,
            orderid: o.orderid,
            asset,
            forSale,
            quoteAsset,
            quoteAmt,
            created: o.created ?? null,
          };
        });
      } catch {
        openOrdersUnreadable.push(r.name); // לא נספר — ומסומן בכנות
        return [];
      }
    }),
  );
  const openOrders = orderLists.flat();
  const deployedSteem = openOrders
    .filter((o) => o.asset === "STEEM")
    .reduce((s, o) => s + o.forSale, 0);
  const deployedSbd = openOrders
    .filter((o) => o.asset === "SBD")
    .reduce((s, o) => s + o.forSale, 0);
  const sbdTarget = openOrders
    .filter((o) => o.asset === "STEEM" && o.quoteAsset === "SBD")
    .reduce((s, o) => s + o.quoteAmt, 0);
  return {
    perVest,
    accounts: rows,
    deployed: {
      steem: deployedSteem,
      sbd: deployedSbd,
      sbdTarget,
      orders: openOrders.length,
      detail: openOrders,
      // r125a · סמן חלקיות: חשבונות שקריאת-הפקודות שלהם נפלה (נעדר רק כשהכל נקרא)
      ...(openOrdersUnreadable.length > 0 ? { openOrdersUnreadable } : {}),
    },
    powerdown: {
      active: paymentsLeft > 0 && next !== null && next.getTime() > Date.now(),
      weeklySteem: rate * perVest,
      nextPayment: next ? next.toISOString() : null,
      paymentsLeft,
      totalRemainingSteem: toWithdraw * perVest,
    },
  };
}

async function hiveSide() {
  // R86: ניסיון-כפול לרשת-החלשה — api.hive.blog נופל לרגעים קצרים.
  const [accts, props] = await Promise.all([
    rpcCall("https://api.hive.blog", "condenser_api.get_accounts", [[...STEEM_FLEET]], 3),
    rpcCall("https://api.hive.blog", "condenser_api.get_dynamic_global_properties", [], 3),
  ]);
  const fund = parseFloat(props.total_vesting_fund_hive);
  const shares = parseFloat(props.total_vesting_shares);
  const perVest = shares > 0 ? fund / shares : 0;
  const rows = accts.map((a: any) => ({
    name: a.name,
    hive: parseFloat(a.balance),
    hbd: parseFloat(a.hbd_balance ?? a.sbd_balance ?? 0),
    hp: (parseFloat(a.vesting_shares) - parseFloat(a.delegated_vesting_shares)) * perVest,
  }));
  return { accounts: rows };
}

async function tronSide() {
  // R86: TRON apilist מחזיר 429 בעיקר כשסורקים בזה אחר זה — ניסיון-כפול
  // עם הפסקה קצרה בין הכתובות עובר את הרגע. השופט נשאר השקף: שתי
  // הכתובות נבדקות מול אותו מקור, בלי מצב מקומי.
  const out: { label: string; address: string; trx: number; trc20: number }[] = [];
  for (const t of TRON_ADDRS) {
    if (out.length > 0) await sleep(400); // הפסקה קצרה בין הכתובות — עוברת את ה-429
    const j = await jget(
      `https://apilist.tronscanapi.com/api/account?address=${t.address}`,
      12000,
      3,
    );
    out.push({
      label: t.label,
      address: t.address,
      trx: Number(j.balance ?? 0) / 1e6,
      trc20: (j.trc20token_balances ?? []).length,
    });
  }
  return out;
}

async function evmSide() {
  const out: { label: string; address: string; eth: number; txsSent: number | null }[] = [];
  for (const e of EVM_ADDRS) {
    const [balHex, nonce] = await Promise.all([
      rpcCall(EVM_RPC, "eth_getBalance", [e.address, "latest"]),
      rpcCall(EVM_RPC, "eth_getTransactionCount", [e.address, "latest"]).catch(() => null),
    ]);
    out.push({
      label: e.label,
      address: e.address,
      eth: parseInt(balHex, 16) / 1e18,
      txsSent: nonce !== null ? parseInt(nonce, 16) : null,
    });
  }
  return out;
}

async function solSide() {
  const out: { label: string; address: string; sol: number }[] = [];
  for (const s of SOL_ADDRS) {
    let lamports: number | null = null;
    // ניסיון-כפול: publicnode לפעמים חונק בשקט מהסנדבוקס
    for (const ep of [SOL_RPC, "https://api.mainnet-beta.solana.com"]) {
      try {
        const r = await rpcCall(ep, "getBalance", [s.address]);
        lamports = r?.value ?? null;
        if (lamports !== null) break;
      } catch {
        /* נקודה הבאה */
      }
    }
    if (lamports === null) throw new Error("sol-rpc-unreachable");
    out.push({ label: s.label, address: s.address, sol: lamports / 1e9 });
  }
  return out;
}

async function btcSide() {
  const joined = BTC_ADDRS.map((b) => b.address).join("|");
  const j = await jget(`https://blockchain.info/balance?active=${joined}&cors=true`);
  return BTC_ADDRS.map((b) => ({
    label: b.label,
    address: b.address,
    btc: (j[b.address]?.final_balance ?? 0) / 1e8,
    txs: j[b.address]?.n_tx ?? 0,
  }));
}

async function pricesSide(): Promise<{
  p: Record<string, number | null>;
  sbdSource: string | null;
  sbdMarkedAt: string | null;
  hbdSource: string | null;
}> {
  const syms = ["STEEMUSDT", "HIVEUSDT", "TRXUSDT", "ETHUSDT", "SOLUSDT", "BTCUSDT"];
  const parts = await Promise.all(
    syms.map((s) =>
      jget(`https://api.binance.com/api/v3/ticker/price?symbol=${s}`, 8000)
        .then((j) => [s.replace("USDT", ""), Number(j.price)] as const)
        .catch(() => [s.replace("USDT", ""), null] as const),
    ),
  );
  const p: Record<string, number | null> = Object.fromEntries(parts);
  // SBD/HBD לא נסחרים בביננס — הסימון החי האחרון של הגריד שלנו, עם נפילה-כנה.
  // r124: הגיל נחשף — שער מגובה-קונסולה מוכפל במאזנים אמיתיים, וצרכן חייב
  // לדעת אם הוא בן-רגע או בן-שעות (חוק: גיל-מקור הוא חלק מהמדידה).
  let sbdSource: string | null = null;
  let sbdMarkedAt: string | null = null;
  let hbdSource: string | null = null;
  try {
    const g = await jget("https://roshpinacare-sys.github.io/Console/dex/grid.json", 8000);
    if (g?.marks?.sbdUsd) {
      p.SBD = Number(g.marks.sbdUsd);
      sbdMarkedAt = typeof g?.publishedAt === "string" ? g.publishedAt : null;
      sbdSource = `console:grid.json@${sbdMarkedAt ?? "?"}`;
    }
    // r125 — HBD אינו SBD: שני אגדים שונים. עד כאן הוצג במחיר SBD (פער-בסיס
    // ~44% נגד implied-from-book). כעת סימון-ה-HIVE החי של הגריד (נמדד מהספר);
    // בהיעדרו — null כנה, לא מחיר-אח שגוי.
    const hbd = g?.hive?.marks?.hbdUsd;
    if (typeof hbd === "number" && hbd > 0) {
      p.HBD = hbd;
      const hiveAt = typeof g?.hive?.publishedAt === "string" ? g.hive.publishedAt : sbdMarkedAt;
      hbdSource = `console:grid.json/hive.marks@${hiveAt ?? "?"}`;
    }
  } catch {
    /* בלי סימון — null */
  }
  return { p, sbdSource, sbdMarkedAt, hbdSource };
}

// ── מצב-הרשת מהקונסולה הציבורית (מלאי נאמנות גבוה) ───────────────────

async function networkSide() {
  const out: Record<string, unknown> = {};
  try {
    const w = await jget("https://roshpinacare-sys.github.io/Console/dex/world.json", 8000);
    out.height = w?.state?.height ?? null;
    // סולם-המנוע: 1 יחידת-נכס = 1000µ (kernel.ts:8) — treasuryProfit במילי-USDS
    // r124 · כנות: היעדר שדה (סחיבת-סכימה) אינו רווח-אפס נמדד — null.
    out.treasuryProfitUsds = w?.state?.treasuryProfit != null ? w.state.treasuryProfit / 1e3 : null;
    out.backingWsteem = w?.state?.backing?.WSTEEM != null ? w.state.backing.WSTEEM / 1e3 : null;
    out.publishedAt = w?.publishedAt ?? null;
    out.halted = w?.state?.halted ?? null;
  } catch {
    out.height = null;
  }
  try {
    const w = await jget("https://roshpinacare-sys.github.io/Console/dex/watch.json", 8000);
    out.depositsTotal = w?.depositsTotal ?? null;
    out.chains = w?.chains ?? null;
  } catch {
    out.depositsTotal = null;
  }
  try {
    const g = await jget("https://roshpinacare-sys.github.io/Console/dex/grid.json", 8000);
    out.gridVerdict = g?.verdict ?? null;
    out.gridArmed = g?.armed ?? null;
  } catch {
    out.gridVerdict = null;
  }
  // r141 · אמת-בית: נוכחות-מפתח בבית — בוליאני בלבד (אפס-סוד; D-021).
  // הפתיח של השער נקשר למדידה: כשהמפתח חי בבית, הסולם החי נחתם ומוצב
  // מכאן (קבלות-txid על השרשרת 15:41/16:27) — לא רק "בענן".
  try {
    const { ownerKeyPresent } = await import("@/lib/owner-key");
    out.house = { keyPresent: ownerKeyPresent() };
  } catch {
    out.house = null;
  }
  return out;
}

// ── מטמון SWR (stale-while-revalidate) ──────────────────────────────
//
// לקח-R53 (נמדד חי): שער-הכסף מרענן כל 60 שניות — בדיוק בגבול ה-TTL
// הישן, ולכן כמעט כל poll אכל 1.1–1.4 שניות של 8 מקורות-חיים.
// מעתה: תשובה מיידית תמיד אחרי הראשונה; רענון-רקע single-flight.

const SWR_KEY = "api:treasury";
const SWR_TTL_MS = 60_000;

export async function GET() {
  const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, composeTreasury);
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

async function composeTreasury() {
  const down: string[] = [];

  const [steem, hive, tron, evm, sol, btc, prices, network] = await Promise.all([
    steemSide().catch((e) => {
      down.push(`steem: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    hiveSide().catch((e) => {
      down.push(`hive: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    tronSide().catch((e) => {
      down.push(`tron: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    evmSide().catch((e) => {
      down.push(`evm: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    solSide().catch((e) => {
      down.push(`sol: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    btcSide().catch((e) => {
      down.push(`btc: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    pricesSide().catch((e) => {
      down.push(`prices: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    networkSide().catch(() => ({})),
  ]);

  const p = prices?.p ?? {};
  const sbdSource = prices?.sbdSource ?? null;
  const sbdMarkedAt = prices?.sbdMarkedAt ?? null;
  const hbdSource = prices?.hbdSource ?? null;
  const usd = (k: string): number | null => {
    const v = p[k];
    return typeof v === "number" && v > 0 ? v : null;
  };

  // סכומי-USD: רק מחירים חיים — בלי מחיר אין סכום (לא ממצאים)
  let steemLiquidUsd = 0;
  let steemVestingUsd = 0;
  const steemPrice = usd("STEEM");
  if (steem && steemPrice) {
    for (const a of steem.accounts) {
      steemLiquidUsd += a.steem * steemPrice + a.sbd * (usd("SBD") ?? 0);
      steemVestingUsd += a.sp * steemPrice;
    }
  }
  let hiveUsd = 0;
  let hiveVestingUsd = 0;
  if (hive && usd("HIVE")) {
    for (const a of hive.accounts) {
      // R84 fix: HP is VESTING, not liquid — counting it in liquid made any
      // HIVE price noise fake "money movement" (measured live: $11.38 → $2.09
      // with zero on-chain activity; SOL addresses have 0 signatures ever).
      hiveUsd += a.hive * (usd("HIVE") ?? 0) + a.hbd * (usd("HBD") ?? 0);
      hiveVestingUsd += a.hp * (usd("HIVE") ?? 0);
    }
  }
  const tronUsd = tron ? tron.reduce((s, t) => s + t.trx * (usd("TRX") ?? 0), 0) : 0;
  const evmUsd = evm ? evm.reduce((s, e) => s + e.eth * (usd("ETH") ?? 0), 0) : 0;
  const solUsd = sol ? sol.reduce((s, x) => s + x.sol * (usd("SOL") ?? 0), 0) : 0;
  const btcUsd = btc ? btc.reduce((s, x) => s + x.btc * (usd("BTC") ?? 0), 0) : 0;

  // R85: הכסף הפרוש בסולם — דלי-אמת משלו. שווי-שוק של הנכס הכלוא בפקודות
  // (ניתן לביטול, לכן שוויו = השוק החי שלו), וכן שווי-היציאה אם כל הסולם ימולא.
  let steemDeployedUsd = 0;
  let steemDeployedExitUsd = 0;
  if (steem?.deployed && steemPrice) {
    steemDeployedUsd =
      steem.deployed.steem * steemPrice + steem.deployed.sbd * (usd("SBD") ?? 0);
    steemDeployedExitUsd = steem.deployed.sbdTarget * (usd("SBD") ?? 0);
  }
  const deployedUsd = steemDeployedUsd;
  const liquidUsd = steemLiquidUsd + hiveUsd + tronUsd + evmUsd + solUsd + btcUsd;
  // R122 · חוק הסכום-הכנה: צד שנפל אינו "0$" — הוא חסר-מדידה. כשצד כלשהו
  // (או עמוד-המחירים כולו) לא נמדד, הסכום-הכולל הוא null — "—" בתצוגה,
  // לא אוצר מוקטן-סתם. ה-down[] מגלה איזה צד.
  // r125-b · סגירת החוק על השערים עצמם: שער-נכס שנפל הוא חסר-מדידה לא
  // פחות מצד שנפל — הנוסחה הקודמת דרשה רק צד/עמוד ואז סכמה את ההחזקות
  // במחיר 0$ (הוכח בחישוב-אימות: בלי סימון-STEEM יחיד ⇒ סך-הכולל
  // $1.00 במקום $337.73 — 99.7% מהאוצר נבלעו לאפס; בלי סימונים כולם ⇒
  // "$0 אוצר"). מעתה גם שער חסר מאפס את הסכום-הכולל — אין שער, אין סכום.
  const missingPrices = ["STEEM", "HIVE", "TRX", "ETH", "SOL", "BTC", "SBD"].filter((k) => usd(k) === null);
  const anySideDown =
    steem == null || hive == null || tron == null || evm == null || sol == null || btc == null || prices == null ||
    missingPrices.length > 0;
  const data = {
    ok: down.length === 0,
    fetchedAt: new Date().toISOString(),
    down: down.length ? down : undefined,
    usd: {
      total: anySideDown ? null : steemVestingUsd + hiveVestingUsd + liquidUsd + deployedUsd,
      liquid: liquidUsd,
      deployed: deployedUsd,
      deployedExit: steemDeployedExitUsd,
      vesting: steemVestingUsd + hiveVestingUsd,
      missingPrices,
    },
    steem: steem ?? undefined,
    hive: hive ?? undefined,
    tron: tron ?? undefined,
    evm: evm ?? undefined,
    sol: sol ?? undefined,
    btc: btc ?? undefined,
    prices: p,
    priceSources: {
      SBD: sbdSource,
      HBD: hbdSource, // r125 — HBD בסימונו-שלו (הפרדת אגדים), לא במחיר SBD
      sbdMarkedAt,
    },
    network,
  };
  return data;
}
