import { assertIndependentVerifier } from "@/lib/auth/authorization";
import { sha256 } from "@/lib/durable/canonical-json";

export type VerificationStatus = "accepted" | "rejected";

export interface VerificationAttestationInput {
  runId: string;
  requirementRevision: string;
  taskRevision: string;
  sourceTreeHash: string;
  testCommand: string;
  testOutputHash: string;
  artifactHash?: string;
  releaseCandidateHash: string;
  builderIdentity: string;
  verifierIdentity: string;
  status: VerificationStatus;
  limitations?: string[];
  createdAt?: string;
}

export interface VerificationAttestation
  extends Required<Omit<VerificationAttestationInput, "artifactHash" | "limitations" | "createdAt">> {
  artifactHash?: string;
  limitations: string[];
  createdAt: string;
  evidenceHash: string;
}

const SHA256 = /^[a-f0-9]{64}$/i;

function requireText(value: string, name: string, maxLength = 2_000): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name}_required`);
  if (normalized.length > maxLength) throw new Error(`${name}_too_long`);
  return normalized;
}

function requireHash(value: string, name: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${name}_invalid`);
  return normalized;
}

export function createVerificationAttestation(
  input: VerificationAttestationInput,
): VerificationAttestation {
  const builderIdentity = requireText(input.builderIdentity, "builder_identity", 300);
  const verifierIdentity = requireText(input.verifierIdentity, "verifier_identity", 300);
  assertIndependentVerifier(builderIdentity, verifierIdentity);
  const limitations = [
    ...new Set(
      (input.limitations ?? []).map((item) => requireText(item, "limitation", 1_000)),
    ),
  ];
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(new Date(createdAt).getTime())) {
    throw new Error("verification_created_at_invalid");
  }

  const core = {
    runId: requireText(input.runId, "run_id", 200),
    requirementRevision: requireText(
      input.requirementRevision,
      "requirement_revision",
      200,
    ),
    taskRevision: requireText(input.taskRevision, "task_revision", 200),
    sourceTreeHash: requireHash(input.sourceTreeHash, "source_tree_hash"),
    testCommand: requireText(input.testCommand, "test_command", 2_000),
    testOutputHash: requireHash(input.testOutputHash, "test_output_hash"),
    artifactHash: input.artifactHash
      ? requireHash(input.artifactHash, "artifact_hash")
      : undefined,
    releaseCandidateHash: requireHash(
      input.releaseCandidateHash,
      "release_candidate_hash",
    ),
    builderIdentity,
    verifierIdentity,
    status: input.status,
    limitations,
    createdAt,
  };
  return { ...core, evidenceHash: sha256(core) };
}

export function verifyAttestationIntegrity(
  attestation: VerificationAttestation,
): boolean {
  const { evidenceHash, ...core } = attestation;
  return SHA256.test(evidenceHash) && sha256(core) === evidenceHash;
}

export function canPromoteFromAttestation(
  attestation: VerificationAttestation,
): boolean {
  return attestation.status === "accepted" && verifyAttestationIntegrity(attestation);
}
