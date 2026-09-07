import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256 } from "@/lib/durable/canonical-json";
import { acceptAirGapResult, acceptAirGapTask, createAirGapResult, createAirGapTask } from "@/lib/sovereignty/airgap-handoff";
import { generateSovereignSigningIdentity } from "@/lib/sovereignty/key-hierarchy";
import { JsonFileReplayLedger } from "@/lib/sovereignty/replay-ledger";
import { SovereignTrustStore } from "@/lib/sovereignty/trust-store";

function trusted(store: SovereignTrustStore, identity: ReturnType<typeof generateSovereignSigningIdentity>, purpose: "handoff_task" | "handoff_result") {
  store.add({
    keyId: identity.keyId,
    publicKeyPem: identity.publicKeyPem,
    identity: purpose === "handoff_task" ? "sender" : "executor",
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    purposes: [purpose],
    validFrom: "2026-01-01T00:00:00.000Z",
  });
}

describe("sovereign trust and replay protection", () => {
  it("rejects a task replay after a ledger restart", () => {
    const sender = generateSovereignSigningIdentity(new Date("2026-01-01T00:00:00.000Z"));
    const store = new SovereignTrustStore();
    trusted(store, sender, "handoff_task");
    const task = createAirGapTask({
      signer: sender,
      now: new Date("2026-02-01T00:00:00.000Z"),
      task: {
        tenantId: "tenant-a", workspaceId: "workspace-a", senderIdentity: "sender", receiverIdentity: "node-b",
        taskId: "task-1", correlationId: "corr-1", objective: "Inspect files", context: {},
        memoryEvidence: [{ id: "m1", content: "bounded", hash: sha256("bounded") }], evidenceRefs: [],
        capabilities: [{ id: "file.inspect", risk: "low", sideEffect: "local_read", maximumUses: 1 }],
        expiresAt: "2026-03-01T00:00:00.000Z", returnSchema: { type: "object" },
      },
    });
    const path = join(mkdtempSync(join(tmpdir(), "titai-replay-")), "ledger.json");
    acceptAirGapTask({ task, trustStore: store, replayLedger: new JsonFileReplayLedger(path), expectedTenantId: "tenant-a", expectedWorkspaceId: "workspace-a", expectedReceiverIdentity: "node-b", now: new Date("2026-02-02T00:00:00.000Z") });
    expect(() => acceptAirGapTask({ task, trustStore: store, replayLedger: new JsonFileReplayLedger(path), expectedTenantId: "tenant-a", expectedWorkspaceId: "workspace-a", expectedReceiverIdentity: "node-b", now: new Date("2026-02-03T00:00:00.000Z") })).toThrow("replay_detected");
  });

  it("rejects revoked signing keys and duplicate results", () => {
    const sender = generateSovereignSigningIdentity(new Date("2026-01-01T00:00:00.000Z"));
    const executor = generateSovereignSigningIdentity(new Date("2026-01-01T00:00:00.000Z"));
    const taskStore = new SovereignTrustStore(); trusted(taskStore, sender, "handoff_task");
    const resultStore = new SovereignTrustStore(); trusted(resultStore, executor, "handoff_result");
    const task = createAirGapTask({ signer: sender, now: new Date("2026-02-01T00:00:00.000Z"), task: { tenantId:"tenant-a",workspaceId:"workspace-a",senderIdentity:"sender",receiverIdentity:"node-b",taskId:"task-2",correlationId:"corr-2",objective:"hash",context:{},memoryEvidence:[],evidenceRefs:[],capabilities:[{id:"hash",risk:"low",sideEffect:"none",maximumUses:1}],expiresAt:"2026-03-01T00:00:00.000Z",returnSchema:{type:"object"} } });
    const result = createAirGapResult({ task, executorIdentity:"executor", status:"completed", output:{ok:true}, capabilitiesUsed:[{id:"hash",uses:1}], signer:executor, now:new Date("2026-02-02T00:00:00.000Z") });
    const ledger = new JsonFileReplayLedger(join(mkdtempSync(join(tmpdir(), "titai-result-")), "ledger.json"));
    acceptAirGapResult({ result, originalTask:task, trustStore:resultStore, replayLedger:ledger, now:new Date("2026-02-03T00:00:00.000Z") });
    expect(() => acceptAirGapResult({ result, originalTask:task, trustStore:resultStore, replayLedger:ledger, now:new Date("2026-02-04T00:00:00.000Z") })).toThrow("replay_detected");
    resultStore.revoke(executor.keyId, { at:new Date("2026-02-05T00:00:00.000Z"), reason:"node compromised" });
    expect(() => acceptAirGapResult({ result:{...result,payload:{...result.payload,bundleId:"other"}}, originalTask:task, trustStore:resultStore, replayLedger:new JsonFileReplayLedger(join(mkdtempSync(join(tmpdir(), "titai-revoked-")), "ledger.json")), now:new Date("2026-02-06T00:00:00.000Z") })).toThrow("trust_key_revoked");
  });
});
