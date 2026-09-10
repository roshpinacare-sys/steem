import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * 117p8-R5 — FLEET-V3 API · מפעל-הצי-השלישי: מפת-חומרים + טייס-צמיחת-SP.
 *
 * קורא רק קבצי-מדינה מסוננים (אפס-סודות — הדוחות ממילא מסוכמים/ממוסכמים):
 *   agent/fleet_census_report.json  (מפת-החומרים של-כל-התיקיות-והשרשראות)
 *   agent/fleetv3_state.json        (טייס-הצמיחה: SP · RC · פער-אל-פתיחה)
 *   agent/fleet_mint_v3_report.json (ממצאי-המפעל: RC-block · powerspan · rewards)
 *   agent/soldier_auth_audit.json   (ביקורת-הצי החיה)
 *
 * cache-5s · dynamic.
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

  /* ── טייס-הצמיחה ── */
  const ap = obj(readJ(AG("fleetv3_state.json")));
  const prog = obj(ap.progress);
  const lastRun = obj(ap.lastRun);
  const autopilot = {
    unlocked: ap.fleetMintUnlocked === true,
    spNow: num(prog.spNow),
    spAtUnlock: num(prog.spAtUnlock, 14.8),
    gapSP: num(prog.gapSP),
    rcNowT: num(prog.rcNowT),
    rcNeededT: num(prog.rcNeededT, 5.83),
    rcRatio: num(prog.rcRatio),
    lastRunAt: (lastRun.at as string) || null,
    lastDay: (lastRun.day as string) || null,
    claimedNow: lastRun.claimedNow === true,
    poweredNow: lastRun.poweredNow === true,
    totalRuns: arr(ap.runs).length,
    lifetimePoweredUp: num(ap.poweredUp),
  };

  /* ── ממצאי-המפעל ── */
  const mint = obj(readJ(AG("fleet_mint_v3_report.json")));
  const findings = obj(mint.findings);
  const factory = {
    rcBlock: obj(findings.claimAccountRC),
    powerspan: obj(findings.powerspanAdoption),
    rewardsClaimed: obj(findings.rewardsClaimed),
    mintedThisRun: arr(mint.minted).length,
  };

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
  const folders = obj(cen.folders);
  const folderRows = Object.keys(folders)
    .map((k) => ({ dir: k, files: num(obj(folders[k]).files), kb: num(obj(folders[k]).kb) }))
    .sort((a, b) => b.kb - a.kb)
    .slice(0, 8);
  const engines = obj(cen.engines);

  const body: J = {
    ok: true,
    at: new Date().toISOString(),
    autopilot,
    factory,
    fleet: { total: soldiers.length, hiveFull, dead, names },
    material,
    folders: folderRows,
    engines,
  };
  cache = { at: now, body };
  return NextResponse.json(body);
}
