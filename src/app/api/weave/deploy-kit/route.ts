// GET /api/weave/deploy-kit — חבילת הפריסה של WeaveAnchorRegistry (EVM-1):
// artifact מקומפל באמת (solc), checklist אמת מוצהר, נתוני tx מלאים.
import { jsonOk, jsonError } from "@/lib/weave/api";
import { getDeployKit } from "@/lib/weave/deploy";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk({ kit: getDeployKit() });
  } catch (error) {
    return jsonError(error);
  }
}
