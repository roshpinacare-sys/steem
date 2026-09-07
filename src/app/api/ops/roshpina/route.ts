import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * 116 — THE-BRIDGE · גשר-רושפינה אל-השרשרת-הריבונית.
 *
 * מנדט-115: ״הגשר: saos:anchor/v1 audit-head payloads → pending-anchors.jsonl —
 * השרשרת-הריבונית סורקת-ומעגנת-פומבית״. Task 116 חיבר-את-הקצה-השני:
 * roshpina-bridge.cjs (watch · guardian-healed) לוקט, מאמת fail-closed,
 * מעגן על STEEM (custom_json אפס-עמלה) ומזריק attest על-הספר.
 *
 * אפס-סודות — רק headHash-ים, txid-ים וסטטוסים.
 */
const ROOT = process.cwd();
const NODE = path.join(ROOT, "sovereign", "node");
const STATE = path.join(NODE, "roshpina-bridge-state.json");
const LOG = path.join(NODE, "roshpina-bridge.log");
const QUEUE = "/home/z/roshpina/.bridge/pending-anchors.jsonl";

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch (_) {
    return null;
  }
}

export async function GET() {
  const st = readJson<{
    consumed?: Record<string, { tenantId: string; height: number; at: string; hostTxid: string; onBook: string; consumedAt: string }>;
    quarantined?: number;
    lastScan?: string | null;
    lastHostTxid?: string | null;
  }>(STATE);

  // daemon-freshness from the log (same doctrine as deposits: tick-freshness)
  let daemonAlive = false;
  let lastLog = "";
  try {
    const raw = fs.readFileSync(LOG, "utf8").trim();
    lastLog = raw.slice(raw.lastIndexOf("["));
    const m = lastLog.match(/^\[(.+?)\]/);
    if (m) daemonAlive = Date.now() - Date.parse(m[1]) < 11 * 60 * 1000; // tick 300s + margin
  } catch (_) {}

  let queueLines = 0;
  try {
    queueLines = fs.readFileSync(QUEUE, "utf8").split("\n").filter((l) => l.trim()).length;
  } catch (_) {}

  const entries = Object.entries(st?.consumed ?? {});
  const consumed = entries.map(([headHash, c]) => ({
    headHash,
    tenantId: c.tenantId,
    height: c.height,
    hostTxid: c.hostTxid,
    onBook: c.onBook,
    at: c.at,
    consumedAt: c.consumedAt,
  }));
  consumed.sort((a, b) => (a.consumedAt < b.consumedAt ? 1 : -1));

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    bridge: {
      queueLines,
      consumedTotal: consumed.length,
      quarantined: st?.quarantined ?? 0,
      lastScan: st?.lastScan ?? null,
      daemonAlive,
      lastLog: lastLog.slice(0, 200),
    },
    anchors: consumed.slice(0, 12),
  });
}
