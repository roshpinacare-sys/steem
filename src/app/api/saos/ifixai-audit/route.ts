import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/* [agent-zai/G8] iFixAi independent-audit read — public, zero secrets, read-only.
 * Source of truth: FleetHQ office-pages ifixai-audit.json (published by the weekly
 * office-ifixai-audit workflow: mock pipeline proof + NVIDIA-NIM brain smoke audit
 * against the sovereignty doctrine). Honest degradation: nothing published yet → 404
 * with an explicit reason (no-data ≠ no-failure). 5-min micro-cache + single-flight
 * + inflight cleared on settle (G4 law — a cache must never become a forever-tomb). */

type AuditBox = { at: number; value: Record<string, unknown> | null; inflight?: Promise<Record<string, unknown> | null> };

const g = globalThis as unknown as { __ifixaiAuditBox?: AuditBox };
const AUDIT_URL = "https://raw.githubusercontent.com/roshpinacare-sys/FleetHQ/office-pages/ifixai-audit.json";
const TTL_MS = 300_000;

async function readAudit(): Promise<Record<string, unknown> | null> {
  const box = (g.__ifixaiAuditBox ??= { at: 0, value: null });
  const now = Date.now();
  if (box.value && now - box.at < TTL_MS) return box.value;
  if (box.inflight) return box.inflight;
  box.inflight = (async () => {
    try {
      const r = await fetch(AUDIT_URL, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
      if (!r.ok) throw new Error(`http ${r.status}`);
      const j = (await r.json()) as Record<string, unknown>;
      box.value = j;
      box.at = Date.now();
      return j;
    } catch {
      box.value = null;
      box.at = Date.now();
      return null;
    }
  })();
  const p = box.inflight;
  try {
    return await p;
  } finally {
    if (box.inflight === p) box.inflight = undefined;
  }
}

export async function GET() {
  const audit = await readAudit();
  return NextResponse.json(
    audit
      ? { ok: true, audit, measuredAt: new Date().toISOString() }
      : { ok: false, error: "no-audit-published-yet", measuredAt: new Date().toISOString() },
    { status: audit ? 200 : 404 }
  );
}
