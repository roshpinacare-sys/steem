import { NextResponse } from "next/server";
import { ensureDevKeeperAlive } from "@/lib/dev-keeper-organ";

export const dynamic = "force-dynamic";

/* R262: explicit implantation of the dev-keeper organ (:3044) — mirror of
 * spawn-metrics. Idempotent, single-instance law, refused-when-healthy.
 * The keeper watches :3000 and resurrects the dev server after any crash
 * (measured R262 failure: kernel OOM kill of next-server left the cockpit
 * dead with no recovery path). Fixed-command watchdog: no secrets, no params,
 * no arbitrary exec. */

export async function POST() {
  const res = await ensureDevKeeperAlive();
  return NextResponse.json({
    ok: res.alive,
    verdict: res.action,
    pid: res.pid ?? null,
    organ: "dev-keeper",
    port: 3044,
  });
}
