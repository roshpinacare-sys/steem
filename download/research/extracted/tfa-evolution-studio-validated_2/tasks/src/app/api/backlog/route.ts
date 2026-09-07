// GET  /api/backlog           — get all backlog items across all projects
// POST /api/backlog           — add a backlog item manually
// POST /api/backlog?scan=true — run full scan across all projects

import { NextRequest, NextResponse } from "next/server";
import {
  getAllBacklogItems,
  addBacklogItem,
  scanAllProjectBacklogs,
  getTopBacklogItems,
} from "@/lib/control-plane/backlog-engine";
import type { BacklogItem } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const top = searchParams.get("top");

  if (top) {
    const items = getTopBacklogItems(parseInt(top, 10) || 10);
    return NextResponse.json({ items });
  }

  const all = getAllBacklogItems();
  const items = projectId ? all.filter((i) => i.projectId === projectId) : all;
  return NextResponse.json({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get("scan") === "true") {
      const results = scanAllProjectBacklogs();
      return NextResponse.json({ results, scanned: results.length });
    }

    const body = await req.json();
    const item = addBacklogItem(body as Omit<BacklogItem, "id" | "detectedAt">);
    return NextResponse.json({ item }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
