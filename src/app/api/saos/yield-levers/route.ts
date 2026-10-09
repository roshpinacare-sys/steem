import { NextResponse } from "next/server";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { deDashDeep } from "@/lib/clean-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * R290 · YIELD LEVERS RAIL (thin reader — mirrors revenue law):
 * zero keys, zero writes, zero domain re-implementation. Reads the
 * yieldmax probe's measured state (state/yield-levers.json — every number
 * chain-sourced by download/yieldmax-probe-R290.mjs) + the army-curation
 * rail's live verdicts (state/army-curation.json + receipts tail).
 * The probe and the engine stay the single judges; this proxy adds no
 * secrets and owns no logic.
 */

const STATE = path.join(process.cwd(), "mini-services", "saos-engine", "state");
const RECEIPTS = path.join(process.cwd(), "mini-services", "saos-engine", "receipts");
const STALE_MIN = 180; /* probe runs on demand + with cycles; silence is never health but the probe is batch */

type Row = Record<string, unknown>;

function readJson(abs: string): Row | null {
  try {
    return JSON.parse(readFileSync(abs, "utf8")) as Row;
  } catch {
    return null;
  }
}

function ageMin(abs: string): number | null {
  try {
    return (Date.now() - statSync(abs).mtimeMs) / 60_000;
  } catch {
    return null;
  }
}

function tailJsonl(abs: string, n: number): Row[] {
  try {
    return readFileSync(abs, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-n)
      .map((l) => {
        try {
          return JSON.parse(l) as Row;
        } catch {
          return null;
        }
      })
      .filter((x): x is Row => x !== null);
  } catch {
    return [];
  }
}

const r3 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

export async function GET() {
  const probeFile = path.join(STATE, "yield-levers.json");
  const armyFile = path.join(STATE, "army-curation.json");
  const probe = readJson(probeFile);
  const army = readJson(armyFile);
  const probeAge = ageMin(probeFile);
  const armyAge = ageMin(armyFile);

  const steem = (probe?.steem ?? null) as Row | null;
  const hc = (steem?.headcorner ?? null) as Row | null;
  const armyTotals = (steem?.armyTotals ?? null) as Row | null;
  const feed = (steem?.feed ?? null) as Row | null;
  const hive = (probe?.hive ?? null) as Row | null;
  const blurt = (probe?.blurt ?? null) as Row | null;
  const levers = (Array.isArray(probe?.levers) ? probe.levers : []) as Row[];
  const accounts = (Array.isArray(army?.accounts) ? army.accounts : []) as Row[];

  const body = {
    ok: true,
    asof: new Date().toISOString(),
    probe: probe
      ? {
          state: probeAge === null || probeAge > STALE_MIN ? "STALE" : "LIVE",
          ageMin: probeAge === null ? null : Math.round(probeAge * 10) / 10,
          at: typeof probe.at === "string" ? probe.at : null,
        }
      : null,
    headcorner: hc
      ? {
          effectiveSp: r3(hc.effectiveSp),
          ownSp: r3(hc.ownSp),
          delegatedOutSp: r3(hc.delegatedOutSp),
          recallsBackSinceR289: r3(hc.delegatedOutDeltaVsR289),
          vpEffPct: r3(hc.vpEffPct),
          liquidSteem: r3(hc.liquidSteem),
          liquidSbd: r3(hc.liquidSbd),
          curation: (hc.curation7d ?? null) as Row | null,
          aprPct: r3(hc.aprPct),
          claimsWindowSp: r3(hc.claims7dSp),
          measuredWindowDays: r3(hc.measuredWindowDays),
          historyOps: (hc.historyScan as Row | undefined)?.opsRead ?? null,
        }
      : null,
    army: {
      totals: armyTotals ? { effectiveSp: r3(armyTotals.effectiveSp), vpAvgPct: r3(armyTotals.vpIdlePct) } : null,
      rail: army
        ? {
            state: armyAge === null ? "NEVER-RUN" : armyAge > STALE_MIN ? "STALE" : "LIVE",
            ageMin: armyAge === null ? null : Math.round(armyAge * 10) / 10,
            day: typeof army.day === "string" ? army.day : null,
            verdict: typeof army.verdict === "string" ? army.verdict : null,
            totalVotes: typeof army.totalVotes === "number" ? army.totalVotes : null,
            accounts: accounts.map((a) => ({
              account: String(a.account ?? "?"),
              verdict: typeof a.verdict === "string" ? a.verdict : null,
              votes: typeof a.votes === "number" ? a.votes : null,
              vpEff: r3(a.vpEff),
            })),
          }
        : null,
    },
    feed: feed ? { steemUsd: r3(feed.steemUsd), sbdPremiumPct: r3(steem?.sbdPremiumPct), arbNote: typeof steem?.arbNote === "string" ? steem.arbNote : null } : null,
    otherChains: {
      hive: hive ? { ok: hive.ok === true, totals: (hive.totals ?? null) as Row | null } : null,
      blurt: blurt ? { ok: blurt.ok === true, totals: (blurt.totals ?? null) as Row | null } : null,
    },
    levers: levers.map((l) => ({
      id: typeof l.id === "string" ? l.id : null,
      state: typeof l.state === "string" ? l.state : null,
      measuredSpPerDay: r3(l.measuredSpPerDay),
      measuredUsdPerDay: r3(l.measuredUsdPerDay),
      projectedSpPerDay: r3(l.projectedSpPerDay),
      projectedUsdPerDay: r3(l.projectedUsdPerDay),
      aprPct: r3(l.aprPct),
      note: typeof l.note === "string" ? l.note : null,
    })),
    receipts: tailJsonl(path.join(RECEIPTS, "army-curation.jsonl"), 8).reverse(),
    law: "every number is chain-sourced by the yieldmax probe; the army rail votes EXTERNAL content only (17-account exclusion); VP budget < 20%/day regen; this route owns no keys and no logic",
  };

  return NextResponse.json(deDashDeep(body));
}
