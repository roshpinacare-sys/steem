// GET    /api/jobs/[jobId]         — get single job
// DELETE /api/jobs/[jobId]         — request cancellation
// PATCH  /api/jobs/[jobId]         — update progress
import { NextRequest, NextResponse } from "next/server";
import {
  getJob,
  requestJobCancellation,
  updateJobProgress,
  workerHeartbeat,
  markJobRunning,
  completeJob,
  failJob,
  JobProgress,
} from "@/lib/job-engine/job-engine";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
  return NextResponse.json({ success: true, data: job });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const cancelled = requestJobCancellation(jobId);
  if (!cancelled) return NextResponse.json({ success: false, error: "Job not found or already terminal" }, { status: 404 });
  return NextResponse.json({ success: true, message: "Cancellation requested" });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const body = await req.json();
    const { action, progress, workerId, runId, error } = body as {
      action: "running" | "progress" | "heartbeat" | "complete" | "fail";
      progress?: number;
      workerId?: string;
      runId?: string;
      error?: string;
    };

    switch (action) {
      case "running":
        markJobRunning(jobId);
        break;
      case "progress":
        if (progress !== undefined) updateJobProgress(jobId, progress);
        break;
      case "heartbeat":
        if (workerId) workerHeartbeat(workerId);
        break;
      case "complete":
        completeJob(jobId, runId);
        break;
      case "fail":
        failJob(jobId, error ?? "Unknown error");
        break;
      default:
        return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
