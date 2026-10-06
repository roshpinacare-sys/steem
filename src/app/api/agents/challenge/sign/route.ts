// POST /api/agents/challenge/sign — סימולציית סוכן (DEVNET בלבד):
// השרת, שמחזיק את המפתח לצורך הדמו, חותם את ה-digest של
// (הזהות הפעילה, nonce) ב-EIP-191. בייצור הסוכן חותם אצלו —
// והרשת מקבלת רק את החתימה. החתימה פומבית; אין חומר מפתח בתשובה.
import { jsonOk, jsonError, readJsonBody } from "@/lib/weave/api";
import { LedgerError } from "@/lib/weave/ledger";
import { requireActiveAgent, simulateAgentSign } from "@/lib/weave/nonces";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const agent = await requireActiveAgent(body.agentId);
    if (typeof body.nonce !== "number" || !Number.isInteger(body.nonce)) {
      throw new LedgerError("נדרש nonce (מספר שלם) של האתגר שיש לחתום", 400);
    }
    const { digest, signature } = await simulateAgentSign(agent, body.nonce);
    return jsonOk({
      digest,
      signature,
      simulatedBy: "server (DEVNET — סימולציית סוכן; בייצור החתימה מגיעה מהסוכן)",
    });
  } catch (error) {
    return jsonError(error);
  }
}
