/**
 * TFA Evolution Studio v28 — Outcome Tracker
 *
 * Records cycle outcomes per project and generates
 * cross-project summary statistics.
 *
 * V24 fix: recordOutcome() previously appended outcomes with no downstream
 * effect — the learning pipeline was never triggered. Now recordOutcome()
 * automatically triggers applyLearningToBacklog() so every recorded outcome
 * feeds prioritization and taxonomy-based backlog generation immediately.
 */

import fs from "fs";
import path from "path";
import { getProjectOutcomesDir, ensureDir, getProjectDir } from "@/lib/paths";
import { applyLearningToBacklog } from "@/lib/learning/learning-engine";
import type { Outcome } from "@/lib/types";

function getOutcomesFile(projectId: string): string {
  return path.join(getProjectOutcomesDir(projectId), "outcomes.ndjson");
}

function loadOutcomes(projectId: string): Outcome[] {
  const filePath = getOutcomesFile(projectId);
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as Outcome);
}

function appendOutcome(projectId: string, outcome: Outcome): void {
  const filePath = getOutcomesFile(projectId);
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(outcome) + "\n");
}

export function recordOutcome(projectId: string, outcome: Omit<Outcome, "createdAt">): Outcome {
  const full: Outcome = { ...outcome, createdAt: new Date().toISOString() };
  appendOutcome(projectId, full);
    // so prioritization and taxonomy items are updated in the same cycle.
  // Errors are swallowed so a promotion failure never blocks outcome recording.
  try {
    applyLearningToBacklog(projectId);
  } catch {
    // best-effort — promotion failure must not corrupt outcome storage
  }
  return full;
}

export function getProjectOutcomes(projectId: string, limit = 100): Outcome[] {
  return loadOutcomes(projectId).slice(-limit);
}

export function getOutcomeSummary(projectId: string): {
  totalRuns: number;
  successRate: number;
  avgPassRate: number;
  avgDurationMs: number;
} {
  const outcomes = loadOutcomes(projectId);
  if (outcomes.length === 0) {
    return { totalRuns: 0, successRate: 0, avgPassRate: 0, avgDurationMs: 0 };
  }
  const successes = outcomes.filter((o) => o.success).length;
  return {
    totalRuns: outcomes.length,
    successRate: successes / outcomes.length,
    avgPassRate: outcomes.reduce((sum, o) => sum + o.passRate, 0) / outcomes.length,
    avgDurationMs: outcomes.reduce((sum, o) => sum + o.durationMs, 0) / outcomes.length,
  };
}

export function getCrossProjectOutcomes(): { projectId: string; summary: ReturnType<typeof getOutcomeSummary> }[] {
  const root = getProjectDir("").replace(/\/projects\/\/?$/, "/projects");
  if (!fs.existsSync(root)) return [];
  const results: { projectId: string; summary: ReturnType<typeof getOutcomeSummary> }[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      results.push({ projectId: entry.name, summary: getOutcomeSummary(entry.name) });
    }
  }
  return results;
}
