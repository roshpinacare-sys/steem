import { NextResponse } from "next/server";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { deDashDeep } from "@/lib/clean-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * R287 · REVENUE RAIL (thin reader — mirrors custody-alert law): zero keys,
 * zero writes, zero domain re-implementation. Reads the engine's own staging
 * state (state/revenue-staging.json — the BROADCAST-READY buffer produced by
 * content-compiler.mjs) plus the tail of the audit trail, and renders it.
 * The engine stays the single judge and the single compiler; a stale state
 * file is reported as stale, never re-derived here.
 */

const STATE = path.join(process.cwd(), "mini-services", "saos-engine", "state");
const STALE_MIN = 90; /* compiler cadence is 10min; silence is never health */

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
    return readFileSync(path.join(STATE, name), "utf8")
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

export async function GET() {
  const revenue = readJson("revenue-staging.json");
  const age = ageMin("revenue-staging.json");

  const raw = (Array.isArray(revenue?.packages) ? revenue.packages : []) as Row[];
  const packages = raw.slice(-14).reverse().map((p) => ({
    id: typeof p.id === "string" ? p.id : null,
    title: typeof p.title === "string" ? p.title : null,
    chain: typeof p.chain === "string" ? p.chain : null,
    state: typeof p.state === "string" ? p.state : null,
    bytes: typeof p.bytes === "number" ? p.bytes : null,
    words: typeof p.words === "number" ? p.words : null,
    scrubbed: typeof p.scrubbed === "number" ? p.scrubbed : null,
    frozen: p.frozen === true,
    eligibleAt: typeof p.cadence === "object" && p.cadence !== null ? String((p.cadence as Row).eligibleAt ?? "") : null,
    compiledAt: typeof p.compiledAt === "string" ? p.compiledAt : null,
  }));

  const stats = (revenue?.stats ?? null) as Row | null;

  const body = {
    ok: true,
    asof: new Date().toISOString(),
    state: age === null || age > STALE_MIN ? "STALE" : "LIVE",
    ageMin: r1(age),
    verdict: typeof revenue?.verdict === "string" ? revenue.verdict : null,
    custodyGate: typeof revenue?.custodyGate === "string" ? revenue.custodyGate : null,
    cadenceLaw: (revenue?.cadence ?? null) as Row | null,
    stats: stats
      ? {
          staged: Number(stats.staged ?? 0),
          rejected: Number(stats.rejected ?? 0),
          dupDropped: Number(stats.dupDropped ?? 0),
          scrubHits: Number(stats.scrubHits ?? 0),
          bufferMax: Number(stats.bufferMax ?? 0),
        }
      : null,
    headCid: typeof revenue?.headCid === "string" ? revenue.headCid : null,
    packages,
    audit: tailJsonl("revenue-staging.jsonl", 8).reverse(),
    law: typeof revenue?.law === "string" ? revenue.law : "the staging rail never broadcasts — the custody-gated social rails remain the only broadcasters",
  };

  return NextResponse.json(deDashDeep(body));
}
