// POST /api/weave/attest — אימות חדש בספר: ולידציה, פוליסת מאמת (השרת קובע סטטוס),
// ואז appendAttestation (שרשרת + חתימת EIP-191 + ecrecover).
import { NextResponse } from "next/server";
import { jsonError, readJsonBody } from "@/lib/weave/api";
import { appendAttestation, toAttestationDTO } from "@/lib/weave/ledger";
import { CLAIM_TYPES, type ClaimType } from "@/lib/weave/types";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);

    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    const claim = typeof body.claim === "string" ? body.claim : "";
    const claimType = typeof body.claimType === "string" ? body.claimType : "";
    const evidence = typeof body.evidence === "string" ? body.evidence : "";
    // ⚠ body.status לא מתקבל — השרת קובע את הסטטוס בפוליסת המאמת.

    if (!agentId) {
      return NextResponse.json(
        { ok: false, error: "נדרש agentId של סוכן רשום ברשת" },
        { status: 400 }
      );
    }
    if (!claim.trim()) {
      return NextResponse.json(
        { ok: false, error: "הטענה ריקה — אין טענה בלי תוכן" },
        { status: 400 }
      );
    }
    if (!CLAIM_TYPES.includes(claimType as ClaimType)) {
      return NextResponse.json(
        {
          ok: false,
          error: `סוג טענה לא חוקי (${claimType || "חסר"}) — המותרים: ${CLAIM_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const entry = await appendAttestation({ agentId, claim, claimType, evidence });
    return NextResponse.json({ ok: true, entry: toAttestationDTO(entry) }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
