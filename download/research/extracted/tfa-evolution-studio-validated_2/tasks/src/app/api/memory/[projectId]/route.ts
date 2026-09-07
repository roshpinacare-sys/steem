// GET  /api/memory/[projectId]  — get all memory types
// POST /api/memory/[projectId]  — record to a memory type
import { NextRequest, NextResponse } from "next/server";
import {
  getProjectMemory,
  getAgentMemory,
  getDecisionMemory,
  getArchMemory,
  getReleaseMemory,
  buildMemoryDigest,
  recordAgentTask,
  recordDecisionMemory,
  recordArchSnapshot,
  recordRelease,
  recordDecision,
  recordDebt,
  AgentMemoryRecord,
} from "@/lib/memory/extended-memory";
import type {
  ArchitecturalDecision,
  TechnicalDebtItem,
} from "@/lib/types";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") ?? "all";

    if (type === "digest") {
      return NextResponse.json({ success: true, data: { digest: buildMemoryDigest(projectId) } });
    }
    if (type === "project") {
      return NextResponse.json({ success: true, data: getProjectMemory(projectId) });
    }
    if (type === "agents") {
      return NextResponse.json({ success: true, data: getAgentMemory(projectId) });
    }
    if (type === "decisions") {
      return NextResponse.json({ success: true, data: getDecisionMemory(projectId) });
    }
    if (type === "architecture") {
      return NextResponse.json({ success: true, data: getArchMemory(projectId) });
    }
    if (type === "releases") {
      return NextResponse.json({ success: true, data: getReleaseMemory(projectId) });
    }

    // Default: all types summarised
    return NextResponse.json({
      success: true,
      data: {
        project: getProjectMemory(projectId),
        agents: getAgentMemory(projectId),
        decisions: getDecisionMemory(projectId),
        architecture: getArchMemory(projectId),
        releases: getReleaseMemory(projectId),
        digest: buildMemoryDigest(projectId),
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await req.json();
    const { type, data } = body as { type: string; data: Record<string, unknown> };

    switch (type) {
      case "agent":
        recordAgentTask(projectId, data as Omit<AgentMemoryRecord, "projectId" | "recordedAt">);
        break;
      case "decision_memory":
        recordDecisionMemory(projectId, data as Parameters<typeof recordDecisionMemory>[1]);
        break;
      case "arch_snapshot":
        recordArchSnapshot(projectId, data as Parameters<typeof recordArchSnapshot>[1]);
        break;
      case "release":
        recordRelease(projectId, data as Parameters<typeof recordRelease>[1]);
        break;
      case "arch_decision":
        recordDecision(projectId, data as Omit<ArchitecturalDecision, "id" | "recordedAt">);
        break;
      case "debt":
        recordDebt(projectId, data as Omit<TechnicalDebtItem, "id" | "recordedAt">);
        break;
      default:
        return NextResponse.json({ success: false, error: `Unknown memory type: ${type}` }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
