import { randomUUID } from 'node:crypto';
import {
  evidenceDigest,
  validateActionPassport,
  validatePromotionDecision,
  type ActionPassport,
  type EvidenceRecord,
  type PromotionDecision,
  type SignedAuthorityGrant,
} from '../contracts/canonical.js';
import { signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import { inventoryRepository, type RepositoryInventory } from '../capabilities/repository-inventory.js';
import { DurableRuntimeEngine } from '../runtime/engine.js';

export interface ShadowCommitmentResult {
  readonly missionId: string;
  readonly inventory: RepositoryInventory;
  readonly evidenceRoot: string;
  readonly decision: PromotionDecision;
  readonly passport: SignedEnvelope<ActionPassport>;
}

export async function runRepositoryShadowCommitment(options: {
  engine: DurableRuntimeEngine;
  signedGrant: SignedAuthorityGrant;
  repositoryRoot: string;
  tenantId: string;
  subjectId: string;
  builderId: string;
  reviewerId: string;
  workerId: string;
  passportSigner: SigningIdentity;
  now?: Date;
}): Promise<ShadowCommitmentResult> {
  const now = options.now ?? new Date();
  const missionId = randomUUID();
  const effectKey = `repository-inventory:${options.tenantId}:${randomUUID()}`;
  options.engine.createAuthorizedMission(options.signedGrant, {
    missionId,
    tenantId: options.tenantId,
    subjectId: options.subjectId,
    builderId: options.builderId,
    scope: 'repository.read',
    effectKey,
    approvalRequired: true,
  }, now);

  const firstLease = options.engine.acquire(missionId, options.workerId, 30_000, now.getTime());
  const waiting = options.engine.prepare(firstLease, {
    capability: 'repository.inventory',
    root: options.repositoryRoot,
    promotion: 'shadow',
  }, now.getTime());
  if (waiting !== null) throw new Error('approval_gate_not_enforced');

  const waitingMission = options.engine.store.getMission(missionId);
  options.engine.approve(missionId, options.reviewerId, waitingMission.revision, new Date(now.getTime() + 1));
  const lease = options.engine.acquire(missionId, options.workerId, 30_000, now.getTime() + 2);
  const outbox = options.engine.prepare(lease, {
    capability: 'repository.inventory',
    root: options.repositoryRoot,
    promotion: 'shadow',
  }, now.getTime() + 2);
  if (outbox === null) throw new Error('approved_mission_missing_outbox');

  const receipt = await options.engine.execute(outbox, lease, async (payload) => {
    if (payload.capability !== 'repository.inventory' || typeof payload.root !== 'string') {
      throw new Error('unsupported_capability_payload');
    }
    const inventory = await inventoryRepository(payload.root);
    return {
      root: inventory.root,
      fileCount: inventory.fileCount,
      totalBytes: inventory.totalBytes,
      files: inventory.files,
      treeDigest: inventory.treeDigest,
    };
  }, { now: new Date(now.getTime() + 3) });

  const inventory = receipt.result as unknown as RepositoryInventory;
  const computedEvidence: EvidenceRecord = {
    recordId: `inventory:${missionId}`,
    tenantId: options.tenantId,
    kind: 'repository-inventory',
    subject: missionId,
    payload: {
      fileCount: inventory.fileCount,
      totalBytes: inventory.totalBytes,
      treeDigest: inventory.treeDigest,
      physicalClaimAllowed: false,
    },
    evidenceClass: 'COMPUTED',
    method: 'canonical.repositoryInventory.v1',
    environment: { runtime: 'node', sideEffects: 'read-only' },
    createdAt: new Date(now.getTime() + 4).toISOString(),
    limitations: ['inventory-does-not-prove-code-correctness'],
  };
  const evidenceRoot = options.engine.appendEvidence(computedEvidence);
  const chain = options.engine.store.verifyEvidenceChain(options.tenantId);
  if (!chain.ok || chain.root !== evidenceRoot) throw new Error('evidence_chain_invalid');

  const mission = options.engine.store.getMission(missionId);
  const decision: PromotionDecision = {
    candidateId: missionId,
    tenantId: options.tenantId,
    fromState: 'research',
    toState: 'shadow',
    builderId: options.builderId,
    reviewerIds: [options.reviewerId],
    evidenceRoot,
    residualRisk: ['no-os-sandbox', 'sqlite-only-proof', 'no-production-promotion'],
    rollbackRef: `rollback:${missionId}`,
    expectedRevision: mission.revision,
  };
  validatePromotionDecision(decision);

  const passportPayload: ActionPassport = {
    passportId: randomUUID(),
    tenantId: options.tenantId,
    subject: missionId,
    authorityGrantDigest: evidenceDigest({
      ...computedEvidence,
      recordId: `authority-link:${missionId}`,
      kind: 'authority-link',
      payload: { grantId: options.signedGrant.payload.grantId },
      evidenceClass: 'ATTESTED',
      method: 'canonical.authorityLink.v1',
      createdAt: new Date(now.getTime() + 5).toISOString(),
    }),
    evidenceRoot,
    promotionState: 'shadow',
    issuedAt: new Date(now.getTime() + 6).toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    reviewerIds: [options.reviewerId],
    limitations: ['shadow-only', 'attestation-is-not-claim-truth'],
  };
  validateActionPassport(passportPayload, now);
  return {
    missionId,
    inventory,
    evidenceRoot,
    decision,
    passport: signEnvelope(passportPayload, options.passportSigner),
  };
}
