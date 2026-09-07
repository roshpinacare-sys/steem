import { randomUUID } from 'node:crypto';
import {
  evidenceDigest,
  validateActionPassport,
  validateEvidenceRecord,
  validatePromotionDecision,
  type ActionPassport,
  type EvidenceRecord,
  type PromotionDecision,
  type SignedAuthorityGrant,
} from '../contracts/canonical.js';
import { signEnvelope, sha256, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import {
  commitmentDigest,
  validateEngineeringCommitment,
  validateRequirement,
  type CertificationResult,
    type EngineeringCommitment,
  type RequirementContract,
  type RequirementResult,
} from '../contracts/system.js';
import { inventoryRepository, type RepositoryInventory } from '../capabilities/repository-inventory.js';
import { DurableRuntimeEngine } from '../runtime/engine.js';
import { DigitalThread } from '../platform/digital-thread.js';
import { DomainPackRegistry } from '../platform/domain-pack.js';
import type { GeneratedDomainPack } from '../platform/domain-pack-generator.js';
import { compileFailureKnowledge, type FailureKnowledgePackage, type FailureObservation } from '../platform/failure-knowledge.js';
import { toOpenLineageCompleteEvent, toSlsaLikeProvenance, type OpenLineageRunEvent, type SlsaLikeProvenance } from '../platform/standards-adapters.js';

export interface IntegratedCommitmentResult {
  readonly commitment: EngineeringCommitment;
  readonly inventory: RepositoryInventory;
  readonly certification: CertificationResult;
  readonly decision: PromotionDecision;
  readonly passport: SignedEnvelope<ActionPassport>;
  readonly digitalThreadRoot: string;
  readonly openLineage: OpenLineageRunEvent;
  readonly provenance: SlsaLikeProvenance;
  readonly failureKnowledge: readonly FailureKnowledgePackage[];
}

export async function runIntegratedEngineeringCommitment(options: {
  readonly engine: DurableRuntimeEngine;
  readonly signedGrant: SignedAuthorityGrant;
  readonly repositoryRoot: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly builderId: string;
  readonly reviewerId: string;
  readonly workerId: string;
  readonly passportSigner: SigningIdentity;
  readonly domainPack: GeneratedDomainPack;
  readonly requirements: readonly RequirementContract[];
  readonly observedFailures?: readonly FailureObservation[];
  readonly now?: Date;
}): Promise<IntegratedCommitmentResult> {
  const now = options.now ?? new Date();
  const domainRegistry = new DomainPackRegistry();
  const registeredPack = domainRegistry.registerApproved(options.domainPack);
  for (const requirement of options.requirements) {
    validateRequirement(requirement);
    if (requirement.tenantId !== options.tenantId) throw new Error('cross_tenant_requirement');
  }
  if (options.requirements.length === 0) throw new Error('requirement_required');

  const commitment: EngineeringCommitment = {
    commitmentId: randomUUID(),
    tenantId: options.tenantId,
    subjectId: options.subjectId,
    builderId: options.builderId,
    domainPackId: registeredPack.manifest.packId,
    goal: 'Produce a read-only repository inventory with evidence-qualified shadow certification.',
    authorityGrantDigest: sha256(options.signedGrant),
    requirementIds: options.requirements.map((requirement) => requirement.requirementId),
    promotionCeiling: 'shadow',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
  };
  validateEngineeringCommitment(commitment, now);

  const missionId = randomUUID();
  options.engine.createAuthorizedMission(options.signedGrant, {
    missionId,
    tenantId: options.tenantId,
    subjectId: options.subjectId,
    builderId: options.builderId,
    scope: 'repository.read',
    effectKey: `engineering-inventory:${options.tenantId}:${commitment.commitmentId}`,
    approvalRequired: true,
  }, now);

  const firstLease = options.engine.acquire(missionId, options.workerId, 30_000, now.getTime());
  if (options.engine.prepare(firstLease, { commitmentId: commitment.commitmentId }, now.getTime()) !== null) {
    throw new Error('approval_gate_not_enforced');
  }
  const waiting = options.engine.store.getMission(missionId);
  options.engine.approve(missionId, options.reviewerId, waiting.revision, new Date(now.getTime() + 1));
  const lease = options.engine.acquire(missionId, options.workerId, 30_000, now.getTime() + 2);
  const outbox = options.engine.prepare(lease, {
    commitmentId: commitment.commitmentId,
    capability: 'repository.inventory',
    root: options.repositoryRoot,
  }, now.getTime() + 2);
  if (outbox === null) throw new Error('approved_mission_missing_outbox');
  const receipt = await options.engine.execute(outbox, lease, async (payload) => {
    if (payload.capability !== 'repository.inventory' || typeof payload.root !== 'string') throw new Error('unsupported_capability_payload');
    return inventoryRepository(payload.root) as unknown as Readonly<Record<string, unknown>>;
  }, { now: new Date(now.getTime() + 3) });
  const inventory = receipt.result as unknown as RepositoryInventory;

  const evidence: EvidenceRecord = {
    recordId: `engineering-inventory:${commitment.commitmentId}`,
    tenantId: options.tenantId,
    kind: 'engineering-repository-inventory',
    subject: commitment.commitmentId,
    payload: {
      fileCount: inventory.fileCount,
      totalBytes: inventory.totalBytes,
      treeDigest: inventory.treeDigest,
      physicalClaimAllowed: false,
      domainPackDigest: registeredPack.manifestDigest,
    },
    evidenceClass: 'COMPUTED',
    method: 'canonical.integratedEngineeringCommitment.v1',
    environment: { runtime: 'node', storage: 'sqlite-proof', isolation: 'read-only-capability-contract' },
    createdAt: new Date(now.getTime() + 4).toISOString(),
    limitations: ['computed-inventory-does-not-prove-correctness', 'no-production-isolation'],
  };
  validateEvidenceRecord(evidence);
  const evidenceRoot = options.engine.appendEvidence(evidence);

  const requirementResults = evaluateRequirements(options.requirements, evidence, inventory);
  const hasFailure = requirementResults.some((result) => result.status === 'FAIL');
  const hasInconclusive = requirementResults.some((result) => result.status === 'INCONCLUSIVE');
  const certification: CertificationResult = {
    certificationId: randomUUID(),
    tenantId: options.tenantId,
    commitmentId: commitment.commitmentId,
    requirementResults,
    decision: hasFailure ? 'FAIL' : hasInconclusive ? 'INCONCLUSIVE' : 'PASS',
    evidenceRoot,
    reviewerIds: [options.reviewerId],
    createdAt: new Date(now.getTime() + 5).toISOString(),
    limitations: ['repository-inventory-scope-only', 'shadow-only'],
  };
  if (certification.decision !== 'PASS') throw new Error(`certification_${certification.decision.toLowerCase()}`);

  const mission = options.engine.store.getMission(missionId);
  const decision: PromotionDecision = {
    candidateId: commitment.commitmentId,
    tenantId: options.tenantId,
    fromState: 'research',
    toState: 'shadow',
    builderId: options.builderId,
    reviewerIds: [options.reviewerId],
    evidenceRoot,
    residualRisk: ['sqlite-proof', 'no-production-sandbox', 'inventory-only'],
    rollbackRef: `rollback:${commitment.commitmentId}`,
    expectedRevision: mission.revision,
  };
  validatePromotionDecision(decision);

  const passportPayload: ActionPassport = {
    passportId: randomUUID(),
    tenantId: options.tenantId,
    subject: commitment.commitmentId,
    authorityGrantDigest: commitment.authorityGrantDigest,
    evidenceRoot,
    promotionState: 'shadow',
    issuedAt: new Date(now.getTime() + 6).toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    reviewerIds: [options.reviewerId],
    limitations: ['attestation-is-not-claim-truth', 'shadow-only'],
  };
  validateActionPassport(passportPayload, now);
  const passport = signEnvelope(passportPayload, options.passportSigner);

  const thread = buildThread({ commitment, requirements: options.requirements, missionId, evidence, certification, passportDigest: sha256(passport), now });
  const verification = thread.verify(options.tenantId);
  if (!verification.ok) throw new Error('digital_thread_invalid');

  const failureKnowledge = (options.observedFailures ?? []).map(compileFailureKnowledge);
  const openLineage = toOpenLineageCompleteEvent({
    commitment,
    evidence,
    artifactNames: [`repository-tree:${inventory.treeDigest}`],
  });
  const provenance = toSlsaLikeProvenance({
    commitment,
    artifactName: `repository-tree:${commitment.commitmentId}`,
    artifactDigest: inventory.treeDigest,
    builderId: options.builderId,
    startedOn: commitment.createdAt,
    finishedOn: evidence.createdAt,
    dependencyDigests: {
      [`domain-pack:${options.domainPack.manifest.packId}@${options.domainPack.manifest.version}`]: registeredPack.manifestDigest,
      [`authority-grant:${options.signedGrant.payload.grantId}`]: sha256(options.signedGrant),
    },
  });

  return { commitment, inventory, certification, decision, passport, digitalThreadRoot: verification.root, openLineage, provenance, failureKnowledge };
}

function evaluateRequirements(
  requirements: readonly RequirementContract[],
  evidence: EvidenceRecord,
  inventory: RepositoryInventory,
): readonly RequirementResult[] {
  return requirements.map((requirement) => {
    const evidenceClassSatisfied = requirement.requiredEvidenceClasses.includes(evidence.evidenceClass);
    const minimumFiles = typeof requirement.acceptanceCriteria.minimumFiles === 'number'
      ? requirement.acceptanceCriteria.minimumFiles
      : undefined;
    const acceptanceSatisfied = minimumFiles === undefined || inventory.fileCount >= minimumFiles;
    const status = !evidenceClassSatisfied ? 'INCONCLUSIVE' : acceptanceSatisfied ? 'PASS' : 'FAIL';
    return {
      requirementId: requirement.requirementId,
      status,
      evidenceRecordIds: [evidence.recordId],
      explanation: status === 'PASS'
        ? 'Required evidence class and acceptance criteria were satisfied.'
        : !evidenceClassSatisfied
          ? 'Available evidence class does not satisfy the requirement.'
          : 'Acceptance criteria were not satisfied.',
    } as const;
  });
}

function buildThread(options: {
  readonly commitment: EngineeringCommitment;
  readonly requirements: readonly RequirementContract[];
  readonly missionId: string;
  readonly evidence: EvidenceRecord;
  readonly certification: CertificationResult;
  readonly passportDigest: string;
  readonly now: Date;
}): DigitalThread {
  const thread = new DigitalThread();
  const tenantId = options.commitment.tenantId;
  const createdAt = options.now.toISOString();
  const nodes = [
    { nodeId: `authority:${options.commitment.authorityGrantDigest}`, tenantId, kind: 'AUTHORITY_GRANT', subject: options.commitment.subjectId, payloadDigest: options.commitment.authorityGrantDigest, createdAt },
    { nodeId: `commitment:${options.commitment.commitmentId}`, tenantId, kind: 'COMMITMENT', subject: options.commitment.goal, payloadDigest: commitmentDigest(options.commitment), createdAt },
    { nodeId: `mission:${options.missionId}`, tenantId, kind: 'MISSION', subject: options.missionId, payloadDigest: sha256({ missionId: options.missionId }), createdAt },
    { nodeId: `evidence:${options.evidence.recordId}`, tenantId, kind: 'EVIDENCE', subject: options.evidence.subject, payloadDigest: evidenceDigest(options.evidence), createdAt },
    { nodeId: `certification:${options.certification.certificationId}`, tenantId, kind: 'CERTIFICATION', subject: options.certification.commitmentId, payloadDigest: sha256(options.certification), createdAt },
    { nodeId: `passport:${options.passportDigest}`, tenantId, kind: 'PASSPORT', subject: options.commitment.commitmentId, payloadDigest: options.passportDigest, createdAt },
  ] as const;
  for (const node of nodes) thread.addNode(node);
  for (const requirement of options.requirements) {
    thread.addNode({
      nodeId: `requirement:${requirement.requirementId}`,
      tenantId,
      kind: 'REQUIREMENT',
      subject: requirement.statement,
      payloadDigest: sha256(requirement),
      createdAt,
    });
  }
  let sequence = 0;
  const edge = (fromNodeId: string, toNodeId: string, relation: Parameters<DigitalThread['addEdge']>[0]['relation']) => {
    sequence += 1;
    thread.addEdge({ edgeId: `edge:${sequence}`, tenantId, fromNodeId, toNodeId, relation, createdAt });
  };
  edge(`commitment:${options.commitment.commitmentId}`, `authority:${options.commitment.authorityGrantDigest}`, 'AUTHORIZED_BY');
  for (const requirement of options.requirements) edge(`commitment:${options.commitment.commitmentId}`, `requirement:${requirement.requirementId}`, 'REQUIRES');
  edge(`commitment:${options.commitment.commitmentId}`, `mission:${options.missionId}`, 'EXECUTED_AS');
  edge(`mission:${options.missionId}`, `evidence:${options.evidence.recordId}`, 'PRODUCED');
  edge(`evidence:${options.evidence.recordId}`, `certification:${options.certification.certificationId}`, 'SUPPORTS');
  edge(`certification:${options.certification.certificationId}`, `passport:${options.passportDigest}`, 'ATTESTED_BY');
  return thread;
}
