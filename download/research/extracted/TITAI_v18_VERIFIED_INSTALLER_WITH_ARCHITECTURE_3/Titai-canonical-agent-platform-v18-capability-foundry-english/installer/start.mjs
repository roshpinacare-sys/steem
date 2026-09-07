import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { checkNode, ensureDirs, installerEnv, isProcessAlive, logFile, pidFile, root, tail } from "./common.mjs";

checkNode(); ensureDirs();
if (!existsSync(join(root, ".next", "BUILD_ID"))) throw new Error("not_built_run_INSTALL_or_REPAIR");
if (!existsSync(join(root, ".env"))) throw new Error("env_missing_run_INSTALL");
if (existsSync(pidFile)) {
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (isProcessAlive(pid)) { console.log(`TITAI is already running (PID ${pid}).`); process.exit(0); }
}
const env = installerEnv({ NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: installerEnv().PORT ?? "3210" });
const port = env.PORT;
const next = join(root, "node_modules", "next", "dist", "bin", "next");
const fd = openSync(logFile, "a");
const child = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", port], {
  cwd: root, env, detached: true, windowsHide: false, stdio: ["ignore", fd, fd],
});
child.unref(); closeSync(fd); writeFileSync(pidFile, String(child.pid));
let ready = false;
for (let i = 0; i < 90; i += 1) {
  await new Promise((r) => setTimeout(r, 500));
  if (!isProcessAlive(child.pid)) break;
  try { const response = await fetch(`http://127.0.0.1:${port}/login`, { redirect: "manual" }); if (response.status > 0) { ready = true; break; } } catch {}
}
if (!ready) {
  console.error("TITAI did not become ready. Recent server log:");
  console.error(tail(logFile));
  process.exit(2);
}
const url = `http://127.0.0.1:${port}`;
console.log(`TITAI is running at ${url} (PID ${child.pid}).`);
if (process.platform === "win32") spawnSync("cmd", ["/c", "start", "", url], { windowsHide: true });
else spawnSync("xdg-open", [url], { stdio: "ignore" });
