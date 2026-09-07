import { sha256 } from '../contracts/crypto.js';

export interface StabilityRunObservation {
  readonly status: 'passed' | 'failed';
  readonly tests: number;
  readonly passed: number;
  readonly failed: number;
  readonly timedOut: boolean;
}

export interface StabilityAssuranceInput {
  readonly expectedRuns: number;
  readonly expectedTests: number;
  readonly coefficientOfVariation: number;
  readonly runs: readonly StabilityRunObservation[];
}

export interface StabilityAssuranceReport {
  readonly status: 'PASS' | 'WARN' | 'BLOCK';
  readonly score: number;
  readonly functionalDeterminism: boolean;
  readonly timingVariationPercent: number;
  readonly findings: readonly string[];
  readonly reportDigest: string;
}

export function evaluateStabilityAssurance(input: StabilityAssuranceInput): StabilityAssuranceReport {
  if (!Number.isInteger(input.expectedRuns) || input.expectedRuns < 3 || !Number.isInteger(input.expectedTests) || input.expectedTests <= 0) throw new Error('stability_expectation_invalid');
  if (!Number.isFinite(input.coefficientOfVariation) || input.coefficientOfVariation < 0) throw new Error('stability_variation_invalid');
  const findings: string[] = [];
  if (input.runs.length !== input.expectedRuns) findings.push('measured_run_count_mismatch');
  for (const run of input.runs) {
    if (run.status !== 'passed' || run.timedOut || run.failed !== 0 || run.tests !== input.expectedTests || run.passed !== input.expectedTests) findings.push('functional_run_not_deterministic');
  }
  const functionalDeterminism = findings.length === 0;
  const timingVariationPercent = round(input.coefficientOfVariation * 100);
  if (input.coefficientOfVariation > 0.05) findings.push('timing_variation_above_five_percent');
  else if (input.coefficientOfVariation > 0.03) findings.push('timing_variation_above_three_percent');
  const status: StabilityAssuranceReport['status'] = !functionalDeterminism || input.coefficientOfVariation > 0.05 ? 'BLOCK'
    : input.coefficientOfVariation > 0.03 ? 'WARN' : 'PASS';
  const score = !functionalDeterminism ? 40 : round(Math.max(88, 98 - input.coefficientOfVariation * 100));
  const material = { status, score, functionalDeterminism, timingVariationPercent, findings: [...new Set(findings)].sort() };
  return { ...material, reportDigest: sha256(material) };
}

function round(value: number): number { return Number(value.toFixed(2)); }
