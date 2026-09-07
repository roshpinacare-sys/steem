import { sha256 } from "@/lib/durable/canonical-json";
import {
  signCanonicalPayload,
  verifyCanonicalPayload,
  type SignedCanonicalPayload,
  type SovereignSigningIdentity,
} from "./key-hierarchy";
import type { ReplayLedger } from "./replay-ledger";
import type { SovereignTrustStore } from "./trust-store";

export interface AirGapCapabilityGrant {
  id: string;
  risk: "low" | "medium" | "high";
  sideEffect: "none" | "local_read" | "local_write";
  maximumUses: number;
}

export interface AirGapTaskPayload {
  bundleId: string;
  tenantId: string;
  workspaceId: string;
  senderIdentity: string;
  receiverIdentity: string;
  taskId: string;
  correlationId: string;
  causationId?: string;
  objective: string;
  context: Record<string, unknown>;
  memoryEvidence: Array<{ id: string; hash: string; content: string }>;
  evidenceRefs: string[];
  capabilities: AirGapCapabilityGrant[];
  expiresAt: string;
  returnSchema: Record<string, unknown>;
  createdAt: string;
}

export type SignedAirGapTask = SignedCanonicalPayload<AirGapTaskPayload>;

export interface AirGapResultPayload {
  format: "titai-airgap-result";
  version: 1;
  bundleId: string;
  taskId: string;
  tenantId: string;
  workspaceId: string;
  executorIdentity: string;
  status: "completed" | "rejected" | "failed";
  output: unknown;
  artifactHashes: string[];
  evidenceHashes: string[];
  capabilitiesUsed: Array<{ id: string; uses: number }>;
  completedAt: string;
  inputTaskHash: string;
}

export type SignedAirGapResult = SignedCanonicalPayload<AirGapResultPayload>;

function requireIso(value: string, name: string): string {
  if (!Number.isFinite(new Date(value).getTime())) throw new Error(`${name}_invalid`);
  return value;
}

function ensureSafeCapabilities(capabilities: readonly AirGapCapabilityGrant[]): void {
  const ids = new Set<string>();
  for (const capability of capabilities) {
    if (!capability.id.trim()) throw new Error("handoff_capability_id_required");
    if (ids.has(capability.id)) throw new Error("handoff_capability_duplicate");
    ids.add(capability.id);
    if (!Number.isInteger(capability.maximumUses) || capability.maximumUses < 0 || capability.maximumUses > 100) {
      throw new Error("handoff_capability_uses_invalid");
    }
    if (capability.sideEffect === "local_write" && capability.risk === "low") {
      throw new Error("handoff_write_risk_understated");
    }
  }
}

export function createAirGapTask(options: {
  task: Omit<AirGapTaskPayload, "bundleId" | "createdAt"> & { bundleId?: string; createdAt?: string };
  signer: SovereignSigningIdentity;
  now?: Date;
}): SignedAirGapTask {
  ensureSafeCapabilities(options.task.capabilities);
  const now = options.now ?? new Date();
  const createdAt = options.task.createdAt ?? now.toISOString();
  requireIso(createdAt, "handoff_created_at");
  requireIso(options.task.expiresAt, "handoff_expires_at");
  if (new Date(options.task.expiresAt).getTime() <= new Date(createdAt).getTime()) {
    throw new Error("handoff_expiry_not_future");
  }
  const base = {
    ...options.task,
    bundleId:
      options.task.bundleId ??
      `handoff-${sha256({ taskId: options.task.taskId, createdAt, receiver: options.task.receiverIdentity }).slice(0, 20)}`,
    createdAt,
    context: structuredClone(options.task.context),
    memoryEvidence: options.task.memoryEvidence.map((item) => ({ ...item })),
    evidenceRefs: [...new Set(options.task.evidenceRefs)].sort(),
    capabilities: options.task.capabilities.map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
    returnSchema: structuredClone(options.task.returnSchema),
  } satisfies AirGapTaskPayload;
  return signCanonicalPayload({ payload: base, identity: options.signer, now });
}

export function verifyAirGapTask(options: {
  task: SignedAirGapTask;
  senderPublicKeyPem: string;
  expectedSenderKeyId?: string;
  expectedTenantId: string;
  expectedWorkspaceId: string;
  expectedReceiverIdentity: string;
  now?: Date;
}): AirGapTaskPayload {
  if (
    !verifyCanonicalPayload({
      envelope: options.task,
      publicKeyPem: options.senderPublicKeyPem,
      expectedKeyId: options.expectedSenderKeyId,
    })
  ) {
    throw new Error("handoff_signature_invalid");
  }
  const payload = options.task.payload;
  if (payload.tenantId !== options.expectedTenantId) throw new Error("handoff_tenant_mismatch");
  if (payload.workspaceId !== options.expectedWorkspaceId) throw new Error("handoff_workspace_mismatch");
  if (payload.receiverIdentity !== options.expectedReceiverIdentity) throw new Error("handoff_receiver_mismatch");
  if (new Date(payload.expiresAt).getTime() <= (options.now ?? new Date()).getTime()) {
    throw new Error("handoff_expired");
  }
  ensureSafeCapabilities(payload.capabilities);
  for (const memory of payload.memoryEvidence) {
    if (sha256(memory.content) !== memory.hash) throw new Error(`handoff_memory_integrity_invalid:${memory.id}`);
  }
  return structuredClone(payload);
}

export function createAirGapResult(options: {
  task: SignedAirGapTask;
  executorIdentity: string;
  status: AirGapResultPayload["status"];
  output: unknown;
  artifactHashes?: string[];
  evidenceHashes?: string[];
  capabilitiesUsed?: Array<{ id: string; uses: number }>;
  signer: SovereignSigningIdentity;
  now?: Date;
}): SignedAirGapResult {
  const grants = new Map(options.task.payload.capabilities.map((capability) => [capability.id, capability]));
  for (const used of options.capabilitiesUsed ?? []) {
    const grant = grants.get(used.id);
    if (!grant) throw new Error(`handoff_capability_not_granted:${used.id}`);
    if (!Number.isInteger(used.uses) || used.uses < 0 || used.uses > grant.maximumUses) {
      throw new Error(`handoff_capability_limit_exceeded:${used.id}`);
    }
  }
  const payload: AirGapResultPayload = {
    format: "titai-airgap-result",
    version: 1,
    bundleId: options.task.payload.bundleId,
    taskId: options.task.payload.taskId,
    tenantId: options.task.payload.tenantId,
    workspaceId: options.task.payload.workspaceId,
    executorIdentity: options.executorIdentity,
    status: options.status,
    output: structuredClone(options.output),
    artifactHashes: [...new Set(options.artifactHashes ?? [])].sort(),
    evidenceHashes: [...new Set(options.evidenceHashes ?? [])].sort(),
    capabilitiesUsed: (options.capabilitiesUsed ?? []).map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
    completedAt: (options.now ?? new Date()).toISOString(),
    inputTaskHash: options.task.payloadSha256,
  };
  return signCanonicalPayload({ payload, identity: options.signer, now: options.now });
}

export function verifyAirGapResult(options: {
  result: SignedAirGapResult;
  executorPublicKeyPem: string;
  originalTask: SignedAirGapTask;
  expectedExecutorKeyId?: string;
}): AirGapResultPayload {
  if (
    !verifyCanonicalPayload({
      envelope: options.result,
      publicKeyPem: options.executorPublicKeyPem,
      expectedKeyId: options.expectedExecutorKeyId,
    })
  ) {
    throw new Error("handoff_result_signature_invalid");
  }
  const payload = options.result.payload;
  const original = options.originalTask.payload;
  if (
    payload.bundleId !== original.bundleId ||
    payload.taskId !== original.taskId ||
    payload.tenantId !== original.tenantId ||
    payload.workspaceId !== original.workspaceId ||
    payload.inputTaskHash !== options.originalTask.payloadSha256
  ) {
    throw new Error("handoff_result_scope_mismatch");
  }
  const grants = new Map(original.capabilities.map((capability) => [capability.id, capability]));
  for (const used of payload.capabilitiesUsed) {
    const grant = grants.get(used.id);
    if (!grant || used.uses > grant.maximumUses) throw new Error("handoff_result_capability_violation");
  }
  return structuredClone(payload);
}


export function acceptAirGapTask(options: {
  task: SignedAirGapTask;
  trustStore: SovereignTrustStore;
  replayLedger: ReplayLedger;
  expectedTenantId: string;
  expectedWorkspaceId: string;
  expectedReceiverIdentity: string;
  now?: Date;
}): AirGapTaskPayload {
  const trusted = options.trustStore.require({
    keyId: options.task.keyId,
    purpose: "handoff_task",
    tenantId: options.expectedTenantId,
    workspaceId: options.expectedWorkspaceId,
    now: options.now,
  });
  const payload = verifyAirGapTask({
    task: options.task,
    senderPublicKeyPem: trusted.publicKeyPem,
    expectedSenderKeyId: trusted.keyId,
    expectedTenantId: options.expectedTenantId,
    expectedWorkspaceId: options.expectedWorkspaceId,
    expectedReceiverIdentity: options.expectedReceiverIdentity,
    now: options.now,
  });
  options.replayLedger.consume(
    {
      namespace: "airgap_task",
      id: payload.bundleId,
      payloadSha256: options.task.payloadSha256,
      acceptedAt: (options.now ?? new Date()).toISOString(),
      expiresAt: payload.expiresAt,
    },
    options.now,
  );
  return payload;
}

export function acceptAirGapResult(options: {
  result: SignedAirGapResult;
  originalTask: SignedAirGapTask;
  trustStore: SovereignTrustStore;
  replayLedger: ReplayLedger;
  now?: Date;
}): AirGapResultPayload {
  const original = options.originalTask.payload;
  const trusted = options.trustStore.require({
    keyId: options.result.keyId,
    purpose: "handoff_result",
    tenantId: original.tenantId,
    workspaceId: original.workspaceId,
    now: options.now,
  });
  const payload = verifyAirGapResult({
    result: options.result,
    executorPublicKeyPem: trusted.publicKeyPem,
    originalTask: options.originalTask,
    expectedExecutorKeyId: trusted.keyId,
  });
  options.replayLedger.consume(
    {
      namespace: "airgap_result",
      id: `${payload.bundleId}:${payload.executorIdentity}`,
      payloadSha256: options.result.payloadSha256,
      acceptedAt: (options.now ?? new Date()).toISOString(),
    },
    options.now,
  );
  return payload;
}
