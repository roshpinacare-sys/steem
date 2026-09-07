/**
 * TFA Evolution Studio v28 — Project State Management
 *
 * Handles per-project state files, workspace directories,
 * and provider resolution.
 */

import fs from "fs";
import path from "path";
import {
  getProjectDir,
  getVersionProjectDir as getVersionProjectDirFromPaths,
  ensureDir,
  PROVIDERS_FILE,
} from "./paths";
import type { ProjectState } from "./types";

export function loadProjectState(projectId: string): ProjectState {
  const statePath = path.join(getProjectDir(projectId), "state.json");
  if (fs.existsSync(statePath)) {
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf-8")) as ProjectState;
    } catch {
      // fall through to default
    }
  }
  return {
    projectId,
    status: "idle",
    workspaceRoot: getProjectDir(projectId),
  };
}

export function saveProjectState(state: ProjectState): void {
  const statePath = path.join(getProjectDir(state.projectId), "state.json");
  ensureDir(path.dirname(statePath));
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function listProjects(): { id: string; name: string }[] {
  const root = getProjectDir("").replace(/\/projects\/\/?$/, "/projects");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const state = loadProjectState(d.name);
      return { id: d.name, name: state.projectId };
    });
}

export function getActiveProvider(): string {
  if (!fs.existsSync(PROVIDERS_FILE)) return "mock";
  try {
    const providers = JSON.parse(fs.readFileSync(PROVIDERS_FILE, "utf-8")) as {
      active?: string;
      providers?: { id: string; enabled: boolean }[];
    };
    return providers.active || "mock";
  } catch {
    return "mock";
  }
}

export function findVersionById(versionId: string):
  | { version: { artifacts?: { zipPath: string } }; artifactsDir: string }
  | undefined {
  // Scan all projects for this version
  const projects = listProjects();
  for (const p of projects) {
    const state = loadProjectState(p.id);
    if (state.activeVersionId === versionId) {
      const artifactsDir = path.join(getVersionProjectDirFromPaths(p.id, versionId), "..", "artifacts");
      const zipPath = path.join(artifactsDir, "release.zip");
      return {
        version: { artifacts: { zipPath } },
        artifactsDir,
      };
    }
  }
  return undefined;
}

// ── Additional exports required by API routes ──────────────────────────────

export function getVersionProjectDir(projectId: string, versionId: string): string {
  const base = process.env.TFA_WORKSPACE_ROOT ?? "/tmp/tfa-studio-data";
  return `${base}/projects/${projectId}/versions/${versionId}`;
}
