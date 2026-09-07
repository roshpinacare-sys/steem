import { NextRequest, NextResponse } from "next/server";
import {
  getConnector,
  updateConnector,
  deleteConnector,
  maskSensitiveConfig,
} from "@/lib/integrations/connector-registry";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const connector = getConnector(id);
  if (!connector) return NextResponse.json({ error: "Connector not found" }, { status: 404 });
  return NextResponse.json({ connector: maskSensitiveConfig(connector) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const updated = updateConnector(id, body);
    if (!updated) return NextResponse.json({ error: "Connector not found" }, { status: 404 });
    return NextResponse.json({ connector: maskSensitiveConfig(updated) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteConnector(id);
  if (!ok) return NextResponse.json({ error: "Connector not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
