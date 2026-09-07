/**
 * TFA Evolution Studio v28 — Portfolio Learning
 *
 * Cross-project learning layer:
 *   - Captures successful architectures and promotes them as reusable recipes
 *   - Tracks recurring failure signatures and suggests mitigations
 *   - Identifies reusable modules eligible for promotion to platform patterns
 *   - Learns from completed cycles and updates portfolio-wide confidence scores
 *
 * All entries are persisted to WORKSPACE_ROOT/portfolio/learning.ndjson
 * so knowledge survives restarts and accumulates across versions.
 */

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { ensureDir, WORKSPACE_ROOT } from "@/lib/paths";
import { getPortfolioSummary } from "./cross-project-engine";

const PORTFOLIO_DIR = path.join(WORKSPACE_ROOT, "portfolio");
const LEARNING_FILE = path.join(PORTFOLIO_DIR, "learning.ndjson");
const RECIPES_FILE = path.join(PORTFOLIO_DIR, "promoted-recipes.json");
const PATTERNS_FILE = path.join(PORTFOLIO_DIR, "platform-patterns.json");

// ── Types ──────────────────────────────────────────────────────────────────

export interface PortfolioLessonEntry {
  id: string;
  capturedAt: string;
  kind: "success" | "failure" | "regression" | "pattern" | "recipe";
  sourceProjectId: string;
  title: string;
  description: string;
  evidence: string[];
  confidence: number; // 0.0–1.0
  timesObserved: number;
  resolvedBy?: string;
  tags: string[];
}

export interface PromotedRecipe {
  id: string;
  name: string;
  targetId: string;
  sourceProjectIds: string[];
  promotedAt: string;
  successRate: number;
  usageCount: number;
  steps: string[];
  tags: string[];
}

export interface PlatformPattern {
  id: string;
  name: string;
  category: "architecture" | "build" | "testing" | "release" | "recovery";
  description: string;
  detectedInProjects: string[];
  confidence: number;
  promotedAt: string;
  exampleSnippet?: string;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function appendLesson(entry: PortfolioLessonEntry): void {
  ensureDir(PORTFOLIO_DIR);
  fs.appendFileSync(LEARNING_FILE, JSON.stringify(entry) + "\n");
}

function loadLessons(): PortfolioLessonEntry[] {
  if (!fs.existsSync(LEARNING_FILE)) return [];
  return fs.readFileSync(LEARNING_FILE, "utf-8")
    .split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as PortfolioLessonEntry; } catch { return null; } })
    .filter((x): x is PortfolioLessonEntry => x !== null);
}

function loadPromotedRecipes(): PromotedRecipe[] {
  if (!fs.existsSync(RECIPES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(RECIPES_FILE, "utf-8")) as PromotedRecipe[]; } catch { return []; }
}

function savePromotedRecipes(recipes: PromotedRecipe[]): void {
  ensureDir(PORTFOLIO_DIR);
  fs.writeFileSync(RECIPES_FILE, JSON.stringify(recipes, null, 2));
}

function loadPlatformPatterns(): PlatformPattern[] {
  if (!fs.existsSync(PATTERNS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PATTERNS_FILE, "utf-8")) as PlatformPattern[]; } catch { return []; }
}

function savePlatformPatterns(patterns: PlatformPattern[]): void {
  ensureDir(PORTFOLIO_DIR);
  fs.writeFileSync(PATTERNS_FILE, JSON.stringify(patterns, null, 2));
}

// ── Lesson capture ─────────────────────────────────────────────────────────

export function captureLesson(
  sourceProjectId: string,
  kind: PortfolioLessonEntry["kind"],
  title: string,
  description: string,
  opts: {
    evidence?: string[];
    confidence?: number;
    tags?: string[];
  } = {}
): PortfolioLessonEntry {
  // Deduplicate by title+kind: increment timesObserved instead of adding duplicate
  const existing = loadLessons().find(
    (l) => l.title === title && l.kind === kind
  );

  if (existing) {
    const updated: PortfolioLessonEntry = {
      ...existing,
      timesObserved: existing.timesObserved + 1,
      confidence: Math.min(1.0, existing.confidence + 0.05),
      sourceProjectId, // most recent project
    };
    appendLesson(updated);
    return updated;
  }

  const entry: PortfolioLessonEntry = {
    id: uuidv4(),
    capturedAt: new Date().toISOString(),
    kind,
    sourceProjectId,
    title,
    description,
    evidence: opts.evidence ?? [],
    confidence: opts.confidence ?? 0.5,
    timesObserved: 1,
    tags: opts.tags ?? [],
  };
  appendLesson(entry);
  return entry;
}

// ── Recipe promotion ────────────────────────────────────────────────────────

export function promoteRecipe(
  name: string,
  targetId: string,
  steps: string[],
  sourceProjectId: string,
  successRate: number,
  tags: string[] = []
): PromotedRecipe {
  const recipes = loadPromotedRecipes();
  const existing = recipes.find((r) => r.name === name && r.targetId === targetId);
  if (existing) {
    existing.usageCount++;
    existing.successRate = (existing.successRate + successRate) / 2;
    if (!existing.sourceProjectIds.includes(sourceProjectId)) {
      existing.sourceProjectIds.push(sourceProjectId);
    }
    savePromotedRecipes(recipes);
    return existing;
  }

  const recipe: PromotedRecipe = {
    id: `prcp_${Date.now()}`,
    name,
    targetId,
    sourceProjectIds: [sourceProjectId],
    promotedAt: new Date().toISOString(),
    successRate,
    usageCount: 1,
    steps,
    tags,
  };
  recipes.push(recipe);
  savePromotedRecipes(recipes);
  return recipe;
}

// ── Pattern promotion ──────────────────────────────────────────────────────

export function promotePlatformPattern(
  name: string,
  category: PlatformPattern["category"],
  description: string,
  detectedInProjectId: string,
  confidence: number,
  exampleSnippet?: string
): PlatformPattern {
  const patterns = loadPlatformPatterns();
  const existing = patterns.find((p) => p.name === name && p.category === category);
  if (existing) {
    if (!existing.detectedInProjects.includes(detectedInProjectId)) {
      existing.detectedInProjects.push(detectedInProjectId);
    }
    existing.confidence = Math.min(1.0, (existing.confidence + confidence) / 2 + 0.05);
    if (exampleSnippet) existing.exampleSnippet = exampleSnippet;
    savePlatformPatterns(patterns);
    return existing;
  }

  const pattern: PlatformPattern = {
    id: `ppat_${Date.now()}`,
    name,
    category,
    description,
    detectedInProjects: [detectedInProjectId],
    confidence,
    promotedAt: new Date().toISOString(),
    exampleSnippet,
  };
  patterns.push(pattern);
  savePlatformPatterns(patterns);
  return pattern;
}

// ── Portfolio digest ────────────────────────────────────────────────────────

export interface PortfolioDigest {
  totalLessons: number;
  successPatterns: PortfolioLessonEntry[];
  failurePatterns: PortfolioLessonEntry[];
  regressions: PortfolioLessonEntry[];
  promotedRecipes: PromotedRecipe[];
  platformPatterns: PlatformPattern[];
  portfolioSummary: ReturnType<typeof getPortfolioSummary>;
  generatedAt: string;
}

export function getPortfolioDigest(): PortfolioDigest {
  const lessons = loadLessons();
  // Deduplicate: keep latest entry per title+kind
  const deduped = new Map<string, PortfolioLessonEntry>();
  for (const l of lessons) {
    deduped.set(`${l.kind}::${l.title}`, l);
  }
  const unique = Array.from(deduped.values());

  return {
    totalLessons: unique.length,
    successPatterns: unique.filter((l) => l.kind === "success" || l.kind === "recipe"),
    failurePatterns: unique.filter((l) => l.kind === "failure"),
    regressions: unique.filter((l) => l.kind === "regression"),
    promotedRecipes: loadPromotedRecipes(),
    platformPatterns: loadPlatformPatterns(),
    portfolioSummary: getPortfolioSummary(),
    generatedAt: new Date().toISOString(),
  };
}

// ── Auto-learn from cycle outcome ─────────────────────────────────────────

export function learnFromCycleOutcome(
  projectId: string,
  success: boolean,
  passRate: number,
  targetId: string,
  durationMs: number,
  lessonsLearned: string[]
): void {
  if (success && passRate >= 0.9) {
    captureLesson(
      projectId,
      "success",
      `High-confidence build: ${targetId}`,
      `Project achieved ${(passRate * 100).toFixed(0)}% pass rate with ${targetId} adapter in ${durationMs}ms.`,
      { confidence: passRate, tags: [targetId, "high-pass-rate"] }
    );
  }

  if (!success && passRate < 0.3) {
    captureLesson(
      projectId,
      "failure",
      `Low-confidence build: ${targetId}`,
      `Project failed with ${(passRate * 100).toFixed(0)}% pass rate using ${targetId} adapter.`,
      { confidence: 1 - passRate, tags: [targetId, "low-pass-rate"] }
    );
  }

  for (const lesson of lessonsLearned) {
    captureLesson(projectId, "pattern", lesson, lesson, {
      confidence: 0.6,
      tags: [targetId],
    });
  }
}
