import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSovereignSigningIdentity } from "@/lib/sovereignty/key-hierarchy";
import { JsonFileReplayLedger } from "@/lib/sovereignty/replay-ledger";
import { createSignedNodeRegistration, createSignedNodeResult, issueNodeCapabilityLease, SovereignNodeTrustRegistry } from "@/lib/sovereignty/node-trust";
import type { SovereignNodeProfile } from "@/lib/sovereignty/types";

const node: SovereignNodeProfile = {
  id: "worker-a", displayName: "Worker A", trustLevel: "trusted",
  hardware: { id:"hw-a",displayName:"HW A",cpuArchitecture:process.arch,logicalCores:4,ramBytes:8*1024**3,diskFreeBytes:20*1024**3,thermalState:"nominal",powerSource:"mains",networkAvailable:false },
  modelIds:["local-small"],toolIds:["local.hash"],tenantIds:["tenant-a"],storageFreeBytes:20*1024**3,currentLoad:0.1,health:"healthy",
  energyProfile:{idleWatts:8,estimatedInferenceWatts:25,confidence:"estimated"},
};

describe("sovereign multi-node trust", () => {
  it("binds a signed result to a current trusted node lease", () => {
    const installation=generateSovereignSigningIdentity(); const worker=generateSovereignSigningIdentity();
    const registry=new SovereignNodeTrustRegistry();
    registry.register({registration:createSignedNodeRegistration({node,nodeIdentity:worker,installationIdentity:installation}),installationPublicKeyPem:installation.publicKeyPem,expectedInstallationKeyId:installation.keyId});
    const lease=issueNodeCapabilityLease({nodeId:node.id,nodeRevision:registry.currentRevision(node.id),taskId:"task-1",tenantId:"tenant-a",workspaceId:"workspace-a",capabilityIds:["local.hash"],modelId:"local-small",expiresAt:"2099-01-01T00:00:00.000Z",placementEvidenceHash:"a".repeat(64),installationIdentity:installation});
    const result=createSignedNodeResult({lease,nodeIdentity:worker,status:"completed",output:{ok:true}});
    const ledger=new JsonFileReplayLedger(join(mkdtempSync(join(tmpdir(),"titai-node-result-")),"ledger.json"));
    expect(registry.acceptResult({result,lease,installationPublicKeyPem:installation.publicKeyPem,expectedInstallationKeyId:installation.keyId,replayLedger:ledger}).output).toEqual({ok:true});
    expect(()=>registry.acceptResult({result,lease,installationPublicKeyPem:installation.publicKeyPem,expectedInstallationKeyId:installation.keyId,replayLedger:ledger})).toThrow("replay_detected");
  });

  it("rejects revoked nodes, stale leases, and cross-scope results", () => {
    const installation=generateSovereignSigningIdentity(); const worker=generateSovereignSigningIdentity();
    const registry=new SovereignNodeTrustRegistry();
    registry.register({registration:createSignedNodeRegistration({node,nodeIdentity:worker,installationIdentity:installation}),installationPublicKeyPem:installation.publicKeyPem,expectedInstallationKeyId:installation.keyId});
    const lease=issueNodeCapabilityLease({nodeId:node.id,nodeRevision:registry.currentRevision(node.id),taskId:"task-2",tenantId:"tenant-a",workspaceId:"workspace-a",capabilityIds:["local.hash"],expiresAt:"2099-01-01T00:00:00.000Z",placementEvidenceHash:"b".repeat(64),installationIdentity:installation});
    registry.revoke(node.id,{reason:"compromised"});
    const result=createSignedNodeResult({lease,nodeIdentity:worker,status:"completed",output:{ok:true}});
    expect(()=>registry.acceptResult({result,lease,installationPublicKeyPem:installation.publicKeyPem,expectedInstallationKeyId:installation.keyId,replayLedger:new JsonFileReplayLedger(join(mkdtempSync(join(tmpdir(),"titai-node-revoked-")),"ledger.json"))})).toThrow("node_revoked");
  });
});
