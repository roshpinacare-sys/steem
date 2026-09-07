import { NextRequest, NextResponse } from "next/server";
import { loadAssets, recordAssetUsage, applyAssetTemplate } from "@/lib/assets/engineering-assets";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const asset = loadAssets().find((a) => a.id === id);
  if (!asset) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  return NextResponse.json({ asset });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { action, variables } = await req.json();
    const asset = loadAssets().find((a) => a.id === id);
    if (!asset) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

    if (action === "apply") {
      recordAssetUsage(id);
      const result = applyAssetTemplate(asset, variables ?? {});
      return NextResponse.json({ result });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
