import { createHash } from "node:crypto";
import type { Memory, MemorySensitivity } from "@/lib/db/schema";

export interface MemoryScoreWeights {
  semanticRelevance: number;
  taskRelevance: number;
  authority: number;
  recency: number;
  confidence: number;
  contradictionRisk: number;
  staleness: number;
  privacyRisk: number;
}

export const DEFAULT_MEMORY_WEIGHTS: MemoryScoreWeights = {
  semanticRelevance: 0.34,
  taskRelevance: 0.16,
  authority: 0.14,
  recency: 0.1,
  confidence: 0.14,
  contradictionRisk: 0.18,
  staleness: 0.1,
  privacyRisk: 0.18,
};

export interface ScoredMemory {
  memory: Memory;
  score: number;
  estimatedTokens: number;
  reasons: {
    semanticRelevance: number;
    taskRelevance: number;
    authority: number;
    recency: number;
    confidence: number;
    contradictionRisk: number;
    staleness: number;
    privacyRisk: number;
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function terms(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase("en")
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 2),
  );
}

function overlap(query: Set<string>, content: Set<string>): number {
  if (query.size === 0 || content.size === 0) return 0;
  let matches = 0;
  for (const term of query) if (content.has(term)) matches += 1;
  return matches / query.size;
}

function sensitivityRisk(sensitivity: MemorySensitivity): number {
  if (sensitivity === "restricted") return 1;
  if (sensitivity === "internal") return 0.3;
  return 0;
}

export function hashMemoryContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function scoreMemory(
  memory: Memory,
  query: string,
  taskTags: string[] = [],
  now = new Date(),
  weights: MemoryScoreWeights = DEFAULT_MEMORY_WEIGHTS,
): ScoredMemory {
  const queryTerms = terms(query);
  const contentTerms = terms(`${memory.content} ${memory.tags.join(" ")}`);
  const semanticRelevance = overlap(queryTerms, contentTerms);
  const requestedTags = new Set(taskTags.map((tag) => tag.toLocaleLowerCase("en")));
  const memoryTags = new Set(memory.tags.map((tag) => tag.toLocaleLowerCase("en")));
  const taskRelevance = requestedTags.size === 0 ? 0 : overlap(requestedTags, memoryTags);
  const ageDays = Math.max(0, (now.getTime() - memory.updatedAt.getTime()) / 86_400_000);
  const recency = Math.exp(-ageDays / 90);
  const staleness = 1 - recency;
  const privacyRisk = sensitivityRisk(memory.sensitivity);
  const reasons = {
    semanticRelevance: clamp(semanticRelevance),
    taskRelevance: clamp(taskRelevance),
    authority: clamp(memory.authority),
    recency: clamp(recency),
    confidence: clamp(memory.confidence),
    contradictionRisk: clamp(memory.contradictionRisk),
    staleness: clamp(staleness),
    privacyRisk,
  };
  const score =
    weights.semanticRelevance * reasons.semanticRelevance +
    weights.taskRelevance * reasons.taskRelevance +
    weights.authority * reasons.authority +
    weights.recency * reasons.recency +
    weights.confidence * reasons.confidence -
    weights.contradictionRisk * reasons.contradictionRisk -
    weights.staleness * reasons.staleness -
    weights.privacyRisk * reasons.privacyRisk;
  return {
    memory,
    score,
    estimatedTokens: Math.max(1, Math.ceil(memory.content.length / 4)),
    reasons,
  };
}

export function selectMemoriesWithinBudget(
  candidates: Memory[],
  options: {
    query: string;
    taskTags?: string[];
    maxTokens: number;
    includeRestricted?: boolean;
    now?: Date;
    weights?: MemoryScoreWeights;
  },
): ScoredMemory[] {
  const now = options.now ?? new Date();
  const eligible = candidates.filter(
    (memory) =>
      memory.status === "active" &&
      (!memory.expiresAt || memory.expiresAt.getTime() > now.getTime()) &&
      (options.includeRestricted || memory.sensitivity !== "restricted"),
  );
  const ranked = eligible
    .map((memory) =>
      scoreMemory(
        memory,
        options.query,
        options.taskTags,
        now,
        options.weights,
      ),
    )
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.updatedAt.getTime() - a.memory.updatedAt.getTime());

  const selected: ScoredMemory[] = [];
  let used = 0;
  for (const item of ranked) {
    if (used + item.estimatedTokens > options.maxTokens) continue;
    selected.push(item);
    used += item.estimatedTokens;
  }
  return selected;
}
