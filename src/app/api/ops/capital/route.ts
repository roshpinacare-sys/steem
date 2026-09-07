import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Console capital ledger — real-world money movements (docs/CONSOLE_PLAN.md §3).
 * deposit (הפקדה) · convert_result (תוצאת מחזור BOT-3) · reward (פרס) · expense.
 *
 * GET    → { events, summary }
 * POST   { kind, amountUsd, asset?, note?, occurredAt? } → { event }
 * DELETE ?id= → { ok }
 */
const KINDS = new Set(["deposit", "convert_result", "reward", "expense"]);
const ASSETS = new Set(["USD", "STEEM", "SBD", "SP"]);

export async function GET() {
  const events = await db.capitalEvent.findMany({
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  let deposits = 0;
  let results = 0;
  let rewards = 0;
  let expenses = 0;
  for (const e of events) {
    if (e.kind === "deposit") deposits += e.amountUsd;
    else if (e.kind === "convert_result") results += e.amountUsd;
    else if (e.kind === "reward") rewards += e.amountUsd;
    else expenses += e.amountUsd;
  }
  return NextResponse.json({
    events,
    summary: {
      depositsUsd: deposits,
      resultsUsd: results,
      rewardsUsd: rewards,
      expensesUsd: expenses,
      netUsd: results + rewards + deposits - expenses,
      cycleCount: events.filter((e) => e.kind === "convert_result").length,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as {
      kind?: string;
      amountUsd?: number;
      asset?: string;
      note?: string;
      occurredAt?: string;
    };
    if (!b.kind || !KINDS.has(b.kind))
      return NextResponse.json({ error: "סוג אירוע לא תקין" }, { status: 400 });
    const amount = Number(b.amountUsd);
    if (!Number.isFinite(amount) || amount <= 0)
      return NextResponse.json({ error: "סכום חייב להיות מספר חיובי" }, { status: 400 });
    let occurredAt = new Date();
    if (b.occurredAt) {
      const d = new Date(b.occurredAt);
      if (!Number.isNaN(d.getTime())) occurredAt = d;
    }
    const event = await db.capitalEvent.create({
      data: {
        kind: b.kind,
        amountUsd: amount,
        asset: b.asset && ASSETS.has(b.asset) ? b.asset : "USD",
        note: (b.note ?? "").slice(0, 400),
        occurredAt,
      },
    });
    return NextResponse.json({ event });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "חסר id" }, { status: 400 });
  await db.capitalEvent.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
