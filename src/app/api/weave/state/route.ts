// GET /api/weave/state — מצב הרשת: seed, ספירות, head, סטטיסטיקות, כתובת רשת,
// ומדד החיים הרשמי (חוק 8: אימותים ליחידת-זמן — ה-DAU היחיד שאנחנו מדווחים)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/weave/api";
import { GENESIS_HASH } from "@/lib/weave/chain";
import { ensureSeed } from "@/lib/weave/seed";
import { computeVitality } from "@/lib/weave/vitality";
import type { WeaveStateDTO } from "@/lib/weave/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeed();

    const [chainCount, agents, checkpoints, lastAtt, lastCp, networkKey, statusGroups, vitality] =
      await Promise.all([
        db.attestation.count(),
        db.agent.count(),
        db.checkpoint.count(),
        db.attestation.findFirst({ orderBy: { seq: "desc" } }),
        db.checkpoint.findFirst({ orderBy: { index: "desc" } }),
        db.networkKey.findUnique({ where: { id: "weave-network" } }),
        db.attestation.groupBy({ by: ["status"], _count: { _all: true } }),
        computeVitality(),
      ]);

    const stats: Record<string, number> = {
      VERIFIED: 0,
      REFUTED: 0,
      UNMEASURED: 0,
      CONTESTED: 0,
    };
    for (const group of statusGroups) {
      stats[group.status] = group._count._all;
    }

    const state: WeaveStateDTO = {
      chainCount,
      headHash: lastAtt?.entryHash ?? GENESIS_HASH,
      agents,
      checkpoints,
      lastRoot: lastCp?.root ?? null,
      lastAnchorStatus: lastCp?.anchorStatus ?? null,
      stats,
      networkAddress: networkKey?.address ?? null,
      vitality,
    };

    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return jsonError(error);
  }
}
