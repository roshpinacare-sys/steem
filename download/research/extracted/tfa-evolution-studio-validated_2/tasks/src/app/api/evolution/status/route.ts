import { NextResponse } from "next/server";
import { loadState } from "@/lib/store";

export async function GET() {
  const state = loadState() as { projects: unknown[]; versions: unknown[]; currentRun?: unknown };
  return NextResponse.json({
    currentRun: state.currentRun ?? null,
  });
}
