/**
 * TFA Evolution Studio v28 — Python Adapter
 *
 * Target discovery, install, build, preview, and export
 * for Python projects (requirements.txt or pyproject.toml).
 */

import fs from "fs";
import path from "path";
import type { AdapterTarget, AdapterLifecycle } from "@/lib/types";
import { execWithRetry } from "./exec-helper";

const targetId = "python_app";

export const PythonAdapter = {
  target: {
    targetId,
    label: "Python Application",
    description: "Python projects using pip, setuptools, or poetry.",
    extensions: [".py"],
    buildCommand: "python -m compileall .",
    installCommand: "pip install -r requirements.txt",
    previewCommand: "python -m http.server 8080",
    exportCommand: "zip -r output.zip .",
  } as AdapterTarget,

  lifecycle: {
    async discover(projectRoot: string): Promise<boolean> {
      return (
        fs.existsSync(path.join(projectRoot, "requirements.txt")) ||
        fs.existsSync(path.join(projectRoot, "pyproject.toml")) ||
        fs.existsSync(path.join(projectRoot, "setup.py"))
      );
    },

    async install(projectRoot: string, log: (msg: string) => void): Promise<boolean> {
      const reqFile = path.join(projectRoot, "requirements.txt");
      if (fs.existsSync(reqFile)) {
        const result = await execWithRetry("pip", ["install", "-r", "requirements.txt"], {
          cwd: projectRoot,
          timeoutMs: 180_000,
          log,
        });
        log(result.stdout);
        if (result.stderr) log(result.stderr);
        return result.exitCode === 0;
      }
      log("[python-adapter] No requirements.txt found; skipping install.");
      return true;
    },

    async build(projectRoot: string, log: (msg: string) => void): Promise<boolean> {
      const result = await execWithRetry("python", ["-m", "compileall", "."], {
        cwd: projectRoot,
        timeoutMs: 120_000,
        log,
      });
      log(result.stdout);
      if (result.stderr) log(result.stderr);
      return result.exitCode === 0;
    },

    async preview(projectRoot: string, log: (msg: string) => void): Promise<{ url?: string }> {
      // Python preview is typically a local server; we just report readiness
      log("[python-adapter] Preview ready (run your main script locally).");
      return { url: undefined };
    },

    async export(projectRoot: string, log: (msg: string) => void): Promise<{ zipPath: string }> {
      const zipPath = path.join(projectRoot, "..", "output.zip");
      const result = await execWithRetry("zip", ["-r", zipPath, "."], {
        cwd: projectRoot,
        timeoutMs: 60_000,
        log,
      });
      log(result.stdout);
      return { zipPath };
    },
  } as AdapterLifecycle,
};
