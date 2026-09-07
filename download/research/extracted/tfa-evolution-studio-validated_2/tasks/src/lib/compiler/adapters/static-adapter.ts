/**
 * TFA Evolution Studio v28 — Static Adapter
 *
 * Discovery, build, and export for static HTML/CSS/JS projects.
 */

import fs from "fs";
import path from "path";
import type { AdapterTarget, AdapterLifecycle } from "@/lib/types";
import { execWithRetry } from "./exec-helper";

const targetId = "static";

export const StaticAdapter = {
  target: {
    targetId,
    label: "Static Site",
    description: "Static HTML/CSS/JS projects with no build step.",
    extensions: [".html", ".css", ".js"],
    buildCommand: undefined,
    installCommand: undefined,
    previewCommand: "npx serve .",
    exportCommand: "zip -r output.zip .",
  } as AdapterTarget,

  lifecycle: {
    async discover(projectRoot: string): Promise<boolean> {
      return fs.existsSync(path.join(projectRoot, "index.html"));
    },

    async install(_projectRoot: string, log: (msg: string) => void): Promise<boolean> {
      log("[static-adapter] No install step needed.");
      return true;
    },

    async build(_projectRoot: string, log: (msg: string) => void): Promise<boolean> {
      log("[static-adapter] No build step needed.");
      return true;
    },

    async preview(projectRoot: string, log: (msg: string) => void): Promise<{ url?: string }> {
      log("[static-adapter] Preview: open index.html in a browser.");
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
