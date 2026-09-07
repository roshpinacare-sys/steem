import { NextRequest, NextResponse } from "next/server";
import { PLATFORM_VERSION } from "@/lib/version-coherence";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return new NextResponse("Version artifact body", {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-TFA-Version": PLATFORM_VERSION,
      "X-TFA-Version-Id": id,
    },
  });
}
