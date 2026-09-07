// GET /api/architecture?projectId=...&versionId=... — build arch graph + risks
import { NextRequest, NextResponse } from "next/server";
import { getVersionProjectDir, loadProjectState } from "@/lib/project-store";
import { buildArchitectureGraph, analyzeRisks, detectRefactoringCandidates } from "@/lib/architecture/arch-intelligence";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const versionId = searchParams.get("versionId");

    if (!projectId) {
      return NextResponse.json({ error: "projectId required." }, { status: 400 });
    }

    const state = loadProjectState(projectId);
    const resolvedVersionId = versionId ?? state.activeVersionId;
    if (!resolvedVersionId) {
      return NextResponse.json({ error: "No active version found." }, { status: 400 });
    }

    const workspaceRoot = getVersionProjectDir(projectId, resolvedVersionId);
    const graph = buildArchitectureGraph(projectId, workspaceRoot);
    const risks = analyzeRisks(projectId, graph);
    const refactoringCandidates = detectRefactoringCandidates(projectId, graph);

    return NextResponse.json({ graph, risks, refactoringCandidates });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
