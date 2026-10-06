// POST /api/agents/rotate/replay-demo — הדגמת שלילה חיה (מסומנת כהדגמה):
// ניסיון לחתום אתגר טרי במפתח המשוך (נשמר בזיכרון השרת בלבד, DEVNET).
// החתימה קריפטוגרפית תקינה — אבל הכתובת שתשוחזר היא הישנה → דחייה.
import { jsonOk, jsonError, readJsonBody } from "@/lib/weave/api";
import { attemptRevokedKeySignature } from "@/lib/weave/rotation";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const result = await attemptRevokedKeySignature(body.agentId);
    return jsonOk({ result });
  } catch (error) {
    return jsonError(error);
  }
}
