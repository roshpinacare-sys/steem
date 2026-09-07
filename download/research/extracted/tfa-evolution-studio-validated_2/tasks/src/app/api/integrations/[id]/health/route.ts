import { NextRequest, NextResponse } from "next/server";
import { checkConnectorHealth } from "@/lib/integrations/connector-runtime";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const report = await checkConnectorHealth(id);
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
