/**
 * TFA Frontend Risk Intelligence — factor-attribution explainability over the fusion engine.
 *
 * Zero runtime dependencies.
 */

export type {
  Severity,
  FactorAttribution,
  AttributionReport,
  ComplianceNarrative,
} from "./types.ts";

export {
  factorSeverity,
  computeFactorAttribution,
  buildComplianceNarrative,
} from "./attribution.ts";
