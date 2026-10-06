// POST /api/weave/registry/verify — הוכחת הכללה המלאה של אימות מול root
// שברישום המקומי (EVM-2 במצב LOCAL): Merkle proof + חישוב מחדש של העלה.
// כשיהיה חוזה אמיתי — אותה הוכחה בדיוק תאומת מול ה-root שבשרשרת.
import { jsonOk, jsonError, readJsonBody } from "@/lib/weave/api";
import { verifyInclusionAgainstRegistry } from "@/lib/weave/registry";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const report = await verifyInclusionAgainstRegistry(body.seq, body.index);
    return jsonOk({ report });
  } catch (error) {
    return jsonError(error);
  }
}
