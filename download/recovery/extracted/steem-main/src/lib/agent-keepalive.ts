import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Sovereign keepalive — the console resurrects its own daemon.
 *
 * The sandbox environment reaps long-lived background processes spawned from
 * interactive shells. The Next.js server process, however, is managed by the
 * environment and stays alive. So instead of hoping the daemon survives, the
 * console itself guarantees it: every status poll lazily checks whether
 * agent/agent.cjs is running and respawns it (detached) when it died.
 *
 * Iron rules preserved:
 *   - read-only for secrets: we never read .env here, never touch WIFs.
 *   - the daemon signs machine-locally; we only relaunch the process.
 *   - rate-limited: at most one liveness probe per 20s, one respawn per 90s.
 */

const AGENT_DIR = path.join(process.cwd(), "agent");

type KeepaliveState = {
  lastCheckAt: number;
  lastSpawnAt: number | null;
  spawnCount: number;
  lastError: string | null;
};

const g = globalThis as typeof globalThis & { __saosAgentKeepalive?: KeepaliveState };

function state(): KeepaliveState {
  if (!g.__saosAgentKeepalive) {
    g.__saosAgentKeepalive = { lastCheckAt: 0, lastSpawnAt: null, spawnCount: 0, lastError: null };
  }
  return g.__saosAgentKeepalive;
}

function daemonAlive(): Promise<boolean> {
  return new Promise((resolve) => {
    // Match "agent.cjs" anywhere in the command line (relative or absolute).
    // pgrep excludes its own pid, so the pattern cannot self-match.
    execFile("pgrep", ["-f", "agent\\.cjs"], { timeout: 4000 }, (err, stdout) => {
      if (!err && String(stdout).trim().length > 0) return resolve(true);
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        // pgrep missing → fall back to a recent status file as liveness proxy
        try {
          const st = fs.statSync(path.join(AGENT_DIR, "agent-status.json"));
          resolve(Date.now() - st.mtimeMs < 5 * 60 * 1000);
        } catch {
          resolve(false);
        }
        return;
      }
      resolve(false);
    });
  });
}

function spawnDaemon(): void {
  const s = state();
  try {
    fs.mkdirSync(AGENT_DIR, { recursive: true });
    const stderrFd = fs.openSync(path.join(AGENT_DIR, "agent.log"), "a");
    // stdout ignored — the daemon writes its own log file via appendFileSync.
    // Absolute script path → the cmdline is unambiguous for the liveness probe.
    const child = spawn(process.execPath, [path.join(AGENT_DIR, "agent.cjs")], {
      cwd: AGENT_DIR,
      detached: true,
      stdio: ["ignore", "ignore", stderrFd],
    });
    child.unref();
    s.lastSpawnAt = Date.now();
    s.spawnCount += 1;
    s.lastError = null;
  } catch (e) {
    s.lastError = String((e as Error)?.message || e).slice(0, 120);
  }
}

/** Call from hot API routes (status polling). Fire-and-forget, never throws. */
export function ensureAgentAlive(): void {
  const s = state();
  const now = Date.now();
  if (now - s.lastCheckAt < 20_000) return;
  s.lastCheckAt = now;
  if (s.lastSpawnAt && now - s.lastSpawnAt < 90_000) return; // give a fresh spawn time to boot
  void daemonAlive().then((alive) => {
    if (!alive) spawnDaemon();
  });
}

export function keepaliveSnapshot(): { lastSpawnAt: string | null; spawnCount: number; lastError: string | null } {
  const s = state();
  return {
    lastSpawnAt: s.lastSpawnAt ? new Date(s.lastSpawnAt).toISOString() : null,
    spawnCount: s.spawnCount,
    lastError: s.lastError,
  };
}
