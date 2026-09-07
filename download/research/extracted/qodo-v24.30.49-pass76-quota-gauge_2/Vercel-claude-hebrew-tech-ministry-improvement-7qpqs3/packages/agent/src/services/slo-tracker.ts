/**
 * SLO Tracker — evaluates Service Level Objectives based on historical run data.
 * SLO-1: 90% of runs complete in < 15 minutes (900 seconds).
 * SLO-2: Error rate < 10% over trailing 30 runs.
 * Persists run samples to .slo-data.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { log as logger } from './logger.js';

const SLO_FILE = '.slo-data.json';
const WINDOW = 200; // keep last 200 runs for percentile calculation
const TARGET_DURATION_S = 900; // 15 min
const TARGET_PERCENTILE = 0.9;
const TARGET_ERROR_RATE = 0.1;

export interface RunSample {
  runId: string;
  timestamp: string;
  durationSeconds: number;
  success: boolean;
}

export interface SloReport {
  slo1: { target: string; actual: string; met: boolean; p90DurationS: number };
  slo2: { target: string; actual: string; met: boolean; errorRatePct: number };
  samples: number;
  window: number;
  generatedAt: string;
}

function loadSamples(root: string): RunSample[] {
  const p = resolve(root, SLO_FILE);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as RunSample[];
  } catch {
    // File is corrupt (e.g. partial write on abrupt termination).
    // Return an empty window so recording and reporting can continue.
    logger.warn('SLO tracker: data file is malformed JSON; resetting window', { path: p });
    return [];
  }
}

function saveSamples(root: string, samples: RunSample[]): void {
  writeFileSync(resolve(root, SLO_FILE), JSON.stringify(samples, null, 2));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function recordRunSample(
  root: string,
  runId: string,
  durationSeconds: number,
  success: boolean,
): void {
  const samples = loadSamples(root);
  samples.push({ runId, timestamp: new Date().toISOString(), durationSeconds, success });
  saveSamples(root, samples.slice(-WINDOW));
  logger.info('SLO sample recorded', { runId, durationSeconds, success });
}

export function computeSloReport(root: string): SloReport {
  const samples = loadSamples(root);
  const recent = samples.slice(-WINDOW);

  // SLO-1: p90 latency
  const durations = recent.map((s) => s.durationSeconds).sort((a, b) => a - b);
  const p90 = percentile(durations, TARGET_PERCENTILE);
  const slo1Met = p90 <= TARGET_DURATION_S;

  // SLO-2: error rate
  const failures = recent.filter((s) => !s.success).length;
  const errorRate = recent.length > 0 ? failures / recent.length : 0;
  const slo2Met = errorRate <= TARGET_ERROR_RATE;

  const report: SloReport = {
    slo1: {
      target: `p90 < ${TARGET_DURATION_S}s`,
      actual: `p90 = ${p90.toFixed(1)}s`,
      met: slo1Met,
      p90DurationS: p90,
    },
    slo2: {
      target: `error rate < ${TARGET_ERROR_RATE * 100}%`,
      actual: `error rate = ${(errorRate * 100).toFixed(1)}%`,
      met: slo2Met,
      errorRatePct: parseFloat((errorRate * 100).toFixed(1)),
    },
    samples: recent.length,
    window: WINDOW,
    generatedAt: new Date().toISOString(),
  };

  logger.info('SLO report computed', { ...report });
  return report;
}
