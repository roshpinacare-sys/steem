/**
 * PhaseContext — everything a pipeline phase handler needs, threaded
 * explicitly instead of closed over inside a single 800-line function.
 *
 * Mutable coordination fields (`targetFiles`, `generatedPatch`) are written
 * by one phase and read by later ones, exactly as the former closure
 * variables were.
 */
import type { GitHubClient } from "../services/github-client.js";
import type { RedisState } from "../services/redis-state.js";
import type { R2Storage } from "../services/r2-storage.js";
import type { Telemetry } from "../services/telemetry.js";
import type { PrReporter } from "../services/pr-reporter.js";
import type { Logger } from "../services/logger.js";
import type { RunState } from "../types/run-state.js";
import type { validateAndCoerce } from "../services/env-validator.js";
import type { runSupervisor } from "../agents/supervisor.js";
import type { TrustCategory } from "../services/trust-ledger.js";
import type { QodoPolicy } from "../services/policy.js";

export type Env = ReturnType<typeof validateAndCoerce>;
export type SupervisorDecision = Awaited<ReturnType<typeof runSupervisor>>;

/**
 * What a phase handler tells the orchestrator afterwards:
 *  - "continue": fall through to the next phase guard.
 *  - "halt": stop the run cleanly (checkpoint already saved by the phase);
 *    the orchestrator returns without treating it as an error — identical
 *    to the former mid-function `return` statements.
 */
export type PhaseOutcome = "continue" | "halt";

export interface PipelineDeps {
  owner?: string;
  repo?: string;
  objective?: string;
  prNumber?: number;
  prSha?: string;
  skillId?: string;
  gh?: GitHubClient;
  state?: RedisState;
  storage?: R2Storage;
}

export interface PhaseContext {
  s: RunState;
  env: Env;
  deps: PipelineDeps;
  objective: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha: string;
  runId: string;
  runLog: Logger;
  gh: GitHubClient;
  state: RedisState;
  storage: R2Storage;
  telemetry: Telemetry;
  reporter: PrReporter;
  supervisorDecision: SupervisorDecision;
  ledgerCategory: TrustCategory;
  /** Per-repo policy from `.qodo/policy.yml` (default when none present). */
  policy: QodoPolicy;
  /** Files the plan targets; computed after the architect phase. */
  targetFiles: Set<string>;
  /** Set by the coder phase when a fresh (non-cached) patch was generated. */
  generatedPatch: boolean;
}
