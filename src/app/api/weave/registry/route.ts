// GET /api/weave/registry — ה-roots שירדו לרישום העוגן המקומי
// (כמו קריאת roots() / latestIndex() על החוזה — בסימולציית השרת).
import { jsonOk, jsonError } from "@/lib/weave/api";
import { listLocalAnchors, toLocalAnchorDTO } from "@/lib/weave/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const anchors = await listLocalAnchors();
    return jsonOk({ anchors: anchors.map(toLocalAnchorDTO) });
  } catch (error) {
    return jsonError(error);
  }
}
