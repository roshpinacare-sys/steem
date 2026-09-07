// ============================================================================
// TFA Evolution Studio v16 — POST /api/compiler/compile
//
// Accepts a multipart form upload with:
//   - "zip"       (required) — the project ZIP file
//   - "projectId" (optional) — associate this job with an existing project
//
// Saves the ZIP to the workspace, starts the orchestration pipeline, and
// immediately returns the jobId. Poll /api/compiler/status/[jobId] for updates.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { WORKSPACE_ROOT, ensureDir } from "@/lib/paths";
import { startCompilerJob } from "@/lib/compiler/compiler-orchestrator";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData();
    const file = formData.get("zip");
    const projectId = formData.get("projectId");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'zip' field in form data" }, { status: 400 });
    }

    if (!file.name.endsWith(".zip")) {
      return NextResponse.json({ error: "Only .zip files are supported" }, { status: 400 });
    }

    const maxMB = 250;
    if (file.size > maxMB * 1024 * 1024) {
      return NextResponse.json({ error: `ZIP too large (max ${maxMB} MB)` }, { status: 413 });
    }

    // Save the ZIP into workspace uploads area
    const uploadsDir = path.join(WORKSPACE_ROOT, "compiler-uploads");
    ensureDir(uploadsDir);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const jobUploadId = uuidv4().slice(0, 8);
    const zipPath = path.join(uploadsDir, `${jobUploadId}-${safeName}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(zipPath, buffer);

    const outputDir = path.join(WORKSPACE_ROOT, "compiler-output");
    ensureDir(outputDir);

    // Start async compilation pipeline
    const job = startCompilerJob(
      projectId ? String(projectId) : "default",
      { targetId: zipPath }
    );
    const jobId = job.id;

    return NextResponse.json({
      success: true,
      jobId,
      message: `Compilation job started. Poll /api/compiler/status/${jobId} for progress.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to start compilation: ${message}` }, { status: 500 });
  }
}
