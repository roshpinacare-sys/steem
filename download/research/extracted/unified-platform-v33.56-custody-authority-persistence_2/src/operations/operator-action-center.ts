export type OperationalSeverity = 'critical' | 'high' | 'medium' | 'low';
export type OperationalState = 'ready' | 'degraded' | 'blocked' | 'unknown';

export interface OperationalDependency {
  readonly id: string;
  readonly state: OperationalState;
  readonly detail: string;
  readonly owner: string;
  readonly runbook?: string;
}

export interface OperationalRisk {
  readonly id: string;
  readonly severity: OperationalSeverity;
  readonly summary: string;
  readonly affectedArea: string;
  readonly mitigation?: string;
}

export interface OperationalAction {
  readonly id: string;
  readonly priority: 1 | 2 | 3 | 4;
  readonly category: 'stop' | 'repair' | 'verify' | 'optimize' | 'monitor';
  readonly title: string;
  readonly why: string;
  readonly owner: string;
  readonly runbook?: string;
  readonly completionEvidence: string;
}

export interface OperatorActionCenter {
  readonly overallState: 'blocked' | 'degraded' | 'ready';
  readonly headline: string;
  readonly actions: readonly OperationalAction[];
  readonly blockedDependencies: readonly string[];
  readonly decisionSummary: {
    readonly actNow: number;
    readonly verifyNext: number;
    readonly monitor: number;
  };
  readonly limitations: readonly string[];
}

export function buildOperatorActionCenter(input: {
  readonly dependencies: readonly OperationalDependency[];
  readonly risks: readonly OperationalRisk[];
  readonly failedTests?: number;
  readonly testRuntimeRegression?: boolean;
  readonly orphanProcesses?: number;
}): OperatorActionCenter {
  const actions: OperationalAction[] = [];
  const failedTests = input.failedTests ?? 0;
  const orphanProcesses = input.orphanProcesses ?? 0;
  if (failedTests > 0) actions.push({ id: 'tests-failed', priority: 1, category: 'stop', title: 'Stop promotion and repair failing tests', why: `${failedTests} executed test(s) failed.`, owner: 'Test and Falsification Lead', completionEvidence: 'A fresh full-suite run with zero failures and bound execution provenance.' });
  if (orphanProcesses > 0) actions.push({ id: 'orphan-processes', priority: 1, category: 'stop', title: 'Terminate and investigate orphan processes', why: `${orphanProcesses} process(es) survived validation.`, owner: 'Runtime Operations Lead', completionEvidence: 'Process inventory is empty after an interrupted and a completed validation run.' });
  for (const dependency of input.dependencies) {
    if (dependency.state === 'blocked') actions.push({ id: `dependency-${dependency.id}`, priority: 1, category: 'stop', title: `Keep ${dependency.id} blocked`, why: dependency.detail, owner: dependency.owner, ...(dependency.runbook === undefined ? {} : { runbook: dependency.runbook }), completionEvidence: `Direct qualification evidence changes ${dependency.id} from blocked to ready.` });
    else if (dependency.state === 'degraded') actions.push({ id: `dependency-${dependency.id}`, priority: 2, category: 'repair', title: `Restore ${dependency.id}`, why: dependency.detail, owner: dependency.owner, ...(dependency.runbook === undefined ? {} : { runbook: dependency.runbook }), completionEvidence: `Health probe and functional verification both report ${dependency.id} ready.` });
    else if (dependency.state === 'unknown') actions.push({ id: `dependency-${dependency.id}`, priority: 3, category: 'verify', title: `Qualify ${dependency.id}`, why: dependency.detail, owner: dependency.owner, ...(dependency.runbook === undefined ? {} : { runbook: dependency.runbook }), completionEvidence: `A measured qualification result replaces unknown state for ${dependency.id}.` });
  }
  for (const risk of input.risks) {
    const priority = risk.severity === 'critical' ? 1 : risk.severity === 'high' ? 2 : risk.severity === 'medium' ? 3 : 4;
    actions.push({ id: `risk-${risk.id}`, priority, category: priority <= 2 ? 'repair' : 'monitor', title: risk.summary, why: `Affected area: ${risk.affectedArea}.${risk.mitigation === undefined ? '' : ` Current mitigation: ${risk.mitigation}`}`, owner: 'Risk Owner', completionEvidence: `Risk ${risk.id} has direct closure evidence or an explicitly accepted residual-risk decision.` });
  }
  if (input.testRuntimeRegression === true) actions.push({ id: 'test-runtime-regression', priority: 3, category: 'optimize', title: 'Investigate test runtime regression', why: 'The current full suite exceeded the accepted baseline without adding proportional exercised coverage.', owner: 'Test Performance Lead', completionEvidence: 'Profile identifies the regression and the full suite returns within budget without reducing test count.' });
  const deduped = [...new Map(actions.map((action) => [action.id, action])).values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const blockedDependencies = input.dependencies.filter((item) => item.state === 'blocked').map((item) => item.id).sort();
  const overallState = deduped.some((item) => item.priority === 1) ? 'blocked' : deduped.some((item) => item.priority === 2 || item.priority === 3) ? 'degraded' : 'ready';
  return {
    overallState,
    headline: overallState === 'blocked' ? 'Promotion is blocked; resolve stop actions first.' : overallState === 'degraded' ? 'System is usable within current boundaries; repair and qualification actions remain.' : 'No immediate operational blocker is present.',
    actions: deduped,
    blockedDependencies,
    decisionSummary: { actNow: deduped.filter((item) => item.priority <= 2).length, verifyNext: deduped.filter((item) => item.priority === 3).length, monitor: deduped.filter((item) => item.priority === 4).length },
    limitations: ['This queue prioritizes declared evidence and health states; it does not replace an operator or incident commander.', 'A ready local dependency does not imply production qualification.'],
  };
}
