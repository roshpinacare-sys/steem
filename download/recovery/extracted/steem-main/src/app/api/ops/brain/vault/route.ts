import { NextRequest, NextResponse } from "next/server";

import { clearPostingKey, clearActiveKey, journal, vaultPostingKey, vaultActiveKey } from "@/lib/brain";

// ─────────────────────────────────────────────────────────────────────────────
// POST   /api/ops/brain/vault {postingWif | activeWif} — validate a key against
//        its on-chain authority (posting / active) and store it in agent/.env
//        (machine-local, git-ignored). The ONLY sanctioned key storage in SAOS.
//        The secret is never returned, never logged; the response carries the
//        public fingerprint only. ACTIVE unlocks: DEX bid-side escrow,
//        Hive-Engine sidechain execution, RC account factory.
// DELETE /api/ops/brain/vault?role=active — wipe the stored key (default: posting).
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { username?: string; postingWif?: string; activeWif?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const username = (body.username ?? "headcorner").trim().replace(/^@/, "").toLowerCase();

  // Active key vaulting (Task 36) — one paste unlocks escrow/sidechain/factory
  const activeWif = (body.activeWif ?? "").trim();
  if (activeWif) {
    const res = await vaultActiveKey(username, activeWif);
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    }
    await journal(
      "key_vault",
      `מפתח active נשמר בכספת המקומית (${res.masked}) — escrow צד-קונים, מסחר צד-שרשרת ומפעל חשבונות נחשפים לדמון`,
      "validated against on-chain active authority; secret stays in agent/.env",
    );
    return NextResponse.json({ ok: true, role: "active", masked: res.masked });
  }

  const wif = (body.postingWif ?? "").trim();
  if (!wif) {
    return NextResponse.json({ ok: false, error: "חסר המפתח" }, { status: 400 });
  }

  const res = await vaultPostingKey(username, wif);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  }

  await journal(
    "key_vault",
    `מפתח posting נשמר בכספת המקומית (${res.masked}) — הסוכן חמוש לתפעול`,
    "validated against on-chain posting authority; secret stays in agent/.env",
  );
  return NextResponse.json({ ok: true, role: "posting", masked: res.masked });
}

export async function DELETE(req: NextRequest) {
  const role = new URL(req.url).searchParams.get("role") === "active" ? "active" : "posting";
  if (role === "active") {
    clearActiveKey();
    await journal("key_vault", "מפתח ה-active נמחק מהכספת המקומית");
  } else {
    clearPostingKey();
    await journal("key_vault", "מפתח ה-posting נמחק מהכספת המקומית");
  }
  return NextResponse.json({ ok: true, role });
}
