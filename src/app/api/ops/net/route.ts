import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

/**
 * /api/ops/net — SAOS-Net v1 (the smart network on the chain):
 *
 * GET  → { limits, registry, kv, missions, unstake } — every piece read from
 *        measured result files the agent writes (limits.json,
 *        net_registry_result.json, net_kv_result.json, net_state.json,
 *        he_unstake_result.json). Never 500 — missing pieces come back null.
 *
 * POST { cmd: "report"|"status"|"drill", args? }
 *      → appends a mission to agent/net_tasks_pending.json — the daemon's
 *        netTask loop picks it up, broadcasts saos_task on-chain, assigns a
 *        soldier (round-robin), sends the encrypted command, and the soldier
 *        posts the signed result on-chain. Route only writes a local queue
 *        file — no keys ever touch the web tier.
 */

const AGENT_DIR = path.join(process.cwd(), "agent");

const MISSION_CMDS = ["report", "status", "drill"] as const;

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await readFile(path.join(AGENT_DIR, file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function GET() {
  const [limits, registry, kv, netState, unstake, status, genesis, conforms, site] = await Promise.all([
    readJson<Record<string, unknown>>("limits.json"),
    readJson<Record<string, unknown>>("net_registry_result.json"),
    readJson<Record<string, unknown>>("net_kv_result.json"),
    readJson<{ tasks?: Record<string, Record<string, unknown>>; pay?: Record<string, unknown> }>("net_state.json"),
    readJson<Record<string, unknown>>("he_unstake_result.json"),
    readJson<Record<string, unknown>>("agent-status.json"),
    readJson<Record<string, unknown>>("he_genesis_result.json"),
    readJson<Record<string, unknown>>("he_conforms_result.json"),
    readJson<Record<string, unknown>>("net_site_cache.json"),
  ]);
  const tasks = netState?.tasks ?? {};
  return NextResponse.json({
    ok: true,
    limits,
    registry,
    kv,
    missions: {
      total: Object.keys(tasks).length,
      open: Object.values(tasks).filter((t) => t.status === "open").length,
      done: Object.values(tasks).filter((t) => t.status === "done").length,
      pay: netState?.pay ?? null,
      tasks: Object.entries(tasks)
        .slice(-12)
        .map(([id, t]) => ({ id, ...t })),
    },
    unstake,
    genesis,
    conforms,
    site: site
      ? { verified: site.verified, sha256: site.sha256, size: site.size, parts: site.parts, headBlock: site.headBlock, at: site.at, txids: site.txids }
      : null,
    army: (status?.army as { size?: number } | undefined) ?? null,
  });
}

export async function POST(req: NextRequest) {
  let body: { cmd?: string; args?: Record<string, unknown> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף בקשה לא תקין" }, { status: 400 });
  }
  const cmd = String(body.cmd ?? "").toLowerCase();
  if (!MISSION_CMDS.includes(cmd as (typeof MISSION_CMDS)[number])) {
    return NextResponse.json(
      { ok: false, error: `cmd חייב להיות אחד מ: ${MISSION_CMDS.join(", ")}` },
      { status: 400 },
    );
  }

  const pendingPath = path.join(AGENT_DIR, "net_tasks_pending.json");
  let pending: { tasks: { id: string; cmd: string; args?: unknown; ts: string }[] } = { tasks: [] };
  try {
    const raw = await readFile(pendingPath, "utf8");
    const j = JSON.parse(raw) as typeof pending;
    if (j && Array.isArray(j.tasks)) pending = j;
  } catch {
    /* fresh queue */
  }
  if (pending.tasks.length >= 20) {
    return NextResponse.json({ ok: false, error: "תור המשימות מלא (20) — הדמון ירוקן בדקות הקרובות" }, { status: 429 });
  }
  const id = `t_${randomUUID().slice(0, 8)}`;
  pending.tasks.push({ id, cmd, args: body.args && typeof body.args === "object" ? body.args : undefined, ts: new Date().toISOString() });
  try {
    await writeFile(pendingPath, JSON.stringify(pending, null, 2) + "\n");
  } catch {
    return NextResponse.json({ ok: false, error: "לא ניתן לכתוב לתור המשימות" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id, cmd, queued: pending.tasks.length });
}
