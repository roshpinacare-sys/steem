// GET /api/weave/checkpoints — רשימת נקודות העוגן (desc לפי index)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, toCheckpointDTO } from "@/lib/weave/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db.checkpoint.findMany({ orderBy: { index: "desc" } });
    return NextResponse.json({ ok: true, checkpoints: rows.map(toCheckpointDTO) });
  } catch (error) {
    return jsonError(error);
  }
}
