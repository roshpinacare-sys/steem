import type {
  SovereigntyAssessment,
  SovereigntyDependency,
  SovereigntyLevel,
  SovereigntyVector,
} from "./types";

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function assessSovereignty(options: {
  vector: SovereigntyVector;
  dependencies: readonly SovereigntyDependency[];
  requiredEvidence?: Record<string, boolean | undefined>;
}): SovereigntyAssessment {
  const vector = Object.fromEntries(
    Object.entries(options.vector).map(([key, value]) => [key, clampScore(value)]),
  ) as unknown as SovereigntyVector;
  const mandatoryExternalDependencies = options.dependencies
    .filter(
      (dependency) =>
        dependency.mandatory &&
        (dependency.locality === "remote_required" || dependency.locality === "unsupported_offline"),
    )
    .map((dependency) => dependency.id)
    .sort();
  const fatalWeaknesses: string[] = [];
  if (mandatoryExternalDependencies.length > 0) fatalWeaknesses.push("mandatory_external_dependency");
  if (vector.identity < 50) fatalWeaknesses.push("identity_control_insufficient");
  if (vector.recovery < 50) fatalWeaknesses.push("recovery_independence_insufficient");
  if (vector.network < 50) fatalWeaknesses.push("network_independence_insufficient");
  if (vector.supplyChain < 40) fatalWeaknesses.push("supply_chain_transparency_insufficient");
  const evidenceUnknown = Object.entries(options.requiredEvidence ?? {})
    .filter(([, value]) => value !== true)
    .map(([key]) => key)
    .sort();
  const values = Object.values(vector);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  let level: SovereigntyLevel = "non_sovereign";
  if (fatalWeaknesses.length === 0 && mandatoryExternalDependencies.length === 0) {
    if (average >= 90 && evidenceUnknown.length === 0) level = "sovereign_production_candidate";
    else if (average >= 78 && evidenceUnknown.length === 0) level = "sovereign_controlled_pilot";
    else if (average >= 60) level = "sovereign_development_mode";
    else level = "partially_sovereign";
  } else if (average >= 45) {
    level = "partially_sovereign";
  }
  const explanation = `Sovereignty level ${level} from ${values.length} dimensions, ${fatalWeaknesses.length} fatal weakness(es), ${mandatoryExternalDependencies.length} mandatory external dependency(ies), and ${evidenceUnknown.length} unknown evidence gate(s).`;
  return {
    vector,
    fatalWeaknesses,
    mandatoryExternalDependencies,
    level,
    evidenceUnknown,
    explanation,
  };
}

export function dependencyIsOfflineSafe(dependency: SovereigntyDependency): boolean {
  if (!dependency.mandatory) return true;
  if (dependency.networkRequired) return false;
  return dependency.locality === "local_authoritative" || dependency.locality === "local_preferred";
}
