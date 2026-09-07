// GET  /api/backlog/[id]        — get item
// PATCH /api/backlog/[id]       — update status
// GET  /api/backlog/project/[projectId] — project-scoped backlog

import { NextRequest, NextResponse } from "next/server";
import {
  getAllBacklogItems,
  updateBacklogItemStatus,
  resolveBacklogItem,
} from "@/lib/control-plane/backlog-engine";
import type { BacklogItem } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = getAllBacklogItems().find((i) => i.id === id);
  if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { status, projectId, resolvedInVersion } = await req.json();
    if (!status || !projectId) {
      return NextResponse.json({ error: "status and projectId required." }, { status: 400 });
    }
    if (status === "resolved" && resolvedInVersion) {
      resolveBacklogItem(projectId, id, resolvedInVersion);
    } else {
      updateBacklogItemStatus(projectId, id, status as BacklogItem["status"]);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
