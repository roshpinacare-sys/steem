import { NextRequest, NextResponse } from "next/server";

import {
  BRAIN_TICK_MIN,
  brainTick,
  clearPostingKey,
  computePlan,
  ensureHeartbeat,
  journal,
  lastTick,
  setCuration,
  setDexMm,
  setRealMode,
} from "@/lib/brain";
import { db } from "@/lib/db";
import { readAgentEnv, readAgentStatus } from "@/lib/agent-env";
import { getLiveAccount } from "@/lib/steem/steem-live";

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/ops/brain?username=… — inference + ranked plan + autonomy state +
//      decision journal. Installs the 15-min heartbeat on first call.
// POST /api/ops/brain — autonomy actions: {type:'tick'} | {type:'set-mode',
//      realMode:boolean} | {type:'set-curation', enabled:boolean}.
// No secrets: the vault key never passes through here; only masked public
// fingerprints (from POSTING_WIF_PUB, itself a public key) are ever returned.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const username = (req.nextUrl.searchParams.get("username") ?? "headcorner")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

  ensureHeartbeat();

  const [liveRes, journalRows] = await Promise.allSettled([
    getLiveAccount(username),
    db.brainDecision.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const live = liveRes.status === "fulfilled" && liveRes.value.ok ? liveRes.value : null;
  const env = readAgentEnv();
  const status = readAgentStatus();
  const rows =
    journalRows.status === "fulfilled"
      ? journalRows.value
      : [];

  const { plan, totals, inference } = computePlan(live, env, status);
  const tick = lastTick();

  return NextResponse.json({
    ok: true,
    username,
    fetchedAt: new Date().toISOString(),
    inference,
    totals,
    autonomy: {
      keyConfigured: Boolean(env.POSTING_WIF),
      keyMasked: env.POSTING_WIF_PUB
        ? `${env.POSTING_WIF_PUB.slice(0, 6)}…${env.POSTING_WIF_PUB.slice(-4)}`
        : null,
      activeKeyInVault: Boolean(env.ACTIVE_WIF),
      activeKeyMasked: env.ACTIVE_WIF_PUB
        ? `${env.ACTIVE_WIF_PUB.slice(0, 6)}…${env.ACTIVE_WIF_PUB.slice(-4)}`
        : null,
      realMode: env.DRY_RUN === "false",
      curationEnabled: env.CURATION_ENABLED === "true",
      heartbeatRunning: true,
      heartbeatIntervalMin: BRAIN_TICK_MIN,
      lastTickAt: tick?.at ?? null,
      lastTickNote: tick?.note ?? null,
      agentLastRunAt:
        status && typeof status.updatedAt === "string" ? status.updatedAt : null,
    },
    plan,
    journal: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  let body: { type?: string; realMode?: boolean; enabled?: boolean; value?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  switch (body.type) {
    case "tick": {
      const note = await brainTick(true);
      return NextResponse.json({ ok: true, note });
    }
    case "set-mode": {
      const real = Boolean(body.realMode);
      setRealMode(real);
      await journal(
        "autonomy_change",
        real ? "מצב אמיתי הופעל (DRY_RUN=false, אצירה דלוקה)" : "הוחזר למצב יבש (DRY_RUN=true)",
      );
      return NextResponse.json({ ok: true, realMode: real, curationEnabled: real });
    }
    case "set-curation": {
      const enabled = Boolean(body.enabled);
      setCuration(enabled);
      await journal(
        "autonomy_change",
        enabled ? "מנוע האצירה הופעל (CURATION_ENABLED=true)" : "מנוע האצירה כובה",
      );
      return NextResponse.json({ ok: true, curationEnabled: enabled });
    }
    case "set-dex-mm": {
      // Task 32 — sovereign DEX market-maker flag (agent/.env DEX_MM_ENABLED).
      // The daemon/heartbeat picks it up on the next `agent.cjs --once` spawn:
      // bootstrap mint + backing-derived quotes + the auto-convert bridge.
      const enabled = Boolean(body.enabled);
      setDexMm(enabled);
      await journal(
        "autonomy_change",
        enabled
          ? "מנוע עשיית-השוק של הדקס הופעל (DEX_MM_ENABLED=true) — הנפקת בוטסטרפ + ציטוט סביב הגיבוי הנמדד"
          : "מנוע עשיית-השוק של הדקס כובה (DEX_MM_ENABLED=false)",
      );
      return NextResponse.json({ ok: true, dexMmEnabled: enabled });
    }
    case "authorize": {
      // Task 26 — the operator's standing consent ("אם אני מחובר אתה רשאי
      // לנסות"): recorded in the decision journal so every live attempt is
      // traceable to an explicit authorization moment.
      const value = Boolean(body.value);
      await journal(
        "authorization",
        value
          ? "המפעיל נתן רשות לנסות פעולות חי עם מפתח מחובר (רשות ביצוע דלוקה)"
          : "המפעיל שלל רשות ביצוע חי — כל פעולה רק בלחיצת יד",
      );
      return NextResponse.json({ ok: true, liveAttempts: value });
    }
    case "clear-key": {
      clearPostingKey();
      await journal("key_vault", "מפתח ה-posting נמחק מהכספת המקומית");
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ ok: false, error: "סוג פעולה לא מוכר" }, { status: 400 });
  }
}
