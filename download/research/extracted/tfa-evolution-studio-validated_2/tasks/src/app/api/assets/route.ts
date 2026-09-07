// GET  /api/assets         — list / search assets
// POST /api/assets         — create an asset
// GET  /api/assets/[id]    — get single asset
// POST /api/assets/[id]/apply — apply template with variable substitution

import { NextRequest, NextResponse } from "next/server";
import {
  loadAssets,
  createAsset,
  searchAssets,
  recordAssetUsage,
  applyAssetTemplate,
} from "@/lib/assets/engineering-assets";
import type { AssetKind, EngineeringAsset } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const kind = searchParams.get("kind") as AssetKind | null;

  const assets = q || kind ? searchAssets(q, kind ?? undefined) : loadAssets();
  return NextResponse.json({ assets, total: assets.length });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const asset = createAsset(body as Omit<EngineeringAsset, "id" | "createdAt" | "updatedAt" | "usageCount">);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
