import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateSigningIdentity } from '../contracts/crypto.js';
import {
  approveChangeSession,
  createDisposableDefectRepository,
  executeChangePlan,
  intakeChangePlan,
  loadChangeSession,
  rollbackChangeSession,
  sessionArtifactSummary,
  type ExplicitChangePlan,
} from '../repository/change-assurance.js';
import { KeyLifecycleRegistry } from '../security/key-lifecycle.js';
import { buildOperatorActionCenter } from '../operations/operator-action-center.js';

export interface WorkflowServiceOptions {
  readonly tenantId?: string;
  readonly subjectId?: string;
  readonly builderId?: string;
  readonly passportSigner?: ReturnType<typeof generateSigningIdentity>;
  readonly keyRegistry?: KeyLifecycleRegistry;
  readonly repositoryTrust?: 'trusted-fixture' | 'first-party-reviewed';
  readonly now?: () => Date;
}

export class WorkflowService {
  readonly #sessionsRoot: string;
  readonly #fixtureRoot: string;
  readonly #signer: ReturnType<typeof generateSigningIdentity>;
  readonly #keyRegistry: KeyLifecycleRegistry;
  readonly #allowedRepositoryRoots = new Set<string>();
  readonly #tenantId: string;
  readonly #subjectId: string;
  readonly #builderId: string;
  readonly #repositoryTrust: 'trusted-fixture' | 'first-party-reviewed';
  readonly #now: () => Date;

  constructor(readonly dataRoot: string, now?: Date, additionalAllowedRepositories: readonly string[] = [], options: WorkflowServiceOptions = {}) {
    const registrationNow = now ?? new Date();
    this.#sessionsRoot = join(resolve(dataRoot), 'sessions');
    this.#tenantId = options.tenantId ?? 'tenant-1';
    this.#subjectId = options.subjectId ?? 'operator-1';
    this.#builderId = options.builderId ?? 'builder-1';
    this.#repositoryTrust = options.repositoryTrust ?? 'trusted-fixture';
    this.#now = options.now ?? (now === undefined ? (() => new Date()) : (() => new Date(registrationNow.getTime())));
    this.#signer = options.passportSigner ?? generateSigningIdentity(`web-passport-key-${this.#tenantId}`);
    this.#keyRegistry = options.keyRegistry ?? new KeyLifecycleRegistry();
    this.#fixtureRoot = join(resolve(dataRoot), 'demo-repository');
    mkdirSync(this.#sessionsRoot, { recursive: true });
    if (!existsSync(this.#fixtureRoot)) createDisposableDefectRepository(this.#fixtureRoot);
    this.#allowedRepositoryRoots.add(resolve(this.#fixtureRoot));
    for (const repository of additionalAllowedRepositories) this.#allowedRepositoryRoots.add(resolve(repository));
    const snapshotHasSigner = options.keyRegistry !== undefined && options.keyRegistry.snapshot(registrationNow).keys.some((key) => key.keyId === this.#signer.keyId);
    if (!snapshotHasSigner) this.#keyRegistry.register(this.#signer, {
      keyId: this.#signer.keyId,
      familyId: 'web-passport-family',
      purpose: 'action-passport',
      environment: 'test',
      tenantId: this.#tenantId,
      notBefore: new Date(registrationNow.getTime() - 60_000).toISOString(),
      notAfter: new Date(registrationNow.getTime() + 24 * 60 * 60_000).toISOString(),
    });
  }

  fixture() {
    return {
      repositoryPath: this.#fixtureRoot,
      objective: 'Correct the add function while preserving tests and repository scope.',
      targetFile: 'src/calculator.js',
      exactBefore: 'return a - b;',
      exactAfter: 'return a + b;',
      allowedFiles: ['src/calculator.js'],
      testCommand: ['node', '--test'],
      repositoryTrust: this.#repositoryTrust,
      testExecutionBoundary: 'trusted-local-process',
      expectedSecurityFinding: 'Repository documentation contains an instruction-override and exfiltration attempt. It must be reported and ignored.',
    } as const;
  }

  async intake(input: Partial<ExplicitChangePlan>) {
    const plan = this.#normalizePlan(input);
    const state = await intakeChangePlan(plan, this.#sessionsRoot);
    return sessionArtifactSummary(state);
  }

  async execute(sessionId: string) {
    const state = loadChangeSession(this.#sessionsRoot, sessionId);
    const executed = await executeChangePlan(state.plan, { sessionsRoot: this.#sessionsRoot });
    return sessionArtifactSummary(executed);
  }

  review(sessionId: string, reviewerId: string) {
    const state = approveChangeSession({
      sessionsRoot: this.#sessionsRoot,
      sessionId,
      reviewerId,
      passportSigner: this.#signer,
      keyRegistry: this.#keyRegistry,
      now: this.#now(),
    });
    return sessionArtifactSummary(state);
  }

  rollback(sessionId: string) {
    return sessionArtifactSummary(rollbackChangeSession(this.#sessionsRoot, sessionId));
  }

  get(sessionId: string) {
    return sessionArtifactSummary(loadChangeSession(this.#sessionsRoot, sessionId));
  }

  health() {
    return {
      status: 'ok',
      product: 'Governed Engineering and Change Assurance',
      version: 'v32',
      promotionBoundary: 'shadow-only',
      infrastructure: {
        durableStore: 'sqlite-local-proof',
        postgres: 'environment-blocked',
        isolation: 'trusted-fixture-local-process-only; untrusted repositories blocked until qualified isolation',
        kmsHsm: 'environment-blocked',
        externalGitMutation: 'disabled',
      },
    } as const;
  }

  operations() {
    return buildOperatorActionCenter({
      failedTests: 0,
      orphanProcesses: 0,
      dependencies: [
        { id: 'sqlite-local-proof', state: 'ready', detail: 'Local restart and recovery paths are exercised.', owner: 'Runtime Operations Lead' },
        { id: 'postgres-primary-standby', state: 'blocked', detail: 'No live primary/standby, failover or PITR qualification is attached.', owner: 'Database Qualification Lead', runbook: 'infra/postgres/V25_RUNBOOK.md' },
        { id: 'kms-hsm', state: 'blocked', detail: 'Only an attested protocol rehearsal exists; no authorized custody service is connected.', owner: 'Key Custody Lead', runbook: 'docs/V25_EXTERNAL_QUALIFICATION_RUNBOOK.md' },
        { id: 'untrusted-code-isolation', state: 'blocked', detail: 'Single-host Linux and WASM proofs are not independent production isolation certification.', owner: 'Isolation Qualification Lead', runbook: 'docs/V25_EXTERNAL_QUALIFICATION_RUNBOOK.md' },
      ],
      risks: [
        { id: 'V25-R-HUMAN', severity: 'high', summary: 'Run the consented operator pilot before claiming workflow improvement', affectedArea: 'product usability', mitigation: 'The five-task protocol exists and forbids unsupported claims.' },
        { id: 'V25-R-EXTERNAL', severity: 'high', summary: 'Complete external penetration and licensing review', affectedArea: 'production promotion', mitigation: 'Promotion remains shadow-only.' },
      ],
    });
  }

  #normalizePlan(input: Partial<ExplicitChangePlan>): ExplicitChangePlan {
    const fixture = this.fixture();
    const sourceRepository = resolve(input.sourceRepository ?? fixture.repositoryPath);
    if (!this.#allowedRepositoryRoots.has(sourceRepository)) throw new Error('repository_not_allowlisted');
    if (input.tenantId !== undefined && input.tenantId !== this.#tenantId) throw new Error('web_tenant_not_authorized');
    if (input.subjectId !== undefined && input.subjectId !== this.#subjectId) throw new Error('web_subject_not_authorized');
    if (input.builderId !== undefined && input.builderId !== this.#builderId) throw new Error('web_builder_not_authorized');
    if (input.repositoryTrust !== undefined && input.repositoryTrust !== this.#repositoryTrust) throw new Error('web_repository_trust_not_authorized');
    if (input.testExecutionBoundary !== undefined && input.testExecutionBoundary !== 'trusted-local-process') throw new Error('web_execution_boundary_not_authorized');
    return {
      planId: input.planId ?? `web-plan-${Date.now()}`,
      idempotencyKey: input.idempotencyKey ?? `web-idem-${Date.now()}`,
      tenantId: this.#tenantId,
      subjectId: this.#subjectId,
      builderId: this.#builderId,
      objective: input.objective ?? fixture.objective,
      sourceRepository,
      allowedFiles: input.allowedFiles ?? fixture.allowedFiles,
      targetFile: input.targetFile ?? fixture.targetFile,
      exactBefore: input.exactBefore ?? fixture.exactBefore,
      exactAfter: input.exactAfter ?? fixture.exactAfter,
      testCommand: input.testCommand as ExplicitChangePlan['testCommand'] | undefined ?? fixture.testCommand,
      repositoryTrust: this.#repositoryTrust,
      testExecutionBoundary: 'trusted-local-process',
    };
  }
}
