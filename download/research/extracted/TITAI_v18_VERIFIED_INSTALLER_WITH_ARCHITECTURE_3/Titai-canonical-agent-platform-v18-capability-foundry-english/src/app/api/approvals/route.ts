import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listPendingApprovals } from "@/lib/db/queries/runs";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const scope = resolvePilotScope(session.user.id);
  return NextResponse.json({
    approvals: listPendingApprovals(session.user.id, scope),
    scope,
  });
}
