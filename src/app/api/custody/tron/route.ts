// ─────────────────────────────────────────────────────────────────────
// /api/custody/tron — חשיפת-מסילת-TRON לממשק (r188)
//
// קריאה-בלבד של ארטיפקטים-פומביים: הוכחת-הבעלות (r187-A), כלי-היתרות
// (scripts/tron-balance.ts) ובדיקת-הפיקוח השוטפת של מבקר-האוצר.
// אפס-סודות: כתובת-פומבית, מספרים-מדודים, פסקי-דין — ותו-לא.
// ─────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const ROOT = process.cwd();

export async function GET() {
  try {
    const proofPath = path.join(ROOT, "sovereign", "custody", "tron-custody-proof.json");
    const balancePath = path.join(ROOT, "sovereign", "custody", "tron-balance.json");
    const auditPath = path.join(ROOT, "sovereign", "treasury-audit", "last-audit.json");

    let proof: Record<string, unknown> | null = null;
    try {
      proof = JSON.parse(fs.readFileSync(proofPath, "utf8")) as Record<string, unknown>;
    } catch {}

    let balance: Record<string, unknown> | null = null;
    try {
      balance = JSON.parse(fs.readFileSync(balancePath, "utf8")) as Record<string, unknown>;
    } catch {}

    const supervision: { verdict: string | null; detail: string | null; at: string | null } = { verdict: null, detail: null, at: null };
    try {
      const audit = JSON.parse(fs.readFileSync(auditPath, "utf8")) as { at?: string; checks?: Array<{ id?: string; status?: string; detail?: string }> };
      const rail = audit.checks?.find((c) => c.id === "tron-rail");
      if (rail) {
        supervision.verdict = rail.status ?? null;
        supervision.detail = rail.detail ?? null;
        supervision.at = audit.at ?? null;
      }
    } catch {}

    return NextResponse.json(
      {
        ok: true,
        proof: proof
          ? {
              provedAt: proof.provedAt ?? null,
              verdict: proof.verdict ?? null,
              address: proof.address ?? null,
              signatureVerified: proof.signatureVerified ?? null,
              broadcast: proof.broadcast ?? null,
            }
          : null,
        balance: balance
          ? {
              at: balance.at ?? null,
              verdict: balance.verdict ?? null,
              trx: balance.liveTrx ?? null,
              usdtTrc20: balance.liveUsdtTrc20 ?? null,
              derivationMatch: balance.derivationMatch ?? null,
            }
          : null,
        supervision,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 120) }, { status: 502 });
  }
}
