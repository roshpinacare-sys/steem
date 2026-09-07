// GET  /api/jobs        — full job engine state
// POST /api/jobs        — enqueue a new job
import { NextRequest, NextResponse } from "next/server";
import {
  loadJobEngine,
  enqueueJob,
  recoverStaleLeases,
  JobKind,
} from "@/lib/job-engine/job-engine";
import type { JobPriority } from "@/lib/types";

export async function GET() {
  try {
    recoverStaleLeases();
    const state = loadJobEngine();
    return NextResponse.json({ success: true, data: state });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { kind, projectId, priority, metadata, retryPolicyOverride } = body as {
      kind: JobKind;
      projectId: string;
      priority?: JobPriority;
      metadata?: Record<string, unknown>;
      retryPolicyOverride?: Record<string, unknown>;
    };

    if (!kind || !projectId) {
      return NextResponse.json({ success: false, error: "kind and projectId required" }, { status: 400 });
    }

    const job = enqueueJob(projectId, kind);
    return NextResponse.json({ success: true, data: job });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
