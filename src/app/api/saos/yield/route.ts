import { NextResponse } from "next/server";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { deDashDeep } from "@/lib/clean-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * R288 · YIELD + FINANCE DIGEST RAIL (thin reader — mirrors revenue law):
 * zero keys, zero writes, zero domain re-implementation. GET reads the
 * engine's own measured state (yield-distribution.json + finance-digest.json)
 * plus the audit tail. POST proxies the engine's /finance-digest rebuild
 * (digest → intake → compileRevenue → BROADCAST-READY) — the engine stays
 * the single judge; this proxy adds no secrets and owns no logic.
 */

const STATE = path.join(process.cwd(), "mini-services", "saos-engine", "state");
const ENGINE_HTTP = "http://127.0.0.1:3040";
const STALE_MIN = 90; /* digest loop is 30min; yield plan loop 10min; silence is never health */

type Row = Record<string, unknown>;

function readJson(name: string): Row | null {
  try {
    return JSON.parse(readFileSync(path.join(STATE, name), "utf8")) as Row;
  } catch {
    return null;
  }
}

function ageMin(name: string): number | null {
  try {
    return (Date.now() - statSync(path.join(STATE, name)).mtimeMs) / 60_000;
  } catch {
    return null;
  }
}

function tailJsonl(name: string, n: number): Row[] {
  try {
    return readFileSync(path.join(STATE, "..", "receipts", name), "utf8")
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

const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const r3 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

function block(name: string, staleMin = STALE_MIN) {
  const data = readJson(name);
  const age = ageMin(name);
  if (!data) return null;
  return { data, ageMin: r1(age), state: age === null || age > staleMin ? "STALE" : "LIVE" };
}

export async function GET() {
  const digest = block("finance-digest.json");
  const rail = block("yield-distribution.json");

  const d = (digest?.data ?? null) as Row | null;
  const y = (rail?.data ?? null) as Row | null;
  const transfers = (Array.isArray(y?.transfers) ? y.transfers : []) as Row[];
  const executed = (Array.isArray(y?.executed) ? y.executed : []) as Row[];

  const body = {
    ok: true,
    asof: new Date().toISOString(),
    digest: d
      ? {
          state: digest?.state ?? "STALE",
          ageMin: digest?.ageMin ?? null,
          verdict: typeof d.verdict === "string" ? d.verdict : null,
          slot: typeof d.slot === "number" ? d.slot : null,
          maxPerDay: typeof d.maxPerDay === "number" ? d.maxPerDay : null,
          digestId: typeof d.digestId === "string" ? d.digestId : null,
          title: typeof d.title === "string" ? d.title : null,
          words: typeof d.words === "number" ? d.words : null,
          bytes: typeof d.bytes === "number" ? d.bytes : null,
          chain: typeof d.chain === "string" ? d.chain : null,
          compileVerdict: typeof d.compileVerdict === "string" ? d.compileVerdict : null,
          law: typeof d.law === "string" ? d.law : null,
        }
      : null,
    rail: y
      ? {
          state: rail?.state ?? "STALE",
          ageMin: rail?.ageMin ?? null,
          verdict: typeof y.verdict === "string" ? y.verdict : null,
          treasury: typeof y.treasury === "string" ? y.treasury : null,
          custody: typeof y.custody === "string" ? y.custody : null,
          reasons: Array.isArray(y.reasons) ? y.reasons.map(String) : null,
          liquidMeasured: {
            steem: r3((y.liquidMeasured as Row | undefined)?.steem),
            sbd: r3((y.liquidMeasured as Row | undefined)?.sbd),
          },
          pool: { steem: r3((y.pool as Row | undefined)?.steem), sbd: r3((y.pool as Row | undefined)?.sbd) },
          perShare: r3(y.perShare),
          perShareSbd: r3(y.perShareSbd),
          plannedTotal: r3(y.plannedTotal),
          reserveSteem: r3(y.reserveSteem),
          reserveSbd: r3(y.reserveSbd),
          rosterSize: typeof y.rosterSize === "number" ? y.rosterSize : null,
          deferred: typeof y.deferred === "number" ? y.deferred : null,
          invariantOk: y.invariantOk === true,
          executedToday: typeof y.executedToday === "number" ? y.executedToday : null,
          transfers: transfers.map((t) => ({
            to: String(t.to ?? "?"),
            amount: r3(t.amount),
            asset: String(t.asset ?? "?"),
          })),
          executed: executed.map((t) => ({
            to: String(t.to ?? "?"),
            amount: r3(t.amount),
            asset: String(t.asset ?? "?"),
            verdict: typeof t.verdict === "string" ? t.verdict : null,
            ok: t.ok === true,
            txid: typeof t.txid === "string" ? t.txid : null,
          })),
          policy: (y.policy ?? null) as Row | null,
          law: typeof y.law === "string" ? y.law : null,
        }
      : null,
    audit: tailJsonl("yield-distribution.jsonl", 6).reverse(),
    law: "pool = liquid above the operating floor; custody gate first; dust rolls back; execution only through the engine's executeAs with the think gate — this cockpit route owns no keys and no logic",
  };

  return NextResponse.json(deDashDeep(body));
}

export async function POST() {
  try {
    const r = await fetch(`${ENGINE_HTTP}/finance-digest`, { method: "POST", signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    return NextResponse.json(j, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, engine: "down", hint: "engine digest rebuild failed or engine not running", error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 },
    );
  }
}
