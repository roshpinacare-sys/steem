import assert from 'node:assert/strict';
import test from 'node:test';
import { validateArchitectureIntegrity, type ArchitectureIntegrityInput } from '../src/validation/architecture-integrity.js';

const policy = { contracts: ['contracts'], platform: ['platform','contracts'], product: ['product','platform','contracts'], tests: ['tests','product','platform','contracts'] };
const valid: ArchitectureIntegrityInput = {
  nodes: [
    { nodeId: 'src/contracts/a.ts', layer: 'contracts', kind: 'SOURCE', imports: [] },
    { nodeId: 'src/platform/b.ts', layer: 'platform', kind: 'SOURCE', imports: ['src/contracts/a.ts'] },
    { nodeId: 'src/product/c.ts', layer: 'product', kind: 'SOURCE', imports: ['src/platform/b.ts'] },
    { nodeId: 'tests/c.test.ts', layer: 'tests', kind: 'TEST', imports: ['src/product/c.ts'] },
    { nodeId: 'src/product/cli.ts', layer: 'product', kind: 'ENTRYPOINT', imports: ['src/product/c.ts'] },
  ],
  allowedLayerDependencies: policy,
  capabilityPaths: [{ capabilityId: 'capability-1', componentIds: ['src/contracts/a.ts','src/platform/b.ts','src/product/c.ts'], requiredTestIds: ['tests/c.test.ts'], evidenceRefs: ['evidence:1'], operationalControl: 'action-center', limitations: ['local-only'] }],
};

test('complete layered architecture with test and capability closure passes', () => {
  const report = validateArchitectureIntegrity(valid);
  assert.equal(report.status, 'PASS');
  assert.equal(report.metrics.untestedSourceCount, 0);
  assert.equal(report.metrics.closedCapabilityPathCount, 1);
  assert.match(report.graphDigest, /^[a-f0-9]{64}$/);
});

test('architecture validation detects duplicates, unresolved imports, layer violations, cycles and untested sources', () => {
  const report = validateArchitectureIntegrity({
    ...valid,
    nodes: [
      { nodeId: '', layer: '', kind: 'SOURCE', imports: [] },
      { nodeId: 'src/contracts/a.ts', layer: 'contracts', kind: 'SOURCE', imports: ['src/product/c.ts','missing','missing'] },
      { nodeId: 'src/contracts/a.ts', layer: 'contracts', kind: 'SOURCE', imports: [] },
      { nodeId: 'src/product/c.ts', layer: 'product', kind: 'SOURCE', imports: ['src/contracts/a.ts','tests/c.test.ts'] },
      { nodeId: 'src/product/orphan.ts', layer: 'unknown', kind: 'SOURCE', imports: [] },
      { nodeId: 'tests/c.test.ts', layer: 'tests', kind: 'TEST', imports: ['src/product/c.ts'] },
    ],
    capabilityPaths: [
      { capabilityId: '', componentIds: ['missing-component'], requiredTestIds: ['missing-test'], evidenceRefs: [], operationalControl: '', limitations: [] },
      { capabilityId: '', componentIds: [], requiredTestIds: [], evidenceRefs: [''], operationalControl: 'x', limitations: [] },
    ],
  });
  const codes = new Set(report.findings.map((item) => item.code));
  for (const code of ['ARCH_NODE_INVALID','ARCH_NODE_DUPLICATE','ARCH_IMPORT_UNRESOLVED','ARCH_IMPORT_DUPLICATE','ARCH_LAYER_VIOLATION','ARCH_SOURCE_IMPORTS_TEST','ARCH_LAYER_POLICY_MISSING','ARCH_SOURCE_CYCLE','ARCH_SOURCE_UNTESTED','ARCH_CAPABILITY_ID_INVALID','ARCH_CAPABILITY_COMPONENT_MISSING','ARCH_CAPABILITY_TEST_MISSING','ARCH_CAPABILITY_EVIDENCE_OR_CONTROL_MISSING']) assert.equal(codes.has(code), true, code);
  assert.equal(report.status, 'BLOCK');
});

test('test reachability tolerates test cycles without recursing forever', () => {
  const report = validateArchitectureIntegrity({
    nodes: [
      { nodeId: 'src/a.ts', layer: 'contracts', kind: 'SOURCE', imports: [] },
      { nodeId: 'tests/a.test.ts', layer: 'tests', kind: 'TEST', imports: ['tests/helper.test.ts','src/a.ts'] },
      { nodeId: 'tests/helper.test.ts', layer: 'tests', kind: 'TEST', imports: ['tests/a.test.ts'] },
    ],
    allowedLayerDependencies: { contracts: ['contracts'], tests: ['tests','contracts'] }, capabilityPaths: [],
  });
  assert.equal(report.status, 'PASS');
  assert.equal(report.untestedSources.length, 0);
});
