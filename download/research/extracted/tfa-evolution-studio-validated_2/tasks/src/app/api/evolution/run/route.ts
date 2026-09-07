import { NextRequest, NextResponse } from "next/server";
import { runEvolutionCycle } from "@/lib/evolution-engine";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId: string = (body as { projectId?: string }).projectId ?? "__platform__";
    const prompt: string | undefined = (body as { prompt?: string }).prompt;
    const chain = runEvolutionCycle(projectId, prompt);
    return NextResponse.json({
      success: true,
      runId: chain.runId,
      projectId: chain.projectId,
      passRate: chain.passRate,
      complete: chain.complete,
      completedAt: chain.completedAt,
      nodeCount: chain.nodes.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Evolution cycle failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
