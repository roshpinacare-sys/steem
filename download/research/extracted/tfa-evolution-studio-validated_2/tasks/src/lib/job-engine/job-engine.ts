/**
 * TFA Evolution Studio v28 — Job Engine
 *
 * Lightweight job tracking with evidence collection,
 * used by the compiler and evolution pipelines.
 */

import { v4 as uuidv4 } from "uuid";
import type { CompilerJob, EvidenceNode } from "@/lib/types";

const jobs = new Map<string, CompilerJob>();

export function createJob(projectId: string, targetId?: string): CompilerJob {
  const job: CompilerJob = {
    id: uuidv4(),
    projectId,
    status: "queued",
    progress: 0,
    createdAt: new Date().toISOString(),
    targetId,
    logs: [],
    evidence: [],
    retryCount: 0,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(jobId: string): CompilerJob | undefined {
  return jobs.get(jobId);
}

export function listJobs(projectId?: string): CompilerJob[] {
  const all = Array.from(jobs.values());
  return projectId ? all.filter((j) => j.projectId === projectId) : all;
}

export function updateJobStatus(
  jobId: string,
  status: CompilerJob["status"],
  updates?: Partial<CompilerJob>
): CompilerJob | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  const updated = { ...job, status, ...updates };
  if (status === "completed" || status === "failed" || status === "cancelled") {
    updated.completedAt = new Date().toISOString();
  }
  jobs.set(jobId, updated);
  return updated;
}

export function appendJobEvidence(jobId: string, node: EvidenceNode): CompilerJob | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  job.evidence.push(node);
  return job;
}

export function appendJobLog(jobId: string, message: string): CompilerJob | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  job.logs.push(`[${new Date().toISOString()}] ${message}`);
  return job;
}

export function deleteJob(jobId: string): boolean {
  return jobs.delete(jobId);
}

// ── Additional exports required by API routes ──────────────────────────────

export function enqueueJob(projectId: string, targetId?: string): CompilerJob {
  return createJob(projectId, targetId);
}

export function loadJobEngine(): CompilerJob[] {
  return listJobs();
}

export function recoverStaleLeases(thresholdMs = 60_000): CompilerJob[] {
  const cutoff = new Date(Date.now() - thresholdMs).toISOString();
  return listJobs().filter(
    (j) => j.status === "running" && j.startedAt && j.startedAt < cutoff
  );
}

export function markJobRunning(jobId: string): CompilerJob | undefined {
  return updateJobStatus(jobId, "running", { startedAt: new Date().toISOString() });
}

export type JobProgress = number;
export type JobKind = "compile" | "analyze" | "evolve" | "batch" | "distill" | "generic";

export function updateJobProgress(jobId: string, progress: number): CompilerJob | undefined {
  return updateJobStatus(jobId, "running", { progress } as Partial<CompilerJob>);
}

export function workerHeartbeat(jobId: string): CompilerJob | undefined {
  return updateJobStatus(jobId, "running", { lastHeartbeatAt: new Date().toISOString() } as Partial<CompilerJob>);
}

export function completeJob(jobId: string, outputPath?: string): CompilerJob | undefined {
  return updateJobStatus(jobId, "completed", { outputPath, completedAt: new Date().toISOString() } as Partial<CompilerJob>);
}

export function failJob(jobId: string, error: string): CompilerJob | undefined {
  return updateJobStatus(jobId, "failed", { error } as Partial<CompilerJob>);
}

export function requestJobCancellation(jobId: string): CompilerJob | undefined {
  return updateJobStatus(jobId, "cancelled");
}
