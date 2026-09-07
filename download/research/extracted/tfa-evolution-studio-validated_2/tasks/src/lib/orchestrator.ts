/**
 * TFA Evolution Studio v28 — Orchestrator
 *
 * Coordinates evolution runs with the evolution engine.
 * Thin wrapper for decoupled scheduling.
 */

import type { CycleEvidenceChain } from "@/lib/types";
import { runEvolutionCycle, getActiveRun, subscribeRun } from "@/lib/evolution-engine";

export { runEvolutionCycle, getActiveRun, subscribeRun };
