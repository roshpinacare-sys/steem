export interface TestLane {
  readonly id: string;
  readonly durationMs: number;
  readonly resources?: readonly string[];
  readonly testFiles: readonly string[];
}

export interface ScheduledLane extends TestLane {
  readonly worker: number;
  readonly startMs: number;
  readonly finishMs: number;
}

export interface TestSchedule {
  readonly workers: number;
  readonly makespanMs: number;
  readonly serialDurationMs: number;
  readonly theoreticalSpeedup: number;
  readonly utilization: number;
  readonly lanes: readonly ScheduledLane[];
}

export interface TestImpactInput {
  readonly tests: Readonly<Record<string, readonly string[]>>;
  readonly changedFiles: readonly string[];
  readonly mandatoryTests?: readonly string[];
  readonly globalInvalidators?: readonly string[];
}

export interface TestImpactPlan {
  readonly mode: 'full' | 'impacted' | 'none';
  readonly selectedTests: readonly string[];
  readonly reasons: readonly string[];
  readonly unknownFiles: readonly string[];
}

export interface TestRunComparison {
  readonly status: 'improved' | 'unchanged' | 'regressed' | 'invalid';
  readonly baselineMs: number;
  readonly currentMs: number;
  readonly speedup: number;
  readonly savedMs: number;
  readonly reasons: readonly string[];
}

export function scheduleTestLanes(lanes: readonly TestLane[], workers: number): TestSchedule {
  if (!Number.isInteger(workers) || workers < 1 || workers > 64) throw new Error('test_worker_count_invalid');
  for (const lane of lanes) {
    if (lane.id.trim() === '' || !Number.isFinite(lane.durationMs) || lane.durationMs <= 0 || lane.testFiles.length === 0) {
      throw new Error('test_lane_invalid');
    }
  }
  const ordered = [...lanes].sort((a, b) => b.durationMs - a.durationMs || a.id.localeCompare(b.id));
  const workerAvailable = Array.from({ length: workers }, () => 0);
  const resourceAvailable = new Map<string, number>();
  const scheduled: ScheduledLane[] = [];
  for (const lane of ordered) {
    let best: ScheduledLane | undefined;
    for (let worker = 0; worker < workers; worker += 1) {
      const resourceReady = Math.max(0, ...(lane.resources ?? []).map((resource) => resourceAvailable.get(resource) ?? 0));
      const startMs = Math.max(workerAvailable[worker]!, resourceReady);
      const candidate: ScheduledLane = { ...lane, worker, startMs, finishMs: startMs + lane.durationMs };
      if (best === undefined || candidate.finishMs < best.finishMs || (candidate.finishMs === best.finishMs && worker < best.worker)) best = candidate;
    }
    if (best === undefined) throw new Error('test_schedule_failed');
    scheduled.push(best);
    workerAvailable[best.worker] = best.finishMs;
    for (const resource of best.resources ?? []) resourceAvailable.set(resource, best.finishMs);
  }
  const serialDurationMs = lanes.reduce((sum, lane) => sum + lane.durationMs, 0);
  const makespanMs = Math.max(0, ...scheduled.map((lane) => lane.finishMs));
  const theoreticalSpeedup = makespanMs === 0 ? 1 : Number((serialDurationMs / makespanMs).toFixed(3));
  const utilization = makespanMs === 0 ? 0 : Number((serialDurationMs / (makespanMs * workers)).toFixed(4));
  return { workers, makespanMs, serialDurationMs, theoreticalSpeedup, utilization, lanes: scheduled.sort((a, b) => a.startMs - b.startMs || a.worker - b.worker) };
}

export function selectImpactedTests(input: TestImpactInput): TestImpactPlan {
  const changed = [...new Set(input.changedFiles.map(normalizePath))].sort();
  const mandatory = [...new Set(input.mandatoryTests ?? [])];
  if (changed.length === 0) return { mode: mandatory.length ? 'impacted' : 'none', selectedTests: mandatory.sort(), reasons: ['no_changed_files'], unknownFiles: [] };
  const invalidators = (input.globalInvalidators ?? ['package.json', 'package-lock.json', 'tsconfig.json', 'tests/helpers.ts']).map(normalizePath);
  const global = changed.filter((file) => invalidators.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)));
  if (global.length > 0) return { mode: 'full', selectedTests: Object.keys(input.tests).sort(), reasons: global.map((file) => `global_invalidator:${file}`), unknownFiles: [] };
  const knownDependencies = new Set(Object.values(input.tests).flat().map(normalizePath));
  const testPaths = new Set(Object.keys(input.tests).map(normalizePath));
  const unknownFiles = changed.filter((file) => !knownDependencies.has(file) && !testPaths.has(file) && !file.startsWith('docs/') && !file.startsWith('evidence/'));
  if (unknownFiles.length > 0) {
    return { mode: 'full', selectedTests: Object.keys(input.tests).sort(), reasons: ['unknown_change_requires_full_suite'], unknownFiles };
  }
  const selected = new Set(mandatory);
  for (const [testPath, dependencies] of Object.entries(input.tests)) {
    const normalizedDependencies = dependencies.map(normalizePath);
    if (changed.some((file) => normalizePath(testPath) === file || normalizedDependencies.includes(file))) selected.add(testPath);
  }
  return { mode: 'impacted', selectedTests: [...selected].sort(), reasons: ['dependency_intersection', mandatory.length ? 'mandatory_sentinels_added' : 'no_mandatory_sentinels'], unknownFiles: [] };
}

export function compareTestRuns(input: {
  readonly baselineMs: number;
  readonly currentMs: number;
  readonly baselineTests: number;
  readonly currentTests: number;
  readonly failedTests: number;
}): TestRunComparison {
  const reasons: string[] = [];
  if (![input.baselineMs, input.currentMs].every((value) => Number.isFinite(value) && value > 0)) reasons.push('invalid_duration');
  if (input.currentTests < input.baselineTests) reasons.push('test_count_reduced');
  if (input.failedTests > 0) reasons.push('test_failures_present');
  if (reasons.length > 0) return { status: 'invalid', baselineMs: input.baselineMs, currentMs: input.currentMs, speedup: 0, savedMs: input.baselineMs - input.currentMs, reasons };
  const speedup = Number((input.baselineMs / input.currentMs).toFixed(3));
  const savedMs = Number((input.baselineMs - input.currentMs).toFixed(3));
  const status = input.currentMs < input.baselineMs * 0.98 ? 'improved' : input.currentMs > input.baselineMs * 1.02 ? 'regressed' : 'unchanged';
  if (status === 'regressed') reasons.push('runtime_regression_over_2_percent');
  if (status === 'improved') reasons.push('runtime_improved_without_test_reduction');
  return { status, baselineMs: input.baselineMs, currentMs: input.currentMs, speedup, savedMs, reasons };
}

function normalizePath(value: string): string { return value.replaceAll('\\', '/').replace(/^\.\//, ''); }
