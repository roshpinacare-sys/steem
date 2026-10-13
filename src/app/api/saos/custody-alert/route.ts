import { NextResponse } from "next/server";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { deDashDeep } from "@/lib/clean-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * R286 · custody-alert: the RED ALERT ENGINE's data rail.
 * Law (mirrors fleet-evidence): zero keys, zero writes, zero engine-domain
 * re-implementation — this route only READS the engine's own measured state
 * files (army/hive custody verdicts, selftest-last-run, writer-custody,
 * custodian-alerts) and judges one honest question:
 * is the custody matrix fully alive (14/14 + every vector green) or not?
 * RED = any failing vector. The engine itself stays the single judge; if its
 * state goes stale, that silence IS a failing vector (quiet-rot law, T-15).
 */

const STATE = path.join(process.cwd(), "mini-services", "saos-engine", "state");

/* a custody measurement older than this is treated as dead silence, not health */
const CUSTODY_MAX_AGE_MIN = 45;
const ENGINE_MAX_AGE_MIN = 10;

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
  const army = readJson("army-custody.json");
  const hive = readJson("hive-custody.json");
  const selftest = readJson("selftest-last-run.json");
  const writer = readJson("writer-custody.json");

  const armyAge = ageMin("army-custody.json");
  const engineAge = ageMin("events.jsonl");
  const writerAge = ageMin("writer-custody.json");

  const armyAfter = (army?.after ?? {}) as Row;
  const verified = Number(armyAfter.verified ?? 0);
  const total = Number(armyAfter.total ?? 14);

  const failing: { id: string; label: string; detail: string }[] = [];

  if (!army || army.verdict !== "FLEET-CUSTODY-ALIVE" || verified < total || total < 1) {
    failing.push({
      id: "army-custody",
      label: "מטריצת-החזקת-הצי",
      detail: army ? `${verified}/${total} · ${String(army.verdict ?? "?")}` : "state חסר",
    });
  }
  if (armyAge === null || armyAge > CUSTODY_MAX_AGE_MIN) {
    failing.push({
      id: "army-freshness",
      label: "טריות-מדידת-ההחזקה",
      detail: armyAge === null ? "קובץ-ה-state חסר" : `המדידה האחרונה לפני ${Math.round(armyAge)} דק`,
    });
  }
  if (!hive || hive.verdict !== "HIVE-CUSTODY-ALIVE") {
    failing.push({
      id: "hive-custody",
      label: "החזקת-ה-Hive",
      detail: hive ? String(hive.verdict ?? "?") : "state חסר",
    });
  }
  if (!selftest || Number(selftest.fail ?? 1) > 0 || Number(selftest.pass ?? 0) < 1) {
    failing.push({
      id: "selftest",
      label: "שער-ה-selftest",
      detail: selftest ? `${selftest.pass}/${Number(selftest.pass ?? 0) + Number(selftest.fail ?? 0)}` : "state חסר",
    });
  }
  if (!writer || writer.git?.ok !== true || writer.signing?.ok !== true) {
    failing.push({
      id: "writer-identity",
      label: "זהות-הכותב (חתימה+PAT)",
      detail: writer ? `${String(writer.git?.verdict ?? "?")} / ${String(writer.signing?.verdict ?? "?")}` : "state חסר",
    });
  }
  if (engineAge === null || engineAge > ENGINE_MAX_AGE_MIN) {
    failing.push({
      id: "engine-pulse",
      label: "דופק-המנוע",
      detail: engineAge === null ? "יומן-האירועים חסר" : `האירוע האחרון לפני ${Math.round(engineAge)} דק`,
    });
  }

  const alerts = tailJsonl("custodian-alerts.jsonl", 6)
    .map((j) => ({
      at: typeof j.at === "string" ? j.at : null,
      kind: typeof j.kind === "string" ? j.kind : "unknown",
      detail: String(j.detail ?? "").slice(0, 180),
    }))
    .reverse();

  const body = {
    ok: true,
    asof: new Date().toISOString(),
    status: failing.length ? ("RED" as const) : ("GREEN" as const),
    custody: { verified, total, verdict: (army?.verdict as string) ?? null },
    selftest: selftest ? { pass: Number(selftest.pass ?? 0), fail: Number(selftest.fail ?? 0), vectors: Number(selftest.vectors ?? 0) } : null,
    writer: writer
      ? {
          verdict: String(writer.verdict ?? ""),
          git: String(writer.git?.verdict ?? ""),
          signing: String(writer.signing?.verdict ?? ""),
          tokenExpiresAt: typeof writer.git?.tokenExpiresAt === "string" ? writer.git.tokenExpiresAt : null,
        }
      : null,
    agesMin: { army: r1(armyAge), engine: r1(engineAge), writer: r1(writerAge) },
    failing,
    alerts,
    law: "thin reader over engine state, zero keys, zero writes; RED below 14/14 or any dead vector; silence is never health",
  };

  return NextResponse.json(deDashDeep(body));
}
