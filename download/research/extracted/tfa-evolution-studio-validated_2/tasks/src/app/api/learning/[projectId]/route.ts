import { NextRequest, NextResponse } from "next/server";
import { getLessons, runLearningAnalysis, resolveLesson } from "@/lib/learning/learning-engine";
import { getOutcomeSummary, getProjectOutcomes } from "@/lib/learning/outcome-tracker";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  try {
    const learning = getLessons(projectId);
    const outcomeSummary = getOutcomeSummary(projectId);
    const recentOutcomes = getProjectOutcomes(projectId, 20);
    return NextResponse.json({ learning, outcomeSummary, recentOutcomes });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = await req.json().catch(() => ({})) as { action?: string; lessonId?: string };

  try {
    if (body.action === "analyze") {
      const result = runLearningAnalysis(projectId);
      return NextResponse.json({ result });
    }
    if (body.action === "resolve" && body.lessonId) {
      const ok = resolveLesson(projectId, body.lessonId);
      return NextResponse.json({ resolved: ok });
    }
    return NextResponse.json({ error: "action required: analyze | resolve" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
