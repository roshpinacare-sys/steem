#!/usr/bin/env node
import { spawnSync } from "child_process";
import { existsSync } from "fs";

const repo = process.argv[2];
const target = process.argv[3] || "qodo";

if (!repo || !repo.includes("/")) {
  console.error("Usage: npx create-qodo <owner/repo> [target-dir]");
  process.exit(1);
}

if (existsSync(target)) {
  console.error(`Target directory ${target} already exists`);
  process.exit(1);
}

console.log(`[create-qodo] scaffolding ${repo} into ${target}`);
const degit = spawnSync("npx", ["degit", `github:${repo}`, target], { stdio: "inherit" });
if (degit.status !== 0) {
  console.error("[create-qodo] degit failed");
  process.exit(1);
}

console.log("[create-qodo] installing dependencies");
const install = spawnSync("npm", ["install"], { cwd: target, stdio: "inherit" });
if (install.status !== 0) {
  console.error("[create-qodo] npm install failed");
  process.exit(1);
}

console.log("[create-qodo] running bootstrap");
const bootstrap = spawnSync("node", ["bootstrap.mjs"], { cwd: target, stdio: "inherit" });
if (bootstrap.status !== 0) {
  console.error("[create-qodo] bootstrap failed");
  process.exit(1);
}

console.log("[create-qodo] done");
