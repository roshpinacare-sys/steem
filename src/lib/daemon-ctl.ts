import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";

import { AGENT_DIR } from "@/lib/agent-env";

// ─────────────────────────────────────────────────────────────────────────────
// daemon-ctl.ts — lifecycle control for the local agent daemon
// (node agent.cjs in agent/). After the vault stores new keys the daemon must
// be restarted to pick them up (it reads .env once at boot). We keep the same
// contract the operator uses manually: detached process, output appended to
// agent/agent.log.
// ─────────────────────────────────────────────────────────────────────────────

const LOG_PATH = path.join(AGENT_DIR, "agent.log");

function pgrepDaemon(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("pgrep", ["-f", "node agent.cjs"], { timeout: 5_000 }, (err, stdout) => {
      if (err) return resolve(null);
      const pids = stdout
        .split("\n")
        .map((l) => Number(l.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      resolve(pids[0] ?? null);
    });
  });
}

export async function daemonPid(): Promise<number | null> {
  return pgrepDaemon();
}

function spawnDaemon(): number | null {
  try {
    const out = fs.openSync(LOG_PATH, "a");
    const child = spawn("node", ["agent.cjs"], {
      cwd: AGENT_DIR,
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env },
    });
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

function killPid(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("kill", ["-TERM", String(pid)], { timeout: 5_000 }, (err) =>
      resolve(!err),
    );
  });
}

/**
 * Restart the daemon so a freshly-updated .env (new keys, flags) takes
 * effect. Safe to call when nothing is running — it simply boots one.
 */
export async function restartDaemon(): Promise<{ restarted: boolean; pid: number | null }> {
  const existing = await pgrepDaemon();
  if (existing) {
    await killPid(existing);
    await new Promise((r) => setTimeout(r, 700));
  }
  const pid = spawnDaemon();
  return { restarted: pid != null, pid };
}
