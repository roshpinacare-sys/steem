/**
 * Trust Ledger (V1) — per-category confidence bond.
 *
 * Maintains a decaying trust score per objective category. Every successful
 * outcome nudges the bond up; every post-merge failure nudges it down,
 * weighted by how confident the agent claimed to be at merge time.
 *
 * Auto-merge eligibility is gated by the current bond level for that
 * category, not a single global threshold.
 */
import { log } from "./logger.js";
import type { Telemetry } from "./telemetry.js";

/**
 * Minimal persistence surface the ledger needs. `RedisState` satisfies this;
 * tests can supply an in-memory fake without depending on the full class.
 */
export interface TrustStateStore {
  getJSON<T>(key: string): Promise<T | null>;
  setJSONWithTTL(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export type TrustCategory =
  | "dependency-bump"
  | "test-addition"
  | "payment-path-fix"
  | "performance-fix"
  | "refactor"
  | "feature"
  | "security-fix"
  | "cosmetic";

export interface TrustBond {
  category: TrustCategory;
  score: number; // 0-100
  outcomes: number;
  successes: number;
  failures: number;
  probation: boolean;
  lastOutcomeAt: string;
}

export interface TrustLedgerSnapshot {
  owner: string;
  repo: string;
  bonds: TrustBond[];
  updatedAt: string;
}

const LEDGER_KEY_PREFIX = "qodo:v24:trust-ledger";
const DEFAULT_BOND = 50;
const PROBATION_THRESHOLD = 40;
const FULL_AUTONOMY_THRESHOLD = 75;
const SUCCESS_DELTA = 5;
const FAILURE_BASE_DELTA = 10;

function ledgerKey(owner: string, repo: string) {
  return `${LEDGER_KEY_PREFIX}:${owner}:${repo}`;
}

/** Map a free-form objective/complexity pair into a trust category. */
export function classifyTrustCategory(objective: string, complexity?: string): TrustCategory {
  const t = objective.toLowerCase();
  // An explicit caller-supplied complexity label wins over keyword scanning.
  if (complexity === "cosmetic") {
    return "cosmetic";
  }
  if (t.includes("cve") || t.includes("security") || t.includes("vulnerability") || complexity === "security") {
    return "security-fix";
  }
  if (t.includes("payment") || t.includes("checkout") || t.includes("billing") || t.includes("stripe")) {
    return "payment-path-fix";
  }
  if (t.includes("performance") || t.includes("slow") || t.includes("latency") || t.includes("p99")) {
    return "performance-fix";
  }
  if ((t.includes("bump") || t.includes("upgrade") || t.includes("update")) && t.includes("dependency")) {
    return "dependency-bump";
  }
  if (t.includes("test") || t.includes("coverage") || t.includes("spec")) {
    return "test-addition";
  }
  if (t.includes("refactor") || complexity === "architecture") {
    return "refactor";
  }
  if (t.includes("typo") || t.includes("comment") || t.includes("style") || complexity === "cosmetic") {
    return "cosmetic";
  }
  return "feature";
}

function ensureBond(snapshot: TrustLedgerSnapshot, category: TrustCategory): TrustBond {
  let bond = snapshot.bonds.find((b) => b.category === category);
  if (!bond) {
    bond = {
      category,
      score: DEFAULT_BOND,
      outcomes: 0,
      successes: 0,
      failures: 0,
      probation: false,
      lastOutcomeAt: new Date().toISOString(),
    };
    snapshot.bonds.push(bond);
  }
  return bond;
}

/** Load the trust ledger for an owner/repo. */
export async function loadTrustLedger(
  owner: string,
  repo: string,
  state: TrustStateStore,
): Promise<TrustLedgerSnapshot> {
  const stored = await state.getJSON<TrustLedgerSnapshot>(ledgerKey(owner, repo));
  if (stored) return stored;
  return {
    owner,
    repo,
    bonds: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Record a single outcome and update the per-category bond. */
export async function recordOutcome(
  owner: string,
  repo: string,
  category: TrustCategory,
  success: boolean,
  claimedConfidence: number,
  state: TrustStateStore,
  telemetry?: Telemetry,
): Promise<TrustBond> {
  const snapshot = await loadTrustLedger(owner, repo, state);
  const bond = ensureBond(snapshot, category);

  const confidenceWeight = Math.min(100, Math.max(0, claimedConfidence)) / 100;
  if (success) {
    bond.score = Math.min(100, bond.score + SUCCESS_DELTA);
    bond.successes++;
  } else {
    // Higher claimed confidence → larger penalty when wrong.
    const penalty = Math.round(FAILURE_BASE_DELTA * (0.5 + confidenceWeight));
    bond.score = Math.max(0, bond.score - penalty);
    bond.failures++;
  }
  bond.outcomes++;
  bond.lastOutcomeAt = new Date().toISOString();

  const wasProbation = bond.probation;
  // Probation is sticky: once entered, it only clears when the bond has
  // re-earned full autonomy — not merely climbed back above the entry bar.
  bond.probation = wasProbation
    ? bond.score < FULL_AUTONOMY_THRESHOLD
    : bond.score < PROBATION_THRESHOLD;
  if (bond.probation && !wasProbation) {
    log.warn("trust-ledger: category entered probation", { owner, repo, category, score: bond.score });
    await telemetry?.decision("trust-ledger", "probation-entered", { owner, repo, category, score: bond.score });
  } else if (!bond.probation && wasProbation && bond.score >= FULL_AUTONOMY_THRESHOLD) {
    await telemetry?.decision("trust-ledger", "full-autonomy-restored", { owner, repo, category, score: bond.score });
  }

  snapshot.updatedAt = new Date().toISOString();
  await state.setJSONWithTTL(ledgerKey(owner, repo), snapshot, 90 * 24 * 60 * 60);
  await telemetry?.decision("trust-ledger", "outcome-recorded", {
    owner,
    repo,
    category,
    success,
    score: bond.score,
    probation: bond.probation,
  });
  return bond;
}

/** Check whether a category currently qualifies for auto-merge. */
export function canAutoMerge(bond: TrustBond | undefined): boolean {
  if (!bond) return false;
  return bond.score >= FULL_AUTONOMY_THRESHOLD && !bond.probation;
}

/** Whether the category is in probation and needs stricter gates / Mentor Mode. */
export function isProbation(bond: TrustBond | undefined): boolean {
  return (bond?.probation ?? false) || (bond?.score ?? DEFAULT_BOND) < PROBATION_THRESHOLD;
}

/** Retrieve a single category bond. */
export async function getBond(
  owner: string,
  repo: string,
  category: TrustCategory,
  state: TrustStateStore,
): Promise<TrustBond> {
  const snapshot = await loadTrustLedger(owner, repo, state);
  return ensureBond(snapshot, category);
}

/**
 * V3: Seed a new repo's trust ledger at a probationary level based on a
 * proven repo's history. The new repo must still earn full trust itself.
 */
export async function seedTrustFromProvenRepo(
  newOwner: string,
  newRepo: string,
  provenOwner: string,
  provenRepo: string,
  state: TrustStateStore,
  telemetry?: Telemetry,
): Promise<void> {
  const proven = await loadTrustLedger(provenOwner, provenRepo, state);
  if (!proven.bonds.length) return;

  const seeded: TrustLedgerSnapshot = {
    owner: newOwner,
    repo: newRepo,
    bonds: proven.bonds.map((b) => ({
      ...b,
      // Start probationary: halve the proven score, cap at full-autonomy - 5
      score: Math.min(FULL_AUTONOMY_THRESHOLD - 5, Math.round(b.score * 0.5)),
      outcomes: 0,
      successes: 0,
      failures: 0,
      probation: true,
      lastOutcomeAt: new Date().toISOString(),
    })),
    updatedAt: new Date().toISOString(),
  };
  await state.setJSONWithTTL(ledgerKey(newOwner, newRepo), seeded, 90 * 24 * 60 * 60);
  await telemetry?.decision("trust-ledger", "seeded-from-proven-repo", {
    newOwner,
    newRepo,
    provenOwner,
    provenRepo,
    categories: seeded.bonds.map((b) => b.category),
  });
}
