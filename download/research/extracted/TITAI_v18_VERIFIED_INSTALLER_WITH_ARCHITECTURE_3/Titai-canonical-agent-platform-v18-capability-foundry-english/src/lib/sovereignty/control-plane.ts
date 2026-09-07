import { assessSovereignty } from "./assessment";
import { builtInSovereigntyDependencies } from "./dependency-ledger";
import type {
  SovereigntyAssessment,
  SovereigntyDependency,
  SovereigntyVector,
} from "./types";
import type { NetworkAttempt } from "./network-policy";

export interface SovereigntyControlPlaneSnapshot {
  generatedAt: string;
  operatingMode: "online" | "local_only" | "air_gapped";
  assessment: SovereigntyAssessment;
  dependencies: {
    total: number;
    mandatory: number;
    mandatoryExternal: number;
    remoteOptional: number;
    localAuthoritative: number;
  };
  modelLocality: {
    local: number;
    remoteOptional: number;
    remoteRequired: number;
    unavailable: number;
  };
  network: {
    attempts: number;
    blocked: number;
    allowedLocal: number;
    allowedRemote: number;
    unexpected: number;
    recent: NetworkAttempt[];
  };
  keys: {
    hierarchySeparated: boolean;
    backupKeySeparated: boolean;
    signingKeySeparated: boolean;
    rotationEvidenceKnown: boolean;
  };
  readiness: {
    zeroKeyWorkflow: "pass" | "block" | "unknown";
    signedHandoff: "pass" | "block" | "unknown";
    signedUpdate: "pass" | "block" | "unknown";
    updateRollback: "pass" | "block" | "unknown";
    realMigrationRehearsal: "pass" | "block" | "unknown";
    cleanRestore: "pass" | "block" | "unknown";
    localRetrievalFallback: "pass" | "block" | "unknown";
    portableKeyCustody: "pass" | "block" | "unknown";
    operatingSystemKeyCustody: "pass" | "block" | "unknown";
    cleanOfflineInstall: "pass" | "block" | "unknown";
    processNetworkEvidence: "pass" | "block" | "unknown";
    realLocalModelBenchmark: "pass" | "block" | "unknown";
    browserAccessibility: "pass" | "block" | "unknown";
    multiNodeExecution: "pass" | "block" | "unknown";
    fullSuiteCleanExit: "pass" | "block" | "unknown";
    hardwareEnergyMeasurement: "pass" | "block" | "unknown";
    hashBoundIndependentVerifier: "pass" | "block" | "unknown";
  };

  blockers: string[];
}

export const V16_SOVEREIGNTY_VECTOR: SovereigntyVector = {
  compute: 84,
  model: 66,
  data: 91,
  memory: 86,
  identity: 82,
  tools: 88,
  network: 82,
  updates: 88,
  supplyChain: 78,
  recovery: 91,
  operations: 82,
  energy: 57,
  governance: 88,
};

export function createSovereigntyControlPlaneSnapshot(options: {
  dependencies?: SovereigntyDependency[];
  networkAttempts?: NetworkAttempt[];
  operatingMode?: SovereigntyControlPlaneSnapshot["operatingMode"];
  now?: Date;
  evidence?: Partial<Record<keyof SovereigntyControlPlaneSnapshot["readiness"], boolean>>;
} = {}): SovereigntyControlPlaneSnapshot {
  const dependencies = options.dependencies ?? builtInSovereigntyDependencies();
  const attempts = options.networkAttempts ?? [];
  const evidence = options.evidence ?? {
    zeroKeyWorkflow: true,
    signedHandoff: true,
    signedUpdate: true,
    updateRollback: true,
    realMigrationRehearsal: true,
    cleanRestore: true,
    localRetrievalFallback: true,
    portableKeyCustody: true,
    operatingSystemKeyCustody: false,
    cleanOfflineInstall: false,
    processNetworkEvidence: false,
    realLocalModelBenchmark: false,
    browserAccessibility: false,
    multiNodeExecution: false,
    fullSuiteCleanExit: true,
    hardwareEnergyMeasurement: false,
    hashBoundIndependentVerifier: false,
  };
  const readinessKeys = [
    "zeroKeyWorkflow", "signedHandoff", "signedUpdate", "updateRollback",
    "realMigrationRehearsal", "cleanRestore", "localRetrievalFallback",
    "portableKeyCustody", "operatingSystemKeyCustody", "cleanOfflineInstall",
    "processNetworkEvidence", "realLocalModelBenchmark", "browserAccessibility",
    "multiNodeExecution", "fullSuiteCleanExit", "hardwareEnergyMeasurement",
    "hashBoundIndependentVerifier",
  ] as const;
  const requiredEvidence = Object.fromEntries(
    readinessKeys.map((key) => [key, evidence[key] === true ? true : undefined]),
  );
  const assessment = assessSovereignty({
    vector: V16_SOVEREIGNTY_VECTOR,
    dependencies,
    requiredEvidence,
  });
  const readiness = Object.fromEntries(
    readinessKeys.map((key) => [key, evidence[key] === true ? "pass" : evidence[key] === false ? "block" : "unknown"]),
  ) as SovereigntyControlPlaneSnapshot["readiness"];
  const blockers = [
    ...(readiness.realLocalModelBenchmark !== "pass" ? ["real_local_model_not_executed"] : []),
    ...(readiness.cleanOfflineInstall !== "pass" ? ["clean_offline_install_not_proven"] : []),
    ...(readiness.processNetworkEvidence !== "pass" ? ["process_network_boundary_not_proven"] : []),
    ...(readiness.operatingSystemKeyCustody !== "pass" ? ["os_or_hardware_key_custody_missing"] : []),
    ...(readiness.browserAccessibility !== "pass" ? ["browser_accessibility_not_proven"] : []),
    ...(readiness.multiNodeExecution !== "pass" ? ["real_multi_node_execution_not_proven"] : []),
    ...(readiness.fullSuiteCleanExit !== "pass" ? ["authoritative_test_suite_clean_exit_missing"] : []),
    ...(readiness.hardwareEnergyMeasurement !== "pass" ? ["hardware_energy_measurement_missing"] : []),
    ...(readiness.hashBoundIndependentVerifier !== "pass" ? ["final_independent_verifier_missing"] : []),
    ...assessment.fatalWeaknesses,
  ];
  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    operatingMode: options.operatingMode ?? "local_only",
    assessment,
    dependencies: {
      total: dependencies.length,
      mandatory: dependencies.filter((dependency) => dependency.mandatory).length,
      mandatoryExternal: assessment.mandatoryExternalDependencies.length,
      remoteOptional: dependencies.filter((dependency) => dependency.locality === "remote_optional").length,
      localAuthoritative: dependencies.filter((dependency) => dependency.locality === "local_authoritative").length,
    },
    modelLocality: { local: 0, remoteOptional: 3, remoteRequired: 0, unavailable: 1 },
    network: {
      attempts: attempts.length,
      blocked: attempts.filter((attempt) => !attempt.allowed).length,
      allowedLocal: attempts.filter((attempt) => attempt.allowed && /localhost|127\.|::1/.test(attempt.hostname)).length,
      allowedRemote: attempts.filter((attempt) => attempt.allowed && !/localhost|127\.|::1/.test(attempt.hostname)).length,
      unexpected: attempts.filter((attempt) => attempt.allowed && (options.operatingMode ?? "local_only") !== "online").length,
      recent: attempts.slice(-20),
    },
    keys: {
      hierarchySeparated: true,
      backupKeySeparated: true,
      signingKeySeparated: true,
      rotationEvidenceKnown: false,
    },
    readiness,
    blockers: [...new Set(blockers)].sort(),
  };
}
