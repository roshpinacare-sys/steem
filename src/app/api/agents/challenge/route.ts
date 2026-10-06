// POST /api/agents/challenge — יצירת אתגר nonce לסוכן:
// digest דטרמיניסטי = keccak256("WEAVE-CHALLENGE-v1|<address>|<nonce>")
import { jsonOk, jsonError, readJsonBody } from "@/lib/weave/api";
import { nextChallenge, requireActiveAgent } from "@/lib/weave/nonces";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const agent = await requireActiveAgent(body.agentId);
    const { nonce, digest } = nextChallenge(agent);
    return jsonOk({
      challenge: {
        agentId: agent.id,
        agentName: agent.name,
        agentAddress: agent.ethAddress,
        nonce,
        digest,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
