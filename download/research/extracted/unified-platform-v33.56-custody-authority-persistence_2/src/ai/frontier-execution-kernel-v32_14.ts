import { sha256 } from '../contracts/crypto.js';

export type FrontierReasoningEffortV32_14 = 'standard' | 'high' | 'max';
export type FrontierAgentRoleV32_14 =
  | 'CANONICAL_STATE_KEEPER'
  | 'ARCHITECT'
  | 'IMPLEMENTER'
  | 'ADVERSARY'
  | 'INDEPENDENT_VERIFIER'
  | 'PRODUCT_VALUE_REVIEWER'
  | 'BINARY_ANALYST'
  | 'RELEASE_ENGINEER';
export type FrontierProofClassV32_14 = 'STATIC' | 'EXECUTED' | 'ADVERSARIAL' | 'DIFFERENTIAL' | 'FORMAL' | 'EXTERNAL';
export type FrontierContextClassV32_14 = 'GOVERNANCE' | 'SOURCE' | 'TEST' | 'FAILURE' | 'EVIDENCE' | 'BINARY' | 'PRODUCT';

export interface FrontierTaskV32_14 {
  readonly taskId: string;
  readonly objective: string;
  readonly complexity: number;
  readonly uncertainty: number;
  readonly blastRadius: number;
  readonly novelty: number;
  readonly expectedDurationMinutes: number;
  readonly binaryInputs: boolean;
  readonly externalActions: boolean;
  readonly productionImpact: boolean;
  readonly maximumContextChars: number;
  readonly maximumOutputChars: number;
  readonly maximumCostMicros: number;
  readonly requiredProofClasses: readonly FrontierProofClassV32_14[];
}

export interface FrontierContextCandidateV32_14 {
  readonly contextId: string;
  readonly class: FrontierContextClassV32_14;
  readonly trust: 'TRUSTED' | 'UNTRUSTED';
  readonly content: string;
  readonly relevance: number;
  readonly novelty: number;
  readonly freshness: number;
  readonly evidenceRefs: readonly string[];
}

export interface FrontierContextSelectionV32_14 {
  readonly selected: readonly FrontierContextCandidateV32_14[];
  readonly dropped: readonly { readonly contextId: string; readonly reason: string }[];
  readonly usedChars: number;
  readonly contextDigest: string;
  readonly classCoverage: Readonly<Record<FrontierContextClassV32_14, number>>;
}

export interface FrontierAgentAssignmentV32_14 {
  readonly role: FrontierAgentRoleV32_14;
  readonly mandate: string;
  readonly mayShareImplementation: boolean;
  readonly requiredOutputs: readonly string[];
}

export interface FrontierProofObligationV32_14 {
  readonly obligationId: string;
  readonly statement: string;
  readonly proofClasses: readonly FrontierProofClassV32_14[];
  readonly failClosed: boolean;
}

export interface FrontierExecutionPlanV32_14 {
  readonly schemaVersion: '32.14';
  readonly taskId: string;
  readonly taskDigest: string;
  readonly reasoningEffort: FrontierReasoningEffortV32_14;
  readonly subagentMode: 'single' | 'diverse-team';
  readonly contextStrategy: 'just-in-time-evidence-first';
  readonly assignments: readonly FrontierAgentAssignmentV32_14[];
  readonly stages: readonly string[];
  readonly proofObligations: readonly FrontierProofObligationV32_14[];
  readonly escalationTriggers: readonly string[];
  readonly stopConditions: readonly string[];
  readonly planDigest: string;
}

export interface FrontierClaimV32_14 {
  readonly claimId: string;
  readonly statement: string;
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly proofClass: FrontierProofClassV32_14;
    readonly independentOracle: string;
    readonly passed: boolean;
    readonly artifactDigest: string;
  }[];
}

export interface FrontierClaimVerdictV32_14 {
  readonly claimId: string;
  readonly verdict: 'PROVEN' | 'SUPPORTED' | 'UNPROVEN' | 'REFUTED';
  readonly proofClasses: readonly FrontierProofClassV32_14[];
  readonly independentOracles: number;
  readonly reasons: readonly string[];
  readonly verdictDigest: string;
}

export interface FrontierIterationStateV32_14 {
  readonly iteration: number;
  readonly unresolvedClaims: number;
  readonly mutationSurvivors: number;
  readonly differentialDisagreements: number;
  readonly invariantViolations: number;
  readonly failingTests: number;
  readonly coverageBranchPercent: number;
  readonly coverageBranchThreshold: number;
  readonly externalBlockers: number;
}

export interface FrontierNextActionV32_14 {
  readonly action: 'RECONSTRUCT' | 'FALSIFY' | 'REPAIR' | 'EXPAND_PROOF' | 'PACKAGE' | 'BLOCK';
  readonly priority: number;
  readonly reason: string;
  readonly requiredRole: FrontierAgentRoleV32_14;
}

const CONTEXT_CLASSES: readonly FrontierContextClassV32_14[] = ['GOVERNANCE', 'SOURCE', 'TEST', 'FAILURE', 'EVIDENCE', 'BINARY', 'PRODUCT'];

export function compileFrontierExecutionPlanV32_14(task: FrontierTaskV32_14): FrontierExecutionPlanV32_14 {
  validateTask(task);
  const risk = Math.max(task.complexity, task.uncertainty, task.blastRadius, task.novelty);
  const reasoningEffort: FrontierReasoningEffortV32_14 = risk >= 0.75 || task.productionImpact ? 'max' : risk >= 0.45 ? 'high' : 'standard';
  const roles: FrontierAgentRoleV32_14[] = ['CANONICAL_STATE_KEEPER', 'ARCHITECT', 'IMPLEMENTER', 'ADVERSARY', 'INDEPENDENT_VERIFIER', 'PRODUCT_VALUE_REVIEWER', 'RELEASE_ENGINEER'];
  if (task.binaryInputs) roles.splice(3, 0, 'BINARY_ANALYST');
  const diverse = reasoningEffort === 'max' || task.requiredProofClasses.includes('DIFFERENTIAL') || task.requiredProofClasses.includes('FORMAL');
  const assignments = roles.map((role) => assignment(role, diverse));
  const required = new Set<FrontierProofClassV32_14>(task.requiredProofClasses);
  required.add('EXECUTED');
  required.add('ADVERSARIAL');
  if (task.productionImpact) required.add('DIFFERENTIAL');
  if (task.blastRadius >= 0.8) required.add('FORMAL');
  const proofObligations: FrontierProofObligationV32_14[] = [
    obligation('no-inherited-pass', 'No inherited report, cache or prior PASS may substitute for current execution.', ['EXECUTED', 'ADVERSARIAL']),
    obligation('claim-evidence-binding', 'Every material claim is bound to current artifacts and at least one causal oracle.', [...required]),
    obligation('false-pass-resistance', 'Controlled replay, substitution, malformed input and weakened-control attempts cannot produce PASS.', ['ADVERSARIAL', ...(required.has('DIFFERENTIAL') ? ['DIFFERENTIAL' as const] : [])]),
    obligation('product-value', 'Implemented complexity produces a measurable user, operator, cost, security or reliability gain.', ['EXECUTED', 'STATIC']),
  ];
  if (task.binaryInputs) proofObligations.push(obligation('binary-lineage', 'Binary bytes, structure, chunks, derived context and decisions share one content-addressed lineage.', ['EXECUTED', 'ADVERSARIAL', 'DIFFERENTIAL']));
  const material = {
    schemaVersion: '32.14' as const,
    taskId: task.taskId,
    taskDigest: sha256(task),
    reasoningEffort,
    subagentMode: diverse ? 'diverse-team' as const : 'single' as const,
    contextStrategy: 'just-in-time-evidence-first' as const,
    assignments,
    stages: [
      'canonical-truth-reconstruction',
      'competitive-gap-model',
      ...(task.binaryInputs ? ['binary-intake-and-structure-proof'] : []),
      'hypothesis-portfolio',
      'adversarial-falsification',
      'implementation',
      'causal-regression-and-mutation',
      'differential-and-formal-assurance',
      'value-and-cost-benchmark',
      'clean-package-reproduction',
      'honest-governance-finalization',
    ],
    proofObligations,
    escalationTriggers: [
      'oracle-disagreement', 'mutation-survivor', 'unexplained-invariant-counterexample', 'binary-parser-ambiguity',
      'trusted-input-drift', 'coverage-threshold-failure', 'external-action-request', 'cost-or-latency-regression',
    ],
    stopConditions: [
      'authoritative-stage-incomplete', 'unresolved-critical-or-high-finding', 'false-pass-demonstrated',
      'package-not-reproduced', 'external-qualification-not-observed',
    ],
  };
  return { ...material, planDigest: sha256(material) };
}

export function compileFrontierContextV32_14(
  task: FrontierTaskV32_14,
  candidates: readonly FrontierContextCandidateV32_14[],
): FrontierContextSelectionV32_14 {
  validateTask(task);
  for (const candidate of candidates) validateContext(candidate);
  const unique = new Map<string, FrontierContextCandidateV32_14>();
  const dropped: { contextId: string; reason: string }[] = [];
  for (const candidate of candidates) {
    const digest = sha256({ class: candidate.class, content: candidate.content });
    const prior = unique.get(digest);
    if (prior === undefined) unique.set(digest, candidate);
    else dropped.push({ contextId: candidate.contextId, reason: `duplicate-of:${prior.contextId}` });
  }
  const requiredClasses = new Set<FrontierContextClassV32_14>(['GOVERNANCE', 'SOURCE', 'FAILURE', 'EVIDENCE', 'PRODUCT']);
  if (task.binaryInputs) requiredClasses.add('BINARY');
  const selected: FrontierContextCandidateV32_14[] = [];
  let usedChars = 0;
  const add = (candidate: FrontierContextCandidateV32_14): boolean => {
    if (selected.some((item) => item.contextId === candidate.contextId)) return true;
    if (usedChars + candidate.content.length > task.maximumContextChars) return false;
    selected.push(candidate);
    usedChars += candidate.content.length;
    return true;
  };
  const rows = [...unique.values()];
  for (const contextClass of requiredClasses) {
    const best = rows.filter((item) => item.class === contextClass && item.trust === 'TRUSTED').sort(compareContext)[0];
    if (best !== undefined && !add(best)) dropped.push({ contextId: best.contextId, reason: 'required-class-budget-exhausted' });
  }
  for (const candidate of rows.sort(compareContext)) {
    if (!add(candidate)) dropped.push({ contextId: candidate.contextId, reason: 'context-budget' });
  }
  const classCoverage = Object.fromEntries(CONTEXT_CLASSES.map((name) => [name, selected.filter((item) => item.class === name).length])) as Record<FrontierContextClassV32_14, number>;
  const selectedIds = new Set(selected.map((item) => item.contextId));
  for (const contextClass of requiredClasses) if (classCoverage[contextClass] === 0) throw new Error(`frontier_context_required_class_missing:${contextClass}`);
  for (const candidate of rows) if (!selectedIds.has(candidate.contextId) && !dropped.some((item) => item.contextId === candidate.contextId)) dropped.push({ contextId: candidate.contextId, reason: 'not-selected' });
  return {
    selected,
    dropped,
    usedChars,
    contextDigest: sha256(selected.map((item) => ({ contextId: item.contextId, class: item.class, trust: item.trust, contentDigest: sha256(item.content), evidenceRefs: item.evidenceRefs }))),
    classCoverage,
  };
}

export function adjudicateFrontierClaimV32_14(claim: FrontierClaimV32_14): FrontierClaimVerdictV32_14 {
  if (claim.claimId.trim() === '' || claim.statement.trim() === '') throw new Error('frontier_claim_invalid');
  if (claim.evidence.some((item) => item.evidenceId.trim() === '' || item.independentOracle.trim() === '' || !/^[a-f0-9]{64}$/.test(item.artifactDigest))) throw new Error('frontier_claim_evidence_invalid');
  const passed = claim.evidence.filter((item) => item.passed);
  const failed = claim.evidence.filter((item) => !item.passed);
  const proofClasses = [...new Set(passed.map((item) => item.proofClass))].sort();
  const independentOracles = new Set(passed.map((item) => item.independentOracle)).size;
  let verdict: FrontierClaimVerdictV32_14['verdict'];
  const reasons: string[] = [];
  if (failed.length > 0) { verdict = 'REFUTED'; reasons.push('at-least-one-bound-oracle-failed'); }
  else if (passed.length === 0) { verdict = 'UNPROVEN'; reasons.push('no-passing-evidence'); }
  else if (proofClasses.includes('EXECUTED') && proofClasses.includes('ADVERSARIAL') && independentOracles >= 2) { verdict = 'PROVEN'; reasons.push('executed-adversarial-independent-proof'); }
  else { verdict = 'SUPPORTED'; reasons.push('evidence-present-but-proof-diversity-incomplete'); }
  const material = { claimId: claim.claimId, verdict, proofClasses, independentOracles, reasons };
  return { ...material, verdictDigest: sha256(material) };
}

export function chooseFrontierNextActionV32_14(state: FrontierIterationStateV32_14): FrontierNextActionV32_14 {
  if (!Number.isSafeInteger(state.iteration) || state.iteration < 0) throw new Error('frontier_iteration_invalid');
  for (const key of ['unresolvedClaims', 'mutationSurvivors', 'differentialDisagreements', 'invariantViolations', 'failingTests', 'externalBlockers'] as const) if (!Number.isSafeInteger(state[key]) || state[key] < 0) throw new Error(`frontier_state_invalid:${key}`);
  if (!Number.isFinite(state.coverageBranchPercent) || !Number.isFinite(state.coverageBranchThreshold)) throw new Error('frontier_coverage_invalid');
  if (state.invariantViolations > 0) return action('REPAIR', 100, 'formal-invariant-violation', 'ARCHITECT');
  if (state.differentialDisagreements > 0) return action('FALSIFY', 95, 'independent-oracle-disagreement', 'INDEPENDENT_VERIFIER');
  if (state.mutationSurvivors > 0) return action('EXPAND_PROOF', 90, 'critical-control-mutation-survived', 'ADVERSARY');
  if (state.failingTests > 0) return action('REPAIR', 85, 'executed-regression-failed', 'IMPLEMENTER');
  if (state.coverageBranchPercent < state.coverageBranchThreshold) return action('EXPAND_PROOF', 80, 'branch-threshold-not-met', 'ADVERSARY');
  if (state.unresolvedClaims > 0) return action('RECONSTRUCT', 70, 'material-claims-unresolved', 'CANONICAL_STATE_KEEPER');
  if (state.externalBlockers > 0) return action('BLOCK', 60, 'external-qualification-required', 'INDEPENDENT_VERIFIER');
  return action('PACKAGE', 50, 'all-local-obligations-satisfied', 'RELEASE_ENGINEER');
}

function assignment(role: FrontierAgentRoleV32_14, diverse: boolean): FrontierAgentAssignmentV32_14 {
  const mandates: Record<FrontierAgentRoleV32_14, string> = {
    CANONICAL_STATE_KEEPER: 'Maintain one current source, policy, artifact and evidence identity; reject stale state.',
    ARCHITECT: 'Find the smallest high-leverage design that satisfies explicit invariants and value goals.',
    IMPLEMENTER: 'Change executable behavior and add causal tests; never weaken acceptance criteria.',
    ADVERSARY: 'Attempt false PASS, replay, substitution, concurrency, parser and economic bypasses.',
    INDEPENDENT_VERIFIER: 'Recompute verdicts from bounded inputs without producing or approving evidence.',
    PRODUCT_VALUE_REVIEWER: 'Prove user and operator value and remove complexity without measurable benefit.',
    BINARY_ANALYST: 'Inspect bytes, structure, nested content, lineage, active behavior and parser ambiguity without execution.',
    RELEASE_ENGINEER: 'Produce clean deterministic artifacts and verify the extracted package independently.',
  };
  return { role, mandate: mandates[role], mayShareImplementation: !diverse || !['ADVERSARY', 'INDEPENDENT_VERIFIER'].includes(role), requiredOutputs: outputs(role) };
}

function outputs(role: FrontierAgentRoleV32_14): readonly string[] {
  return ({
    CANONICAL_STATE_KEEPER: ['truth-ledger', 'identity-tuple'], ARCHITECT: ['design', 'invariants'], IMPLEMENTER: ['code', 'tests'],
    ADVERSARY: ['counterexamples', 'mutation-campaign'], INDEPENDENT_VERIFIER: ['independent-verdict', 'disagreement-corpus'],
    PRODUCT_VALUE_REVIEWER: ['value-benchmark', 'complexity-reduction'], BINARY_ANALYST: ['binary-manifest', 'structure-proof'],
    RELEASE_ENGINEER: ['deterministic-package', 'extracted-verification'],
  } as const)[role];
}

function obligation(obligationId: string, statement: string, proofClasses: readonly FrontierProofClassV32_14[]): FrontierProofObligationV32_14 {
  return { obligationId, statement, proofClasses: [...new Set(proofClasses)].sort(), failClosed: true };
}
function action(actionName: FrontierNextActionV32_14['action'], priority: number, reason: string, requiredRole: FrontierAgentRoleV32_14): FrontierNextActionV32_14 { return { action: actionName, priority, reason, requiredRole }; }
function compareContext(left: FrontierContextCandidateV32_14, right: FrontierContextCandidateV32_14): number {
  const trust = (right.trust === 'TRUSTED' ? 1 : 0) - (left.trust === 'TRUSTED' ? 1 : 0);
  if (trust !== 0) return trust;
  const score = (right.relevance * 0.5 + right.novelty * 0.25 + right.freshness * 0.25) - (left.relevance * 0.5 + left.novelty * 0.25 + left.freshness * 0.25);
  return score !== 0 ? score : left.contextId.localeCompare(right.contextId);
}
function validateTask(task: FrontierTaskV32_14): void {
  if (task.taskId.trim() === '' || task.objective.trim() === '') throw new Error('frontier_task_identity_invalid');
  for (const key of ['complexity', 'uncertainty', 'blastRadius', 'novelty'] as const) validateRatio(task[key], `frontier_task_${key}_invalid`);
  for (const key of ['expectedDurationMinutes', 'maximumContextChars', 'maximumOutputChars', 'maximumCostMicros'] as const) if (!Number.isSafeInteger(task[key]) || task[key] < 1) throw new Error(`frontier_task_${key}_invalid`);
  if (task.requiredProofClasses.length === 0 || new Set(task.requiredProofClasses).size !== task.requiredProofClasses.length) throw new Error('frontier_task_proof_classes_invalid');
}
function validateContext(candidate: FrontierContextCandidateV32_14): void {
  if (candidate.contextId.trim() === '' || candidate.content.length === 0) throw new Error('frontier_context_invalid');
  for (const key of ['relevance', 'novelty', 'freshness'] as const) validateRatio(candidate[key], `frontier_context_${key}_invalid`);
  if (candidate.evidenceRefs.some((item) => item.trim() === '')) throw new Error('frontier_context_evidence_invalid');
}
function validateRatio(value: number, code: string): void { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(code); }
