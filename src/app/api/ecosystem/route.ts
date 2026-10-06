// GET /api/ecosystem — מלאי הריפוים מהביקורת (הכי משוכפל ראשון: dupScore desc)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, toRepoDTO } from "@/lib/weave/api";
import { ensureSeed } from "@/lib/weave/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeed();
    const repos = await db.repoInventory.findMany({
      orderBy: [{ dupScore: "desc" }, { name: "asc" }],
    });
    return NextResponse.json({ ok: true, repos: repos.map(toRepoDTO) });
  } catch (error) {
    return jsonError(error);
  }
}
