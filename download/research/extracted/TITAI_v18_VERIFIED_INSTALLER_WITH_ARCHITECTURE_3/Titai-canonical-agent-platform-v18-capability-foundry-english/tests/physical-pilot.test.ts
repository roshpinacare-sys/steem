import { describe, expect, it } from "vitest";
import { evaluatePhysicalPilot, PHYSICAL_PILOT_GATES, type PhysicalEvidenceRecord } from "@/lib/sovereignty/physical-pilot";

const RELEASE = "a".repeat(64);
const HASH = "b".repeat(64);

function record(gateId: PhysicalEvidenceRecord["gateId"], overrides: Partial<PhysicalEvidenceRecord> = {}): PhysicalEvidenceRecord {
  const kindByGate: Record<PhysicalEvidenceRecord["gateId"], PhysicalEvidenceRecord["executionKind"]> = {
    real_local_model: "real_model",
    retrieval_qualification: "real_machine",
    complete_offline_installer: "clean_installation",
    process_network_audit: "real_network_observation",
    os_or_hardware_key_custody: "operating_system_custody",
    browser_accessibility: "real_browser",
    two_separated_nodes: "real_machine",
    hardware_energy_measurement: "hardware_counter",
    signed_update_rehearsal: "real_database_migration",
    backup_clean_restore: "real_restore",
    independent_external_verifier: "independent_machine_verifier",
  };
  return {
    format: "titai-v17-physical-evidence",
    version: 1,
    gateId,
    status: "passed",
    executionKind: kindByGate[gateId],
    collectedAt: "2026-07-11T12:00:00.000Z",
    releaseSha256: RELEASE,
    environment: {
      environmentId: `env-${gateId}`,
      machineFingerprint: gateId === "independent_external_verifier" ? "verifier-host" : "builder-host",
      platform: "linux",
      architecture: "x64",
      collectorVersion: "v17-test",
    },
    evidenceHashes: [HASH],
    metrics: gateId === "two_separated_nodes" ? { machineFingerprints: "node-a,node-b" } : {},
    limitations: [],
    ...overrides,
  };
}

describe("physical pilot evidence", () => {
  it("accepts only a fully physical, hash-bound and machine-separated evidence set", () => {
    const result = evaluatePhysicalPilot(PHYSICAL_PILOT_GATES.map((gate) => record(gate)), {
      finalReleaseSha256: RELEASE,
      builderMachineFingerprint: "builder-host",
      now: new Date("2026-07-11T13:00:00.000Z"),
    });
    expect(result.status).toBe("accepted");
    expect(result.blockers).toEqual([]);
  });

  it("rejects a simulated local-model proof even when labeled passed", () => {
    const records = PHYSICAL_PILOT_GATES.map((gate) => record(gate));
    records[0] = record("real_local_model", { executionKind: "simulation" });
    const result = evaluatePhysicalPilot(records, {
      finalReleaseSha256: RELEASE,
      builderMachineFingerprint: "builder-host",
      now: new Date("2026-07-11T13:00:00.000Z"),
    });
    expect(result.status).toBe("rejected");
    expect(result.blockers).toContainEqual({ gateId: "real_local_model", reason: "physical_execution_kind_invalid" });
  });

  it("rejects same-host verifier and one-node evidence", () => {
    const records = PHYSICAL_PILOT_GATES.map((gate) => record(gate));
    const verifierIndex = records.findIndex((entry) => entry.gateId === "independent_external_verifier");
    records[verifierIndex] = record("independent_external_verifier", {
      environment: { environmentId: "same", machineFingerprint: "builder-host", platform: "linux", architecture: "x64", collectorVersion: "v17-test" },
    });
    const nodeIndex = records.findIndex((entry) => entry.gateId === "two_separated_nodes");
    records[nodeIndex] = record("two_separated_nodes", { metrics: { machineFingerprints: "node-a,node-a" } });
    const result = evaluatePhysicalPilot(records, {
      finalReleaseSha256: RELEASE,
      builderMachineFingerprint: "builder-host",
      now: new Date("2026-07-11T13:00:00.000Z"),
    });
    expect(result.status).toBe("rejected");
    expect(result.blockers.some((blocker) => blocker.reason === "verifier_not_machine_separated")).toBe(true);
    expect(result.blockers.some((blocker) => blocker.reason === "two_distinct_machine_fingerprints_required")).toBe(true);
  });
});
