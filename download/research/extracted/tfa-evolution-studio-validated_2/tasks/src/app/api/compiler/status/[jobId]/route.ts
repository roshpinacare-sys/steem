// ============================================================================
// TFA Evolution Studio v16 — GET /api/compiler/status/[jobId]
//
// Returns the current state of a compiler job, including status, logs,
// evidence chain, and (when complete) output ZIP path and hash.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { getJob, listJobs } from "@/lib/compiler/compiler-orchestrator";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  const { jobId } = await params;

  if (!jobId || jobId === "list") {
    // Return list of all jobs (most recent first)
    const jobs = listJobs().slice(0, 50).map((j) => ({
      jobId: j.id,
      status: j.status,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      outputZipPath: j.outputZipPath,
      projectId: j.projectId,
      targetId: j.targetId,
      error: j.error,
      evidenceCount: j.evidence.length,
    }));
    return NextResponse.json({ jobs });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: `Job not found: ${jobId}` }, { status: 404 });
  }

  return NextResponse.json({ job });
}
