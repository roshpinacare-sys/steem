import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticChangeDag, type SemanticChangeNode } from '../src/repository/semantic-change-dag.js';

function nodes(): SemanticChangeNode[] {
  return [
    { nodeId: 'req', kind: 'requirement', summary: 'Define behavior', dependsOn: [], files: ['governance-state/REQUIREMENT_REGISTRY.json'], evidenceObligations: ['requirement-approval'], risk: 'low' },
    { nodeId: 'design', kind: 'design', summary: 'Design contract', dependsOn: ['req'], files: ['docs/ADR.md'], evidenceObligations: ['architecture-review'], risk: 'medium' },
    { nodeId: 'code', kind: 'code', summary: 'Implement change', dependsOn: ['design'], files: ['src/change.ts'], evidenceObligations: ['typecheck'], risk: 'high' },
    { nodeId: 'test', kind: 'test', summary: 'Test change', dependsOn: ['code'], files: ['tests/change.test.ts'], evidenceObligations: ['test-report'], risk: 'medium' },
    { nodeId: 'rollback', kind: 'rollback', summary: 'Prepare rollback', dependsOn: ['code'], files: ['ops/rollback.json'], evidenceObligations: ['rollback-rehearsal'], risk: 'low' },
    { nodeId: 'release', kind: 'release', summary: 'Release candidate', dependsOn: ['test', 'rollback'], files: ['package.json'], evidenceObligations: ['artifact-manifest'], risk: 'critical' },
  ];
}

const policy = { maximumImpactedNodes: 10, maximumImpactedFiles: 10, sacredFiles: ['package.json'], requireRollbackForRisk: ['high', 'critical'] as const };

test('semantic change DAG is deterministic and topologically ordered', () => {
  const first = new SemanticChangeDag(nodes());
  const second = new SemanticChangeDag([...nodes()].reverse());
  assert.deepEqual(first.topologicalOrder(), ['req', 'design', 'code', 'rollback', 'test', 'release']);
  assert.equal(first.digest, second.digest);
});

test('change impact expands through dependents and collects evidence', () => {
  const result = new SemanticChangeDag(nodes()).assess(['code'], { ...policy, sacredFiles: [] });
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.orderedImpactedNodeIds, ['code', 'rollback', 'test', 'release']);
  assert.equal(result.rollbackRequired, true);
  assert.ok(result.evidenceObligations.includes('rollback-rehearsal'));
  assert.ok(result.evidenceObligations.includes('artifact-manifest'));
});

test('sacred files and excessive blast radius block the plan', () => {
  const result = new SemanticChangeDag(nodes()).assess(['req'], { ...policy, maximumImpactedNodes: 4 });
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.failures.includes('BLAST_RADIUS_NODE_LIMIT'));
  assert.ok(result.failures.includes('SACRED_FILE_REVIEW_REQUIRED'));
});

test('high-risk path without rollback node is blocked', () => {
  const reduced = nodes().filter((node) => node.nodeId !== 'rollback').map((node) => node.nodeId === 'release' ? { ...node, dependsOn: ['test'] } : node);
  const result = new SemanticChangeDag(reduced).assess(['code'], { ...policy, sacredFiles: [] });
  assert.ok(result.failures.includes('ROLLBACK_NODE_MISSING'));
});

test('cycles, missing dependencies and unsafe paths fail closed', () => {
  assert.throws(() => new SemanticChangeDag([{ ...nodes()[0]!, dependsOn: ['missing'] }]), /missing_dependency/);
  assert.throws(() => new SemanticChangeDag([
    { ...nodes()[0]!, nodeId: 'a', dependsOn: ['b'] },
    { ...nodes()[1]!, nodeId: 'b', dependsOn: ['a'] },
  ]), /cycle/);
  assert.throws(() => new SemanticChangeDag([{ ...nodes()[0]!, files: ['../secret'] }]), /file_path_invalid/);
});
