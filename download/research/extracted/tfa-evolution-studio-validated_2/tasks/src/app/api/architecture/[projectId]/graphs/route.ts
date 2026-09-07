// GET  /api/architecture/[projectId]/graphs  — arch index + latest entry
// POST /api/architecture/[projectId]/graphs  — save arch entry
import { NextRequest, NextResponse } from "next/server";
import {
  loadArchEntry,
  loadLatestArchEntry,
  saveArchEntry,
  getArchHistory,
  buildModuleGraph,
  buildPackageDependencyGraph,
  ArchStoreEntry,
} from "@/lib/architecture/arch-store";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const { searchParams } = new URL(req.url);
    const versionId = searchParams.get("versionId");

    const history = getArchHistory(projectId);
    const entry = versionId
      ? loadArchEntry(projectId, versionId)
      : loadLatestArchEntry(projectId);

    return NextResponse.json({ success: true, data: { history, entry } });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await req.json();
    const { archGraph, risks, driftReport, refactoringCandidates, workspaceRoot } = body as {
      archGraph?: ArchStoreEntry["archGraph"];
      risks?: ArchStoreEntry["risks"];
      driftReport?: ArchStoreEntry["driftReport"];
      refactoringCandidates?: ArchStoreEntry["refactoringCandidates"];
      workspaceRoot?: string;
    };

    const versionId = uuidv4().slice(0, 12);
    const moduleGraph = archGraph ? buildModuleGraph(projectId, archGraph) : undefined;
    const depGraph = workspaceRoot
      ? buildPackageDependencyGraph(projectId, workspaceRoot)
      : undefined;

    const entry: ArchStoreEntry = {
      projectId,
      versionId,
      savedAt: new Date().toISOString(),
      archGraph,
      moduleGraph,
      depGraph,
      risks,
      driftReport,
      refactoringCandidates,
    };

    saveArchEntry(entry);
    return NextResponse.json({ success: true, data: { versionId, moduleGraph, depGraph } });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
