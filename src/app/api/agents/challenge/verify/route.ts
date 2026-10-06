// POST /api/agents/challenge/verify — אימות אתגר וצריכת nonce:
// ecrecover ✓ וגם nonce === המונה+1 → המונה נצרך. חתימה ישנה שנשלחת
// שוב → 409 replay. זה לב ה-replay protection של שער EVM-3.
import { jsonOk, jsonError, readJsonBody } from "@/lib/weave/api";
import { verifyAndConsumeChallenge } from "@/lib/weave/nonces";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const { agent, consumedNonce, recovered } = await verifyAndConsumeChallenge(
      body.agentId,
      body.nonce,
      body.signature
    );
    return jsonOk({
      verified: {
        agentId: agent.id,
        agentName: agent.name,
        consumedNonce,
        recovered,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
