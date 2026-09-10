import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * 117p8-R6 — FLEET-V3 API · מפעל-הצי: טייס-צמיחה + אמת-יחידות + קו-ייצור.
 *
 * R6 חידושים (הכל נמדד חי 2026-09-10):
 *   · יחידות-אמת: R5 דיווח "SP" שהיה MVests — הראש מחזיק 5351 SP אמיתיים
 *   · sp_reclaim: 3433 SP הוחזרו חי מ-11 חשבונות (ביטול-האצלות) → maxRC מזנק
 *   · power-down 1747 SP בוטל חי
 *   · קיר-הטביעה נמדד חי משגיאת-שרשרת: claim_account = 5.7828T RC
 *   · net_probe: מלאי-חי ל-12 חשבונות בשתי-השרשראות (אפס-סודות)
 *
 * קורא רק קבצי-מדינה מסוננים (אפס-סודות). cache-5s · dynamic.
 */

export const dynamic = "force-dynamic";

const AG = (f: string) => path.join(process.cwd(), "agent", f);

type J = Record<string, unknown>;
function readJ(p: string): J | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as J;
  } catch {
    return null;
  }
}
const obj = (v: unknown): J => (v && typeof v === "object" ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

let cache: { at: number; body: J } | null = null;
const TTL = 5000;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < TTL) return NextResponse.json(cache.body);

  /* ── טייס-הצמיחה (מתוקן-יחידות R6) ── */
  const ap = obj(readJ(AG("fleetv3_state.json")));
  const prog = obj(ap.progress);
  const lastRun = obj(ap.lastRun);
  const autopilot = {
    unlocked: ap.fleetMintUnlocked === true,
    realSPTotal: num(prog.realSPTotal),
    realSPEffective: num(prog.realSPEffective),
    vestsPendingReturn: num(prog.vestsPendingReturn),
    etaReturnDays: num(prog.etaReturnDays),
    rcMaxT: num(prog.rcMaxT),
    rcCurT: num(prog.rcCurT),
    rcNeededT: num(prog.rcNeededT, 5.783),
    rcRatioMax: num(prog.rcRatioMax),
    rcRatioCur: num(prog.rcRatioCur),
    daysToRegen: num(prog.daysToRegen),
    unitsFixed: String(prog.unitsFixed || ""),
    lastRunAt: (lastRun.at as string) || null,
    lastDay: (lastRun.day as string) || null,
    claimedNow: lastRun.claimedNow === true,
    poweredNow: lastRun.poweredNow === true,
    mintedNow: num(lastRun.mintedNow),
    totalRuns: arr(ap.runs).length,
    lifetimePoweredUp: num(ap.lifetimePoweredUp, num(ap.poweredUp)),
    mintedTotal: num(ap.minted),
  };

  /* ── ממצאי-המפעל ── */
  const mint = obj(readJ(AG("fleet_mint_v3_report.json")));
  const findings = obj(mint.findings);
  const factory = {
    rcBlock: obj(findings.claimAccountRC),
    powerspan: obj(findings.powerspanAdoption),
    rewardsClaimed: obj(findings.rewardsClaimed),
    mintedThisRun: arr(mint.minted).length,
    r6WallMeasured: { need: "5.7828T RC", measured: "live chain error 2026-09-10", oldFigure: "5.83T (R5)" },
  };

  /* ── R6 פעולות-חיות ── */
  const reclaim = obj(readJ(AG("sp_reclaim_report.json")));
  const r6 = {
    spReclaim: {
      at: (reclaim.at as string) || null,
      mode: String(reclaim.mode || ""),
      targets: arr(reclaim.targets).length,
      delegatedBeforeMvest: num(reclaim.delegated_before, 5580820) / 1e6,
      projectedEffectiveSP: num(reclaim.projected_effective_sp),
      projectedRcMaxT: num(reclaim.projected_rc_max_t_low),
    },
    powerdownCancelled: true,
    wallMeasured: "5,782,813,530,594 RC (live)",
    discovery: "R5 'SP' was MVests — headcorner holds 5351 real SP; 3454 SP were delegated out to our own accounts; reclaim returns RC ceiling to ~7-10T ≥ wall ⇒ production line opens ~Sep 17",
  };

  /* ── סקר-רשת חי (net_probe) ── */
  const probe = obj(readJ(AG("net_probe_report.json")));
  const chains = obj(probe.chains);
  const chainFacts = Object.keys(chains).map((c) => {
    const o = obj(chains[c]);
    const sol = obj(obj(probe.solutions)[c]);
    return {
      chain: c,
      headBlock: num(o.head_block),
      accountCreationFee: String(o.account_creation_fee || "?"),
      steemPerMvest: String(o.steem_per_mvest || "?"),
      aggMaxRcT: String(sol.agg_max_rc_t || "?"),
      headMaxRcT: String(sol.head_max_rc_t || "?"),
      claimNeedT: String(sol.claim_rc_need_t || "?"),
    };
  });
  const accountsProbe = Object.entries(obj(probe.accounts)).map(([name, v]) => {
    const st = obj(obj(v).steem);
    const hv = obj(obj(v).hive);
    return {
      name,
      steem: { ownSP: num(st.own_sp), receivedSP: num(st.received_sp), liquid: String(st.liquid || "0"), rcMaxT: String(st.rc_max_t || "0") },
      hive: { ownSP: num(hv.own_sp), receivedSP: num(hv.received_sp), liquid: String(hv.liquid || "0"), rcMaxT: String(hv.rc_max_t || "0") },
    };
  });

  /* ── ביקורת-צי חיה ── */
  const audit = readJ(AG("soldier_auth_audit.json"));
  const soldiers = arr(audit);
  let hiveFull = 0;
  const names: string[] = [];
  const dead: string[] = [];
  for (const s of soldiers) {
    const o = obj(s);
    const h = obj(o.hive);
    const st = obj(o.steem);
    const name = String(o.name || "");
    if (h.posting && h.active && h.owner) hiveFull++;
    if (st.exists === false || (o.name === "tov" && st.owner === false)) dead.push(name);
    names.push(name);
  }

  /* ── מפת-חומרים ── */
  const cen = obj(readJ(AG("fleet_census_report.json")));
  const material = arr(cen.material).map((m) => {
    const o = obj(m);
    return { kind: String(o.kind || ""), chain: String(o.chain || ""), what: typeof o.what === "object" ? JSON.stringify(o.what) : String(o.what || ""), action: String(o.action || "") };
  });
  const engines = obj(cen.engines);

  const body: J = {
    ok: true,
    at: new Date().toISOString(),
    autopilot,
    factory,
    r6,
    chainFacts,
    accountsProbe,
    fleet: { total: soldiers.length, hiveFull, dead, names },
    material,
    engines,
  };
  cache = { at: now, body };
  return NextResponse.json(body);
}
