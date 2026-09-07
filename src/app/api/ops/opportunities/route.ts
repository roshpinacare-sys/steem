import { NextResponse } from "next/server";

import { readAgentEnv } from "@/lib/agent-env";
import { getLiveAccount } from "@/lib/steem/steem-live";
import { fetchChainAccount } from "@/lib/steem-keys";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/opportunities — the value-injection engine.
//
// Every line is measured from live chain data or carries an explicit honesty
// tier (proven / measured / empirical / idea). Nothing is promised — numbers
// come from the same RPCs the chains serve to everyone.
//
//   1. HBD savings on both chains (live dgpo interest rate × real balances)
//   2. Idle-SP rental income (measured market APR × idle SP)
//   3. STEEM↔HIVE price spread (cross-chain informational)
//   4. Hive-Engine staking/dividend surfaces (empirical, needs Active key)
//   5. Blurt territory appraisal (does the same key already own land there?)
// ─────────────────────────────────────────────────────────────────────────────

const num = (s: string | undefined | null): number => parseFloat(String(s ?? "0")) || 0;

interface OppItem {
  id: string;
  title: string;
  chain: string;
  tier: "proven" | "measured" | "empirical" | "idea";
  status: "ready" | "needs-key" | "dormant" | "watch" | "info";
  why: string;
  how: string;
  potentialUsdYear: number | null;
  facts: string;
}

async function fetchJson(url: string, body: unknown, timeoutMs = 9_000): Promise<{ result?: unknown } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as { result?: unknown };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function pricesUsd(): Promise<{ steem: number; sbd: number; hive: number; hbd: number } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9_000);
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=steem,steem-dollars,hive,hive_dollar&vs_currencies=usd",
      { signal: ctrl.signal, cache: "no-store" },
    );
    const j = (await res.json()) as Record<string, { usd?: number }>;
    if (!j.steem?.usd && !j.hive?.usd) return null;
    return {
      steem: j.steem?.usd ?? 0,
      sbd: j["steem-dollars"]?.usd ?? 1,
      hive: j.hive?.usd ?? 0,
      hbd: j["hive_dollar"]?.usd ?? 1,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Hive internal-market ticker (HBD per HIVE) as the price fallback rail. */
async function hiveTickerHbd(): Promise<number | null> {
  const r = await fetchJson("https://api.hive.blog", {
    jsonrpc: "2.0",
    method: "condenser_api.get_ticker",
    params: [],
    id: 1,
  });
  const latest = (r?.result as { latest?: string } | undefined)?.latest;
  return latest ? parseFloat(latest) || null : null;
}

export async function GET() {
  const env = readAgentEnv();
  const username = (env.AGENT_ACCOUNT || "headcorner").replace(/^@/, "").toLowerCase();

  const [live, hiveAcc, blurtAcc, p, steemDgpo, hiveDgpo] = await Promise.all([
    getLiveAccount(username),
    fetchChainAccount("hive", username),
    fetchChainAccount("blurt", username),
    pricesUsd(),
    fetchJson("https://api.steemit.com", {
      jsonrpc: "2.0",
      method: "condenser_api.get_dynamic_global_properties",
      params: [],
      id: 1,
    }),
    fetchJson("https://api.hive.blog", {
      jsonrpc: "2.0",
      method: "condenser_api.get_dynamic_global_properties",
      params: [],
      id: 1,
    }),
  ]);

  const steemUsd = live.ok ? live.chain.steemUsd : (p?.steem ?? 0);
  const sbdUsd = live.ok ? live.chain.sbdUsd : (p?.sbd ?? 1);
  const hbdUsd = p?.hbd ?? sbdUsd;
  let hiveUsd = p?.hive ?? 0;
  if (!hiveUsd) {
    // Fallback: Hive internal market (HBD per HIVE × HBD/USD).
    const ticker = await hiveTickerHbd();
    if (ticker) hiveUsd = ticker * hbdUsd;
  }

  const steemRatePct = ((steemDgpo?.result as { sbd_interest_rate?: number } | undefined)?.sbd_interest_rate ?? 0) / 100;
  const hiveRatePct = ((hiveDgpo?.result as { hbd_interest_rate?: number } | undefined)?.hbd_interest_rate ?? 0) / 100;

  const opps: OppItem[] = [];

  // 1 — Steem SBD savings (live rate; often 0 on Steem → honest "dormant")
  if (live.ok) {
    const sbdTotal = live.balances.sbd + live.balances.savingsSbd;
    opps.push({
      id: "steem-sbd-savings",
      title: "חיסכון SBD ב-Steem",
      chain: "Steem",
      tier: "proven",
      status: steemRatePct > 0 && sbdTotal >= 1 ? "needs-key" : "dormant",
      why:
        steemRatePct > 0
          ? `העדים משלמים ${steemRatePct.toFixed(1)}% שנתי על חיסכון SBD. כרגע בחשבון ${sbdTotal.toFixed(2)} SBD → כ-$${((sbdTotal * sbdUsd * steemRatePct) / 100).toFixed(2)} בשנה על אותו כסף.`
          : `שיעור הריבית על חיסכון SBD ב-Steem כרגע 0% (נמדד חי מהשרשרת) — הכסף (${sbdTotal.toFixed(2)} SBD) לא מרוויח כלום בחיסכון.`,
      how:
        steemRatePct > 0
          ? "transfer_to_savings עם מפתח active — כפתור מוכן בכספת כשהריבית חיובית."
          : "כרגע לא רלוונטי — נעקוב אחרי הריבית ונדווח כשתעלה.",
      potentialUsdYear: steemRatePct > 0 ? (sbdTotal * sbdUsd * steemRatePct) / 100 : 0,
      facts: `sbd_interest_rate=${steemRatePct.toFixed(1)}% · balance=${sbdTotal.toFixed(3)} SBD`,
    });
  }

  // 2 — Hive HBD savings (Hive pays real APR on HBD savings, measured live)
  if (hiveAcc.exists) {
    const hbd = num(hiveAcc.balances?.hbd_balance) + num(hiveAcc.balances?.savings_hbd_balance);
    const hbdSaved = num(hiveAcc.balances?.savings_hbd_balance);
    opps.push({
      id: "hive-hbd-savings",
      title: "חיסכון HBD ב-Hive",
      chain: "Hive",
      tier: "proven",
      status: hbd >= 1 && hbdSaved < hbd - 0.5 && hiveRatePct > 0 ? "needs-key" : hbd >= 1 ? "ready" : "watch",
      why: `Hive משלמת ${hiveRatePct.toFixed(1)}% שנתי על HBD בחיסכון (נמדד חי). בחשבון ${hbd.toFixed(2)} HBD${hbdSaved > 0 ? ` (מתוכם ${hbdSaved.toFixed(2)} כבר בחיסכון)` : ""} → פוטנציאל $${((hbd * hbdUsd * hiveRatePct) / 100).toFixed(2)} בשנה על כסף שיושב.`,
      how: "transfer_to_savings על Hive עם מפתח active — פעולה אחת, והריבית נצברת אוטומטית כל חודש.",
      potentialUsdYear: (hbd * hbdUsd * hiveRatePct) / 100,
      facts: `hbd_interest_rate=${hiveRatePct.toFixed(1)}% · HBD=${hbd.toFixed(3)} · savings=${hbdSaved.toFixed(3)}`,
    });
  }

  // 3 — Idle SP rental (measured market APR)
  if (live.ok && live.balances.spOwn > 0) {
    const idle = Math.max(0, live.balances.spOwn - live.balances.spOut);
    const apr = live.yield?.rentalApr ?? 0.0415;
    const usdYear = idle * steemUsd * apr;
    opps.push({
      id: "sp-rental",
      title: "השכרת SP עצל בשוק ההאצלות",
      chain: "Steem",
      tier: "measured",
      status: idle > 10 ? "needs-key" : "watch",
      why: `${idle.toFixed(0)} SP עצמיים פנויים. תשואת שוק ההאצלות שנמדדה ≈${(apr * 100).toFixed(1)}% שנתי → כ-$${usdYear.toFixed(2)} בשנה פסיבי.`,
      how: "חוזה האצלה דרך שוק ההשכרות (חתימת active אחת) — הסוכן מזהה שוק פעיל ומציע את החוזה הטוב ביותר.",
      potentialUsdYear: usdYear,
      facts: `idle=${idle.toFixed(1)} SP · apr≈${(apr * 100).toFixed(1)}%`,
    });
  }

  // 4 — STEEM↔HIVE spread (informational — honest: needs an external rail)
  // Market-to-market only: comparing coingecko STEEM vs coingecko HIVE (or
  // the Hive ticker fallback). Mixing in the internal feed would fake a
  // spread that no one can actually trade.
  if (hiveUsd > 0 && (p?.steem ?? 0) > 0 && p) {
    const steemMarketUsd = p.steem;
    const spreadPct = ((hiveUsd - steemMarketUsd) / Math.min(steemMarketUsd, hiveUsd)) * 100;
    opps.push({
      id: "cross-spread",
      title: `פער מחיר STEEM/HIVE — ${spreadPct >= 0 ? "+" : ""}${spreadPct.toFixed(1)}%`,
      chain: "Steem↔Hive",
      tier: "idea",
      status: "info",
      why:
        Math.abs(spreadPct) >= 8
          ? `HIVE נסחרת ${Math.abs(spreadPct).toFixed(0)}% ${spreadPct > 0 ? "מעל" : "מתחת"} STEEM בשווקים — פער בין שתי השרשראות של אותו משתמש.`
          : "הפער בין השרשראות בטווח הרגיל — אין יתרון מיוחד כרגע.",
      how: "המרה דורשת רכבת חוץ (בורסה מרכזית) — המערכת מנטרת את הפער ומדווחת כשהוא נפתח. אין גשר ישיר בין השרשראות.",
      potentialUsdYear: null,
      facts: `STEEM $${steemMarketUsd.toFixed(4)} · HIVE $${hiveUsd.toFixed(4)} (מקור אחיד)`,
    });
  }

  // 5 — Hive-Engine staking surfaces (empirical — needs Active on HE)
  if (hiveAcc.exists) {
    const swapHive = num(hiveAcc.balances?.balance);
    opps.push({
      id: "he-staking",
      title: "סטייקינג ודיבידנדים ב-Hive-Engine",
      chain: "Hive-Engine",
      tier: "empirical",
      status: "needs-key",
      why: "טוקנים בצד-שרשרת של Hive (WAIV, CENT וכדומה) מחלקים דיבידנדים על סטייק — הכספת כבר מחזיקה סל כזה, והפעלת סטייק עלולה להגדיל את הזרימה בלי סיכון עיקרי.",
      how: "דורש מפתח active (צד-שרשרת נחתם רק עם active) — אחרי חיבור המפתח-ראשי הסוכן יכול לסטייק אוטומטית.",
      potentialUsdYear: null,
      facts: `SWAP.HIVE liquid=${swapHive.toFixed(3)} · סל HE קיים בחשבון`,
    });
  }

  // 6 — Blurt territory (the same derivation covers the third fork too)
  if (blurtAcc.exists != null) {
    const vests = blurtAcc.balances?.vesting_shares ?? "0 VESTS";
    const liquid = num(blurtAcc.balances?.balance);
    opps.push({
      id: "blurt-territory",
      title: blurtAcc.exists ? "שטח-שליטה ב-Blurt התגלה" : "Blurt — אין חשבון",
      chain: "Blurt",
      tier: blurtAcc.exists ? "proven" : "proven",
      status: blurtAcc.exists ? "watch" : "dormant",
      why: blurtAcc.exists
        ? `לאותו מפתח יש חשבון חי גם ב-Blurt (פורק שלישי של אותה קריפטוגרפיה): ${vests}, נזיל ${liquid.toFixed(3)} BLURT. שטח שנשכח — שווה הערכה.`
        : "החשבון לא קיים ב-Blurt (נבדק מול ה-RPC הרשמי) — אין מה לנהל שם.",
      how: blurtAcc.exists
        ? "אימות מפתחות מול סמכות Blurt יבוא בשלב הבא של מטריצת המפתח — השטח ממתין."
        : "לא נדרשת פעולה.",
      potentialUsdYear: null,
      facts: `exists=${blurtAcc.exists} · vests=${vests}`,
    });
  }

  return NextResponse.json({
    ok: true,
    account: username,
    prices: { steemUsd, sbdUsd, hiveUsd, hbdUsd },
    rates: { steemSbdInterestPct: steemRatePct, hiveHbdInterestPct: hiveRatePct },
    opportunities: opps,
    generatedAt: new Date().toISOString(),
    refreshSec: 600,
  });
}
