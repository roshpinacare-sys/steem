import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, freemem, hostname, platform, arch, totalmem } from "node:os";
import { dirname, resolve } from "node:path";

const output = resolve(process.env.TITAI_V17_PHYSICAL_EVIDENCE ?? "docs/canonical/evidence/v17/physical/current-environment.json");
const releaseSha256 = process.env.TITAI_RELEASE_SHA256 ?? null;
const fingerprintSource = JSON.stringify({ platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, memoryBucketGiB: Math.round(totalmem() / 2 ** 30) });
const machineFingerprint = createHash("sha256").update(fingerprintSource).digest("hex");
const hostAlias = createHash("sha256").update(hostname()).digest("hex").slice(0, 12);
const readJson = (path) => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const model = readJson(resolve("docs/canonical/evidence/v17/model/qualification.json"));
const browser = readJson(resolve("docs/canonical/evidence/v17/browser/evidence.json"));
const installer = readJson(resolve("docs/canonical/evidence/v17/installer/proof.json"));
const network = readJson(resolve("docs/canonical/evidence/v16/network/process-evidence.json"));
const update = readJson(resolve("docs/canonical/evidence/v16/update-rehearsal/result.json"));
const restore = readJson(resolve("docs/canonical/evidence/v14/clean-restore-proof.json")) ?? readJson(resolve("docs/canonical/evidence/v16/restore/clean-restore.json"));

function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function record(gateId, status, executionKind, evidenceValue, reason, metrics = {}, limitations = []) {
  return {
    format: "titai-v17-physical-evidence", version: 1, gateId, status, executionKind,
    collectedAt: new Date().toISOString(), releaseSha256,
    environment: { environmentId: `container-${hostAlias}`, machineFingerprint, platform: platform(), architecture: arch(), collectorVersion: "v17.1" },
    evidenceHashes: evidenceValue ? [digest(evidenceValue)] : [], metrics, reason, limitations,
  };
}
const records = [
  record("real_local_model", model?.status === "passed" ? "passed" : "blocked", "real_model", model, model?.blockers?.join(",") ?? "real_local_model_not_executed", {}, ["Model weights are intentionally outside the source release."]),
  record("retrieval_qualification", "blocked", "real_machine", null, "real_model_retrieval_comparison_not_executed", {}, ["BM25 is implemented and tested, but embeddings and task-quality comparison require a real model."]),
  record("complete_offline_installer", installer?.status === "passed" && installer?.signingMode === "trusted_external" ? "passed" : "blocked", "clean_installation", installer, installer?.status === "passed" ? "installer_uses_development_ephemeral_signing_or_lacks_model_browser_bundle" : "clean_installer_proof_missing", {}, []),
  record("process_network_audit", network?.exitCode === 0 && network?.summary?.remoteSocketObservations === 0 ? "passed" : "blocked", "real_network_observation", network, network ? "" : "process_network_evidence_missing", { unexpectedRemoteConnections: network?.summary?.remoteSocketObservations ?? null }, ["Linux process observation is not equivalent to target Windows firewall proof."]),
  record("os_or_hardware_key_custody", "blocked", "operating_system_custody", null, "os_or_hardware_custody_not_executed", {}, ["Portable encrypted custody is not a TPM or OS key store proof."]),
  record("browser_accessibility", browser?.status === "passed" ? "passed" : "blocked", "real_browser", browser, browser?.blockers?.join(",") ?? "browser_evidence_missing", {}, []),
  record("two_separated_nodes", "blocked", "real_machine", null, "two_physical_or_administratively_separated_hosts_not_observed", { machineFingerprints: machineFingerprint }, []),
  record("hardware_energy_measurement", "blocked", "hardware_counter", null, "target_hardware_energy_counter_or_external_meter_unavailable", { cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytes: freemem() }, []),
  record("signed_update_rehearsal", update ? "passed" : "blocked", "real_database_migration", update, update ? "" : "update_rehearsal_missing", {}, ["Current rehearsal is isolated, not the user Mini-PC physical installation."]),
  record("backup_clean_restore", restore ? "passed" : "blocked", "real_restore", restore, restore ? "" : "clean_restore_evidence_missing", {}, ["Current restore proof is isolated, not an external verifier reproduction."]),
  record("independent_external_verifier", "blocked", "independent_machine_verifier", null, "external_machine_verifier_not_available", {}, []),
];
const pair = generateKeyPairSync("ed25519");
const payload = { format: "titai-v17-physical-evidence-bundle", version: 1, generatedAt: new Date().toISOString(), releaseSha256, records };
const signature = sign(null, Buffer.from(JSON.stringify(payload)), pair.privateKey);
const publicDer = pair.publicKey.export({ type: "spki", format: "der" });
const envelope = { ...payload, collectorIdentity: `v17-${machineFingerprint.slice(0, 16)}`, signatureAlgorithm: "Ed25519", publicKeySpkiBase64: publicDer.toString("base64"), signatureBase64: signature.toString("base64") };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(envelope, null, 2)}\n`);
console.log(JSON.stringify({ output, records: records.length, passed: records.filter((entry) => entry.status === "passed").length, blocked: records.filter((entry) => entry.status !== "passed").length }));
