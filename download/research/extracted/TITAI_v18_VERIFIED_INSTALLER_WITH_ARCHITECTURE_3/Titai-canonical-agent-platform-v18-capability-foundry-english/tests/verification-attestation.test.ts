import { describe, expect, it } from "vitest";
import {
  canPromoteFromAttestation,
  createVerificationAttestation,
  verifyAttestationIntegrity,
} from "@/lib/verification/attestation";

const hash = (char: string) => char.repeat(64);

describe("immutable verification attestation", () => {
  it("binds an accepted decision to source, test, artifact, and release hashes", () => {
    const attestation = createVerificationAttestation({
      runId: "run-1",
      requirementRevision: "REQ-12@3",
      taskRevision: "DUR-012@2",
      sourceTreeHash: hash("a"),
      testCommand: "npm run test:v12",
      testOutputHash: hash("b"),
      artifactHash: hash("c"),
      releaseCandidateHash: hash("d"),
      builderIdentity: "agent:builder",
      verifierIdentity: "user:verifier",
      status: "accepted",
      limitations: ["Native SQLite race tests remain environment-blocked."],
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    expect(verifyAttestationIntegrity(attestation)).toBe(true);
    expect(canPromoteFromAttestation(attestation)).toBe(true);
    expect(attestation.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("detects evidence mutation and rejects identity collision", () => {
    const attestation = createVerificationAttestation({
      runId: "run-1",
      requirementRevision: "REQ-12@3",
      taskRevision: "DUR-012@2",
      sourceTreeHash: hash("a"),
      testCommand: "npm test",
      testOutputHash: hash("b"),
      releaseCandidateHash: hash("d"),
      builderIdentity: "agent:builder",
      verifierIdentity: "user:verifier",
      status: "rejected",
    });
    expect(
      verifyAttestationIntegrity({ ...attestation, taskRevision: "changed" }),
    ).toBe(false);
    expect(() =>
      createVerificationAttestation({
        runId: "run-1",
        requirementRevision: "r",
        taskRevision: "t",
        sourceTreeHash: hash("a"),
        testCommand: "npm test",
        testOutputHash: hash("b"),
        releaseCandidateHash: hash("d"),
        builderIdentity: "same",
        verifierIdentity: "same",
        status: "accepted",
      }),
    ).toThrow("verification_identity_collision");
  });
});
