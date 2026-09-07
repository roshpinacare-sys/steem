// GET    /api/memory  — list global memory entries (optionally filter by key)
// POST   /api/memory  — set a global memory entry
// DELETE /api/memory  — delete a global memory entry by key
import { NextRequest, NextResponse } from "next/server";
import {
  getGlobalMemory,
  setMemory,
  deleteMemory,
} from "@/lib/memory/extended-memory";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key") ?? undefined;
    const entries = getGlobalMemory(key);
    return NextResponse.json({ success: true, data: entries });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { key?: string; value?: unknown };
    const { key, value } = body;
    if (!key) {
      return NextResponse.json(
        { success: false, error: "key is required" },
        { status: 400 }
      );
    }
    const entry = setMemory("__global__", key, value, "global");
    return NextResponse.json({ success: true, data: entry });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key");
    if (!key) {
      return NextResponse.json(
        { success: false, error: "key query param is required" },
        { status: 400 }
      );
    }
    const deleted = deleteMemory("__global__", key, "global");
    return NextResponse.json({ success: true, deleted });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
