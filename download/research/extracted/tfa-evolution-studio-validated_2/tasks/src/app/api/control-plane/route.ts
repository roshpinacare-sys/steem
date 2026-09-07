// GET  /api/control-plane — get scheduler state
// POST /api/control-plane — enqueue a job
// DELETE /api/control-plane/jobs/[id] — cancel queued job

import { NextRequest, NextResponse } from "next/server";
import {
  loadControlPlane,
  enqueueJob,
  dequeueNextJob,
  setControlPlaneStatus,
} from "@/lib/control-plane/scheduler";
import { scanAllProjectBacklogs } from "@/lib/control-plane/backlog-engine";
import type { ScheduledJobKind, JobPriority } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const state = loadControlPlane();
  return NextResponse.json({ controlPlane: state });
}

export async function POST(req: NextRequest) {
  try {
    const { kind, projectId, priority, action } = await req.json();

    if (action === "scan_backlogs") {
      setControlPlaneStatus("scanning");
      const results = scanAllProjectBacklogs();
      setControlPlaneStatus("idle");
      return NextResponse.json({ results, scanned: results.length });
    }

    if (action === "dequeue") {
      const job = dequeueNextJob();
      return NextResponse.json({ job: job ?? null });
    }

    if (!kind || !projectId) {
      return NextResponse.json({ error: "kind and projectId are required." }, { status: 400 });
    }

    const job = enqueueJob(kind as ScheduledJobKind, projectId, (priority as JobPriority) ?? "medium");
    return NextResponse.json({ job }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
