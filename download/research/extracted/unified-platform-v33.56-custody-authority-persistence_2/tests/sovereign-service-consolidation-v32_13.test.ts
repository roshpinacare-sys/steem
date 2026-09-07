import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSovereignConsolidation, type ConsolidationRequirement, type ServicePrimitiveEvidence } from '../src/platform/sovereign-service-consolidation-v32_13.js';

const requirements: readonly ConsolidationRequirement[] = [
  { serviceId: 'identity', required: true, productionCritical: true, multiHostRequired: true },
  { serviceId: 'relational-database', required: true, productionCritical: true, multiHostRequired: true },
  { serviceId: 'cache', required: true, productionCritical: false, multiHostRequired: false },
  { serviceId: 'job-queue', required: true, productionCritical: false, multiHostRequired: false },
  { serviceId: 'object-storage', required: true, productionCritical: true, multiHostRequired: true },
  { serviceId: 'secrets', required: true, productionCritical: true, multiHostRequired: true },
  { serviceId: 'observability', required: true, productionCritical: false, multiHostRequired: false },
  { serviceId: 'ai-routing', required: true, productionCritical: false, multiHostRequired: false },
  { serviceId: 'email', required: true, productionCritical: false, multiHostRequired: false },
  { serviceId: 'sms', required: false, productionCritical: false, multiHostRequired: false },
  { serviceId: 'payments', required: true, productionCritical: true, multiHostRequired: false },
];
const local = (serviceId: ServicePrimitiveEvidence['serviceId'], patch: Partial<ServicePrimitiveEvidence> = {}): ServicePrimitiveEvidence => ({
  serviceId, implementation: `native-${serviceId}`, sourcePaths: [`src/${serviceId}.ts`], testPaths: [`tests/${serviceId}.test.ts`],
  observed: true, multiHostQualified: false, dataSovereign: true, perUserLicense: false, externalDependency: false, ...patch,
});

test('consolidation eliminates per-user services while preserving honest external and qualification boundaries', () => {
  const evidence = [
    local('identity', { multiHostQualified: true }), local('relational-database', { implementation: 'self-hosted-postgresql', externalDependency: true, multiHostQualified: false }),
    local('cache'), local('job-queue'), local('object-storage'), local('secrets'), local('observability'), local('ai-routing'),
    local('email', { observed: false, dataSovereign: false, externalDependency: true }), local('payments', { observed: false, dataSovereign: false, externalDependency: true }),
  ];
  const report = evaluateSovereignConsolidation(requirements, evidence);
  assert.equal(report.status, 'PASS'); assert.equal(report.nativeServices, 7); assert.equal(report.selfHostedStandards, 1);
  assert.equal(report.unavoidableExternalBoundaries, 2); assert.equal(report.blockedServices, 0); assert.equal(report.eliminatedPerUserLicenses, 8);
  assert.equal(report.decisions.find((item) => item.serviceId === 'relational-database')?.productionQualified, false);
  assert.equal(report.decisions.find((item) => item.serviceId === 'payments')?.disposition, 'EXTERNAL_BOUNDARY');
  assert.match(report.reportDigest, /^[0-9a-f]{64}$/);
});

test('missing or unobserved sovereign primitives block internal service claims', () => {
  const report = evaluateSovereignConsolidation([{ serviceId: 'cache', required: true, productionCritical: false, multiHostRequired: false }], []);
  assert.equal(report.status, 'BLOCK'); assert.equal(report.blockedServices, 1); assert.equal(report.decisions[0]?.reason, 'observed-sovereign-primitive-required');
  const unobserved = evaluateSovereignConsolidation([{ serviceId: 'cache', required: true, productionCritical: false, multiHostRequired: false }], [local('cache', { observed: false })]);
  assert.equal(unobserved.status, 'BLOCK');
});

test('consolidation rejects duplicate and structurally empty evidence', () => {
  assert.throws(() => evaluateSovereignConsolidation([], [local('cache'), local('cache')]), /duplicate_evidence/);
  assert.throws(() => evaluateSovereignConsolidation([], [local('cache', { sourcePaths: [] })]), /evidence_invalid/);
  assert.throws(() => evaluateSovereignConsolidation([
    { serviceId: 'cache', required: true, productionCritical: false, multiHostRequired: false },
    { serviceId: 'cache', required: true, productionCritical: false, multiHostRequired: false },
  ], [local('cache')]), /duplicate_requirement/);
});
