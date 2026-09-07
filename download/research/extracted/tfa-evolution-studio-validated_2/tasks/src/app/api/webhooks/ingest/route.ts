import { NextRequest, NextResponse } from "next/server";
import { fireAutomation } from "@/lib/automation/automation-engine";
import { recordEvent } from "@/lib/event-store/event-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event, payload, projectId } = body;
    recordEvent("webhook_ingest", payload, projectId);
    const fired = fireAutomation(event ?? "webhook", payload ?? {}, projectId);
    return NextResponse.json({ received: true, fired: fired.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
