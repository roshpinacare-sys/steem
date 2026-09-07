// ============================================================================
// TFA Evolution Studio v17 — GET /api/compiler/download/[jobId]
//
// Streams the verified output ZIP for a completed compiler job.
// Response headers:
//   Content-Type: application/zip
//   Content-Disposition: attachment; filename="<zipName>"
//   X-TFA-Version: <PLATFORM_VERSION>
//   X-TFA-Job-Id: <jobId>
//   X-TFA-SHA256: <sha256>
//   X-TFA-Target: <targetPlatform>
//
// Returns 404 if job not found, 409 if job not yet complete,
// 410 if output ZIP has been removed, 200 with ZIP bytes on success.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getJob } from "@/lib/compiler/compiler-orchestrator";
import { PLATFORM_VERSION } from "@/lib/version-coherence";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  const { jobId } = await params;

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: `Job not found: ${jobId}` }, { status: 404 });
  }

  if (job.status !== "completed") {
    return NextResponse.json(
      {
        error: `Job is not complete (status="${job.status}"). Poll /api/compiler/status/${jobId} until status=completed.`,
        status: job.status,
      },
      { status: 409 }
    );
  }

  if (!job.outputZipPath) {
    return NextResponse.json(
      { error: "Job completed but no output ZIP path recorded — pipeline may have failed to export" },
      { status: 500 }
    );
  }

  if (!fs.existsSync(job.outputZipPath)) {
    return NextResponse.json(
      {
        error: `Output ZIP has been removed from disk: ${path.basename(job.outputZipPath)}`,
        hint: "Re-run the compilation to regenerate the artifact.",
      },
      { status: 410 }
    );
  }

  const zipBuffer = fs.readFileSync(job.outputZipPath);
  const zipName = path.basename(job.outputZipPath);

  return new NextResponse(zipBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "Content-Length": String(zipBuffer.length),
      "X-TFA-Version": PLATFORM_VERSION,
      "X-TFA-Job-Id": jobId,
      "X-TFA-Evidence-Count": String(job.evidence.length),
      "Cache-Control": "no-store",
    },
  });
}
