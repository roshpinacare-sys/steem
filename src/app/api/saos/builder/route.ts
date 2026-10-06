import { NextResponse } from "next/server";
import { ensureBuilderAlive, fetchBuilderStatus, enqueueTask, tickBuilder } from "@/lib/builder-organ";

export const dynamic = "force-dynamic";
export const maxDuration = 240;

/* R218-d: builder organ API — demand-heal + proxy. POST body:
 * {action:"enqueue", file, task} | {action:"tick"} | GET = status. */

export async function GET() {
  const ensured = await ensureBuilderAlive();
  if (!ensured.alive) {
    return NextResponse.json({ ok: false, verdict: "ORGAN-DOWN", note: "איבר-הבונה (:3043) כבוי — אין טענות מזויפות" }, { status: 503 });
  }
  const status = await fetchBuilderStatus();
  if (!status) return NextResponse.json({ ok: false, verdict: "UNRESPONSIVE" }, { status: 503 });
  return NextResponse.json({ ok: true, action: ensured.action, ...(status as object) });
}

export async function POST(req: Request) {
  let body: { action?: unknown; file?: unknown; task?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* handled below */
  }
  const ensured = await ensureBuilderAlive();
  if (!ensured.alive) {
    return NextResponse.json({ ok: false, verdict: "ORGAN-DOWN" }, { status: 503 });
  }
  if (body.action === "enqueue") {
    if (typeof body.file !== "string" || typeof body.task !== "string") {
      return NextResponse.json({ ok: false, error: "file+task חובה" }, { status: 400 });
    }
    const r = await enqueueTask(body.file, body.task);
    if (!r) return NextResponse.json({ ok: false, verdict: "UNRESPONSIVE" }, { status: 503 });
    return NextResponse.json(r);
  }
  if (body.action === "tick") {
    const r = await tickBuilder();
    if (!r) return NextResponse.json({ ok: false, verdict: "TICK-UNRESPONSIVE", note: "המשימה עדיין רצה (LLM עד ~100 שנ') — בדקו שוב בעוד רגע" }, { status: 503 });
    return NextResponse.json(r);
  }
  return NextResponse.json({ ok: false, error: "action חייב enqueue|tick" }, { status: 400 });
}
