import { NextResponse } from "next/server";
import { readAgentEnv, readAgentStatus } from "@/lib/agent-env";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/saos/dex-mm — sovereign DEX market-maker state bridge (read-only,
// no secrets). One cheap call that fuses:
//   - the vault/autonomy flags (agent/.env: POSTING_WIF set? DRY_RUN? MM on?)
//   - the daemon's live DEX loop state (agent/agent-status.json → loops.dexMm
//     + STATUS.dex metrics the daemon measures every beat)
// The console DEX card renders its "ריבונות" strip from this.
// Resilience contract: never throws, always 200 with ok:true.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export async function GET() {
  const env = readAgentEnv();
  const status = readAgentStatus();

  const daemonDex =
    status && typeof status === "object" && !Array.isArray(status)
      ? ((status as Record<string, unknown>).dex as Record<string, unknown> | undefined) ?? null
      : null;
  const daemonLoop =
    status && typeof status === "object" && !Array.isArray(status)
      ? (((status as Record<string, unknown>).loops as Record<string, unknown> | undefined)?.dexMm as
          | Record<string, unknown>
          | undefined) ?? null
      : null;

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    armed: {
      keyConfigured: Boolean(env.POSTING_WIF),
      realMode: env.DRY_RUN === "false",
      mmEnabled: env.DEX_MM_ENABLED === "true",
      account: env.AGENT_ACCOUNT ?? null,
    },
    daemon: {
      updatedAt:
        status && typeof status === "object" && !Array.isArray(status)
          ? ((status as Record<string, unknown>).updatedAt as string | undefined) ?? null
          : null,
      loop: daemonLoop,
      dex: daemonDex,
    },
  });
}
