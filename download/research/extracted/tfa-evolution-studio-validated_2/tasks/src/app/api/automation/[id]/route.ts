import { NextRequest, NextResponse } from "next/server";
import { updateRule, deleteRule } from "@/lib/automation/automation-engine";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const updated = updateRule(id, body);
    if (!updated) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    return NextResponse.json({ rule: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteRule(id);
  if (!ok) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
