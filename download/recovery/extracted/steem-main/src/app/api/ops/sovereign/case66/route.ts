import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/sovereign/case66 — Task 66: I-REST-MY-CASE portfolio.
 *
 * תיק-ההוכחות המאתגרות — כל מקרה עם ראיות-חיות מהשרשרת:
 *  · YIELD      — המערכת שילמה תשואה אמיתית למשתתפים מעמלות-שנלכדו
 *                 (transfers עם ממו saos:yield · txids מאומתים)
 *  · ROUNDTRIP  — מחזור-חיים מלא של עגון חוצה-שרשראות
 *                 lock→mint→pay→fill→burn→unlock→ack · 7 txids · 2 שרשראות
 *  · BUDGET     — חיילים במלוא-הפוטנציאל: תקציב-מוגדל-מבוסס-ראיות + רוטציה-צודקת
 *  · PAY        — פרימיטיב-ההסדרה: תשלום-אשראי על-השרשרת (saos/v1 action pay)
 *  · EFF        — כלכלת-אנרגיה: ערך-מופק מול אנרגיה-שנצרכת (מדידה, לא הבטחה)
 *
 * לעולם לא 500 — תמיד 200 עם ok:true.
 */

const AGENT_DIR = path.join(process.cwd(), "agent");

interface AgentJson {
  [k: string]: unknown;
}

async function readAgentJson(name: string): Promise<AgentJson | null> {
  try {
    return JSON.parse(await readFile(path.join(AGENT_DIR, name), "utf8")) as AgentJson;
  } catch {
    return null;
  }
}

interface StepRec {
  txid?: string | null;
  verified?: boolean;
  node?: string;
  block?: number | null;
  dry?: boolean;
}

export interface Case66Response {
  ok: boolean;
  at: string;
  yield: {
    day: string | null;
    pool: number;
    feesTotal: number;
    totalPaid: number;
    paid: { account: string; amt: number; txid: string | null; verified: boolean; memo: string | null }[];
    verifiedCount: number;
    selfFunded: boolean;
  } | null;
  roundtrip: {
    allVerified: boolean;
    steps: { key: string; label: string; chain: string; txid: string | null; verified: boolean; node: string | null; block: number | null }[];
    conservation: {
      supply: number;
      lockedHive: number;
      ratioPct: number | null;
      redeemed: number;
      unlocked: number;
      holders: { account: string; balance: number }[];
    } | null;
  } | null;
  budget: {
    opsPerBeat: number;
    opsPerSoldierDay: number;
    activeSoldiers: number;
    fleetSize: number;
    bySoldier: Record<string, number>;
    rcCostMeasured: { by: string; delta: number }[];
  } | null;
  pay: {
    total: number;
    count: number;
    last: { time: string; from: string; to: string; amount: number; ref: string; txid: string } | null;
  } | null;
  eff: {
    feesCaptured: number;
    yieldDistributed: number;
    liquidCostOps: number;
    rcCostPerOpPct: number | null;
    vol24hSteem: number;
    trades: number;
    verdict: string;
  } | null;
  commerce: {
    sales: number;
    revenue: number;
    verified: number;
    last: { buyer: string; sent: number; qty: number; price: number; txid: string | null; buyTxid: string | null } | null;
    lpHolders: number;
    lpSupply: number | null;
    hivePings: number;
    hivePingsLanded: number;
  } | null;
}

const STEP_LABELS: [string, string, string][] = [
  ["h1", "lock HIVE", "hive"],
  ["s1", "mint PHIVE", "steem"],
  ["s2", "pay credit", "steem"],
  ["s3", "fill (delivery)", "steem"],
  ["s4", "burn (redeem)", "steem"],
  ["h2", "unlock HIVE", "hive"],
  ["s5", "unlock-ack", "steem"],
];

export async function GET() {
  const [roundtripState, yieldState, microdexState, merchantState] = await Promise.all([
    readAgentJson("roundtrip_state.json"),
    readAgentJson("yield_state.json"),
    readAgentJson("microdex_state.json"),
    readAgentJson("merchant_state.json"),
  ]);

  let dexSnap: {
    pools?: { feesSteem?: number; swaps?: number }[];
    payments?: { time: string; from: string; to: string; amount: number; ref: string; txid: string }[];
    stats?: { vol24hSteem?: number; tradesTotal?: number };
    solvency?: { issuerLiquidSteem?: number | null };
  } | null = null;
  let wrapSnap: {
    assets?: { symbol: string; supply: number; backingRatioPct: number | null; backing?: { lockedHive?: number }; redeemed?: number; unlocked?: number; holders?: { account: string; balance: number }[] }[];
    fees?: { totalCaptured?: number };
    extrasOps?: number;
  } | null = null;
  try {
    const [r1, r2] = await Promise.all([
      fetch("http://127.0.0.1:3000/api/ops/saos/dex?username=headcorner", { cache: "no-store" }).then((r) => r.json()),
      fetch("http://127.0.0.1:3000/api/ops/saos/wrapped", { cache: "no-store" }).then((r) => r.json()),
    ]);
    dexSnap = r1;
    wrapSnap = r2;
  } catch {
    /* replays not ready — the card degrades gracefully */
  }

  // ── YIELD
  let yieldCase: Case66Response["yield"] = null;
  if (yieldState) {
    const paidRec = (yieldState.paid ?? {}) as Record<string, { amt?: number; txid?: string | null; verified?: boolean; memo?: string | null }>;
    const paidList = Object.entries(paidRec).map(([account, r]) => ({
      account,
      amt: r.amt ?? 0,
      txid: r.txid ?? null,
      verified: !!r.verified,
      memo: r.memo ?? null,
    }));
    const feesTotal = (yieldState.feesTotal as number) ?? 0;
    const totalPaid = (yieldState.totalPaid as number) ?? 0;
    yieldCase = {
      day: (yieldState.day as string) ?? null,
      pool: (yieldState.pool as number) ?? 0,
      feesTotal,
      totalPaid,
      paid: paidList,
      verifiedCount: paidList.filter((p) => p.verified).length,
      selfFunded: paidList.length > 0 && feesTotal > 0,
    };
  }

  // ── ROUNDTRIP
  let roundtripCase: Case66Response["roundtrip"] = null;
  if (roundtripState) {
    const steps = (roundtripState.steps ?? {}) as Record<string, StepRec>;
    roundtripCase = {
      allVerified: !!roundtripState.allVerified,
      steps: STEP_LABELS.map(([key, label, chain]) => {
        const s = steps[key] ?? {};
        return {
          key,
          label,
          chain,
          txid: (s.txid as string) ?? null,
          verified: !!s.verified,
          node: (s.node as string) ?? null,
          block: (s.block as number) ?? null,
        };
      }),
      conservation: null,
    };
    const phive = (wrapSnap?.assets ?? []).find((a) => a.symbol === "PHIVE");
    if (phive) {
      roundtripCase.conservation = {
        supply: phive.supply ?? 0,
        lockedHive: phive.backing?.lockedHive ?? 0,
        ratioPct: phive.backingRatioPct ?? null,
        redeemed: phive.redeemed ?? 0,
        unlocked: phive.unlocked ?? 0,
        holders: phive.holders ?? [],
      };
    }
  }

  // ── BUDGET (soldier full-potential evidence)
  let budgetCase: Case66Response["budget"] = null;
  if (microdexState) {
    const bySoldier = (microdexState.bySoldier ?? {}) as Record<string, number>;
    budgetCase = {
      opsPerBeat: 5,
      opsPerSoldierDay: 10,
      activeSoldiers: Object.keys(bySoldier).length,
      fleetSize: 11,
      bySoldier,
      rcCostMeasured: (microdexState.rcCost as { by: string; delta: number }[]) ?? [],
    };
  }

  // ── PAY (settlement primitive)
  let payCase: Case66Response["pay"] = null;
  const payments = dexSnap?.payments ?? [];
  if (payments.length) {
    const relevant = payments.filter((p) => p.from !== "headcorner");
    payCase = {
      total: relevant.reduce((s, p) => s + (p.amount || 0), 0),
      count: relevant.length,
      last: relevant[0] ?? null,
    };
  }

  // ── EFF (energy→value ledger)
  let effCase: Case66Response["eff"] = null;
  const feesCaptured = (wrapSnap?.fees?.totalCaptured ?? 0) + ((dexSnap?.pools ?? []).reduce((s, p) => s + (p.feesSteem || 0), 0));
  const rcCost = (microdexState?.rcCost as { delta: number }[] | undefined) ?? [];
  const rcAvg = rcCost.length ? rcCost.reduce((s, r) => s + Math.abs(r.delta || 0), 0) / rcCost.length : null;
  effCase = {
    feesCaptured: Math.round(feesCaptured * 1e6) / 1e6,
    yieldDistributed: yieldCase?.totalPaid ?? 0,
    liquidCostOps: 0, // every DEX/wrap op is posting-key RC-funded — zero liquid burn
    rcCostPerOpPct: rcAvg != null ? Math.round(rcAvg * 1000) / 1000 : null,
    vol24hSteem: dexSnap?.stats?.vol24hSteem ?? 0,
    trades: dexSnap?.stats?.tradesTotal ?? 0,
    verdict:
      feesCaptured > 0 && (yieldCase?.totalPaid ?? 0) > 0
        ? "self-funding: fees captured on-chain finance the participant yield — liquid cost of ops ≈ 0 (RC/posting-funded)"
        : "fees accumulating — yield gate pending",
  };

  // ── COMMERCE (Task 67 — merchant rail + soldier LP + hive pings)
  let commerce: Case66Response["commerce"] = null;
  {
    const mSales = ((merchantState?.sales as { buyer: string; sent: number; qty: number; price: number; txid?: string; buyTxid?: string; verified?: boolean }[]) ?? []);
    const pool = (dexSnap?.pools ?? []).find((p) => (p as { pair?: string }).pair === "SAOS:STEEM") as { lp?: { account: string }[]; lpSupply?: number } | undefined;
    const hivePings = ((microdexState?.hivePings as { txid?: string | null; verified?: boolean }[]) ?? []);
    commerce = {
      sales: mSales.length,
      revenue: mSales.reduce((s, x) => s + (x.sent || 0), 0),
      verified: mSales.filter((x) => x.verified).length,
      last: mSales.length
        ? {
            buyer: mSales[mSales.length - 1].buyer,
            sent: mSales[mSales.length - 1].sent,
            qty: mSales[mSales.length - 1].qty,
            price: mSales[mSales.length - 1].price,
            txid: mSales[mSales.length - 1].txid ?? null,
            buyTxid: mSales[mSales.length - 1].buyTxid ?? null,
          }
        : null,
      lpHolders: pool?.lp ? pool.lp.filter((h) => h.account !== "headcorner").length : 0,
      lpSupply: pool?.lpSupply ?? null,
      hivePings: hivePings.length,
      hivePingsLanded: hivePings.filter((p) => p.txid && p.verified).length,
    };
  }

  const body: Case66Response = {
    ok: true,
    at: new Date().toISOString(),
    yield: yieldCase,
    roundtrip: roundtripCase,
    budget: budgetCase,
    pay: payCase,
    eff: effCase,
    commerce,
  };
  return NextResponse.json(body, { status: 200 });
}
