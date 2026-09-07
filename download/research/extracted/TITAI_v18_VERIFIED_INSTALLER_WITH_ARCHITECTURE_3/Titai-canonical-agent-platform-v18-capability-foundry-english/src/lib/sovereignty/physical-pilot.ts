import { canonicalJson, sha256 } from "@/lib/durable/canonical-json";

export type PhysicalPilotGateId =
  | "real_local_model"
  | "retrieval_qualification"
  | "complete_offline_installer"
  | "process_network_audit"
  | "os_or_hardware_key_custody"
  | "browser_accessibility"
  | "two_separated_nodes"
  | "hardware_energy_measurement"
  | "signed_update_rehearsal"
  | "backup_clean_restore"
  | "independent_external_verifier";

export type PhysicalEvidenceStatus = "passed" | "failed" | "blocked" | "not_run";
export type PhysicalExecutionKind =
  | "real_model"
  | "real_browser"
  | "real_machine"
  | "real_network_observation"
  | "hardware_counter"
  | "external_power_meter"
  | "operating_system_custody"
  | "hardware_custody"
  | "clean_installation"
  | "real_database_migration"
  | "real_restore"
  | "independent_machine_verifier"
  | "simulation"
  | "static_analysis"
  | "estimate";

export interface PhysicalEnvironmentIdentity {
  environmentId: string;
  machineFingerprint: string;
  platform: string;
  architecture: string;
  collectorVersion: string;
}

export interface PhysicalEvidenceRecord {
  format: "titai-v17-physical-evidence";
  version: 1;
  gateId: PhysicalPilotGateId;
  status: PhysicalEvidenceStatus;
  executionKind: PhysicalExecutionKind;
  collectedAt: string;
  releaseSha256?: string;
  environment: PhysicalEnvironmentIdentity;
  evidenceHashes: string[];
  metrics?: Record<string, number | string | boolean | null>;
  reason?: string;
  limitations: string[];
}

export interface PhysicalPilotEvaluation {
  format: "titai-v17-physical-pilot-evaluation";
  version: 1;
  evaluatedAt: string;
  finalReleaseSha256: string;
  status: "accepted" | "rejected";
  sovereigntyClassification: "SOVEREIGN CONTROLLED PILOT" | "SOVEREIGN DEVELOPMENT MODE";
  standardClassification: "CONTROLLED INTERNAL PILOT" | "DEVELOPMENT ONLY";
  gates: Record<PhysicalPilotGateId, PhysicalEvidenceRecord | null>;
  blockers: Array<{ gateId: PhysicalPilotGateId; reason: string }>;
  evidenceDigest: string;
}

export const PHYSICAL_PILOT_GATES: readonly PhysicalPilotGateId[] = [
  "real_local_model",
  "retrieval_qualification",
  "complete_offline_installer",
  "process_network_audit",
  "os_or_hardware_key_custody",
  "browser_accessibility",
  "two_separated_nodes",
  "hardware_energy_measurement",
  "signed_update_rehearsal",
  "backup_clean_restore",
  "independent_external_verifier",
] as const;

const ALLOWED_EXECUTION: Record<PhysicalPilotGateId, readonly PhysicalExecutionKind[]> = {
  real_local_model: ["real_model"],
  retrieval_qualification: ["real_model", "real_machine"],
  complete_offline_installer: ["clean_installation"],
  process_network_audit: ["real_network_observation"],
  os_or_hardware_key_custody: ["operating_system_custody", "hardware_custody"],
  browser_accessibility: ["real_browser"],
  two_separated_nodes: ["real_machine"],
  hardware_energy_measurement: ["hardware_counter", "external_power_meter"],
  signed_update_rehearsal: ["real_database_migration"],
  backup_clean_restore: ["real_restore"],
  independent_external_verifier: ["independent_machine_verifier"],
};

export function validatePhysicalEvidence(record: PhysicalEvidenceRecord, options: {
  expectedReleaseSha256?: string;
  now?: Date;
} = {}): string[] {
  const blockers: string[] = [];
  if (record.format !== "titai-v17-physical-evidence" || record.version !== 1) blockers.push("evidence_format_invalid");
  if (!PHYSICAL_PILOT_GATES.includes(record.gateId)) blockers.push("gate_unknown");
  if (!record.environment.environmentId.trim() || !record.environment.machineFingerprint.trim()) blockers.push("environment_identity_missing");
  if (!record.environment.collectorVersion.trim()) blockers.push("collector_version_missing");
  if (!Number.isFinite(Date.parse(record.collectedAt))) blockers.push("collected_at_invalid");
  if (record.status === "passed") {
    if (!ALLOWED_EXECUTION[record.gateId].includes(record.executionKind)) blockers.push("physical_execution_kind_invalid");
    if (record.evidenceHashes.length === 0) blockers.push("evidence_hash_missing");
    if (record.evidenceHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) blockers.push("evidence_hash_invalid");
    if (!record.releaseSha256) blockers.push("release_hash_missing");
  }
  if (record.status !== "passed" && !record.reason?.trim()) blockers.push("non_pass_reason_missing");
  if (options.expectedReleaseSha256 && record.releaseSha256 !== options.expectedReleaseSha256) blockers.push("release_hash_mismatch");
  const now = options.now ?? new Date();
  if (Number.isFinite(Date.parse(record.collectedAt)) && Date.parse(record.collectedAt) > now.getTime() + 5 * 60_000) blockers.push("evidence_timestamp_in_future");
  return [...new Set(blockers)].sort();
}

export function evaluatePhysicalPilot(records: readonly PhysicalEvidenceRecord[], options: {
  finalReleaseSha256: string;
  builderMachineFingerprint?: string;
  now?: Date;
}): PhysicalPilotEvaluation {
  if (!/^[a-f0-9]{64}$/.test(options.finalReleaseSha256)) throw new Error("final_release_hash_invalid");
  const selected = new Map<PhysicalPilotGateId, PhysicalEvidenceRecord>();
  for (const record of records) {
    const existing = selected.get(record.gateId);
    if (!existing || Date.parse(record.collectedAt) > Date.parse(existing.collectedAt)) selected.set(record.gateId, structuredClone(record));
  }
  const gates = Object.fromEntries(PHYSICAL_PILOT_GATES.map((gateId) => [gateId, selected.get(gateId) ?? null])) as Record<PhysicalPilotGateId, PhysicalEvidenceRecord | null>;
  const blockers: Array<{ gateId: PhysicalPilotGateId; reason: string }> = [];
  for (const gateId of PHYSICAL_PILOT_GATES) {
    const record = gates[gateId];
    if (!record) {
      blockers.push({ gateId, reason: "mandatory_evidence_missing" });
      continue;
    }
    const invalid = validatePhysicalEvidence(record, { expectedReleaseSha256: options.finalReleaseSha256, now: options.now });
    if (invalid.length) blockers.push({ gateId, reason: invalid.join(",") });
    else if (record.status !== "passed") blockers.push({ gateId, reason: record.reason ?? `gate_${record.status}` });
  }
  const verifier = gates.independent_external_verifier;
  if (verifier && options.builderMachineFingerprint && verifier.environment.machineFingerprint === options.builderMachineFingerprint) {
    blockers.push({ gateId: "independent_external_verifier", reason: "verifier_not_machine_separated" });
  }
  const multiNode = gates.two_separated_nodes;
  const nodeFingerprints = String(multiNode?.metrics?.machineFingerprints ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (multiNode?.status === "passed" && new Set(nodeFingerprints).size < 2) {
    blockers.push({ gateId: "two_separated_nodes", reason: "two_distinct_machine_fingerprints_required" });
  }
  const accepted = blockers.length === 0;
  const digestInput = PHYSICAL_PILOT_GATES.map((gateId) => gates[gateId] ? sha256(gates[gateId]) : `${gateId}:missing`);
  return {
    format: "titai-v17-physical-pilot-evaluation",
    version: 1,
    evaluatedAt: (options.now ?? new Date()).toISOString(),
    finalReleaseSha256: options.finalReleaseSha256,
    status: accepted ? "accepted" : "rejected",
    sovereigntyClassification: accepted ? "SOVEREIGN CONTROLLED PILOT" : "SOVEREIGN DEVELOPMENT MODE",
    standardClassification: accepted ? "CONTROLLED INTERNAL PILOT" : "DEVELOPMENT ONLY",
    gates,
    blockers: blockers.sort((a, b) => a.gateId.localeCompare(b.gateId) || a.reason.localeCompare(b.reason)),
    evidenceDigest: sha256(canonicalJson(digestInput)),
  };
}
