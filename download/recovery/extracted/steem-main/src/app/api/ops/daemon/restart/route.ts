import { NextResponse } from "next/server";

import { daemonPid, restartDaemon } from "@/lib/daemon-ctl";

export const dynamic = "force-dynamic";

/**
 * POST /api/ops/daemon/restart — boot/restart the agent daemon (detached,
 * official daemon-ctl path). GET returns the current pid.
 */
export async function GET() {
  const pid = await daemonPid();
  return NextResponse.json({ ok: true, pid });
}

export async function POST() {
  const before = await daemonPid();
  const rd = await restartDaemon();
  return NextResponse.json({ ok: true, before, ...rd });
}
