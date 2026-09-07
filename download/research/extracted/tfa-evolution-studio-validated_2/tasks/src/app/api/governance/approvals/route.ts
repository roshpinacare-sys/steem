import { NextRequest, NextResponse } from "next/server";
import {
  getApprovals,
  approveAction,
  rejectAction,
  requestApproval,
} from "@/lib/governance/approval-gate";
import { getAuditTrail, getAuditSummary } from "@/lib/governance/audit-trail";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") ?? "approvals";
  const projectId = searchParams.get("projectId") ?? undefined;

  try {
    if (view === "audit") {
      const trail = getAuditTrail(projectId, 200);
      const summary = getAuditSummary(projectId);
      return NextResponse.json({ trail, summary });
    }

    const status = searchParams.get("status") as "pending" | null;
    const approvals = getApprovals(projectId)
      .filter((a: { status?: string; projectId?: string }) => !status || a.status === status)
      .slice(0, 100);
    return NextResponse.json({ approvals });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    action?: string;
    approvalId?: string;
    rejectedBy?: string;
    reason?: string;
    approvedBy?: string;
    // For creating new approval requests
    requestAction?: string;
    description?: string;
    requestedBy?: string;
    projectId?: string;
  };

  try {
    if (body.action === "approve" && body.approvalId) {
      const result = approveAction(body.approvalId, body.approvedBy ?? "admin");
      return NextResponse.json({ approval: result });
    }
    if (body.action === "reject" && body.approvalId) {
      const result = rejectAction(body.approvalId, body.rejectedBy ?? "admin");
      return NextResponse.json({ approval: result });
    }
    if (body.action === "request" && body.requestAction) {
      const result = requestApproval(
        body.projectId ?? "__global__",
        body.requestAction,
        "low",
        body.requestedBy ?? "user"
      );
      return NextResponse.json({ approval: result });
    }
    return NextResponse.json({ error: "action required: approve | reject | request" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
