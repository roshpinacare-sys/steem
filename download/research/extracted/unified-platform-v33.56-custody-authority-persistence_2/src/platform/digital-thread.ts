import { sha256 } from '../contracts/crypto.js';

export const THREAD_NODE_KINDS = [
  'AUTHORITY_GRANT', 'COMMITMENT', 'REQUIREMENT', 'MISSION', 'ARTIFACT',
  'EVIDENCE', 'CERTIFICATION', 'PASSPORT', 'INCIDENT', 'RECERTIFICATION',
] as const;
export type ThreadNodeKind = (typeof THREAD_NODE_KINDS)[number];

export const THREAD_RELATIONS = [
  'AUTHORIZED_BY', 'REQUIRES', 'EXECUTED_AS', 'PRODUCED', 'SUPPORTS',
  'REVIEWED_BY', 'ATTESTED_BY', 'INVALIDATED_BY', 'TRIGGERS', 'SUPERSEDES',
] as const;
export type ThreadRelation = (typeof THREAD_RELATIONS)[number];

export interface ThreadNode {
  readonly nodeId: string;
  readonly tenantId: string;
  readonly kind: ThreadNodeKind;
  readonly subject: string;
  readonly payloadDigest: string;
  readonly createdAt: string;
}

export interface ThreadEdge {
  readonly edgeId: string;
  readonly tenantId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly relation: ThreadRelation;
  readonly createdAt: string;
}

export interface StoredThreadNode extends ThreadNode { readonly digest: string; }
export interface StoredThreadEdge extends ThreadEdge { readonly digest: string; }
export interface DigitalThreadSnapshot { readonly nodes: readonly StoredThreadNode[]; readonly edges: readonly StoredThreadEdge[]; readonly root: string; }

export class DigitalThread {
  readonly #nodes = new Map<string, StoredThreadNode>();
  readonly #edges = new Map<string, StoredThreadEdge>();


  static fromSnapshot(snapshot: DigitalThreadSnapshot, tenantId: string): DigitalThread {
    if (snapshot.root !== sha256({ nodes: snapshot.nodes, edges: snapshot.edges })) throw new Error('thread_snapshot_root_invalid');
    const thread = new DigitalThread();
    for (const stored of snapshot.nodes) {
      const { digest, ...node } = stored;
      if (node.tenantId !== tenantId || sha256(node) !== digest) throw new Error('thread_snapshot_node_invalid');
      thread.addNode(node);
    }
    for (const stored of snapshot.edges) {
      const { digest, ...edge } = stored;
      if (edge.tenantId !== tenantId || sha256(edge) !== digest) throw new Error('thread_snapshot_edge_invalid');
      thread.addEdge(edge);
    }
    const verified = thread.verify(tenantId);
    if (!verified.ok || verified.root !== snapshot.root) throw new Error('thread_snapshot_integrity_invalid');
    return thread;
  }

  addNode(node: ThreadNode): string {
    validateNode(node);
    const digest = sha256(node);
    const existing = this.#nodes.get(node.nodeId);
    if (existing !== undefined && existing.digest !== digest) throw new Error('thread_node_conflict');
    this.#nodes.set(node.nodeId, { ...structuredClone(node), digest });
    return digest;
  }

  addEdge(edge: ThreadEdge): string {
    validateEdge(edge);
    const from = this.#nodes.get(edge.fromNodeId);
    const to = this.#nodes.get(edge.toNodeId);
    if (from === undefined || to === undefined) throw new Error('thread_edge_endpoint_missing');
    if (from.tenantId !== edge.tenantId || to.tenantId !== edge.tenantId) throw new Error('cross_tenant_thread_edge');
    if (edge.fromNodeId === edge.toNodeId) throw new Error('thread_self_edge_forbidden');
    const digest = sha256(edge);
    const existing = this.#edges.get(edge.edgeId);
    if (existing !== undefined && existing.digest !== digest) throw new Error('thread_edge_conflict');
    this.#edges.set(edge.edgeId, { ...structuredClone(edge), digest });
    return digest;
  }

  snapshot(tenantId: string): DigitalThreadSnapshot {
    const nodes = [...this.#nodes.values()].filter((node) => node.tenantId === tenantId).sort(byId('nodeId'));
    const edges = [...this.#edges.values()].filter((edge) => edge.tenantId === tenantId).sort(byId('edgeId'));
    return { nodes: structuredClone(nodes), edges: structuredClone(edges), root: sha256({ nodes, edges }) };
  }

  verify(tenantId: string): { readonly ok: boolean; readonly root: string; readonly nodeCount: number; readonly edgeCount: number } {
    const snapshot = this.snapshot(tenantId);
    for (const node of snapshot.nodes) if (sha256(stripDigest(node)) !== node.digest) return result(false, snapshot);
    for (const edge of snapshot.edges) {
      if (sha256(stripDigest(edge)) !== edge.digest) return result(false, snapshot);
      if (!snapshot.nodes.some((node) => node.nodeId === edge.fromNodeId)) return result(false, snapshot);
      if (!snapshot.nodes.some((node) => node.nodeId === edge.toNodeId)) return result(false, snapshot);
    }
    return result(true, snapshot);
  }

  unsafeTamperNodeForTest(nodeId: string, subject: string): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('unsafe_test_api_forbidden');
    const node = this.#nodes.get(nodeId);
    if (node === undefined) throw new Error('thread_node_not_found');
    this.#nodes.set(nodeId, { ...node, subject });
  }
}

function result(ok: boolean, snapshot: ReturnType<DigitalThread['snapshot']>) {
  return { ok, root: snapshot.root, nodeCount: snapshot.nodes.length, edgeCount: snapshot.edges.length } as const;
}

function validateNode(node: ThreadNode): void {
  if (node.nodeId.trim() === '') throw new Error('thread_node_id_required');
  if (node.tenantId.trim() === '') throw new Error('thread_tenant_required');
  if (!THREAD_NODE_KINDS.includes(node.kind)) throw new Error('invalid_thread_node_kind');
  if (!/^[a-f0-9]{64}$/.test(node.payloadDigest)) throw new Error('invalid_thread_payload_digest');
  if (!Number.isFinite(Date.parse(node.createdAt))) throw new Error('invalid_thread_created_at');
}

function validateEdge(edge: ThreadEdge): void {
  if (edge.edgeId.trim() === '') throw new Error('thread_edge_id_required');
  if (edge.tenantId.trim() === '') throw new Error('thread_tenant_required');
  if (!THREAD_RELATIONS.includes(edge.relation)) throw new Error('invalid_thread_relation');
  if (!Number.isFinite(Date.parse(edge.createdAt))) throw new Error('invalid_thread_created_at');
}

function stripDigest<T extends { readonly digest: string }>(value: T): Omit<T, 'digest'> {
  const { digest: _digest, ...rest } = value;
  return rest;
}

function byId<K extends string>(key: K) {
  return (a: Record<K, string>, b: Record<K, string>) => a[key].localeCompare(b[key]);
}
