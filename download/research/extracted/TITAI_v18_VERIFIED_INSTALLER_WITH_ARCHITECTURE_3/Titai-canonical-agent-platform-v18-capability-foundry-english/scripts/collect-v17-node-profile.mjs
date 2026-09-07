import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, hostname, networkInterfaces, platform, release, totalmem, type } from "node:os";
import { dirname, resolve } from "node:path";

const output = resolve(process.env.TITAI_V17_NODE_PROFILE ?? "docs/canonical/evidence/v17/nodes/current-node.json");
const role = process.env.TITAI_NODE_ROLE ?? "candidate-worker";
const tenantIds = (process.env.TITAI_NODE_TENANTS ?? "pilot-tenant").split(",").map((value) => value.trim()).filter(Boolean);
const workspaceIds = (process.env.TITAI_NODE_WORKSPACES ?? "pilot-workspace").split(",").map((value) => value.trim()).filter(Boolean);
const identityMaterial = JSON.stringify({ platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, totalmem: totalmem(), osRelease: release() });
const machineFingerprint = createHash("sha256").update(identityMaterial).digest("hex");
const pair = generateKeyPairSync("ed25519");
const publicDer = pair.publicKey.export({ format: "der", type: "spki" });
const profile = {
  format: "titai-v17-node-profile", version: 1, generatedAt: new Date().toISOString(),
  nodeId: `node-${machineFingerprint.slice(0, 16)}`, role, machineFingerprint,
  hostAlias: createHash("sha256").update(hostname()).digest("hex").slice(0, 12),
  hardware: { cpu: cpus()[0]?.model ?? "unknown", logicalCores: cpus().length, totalMemoryBytes: totalmem(), architecture: arch() },
  operatingSystem: { platform: platform(), type: type(), release: release() },
  network: { interfaces: Object.values(networkInterfaces()).flat().filter(Boolean).map((entry) => ({ family: entry.family, internal: entry.internal })).sort((a,b)=>String(a.family).localeCompare(String(b.family))) },
  scope: { tenantIds, workspaceIds },
  trust: { status: "candidate", signingKeyId: createHash("sha256").update(publicDer).digest("hex").slice(0, 24) },
  privacy: { hostnameDisclosed: false, addressesDisclosed: false, serialNumbersDisclosed: false },
};
const signature = sign(null, Buffer.from(JSON.stringify(profile)), pair.privateKey).toString("base64");
const envelope = { profile, signatureAlgorithm: "Ed25519", publicKeySpkiBase64: publicDer.toString("base64"), signatureBase64: signature };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(envelope, null, 2)}\n`);
console.log(JSON.stringify({ output, nodeId: profile.nodeId, machineFingerprint, role }, null, 2));
