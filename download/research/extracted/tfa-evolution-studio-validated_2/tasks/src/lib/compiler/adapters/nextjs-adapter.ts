/**
 * TFA Evolution Studio v28 — Next.js Adapter
 *
 * Discovery, install, build, preview, and export for Next.js projects.
 */

import fs from "fs";
import path from "path";
import type { AdapterTarget, AdapterLifecycle } from "@/lib/types";
import { execWithRetry } from "./exec-helper";

const targetId = "nextjs";

export const NextJsAdapter = {
  target: {
    targetId,
    label: "Next.js Application",
    description: "Next.js projects with server-side and static export support.",
    extensions: [".tsx", ".ts", ".jsx", ".js"],
    buildCommand: "next build",
    installCommand: "npm install",
    previewCommand: "next start",
    exportCommand: "next build",
  } as AdapterTarget,

  lifecycle: {
    async discover(projectRoot: string): Promise<boolean> {
      const pkgPath = path.join(projectRoot, "package.json");
      if (!fs.existsSync(pkgPath)) return false;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        return !!deps.next;
      } catch {
        return false;
      }
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
      const result = await execWithRetry("npx", ["next", "build"], {
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

    async preview(projectRoot: string, log: (msg: string) => void): Promise<{ url?: string }> {
      log("[nextjs-adapter] Preview: run `npx next start` in the project directory.");
      return { url: undefined };
    },

    async export(projectRoot: string, log: (msg: string) => void): Promise<{ zipPath: string }> {
      const outDir = path.join(projectRoot, "dist");
      const zipPath = path.join(projectRoot, "..", "output.zip");
      // If static export is configured, the output is in out/ or dist/
      const srcDir = fs.existsSync(outDir) ? outDir : path.join(projectRoot, ".next");
      const result = await execWithRetry("zip", ["-r", zipPath, "."], {
        cwd: srcDir,
        timeoutMs: 60_000,
        log,
      });
      log(result.stdout);
      return { zipPath };
    },
  } as AdapterLifecycle,
};
