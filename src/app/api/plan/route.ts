// GET /api/plan — לוח התוכנית (asc לפי sortOrder)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, toStageDTO } from "@/lib/weave/api";
import { ensureSeed } from "@/lib/weave/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeed();
    const stages = await db.planStage.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ ok: true, stages: stages.map(toStageDTO) });
  } catch (error) {
    return jsonError(error);
  }
}
