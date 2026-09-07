import { NextRequest, NextResponse } from "next/server";
import { PLATFORM_VERSION } from "@/lib/version-coherence";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  return new NextResponse("Artifact body", {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-TFA-Version": PLATFORM_VERSION,
      "X-TFA-Artifact-Version": version,
    },
  });
}
