// POST /api/agents/rotate — רוטציית מפתח סוכן חתומה EIP-712 עם nonce:
// המפתח הישן מסמיך את ההעברה לכתובת החדשה, ה-nonce נצרך, הפעולה
// מתועדת ב-KeyOp. אין devKeyHex בתשובה — לעולם.
import { jsonOk, jsonError, readJsonBody, toAgentDTO } from "@/lib/weave/api";
import { db } from "@/lib/db";
import { rotateAgentKey, toKeyOpDTO } from "@/lib/weave/rotation";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const { op, agent } = await rotateAgentKey(body.agentId, body.note);

    const attCount = await db.attestation.count({ where: { agentId: agent.id } });
    return jsonOk({ op: toKeyOpDTO(op, agent.name), agent: toAgentDTO(agent, attCount) });
  } catch (error) {
    return jsonError(error);
  }
}
