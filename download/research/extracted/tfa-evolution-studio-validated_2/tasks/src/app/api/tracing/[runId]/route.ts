import { NextRequest, NextResponse } from "next/server";
import { getEventsByRunId } from "@/lib/event-store/event-store";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const events = getEventsByRunId(runId);
  return NextResponse.json({ runId, events });
}
