import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getVersion, getVersionArtifactsDir } from "@/lib/store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ version: string }> }
) {
  const { version: versionId } = await params;
  const version = getVersion(versionId);

  if (!version?.artifacts) {
    return NextResponse.json({ error: "Artifacts not found" }, { status: 404 });
  }

  return NextResponse.json({
    versionId,
    version: version.versionId,
    artifacts: {
      manifest: version.artifacts.manifest,
      status: version.artifacts.status,
      runbook: version.artifacts.runbook,
      releaseNotes: version.artifacts.releaseNotes,
      nextCyclePrompt: version.artifacts.nextCyclePrompt,
      zipAvailable: fs.existsSync(version.artifacts.zipPath),
      zipName: path.basename(version.artifacts.zipPath),
    },
    fileChanges: version.fileChanges,
  });
}
