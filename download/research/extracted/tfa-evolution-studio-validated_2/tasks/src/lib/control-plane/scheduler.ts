/**
 * TFA Evolution Studio v28 — Control Plane Scheduler
 *
 * Priority queue for scheduled jobs with status transitions,
 * cancellation, and backlog linkage.
 */

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { CONTROL_PLANE_FILE, ensureDir } from "@/lib/paths";
import type { ScheduledJob, JobStatus, JobPriority, ScheduledJobKind } from "@/lib/types";

interface ControlPlaneState {
  jobs: ScheduledJob[];
  updatedAt: string;
}

function loadState(): ControlPlaneState {
  if (!fs.existsSync(CONTROL_PLANE_FILE)) {
    return { jobs: [], updatedAt: new Date().toISOString() };
  }
  try {
    return JSON.parse(fs.readFileSync(CONTROL_PLANE_FILE, "utf-8")) as ControlPlaneState;
  } catch {
    return { jobs: [], updatedAt: new Date().toISOString() };
  }
}

function saveState(state: ControlPlaneState): void {
  ensureDir(path.dirname(CONTROL_PLANE_FILE));
  fs.writeFileSync(CONTROL_PLANE_FILE, JSON.stringify(state, null, 2));
}

const PRIORITY_ORDER: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function scheduleJob(
  kind: ScheduledJobKind,
  projectId: string,
  priority: JobPriority = "normal"
): ScheduledJob {
  const state = loadState();
  const job: ScheduledJob = {
    id: uuidv4(),
    kind,
    projectId,
    priority,
    status: "queued",
    scheduledAt: new Date().toISOString(),
  };
  state.jobs.push(job);
  state.updatedAt = new Date().toISOString();
  saveState(state);
  return job;
}

export function listScheduledJobs(projectId?: string): ScheduledJob[] {
  const jobs = loadState().jobs;
  const filtered = projectId ? jobs.filter((j) => j.projectId === projectId) : jobs;
  return filtered.sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );
}

export function getScheduledJob(jobId: string): ScheduledJob | undefined {
  return loadState().jobs.find((j) => j.id === jobId);
}

export function startJob(jobId: string): ScheduledJob | undefined {
  const state = loadState();
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx === -1 || state.jobs[idx].status !== "queued") return undefined;
  state.jobs[idx] = { ...state.jobs[idx], status: "running", startedAt: new Date().toISOString() };
  saveState(state);
  return state.jobs[idx];
}

export function completeJob(jobId: string, result: unknown): ScheduledJob | undefined {
  const state = loadState();
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx === -1 || state.jobs[idx].status !== "running") return undefined;
  state.jobs[idx] = {
    ...state.jobs[idx],
    status: "completed",
    completedAt: new Date().toISOString(),
    result,
  };
  saveState(state);
  return state.jobs[idx];
}

export function failJob(jobId: string, error: string): ScheduledJob | undefined {
  const state = loadState();
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx === -1 || state.jobs[idx].status !== "running") return undefined;
  state.jobs[idx] = {
    ...state.jobs[idx],
    status: "failed",
    completedAt: new Date().toISOString(),
    error,
  };
  saveState(state);
  return state.jobs[idx];
}

export function cancelQueuedJob(jobId: string): boolean {
  const state = loadState();
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx === -1 || state.jobs[idx].status !== "queued") return false;
  state.jobs[idx] = { ...state.jobs[idx], status: "cancelled", completedAt: new Date().toISOString() };
  saveState(state);
  return true;
}

export function getRunningJobs(): ScheduledJob[] {
  return loadState().jobs.filter((j) => j.status === "running");
}

// ── Additional exports required by API routes ──────────────────────────────

export function loadControlPlane() {
  return { jobs: listScheduledJobs(), running: getRunningJobs() };
}

export function setControlPlaneStatus(_status: string): void {
  // status tracking is handled by job lifecycle functions
}

export function enqueueJob(projectId: string, kind: ScheduledJobKind, _payload?: unknown): ScheduledJob {
  return scheduleJob(kind, projectId);
}

export function dequeueNextJob(projectId?: string): ScheduledJob | undefined {
  const pending = listScheduledJobs(projectId).filter((j) => j.status === "queued");
  if (pending.length === 0) return undefined;
  const next = pending.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
  return startJob(next.id);
}
