/**
 * TFA Evolution Studio v28 — Node.js Adapter
 *
 * Discovery, install, build, preview, and export for Node.js projects.
 */

import fs from "fs";
import path from "path";
import type { AdapterTarget, AdapterLifecycle } from "@/lib/types";
import { execWithRetry } from "./exec-helper";

const targetId = "node_api";

export const NodeAdapter = {
  target: {
    targetId,
    label: "Node.js Application",
    description: "Node.js projects using npm, yarn, or pnpm.",
    extensions: [".js", ".mjs", ".cjs", ".ts"],
    buildCommand: "npm run build",
    installCommand: "npm install",
    previewCommand: "npm start",
    exportCommand: "npm run package:zip",
  } as AdapterTarget,

  lifecycle: {
    async discover(projectRoot: string): Promise<boolean> {
      return fs.existsSync(path.join(projectRoot, "package.json"));
    },

    async install(projectRoot: string, log: (msg: string) => void): Promise<boolean> {
      const result = await execWithRetry("npm", ["install"], {
        cwd: projectRoot,
        timeoutMs: 300_000,
        retries: 1,
        retryDelayMs: 5000,
        log,
      });
      log(result.stdout);
      if (result.stderr) log(result.stderr);
      return result.exitCode === 0;
    },

    async build(projectRoot: string, log: (msg: string) => void): Promise<boolean> {
      const pkgPath = path.join(projectRoot, "package.json");
      if (!fs.existsSync(pkgPath)) return false;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (!pkg.scripts?.build) {
        log("[node-adapter] No build script found; skipping build.");
        return true;
      }
      const result = await execWithRetry("npm", ["run", "build"], {
        cwd: projectRoot,
        timeoutMs: 180_000,
        retries: 1,
        retryDelayMs: 5000,
        log,
      });
      log(result.stdout);
      if (result.stderr) log(result.stderr);
      return result.exitCode === 0;
    },

    async preview(projectRoot: string, log: (msg: string) => void): Promise<{ url?: string }> {
      log("[node-adapter] Preview: run `npm start` in the project directory.");
      return { url: undefined };
    },

    async export(projectRoot: string, log: (msg: string) => void): Promise<{ zipPath: string }> {
      const zipPath = path.join(projectRoot, "..", "output.zip");
      const result = await execWithRetry("zip", ["-r", zipPath, ".", "-x", "node_modules/*", ".git/*"], {
        cwd: projectRoot,
        timeoutMs: 60_000,
        log,
      });
      log(result.stdout);
      return { zipPath };
    },
  } as AdapterLifecycle,
};
