// GET  /api/events/[projectId]   — event log for a project
// POST /api/events/[projectId]   — emit an event
import { NextRequest, NextResponse } from "next/server";
import {
  getProjectEvents,
  emitEvent,
  getAuditTrail,
  replayProjectEvents,
  EventKind,
  EventSeverity,
} from "@/lib/event-store/event-store";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") ?? "events";
    const limit = parseInt(searchParams.get("limit") ?? "100", 10);
    const after = searchParams.get("after") ?? undefined;
    const kinds = searchParams.get("kinds")?.split(",") as EventKind[] | undefined;

    if (mode === "audit") {
      return NextResponse.json({ success: true, data: getAuditTrail(projectId, limit) });
    }
    if (mode === "replay") {
      return NextResponse.json({ success: true, data: replayProjectEvents(projectId) });
    }

    const events = getProjectEvents(projectId, { limit, after, kinds });
    return NextResponse.json({ success: true, data: events, count: events.length });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await req.json();
    const { kind, severity, actor, payload, correlationId, causationId } = body as {
      kind: EventKind;
      severity?: EventSeverity;
      actor?: string;
      payload: Record<string, unknown>;
      correlationId?: string;
      causationId?: string;
    };

    if (!kind || !payload) {
      return NextResponse.json({ success: false, error: "kind and payload required" }, { status: 400 });
    }

    const event = emitEvent({
      kind,
      projectId,
      severity: severity ?? "info",
      actor: actor ?? "user",
      payload,
      correlationId,
      causationId,
    });

    return NextResponse.json({ success: true, data: event });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
