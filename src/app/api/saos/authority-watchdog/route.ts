import { NextResponse } from "next/server";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { deDashDeep } from "@/lib/clean-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * R287 · LIVE AUTHORITY WATCHDOG (thin reader — mirrors custody-alert law):
 * zero keys, zero writes, zero domain re-implementation. Reads the engine's
 * own measured state (authority-watchdog.json + node-health.json) and:
 *   1. renders the GPG signature metrics across the fleet lineage
 *   2. ECHOES the newest signature flags into THIS process's stdout — which
 *      IS dev.log under the sandbox dev server — on every poll. That is the
 *      "flag any unsigned line additions to dev.log instantly" command path:
 *      the engine flags instantly into its own log + state; the cockpit
 *      echoes the flags to dev.log within one 20s poll.
 * Dedup guard: each flag is echoed at most once per server process.
 */

const STATE = path.join(process.cwd(), "mini-services", "saos-engine", "state");
const STALE_MIN = 90; /* watchdog cadence is 15min; silence is never health */

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

const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/* per-process echo dedup (a fresh server re-echoes once — honest and bounded) */
const echoed = new Set<string>();

export async function GET() {
  const watchdog = readJson("authority-watchdog.json");
  const nodeHealth = readJson("node-health.json");
  const wAge = ageMin("authority-watchdog.json");
  const nAge = ageMin("node-health.json");

  const flagged = (Array.isArray(watchdog?.flagged) ? watchdog.flagged : []) as Row[];

  /* dev.log echo: every not-yet-echoed flag, tagged, with an HTTP stamp */
  for (const f of flagged) {
    const id = `${String(f.repo ?? "?")}:${String(f.hash ?? "?")}`;
    if (echoed.has(id)) continue;
    echoed.add(id);
    console.log(
      `[AUTH-WATCHDOG][DEVLOG] ${String(f.sig ?? "?")} commit ${String(f.hash ?? "?")} on ${String(f.repo ?? "?")} by ${String(f.author ?? "?")} (${String(f.subject ?? "").slice(0, 60)})`,
    );
  }

  const repos = (Array.isArray(watchdog?.repos) ? watchdog.repos : []) as Row[];
  const endpoints = (Array.isArray(nodeHealth?.endpoints) ? nodeHealth.endpoints : []) as Row[];

  const body = {
    ok: true,
    asof: new Date().toISOString(),
    state: wAge === null || wAge > STALE_MIN ? "STALE" : "LIVE",
    ageMin: r1(wAge),
    verdict: typeof watchdog?.verdict === "string" ? watchdog.verdict : null,
    coverage: (watchdog?.coverage ?? null) as Row | null,
    repos: repos.map((r) => ({
      repo: String(r.repo ?? "?"),
      coverage: String(r.coverage ?? "?"),
      method: typeof r.method === "string" ? r.method : null,
      scanned: typeof r.scanned === "number" ? r.scanned : null,
      signedPct: typeof r.signedPct === "number" ? r.signedPct : null,
      unsigned: typeof r.unsigned === "number" ? r.unsigned : null,
      invalid: typeof r.invalid === "number" ? r.invalid : null,
    })),
    flagged: flagged.slice(0, 12).map((f) => ({
      repo: String(f.repo ?? "?"),
      hash: String(f.hash ?? "?"),
      sig: String(f.sig ?? "?"),
      author: String(f.author ?? "?"),
      subject: String(f.subject ?? "").slice(0, 70),
    })),
    nodeHealth: nodeHealth
      ? {
          state: nAge === null || nAge > STALE_MIN ? "STALE" : "LIVE",
          ageMin: r1(nAge),
          verdict: String(nodeHealth.verdict ?? "?"),
          alive: Number(nodeHealth.alive ?? 0),
          quarantined: Number(nodeHealth.quarantined ?? 0),
          endpoints: endpoints.map((e) => ({
            chain: String(e.chain ?? "?"),
            endpoint: String(e.endpoint ?? "?"),
            ok: e.ok === true,
            ms: typeof e.ms === "number" ? e.ms : null,
            verdict: String(e.verdict ?? "?"),
            reason: typeof e.reason === "string" ? e.reason : null,
          })),
        }
      : null,
    law: "git-native %G? verification against the fleet keyring; every non-G commit is a named flag echoed to dev.log; node-health receipts roll in receipts/node-health.jsonl with a 30min circuit breaker",
  };

  return NextResponse.json(deDashDeep(body));
}
