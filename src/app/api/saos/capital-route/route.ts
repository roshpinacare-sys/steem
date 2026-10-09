import { NextResponse } from "next/server";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { deDashDeep } from "@/lib/clean-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * R292 · CAPITAL ROUTER RAIL (thin reader — mirrors revenue law):
 * zero keys, zero writes, zero domain re-implementation. Reads the router's
 * computed matrix (state/capital-router.json — every number derived from the
 * chain-sourced deep probe download/yield-deep-R292.mjs) + the executor ack
 * ledger (state/capital-router-exec.json) + receipts tail. The engine stays
 * the single judge; this proxy adds no secrets and owns no logic.
 */

const STATE = path.join(process.cwd(), "mini-services", "saos-engine", "state");
const RECEIPTS = path.join(process.cwd(), "mini-services", "saos-engine", "receipts");
const STALE_MIN = 720; /* the deep probe is a batch instrument; silence is not health */

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
  const routerFile = path.join(STATE, "capital-router.json");
  const execFile = path.join(STATE, "capital-router-exec.json");
  const probeFile = path.join(STATE, "yield-deep-R292.json");
  const router = readJson(routerFile);
  const exec = readJson(execFile);
  const routerAge = ageMin(routerFile);
  const probeAge = ageMin(probeFile);

  const ladder = (Array.isArray(router?.ladder?.stages) ? router.ladder.stages : []) as Row[];
  const actions = (Array.isArray(router?.actions) ? router.actions : []) as Row[];
  const capital = (router?.capital ?? null) as Row | null;

  const body = {
    ok: true,
    asof: new Date().toISOString(),
    router: router
      ? {
          state: routerAge === null || routerAge > STALE_MIN ? "STALE" : "LIVE",
          ageMin: routerAge === null ? null : Math.round(routerAge * 10) / 10,
          verdict: typeof router.verdict === "string" ? router.verdict : null,
          at: typeof router.at === "string" ? router.at : null,
        }
      : null,
    probe: { state: probeAge === null || probeAge > STALE_MIN * 2 ? "STALE" : "LIVE", ageMin: probeAge === null ? null : Math.round(probeAge * 10) / 10 },
    capital: capital
      ? {
          headcornerEffectiveSp: r3(capital.headcornerEffectiveSp),
          armyEffectiveSp: r3(capital.armyEffectiveSp),
          fleetEffectiveSp: r3(capital.fleetEffectiveSp),
          delegatedOutSp: r3(capital.delegatedOutSp),
          liquidSteem: r3(capital.liquidSteem),
          liquidSbd: r3(capital.liquidSbd),
          unclaimedSp: r3(capital.unclaimedSp),
          unclaimedSbd: r3(capital.unclaimedSbd),
          unclaimedSteem: r3(capital.unclaimedSteem),
        }
      : null,
    ladder: ladder.map((s) => ({
      id: typeof s.id === "string" ? s.id : null,
      label: typeof s.label === "string" ? s.label : null,
      spPerDay: r3(s.spPerDay),
      usdPerDay: r3(s.usdPerDay),
      multiplierVsToday: r3(s.multiplierVsToday),
      note: typeof s.note === "string" ? s.note.slice(0, 160) : null,
    })),
    compoundAprPct: r3(router?.ladder?.compoundAprPct),
    armyDailySp: r3(router?.ladder?.armyDailySp),
    actions: actions.map((a) => ({
      id: typeof a.id === "string" ? a.id : null,
      class: typeof a.class === "string" ? a.class : null,
      note: typeof a.note === "string" ? a.note.slice(0, 200) : null,
      expectedSpPerDay: r3(a.expectedSpPerDay),
      executed: exec && typeof exec === "object" && (exec.executed as Row | undefined)?.[String(a.id)] ? "ACKED" : null,
    })),
    receipts: tailJsonl(path.join(RECEIPTS, "capital-router.jsonl"), 6).reverse(),
    law: "slots×SP is the yield law; regen bounds the burn; landing is detected not assumed; recall actions are zero-amount pure recalls (structurally unable to create exposure); dead lanes stay honest",
  };

  return NextResponse.json(deDashDeep(body));
}
