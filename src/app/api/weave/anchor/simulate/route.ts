// POST /api/weave/anchor/simulate — "ביצוע" ה-calldata של checkpoint על
// רישום העוגן המקומי (סימולציית WeaveAnchorRegistry בשרת — LOCAL).
// פענוח ABI אמיתי → roots[++latestIndex] = root → anchorStatus=LOCAL-ANCHORED.
import { jsonOk, jsonError, readJsonBody, toCheckpointDTO } from "@/lib/weave/api";
import { anchorCheckpointLocally, toLocalAnchorDTO } from "@/lib/weave/registry";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const { anchor, checkpoint } = await anchorCheckpointLocally(body.index);
    return jsonOk(
      { anchor: toLocalAnchorDTO(anchor), checkpoint: toCheckpointDTO(checkpoint) },
      200
    );
  } catch (error) {
    return jsonError(error);
  }
}
