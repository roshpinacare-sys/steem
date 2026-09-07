import { randomBytes } from "node:crypto";
import { canonicalJson, sha256 } from "@/lib/durable/canonical-json";
import {
  signCanonicalPayload,
  verifyCanonicalPayload,
  type SignedCanonicalPayload,
  type SovereignSigningIdentity,
} from "./key-hierarchy";
import type { SovereignNodeProfile } from "./types";
import type { ReplayLedger } from "./replay-ledger";

export interface SovereignNodeRegistration {
  format: "titai-sovereign-node-registration";
  version: 1;
  node: SovereignNodeProfile;
  nodeSigningKeyId: string;
  nodePublicKeyPem: string;
  registeredAt: string;
  expiresAt?: string;
  registrationNonce: string;
}

export type SignedNodeRegistration = SignedCanonicalPayload<SovereignNodeRegistration>;

export interface NodeCapabilityLease {
  format: "titai-node-capability-lease";
  version: 1;
  leaseId: string;
  nodeId: string;
  taskId: string;
  tenantId: string;
  workspaceId: string;
  capabilityIds: string[];
  modelId?: string;
  issuedAt: string;
  expiresAt: string;
  maximumResultBytes: number;
  placementEvidenceHash: string;
  nodeRevision: number;
}

export type SignedNodeCapabilityLease = SignedCanonicalPayload<NodeCapabilityLease>;

export interface NodeExecutionResult {
  format: "titai-node-execution-result";
  version: 1;
  resultId: string;
  leaseId: string;
  nodeId: string;
  taskId: string;
  tenantId: string;
  workspaceId: string;
  completedAt: string;
  status: "completed" | "failed" | "reconciliation_required";
  output: unknown;
  outputSha256: string;
  artifactHashes: string[];
  evidenceHashes: string[];
}

export type SignedNodeExecutionResult = SignedCanonicalPayload<NodeExecutionResult>;

interface RegisteredNode {
  registration: SovereignNodeRegistration;
  revision: number;
  status: "trusted" | "revoked";
  revokedAt?: string;
  revokedReason?: string;
}

export class SovereignNodeTrustRegistry {
  private readonly nodes = new Map<string, RegisteredNode>();
  private readonly acceptedTaskResults = new Map<string, string>();

  register(options: {
    registration: SignedNodeRegistration;
    installationPublicKeyPem: string;
    expectedInstallationKeyId: string;
    now?: Date;
  }): void {
    if (!verifyCanonicalPayload({ envelope: options.registration, publicKeyPem: options.installationPublicKeyPem, expectedKeyId: options.expectedInstallationKeyId })) {
      throw new Error("node_registration_signature_invalid");
    }
    const payload = options.registration.payload;
    if (payload.format !== "titai-sovereign-node-registration" || payload.version !== 1) throw new Error("node_registration_format_invalid");
    const now = options.now ?? new Date();
    if (payload.expiresAt && new Date(payload.expiresAt).getTime() <= now.getTime()) throw new Error("node_registration_expired");
    if (sha256(payload.nodePublicKeyPem).slice(0, 24) !== payload.nodeSigningKeyId) throw new Error("node_signing_key_identity_invalid");
    if (payload.node.id.trim() === "" || payload.node.tenantIds.length === 0) throw new Error("node_registration_scope_invalid");
    const existing = this.nodes.get(payload.node.id);
    this.nodes.set(payload.node.id, { registration: structuredClone(payload), revision: (existing?.revision ?? 0) + 1, status: "trusted" });
  }

  revoke(nodeId: string, options: { reason: string; at?: Date }): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error("node_unknown");
    node.status = "revoked";
    node.revokedAt = (options.at ?? new Date()).toISOString();
    node.revokedReason = options.reason.trim().slice(0, 500);
    node.revision += 1;
  }

  requireTrusted(options: { nodeId: string; tenantId: string; workspaceId: string; now?: Date }): RegisteredNode {
    const node = this.nodes.get(options.nodeId);
    if (!node) throw new Error("node_unknown");
    if (node.status === "revoked") throw new Error("node_revoked");
    if (!node.registration.node.tenantIds.includes(options.tenantId)) throw new Error("node_tenant_denied");
    if (node.registration.expiresAt && new Date(node.registration.expiresAt).getTime() <= (options.now ?? new Date()).getTime()) throw new Error("node_registration_expired");
    return structuredClone(node);
  }

  currentRevision(nodeId: string): number {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error("node_unknown");
    return node.revision;
  }

  acceptResult(options: {
    result: SignedNodeExecutionResult;
    lease: SignedNodeCapabilityLease;
    installationPublicKeyPem: string;
    expectedInstallationKeyId: string;
    replayLedger: ReplayLedger;
    now?: Date;
  }): NodeExecutionResult {
    const now = options.now ?? new Date();
    if (!verifyCanonicalPayload({ envelope: options.lease, publicKeyPem: options.installationPublicKeyPem, expectedKeyId: options.expectedInstallationKeyId })) throw new Error("node_lease_signature_invalid");
    const lease = options.lease.payload;
    const registered = this.requireTrusted({ nodeId: lease.nodeId, tenantId: lease.tenantId, workspaceId: lease.workspaceId, now });
    if (registered.revision !== lease.nodeRevision) throw new Error("node_lease_stale_revision");
    if (new Date(lease.expiresAt).getTime() <= now.getTime()) throw new Error("node_lease_expired");
    if (!verifyCanonicalPayload({ envelope: options.result, publicKeyPem: registered.registration.nodePublicKeyPem, expectedKeyId: registered.registration.nodeSigningKeyId })) throw new Error("node_result_signature_invalid");
    const result = options.result.payload;
    if (result.leaseId !== lease.leaseId || result.nodeId !== lease.nodeId || result.taskId !== lease.taskId) throw new Error("node_result_binding_invalid");
    if (result.tenantId !== lease.tenantId || result.workspaceId !== lease.workspaceId) throw new Error("node_result_scope_invalid");
    if (Buffer.byteLength(canonicalJson(result.output), "utf8") > lease.maximumResultBytes) throw new Error("node_result_too_large");
    if (sha256(result.output) !== result.outputSha256) throw new Error("node_result_integrity_invalid");
    const replayHash = sha256({ leaseId: lease.leaseId, resultId: result.resultId, outputSha256: result.outputSha256 });
    options.replayLedger.consume({ namespace: "node_result", id: result.resultId, payloadSha256: replayHash, acceptedAt: now.toISOString() });
    const existing = this.acceptedTaskResults.get(result.taskId);
    if (existing && existing !== result.outputSha256) throw new Error("node_result_conflict");
    this.acceptedTaskResults.set(result.taskId, result.outputSha256);
    return structuredClone(result);
  }
}

export function createSignedNodeRegistration(options: {
  node: SovereignNodeProfile;
  nodeIdentity: SovereignSigningIdentity;
  installationIdentity: SovereignSigningIdentity;
  expiresAt?: string;
  now?: Date;
}): SignedNodeRegistration {
  const now = options.now ?? new Date();
  return signCanonicalPayload({
    identity: options.installationIdentity,
    now,
    payload: {
      format: "titai-sovereign-node-registration",
      version: 1,
      node: structuredClone(options.node),
      nodeSigningKeyId: options.nodeIdentity.keyId,
      nodePublicKeyPem: options.nodeIdentity.publicKeyPem,
      registeredAt: now.toISOString(),
      expiresAt: options.expiresAt,
      registrationNonce: randomBytes(16).toString("hex"),
    },
  });
}

export function issueNodeCapabilityLease(options: {
  nodeId: string;
  nodeRevision: number;
  taskId: string;
  tenantId: string;
  workspaceId: string;
  capabilityIds: string[];
  modelId?: string;
  expiresAt: string;
  maximumResultBytes?: number;
  placementEvidenceHash: string;
  installationIdentity: SovereignSigningIdentity;
  now?: Date;
}): SignedNodeCapabilityLease {
  const now = options.now ?? new Date();
  if (new Date(options.expiresAt).getTime() <= now.getTime()) throw new Error("node_lease_expiry_invalid");
  return signCanonicalPayload({
    identity: options.installationIdentity,
    now,
    payload: {
      format: "titai-node-capability-lease",
      version: 1,
      leaseId: `node-lease-${sha256({ nodeId: options.nodeId, taskId: options.taskId, now: now.toISOString(), nonce: randomBytes(12).toString("hex") }).slice(0, 24)}`,
      nodeId: options.nodeId,
      nodeRevision: options.nodeRevision,
      taskId: options.taskId,
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      capabilityIds: [...new Set(options.capabilityIds)].sort(),
      modelId: options.modelId,
      issuedAt: now.toISOString(),
      expiresAt: options.expiresAt,
      maximumResultBytes: options.maximumResultBytes ?? 1_000_000,
      placementEvidenceHash: options.placementEvidenceHash,
    },
  });
}

export function createSignedNodeResult(options: {
  lease: SignedNodeCapabilityLease;
  nodeIdentity: SovereignSigningIdentity;
  status: NodeExecutionResult["status"];
  output: unknown;
  artifactHashes?: string[];
  evidenceHashes?: string[];
  now?: Date;
}): SignedNodeExecutionResult {
  const now = options.now ?? new Date();
  const lease = options.lease.payload;
  const outputSha256 = sha256(options.output);
  return signCanonicalPayload({
    identity: options.nodeIdentity,
    now,
    payload: {
      format: "titai-node-execution-result",
      version: 1,
      resultId: `node-result-${sha256({ leaseId: lease.leaseId, outputSha256, now: now.toISOString() }).slice(0, 24)}`,
      leaseId: lease.leaseId,
      nodeId: lease.nodeId,
      taskId: lease.taskId,
      tenantId: lease.tenantId,
      workspaceId: lease.workspaceId,
      completedAt: now.toISOString(),
      status: options.status,
      output: structuredClone(options.output),
      outputSha256,
      artifactHashes: [...new Set(options.artifactHashes ?? [])].sort(),
      evidenceHashes: [...new Set(options.evidenceHashes ?? [])].sort(),
    },
  });
}
