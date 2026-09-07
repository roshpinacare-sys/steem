export type EvidenceEnvironment = 'simulation' | 'local-single-host' | 'qualified-multi-host';
export interface SloThreshold { readonly metric: string; readonly percentile: 50 | 95 | 99; readonly maximumMs: number; readonly minimumSamples: number; }
export interface SloMeasurement { readonly metric: string; readonly samplesMs: readonly number[]; readonly environment: EvidenceEnvironment; }
export interface SloResult {
  readonly metric: string;
  readonly status: 'insufficient-evidence' | 'local-evidence-only' | 'qualified' | 'failed';
  readonly samples: number;
  readonly percentile: number | null;
  readonly maximumMs: number;
  readonly observedMs: number | null;
  readonly environment: EvidenceEnvironment;
  readonly reasons: readonly string[];
}

export function nearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) throw new Error('percentile_samples_required');
  if (!(percentile > 0 && percentile <= 100)) throw new Error('percentile_invalid');
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('latency_sample_invalid');
  const ordered = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((percentile / 100) * ordered.length));
  return ordered[rank - 1]!;
}

export function evaluateSlo(measurement: SloMeasurement, threshold: SloThreshold): SloResult {
  if (measurement.metric !== threshold.metric) throw new Error('slo_metric_mismatch');
  if (!Number.isInteger(threshold.minimumSamples) || threshold.minimumSamples <= 0 || threshold.maximumMs <= 0) throw new Error('slo_threshold_invalid');
  const reasons: string[] = [];
  if (measurement.samplesMs.length < threshold.minimumSamples) {
    reasons.push('minimum_sample_count_not_met');
    return { metric: measurement.metric, status: 'insufficient-evidence', samples: measurement.samplesMs.length, percentile: threshold.percentile, maximumMs: threshold.maximumMs, observedMs: measurement.samplesMs.length ? nearestRank(measurement.samplesMs, threshold.percentile) : null, environment: measurement.environment, reasons };
  }
  const observedMs = nearestRank(measurement.samplesMs, threshold.percentile);
  if (observedMs > threshold.maximumMs) reasons.push('latency_threshold_exceeded');
  if (measurement.environment !== 'qualified-multi-host') reasons.push('environment_not_qualified_multi_host');
  const status = observedMs > threshold.maximumMs ? 'failed' : measurement.environment === 'qualified-multi-host' ? 'qualified' : 'local-evidence-only';
  return { metric: measurement.metric, status, samples: measurement.samplesMs.length, percentile: threshold.percentile, maximumMs: threshold.maximumMs, observedMs, environment: measurement.environment, reasons };
}
