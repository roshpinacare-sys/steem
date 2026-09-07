// POST /api/control-plane/jobs/[id]/complete  — mark job complete
// POST /api/control-plane/jobs/[id]/fail      — mark job failed
// DELETE /api/control-plane/jobs/[id]         — cancel queued job

import { NextRequest, NextResponse } from "next/server";
import { completeJob, failJob, cancelQueuedJob } from "@/lib/control-plane/scheduler";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { action, runId, error } = await req.json();
    if (action === "complete") {
      completeJob(id, runId);
      return NextResponse.json({ ok: true });
    }
    if (action === "fail") {
      failJob(id, error ?? "Unknown error");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cancelled = cancelQueuedJob(id);
  if (!cancelled) return NextResponse.json({ error: "Job not found in queue." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
