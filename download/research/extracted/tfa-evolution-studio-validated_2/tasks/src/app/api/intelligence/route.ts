import { NextRequest, NextResponse } from "next/server";
import {
  runCrossProjectAnalysis,
  getIntelligenceState,
  promotePatternToTemplate,
  getProjectSuggestions,
} from "@/lib/intelligence/cross-project-engine";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  try {
    if (projectId) {
      const suggestions = getProjectSuggestions(projectId);
      return NextResponse.json({ suggestions });
    }
    const state = getIntelligenceState();
    return NextResponse.json({ intelligence: state });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { action?: string; patternId?: string };
  try {
    if (body.action === "analyze") {
      const report = runCrossProjectAnalysis();
      return NextResponse.json({ report });
    }
    if (body.action === "promote" && body.patternId) {
      const ok = promotePatternToTemplate(body.patternId);
      return NextResponse.json({ promoted: ok });
    }
    return NextResponse.json({ error: "action required: analyze | promote" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
