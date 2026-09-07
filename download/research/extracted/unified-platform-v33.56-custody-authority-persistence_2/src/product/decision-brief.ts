import type { SecurityFinding } from '../repository/security-scan.js';

export interface DecisionBriefInput {
  readonly status: string;
  readonly objective: string;
  readonly changedFiles: readonly string[];
  readonly findings: readonly SecurityFinding[];
  readonly testPassed?: boolean;
  readonly evidenceRoot?: string;
  readonly unsupportedClaims: readonly string[];
  readonly reviewerId?: string;
  readonly rollbackAvailable: boolean;
  readonly passportAvailable: boolean;
  readonly repositoryTrust: string;
  readonly testExecutionBoundary: string;
}

export interface DecisionBrief {
  readonly recommendation: 'BLOCK' | 'READY_FOR_REVIEW' | 'APPROVED_SHADOW' | 'RECOVERY_COMPLETE' | 'IN_PROGRESS';
  readonly decisionReasons: readonly string[];
  readonly topRisks: readonly { readonly severity: string; readonly kind: string; readonly summary: string; readonly file: string }[];
  readonly evidenceChecks: readonly { readonly label: string; readonly status: 'present' | 'missing' | 'blocked'; readonly explanation: string }[];
  readonly permissionExplanations: readonly string[];
  readonly recoveryPreview: string;
  readonly changeSummary: string;
  readonly unsupportedClaimCount: number;
  readonly reviewDataProxy: {
    readonly rawFactCount: number;
    readonly decisionItemCount: number;
    readonly reductionPercent: number;
    readonly limitation: string;
  };
}

export function buildDecisionBrief(input: DecisionBriefInput): DecisionBrief {
  const topRisks = [...input.findings]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || `${a.file}:${a.ruleId}`.localeCompare(`${b.file}:${b.ruleId}`))
    .slice(0, 5)
    .map(({ severity, kind, summary, file }) => ({ severity, kind, summary, file }));
  const critical = input.findings.some((finding) => finding.severity === 'critical');
  const recommendation = input.status === 'ROLLED_BACK' ? 'RECOVERY_COMPLETE'
    : input.status === 'APPROVED_SHADOW' ? 'APPROVED_SHADOW'
      : input.status === 'FAILED' || critical ? 'BLOCK'
        : input.status === 'AWAITING_REVIEW' && input.testPassed === true ? 'READY_FOR_REVIEW'
          : 'IN_PROGRESS';
  const decisionReasons = [
    critical ? 'Critical security findings require resolution before approval.' : 'No critical security finding is present in the bounded scan.',
    input.testPassed === true ? 'The declared test command executed and passed.' : 'Passing executed test evidence is not yet available.',
    input.evidenceRoot === undefined ? 'Evidence Root is not yet available.' : 'Evidence Root is available for integrity verification.',
    input.rollbackAvailable ? 'An exact rollback package is available.' : 'Rollback is not yet available.',
    input.reviewerId === undefined ? 'Independent review is pending.' : `Independent review recorded by ${input.reviewerId}.`,
  ];
  const evidenceChecks = [
    check('Executed tests', input.testPassed === true, 'Required before review.'),
    check('Evidence Root', input.evidenceRoot !== undefined, 'Binds the manifest, tests, findings and unsupported claims.'),
    check('Rollback', input.rollbackAvailable, 'Required for reversible delivery.'),
    check('Independent reviewer', input.reviewerId !== undefined, 'Builder self-approval is forbidden.'),
    check('Action Passport', input.passportAvailable, 'Available only after independent shadow approval.'),
  ];
  const permissionExplanations = [
    'Repository read is required to inspect the explicitly allowlisted source tree.',
    `Test execution is limited to ${input.testExecutionBoundary}; untrusted repositories remain blocked.`,
    'Repository write is limited to the approved files in the explicit change plan.',
    'External Git mutation, secrets and production promotion are not authorized.',
  ];
  const rawFactCount = countFacts(input);
  const decisionItemCount = 1 + topRisks.length + evidenceChecks.length + 3;
  const reductionPercent = rawFactCount <= decisionItemCount ? 0 : Math.round((1 - decisionItemCount / rawFactCount) * 1000) / 10;
  return {
    recommendation,
    decisionReasons,
    topRisks,
    evidenceChecks,
    permissionExplanations,
    recoveryPreview: input.rollbackAvailable ? 'Rollback can restore the repository workspace to the recorded base state; external systems were not mutated.' : 'Recovery package will be generated after successful bounded execution.',
    changeSummary: input.changedFiles.length === 0 ? `No file change is currently recorded for: ${input.objective}` : `${input.changedFiles.length} approved file(s) changed: ${input.changedFiles.join(', ')}.`,
    unsupportedClaimCount: input.unsupportedClaims.length,
    reviewDataProxy: {
      rawFactCount,
      decisionItemCount,
      reductionPercent,
      limitation: 'This counts decision-facing summary items versus raw input facts; it is not measured human review-time savings.',
    },
  };
}

function check(label: string, present: boolean, explanation: string) {
  return { label, status: present ? 'present' as const : 'missing' as const, explanation };
}
function severityRank(value: SecurityFinding['severity']): number { return value === 'critical' ? 4 : value === 'high' ? 3 : value === 'medium' ? 2 : 1; }
function countFacts(value: unknown): number {
  if (value === null || typeof value !== 'object') return 1;
  if (Array.isArray(value)) return value.reduce((sum, child) => sum + countFacts(child), 0);
  return Object.values(value).reduce((sum, child) => sum + countFacts(child), 0);
}
