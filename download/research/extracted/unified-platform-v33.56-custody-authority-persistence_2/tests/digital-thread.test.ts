import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../src/contracts/crypto.js';
import { DigitalThread } from '../src/platform/digital-thread.js';

const createdAt = '2026-07-16T12:00:00.000Z';

function node(nodeId: string, tenantId = 'tenant-1') {
  return { nodeId, tenantId, kind: 'COMMITMENT' as const, subject: nodeId, payloadDigest: sha256({ nodeId }), createdAt };
}

test('digital thread produces deterministic root and verifies edges', () => {
  const thread = new DigitalThread();
  thread.addNode(node('a'));
  thread.addNode({ ...node('b'), kind: 'EVIDENCE' });
  thread.addEdge({ edgeId: 'e1', tenantId: 'tenant-1', fromNodeId: 'a', toNodeId: 'b', relation: 'PRODUCED', createdAt });
  const first = thread.verify('tenant-1');
  const second = thread.verify('tenant-1');
  assert.equal(first.ok, true);
  assert.equal(first.root, second.root);
  assert.equal(first.nodeCount, 2);
  assert.equal(first.edgeCount, 1);
});

test('digital thread rejects missing endpoints, self edges and cross-tenant links', () => {
  const thread = new DigitalThread();
  thread.addNode(node('a'));
  thread.addNode(node('b', 'tenant-2'));
  assert.throws(() => thread.addEdge({ edgeId: 'missing', tenantId: 'tenant-1', fromNodeId: 'a', toNodeId: 'c', relation: 'PRODUCED', createdAt }), /thread_edge_endpoint_missing/);
  assert.throws(() => thread.addEdge({ edgeId: 'self', tenantId: 'tenant-1', fromNodeId: 'a', toNodeId: 'a', relation: 'PRODUCED', createdAt }), /thread_self_edge_forbidden/);
  assert.throws(() => thread.addEdge({ edgeId: 'cross', tenantId: 'tenant-1', fromNodeId: 'a', toNodeId: 'b', relation: 'PRODUCED', createdAt }), /cross_tenant_thread_edge/);
});

test('digital thread detects tampering and conflicting identifiers', () => {
  const thread = new DigitalThread();
  thread.addNode(node('a'));
  assert.throws(() => thread.addNode({ ...node('a'), subject: 'changed' }), /thread_node_conflict/);
  process.env.NODE_ENV = 'test';
  thread.unsafeTamperNodeForTest('a', 'tampered');
  assert.equal(thread.verify('tenant-1').ok, false);
  delete process.env.NODE_ENV;
});
