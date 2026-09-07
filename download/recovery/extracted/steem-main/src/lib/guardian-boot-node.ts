/**
 * Node-only guardian boot logic (Task 82).
 * Imported conditionally from instrumentation.ts under NEXT_RUNTIME === "nodejs"
 * — the official Next pattern keeps node modules out of the Edge bundle.
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export function guardBoot(): void {
  try {
    const agentDir = path.join(process.cwd(), "agent");
    if (!fs.existsSync(path.join(agentDir, "guardian.cjs"))) return;
    // dedupe: a fresh guardian run (boot/predev/loop) already holds the lock
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(agentDir, ".guardian.lock"), "utf8"));
      if (Date.now() - Number(raw.at) < 2 * 60 * 1000) return; // recently guarded
    } catch (_) {
      /* no fresh guard — proceed */
    }
    const out = fs.openSync(path.join(agentDir, "guardian.log"), "a");
    const child = spawn(process.execPath, ["guardian.cjs", "--boot"], {
      cwd: agentDir,
      detached: true,
      stdio: ["ignore", out, out],
    });
    child.unref();
    console.log("[guardian] boot self-heal dispatched (pid " + child.pid + ")");
  } catch (e) {
    console.error("[guardian] boot dispatch failed (non-fatal):", e);
  }
}

guardBoot();
