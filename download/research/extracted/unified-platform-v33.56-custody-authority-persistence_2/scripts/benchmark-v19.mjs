import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { WorkflowService } from '../dist/src/web/workflow-service.js';

const iterations = Number.parseInt(process.env.V19_BENCHMARK_ITERATIONS ?? '10', 10);
const samples = [];
for (let index = 0; index < iterations; index += 1) {
  const root = mkdtempSync(`${tmpdir()}/v19-benchmark-`);
  const service = new WorkflowService(root);
  const fixture = service.fixture();
  const start = performance.now();
  const intake = await service.intake({
    sourceRepository: fixture.repositoryPath, objective: fixture.objective, targetFile: fixture.targetFile,
    allowedFiles: fixture.allowedFiles, exactBefore: fixture.exactBefore, exactAfter: fixture.exactAfter,
    testCommand: fixture.testCommand, planId: `benchmark-${index}`, idempotencyKey: `benchmark-${index}`,
  });
  const intakeMs = performance.now() - start;
  const executeStart = performance.now();
  const executed = await service.execute(intake.sessionId);
  const executeMs = performance.now() - executeStart;
  const reviewStart = performance.now();
  service.review(intake.sessionId, `reviewer-${index}`);
  service.rollback(intake.sessionId);
  const reviewRollbackMs = performance.now() - reviewStart;
  samples.push({ intakeMs, executeMs, reviewRollbackMs, totalMs: performance.now() - start, testsPassed: executed.testExecution.passed });
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}
const totals = samples.map((sample) => sample.totalMs);
const report = {
  status: 'local-development-benchmark-only',
  iterations,
  allTestsPassed: samples.every((sample) => sample.testsPassed),
  milliseconds: {
    min: Math.min(...totals), median: percentile(totals, 0.5), p95: percentile(totals, 0.95), max: Math.max(...totals),
  },
  environment: { node: process.version, storage: 'local-filesystem-and-git', database: 'not-used-by-repository-workflow' },
  limitations: ['single-host', 'warm-local-cache', 'disposable-small-repository', 'not-load-or-capacity-test', 'not-production-SLO-evidence'],
  samples,
};
const output = resolve('evidence/generated/v19-local-performance.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
