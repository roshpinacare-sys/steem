import { describe, expect, it } from "vitest";
import { createAirGapResult, createAirGapTask, verifyAirGapResult, verifyAirGapTask } from "@/lib/sovereignty/airgap-handoff";
import { generateSovereignSigningIdentity } from "@/lib/sovereignty/key-hierarchy";
import { sha256 } from "@/lib/durable/canonical-json";

describe("signed air-gap handoff", () => {
  it("exports, executes, imports, and verifies a bounded task", () => {
    const sender = generateSovereignSigningIdentity(new Date("2026-07-11T00:00:00Z"));
    const executor = generateSovereignSigningIdentity(new Date("2026-07-11T00:00:00Z"));
    const task = createAirGapTask({
      signer: sender,
      now: new Date("2026-07-11T00:00:00Z"),
      task: {
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        senderIdentity: "operator-a",
        receiverIdentity: "offline-node-a",
        taskId: "task-a",
        correlationId: "corr-a",
        objective: "Inspect a local artifact",
        context: { mode: "offline" },
        memoryEvidence: [{ id: "m1", content: "Local evidence", hash: sha256("Local evidence") }],
        evidenceRefs: ["e1"],
        capabilities: [{ id: "local.inspect_file", risk: "medium", sideEffect: "local_read", maximumUses: 1 }],
        expiresAt: "2026-07-12T00:00:00Z",
        returnSchema: { type: "object" },
      },
    });
    const verifiedTask = verifyAirGapTask({
      task,
      senderPublicKeyPem: sender.publicKeyPem,
      expectedSenderKeyId: sender.keyId,
      expectedTenantId: "tenant-a",
      expectedWorkspaceId: "workspace-a",
      expectedReceiverIdentity: "offline-node-a",
      now: new Date("2026-07-11T01:00:00Z"),
    });
    expect(verifiedTask.taskId).toBe("task-a");
    const result = createAirGapResult({
      task,
      signer: executor,
      executorIdentity: "offline-node-a",
      status: "completed",
      output: { inspected: true },
      artifactHashes: ["a".repeat(64)],
      evidenceHashes: ["b".repeat(64)],
      capabilitiesUsed: [{ id: "local.inspect_file", uses: 1 }],
      now: new Date("2026-07-11T02:00:00Z"),
    });
    const verifiedResult = verifyAirGapResult({ result, executorPublicKeyPem: executor.publicKeyPem, originalTask: task, expectedExecutorKeyId: executor.keyId });
    expect(verifiedResult.status).toBe("completed");
    expect(verifiedResult.inputTaskHash).toBe(task.payloadSha256);
  });

  it("rejects cross-tenant imports and capability escalation", () => {
    const sender = generateSovereignSigningIdentity();
    const executor = generateSovereignSigningIdentity();
    const task = createAirGapTask({
      signer: sender,
      task: {
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        senderIdentity: "operator-a",
        receiverIdentity: "offline-node-a",
        taskId: "task-a",
        correlationId: "corr-a",
        objective: "Hash content",
        context: {},
        memoryEvidence: [],
        evidenceRefs: [],
        capabilities: [{ id: "local.hash", risk: "low", sideEffect: "none", maximumUses: 1 }],
        expiresAt: "2099-01-01T00:00:00Z",
        returnSchema: {},
      },
    });
    expect(() => verifyAirGapTask({ task, senderPublicKeyPem: sender.publicKeyPem, expectedTenantId: "tenant-b", expectedWorkspaceId: "workspace-a", expectedReceiverIdentity: "offline-node-a" })).toThrow("handoff_tenant_mismatch");
    expect(() => createAirGapResult({ task, signer: executor, executorIdentity: "offline-node-a", status: "completed", output: {}, capabilitiesUsed: [{ id: "local.hash", uses: 2 }] })).toThrow("handoff_capability_limit_exceeded");
  });
});
