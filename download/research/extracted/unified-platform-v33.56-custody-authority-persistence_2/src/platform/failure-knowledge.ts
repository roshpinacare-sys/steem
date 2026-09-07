import { sha256 } from '../contracts/crypto.js';

export type FailureCategory =
  | 'DUPLICATE_EFFECT'
  | 'STALE_WORKER'
  | 'UNVERIFIED_WEBHOOK'
  | 'IMPORT_SIDE_EFFECT'
  | 'FALSE_HEALTH'
  | 'FALSE_CLAIM'
  | 'LEDGER_IMBALANCE'
  | 'SELF_APPROVAL'
  | 'TENANT_LEAK'
  | 'UNKNOWN';

export interface FailureObservation {
  readonly failureId: string;
  readonly tenantId: string;
  readonly category: FailureCategory;
  readonly sourceSystem: string;
  readonly subject: string;
  readonly evidenceRefs: readonly string[];
  readonly observedAt: string;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface FailureKnowledgePackage {
  readonly packageId: string;
  readonly tenantId: string;
  readonly sourceFailureId: string;
  readonly invariant: string;
  readonly regressionTest: string;
  readonly adversarialTest: string;
  readonly runtimeMonitor: string;
  readonly recertificationTrigger: string;
  readonly automatic: boolean;
  readonly limitations: readonly string[];
  readonly digest: string;
}

const KNOWLEDGE: Record<Exclude<FailureCategory, 'UNKNOWN'>, Omit<FailureKnowledgePackage, 'packageId' | 'tenantId' | 'sourceFailureId' | 'digest'>> = {
  DUPLICATE_EFFECT: {
    invariant: 'A tenant-scoped idempotency key produces at most one visible external effect for one payload digest.',
    regressionTest: 'Inject a crash after effect persistence and before acknowledgement; retry and assert one effect.',
    adversarialTest: 'Reuse the idempotency key with a different payload and require a conflict.',
    runtimeMonitor: 'Alert on one idempotency key mapped to more than one payload digest or provider result.',
    recertificationTrigger: 'Invalidate durable-work certification when duplicate-effect evidence appears.',
    automatic: true,
    limitations: ['external provider reconciliation is still required'],
  },
  STALE_WORKER: {
    invariant: 'A worker holding an older fencing token cannot commit state or effects.',
    regressionTest: 'Expire a lease, acquire a newer lease, and reject all stale commits.',
    adversarialTest: 'Race multiple workers across lease expiry and clock skew.',
    runtimeMonitor: 'Count stale-fence rejections and alert on any accepted stale commit.',
    recertificationTrigger: 'Re-run multi-host fencing qualification after lease implementation changes.',
    automatic: true,
    limitations: ['multi-host clock behavior requires production infrastructure'],
  },
  UNVERIFIED_WEBHOOK: {
    invariant: 'A provider event is accepted only after signature, timestamp, identity, schema, and replay validation.',
    regressionTest: 'Submit valid, tampered, expired, duplicated, and wrong-provider events.',
    adversarialTest: 'Attempt signature confusion, replay, tenant substitution, and payload mutation.',
    runtimeMonitor: 'Alert on verification failures and repeated provider event identifiers.',
    recertificationTrigger: 'Invalidate the payment adapter after provider signing-contract changes.',
    automatic: true,
    limitations: ['provider-specific cryptographic review required'],
  },
  IMPORT_SIDE_EFFECT: {
    invariant: 'Module discovery and import produce no files, network calls, subprocesses, or certification decisions.',
    regressionTest: 'Import every runtime module in an empty read-only workspace and compare side-effect inventory.',
    adversarialTest: 'Import modules under denied filesystem and network policies.',
    runtimeMonitor: 'Not applicable at runtime; enforce in build and plugin admission.',
    recertificationTrigger: 'Quarantine a package when discovery causes side effects.',
    automatic: true,
    limitations: ['native extension initialization requires separate review'],
  },
  FALSE_HEALTH: {
    invariant: 'A health result is derived from a live dependency probe and includes freshness and method.',
    regressionTest: 'Stop the dependency and assert health becomes unavailable within the stated interval.',
    adversarialTest: 'Return static OK while the dependency is absent and require gate failure.',
    runtimeMonitor: 'Compare health assertions with independent telemetry.',
    recertificationTrigger: 'Invalidate operational readiness after false-positive health evidence.',
    automatic: true,
    limitations: ['health does not prove correctness'],
  },
  FALSE_CLAIM: {
    invariant: 'Every product claim is linked to evidence with an honest class and explicit limitations.',
    regressionTest: 'Attempt to promote SIMULATED or ESTIMATED evidence as MEASURED.',
    adversarialTest: 'Tamper with evidence class, instrument identity, or claim wording.',
    runtimeMonitor: 'Reject unsupported claim/evidence-class combinations.',
    recertificationTrigger: 'Require scientific re-review when a claim classification changes.',
    automatic: true,
    limitations: ['semantic truth still requires expert review'],
  },
  LEDGER_IMBALANCE: {
    invariant: 'Every posted transaction balances by currency and tenant before commit.',
    regressionTest: 'Submit balanced, unbalanced, negative, non-finite, and cross-currency postings.',
    adversarialTest: 'Race duplicate postings and mutate a prior ledger reference.',
    runtimeMonitor: 'Continuously reconcile debit and credit totals by tenant and currency.',
    recertificationTrigger: 'Freeze posting capability after any invariant violation.',
    automatic: true,
    limitations: ['external settlement reconciliation remains separate'],
  },
  SELF_APPROVAL: {
    invariant: 'The builder, proposer, executor, and required independent reviewer cannot collapse into one identity.',
    regressionTest: 'Attempt approval with builder and executor identities.',
    adversarialTest: 'Use aliases, delegated identities, and key rotation to bypass separation.',
    runtimeMonitor: 'Evaluate identity lineage before approval acceptance.',
    recertificationTrigger: 'Invalidate approval policy after identity-model changes.',
    automatic: true,
    limitations: ['organization-level independence may require human governance'],
  },
  TENANT_LEAK: {
    invariant: 'No authority, state, evidence, artifact, cache, or effect crosses a tenant boundary.',
    regressionTest: 'Exercise every API with foreign tenant identifiers and shared object identifiers.',
    adversarialTest: 'Attempt confused-deputy, cache poisoning, and identifier collision attacks.',
    runtimeMonitor: 'Detect cross-tenant joins and access-denial anomalies.',
    recertificationTrigger: 'Quarantine the affected capability after any tenant-boundary failure.',
    automatic: true,
    limitations: ['infrastructure and backup isolation require separate proof'],
  },
};

export function compileFailureKnowledge(failure: FailureObservation): FailureKnowledgePackage {
  validateFailure(failure);
  const base = failure.category === 'UNKNOWN'
    ? {
      invariant: 'The observed failure must not recur after a human-authored invariant is approved.',
      regressionTest: 'Manual test specification required.',
      adversarialTest: 'Manual adversarial specification required.',
      runtimeMonitor: 'Manual monitor specification required.',
      recertificationTrigger: 'Require human triage and explicit recertification scope.',
      automatic: false,
      limitations: ['unknown failures cannot be compiled safely without expert interpretation'],
    }
    : KNOWLEDGE[failure.category];
  const partial = {
    packageId: `failure-knowledge:${failure.failureId}`,
    tenantId: failure.tenantId,
    sourceFailureId: failure.failureId,
    ...base,
  };
  return { ...partial, digest: sha256(partial) };
}

function validateFailure(failure: FailureObservation): void {
  if (failure.failureId.trim() === '') throw new Error('failure_id_required');
  if (failure.tenantId.trim() === '') throw new Error('tenant_id_required');
  if (failure.sourceSystem.trim() === '') throw new Error('failure_source_required');
  if (failure.subject.trim() === '') throw new Error('failure_subject_required');
  if (!Number.isFinite(Date.parse(failure.observedAt))) throw new Error('invalid_failure_time');
  if (failure.evidenceRefs.length === 0) throw new Error('failure_evidence_required');
}
