import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { ActionPassport, AuthorityGrant } from '../contracts/canonical.js';
import {
  KeyRegistry,
  type SignedEnvelope,
  type SigningIdentity,
  sha256,
  sha256Bytes,
  signEnvelope,
} from '../contracts/crypto.js';
import { KeyLifecycleRegistry, type PurposeBoundEnvelope, type TrustSnapshot } from '../security/key-lifecycle.js';
import {
  buildPushApprovalCard,
  compileChatMission,
  recordApprovalDecision,
  type ApprovalDecisionInput,
  type ApprovalDecisionRecord,
  type ApprovalPolicy,
  type ChatMissionRequest,
  type CompiledChatMission,
  type PushApprovalCard,
} from '../product/chat-mission.js';
import { scanRepositorySecurity, type SecurityFinding } from './security-scan.js';

export interface FileReplacementV33_9 {
  readonly targetFile: string;
  readonly exactBefore: string;
  readonly exactAfter: string;
}

export interface MultiFileChangePlanV33_9 {
  readonly planId: string;
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly builderId: string;
  readonly objective: string;
  readonly sourceRepository: string;
  readonly allowedFiles: readonly string[];
  readonly replacements: readonly FileReplacementV33_9[];
  readonly testCommand: readonly ['node', '--test'];
  readonly repositoryTrust: 'trusted-fixture' | 'first-party-reviewed';
  readonly testExecutionBoundary: 'trusted-local-process';
}

export type MultiFileSessionStatusV33_9 =
  | 'INTAKE_COMPLETE'
  | 'MODIFIED'
  | 'TESTED'
  | 'AWAITING_REVIEW'
  | 'APPROVED_SHADOW'
  | 'ROLLED_BACK'
  | 'FAILED';

export interface MultiFileTestExecutionV33_9 {
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly passed: boolean;
}

export interface MultiFileManifestV33_9 {
  readonly sessionId: string;
  readonly planDigest: string;
  readonly baseCommit: string;
  readonly changedFiles: readonly string[];
  readonly fileDigests: readonly {
    readonly targetFile: string;
    readonly beforeDigest: string;
    readonly afterDigest: string;
  }[];
  readonly patchDigest: string;
  readonly rollbackDigest: string;
  readonly generatedAt: string;
}

export interface MultiFileSessionStateV33_9 {
  readonly version: '33.9';
  readonly sessionId: string;
  readonly status: MultiFileSessionStatusV33_9;
  readonly plan: MultiFileChangePlanV33_9;
  readonly planDigest: string;
  readonly sourceRepository: string;
  readonly workspace: string;
  readonly artifactDirectory: string;
  readonly baseCommit: string;
  readonly intakeFindings: readonly SecurityFinding[];
  readonly changedFiles: readonly string[];
  readonly expectedFileDigests: Readonly<Record<string, string>>;
  readonly originalFileDigests: Readonly<Record<string, string>>;
  readonly testExecution?: MultiFileTestExecutionV33_9;
  readonly manifest?: MultiFileManifestV33_9;
  readonly evidenceRoot?: string;
  readonly unsupportedClaims: readonly string[];
  readonly reviewerId?: string;
  readonly passport?: PurposeBoundEnvelope<ActionPassport>;
  readonly trustSnapshot?: TrustSnapshot;
  readonly failure?: string;
  readonly stateDigest: string;
}

export interface MultiFileEngineeringPreparationV33_9 {
  readonly version: '33.9';
  readonly mission: CompiledChatMission;
  readonly approvalCard?: PushApprovalCard;
  readonly approvalDecision?: ApprovalDecisionRecord;
  readonly changeSessionId: string;
  readonly changeStatus: 'AWAITING_REVIEW';
  readonly evidenceRoot: string;
  readonly changedFiles: readonly string[];
  readonly testPassed: true;
  readonly reviewRequired: true;
  readonly externalGitMutationExecuted: false;
  readonly externalEffectsExecuted: 0;
  readonly preparationDigest: string;
}

export interface PullRequestProposalV33_9 {
  readonly version: '33.9';
  readonly proposalId: string;
  readonly tenantId: string;
  readonly missionId: string;
  readonly changeSessionId: string;
  readonly sourceRepositoryDigest: string;
  readonly baseCommit: string;
  readonly proposedHeadRef: string;
  readonly title: string;
  readonly changedFiles: readonly string[];
  readonly fileDigests: MultiFileManifestV33_9['fileDigests'];
  readonly patchDigest: string;
  readonly rollbackDigest: string;
  readonly evidenceRoot: string;
  readonly actionPassportDigest: string;
  readonly reviewerId: string;
  readonly builderId: string;
  readonly requesterId: string;
  readonly createdAt: string;
  readonly promotionCeiling: 'shadow';
  readonly externalGitMutationExecuted: false;
  readonly mergeExecuted: false;
  readonly deploymentExecuted: false;
  readonly externalEffectsExecuted: 0;
  readonly proposalDigest: string;
}

export interface ReviewedMultiFileMissionV33_9 {
  readonly version: '33.9';
  readonly approvedState: MultiFileSessionStateV33_9;
  readonly pullRequestProposal: SignedEnvelope<PullRequestProposalV33_9>;
  readonly externalEffectsExecuted: 0;
  readonly resultDigest: string;
}

export interface ShadowGitSubmissionV33_9 {
  readonly version: '33.9';
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly requesterId: string;
  readonly adapterId: string;
  readonly proposal: SignedEnvelope<PullRequestProposalV33_9>;
  readonly submittedAt: string;
  readonly requestDigest: string;
}

export interface ShadowGitReceiptV33_9 {
  readonly version: '33.9';
  readonly receiptId: string;
  readonly providerId: string;
  readonly adapterId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly proposalId: string;
  readonly proposedHeadRef: string;
  readonly branchOwner: string;
  readonly status: 'ACCEPTED_SHADOW' | 'CANCELLED';
  readonly acceptedAt: string;
  readonly cancelledAt?: string;
  readonly externalGitMutationExecuted: false;
  readonly mergeExecuted: false;
  readonly deploymentExecuted: false;
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

interface ShadowProviderRecordV33_9 {
  readonly requestDigest: string;
  readonly request: ShadowGitSubmissionV33_9;
  readonly receipt: SignedEnvelope<ShadowGitReceiptV33_9>;
}

interface ShadowProviderStateV33_9 {
  readonly version: '33.9';
  readonly providerId: string;
  readonly adapterId: string;
  readonly records: readonly ShadowProviderRecordV33_9[];
  readonly branchOwners: Readonly<Record<string, string>>;
  readonly generatedAt: string;
  readonly stateDigest: string;
}

export async function prepareMultiFileEngineeringMissionV33_9(input: {
  readonly request: ChatMissionRequest;
  readonly grant: AuthorityGrant;
  readonly policy: ApprovalPolicy;
  readonly plan: MultiFileChangePlanV33_9;
  readonly sessionsRoot: string;
  readonly approvalDecision?: ApprovalDecisionInput;
  readonly now?: Date;
}): Promise<MultiFileEngineeringPreparationV33_9> {
  const now = input.now ?? new Date();
  validDate(now);
  validateMissionPlanBinding(input.request, input.grant, input.plan);
  const mission = compileChatMission(input.request, input.grant, input.policy, now);
  let approvalCard: PushApprovalCard | undefined;
  let approvalDecision: ApprovalDecisionRecord | undefined;
  if (mission.approvalRequired) {
    approvalCard = buildPushApprovalCard(mission, input.policy);
    if (input.approvalDecision === undefined) throw new Error('multi_file_approval_required');
    approvalDecision = recordApprovalDecision(approvalCard, input.approvalDecision, now);
    if (approvalDecision.outcome !== 'APPROVED') throw new Error(`multi_file_not_approved:${approvalDecision.outcome}`);
    if (sha256(approvalDecision.approvedScopes) !== sha256(mission.requestedScopes)) throw new Error('multi_file_approval_scope_mismatch');
  } else if (input.approvalDecision !== undefined) {
    throw new Error('multi_file_unexpected_approval');
  }
  const state = await executeMultiFileChangePlanV33_9(input.plan, { sessionsRoot: input.sessionsRoot });
  if (state.status !== 'AWAITING_REVIEW' || state.evidenceRoot === undefined || state.testExecution?.passed !== true) throw new Error('multi_file_preparation_incomplete');
  const material = {
    version: '33.9' as const,
    mission,
    ...(approvalCard === undefined ? {} : { approvalCard }),
    ...(approvalDecision === undefined ? {} : { approvalDecision }),
    changeSessionId: state.sessionId,
    changeStatus: 'AWAITING_REVIEW' as const,
    evidenceRoot: state.evidenceRoot,
    changedFiles: state.changedFiles,
    testPassed: true as const,
    reviewRequired: true as const,
    externalGitMutationExecuted: false as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, preparationDigest: sha256(material) };
}

export async function executeMultiFileChangePlanV33_9(
  plan: MultiFileChangePlanV33_9,
  options: { readonly sessionsRoot: string; readonly timeoutMs?: number },
): Promise<MultiFileSessionStateV33_9> {
  validatePlan(plan);
  const planDigest = sha256(plan);
  const sessionId = sha256({ tenantId: plan.tenantId, idempotencyKey: plan.idempotencyKey }).slice(0, 24);
  const sessionRoot = join(resolve(options.sessionsRoot), sessionId);
  const statePath = join(sessionRoot, 'state.json');
  if (existsSync(statePath)) {
    const existing = readState(statePath);
    if (existing.planDigest !== planDigest) throw new Error('multi_file_idempotency_payload_conflict');
    return existing;
  }
  mkdirSync(sessionRoot, { recursive: true });
  const sourceRepository = resolve(plan.sourceRepository);
  ensureGitRepository(sourceRepository);
  const workspace = join(sessionRoot, 'workspace');
  const artifactDirectory = join(sessionRoot, 'artifacts');
  cloneRepository(sourceRepository, workspace);
  mkdirSync(artifactDirectory, { recursive: true });
  const baseCommit = git(workspace, ['rev-parse', 'HEAD']).stdout.trim();
  const findings = await scanRepositorySecurity(workspace);
  let state = withStateDigest({
    version: '33.9', sessionId, status: 'INTAKE_COMPLETE', plan, planDigest, sourceRepository,
    workspace, artifactDirectory, baseCommit, intakeFindings: findings, changedFiles: [], expectedFileDigests: {}, originalFileDigests: {},
    unsupportedClaims: [
      'shadow-only', 'no-external-git-mutation', 'no-real-pull-request-created',
      'trusted-local-process-only', 'untrusted-repositories-require-qualified-isolation',
      'multi-file-plan-is-explicit-not-autonomous-code-generation',
    ],
  });
  writeState(statePath, state);
  try {
    const originalFileDigests = applyReplacementsAtomically(workspace, plan.replacements);
    const changedFiles = listChangedFiles(workspace);
    enforceChangedFileScope(changedFiles, plan.allowedFiles, plan.replacements.map((row) => row.targetFile));
    const expectedFileDigests = Object.fromEntries(plan.replacements.map((row) => [row.targetFile, sha256Bytes(readFileSync(resolveWithin(workspace, row.targetFile)))]));
    state = withStateDigest({ ...withoutDigest(state), status: 'MODIFIED', changedFiles, expectedFileDigests, originalFileDigests });
    writeState(statePath, state);

    const testExecution = runTests(workspace, options.timeoutMs ?? 30_000);
    if (!testExecution.passed) throw new Error(`multi_file_test_failed:${testExecution.exitCode ?? testExecution.signal ?? 'unknown'}`);
    const postTestChanged = listChangedFiles(workspace);
    enforceChangedFileScope(postTestChanged, plan.allowedFiles, plan.replacements.map((row) => row.targetFile));
    for (const [file, digest] of Object.entries(expectedFileDigests)) {
      if (sha256Bytes(readFileSync(resolveWithin(workspace, file))) !== digest) throw new Error(`multi_file_test_modified_target:${file}`);
    }
    state = withStateDigest({ ...withoutDigest(state), status: 'TESTED', changedFiles: postTestChanged, testExecution });
    writeState(statePath, state);

    const patch = git(workspace, ['diff', '--binary', '--no-ext-diff']).stdout;
    const rollback = git(workspace, ['diff', '--binary', '--no-ext-diff', '-R']).stdout;
    if (patch.trim() === '') throw new Error('multi_file_empty_patch');
    const fileDigests = plan.replacements.map((row) => ({
      targetFile: row.targetFile,
      beforeDigest: originalFileDigests[row.targetFile] ?? (() => { throw new Error(`multi_file_original_digest_missing:${row.targetFile}`); })(),
      afterDigest: sha256Bytes(readFileSync(resolveWithin(workspace, row.targetFile))),
    }));
    writeFileSync(join(artifactDirectory, 'change.patch'), patch);
    writeFileSync(join(artifactDirectory, 'rollback.patch'), rollback);
    writeFileSync(join(artifactDirectory, 'test-report.json'), JSON.stringify(testExecution, null, 2));
    writeFileSync(join(artifactDirectory, 'security-report.json'), JSON.stringify({ findings }, null, 2));
    const manifest: MultiFileManifestV33_9 = {
      sessionId, planDigest, baseCommit, changedFiles: postTestChanged, fileDigests,
      patchDigest: sha256(patch), rollbackDigest: sha256(rollback), generatedAt: new Date().toISOString(),
    };
    const evidenceRoot = sha256({ manifest, testExecution, findings, unsupportedClaims: state.unsupportedClaims });
    writeFileSync(join(artifactDirectory, 'change-manifest.json'), JSON.stringify(manifest, null, 2));
    state = withStateDigest({ ...withoutDigest(state), status: 'AWAITING_REVIEW', manifest, evidenceRoot });
    writeState(statePath, state);
    return state;
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    try { git(workspace, ['reset', '--hard', baseCommit]); git(workspace, ['clean', '-fd']); } catch { /* retain primary failure */ }
    state = withStateDigest({ ...withoutDigest(state), status: 'FAILED', failure, changedFiles: [], expectedFileDigests: {}, originalFileDigests: {} });
    writeState(statePath, state);
    throw error;
  }
}

export function reviewMultiFileMissionV33_9(input: {
  readonly preparation: MultiFileEngineeringPreparationV33_9;
  readonly sessionsRoot: string;
  readonly reviewerId: string;
  readonly passportSigner: SigningIdentity;
  readonly passportRegistry: KeyLifecycleRegistry;
  readonly proposalSigner: SigningIdentity;
  readonly proposalKeys: KeyRegistry;
  readonly trustedProposalSignerIds: readonly string[];
  readonly now?: Date;
}): ReviewedMultiFileMissionV33_9 {
  const now = input.now ?? new Date();
  validDate(now);
  verifyPreparation(input.preparation);
  const statePath = join(resolve(input.sessionsRoot), input.preparation.changeSessionId, 'state.json');
  const state = readState(statePath);
  if (state.status !== 'AWAITING_REVIEW' || state.evidenceRoot !== input.preparation.evidenceRoot || state.manifest === undefined) throw new Error('multi_file_review_binding_invalid');
  if (input.reviewerId === state.plan.builderId || input.reviewerId === input.preparation.mission.requesterId) throw new Error('multi_file_review_independence_required');
  const passportPayload: ActionPassport = {
    passportId: randomUUID(), tenantId: state.plan.tenantId, subject: state.sessionId,
    authorityGrantDigest: state.planDigest, evidenceRoot: state.evidenceRoot, promotionState: 'shadow',
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    reviewerIds: [input.reviewerId], limitations: state.unsupportedClaims,
  };
  const passport = input.passportRegistry.sign(passportPayload, input.passportSigner, {
    purpose: 'action-passport', environment: 'test', tenantId: state.plan.tenantId,
    nonce: `v33.9:${state.sessionId}:${state.evidenceRoot}`, issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
  });
  const trustSnapshot = input.passportRegistry.snapshot(now);
  const approved = withStateDigest({ ...withoutDigest(state), status: 'APPROVED_SHADOW', reviewerId: input.reviewerId, passport, trustSnapshot });
  writeFileSync(join(state.artifactDirectory, 'action-passport.json'), JSON.stringify(passport, null, 2));
  writeState(statePath, approved);
  const proposalMaterial = {
    version: '33.9' as const,
    proposalId: `pr-proposal-${state.sessionId}`,
    tenantId: state.plan.tenantId,
    missionId: input.preparation.mission.missionId,
    changeSessionId: state.sessionId,
    sourceRepositoryDigest: sha256({ sourceRepository: state.sourceRepository, baseCommit: state.baseCommit }),
    baseCommit: state.baseCommit,
    proposedHeadRef: `sovereign/${input.preparation.mission.missionId}/${state.sessionId}`,
    title: truncate(input.preparation.mission.objective, 80),
    changedFiles: state.manifest.changedFiles,
    fileDigests: state.manifest.fileDigests,
    patchDigest: state.manifest.patchDigest,
    rollbackDigest: state.manifest.rollbackDigest,
    evidenceRoot: state.evidenceRoot,
    actionPassportDigest: sha256(passport),
    reviewerId: input.reviewerId,
    builderId: state.plan.builderId,
    requesterId: input.preparation.mission.requesterId,
    createdAt: now.toISOString(),
    promotionCeiling: 'shadow' as const,
    externalGitMutationExecuted: false as const,
    mergeExecuted: false as const,
    deploymentExecuted: false as const,
    externalEffectsExecuted: 0 as const,
  };
  const proposal: PullRequestProposalV33_9 = { ...proposalMaterial, proposalDigest: sha256(proposalMaterial) };
  if (!input.trustedProposalSignerIds.includes(input.proposalSigner.keyId)) throw new Error('multi_file_proposal_signer_untrusted');
  const envelope = signEnvelope(proposal, input.proposalSigner);
  if (!input.proposalKeys.verifyAt(envelope, now)) throw new Error('multi_file_proposal_signature_invalid');
  writeFileSync(join(state.artifactDirectory, 'pull-request-proposal-v33.9.json'), JSON.stringify(envelope, null, 2));
  const material = { version: '33.9' as const, approvedState: approved, pullRequestProposal: envelope, externalEffectsExecuted: 0 as const };
  return { ...material, resultDigest: sha256(material) };
}

export function verifyPullRequestProposalV33_9(input: {
  readonly envelope: SignedEnvelope<PullRequestProposalV33_9>;
  readonly proposalKeys: KeyRegistry;
  readonly trustedProposalSignerIds: readonly string[];
  readonly at?: Date;
}): boolean {
  const at = input.at ?? new Date(); validDate(at);
  if (!input.trustedProposalSignerIds.includes(input.envelope.issuerKeyId)) return false;
  if (!input.proposalKeys.verifyAt(input.envelope, at)) return false;
  const p = input.envelope.payload; const { proposalDigest, ...material } = p;
  if (sha256(material) !== proposalDigest) return false;
  if (p.changedFiles.length < 2 || p.changedFiles.length > 8 || new Set(p.changedFiles).size !== p.changedFiles.length) return false;
  if (p.fileDigests.length !== p.changedFiles.length) return false;
  if (p.promotionCeiling !== 'shadow' || p.externalGitMutationExecuted || p.mergeExecuted || p.deploymentExecuted || p.externalEffectsExecuted !== 0) return false;
  if (p.reviewerId === p.builderId || p.reviewerId === p.requesterId) return false;
  return true;
}

export function createShadowGitSubmissionV33_9(input: {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly requesterId: string;
  readonly adapterId: string;
  readonly proposal: SignedEnvelope<PullRequestProposalV33_9>;
  readonly submittedAt: string;
}): ShadowGitSubmissionV33_9 {
  const material = { version: '33.9' as const, ...input };
  if (input.requestId.trim()==='' || input.idempotencyKey.trim()==='' || input.requesterId.trim()==='' || input.adapterId.trim()==='') throw new Error('shadow_git_submission_field_required');
  if (input.tenantId !== input.proposal.payload.tenantId) throw new Error('shadow_git_submission_tenant_mismatch');
  validDate(new Date(input.submittedAt));
  return { ...material, requestDigest: sha256(material) };
}

export class ShadowGitProviderV33_9 {
  readonly #storePath: string;
  readonly #providerId: string;
  readonly #adapterId: string;
  readonly #signer: SigningIdentity;
  readonly #providerKeys: KeyRegistry;
  readonly #proposalKeys: KeyRegistry;
  readonly #trustedProposalSignerIds: readonly string[];
  readonly #trustedProviderSignerIds: readonly string[];
  #state: ShadowProviderStateV33_9;

  constructor(input: {
    readonly storePath: string;
    readonly providerId: string;
    readonly adapterId: string;
    readonly signer: SigningIdentity;
    readonly providerKeys: KeyRegistry;
    readonly proposalKeys: KeyRegistry;
    readonly trustedProposalSignerIds: readonly string[];
    readonly trustedProviderSignerIds: readonly string[];
  }) {
    if (!input.trustedProviderSignerIds.includes(input.signer.keyId)) throw new Error('shadow_git_provider_signer_untrusted');
    this.#storePath=resolve(input.storePath); this.#providerId=input.providerId; this.#adapterId=input.adapterId;
    this.#signer=input.signer; this.#providerKeys=input.providerKeys; this.#proposalKeys=input.proposalKeys;
    this.#trustedProposalSignerIds=[...input.trustedProposalSignerIds]; this.#trustedProviderSignerIds=[...input.trustedProviderSignerIds];
    this.#state=this.#loadOrInitialize();
  }

  accept(request: ShadowGitSubmissionV33_9, now=new Date()): SignedEnvelope<ShadowGitReceiptV33_9> {
    validDate(now); this.#verifyRequest(request, now);
    const existing=this.#state.records.find((row)=>row.request.idempotencyKey===request.idempotencyKey && row.request.tenantId===request.tenantId);
    if (existing!==undefined) {
      if (existing.requestDigest!==request.requestDigest) throw new Error('shadow_git_idempotency_conflict');
      return existing.receipt;
    }
    const branchKey=sha256({tenantId:request.tenantId,adapterId:request.adapterId,headRef:request.proposal.payload.proposedHeadRef});
    const owner=this.#state.branchOwners[branchKey];
    const desiredOwner=`${request.tenantId}:${request.proposal.payload.proposalDigest}`;
    if (owner!==undefined && owner!==desiredOwner) throw new Error('shadow_git_branch_owned_by_other_proposal');
    const receiptMaterial={
      version:'33.9' as const, receiptId:`shadow-receipt-${sha256(request.requestDigest).slice(0,20)}`,
      providerId:this.#providerId, adapterId:this.#adapterId, requestId:request.requestId,
      idempotencyKey:request.idempotencyKey, tenantId:request.tenantId,
      proposalId:request.proposal.payload.proposalId, proposedHeadRef:request.proposal.payload.proposedHeadRef,
      branchOwner:desiredOwner, status:'ACCEPTED_SHADOW' as const, acceptedAt:now.toISOString(),
      externalGitMutationExecuted:false as const, mergeExecuted:false as const,
      deploymentExecuted:false as const, externalEffectsExecuted:0 as const,
    };
    const receipt:ShadowGitReceiptV33_9={...receiptMaterial,receiptDigest:sha256(receiptMaterial)};
    const envelope=signEnvelope(receipt,this.#signer);
    if (!this.#providerKeys.verifyAt(envelope,now)) throw new Error('shadow_git_receipt_signature_invalid');
    const records=[...this.#state.records,{requestDigest:request.requestDigest,request,receipt:envelope}];
    const branchOwners={...this.#state.branchOwners,[branchKey]:desiredOwner};
    this.#state=withProviderDigest({version:'33.9',providerId:this.#providerId,adapterId:this.#adapterId,records,branchOwners,generatedAt:now.toISOString()});
    this.#persist();
    return envelope;
  }

  cancel(input:{readonly tenantId:string;readonly idempotencyKey:string;readonly requesterId:string;readonly cancelledAt:string}):SignedEnvelope<ShadowGitReceiptV33_9>{
    const at=new Date(input.cancelledAt);validDate(at);
    const index=this.#state.records.findIndex((row)=>row.request.tenantId===input.tenantId&&row.request.idempotencyKey===input.idempotencyKey);
    if(index<0)throw new Error('shadow_git_record_not_found');
    const record=this.#state.records[index];if(record===undefined)throw new Error('shadow_git_record_not_found');
    if(record.request.requesterId!==input.requesterId)throw new Error('shadow_git_cancel_requester_mismatch');
    if(record.receipt.payload.status==='CANCELLED')return record.receipt;
    const prior=record.receipt.payload;
    const material={...prior,status:'CANCELLED' as const,cancelledAt:at.toISOString()};
    const {receiptDigest: _old, ...withoutOld}=material;
    const receipt:ShadowGitReceiptV33_9={...withoutOld,receiptDigest:sha256(withoutOld)};
    const envelope=signEnvelope(receipt,this.#signer);
    const records=this.#state.records.map((row,i)=>i===index?{...row,receipt:envelope}:row);
    this.#state=withProviderDigest({...withoutProviderDigest(this.#state),records,generatedAt:at.toISOString()});
    this.#persist();return envelope;
  }

  snapshot():ShadowProviderStateV33_9{return JSON.parse(JSON.stringify(this.#state)) as ShadowProviderStateV33_9;}

  #verifyRequest(request:ShadowGitSubmissionV33_9,now:Date):void{
    if(request.adapterId!==this.#adapterId)throw new Error('shadow_git_adapter_mismatch');
    const {requestDigest,...material}=request;if(sha256(material)!==requestDigest)throw new Error('shadow_git_request_digest_invalid');
    if(!verifyPullRequestProposalV33_9({envelope:request.proposal,proposalKeys:this.#proposalKeys,trustedProposalSignerIds:this.#trustedProposalSignerIds,at:now}))throw new Error('shadow_git_proposal_invalid');
  }

  #loadOrInitialize():ShadowProviderStateV33_9{
    if(!existsSync(this.#storePath))return withProviderDigest({version:'33.9',providerId:this.#providerId,adapterId:this.#adapterId,records:[],branchOwners:{},generatedAt:new Date(0).toISOString()});
    const envelope=JSON.parse(readFileSync(this.#storePath,'utf8')) as SignedEnvelope<ShadowProviderStateV33_9>;
    if(!this.#trustedProviderSignerIds.includes(envelope.issuerKeyId)||!this.#providerKeys.verifyAt(envelope,new Date()))throw new Error('shadow_git_store_signature_invalid');
    const state=envelope.payload;if(state.providerId!==this.#providerId||state.adapterId!==this.#adapterId)throw new Error('shadow_git_store_identity_mismatch');
    const {stateDigest,...material}=state;if(sha256(material)!==stateDigest)throw new Error('shadow_git_store_digest_invalid');
    const observedBranchOwners:Record<string,string>={};
    for(const row of state.records){
      const {requestDigest,...requestMaterial}=row.request;if(sha256(requestMaterial)!==requestDigest||row.requestDigest!==requestDigest)throw new Error('shadow_git_store_request_invalid');
      if(!verifyPullRequestProposalV33_9({envelope:row.request.proposal,proposalKeys:this.#proposalKeys,trustedProposalSignerIds:this.#trustedProposalSignerIds,at:new Date()}))throw new Error('shadow_git_store_proposal_invalid');
      if(!this.#trustedProviderSignerIds.includes(row.receipt.issuerKeyId)||!this.#providerKeys.verifyAt(row.receipt,new Date()))throw new Error('shadow_git_store_receipt_invalid');
      const receipt=row.receipt.payload;const {receiptDigest,...receiptMaterial}=receipt;if(sha256(receiptMaterial)!==receiptDigest)throw new Error('shadow_git_store_receipt_digest_invalid');
      if(receipt.providerId!==this.#providerId||receipt.adapterId!==this.#adapterId||receipt.requestId!==row.request.requestId||receipt.idempotencyKey!==row.request.idempotencyKey||receipt.tenantId!==row.request.tenantId||receipt.proposalId!==row.request.proposal.payload.proposalId||receipt.proposedHeadRef!==row.request.proposal.payload.proposedHeadRef)throw new Error('shadow_git_store_cross_binding_invalid');
      const branchKey=sha256({tenantId:row.request.tenantId,adapterId:row.request.adapterId,headRef:row.request.proposal.payload.proposedHeadRef});
      const desiredOwner=`${row.request.tenantId}:${row.request.proposal.payload.proposalDigest}`;
      if(receipt.branchOwner!==desiredOwner)throw new Error('shadow_git_store_branch_owner_invalid');
      if(observedBranchOwners[branchKey]!==undefined&&observedBranchOwners[branchKey]!==desiredOwner)throw new Error('shadow_git_store_branch_conflict');
      observedBranchOwners[branchKey]=desiredOwner;
    }
    if(sha256(observedBranchOwners)!==sha256(state.branchOwners))throw new Error('shadow_git_store_branch_index_invalid');
    return state;
  }

  #persist():void{
    mkdirSync(dirname(this.#storePath),{recursive:true});
    const envelope=signEnvelope(this.#state,this.#signer);const temporary=`${this.#storePath}.tmp`;
    writeFileSync(temporary,JSON.stringify(envelope,null,2));renameSync(temporary,this.#storePath);
  }
}

export function verifyShadowGitReceiptV33_9(input:{readonly envelope:SignedEnvelope<ShadowGitReceiptV33_9>;readonly providerKeys:KeyRegistry;readonly trustedProviderSignerIds:readonly string[];readonly at?:Date}):boolean{
  const at=input.at??new Date();validDate(at);if(!input.trustedProviderSignerIds.includes(input.envelope.issuerKeyId)||!input.providerKeys.verifyAt(input.envelope,at))return false;
  const r=input.envelope.payload;const {receiptDigest,...material}=r;if(sha256(material)!==receiptDigest)return false;
  return r.externalGitMutationExecuted===false&&r.mergeExecuted===false&&r.deploymentExecuted===false&&r.externalEffectsExecuted===0;
}

export function rollbackMultiFileMissionV33_9(input:{readonly sessionsRoot:string;readonly sessionId:string}):MultiFileSessionStateV33_9{
  const statePath=join(resolve(input.sessionsRoot),input.sessionId,'state.json');const state=readState(statePath);
  if(state.status!=='AWAITING_REVIEW'&&state.status!=='APPROVED_SHADOW')throw new Error('multi_file_rollback_not_eligible');
  const rollbackPath=join(state.artifactDirectory,'rollback.patch');if(!existsSync(rollbackPath))throw new Error('multi_file_rollback_missing');
  git(state.workspace,['apply','--check',rollbackPath]);git(state.workspace,['apply',rollbackPath]);
  if(listChangedFiles(state.workspace).length!==0)throw new Error('multi_file_rollback_not_exact');
  const rolled=withStateDigest({...withoutDigest(state),status:'ROLLED_BACK',changedFiles:[],expectedFileDigests:{},originalFileDigests:{}});writeState(statePath,rolled);return rolled;
}

export function createDisposableMultiFileRepositoryV33_9(root:string,variant=0):string{
  rmSync(root,{recursive:true,force:true});mkdirSync(join(root,'src'),{recursive:true});mkdirSync(join(root,'test'),{recursive:true});
  writeFileSync(join(root,'package.json'),JSON.stringify({name:`multi-fixture-${variant}`,version:'1.0.0',type:'module',scripts:{test:'node --test'}},null,2));
  writeFileSync(join(root,'src','add.js'),`export const add = (a, b) => a - b; // ${variant}\n`);
  writeFileSync(join(root,'src','multiply.js'),`export const multiply = (a, b) => a + b; // ${variant}\n`);
  writeFileSync(join(root,'test','math.test.js'),"import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { add } from '../src/add.js';\nimport { multiply } from '../src/multiply.js';\ntest('add',()=>assert.equal(add(2,3),5));\ntest('multiply',()=>assert.equal(multiply(2,3),6));\n");
  writeFileSync(join(root,'.gitignore'),'node_modules/\n');gitInit(root);return root;
}

function validateMissionPlanBinding(request:ChatMissionRequest,grant:AuthorityGrant,plan:MultiFileChangePlanV33_9):void{
  if(request.tenantId!==grant.tenantId||request.tenantId!==plan.tenantId)throw new Error('multi_file_tenant_binding_invalid');
  if(request.requesterId!==grant.subjectId||request.requesterId!==plan.subjectId)throw new Error('multi_file_subject_binding_invalid');
  if(request.objective.trim()!==plan.objective.trim())throw new Error('multi_file_objective_binding_invalid');
  if(!request.requestedScopes.includes('repository.write')||!grant.scopes.includes('repository.write'))throw new Error('multi_file_repository_scope_required');
  for(const forbidden of ['git.push','git.merge','production.deploy'])if(!request.prohibitedActions.includes(forbidden))throw new Error(`multi_file_prohibited_effect_missing:${forbidden}`);
  for(const criterion of ['tests pass','rollback verified','independent review'])if(!request.completionCriteria.includes(criterion))throw new Error(`multi_file_completion_criterion_missing:${criterion}`);
}

function validatePlan(plan:MultiFileChangePlanV33_9):void{
  for(const value of [plan.planId,plan.idempotencyKey,plan.tenantId,plan.subjectId,plan.builderId,plan.objective,plan.sourceRepository])if(value.trim()==='')throw new Error('multi_file_plan_field_required');
  if(plan.replacements.length<2||plan.replacements.length>8)throw new Error('multi_file_replacement_count_out_of_bounds');
  const targets=plan.replacements.map((row)=>row.targetFile);if(new Set(targets).size!==targets.length)throw new Error('multi_file_duplicate_target');
  if(new Set(plan.allowedFiles).size!==plan.allowedFiles.length)throw new Error('multi_file_duplicate_allowed_file');
  for(const row of plan.replacements){validateRelativePath(row.targetFile);if(row.exactBefore===''||row.exactAfter===''||row.exactBefore===row.exactAfter)throw new Error('multi_file_replacement_invalid');if(!plan.allowedFiles.includes(row.targetFile))throw new Error('multi_file_target_not_allowed');}
  for(const file of plan.allowedFiles)validateRelativePath(file);
  if(plan.testCommand.length!==2||plan.testCommand[0]!=='node'||plan.testCommand[1]!=='--test')throw new Error('multi_file_test_command_not_allowlisted');
}

function applyReplacementsAtomically(workspace:string,replacements:readonly FileReplacementV33_9[]):Readonly<Record<string,string>>{
  const writes:{targetFile:string;path:string;original:string;updated:string}[]=[];
  for(const row of replacements){const path=resolveWithin(workspace,row.targetFile);if(lstatSync(path).isSymbolicLink())throw new Error('multi_file_symlink_target_forbidden');const original=readFileSync(path,'utf8');const occurrences=original.split(row.exactBefore).length-1;if(occurrences!==1)throw new Error(`multi_file_exact_match_count:${row.targetFile}:${occurrences}`);writes.push({targetFile:row.targetFile,path,original,updated:original.replace(row.exactBefore,row.exactAfter)});}
  try{for(const row of writes)writeFileSync(row.path,row.updated);}catch(error){for(const row of writes)writeFileSync(row.path,row.original);throw error;}
  return Object.fromEntries(writes.map((row)=>[row.targetFile,sha256Bytes(Buffer.from(row.original))]));
}

function enforceChangedFileScope(changed:readonly string[],allowed:readonly string[],targets:readonly string[]):void{
  const allowedSet=new Set(allowed);const unauthorized=changed.filter((file)=>!allowedSet.has(file));if(unauthorized.length>0)throw new Error(`multi_file_diff_outside_scope:${unauthorized.join(',')}`);
  const changedSet=new Set(changed);for(const target of targets)if(!changedSet.has(target))throw new Error(`multi_file_target_not_changed:${target}`);
  if(changed.length!==targets.length)throw new Error('multi_file_unexpected_change_count');
}

function runTests(cwd:string,timeoutMs:number):MultiFileTestExecutionV33_9{
  const home=mkdtempSync(join(tmpdir(),'v33-9-home-'));const temp=mkdtempSync(join(tmpdir(),'v33-9-tmp-'));const start=Date.now();
  try{const result=spawnSync(process.execPath,['--test'],{cwd,encoding:'utf8',timeout:timeoutMs,maxBuffer:4*1024*1024,env:{HOME:home,TMPDIR:temp,LANG:process.env.LANG,LC_ALL:process.env.LC_ALL}});return{command:['node','--test'],exitCode:result.status,signal:result.signal,stdout:sanitize(result.stdout),stderr:sanitize(result.stderr),durationMs:Date.now()-start,passed:result.status===0&&result.signal===null};}finally{rmSync(home,{recursive:true,force:true});rmSync(temp,{recursive:true,force:true});}
}

function ensureGitRepository(path:string):void{if(!existsSync(join(path,'.git')))throw new Error('multi_file_source_not_git');git(path,['status','--porcelain=v1']);if(git(path,['status','--porcelain=v1']).stdout.trim()!=='')throw new Error('multi_file_source_not_clean');}
function cloneRepository(source:string,destination:string):void{rmSync(destination,{recursive:true,force:true});const r=spawnSync('git',['clone','--quiet','--no-hardlinks','--',source,destination],{encoding:'utf8',env:hardenedGitEnvironment()});if(r.status!==0)throw new Error(`multi_file_clone_failed:${sanitize(r.stderr)}`);}
function gitInit(root:string):void{spawnSync('git',['init','--quiet'],{cwd:root,env:hardenedGitEnvironment()});spawnSync('git',['config','user.email','fixture@example.invalid'],{cwd:root,env:hardenedGitEnvironment()});spawnSync('git',['config','user.name','Fixture'],{cwd:root,env:hardenedGitEnvironment()});spawnSync('git',['add','.'],{cwd:root,env:hardenedGitEnvironment()});const c=spawnSync('git',['commit','--quiet','-m','fixture baseline'],{cwd:root,encoding:'utf8',env:hardenedGitEnvironment()});if(c.status!==0)throw new Error(`multi_file_fixture_commit_failed:${sanitize(c.stderr)}`);}
function git(cwd:string,args:readonly string[]){const r=spawnSync('git',args,{cwd,encoding:'utf8',maxBuffer:8*1024*1024,env:hardenedGitEnvironment()});if(r.status!==0)throw new Error(`multi_file_git_failed:${args.join(' ')}:${sanitize(r.stderr)}`);return r;}
function hardenedGitEnvironment():NodeJS.ProcessEnv{return{PATH:process.env.PATH,LANG:process.env.LANG,LC_ALL:process.env.LC_ALL,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};}
function listChangedFiles(workspace:string):readonly string[]{return git(workspace,['status','--porcelain=v1','-z','--untracked-files=all']).stdout.split('\0').filter(Boolean).map((entry)=>entry.slice(3)).sort();}
function resolveWithin(root:string,path:string):string{validateRelativePath(path);const base=resolve(root);const target=resolve(base,path);if(target!==base&&!target.startsWith(`${base}${sep}`))throw new Error('multi_file_path_escape');return target;}
function validateRelativePath(path:string):void{if(path.trim()===''||path.startsWith('/')||path.includes('\0')||path.split('/').includes('..')||path.includes('\\'))throw new Error('multi_file_invalid_relative_path');}
function sanitize(value:string|Buffer|null|undefined):string{return String(value??'').replace(/[A-Za-z0-9_\-]{32,}/g,'[REDACTED_TOKEN_LIKE_VALUE]').slice(0,200_000);}
function validDate(date:Date):void{if(Number.isNaN(date.getTime()))throw new Error('invalid_date');}
function truncate(value:string,max:number):string{return value.length<=max?value:`${value.slice(0,max-1)}…`;}
function withoutDigest(state:MultiFileSessionStateV33_9):Omit<MultiFileSessionStateV33_9,'stateDigest'>{const {stateDigest:_,...material}=state;return material;}
function withStateDigest(material:Omit<MultiFileSessionStateV33_9,'stateDigest'>):MultiFileSessionStateV33_9{return{...material,stateDigest:sha256(material)};}
function writeState(path:string,state:MultiFileSessionStateV33_9):void{mkdirSync(dirname(path),{recursive:true});const temp=`${path}.tmp`;writeFileSync(temp,JSON.stringify(state,null,2));renameSync(temp,path);}
function readState(path:string):MultiFileSessionStateV33_9{if(!existsSync(path))throw new Error('multi_file_session_not_found');const state=JSON.parse(readFileSync(path,'utf8')) as MultiFileSessionStateV33_9;const {stateDigest,...material}=state;if(sha256(material)!==stateDigest)throw new Error('multi_file_state_tampered');return state;}
function withoutProviderDigest(state:ShadowProviderStateV33_9):Omit<ShadowProviderStateV33_9,'stateDigest'>{const {stateDigest:_,...material}=state;return material;}
function withProviderDigest(material:Omit<ShadowProviderStateV33_9,'stateDigest'>):ShadowProviderStateV33_9{return{...material,stateDigest:sha256(material)};}
function verifyPreparation(p:MultiFileEngineeringPreparationV33_9):void{const {preparationDigest,...material}=p;if(sha256(material)!==preparationDigest)throw new Error('multi_file_preparation_digest_invalid');if(p.externalGitMutationExecuted||p.externalEffectsExecuted!==0||!p.reviewRequired||!p.testPassed)throw new Error('multi_file_preparation_boundary_invalid');}
