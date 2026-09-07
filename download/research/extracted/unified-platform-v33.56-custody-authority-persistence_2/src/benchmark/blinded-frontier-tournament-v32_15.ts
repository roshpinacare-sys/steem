import { sha256, type KeyRegistry, type SignedEnvelope } from '../contracts/crypto.js';

export type TournamentEvidenceClassV32_15 = 'SYNTHETIC' | 'OBSERVED_LOCAL' | 'OBSERVED_EXTERNAL';
export type TournamentVerdictV32_15 = 'INVALID' | 'DRY_RUN_VALID' | 'COMPARISON_VALID' | 'FRONTIER_LEADER_CANDIDATE';
export type TournamentAuthorityClassV32_15 = 'LOCAL_FIXTURE' | 'EXTERNAL_PINNED';

export interface TournamentModelEntryV32_15 {
  readonly entryId: string; readonly providerId: string; readonly modelId: string; readonly modelVersion: string;
  readonly collectorId: string; readonly organizationId: string; readonly evidenceClass: TournamentEvidenceClassV32_15; readonly costMicros: number;
}
export interface TournamentTaskV32_15 {
  readonly taskId: string; readonly promptDigest: string; readonly artifactDigest: string;
  readonly dimensions: readonly { readonly dimensionId: string; readonly weight: number; readonly maximumScore: number }[];
  readonly hiddenGoldChecks: readonly string[];
}
export interface TournamentRunSpecV32_15 {
  readonly schemaVersion: '32.15'; readonly runId: string; readonly sourceDigest: string; readonly corpusDigest: string;
  readonly policyDigest: string; readonly blindSaltDigest: string; readonly evidenceClass: TournamentEvidenceClassV32_15;
  readonly entries: readonly TournamentModelEntryV32_15[]; readonly tasks: readonly TournamentTaskV32_15[];
  readonly minimumIndependentJudges: number; readonly minimumTasks: number; readonly minimumProviders: number; readonly maximumCostMicros: number;
}
export interface TournamentBlindAssignmentV32_15 {
  readonly runId: string; readonly mappingCommitment: string; readonly labels: readonly { readonly entryId: string; readonly blindLabel: string }[];
  readonly judgePackets: readonly { readonly packetId: string; readonly taskId: string; readonly blindLabel: string; readonly promptDigest: string; readonly artifactDigest: string }[];
  readonly assignmentDigest: string;
}
export interface TournamentSubmissionV32_15 {
  readonly runId: string; readonly taskId: string; readonly blindLabel: string; readonly entryId: string;
  readonly outputDigest: string; readonly transcriptDigest: string; readonly startedAt: string; readonly completedAt: string;
  readonly inputTokens: number; readonly outputTokens: number; readonly costMicros: number; readonly evidenceClass: TournamentEvidenceClassV32_15;
}
export interface TournamentJudgeV32_15 {
  readonly judgeId: string; readonly organizationId: string; readonly keyFingerprint: string; readonly calibrated: boolean;
  readonly conflictsWithProviders: readonly string[];
}
export interface TournamentScoreV32_15 {
  readonly runId: string; readonly taskId: string; readonly blindLabel: string; readonly judgeId: string;
  readonly dimensionScores: Readonly<Record<string, number>>; readonly goldChecksPassed: readonly string[];
  readonly rationaleDigest: string; readonly scoredAt: string;
}
export interface TournamentTrustPolicyV32_15 {
  readonly policyDigest: string;
  readonly providerAuthorizations: readonly { readonly entryId: string; readonly keyId: string; readonly keyFingerprint: string; readonly authorityClass: TournamentAuthorityClassV32_15 }[];
  readonly judgeAuthorizations: readonly { readonly judgeId: string; readonly keyId: string; readonly keyFingerprint: string; readonly organizationId: string; readonly authorityClass: TournamentAuthorityClassV32_15 }[];
}
export interface TournamentReportV32_15 {
  readonly schemaVersion: '32.15'; readonly runId: string; readonly verdict: TournamentVerdictV32_15; readonly leaders: readonly string[];
  readonly standings: readonly { readonly entryId: string; readonly blindLabel: string; readonly normalizedScore: number; readonly lowerConfidenceBound: number; readonly upperConfidenceBound: number; readonly tasksScored: number; readonly judges: number; readonly totalCostMicros: number }[];
  readonly findings: readonly string[]; readonly worldBestClaim: 'not-proven'; readonly reportDigest: string;
}

export function createBlindTournamentAssignmentV32_15(spec: TournamentRunSpecV32_15): TournamentBlindAssignmentV32_15 {
  validateSpec(spec);
  const labels = deterministicShuffle(spec.entries.map((entry, index) => ({ entryId: entry.entryId, blindLabel: `MODEL-${String(index + 1).padStart(3, '0')}` })), spec.blindSaltDigest);
  const mappingCommitment = sha256({ runId: spec.runId, blindSaltDigest: spec.blindSaltDigest, labels });
  const judgePackets = spec.tasks.flatMap((task) => labels.map((label) => ({ packetId: sha256({ runId: spec.runId, taskId: task.taskId, blindLabel: label.blindLabel }).slice(0, 24), taskId: task.taskId, blindLabel: label.blindLabel, promptDigest: task.promptDigest, artifactDigest: task.artifactDigest }))).sort((a, b) => a.packetId.localeCompare(b.packetId));
  const material = { runId: spec.runId, mappingCommitment, labels, judgePackets };
  return { ...material, assignmentDigest: sha256(material) };
}

export function evaluateBlindedFrontierTournamentV32_15(options: {
  readonly spec: TournamentRunSpecV32_15; readonly assignment: TournamentBlindAssignmentV32_15;
  readonly submissions: readonly SignedEnvelope<TournamentSubmissionV32_15>[]; readonly judges: readonly TournamentJudgeV32_15[];
  readonly scores: readonly SignedEnvelope<TournamentScoreV32_15>[]; readonly revealedLabels: readonly { readonly entryId: string; readonly blindLabel: string }[];
  readonly registry: KeyRegistry; readonly trustPolicy: TournamentTrustPolicyV32_15; readonly now: Date;
}): TournamentReportV32_15 {
  const { spec, assignment, submissions, judges, scores, revealedLabels, registry, trustPolicy, now } = options;
  validateSpec(spec); validateTrustPolicy(trustPolicy);
  if (!Number.isFinite(now.getTime())) throw new Error('tournament_now_invalid');
  const findings: string[] = [];
  if (trustPolicy.policyDigest !== spec.policyDigest) findings.push('tournament-trust-policy-mismatch');
  const expected = createBlindTournamentAssignmentV32_15(spec);
  if (expected.assignmentDigest !== assignment.assignmentDigest || expected.mappingCommitment !== assignment.mappingCommitment) findings.push('blind-assignment-invalid');
  if (sha256({ runId: spec.runId, blindSaltDigest: spec.blindSaltDigest, labels: revealedLabels }) !== assignment.mappingCommitment) findings.push('blind-reveal-invalid');
  const labelToEntry = new Map(revealedLabels.map((item) => [item.blindLabel, item.entryId]));
  if (labelToEntry.size !== spec.entries.length || new Set(revealedLabels.map((item) => item.entryId)).size !== spec.entries.length) findings.push('blind-reveal-not-bijective');
  const entryById = new Map(spec.entries.map((entry) => [entry.entryId, entry]));
  const taskById = new Map(spec.tasks.map((task) => [task.taskId, task]));
  const allowedLabels = new Set(assignment.labels.map((item) => item.blindLabel));
  const providerAuth = new Map(trustPolicy.providerAuthorizations.map((item) => [item.entryId, item]));
  const judgeAuth = new Map(trustPolicy.judgeAuthorizations.map((item) => [item.judgeId, item]));
  const submissionKeys = new Set<string>(); let observedCost = 0;
  for (const envelope of submissions) {
    const submission = envelope.payload; const key = `${submission.taskId}:${submission.blindLabel}`;
    if (submissionKeys.has(key)) findings.push(`duplicate-submission:${key}`); submissionKeys.add(key);
    const auth = providerAuth.get(submission.entryId);
    if (auth === undefined || auth.keyId !== envelope.issuerKeyId || registry.fingerprint(auth.keyId) !== auth.keyFingerprint || !registry.verifyAt(envelope, submission.completedAt)) findings.push(`submission-signature-invalid:${key}`);
    if (submission.runId !== spec.runId || !taskById.has(submission.taskId) || !allowedLabels.has(submission.blindLabel) || labelToEntry.get(submission.blindLabel) !== submission.entryId) findings.push(`submission-identity-invalid:${key}`);
    if (!digest(submission.outputDigest) || !digest(submission.transcriptDigest)) findings.push(`submission-digest-invalid:${key}`);
    const start = Date.parse(submission.startedAt), end = Date.parse(submission.completedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > now.getTime() + 60_000) findings.push(`submission-time-invalid:${key}`);
    if (![submission.inputTokens, submission.outputTokens, submission.costMicros].every((value) => Number.isSafeInteger(value) && value >= 0)) findings.push(`submission-usage-invalid:${key}`);
    if (submission.evidenceClass !== spec.evidenceClass) findings.push(`submission-evidence-class-mismatch:${key}`);
    observedCost += submission.costMicros;
  }
  if (observedCost > spec.maximumCostMicros) findings.push('tournament-cost-budget-exceeded');
  const providerIds = new Set(spec.entries.map((entry) => entry.providerId));
  const validJudges = judges.filter((judge) => {
    const auth = judgeAuth.get(judge.judgeId);
    if (!judge.calibrated || judge.judgeId.trim() === '' || !digest(judge.keyFingerprint) || auth === undefined || auth.keyFingerprint !== judge.keyFingerprint || auth.organizationId !== judge.organizationId || registry.fingerprint(auth.keyId) !== auth.keyFingerprint) return false;
    if (spec.entries.some((entry) => entry.collectorId === judge.judgeId || entry.organizationId === judge.organizationId)) return false;
    if (judge.conflictsWithProviders.some((provider) => providerIds.has(provider))) return false;
    return true;
  });
  if (new Set(validJudges.map((judge) => judge.keyFingerprint)).size < spec.minimumIndependentJudges) findings.push('independent-judge-quorum-missing');
  const judgeIds = new Set(validJudges.map((judge) => judge.judgeId)); const scoreKeys = new Set<string>();
  for (const envelope of scores) {
    const score = envelope.payload; const key = `${score.taskId}:${score.blindLabel}:${score.judgeId}`;
    if (scoreKeys.has(key)) findings.push(`duplicate-score:${key}`); scoreKeys.add(key);
    const auth = judgeAuth.get(score.judgeId); const task = taskById.get(score.taskId);
    if (auth === undefined || auth.keyId !== envelope.issuerKeyId || !registry.verifyAt(envelope, score.scoredAt)) findings.push(`score-signature-invalid:${key}`);
    if (score.runId !== spec.runId || task === undefined || !allowedLabels.has(score.blindLabel) || !judgeIds.has(score.judgeId)) { findings.push(`score-identity-invalid:${key}`); continue; }
    const dimensions = Object.keys(score.dimensionScores).sort(), expectedDimensions = task.dimensions.map((item) => item.dimensionId).sort();
    if (JSON.stringify(dimensions) !== JSON.stringify(expectedDimensions)) findings.push(`score-dimensions-invalid:${key}`);
    for (const dimension of task.dimensions) { const value = score.dimensionScores[dimension.dimensionId]; if (value === undefined || !Number.isFinite(value) || value < 0 || value > dimension.maximumScore) findings.push(`score-range-invalid:${key}:${dimension.dimensionId}`); }
    if (new Set(score.goldChecksPassed).size !== score.goldChecksPassed.length || score.goldChecksPassed.some((check) => !task.hiddenGoldChecks.includes(check))) findings.push(`gold-check-invalid:${key}`);
    if (!digest(score.rationaleDigest) || !Number.isFinite(Date.parse(score.scoredAt))) findings.push(`score-evidence-invalid:${key}`);
  }
  if (submissions.length !== spec.tasks.length * spec.entries.length) findings.push('submission-matrix-incomplete');
  const plainScores = scores.map((row) => row.payload);
  const standings = assignment.labels.map(({ entryId, blindLabel }) => {
    const entry = entryById.get(entryId); if (entry === undefined) throw new Error('tournament_entry_internal_missing');
    const relevant = plainScores.filter((score) => score.blindLabel === blindLabel && judgeIds.has(score.judgeId));
    const taskScores = spec.tasks.flatMap((task) => { const rows = relevant.filter((score) => score.taskId === task.taskId); if (rows.length === 0) return []; const normalized = rows.map((score) => task.dimensions.reduce((sum, dimension) => sum + (score.dimensionScores[dimension.dimensionId] ?? 0) / dimension.maximumScore * dimension.weight, 0) / task.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0)); return [median(normalized)]; });
    const normalizedScore = taskScores.length === 0 ? 0 : mean(taskScores), interval = wilsonInterval(normalizedScore, Math.max(1, taskScores.length));
    return { entryId, blindLabel, normalizedScore: round(normalizedScore), lowerConfidenceBound: round(interval.low), upperConfidenceBound: round(interval.high), tasksScored: taskScores.length, judges: new Set(relevant.map((score) => score.judgeId)).size, totalCostMicros: submissions.filter((row) => row.payload.blindLabel === blindLabel).reduce((sum, row) => sum + row.payload.costMicros, 0) };
  }).sort((a, b) => b.normalizedScore - a.normalizedScore || a.entryId.localeCompare(b.entryId));
  if (standings.some((row) => row.tasksScored < spec.minimumTasks || row.judges < spec.minimumIndependentJudges)) findings.push('score-matrix-incomplete');
  const leader = standings[0], runnerUp = standings[1]; const statisticallySeparated = leader !== undefined && runnerUp !== undefined && leader.lowerConfidenceBound > runnerUp.upperConfidenceBound;
  const externalTrust = trustPolicy.providerAuthorizations.every((auth) => auth.authorityClass === 'EXTERNAL_PINNED') && trustPolicy.judgeAuthorizations.every((auth) => auth.authorityClass === 'EXTERNAL_PINNED');
  const external = spec.evidenceClass === 'OBSERVED_EXTERNAL' && spec.entries.every((entry) => entry.evidenceClass === 'OBSERVED_EXTERNAL') && externalTrust;
  if (spec.entries.length < 2 || providerIds.size < spec.minimumProviders) findings.push('provider-diversity-insufficient');
  if (spec.evidenceClass === 'OBSERVED_EXTERNAL' && !externalTrust) findings.push('external-trust-not-pinned');
  let verdict: TournamentVerdictV32_15 = 'INVALID'; if (findings.length === 0) verdict = external ? (statisticallySeparated ? 'FRONTIER_LEADER_CANDIDATE' : 'COMPARISON_VALID') : 'DRY_RUN_VALID';
  const leaders = leader === undefined ? [] : standings.filter((row) => row.normalizedScore === leader.normalizedScore).map((row) => row.entryId);
  const material = { schemaVersion: '32.15' as const, runId: spec.runId, verdict, leaders, standings, findings, worldBestClaim: 'not-proven' as const };
  return { ...material, reportDigest: sha256(material) };
}

function validateSpec(spec: TournamentRunSpecV32_15): void {
  if (spec.schemaVersion !== '32.15' || spec.runId.trim() === '' || ![spec.sourceDigest, spec.corpusDigest, spec.policyDigest, spec.blindSaltDigest].every(digest)) throw new Error('tournament_spec_identity_invalid');
  if (spec.entries.length < 2 || new Set(spec.entries.map((item) => item.entryId)).size !== spec.entries.length) throw new Error('tournament_entries_invalid');
  if (spec.tasks.length < 1 || new Set(spec.tasks.map((item) => item.taskId)).size !== spec.tasks.length) throw new Error('tournament_tasks_invalid');
  if (![spec.minimumIndependentJudges, spec.minimumTasks, spec.minimumProviders, spec.maximumCostMicros].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error('tournament_limits_invalid');
  if (spec.minimumIndependentJudges < 2 || spec.minimumTasks < 1 || spec.minimumProviders < 2) throw new Error('tournament_minimums_weak');
  for (const entry of spec.entries) if ([entry.entryId, entry.providerId, entry.modelId, entry.modelVersion, entry.collectorId, entry.organizationId].some((value) => value.trim() === '') || !Number.isSafeInteger(entry.costMicros) || entry.costMicros < 0) throw new Error('tournament_entry_invalid');
  for (const task of spec.tasks) { if (task.taskId.trim() === '' || !digest(task.promptDigest) || !digest(task.artifactDigest) || task.dimensions.length === 0 || new Set(task.dimensions.map((item) => item.dimensionId)).size !== task.dimensions.length) throw new Error('tournament_task_invalid'); for (const dimension of task.dimensions) if (dimension.dimensionId.trim() === '' || !Number.isFinite(dimension.weight) || dimension.weight <= 0 || !Number.isFinite(dimension.maximumScore) || dimension.maximumScore <= 0) throw new Error('tournament_dimension_invalid'); }
}
function validateTrustPolicy(policy:TournamentTrustPolicyV32_15):void{if(!digest(policy.policyDigest)||policy.providerAuthorizations.length<2||policy.judgeAuthorizations.length<2)throw new Error('tournament_trust_policy_invalid');if(new Set(policy.providerAuthorizations.map(x=>x.entryId)).size!==policy.providerAuthorizations.length||new Set(policy.providerAuthorizations.map(x=>x.keyId)).size!==policy.providerAuthorizations.length||new Set(policy.judgeAuthorizations.map(x=>x.judgeId)).size!==policy.judgeAuthorizations.length||new Set(policy.judgeAuthorizations.map(x=>x.keyId)).size!==policy.judgeAuthorizations.length)throw new Error('tournament_trust_authorization_duplicate');for(const row of [...policy.providerAuthorizations,...policy.judgeAuthorizations])if(!digest(row.keyFingerprint)||row.keyId.trim()==='')throw new Error('tournament_trust_authorization_invalid');}
function deterministicShuffle<T>(items: readonly T[], seed: string): T[] { return [...items].map((item, index) => ({ item, rank: sha256({ seed, index, item }) })).sort((a, b) => a.rank.localeCompare(b.rank)).map((row) => row.item); }
function digest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
function median(values: readonly number[]): number { const sorted=[...values].sort((a,b)=>a-b), middle=Math.floor(sorted.length/2); return sorted.length%2===0?((sorted[middle-1]??0)+(sorted[middle]??0))/2:(sorted[middle]??0); }
function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function wilsonInterval(p: number, n: number): { low: number; high: number } { const z=1.96, denom=1+z*z/n, center=(p+z*z/(2*n))/denom, margin=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/denom; return {low:Math.max(0,center-margin),high:Math.min(1,center+margin)}; }
function round(value: number): number { return Number(value.toFixed(6)); }
