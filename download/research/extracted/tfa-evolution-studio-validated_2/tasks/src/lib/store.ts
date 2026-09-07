/**
 * TFA Evolution Studio v28 — Canonical Store
 *
 * Simple JSON-file persistence for project registry and versions.
 * Thread-safe within Node.js single-threaded event loop.
 */

import fs from "fs";
import path from "path";
import { REGISTRY_FILE, ensureDir } from "./paths";
import type { Project, VersionedProject } from "./types";

interface Registry {
  projects: Project[];
  versions: VersionedProject[];
  updatedAt: string;
}

function loadRegistry(): Registry {
  if (!fs.existsSync(REGISTRY_FILE)) {
    return { projects: [], versions: [], updatedAt: new Date().toISOString() };
  }
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8")) as Registry;
  } catch {
    return { projects: [], versions: [], updatedAt: new Date().toISOString() };
  }
}

function saveRegistry(registry: Registry): void {
  ensureDir(path.dirname(REGISTRY_FILE));
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// ── Projects ───────────────────────────────────────────────────────────────

export function listProjects(): Project[] {
  return loadRegistry().projects;
}

export function getProject(projectId: string): Project | undefined {
  return loadRegistry().projects.find((p) => p.id === projectId);
}

export function createProject(project: Omit<Project, "id" | "createdAt" | "updatedAt">): Project {
  const registry = loadRegistry();
  const newProject: Project = {
    ...project,
    id: `proj_${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  registry.projects.push(newProject);
  registry.updatedAt = new Date().toISOString();
  saveRegistry(registry);
  return newProject;
}

export function updateProject(projectId: string, updates: Partial<Project>): Project | undefined {
  const registry = loadRegistry();
  const idx = registry.projects.findIndex((p) => p.id === projectId);
  if (idx === -1) return undefined;
  registry.projects[idx] = { ...registry.projects[idx], ...updates, updatedAt: new Date().toISOString() };
  registry.updatedAt = new Date().toISOString();
  saveRegistry(registry);
  return registry.projects[idx];
}

// ── Versions ───────────────────────────────────────────────────────────────

export function listVersions(projectId?: string): VersionedProject[] {
  const versions = loadRegistry().versions;
  return projectId ? versions.filter((v) => v.projectId === projectId) : versions;
}

export function getVersion(versionId: string): VersionedProject | undefined {
  return loadRegistry().versions.find((v) => v.versionId === versionId);
}

export function createVersion(version: Omit<VersionedProject, "versionId" | "createdAt">): VersionedProject {
  const registry = loadRegistry();
  const newVersion: VersionedProject = {
    ...version,
    versionId: `ver_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  registry.versions.push(newVersion);
  registry.updatedAt = new Date().toISOString();
  saveRegistry(registry);
  return newVersion;
}

export function getVersionArtifactsDir(versionId: string): string | undefined {
  const version = getVersion(versionId);
  if (!version?.artifacts) return undefined;
  return path.dirname(version.artifacts.zipPath);
}

export function loadState(): { projects: Project[]; versions: VersionedProject[] } {
  const r = loadRegistry();
  return { projects: r.projects, versions: r.versions };
}
