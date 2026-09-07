import { sha256 } from '../contracts/crypto.js';

export interface WorkflowSource { readonly path: string; readonly content: string; }
export interface WorkflowSecurityPolicy {
  readonly requireImmutableActions: boolean;
  readonly requireCheckoutCredentialIsolation: boolean;
  readonly maximumArtifactRetentionDays: number;
  readonly forbidPullRequestTarget: boolean;
  readonly forbidWritePermissions: boolean;
  readonly requireIgnoreScripts: boolean;
}
export interface WorkflowSecurityReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly findings: readonly { readonly workflow: string; readonly rule: string; readonly line: number; readonly detail: string }[];
  readonly metrics: { readonly workflows: number; readonly externalActions: number; readonly immutableActions: number; readonly checkoutSteps: number };
  readonly reportDigest: string;
}

/** Conservative line-oriented audit. It does not execute or trust workflow code. */
export function evaluateWorkflowSecurity(workflows: readonly WorkflowSource[], policy: WorkflowSecurityPolicy): WorkflowSecurityReport {
  if (workflows.length === 0) throw new Error('workflow_inventory_empty');
  const findings: { workflow: string; rule: string; line: number; detail: string }[] = [];
  let externalActions = 0;
  let immutableActions = 0;
  let checkoutSteps = 0;
  for (const workflow of workflows) {
    const lines = workflow.content.split(/\r?\n/);
    const hasPullRequest = lines.some((line) => /^\s*pull_request\s*:/.test(line));
    if (policy.forbidPullRequestTarget) {
      lines.forEach((line, index) => { if (/^\s*pull_request_target\s*:/.test(line)) findings.push(f(workflow.path, 'pull_request_target_forbidden', index, line)); });
    }
    lines.forEach((line, index) => {
      const use = line.match(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/);
      if (use && !use[1]!.startsWith('./')) {
        externalActions += 1;
        const spec = use[1]!;
        const ref = spec.split('@')[1] ?? '';
        if (/^[0-9a-f]{40}$/.test(ref)) immutableActions += 1;
        else if (policy.requireImmutableActions) findings.push(f(workflow.path, 'action_not_pinned_to_full_sha', index, spec));
        if (spec.startsWith('actions/checkout@')) {
          checkoutSteps += 1;
          const block = lines.slice(index + 1, Math.min(lines.length, index + 9)).join('\n');
          if (policy.requireCheckoutCredentialIsolation && !/persist-credentials:\s*false/.test(block)) findings.push(f(workflow.path, 'checkout_persists_credentials', index, spec));
        }
      }
      const retention = line.match(/retention-days:\s*(\d+)/);
      if (retention && Number(retention[1]) > policy.maximumArtifactRetentionDays) findings.push(f(workflow.path, 'artifact_retention_exceeds_policy', index, retention[1]!));
      if (policy.forbidWritePermissions && /^\s*(contents|actions|checks|deployments|id-token|issues|packages|pull-requests|security-events|statuses):\s*write\s*$/.test(line)) findings.push(f(workflow.path, 'write_permission_forbidden', index, line.trim()));
      if (hasPullRequest && /\$\{\{\s*secrets\./.test(line)) findings.push(f(workflow.path, 'secret_reference_in_untrusted_pr_workflow', index, line.trim()));
    });
    if (policy.requireIgnoreScripts && /npm\s+ci(?:\s|$)/.test(workflow.content) && !/npm\s+ci\s+--ignore-scripts/.test(workflow.content)) findings.push(f(workflow.path, 'npm_ci_scripts_not_disabled', findLine(lines, /npm\s+ci/), 'npm ci must use --ignore-scripts'));
  }
  const material = {
    status: findings.length === 0 ? 'PASS' as const : 'BLOCK' as const,
    findings: findings.sort((a, b) => a.workflow.localeCompare(b.workflow) || a.line - b.line || a.rule.localeCompare(b.rule)),
    metrics: { workflows: workflows.length, externalActions, immutableActions, checkoutSteps },
  };
  return { ...material, reportDigest: sha256(material) };
}
function f(workflow: string, rule: string, index: number, detail: string) { return { workflow, rule, line: index + 1, detail: detail.trim() }; }
function findLine(lines: readonly string[], pattern: RegExp): number { const i = lines.findIndex((line) => pattern.test(line)); return i < 0 ? 1 : i + 1; }
