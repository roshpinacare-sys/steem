/**
 * Prompt Registry — versioned storage for all LLM prompts.
 * Supports A/B testing, rollback, and performance tracking per version.
 * Persists to .prompt-registry.json in workspace root.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { log as logger } from './logger.js';

const REGISTRY_FILE = '.prompt-registry.json';

export interface PromptVersion {
  id: string;
  promptKey: string;
  version: number;
  template: string;
  createdAt: string;
  isActive: boolean;
  stats: {
    runs: number;
    successRate: number;
    avgConfidence: number;
    avgLatencyMs: number;
  };
}

export type PromptRegistry = Record<string, PromptVersion[]>;

function load(root: string): PromptRegistry {
  const p = resolve(root, REGISTRY_FILE);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PromptRegistry;
  } catch {
    // File is corrupt (e.g. partial write on abrupt termination).
    // Return empty registry so all callers (registerPrompt, getActivePrompt,
    // recordPromptResult, rollbackPrompt) can continue rather than crashing.
    logger.warn('Prompt registry: file is malformed JSON; starting fresh', { path: p });
    return {};
  }
}

function save(root: string, registry: PromptRegistry): void {
  writeFileSync(resolve(root, REGISTRY_FILE), JSON.stringify(registry, null, 2));
}

export function registerPrompt(root: string, promptKey: string, template: string): PromptVersion {
  const registry = load(root);
  const versions = registry[promptKey] ?? [];
  const nextVersion = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) + 1 : 1;

  // Deactivate current active version
  versions.forEach((v) => { v.isActive = false; });

  const newVersion: PromptVersion = {
    id: `${promptKey}-v${nextVersion}`,
    promptKey,
    version: nextVersion,
    template,
    createdAt: new Date().toISOString(),
    isActive: true,
    stats: { runs: 0, successRate: 0, avgConfidence: 0, avgLatencyMs: 0 },
  };

  versions.push(newVersion);
  registry[promptKey] = versions;
  save(root, registry);
  logger.info('Prompt version registered', { id: newVersion.id });
  return newVersion;
}

export function getActivePrompt(root: string, promptKey: string): PromptVersion | null {
  const registry = load(root);
  const versions = registry[promptKey] ?? [];
  return versions.find((v) => v.isActive) ?? null;
}

export function rollbackPrompt(root: string, promptKey: string): PromptVersion | null {
  const registry = load(root);
  const versions = registry[promptKey] ?? [];
  if (versions.length < 2) {
    logger.warn('No previous version to roll back to', { promptKey });
    return null;
  }
  // Roll back FROM the currently active version, not blindly from the
  // highest one — otherwise successive rollbacks cannot stack (v3 → v2 → v1).
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const activeIdx = sorted.findIndex((v) => v.isActive);
  const currentIdx = activeIdx === -1 ? 0 : activeIdx;
  const target = sorted[currentIdx + 1];
  if (!target) {
    logger.warn('No previous version to roll back to', { promptKey });
    return null;
  }
  sorted[currentIdx].isActive = false;
  target.isActive = true;
  registry[promptKey] = versions;
  save(root, registry);
  logger.info('Prompt rolled back', { id: target.id });
  return target;
}

export function recordPromptResult(
  root: string,
  promptKey: string,
  success: boolean,
  confidence: number,
  latencyMs: number,
): void {
  const registry = load(root);
  const versions = registry[promptKey] ?? [];
  const active = versions.find((v) => v.isActive);
  if (!active) return;

  const s = active.stats;
  const newRuns = s.runs + 1;
  s.successRate = (s.successRate * s.runs + (success ? 1 : 0)) / newRuns;
  s.avgConfidence = (s.avgConfidence * s.runs + confidence) / newRuns;
  s.avgLatencyMs = (s.avgLatencyMs * s.runs + latencyMs) / newRuns;
  s.runs = newRuns;

  // Auto-rollback if success rate drops below 70% after 5+ runs
  if (newRuns >= 5 && s.successRate < 0.7) {
    logger.warn('Auto-rollback triggered', { id: active.id, successRate: s.successRate });
    registry[promptKey] = versions; // save stats first
    save(root, registry);
    rollbackPrompt(root, promptKey);
    return;
  }

  save(root, registry);
}
