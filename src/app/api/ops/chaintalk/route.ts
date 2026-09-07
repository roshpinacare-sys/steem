import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * 94 — CHAINTALK — שפת-התקשורת בין-הרשתות (predict→act→measure→match).
 * GET: תוצאת-המשימה-האחרונה + מחזור-הסוחר-הריבוני (אפס-STEEM).
 * קריאה-בלבד, אף-פעם לא 500 — מצב-ללא-ראיה הוא מצב, לא שגיאה.
 */
export async function GET() {
  const agentDir = path.join(process.cwd(), "agent");
  const safe = async (p: string) => {
    try {
      return JSON.parse(await readFile(p, "utf8"));
    } catch {
      return null;
    }
  };
  const result = await safe(path.join(agentDir, "chaintalk_result.json"));
  const sovBiz = await safe(path.join(agentDir, "memo_biz_sov.json"));
  return NextResponse.json(
    {
      ok: true,
      at: new Date().toISOString(),
      mission: result
        ? {
            id: result.mission ?? null,
            language: result.language ?? "CHL-1",
            matches: result.matches ?? null,
            allMatch: !!result.allMatch,
            at: result.at ?? null,
            durationS: result.durationS ?? null,
            summaryHe: result.summaryHe ?? null,
            steps: (result.steps ?? []).map(
              (s: { id: string; net?: string; label?: string; match?: boolean; evidence?: string }) => ({
                id: s.id,
                net: s.net ?? null,
                label: s.label ?? null,
                match: !!s.match,
                evidence: String(s.evidence ?? "").slice(0, 160),
              })
            ),
          }
        : null,
      sovBiz: sovBiz
        ? {
            at: sovBiz.at ?? null,
            customer: sovBiz.customer ?? null,
            steemMoved: sovBiz.steemMoved ?? null,
            orderTxid: sovBiz.steps?.order?.txid ?? null,
            orderBlock: sovBiz.steps?.order?.block ?? null,
            receiptTxid: sovBiz.steps?.receipt?.txid ?? null,
            encReceiptOk: !!sovBiz.steps?.encryptedReceipt?.decryptedOk,
            fill: sovBiz.steps?.fill?.amount ?? null,
          }
        : null,
    },
    { status: 200 }
  );
}
