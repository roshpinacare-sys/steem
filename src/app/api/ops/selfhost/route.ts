import { NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/selfhost — Task 84: SELF-HOST verdict (מדע ההיסק).
 *
 * Runs agent/verify_selfhost.cjs — the deduction engine that answers
 * "does the network sit on its own server?" from witnesses that cannot lie:
 *   · the LIVING-ATTEST on Steem/Hive (public RPC, keyless)
 *   · the origin/main commit stream (cloud-heart[bot] fingerprints)
 *   · the local daemon pid + GitHub Actions runs (sealed token)
 *
 * Verdicts: SELF-HOSTED-PROVEN · CLOUD-TAKEOVER-PENDING ·
 *           SANDBOX-PRIMARY · DARK
 * The API never 500s — an unverified state is a state, not an error.
 */

export async function GET() {
  const script = path.join(process.cwd(), "agent", "verify_selfhost.cjs");
  const data = await new Promise<Record<string, unknown>>((resolve) => {
    execFile(
      process.execPath,
      [script],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, cwd: process.cwd() },
      (err, stdout) => {
        if (stdout) {
          try {
            const line = stdout.trim().split("\n").filter(Boolean).pop() || "{}";
            resolve(JSON.parse(line));
            return;
          } catch { /* fall through */ }
        }
        resolve({
          at: new Date().toISOString(),
          verdict: "DARK",
          error: err ? String(err.message || err).slice(0, 120) : "no output",
        });
      }
    );
  });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
