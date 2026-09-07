/**
 * TFA Evolution Studio v28 — Recipe Store & Distillation
 *
 * Captures reusable recipes, failure patterns, recovery patterns,
 * and adapter lessons learned across compilation jobs.
 */

import fs from "fs";
import path from "path";
import { getRecipesDir, ensureDir } from "@/lib/paths";
import type { Recipe, FailurePattern, RecoveryPattern, AdapterLesson, DistillationReport } from "@/lib/types";

const RECIPES_FILE = path.join(getRecipesDir(), "recipes.json");
const PATTERNS_FILE = path.join(getRecipesDir(), "patterns.json");

interface PatternStore {
  failures: FailurePattern[];
  recoveries: RecoveryPattern[];
  lessons: AdapterLesson[];
}

function loadRecipes(): Recipe[] {
  if (!fs.existsSync(RECIPES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(RECIPES_FILE, "utf-8")) as Recipe[];
  } catch {
    return [];
  }
}

function saveRecipes(recipes: Recipe[]): void {
  ensureDir(path.dirname(RECIPES_FILE));
  fs.writeFileSync(RECIPES_FILE, JSON.stringify(recipes, null, 2));
}

function loadPatterns(): PatternStore {
  if (!fs.existsSync(PATTERNS_FILE)) return { failures: [], recoveries: [], lessons: [] };
  try {
    return JSON.parse(fs.readFileSync(PATTERNS_FILE, "utf-8")) as PatternStore;
  } catch {
    return { failures: [], recoveries: [], lessons: [] };
  }
}

function savePatterns(patterns: PatternStore): void {
  ensureDir(path.dirname(PATTERNS_FILE));
  fs.writeFileSync(PATTERNS_FILE, JSON.stringify(patterns, null, 2));
}

// ── Recipes ────────────────────────────────────────────────────────────────

export function listRecipes(): { recipes: Recipe[]; totalJobsLearned: number; updatedAt: string } {
  const recipes = loadRecipes();
  return {
    recipes,
    totalJobsLearned: recipes.reduce((sum, r) => sum + r.usageCount, 0),
    updatedAt: fs.existsSync(RECIPES_FILE)
      ? fs.statSync(RECIPES_FILE).mtime.toISOString()
      : new Date().toISOString(),
  };
}

export function saveRecipe(recipe: Omit<Recipe, "id" | "createdAt">): Recipe {
  const recipes = loadRecipes();
  const newRecipe: Recipe = {
    ...recipe,
    id: `rcp_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  recipes.push(newRecipe);
  saveRecipes(recipes);
  return newRecipe;
}

// ── Patterns ─────────────────────────────────────────────────────────────

export function saveFailurePattern(pattern: Omit<FailurePattern, "id">): FailurePattern {
  const store = loadPatterns();
  const existing = store.failures.find(
    (f) => f.targetId === pattern.targetId && f.symptom === pattern.symptom
  );
  if (existing) {
    existing.count++;
    savePatterns(store);
    return existing;
  }
  const newPattern: FailurePattern = { ...pattern, id: `fp_${Date.now()}` };
  store.failures.push(newPattern);
  savePatterns(store);
  return newPattern;
}

export function saveRecoveryPattern(pattern: Omit<RecoveryPattern, "id">): RecoveryPattern {
  const store = loadPatterns();
  const existing = store.recoveries.find(
    (r) => r.targetId === pattern.targetId && r.failureSymptom === pattern.failureSymptom
  );
  if (existing) {
    existing.successCount++;
    savePatterns(store);
    return existing;
  }
  const newPattern: RecoveryPattern = { ...pattern, id: `rp_${Date.now()}` };
  store.recoveries.push(newPattern);
  savePatterns(store);
  return newPattern;
}

export function saveAdapterLesson(lesson: Omit<AdapterLesson, "id">): AdapterLesson {
  const store = loadPatterns();
  const existing = store.lessons.find(
    (l) => l.targetId === lesson.targetId && l.lesson === lesson.lesson
  );
  if (existing) {
    existing.count++;
    existing.context = lesson.context;
    savePatterns(store);
    return existing;
  }
  const newLesson: AdapterLesson = { ...lesson, id: `al_${Date.now()}` };
  store.lessons.push(newLesson);
  savePatterns(store);
  return newLesson;
}

// ── Distillation Report ────────────────────────────────────────────────────

export function getDistillationReport(): DistillationReport {
  const recipes = loadRecipes();
  const patterns = loadPatterns();
  return {
    totalRecipes: recipes.length,
    totalFailures: patterns.failures.length,
    totalRecoveries: patterns.recoveries.length,
    totalLessons: patterns.lessons.length,
    topFailurePatterns: patterns.failures.sort((a, b) => b.count - a.count).slice(0, 10),
    topRecoveryPatterns: patterns.recoveries.sort((a, b) => b.successCount - a.successCount).slice(0, 10),
  };
}
