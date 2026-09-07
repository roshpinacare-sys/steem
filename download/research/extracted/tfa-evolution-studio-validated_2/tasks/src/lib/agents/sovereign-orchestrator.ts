/**
 * TFA Evolution Studio v28 — Sovereign Multi-Agent Orchestrator
 *
 * Coordinates multiple specialised viewpoints over the same project state:
 *
 *   Architect   → proposes structural direction
 *   Builder     → drafts the concrete change set
 *   Critic      → challenges the proposal with explicit objections
 *   Verifier    → tests the proposal against evidence rules
 *   Integrator  → merges the proposal with prior recipes / lessons
 *   ReleaseGov  → enforces release coherence as a hard gate
 *
 * V23 additions over V22:
 *   - `runSovereignBatch()` — runs the sovereign loop over a batch of topics,
 *     returning a per-topic summary and a batch-level synthesis.
 *   - `selectWork()` — uses distilled prioritization hints to choose the
 *     highest-confidence topic from a candidate list.
 *   - Unresolved objections are now converted into explicit `missing_evidence`
 *     requirements rather than being discarded. The loop requests the missing
 *     evidence before proceeding, so disagreement becomes actionable.
 *   - `evidenceFloor` default raised from 2 → 3 for stricter synthesis.
 *   - `SovereignBatchReport` — structured result for batch operations.
 */

import { v4 as uuidv4 } from "uuid";
import type { EvidenceNode } from "@/lib/types";
import type { PrioritizationHint } from "@/lib/distillation/pattern-promoter";

export type SovereignRole =
  | "architect"
  | "builder"
  | "critic"
  | "verifier"
  | "integrator"
  | "release-governor";

export interface SovereignPosition {
  role: SovereignRole;
  stance: "support" | "object" | "amend" | "defer";
  proposal: string;
  reasoning: string;
  evidence: EvidenceNode[];
  evidenceWeight: number;
}

export interface SovereignRound {
  round: number;
  positions: SovereignPosition[];
  synthesis: string;
  unresolvedObjections: string[];
  /** Evidence requirements derived from unresolved objections — must be met next round. */
  requiredEvidenceFromObjections: string[];
}

export type SovereignOutcome =
  | { kind: "synthesised"; finalProposal: string; rounds: SovereignRound[]; evidence: EvidenceNode[] }
  | { kind: "blocked_by_governor"; blockers: string[]; rounds: SovereignRound[] }
  | { kind: "requires_more_evidence"; missing: string[]; rounds: SovereignRound[] };

export interface SovereignInput {
  projectId: string;
  topic: string;
  context?: Record<string, unknown>;
  voices: Partial<Record<SovereignRole, (topic: string, ctx: SovereignDebateContext) => Promise<SovereignPosition | null>>>;
  governor: (proposal: string, evidence: EvidenceNode[]) => Promise<{ allowed: boolean; blockers: string[] }>;
  maxRounds?: number;
  /** Minimum evidence weight before synthesis is accepted. V23 default: 3 (raised from 2). */
  evidenceFloor?: number;
}

export interface SovereignDebateContext {
  projectId: string;
  round: number;
  priorRounds: SovereignRound[];
  /** Evidence requirements from the previous round's unresolved objections. */
  requiredEvidence: string[];
}

export interface SovereignBatchTopic {
  topic: string;
  context?: Record<string, unknown>;
}

export interface SovereignBatchReport {
  totalTopics: number;
  synthesised: number;
  blocked: number;
  requiresEvidence: number;
  results: { topic: string; outcome: SovereignOutcome }[];
  /** A single high-level synthesis paragraph across all synthesised outcomes. */
  batchSynthesis: string;
  evidence: EvidenceNode[];
}

function weighPosition(p: Omit<SovereignPosition, "evidenceWeight">): SovereignPosition {
  const evidenceWeight = p.evidence.reduce((w, n) => w + (n.status === "passed" ? 1 : 0), 0);
  return { ...p, evidenceWeight };
}

function synthesise(positions: SovereignPosition[]): {
  synthesis: string;
  unresolvedObjections: string[];
  requiredEvidenceFromObjections: string[];
  winningEvidence: EvidenceNode[];
} {
  if (positions.length === 0) {
    return {
      synthesis: "",
      unresolvedObjections: ["no_positions_offered"],
      requiredEvidenceFromObjections: ["at_least_one_position_required"],
      winningEvidence: [],
    };
  }

    // the previous sort silently made the first/highest-stance position win with
  // zero backing. Now we detect this and return unresolved objections requiring
  // each role to supply evidence before synthesis proceeds.
  const totalWeight = positions.reduce((s, p) => s + p.evidenceWeight, 0);
  if (totalWeight === 0) {
    return {
      synthesis: "Synthesis blocked: no position carries any evidence weight.",
      unresolvedObjections: positions.map((p) => `${p.role}: no evidence supplied`),
      requiredEvidenceFromObjections: positions.map(
        (p) => `evidence_required_from_${p.role}`
      ),
      winningEvidence: [],
    };
  }

  const stanceRank: Record<SovereignPosition["stance"], number> = {
    amend: 3,
    support: 2,
    object: 1,
    defer: 0,
  };
  const sorted = [...positions].sort((a, b) => {
    if (b.evidenceWeight !== a.evidenceWeight) return b.evidenceWeight - a.evidenceWeight;
    return stanceRank[b.stance] - stanceRank[a.stance];
  });
  const winner = sorted[0];

  // Objections that equal or outweigh the winner are unresolved.
  const unresolvedObjPositions = positions.filter(
    (p) => p.stance === "object" && p.evidenceWeight >= winner.evidenceWeight
  );
  const unresolvedObjections = unresolvedObjPositions.map(
    (p) => `${p.role}: ${p.reasoning}`
  );

  // V23: convert each unresolved objection into an explicit evidence requirement.
  const requiredEvidenceFromObjections = unresolvedObjPositions.map(
    (p) =>
      `evidence_for_objection_by_${p.role}: ${p.reasoning
        .toLowerCase()
        .replace(/\s+/g, "_")
        .slice(0, 60)}`
  );

  const amend = sorted.find(
    (p) => p.stance === "amend" && p.role !== winner.role && p.evidenceWeight > 0
  );
  const synthesis = amend
    ? `${winner.proposal} (amended by ${amend.role}: ${amend.proposal})`
    : winner.proposal;

  const winningEvidence = [...winner.evidence, ...(amend?.evidence ?? [])];
  return { synthesis, unresolvedObjections, requiredEvidenceFromObjections, winningEvidence };
}

export async function runSovereignLoop(input: SovereignInput): Promise<SovereignOutcome> {
  const maxRounds = input.maxRounds ?? 3;
  // V23: raised default floor from 2 → 3 for stricter convergence
  const evidenceFloor = input.evidenceFloor ?? 3;
  const rounds: SovereignRound[] = [];
  let allEvidence: EvidenceNode[] = [];
  let requiredEvidence: string[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    const ctx: SovereignDebateContext = {
      projectId: input.projectId,
      round,
      priorRounds: rounds,
      requiredEvidence,
    };

    const positions: SovereignPosition[] = [];
    for (const role of Object.keys(input.voices) as SovereignRole[]) {
      const voice = input.voices[role];
      if (!voice) continue;
      const raw = await voice(input.topic, ctx);
      if (raw) positions.push(weighPosition(raw));
    }

    const { synthesis, unresolvedObjections, requiredEvidenceFromObjections, winningEvidence } =
      synthesise(positions);

    rounds.push({
      round,
      positions,
      synthesis,
      unresolvedObjections,
      requiredEvidenceFromObjections,
    });
    allEvidence = allEvidence.concat(winningEvidence);
    // Carry forward unresolved evidence requirements to the next round.
    requiredEvidence = requiredEvidenceFromObjections;

    const topWeight = positions.reduce((m, p) => Math.max(m, p.evidenceWeight), 0);
    if (topWeight >= evidenceFloor && unresolvedObjections.length === 0) {
      // WS6: Verify role-specific viewpoints are represented before declaring
      // convergence. Prevents shallow consensus where silent agents are swept
      // through undetected.
      const representedRoles = new Set<string>(
        (synthesis as { viewpoints?: Array<{ role: string }> }).viewpoints?.map(v => v.role) ?? []
      );
      const missingRoles = Object.keys(input.voices).filter(role => !representedRoles.has(role));
      if (missingRoles.length > 0) {
        allEvidence.push({
          kind: "orchestration_phase_completed",
          status: "failed",
          message: `Synthesis blocked: missing viewpoints from roles [${missingRoles.join(", ")}]`,
          timestamp: new Date().toISOString(),
          metadata: {
            missingRoles,
            representedRoles: Array.from(representedRoles),
            recovery: "Ensure all agent roles submit evidence-backed viewpoints before synthesis convergence",
          },
        });
        // Do not converge — continue to next round or exhaust max rounds
      } else {
        const gov = await input.governor(synthesis, allEvidence);
        if (gov.allowed) {
          allEvidence.push({
            kind: "synthesis_loop_converged",
            status: "passed",
            message: `Converged on round ${round} with evidence weight ${topWeight}`,
            timestamp: new Date().toISOString(),
            metadata: { rounds: round, evidenceFloor, topWeight, representedRoles: Array.from(representedRoles) },
          });
          return { kind: "synthesised", finalProposal: synthesis, rounds, evidence: allEvidence };
        }
        return { kind: "blocked_by_governor", blockers: gov.blockers, rounds };
      }
    }
  }

  const last = rounds[rounds.length - 1];
  const missing: string[] = [];
  if (rounds.length === 0) missing.push("no rounds executed");
  if (last?.unresolvedObjections.length) missing.push(...last.unresolvedObjections);
  if (last?.requiredEvidenceFromObjections.length)
    missing.push(...last.requiredEvidenceFromObjections);
  missing.push(`evidence below floor (${evidenceFloor})`);

  return { kind: "requires_more_evidence", missing: [...new Set(missing)], rounds };
}

// ── Batch synthesis ────────────────────────────────────────────────────────

/**
 * Run the sovereign loop over multiple topics and produce a structured
 * batch report with a single cross-topic synthesis paragraph.
 *
 * V24 fix: prior synthesis results are now threaded forward into each
 * subsequent topic's context. Previously `context` from SovereignBatchTopic
 * was passed as-is, but prior round outcomes were discarded — cross-topic
 * learning was lost. Now `priorSyntheses` accumulates as topics complete
 * and is merged into the context supplied to subsequent loops.
 */
export async function runSovereignBatch(
  projectId: string,
  topics: SovereignBatchTopic[],
  voiceFactory: (topic: string) => SovereignInput["voices"],
  governor: SovereignInput["governor"],
  opts: { maxRounds?: number; evidenceFloor?: number } = {}
): Promise<SovereignBatchReport> {
  const results: SovereignBatchReport["results"] = [];
  const allEvidence: EvidenceNode[] = [];
  const priorSyntheses: Record<string, string> = {};

  for (const { topic, context } of topics) {
    const outcome = await runSovereignLoop({
      projectId,
      topic,
      // Merge caller-supplied context with accumulated prior syntheses so
      // each topic can reason over what prior topics resolved.
      context: { ...context, priorSyntheses: { ...priorSyntheses } },
      voices: voiceFactory(topic),
      governor,
      maxRounds: opts.maxRounds,
      evidenceFloor: opts.evidenceFloor,
    });
    results.push({ topic, outcome });
    if (outcome.kind === "synthesised") {
      allEvidence.push(...outcome.evidence);
      priorSyntheses[topic] = outcome.finalProposal;
    }
  }

  const synthesised = results.filter((r) => r.outcome.kind === "synthesised");
  const blocked = results.filter((r) => r.outcome.kind === "blocked_by_governor");
  const needsEvidence = results.filter((r) => r.outcome.kind === "requires_more_evidence");

  const batchSynthesis =
    synthesised.length === 0
      ? "No topics reached synthesis — insufficient evidence across all batch items."
      : `Batch synthesis across ${synthesised.length}/${results.length} topics: ` +
        synthesised
          .map((r) =>
            r.outcome.kind === "synthesised"
              ? `[${r.topic}] ${r.outcome.finalProposal}`
              : ""
          )
          .filter(Boolean)
          .join(" | ");

  allEvidence.push({
    kind: "batch_reconciled",
    status: blocked.length === 0 && needsEvidence.length === 0 ? "passed" : "failed",
    message: `Sovereign batch: ${synthesised.length} synthesised, ${blocked.length} blocked, ${needsEvidence.length} needs evidence`,
    timestamp: new Date().toISOString(),
    metadata: {
      total: results.length,
      synthesised: synthesised.length,
      blocked: blocked.length,
      requiresEvidence: needsEvidence.length,
    },
  });

  return {
    totalTopics: results.length,
    synthesised: synthesised.length,
    blocked: blocked.length,
    requiresEvidence: needsEvidence.length,
    results,
    batchSynthesis,
    evidence: allEvidence,
  };
}

// ── Work selection ─────────────────────────────────────────────────────────

/**
 * Select the highest-confidence topic from a candidate list using
 * distilled prioritization hints. Falls back to the first candidate
 * if no hints match.
 *
 * This is how the orchestration layer chooses WHAT to work on next,
 * not just HOW to execute it.
 */
export function selectWork(
  candidates: string[],
  hints: PrioritizationHint[]
): string {
  if (candidates.length === 0) throw new Error("selectWork: no candidates supplied");
  const hintMap = new Map(hints.map((h) => [h.topic, h.confidenceScore]));
  const ranked = [...candidates].sort((a, b) => {
    const sa = hintMap.get(a) ?? 0;
    const sb = hintMap.get(b) ?? 0;
    return sb - sa;
  });
  return ranked[0];
}

// ── Default voice factories ────────────────────────────────────────────────

export function makeDeterministicVoice(
  role: SovereignRole,
  opts: {
    stance: SovereignPosition["stance"];
    proposal: string;
    reasoning: string;
    evidence?: EvidenceNode[];
  }
) {
  return async (
    _topic: string,
    _ctx: SovereignDebateContext
  ): Promise<SovereignPosition | null> => {
    return weighPosition({
      role,
      stance: opts.stance,
      proposal: opts.proposal,
      reasoning: opts.reasoning,
      evidence: opts.evidence ?? [],
    });
  };
}

export const __sovereignInternals = { weighPosition, synthesise };

// ══════════════════════════════════════════════════════════════════════════════
// WS3 (v30): Multi-Agent Debate V2 — 7-Stage Structured Protocol
//
// Replaces unbounded round-robin discussion with a deterministic, evidence-
// mandated convergence path:
//
//   Stage 1 — Proposal         : Architect + Builder submit initial positions
//   Stage 2 — Critique         : Critic + Verifier challenge with explicit objections
//   Stage 3 — Counter-Proposal : Proposers respond to objections with amendments
//   Stage 4 — Evidence         : All roles submit supporting evidence nodes
//   Stage 5 — Consensus        : Weighted vote requiring evidence-backed agreement
//   Stage 6 — Verification     : Verifier + ReleaseGov sign off with evidence gate
//   Stage 7 — Distillation     : Integrator produces final synthesis + learning summary
// ══════════════════════════════════════════════════════════════════════════════

export type DebateV2StageName =
  | "Proposal"
  | "Critique"
  | "Counter-Proposal"
  | "Evidence"
  | "Consensus"
  | "Verification"
  | "Distillation";

export interface DebateV2StageInput {
  stage: DebateV2StageName;
  topic: string;
  projectId?: string;
  priorPositions: SovereignPosition[];
  evidence: EvidenceNode[];
}

export interface DebateV2StageResult {
  stage: DebateV2StageName;
  positions: SovereignPosition[];
  evidence: EvidenceNode[];
  blockerReason: string | null;
  completedAt: string;
}

export type SovereignVoiceFn = (topic: string, ctx: SovereignDebateContext) => Promise<SovereignPosition | null>;

export interface SynthesisResult {
  synthesis: string;
  viewpoints?: Array<{ role: string; stance: string; reasoning?: string }>;
  evidenceWeight?: number;
  timestamp?: string;
}

export interface DebateV2Config {
  topic: string;
  agents: Array<{ role: SovereignRole; voice: SovereignVoiceFn }>;
  /** Maximum number of rounds to attempt consensus before giving up. Default 1. */
  maxRounds?: number;
  /** Minimum fraction of roles that must have evidence-backed positions. Default 0.5. */
  consensusQuorum?: number;
  evidenceFloor?: number;
}

export interface DebateV2Result {
  topic: string;
  stageResults: DebateV2StageResult[];
  allEvidence: EvidenceNode[];
  dissentingPositions: SovereignPosition[];
  consensusReached: boolean;
  finalSynthesis: SynthesisResult | null;
  verdict:
    | "consensus_reached"
    | "requires_more_evidence"
    | "verification_blocked"
    | "distillation_complete";
  completedAt: string;
}

// ── Stage runner ──────────────────────────────────────────────────────────

async function runDebateStage(
  input: DebateV2StageInput,
  agents: DebateV2Config["agents"]
): Promise<DebateV2StageResult> {
  const stagePositions: SovereignPosition[] = [];
  const stageEvidence: EvidenceNode[] = [...input.evidence];
  const blockerReason: string | null = null;

  for (const agent of agents) {
    try {
      const position = await agent.voice(input.topic, {
        projectId: input.projectId ?? "__batch__",
        round: 0,
        priorRounds: [],
        requiredEvidence: [],
      });
      if (position) {
        stagePositions.push(position);
        stageEvidence.push(...position.evidence);
      }
    } catch {
      // Individual voice failures are non-fatal within a stage
    }
  }

  return {
    stage: input.stage,
    positions: stagePositions,
    evidence: stageEvidence,
    blockerReason,
    completedAt: new Date().toISOString(),
  };
}

// ── Consensus gate ────────────────────────────────────────────────────────

function evaluateConsensus(
  stageResults: DebateV2StageResult[],
  config: DebateV2Config
): { reached: boolean; dissenters: SovereignPosition[] } {
  const quorum = config.consensusQuorum ?? 0.5;
  const evidenceFloor = config.evidenceFloor ?? 1;

  const evidenceStage = stageResults.find((s) => s.stage === "Evidence");
  const allPositions: SovereignPosition[] = stageResults.flatMap((s) => s.positions);

  // Roles that contributed evidence-backed positions in the Evidence stage
  const evidenceBacked = new Set(
    (evidenceStage?.positions ?? [])
      .filter((p) => p.evidence.length >= evidenceFloor)
      .map((p) => p.role)
  );

  const totalRoles = new Set(config.agents.map((a) => a.role)).size;
  const backedRatio = totalRoles > 0 ? evidenceBacked.size / totalRoles : 0;

  const agreePositions = allPositions.filter((p) => p.stance === "support" || p.stance === "amend");
  const dissenters = allPositions.filter((p) => p.stance === "object" || p.stance === "defer");

  const reached = backedRatio >= quorum && agreePositions.length >= dissenters.length;
  return { reached, dissenters };
}

// ── Full Debate V2 pipeline ───────────────────────────────────────────────

/**
 * Run the 7-stage structured Debate V2 protocol.
 * All v29 sovereign loop contracts remain intact — this is additive.
 */
export async function runDebateV2(config: DebateV2Config): Promise<DebateV2Result> {
  const { topic, agents, maxRounds = 1 } = config;
  const stageResults: DebateV2StageResult[] = [];
  const allEvidence: EvidenceNode[] = [];
  let cumulativePositions: SovereignPosition[] = [];

  const stageSequence: DebateV2StageName[] = [
    "Proposal",
    "Critique",
    "Counter-Proposal",
    "Evidence",
    "Consensus",
    "Verification",
    "Distillation",
  ];

  let currentRound = 0;
  let consensusReached = false;
  let dissentingPositions: SovereignPosition[] = [];

  while (currentRound < maxRounds && !consensusReached) {
    for (const stageName of stageSequence) {
      const stageResult = await runDebateStage(
        {
          stage: stageName,
          topic,
          priorPositions: cumulativePositions,
          evidence: allEvidence,
        },
        agents
      );

      stageResults.push(stageResult);
      allEvidence.push(...stageResult.evidence);
      cumulativePositions = [...cumulativePositions, ...stageResult.positions];

      if (stageName === "Consensus") {
        const eval_ = evaluateConsensus(stageResults, config);
        consensusReached = eval_.reached;
        dissentingPositions = eval_.dissenters;

        if (!consensusReached && currentRound + 1 >= maxRounds) {
          // Exhausted rounds — emit blocked evidence and exit
          allEvidence.push({
            kind: "orchestration_phase_completed",
            status: "failed",
            message: `Debate V2 consensus NOT reached after ${maxRounds} round(s) — ${dissentingPositions.length} dissenter(s)`,
            timestamp: new Date().toISOString(),
            metadata: { topic, dissenters: dissentingPositions.map((p) => p.role), round: currentRound },
          });
          return {
            topic,
            stageResults,
            allEvidence,
            dissentingPositions,
            consensusReached: false,
            finalSynthesis: null,
            verdict: "requires_more_evidence",
            completedAt: new Date().toISOString(),
          };
        }
      }

      if (stageName === "Verification") {
        const verifierPositions = stageResult.positions.filter(
          (p) => p.role === "critic" || p.role === "release-governor"
        );
        const blocked = verifierPositions.some((p) => p.stance === "object");
        if (blocked) {
          allEvidence.push({
            kind: "orchestration_phase_completed",
            status: "failed",
            message: "Debate V2 blocked at Verification stage — critic/release-governor rejected",
            timestamp: new Date().toISOString(),
            metadata: { topic, blockedBy: verifierPositions.filter((p) => p.stance === "object").map((p) => p.role) },
          });
          return {
            topic,
            stageResults,
            allEvidence,
            dissentingPositions,
            consensusReached: false,
            finalSynthesis: null,
            verdict: "verification_blocked",
            completedAt: new Date().toISOString(),
          };
        }
      }
    }

    currentRound++;
  }

  // Stage 7: Distillation — produce final synthesis
  const distillationStage = stageResults.find((s) => s.stage === "Distillation");
  const finalSynthesis = synthesise(distillationStage?.positions ?? cumulativePositions);

  allEvidence.push({
    kind: "debate_v2_converged",
    status: "passed",
    message: `Debate V2 complete: ${stageResults.length} stage(s), consensus reached, ${dissentingPositions.length} dissenter(s)`,
    timestamp: new Date().toISOString(),
    metadata: {
      topic,
      rounds: currentRound,
      stages: stageResults.length,
      dissenters: dissentingPositions.length,
      evidenceNodes: allEvidence.length - 1,
      synthesis: finalSynthesis.synthesis,
    },
  });

  return {
    topic,
    stageResults,
    allEvidence,
    dissentingPositions,
    consensusReached: true,
    finalSynthesis,
    verdict: "distillation_complete",
    completedAt: new Date().toISOString(),
  };
}

/** Construct a deterministic voice for Debate V2 testing. */
export function makeDebateV2Voice(
  role: SovereignRole,
  opts: {
    stance: SovereignPosition["stance"];
    proposal: string;
    reasoning: string;
    evidence?: EvidenceNode[];
  }
): DebateV2Config["agents"][number] {
  return { role, voice: makeDeterministicVoice(role, opts) };
}
