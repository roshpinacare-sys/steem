// GET /api/weave/evm3 — סטטיסטיקות מנגנון replay-protection (שער EVM-3):
// רוטציות מה-DB; מוני אתגרים/דחיות בזיכרון — מתויגים כסיפור בעל משך חיים.
import { jsonOk, jsonError } from "@/lib/weave/api";
import { evm3Stats } from "@/lib/weave/rotation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk({ stats: await evm3Stats() });
  } catch (error) {
    return jsonError(error);
  }
}
