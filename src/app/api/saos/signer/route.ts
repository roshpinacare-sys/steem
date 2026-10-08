import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// SIGNER-LOG: ראיה-פומבית בלבד: mover-log.jsonl מכיל txids ופרמטרי-פקודות,
// לעולם לא חומר-מפתח (דוקטרינת A-5: אפס-סודות בגיט, המקור-הריבוני בזמן-ריצה בלבד).
const MOVER_LOG = "/home/z/audit/saos-dex/grids/state/mover-log.jsonl";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 200);

  try {
    const raw = await readFile(MOVER_LOG, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries = lines
      .slice(-limit)
      .reverse()
      .map((l, i) => {
        try {
          const o = JSON.parse(l);
          // היגיינה-עמוקה: לעולם לא להחזיר שדות-מפתח גם-אם-יוזרקו ליומן בטעות
          const { wif, key, private: priv, master, password, ...safe } = o as Record<string, unknown>;
          for (const banned of [wif, key, priv, master, password]) void banned;
          return { idx: lines.length - 1 - i, ...safe };
        } catch {
          return { idx: lines.length - 1 - i, unparsed: l.slice(0, 160) };
        }
      });
    return NextResponse.json({
      ok: true,
      total: lines.length,
      returned: entries.length,
      entries,
      source: MOVER_LOG,
      note: "ראיה-פומבית בלבד (txids/פקודות), אפס-חומר-מפתח עובר דרך שירות-זה",
    });
  } catch {
    return NextResponse.json(
      { ok: false, total: 0, returned: 0, entries: [], note: "mover-log.jsonl לא-זמין" },
      { status: 200 }
    );
  }
}
