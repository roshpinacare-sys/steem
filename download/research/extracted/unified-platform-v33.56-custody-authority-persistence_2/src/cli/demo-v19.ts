import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadChangeSession } from '../repository/change-assurance.js';
import { WorkflowService } from '../web/workflow-service.js';

const root = mkdtempSync(join(tmpdir(), 'canonical-proof-v19-demo-'));
const evidenceOutput = resolve(process.env.V19_DEMO_OUTPUT ?? 'evidence/generated/v19-repository-demo');
rmSync(evidenceOutput, { recursive: true, force: true });
mkdirSync(evidenceOutput, { recursive: true });

const service = new WorkflowService(root, new Date('2026-07-16T12:00:00.000Z'));
const fixture = service.fixture();
const intake = await service.intake({
  sourceRepository: fixture.repositoryPath,
  objective: fixture.objective,
  targetFile: fixture.targetFile,
  allowedFiles: fixture.allowedFiles,
  exactBefore: fixture.exactBefore,
  exactAfter: fixture.exactAfter,
  testCommand: fixture.testCommand,
  planId: 'v19-demo-plan',
  idempotencyKey: 'v19-demo-idempotency',
});
const sessionId = intake.sessionId as string;
const execution = await service.execute(sessionId);
const approval = service.review(sessionId, 'independent-reviewer-v19');
const state = loadChangeSession(join(root, 'sessions'), sessionId);
cpSync(state.artifactDirectory, join(evidenceOutput, 'change-package'), { recursive: true });
const rollback = service.rollback(sessionId);
const summary = {
  status: approval.status,
  rollbackStatus: rollback.status,
  sessionId,
  promptInjectionDetected: (intake.findings as ReadonlyArray<{ readonly kind: string }>).some((finding) => finding.kind === 'PROMPT_INJECTION'),
  dependencyRiskDetected: (intake.findings as ReadonlyArray<{ readonly kind: string }>).some((finding) => finding.kind === 'DEPENDENCY_RISK'),
  testsPassed: (execution.testExecution as { readonly passed: boolean }).passed,
  evidenceRoot: execution.evidenceRoot,
  passportIssued: approval.passport !== undefined,
  promotion: 'shadow-only',
  exactRollback: rollback.status === 'ROLLED_BACK',
  externalMutation: 'disabled',
  postgres: service.health().infrastructure.postgres,
  limitations: [
    'explicit-change-plan-not-autonomous-code-generation',
    'local-disposable-repository',
    'trusted-fixture-local-process-only',
    'untrusted-repositories-require-qualified-isolation',
    'signer-private-key-is-ephemeral-test-only',
    'no-external-git-mutation',
    'not-production-qualified',
  ],
  evidenceOutput,
};
writeFileSync(join(evidenceOutput, 'v19-demo-summary.json'), JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
