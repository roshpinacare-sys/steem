import { readFileSync, writeFileSync } from "node:fs";
import { createSignedNodeResult, type SignedNodeCapabilityLease } from "../src/lib/sovereignty/node-trust";
import type { SovereignSigningIdentity } from "../src/lib/sovereignty/key-hierarchy";

const [leasePath, identityPath, outputPath] = process.argv.slice(2);
if (!leasePath || !identityPath || !outputPath) throw new Error("worker_arguments_required");
const lease = JSON.parse(readFileSync(leasePath, "utf8")) as SignedNodeCapabilityLease;
const identity = JSON.parse(readFileSync(identityPath, "utf8")) as SovereignSigningIdentity;
if (!lease.payload.capabilityIds.includes("local.hash")) throw new Error("capability_denied");
const output = {
  workerPid: process.pid,
  executionIdentity: identity.keyId,
  taskId: lease.payload.taskId,
  tenantId: lease.payload.tenantId,
  workspaceId: lease.payload.workspaceId,
  mode: "isolated_local_worker",
};
const result = createSignedNodeResult({ lease, nodeIdentity: identity, status: "completed", output });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
