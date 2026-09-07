import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { generateSovereignSigningIdentity } from "../src/lib/sovereignty/key-hierarchy";
import { JsonFileReplayLedger } from "../src/lib/sovereignty/replay-ledger";
import { createSignedNodeRegistration, issueNodeCapabilityLease, SovereignNodeTrustRegistry, type SignedNodeExecutionResult } from "../src/lib/sovereignty/node-trust";
import type { SovereignNodeProfile } from "../src/lib/sovereignty/types";

const root = process.cwd();
const evidenceDir = resolve(root, "docs/canonical/evidence/v16/multi-node");
mkdirSync(evidenceDir, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "titai-v16-isolated-node-"));
try {
  const installation = generateSovereignSigningIdentity(new Date("2026-07-11T13:35:00.000Z"));
  const workerIdentity = generateSovereignSigningIdentity(new Date("2026-07-11T13:35:01.000Z"));
  const node: SovereignNodeProfile = {
    id: "isolated-worker-process", displayName: "Isolated local worker", trustLevel: "trusted",
    hardware: { id: "container-worker", displayName: "Container worker", cpuArchitecture: process.arch, logicalCores: 2, ramBytes: 2*1024**3, diskFreeBytes: 2*1024**3, thermalState: "unknown", powerSource: "unknown", networkAvailable: false },
    modelIds: [], toolIds: ["local.hash"], tenantIds: ["tenant-v16"], storageFreeBytes: 2*1024**3, currentLoad: 0, health: "healthy",
    energyProfile: { idleWatts: 0, estimatedInferenceWatts: 0, confidence: "unknown" },
  };
  const registry = new SovereignNodeTrustRegistry();
  registry.register({ registration: createSignedNodeRegistration({ node, nodeIdentity: workerIdentity, installationIdentity: installation }), installationPublicKeyPem: installation.publicKeyPem, expectedInstallationKeyId: installation.keyId });
  const lease = issueNodeCapabilityLease({ nodeId: node.id, nodeRevision: registry.currentRevision(node.id), taskId: "task-v16-isolated", tenantId: "tenant-v16", workspaceId: "workspace-v16", capabilityIds: ["local.hash"], expiresAt: "2099-01-01T00:00:00.000Z", placementEvidenceHash: "c".repeat(64), installationIdentity: installation });
  const leasePath = join(temp, "lease.json"); const identityPath = join(temp, "identity.json"); const resultPath = join(temp, "result.json");
  writeFileSync(leasePath, JSON.stringify(lease), { mode: 0o600 }); writeFileSync(identityPath, JSON.stringify(workerIdentity), { mode: 0o600 });
  const worker = spawnSync(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "--tsconfig", "tsconfig.scripts.json", "scripts/v16-node-worker.ts", leasePath, identityPath, resultPath], { cwd: root, encoding: "utf8", timeout: 60_000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  if (worker.status !== 0) throw new Error(`isolated_worker_failed:${worker.status}:${worker.stderr}`);
  const result = JSON.parse(readFileSync(resultPath, "utf8")) as SignedNodeExecutionResult;
  const ledger = new JsonFileReplayLedger(join(temp, "replay.json"));
  const accepted = registry.acceptResult({ result, lease, installationPublicKeyPem: installation.publicKeyPem, expectedInstallationKeyId: installation.keyId, replayLedger: ledger, now: new Date("2026-07-11T13:36:00.000Z") });
  let replayRejected = false; try { registry.acceptResult({ result, lease, installationPublicKeyPem: installation.publicKeyPem, expectedInstallationKeyId: installation.keyId, replayLedger: ledger, now: new Date("2026-07-11T13:36:01.000Z") }); } catch (error) { replayRejected = String(error).includes("replay_detected"); }
  const evidence = { format: "titai-v16-isolated-node-evidence", version: 1, controllerPid: process.pid, workerPid: (accepted.output as { workerPid: number }).workerPid, separateProcess: (accepted.output as { workerPid: number }).workerPid !== process.pid, separateSigningIdentity: (accepted.output as { executionIdentity: string }).executionIdentity !== installation.keyId, tenantScopePreserved: accepted.tenantId === "tenant-v16", workspaceScopePreserved: accepted.workspaceId === "workspace-v16", capabilityLeaseVerified: true, signedResultVerified: true, replayRejected, networkRequired: false };
  writeFileSync(join(evidenceDir, "result.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
} finally { rmSync(temp, { recursive: true, force: true }); }
