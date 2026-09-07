import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { verifyAuditChain, listAudit } from "@/lib/engine/audit";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const withEntries = url.searchParams.get("entries") === "1";
  const result = verifyAuditChain();
  return NextResponse.json({
    ...result,
    entries:
      withEntries && session.user.role === "admin" ? listAudit(200) : undefined,
    entriesRestricted: withEntries && session.user.role !== "admin",
  });
}
