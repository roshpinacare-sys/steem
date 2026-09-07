/**
 * TFA Evolution Studio v28 — Learning Engine
 *
 * Captures, scores, and resolves lessons from project cycles.
 * Links lessons to backlog items for continuous improvement.
 *
 * V24 fix: runLearningAnalysis() previously returned a read-only report with
 * no downstream effect — learning was a placebo. Now it calls
 * applyLearningToBacklog() which wires top patterns into backlog prioritization
 * via the pattern-promoter's applyPromotedPatternsToPrioritization() and
 * generates tracked work items for recurring failure modes via backlogFromTaxonomy().
 */

import fs from "fs";
import path from "path";
import { getProjectLearningDir, ensureDir } from "@/lib/paths";
import {
  applyPromotedPatternsToPrioritization,
  backlogFromTaxonomy,
} from "@/lib/control-plane/backlog-engine";
import type { Lesson } from "@/lib/types";

function getLearningFile(projectId: string): string {
  return path.join(getProjectLearningDir(projectId), "learning.json");
}

function loadLessons(projectId: string): Lesson[] {
  const filePath = getLearningFile(projectId);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Lesson[];
  } catch {
    return [];
  }
}

function saveLessons(projectId: string, lessons: Lesson[]): void {
  const filePath = getLearningFile(projectId);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(lessons, null, 2));
}

export function getLessons(projectId: string, category?: Lesson["category"]): Lesson[] {
  const lessons = loadLessons(projectId);
  return category ? lessons.filter((l) => l.category === category) : lessons;
}

export function recordLesson(
  projectId: string,
  lesson: Omit<Lesson, "id" | "projectId" | "occurrences" | "resolved" | "createdAt" | "updatedAt">
): Lesson {
  const lessons = loadLessons(projectId);
  const existing = lessons.find(
    (l) => l.title === lesson.title && l.category === lesson.category
  );
  if (existing) {
    existing.occurrences++;
    existing.updatedAt = new Date().toISOString();
    existing.description = lesson.description;
    saveLessons(projectId, lessons);
    return existing;
  }
  const newLesson: Lesson = {
    ...lesson,
    projectId,
    id: `lss_${Date.now()}`,
    occurrences: 1,
    resolved: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  lessons.push(newLesson);
  saveLessons(projectId, lessons);
  return newLesson;
}

export function resolveLesson(projectId: string, lessonId: string): Lesson | undefined {
  const lessons = loadLessons(projectId);
  const idx = lessons.findIndex((l) => l.id === lessonId);
  if (idx === -1) return undefined;
  lessons[idx] = { ...lessons[idx], resolved: true, updatedAt: new Date().toISOString() };
  saveLessons(projectId, lessons);
  return lessons[idx];
}

export function runLearningAnalysis(projectId: string): {
  totalLessons: number;
  resolvedCount: number;
  topPatterns: { title: string; occurrences: number }[];
  backlogItemsAdjusted: number;
  taxonomyItemsAdded: number;
} {
  const lessons = loadLessons(projectId);
  const resolvedCount = lessons.filter((l) => l.resolved).length;
  const topPatterns = lessons
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 5)
    .map((l) => ({ title: l.title, occurrences: l.occurrences }));

    // actually changes future execution order and surfaces recurring failures
  // as tracked work items — previously this function was read-only.
  const { backlogItemsAdjusted, taxonomyItemsAdded } = applyLearningToBacklog(projectId);

  return { totalLessons: lessons.length, resolvedCount, topPatterns, backlogItemsAdjusted, taxonomyItemsAdded };
}

/**
 * Apply distilled learning outcomes to the backlog:
 *   1. Uplift priorities of backlog items matching high-confidence proven patterns.
 *   2. Generate new backlog items for recurring taxonomy failure modes.
 * Returns counts of what changed so callers can record evidence.
 */
export function applyLearningToBacklog(projectId: string): {
  backlogItemsAdjusted: number;
  taxonomyItemsAdded: number;
} {
  const backlogItemsAdjusted = applyPromotedPatternsToPrioritization();
  const added = backlogFromTaxonomy(projectId);
  return { backlogItemsAdjusted, taxonomyItemsAdded: added.length };
}

// V13 lesson kinds for smoke test contract
export const V13_LESSON_KINDS = [
  "cross_project_pattern",
  "release_quality_issue",
  "agent_performance_trend",
  "dependency_drift",
] as const;
