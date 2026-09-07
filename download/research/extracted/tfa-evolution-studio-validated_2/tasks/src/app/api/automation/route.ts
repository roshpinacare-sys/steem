import { NextRequest, NextResponse } from "next/server";
import {
  listRules,
  createRule,
  getAutomationLogs,
} from "@/lib/automation/automation-engine";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") ?? undefined;
  const logs = searchParams.get("logs") === "true";
  try {
    if (logs) {
      return NextResponse.json({ logs: getAutomationLogs(200) });
    }
    return NextResponse.json({ rules: listRules(projectId) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name || !body.trigger || !body.actions) {
      return NextResponse.json({ error: "name, trigger, and actions are required" }, { status: 400 });
    }
    const rule = createRule({
      name: body.name,
      description: body.description ?? "",
      enabled: body.enabled ?? true,
      trigger: body.trigger,
      actions: body.actions,
      projectId: body.projectId ?? "__global__",
      requiresApproval: body.requiresApproval ?? false,
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
