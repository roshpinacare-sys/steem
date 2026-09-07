import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isProcessAlive, pidFile } from "./common.mjs";
if (!existsSync(pidFile)) { console.log("TITAI is not running."); process.exit(0); }
const pid = Number(readFileSync(pidFile, "utf8").trim());
if (isProcessAlive(pid)) {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "inherit" });
  else { try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} } }
}
rmSync(pidFile, { force: true });
console.log("TITAI stopped.");
