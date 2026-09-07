import { NextRequest, NextResponse } from "next/server";
import { llmText } from "@/lib/steem-os/ai";

export const dynamic = "force-dynamic";

/**
 * S5 Oracle — LIVE inbox (read-only!).
 * GET /api/solo/oracle?username=X&limit=200
 * Scans the account's real chain history for incoming transfers with a memo
 * (paid questions), then drafts Hebrew AI answers for the new ones.
 * NEVER signs anything — answers are drafts for the user to send.
 */

const RPC = "https://api.steemit.com";
const draftCache = new Map<string, string>(); // trxId -> draft (in-process)

interface HistEvent {
  block: number;
  op: [string, Record<string, unknown>];
  timestamp: string;
  trx_id?: string;
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 77 }),
    cache: "no-store",
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result as T;
}

export async function GET(req: NextRequest) {
  const username = (req.nextUrl.searchParams.get("username") ?? "headcorner")
    .trim()
    .replace(/^@/, "");
  const limit = Math.min(
    100, // chain hard cap for start=-1 queries
    Math.max(50, Number(req.nextUrl.searchParams.get("limit")) || 100)
  );

  try {
    const hist = await rpc<[number, HistEvent][]>("condenser_api.get_account_history", [
      username,
      -1,
      limit,
    ]);

    const questions = hist
      .filter(([, ev]) => ev.op?.[0] === "transfer")
      .map(([, ev]) => {
        const t = ev.op[1] as { from: string; to: string; amount: string; memo?: string };
        return {
          trxId: ev.trx_id ?? `${ev.block}-${t.from}`,
          from: t.from,
          to: t.to,
          amount: t.amount,
          memo: t.memo ?? "",
          time: ev.timestamp,
        };
      })
      .filter((t) => t.to === username && t.memo && !t.memo.startsWith("#"))
      .slice(0, 20);

    // draft answers for new questions (LLM; cached per trxId)
    const items: {
      trxId: string;
      from: string;
      to: string;
      amount: string;
      memo: string;
      time: string;
      draft: string;
    }[] = [];
    for (const q of questions) {
      let draft = draftCache.get(q.trxId) ?? null;
      if (!draft) {
        draft =
          (await llmText(
            "אתה אורקל Steem ותיק. ענה בעברית, 2-3 משפטים מעשיים ומדויקים.",
            `לקוח שילם ${q.amount} עם השאלה: "${q.memo.slice(0, 300)}"`
          )) ?? "(טיוטה לא זמינה כרגע)";
        if (draft && !draft.startsWith("(")) draftCache.set(q.trxId, draft);
      }
      items.push({ ...q, draft });
    }

    return NextResponse.json({
      ok: true,
      username,
      scanned: hist.length,
      inbox: items,
      note:
        items.length === 0
          ? "אין שאלות בתשלום עדיין — ההיסטוריה נסרקה חי. לאחר פרסום השירות, שאלות יזרמו לכאן אוטומטית."
          : null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "oracle error" },
      { status: 502 }
    );
  }
}
