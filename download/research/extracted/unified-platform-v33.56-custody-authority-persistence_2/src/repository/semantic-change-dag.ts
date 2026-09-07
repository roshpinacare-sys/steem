import { sha256 } from '../contracts/crypto.js';

export type ChangeNodeKind = 'requirement' | 'design' | 'code' | 'test' | 'evidence' | 'rollback' | 'release';

export interface SemanticChangeNode {
  readonly nodeId: string;
  readonly kind: ChangeNodeKind;
  readonly summary: string;
  readonly dependsOn: readonly string[];
  readonly files: readonly string[];
  readonly evidenceObligations: readonly string[];
  readonly risk: 'low' | 'medium' | 'high' | 'critical';
}

export interface ChangeImpactPolicy {
  readonly maximumImpactedNodes: number;
  readonly maximumImpactedFiles: number;
  readonly sacredFiles: readonly string[];
  readonly requireRollbackForRisk: readonly SemanticChangeNode['risk'][];
}

export interface ChangeImpactDecision {
  readonly status: 'PASS' | 'BLOCK';
  readonly changedNodeIds: readonly string[];
  readonly orderedImpactedNodeIds: readonly string[];
  readonly impactedFiles: readonly string[];
  readonly evidenceObligations: readonly string[];
  readonly sacredFilesTouched: readonly string[];
  readonly rollbackRequired: boolean;
  readonly failures: readonly string[];
  readonly graphDigest: string;
  readonly decisionDigest: string;
}

/**
 * Deterministic semantic dependency graph for bounded repository changes.
 * It carries no execution authority; it only produces an impact decision.
 */
export class SemanticChangeDag {
  readonly #nodes = new Map<string, SemanticChangeNode>();
  readonly #order: readonly string[];
  readonly #digest: string;

  constructor(nodes: readonly SemanticChangeNode[]) {
    if (nodes.length === 0) throw new Error('semantic_dag_empty');
    for (const raw of nodes) {
      const node = normalizeNode(raw);
      if (this.#nodes.has(node.nodeId)) throw new Error(`semantic_dag_duplicate_node:${node.nodeId}`);
      this.#nodes.set(node.nodeId, node);
    }
    for (const node of this.#nodes.values()) {
      for (const dependency of node.dependsOn) {
        if (!this.#nodes.has(dependency)) throw new Error(`semantic_dag_missing_dependency:${node.nodeId}:${dependency}`);
        if (dependency === node.nodeId) throw new Error(`semantic_dag_self_dependency:${node.nodeId}`);
      }
    }
    this.#order = topologicalOrder(this.#nodes);
    this.#digest = sha256(this.snapshot());
  }

  get digest(): string { return this.#digest; }

  snapshot(): readonly SemanticChangeNode[] {
    return [...this.#nodes.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId)).map((node) => structuredClone(node));
  }

  topologicalOrder(): readonly string[] { return [...this.#order]; }

  assess(changedNodeIds: readonly string[], policy: ChangeImpactPolicy): ChangeImpactDecision {
    validatePolicy(policy);
    const changed = [...new Set(changedNodeIds)].sort();
    if (changed.length === 0) throw new Error('semantic_dag_change_required');
    for (const nodeId of changed) if (!this.#nodes.has(nodeId)) throw new Error(`semantic_dag_unknown_change:${nodeId}`);

    const reverse = reverseDependencies(this.#nodes);
    const impacted = new Set<string>(changed);
    const queue = [...changed];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const dependent of reverse.get(current) ?? []) {
        if (!impacted.has(dependent)) { impacted.add(dependent); queue.push(dependent); }
      }
    }
    const orderedImpactedNodeIds = this.#order.filter((nodeId) => impacted.has(nodeId));
    const impactedNodes = orderedImpactedNodeIds.map((nodeId) => this.#nodes.get(nodeId)!);
    const impactedFiles = sortedUnique(impactedNodes.flatMap((node) => node.files));
    const evidenceObligations = sortedUnique(impactedNodes.flatMap((node) => node.evidenceObligations));
    const sacred = new Set(policy.sacredFiles.map(normalizePath));
    const sacredFilesTouched = impactedFiles.filter((file) => sacred.has(file));
    const rollbackRequired = impactedNodes.some((node) => policy.requireRollbackForRisk.includes(node.risk));
    const failures: string[] = [];
    if (orderedImpactedNodeIds.length > policy.maximumImpactedNodes) failures.push('BLAST_RADIUS_NODE_LIMIT');
    if (impactedFiles.length > policy.maximumImpactedFiles) failures.push('BLAST_RADIUS_FILE_LIMIT');
    if (sacredFilesTouched.length > 0) failures.push('SACRED_FILE_REVIEW_REQUIRED');
    if (rollbackRequired && !impactedNodes.some((node) => node.kind === 'rollback')) failures.push('ROLLBACK_NODE_MISSING');
    const material = {
      status: failures.length === 0 ? 'PASS' as const : 'BLOCK' as const,
      changedNodeIds: changed,
      orderedImpactedNodeIds,
      impactedFiles,
      evidenceObligations,
      sacredFilesTouched,
      rollbackRequired,
      failures: [...failures].sort(),
      graphDigest: this.#digest,
    };
    return { ...material, decisionDigest: sha256(material) };
  }
}

function normalizeNode(node: SemanticChangeNode): SemanticChangeNode {
  if (!/^[a-zA-Z0-9._:-]+$/.test(node.nodeId)) throw new Error('semantic_dag_node_id_invalid');
  if (node.summary.trim() === '') throw new Error(`semantic_dag_summary_required:${node.nodeId}`);
  return {
    ...node,
    summary: node.summary.trim(),
    dependsOn: sortedUnique(node.dependsOn),
    files: sortedUnique(node.files.map(normalizePath)),
    evidenceObligations: sortedUnique(node.evidenceObligations),
  };
}

function topologicalOrder(nodes: ReadonlyMap<string, SemanticChangeNode>): readonly string[] {
  const indegree = new Map<string, number>();
  const reverse = reverseDependencies(nodes);
  for (const node of nodes.values()) indegree.set(node.nodeId, node.dependsOn.length);
  const ready = [...nodes.keys()].filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    order.push(current);
    for (const dependent of reverse.get(current) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) { ready.push(dependent); ready.sort(); }
    }
  }
  if (order.length !== nodes.size) throw new Error('semantic_dag_cycle');
  return order;
}

function reverseDependencies(nodes: ReadonlyMap<string, SemanticChangeNode>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const node of nodes.values()) {
    for (const dependency of node.dependsOn) {
      const dependents = result.get(dependency) ?? [];
      dependents.push(node.nodeId);
      dependents.sort();
      result.set(dependency, dependents);
    }
  }
  return result;
}

function validatePolicy(policy: ChangeImpactPolicy): void {
  if (!Number.isSafeInteger(policy.maximumImpactedNodes) || policy.maximumImpactedNodes < 1) throw new Error('semantic_dag_node_limit_invalid');
  if (!Number.isSafeInteger(policy.maximumImpactedFiles) || policy.maximumImpactedFiles < 1) throw new Error('semantic_dag_file_limit_invalid');
}

function normalizePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.trim() === '' || normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error('semantic_dag_file_path_invalid');
  return normalized;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))].sort();
}
