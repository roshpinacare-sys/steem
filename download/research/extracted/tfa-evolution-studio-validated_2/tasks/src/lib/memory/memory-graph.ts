/**
 * TFA Evolution Studio v30 — Engineering Memory Graph
 *
 * WS4: Converts raw platform experiences — successes, failures, recoveries,
 * policies, playbooks, and architecture patterns — into a typed knowledge
 * graph where nodes are experiences and edges are causal/sequential relationships.
 *
 * Graph contract:
 *   MemoryNode  — typed knowledge artifact with confidence and evidence
 *   MemoryEdge  — causal link (causes, resolves, extends, validates, contradicts)
 *   MemoryGraph — queryable graph with traversal helpers
 *
 * All nodes and edges are file-backed and survive restarts.
 * Future execution benefits from prior experience via graph traversal.
 */

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { EvidenceNode } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────

export type MemoryNodeKind =
  | "success"
  | "failure"
  | "recovery"
  | "policy"
  | "playbook"
  | "pattern"
  | "lesson"
  | "decision";

export type MemoryEdgeKind =
  | "causes"
  | "resolves"
  | "extends"
  | "validates"
  | "contradicts"
  | "precedes"
  | "derived_from";

export interface MemoryNode {
  id: string;
  kind: MemoryNodeKind;
  title: string;
  description: string;
  /** 0-1 confidence derived from evidence weight and repetition count. */
  confidence: number;
  /** Number of times this pattern has been observed. */
  observationCount: number;
  projectIds: string[];
  evidence: EvidenceNode[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface MemoryEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: MemoryEdgeKind;
  weight: number;
  createdAt: string;
  rationale: string;
}

export interface MemoryGraph {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  /** Adjacency: nodeId → outbound edges */
  adj: Record<string, MemoryEdge[]>;
}

export interface GraphQuery {
  kind?: MemoryNodeKind;
  minConfidence?: number;
  tag?: string;
  projectId?: string;
  limit?: number;
}

export interface PathResult {
  path: MemoryNode[];
  totalWeight: number;
}

// ── Storage ────────────────────────────────────────────────────────────────

function graphDir(dataRoot: string): string {
  const d = path.join(dataRoot, "memory-graph");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function nodesFile(dataRoot: string): string {
  return path.join(graphDir(dataRoot), "nodes.json");
}

function edgesFile(dataRoot: string): string {
  return path.join(graphDir(dataRoot), "edges.json");
}

function loadNodes(dataRoot: string): MemoryNode[] {
  const f = nodesFile(dataRoot);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return []; }
}

function loadEdges(dataRoot: string): MemoryEdge[] {
  const f = edgesFile(dataRoot);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return []; }
}

function saveNodes(dataRoot: string, nodes: MemoryNode[]): void {
  fs.writeFileSync(nodesFile(dataRoot), JSON.stringify(nodes, null, 2));
}

function saveEdges(dataRoot: string, edges: MemoryEdge[]): void {
  fs.writeFileSync(edgesFile(dataRoot), JSON.stringify(edges, null, 2));
}

// ── Graph construction ────────────────────────────────────────────────────

function buildAdj(edges: MemoryEdge[]): Record<string, MemoryEdge[]> {
  const adj: Record<string, MemoryEdge[]> = {};
  for (const e of edges) {
    if (!adj[e.fromId]) adj[e.fromId] = [];
    adj[e.fromId].push(e);
  }
  return adj;
}

/**
 * Load the full memory graph from disk.
 */
export function loadMemoryGraph(dataRoot: string): MemoryGraph {
  const nodes = loadNodes(dataRoot);
  const edges = loadEdges(dataRoot);
  return { nodes, edges, adj: buildAdj(edges) };
}

// ── Mutation helpers ──────────────────────────────────────────────────────

/**
 * Add or update a memory node.
 * If a node with the same title and kind exists, it is updated (confidence
 * raised, observation count incremented, evidence merged).
 */
export function upsertMemoryNode(
  dataRoot: string,
  input: Omit<MemoryNode, "id" | "createdAt" | "updatedAt" | "observationCount">
): MemoryNode {
  const nodes = loadNodes(dataRoot);
  const existing = nodes.find(
    (n) => n.kind === input.kind && n.title.toLowerCase() === input.title.toLowerCase()
  );

  if (existing) {
    existing.observationCount += 1;
    existing.confidence = Math.min(1, existing.confidence + 0.05);
    existing.projectIds = [...new Set([...existing.projectIds, ...input.projectIds])];
    existing.evidence = [...existing.evidence, ...input.evidence].slice(-20);
    existing.tags = [...new Set([...existing.tags, ...input.tags])];
    existing.description = input.description;
    existing.updatedAt = new Date().toISOString();
    Object.assign(existing.metadata, input.metadata);
    saveNodes(dataRoot, nodes);
    return existing;
  }

  const node: MemoryNode = {
    ...input,
    id: uuidv4(),
    observationCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  nodes.push(node);
  saveNodes(dataRoot, nodes);
  return node;
}

/**
 * Add a directed edge between two nodes.
 * Duplicate edges (same from/to/kind) are skipped.
 */
export function addMemoryEdge(
  dataRoot: string,
  fromId: string,
  toId: string,
  kind: MemoryEdgeKind,
  rationale: string,
  weight: number = 1.0
): MemoryEdge | null {
  const edges = loadEdges(dataRoot);
  const exists = edges.some((e) => e.fromId === fromId && e.toId === toId && e.kind === kind);
  if (exists) return null;

  const edge: MemoryEdge = {
    id: uuidv4(),
    fromId,
    toId,
    kind,
    weight,
    rationale,
    createdAt: new Date().toISOString(),
  };
  edges.push(edge);
  saveEdges(dataRoot, edges);
  return edge;
}

// ── Query helpers ─────────────────────────────────────────────────────────

/**
 * Query nodes from the graph with optional filters.
 */
export function queryNodes(graph: MemoryGraph, q: GraphQuery): MemoryNode[] {
  let results = graph.nodes;

  if (q.kind) results = results.filter((n) => n.kind === q.kind);
  if (q.minConfidence !== undefined) results = results.filter((n) => n.confidence >= q.minConfidence!);
  if (q.tag) results = results.filter((n) => n.tags.includes(q.tag!));
  if (q.projectId) results = results.filter((n) => n.projectIds.includes(q.projectId!));

  results = [...results].sort((a, b) => b.confidence - a.confidence);

  if (q.limit) results = results.slice(0, q.limit);
  return results;
}

/**
 * Find the highest-confidence recovery strategy for a given failure description.
 * Uses tag matching and keyword search on node descriptions.
 */
export function findBestRecovery(graph: MemoryGraph, failureDescription: string): MemoryNode | null {
  const keywords = failureDescription.toLowerCase().split(/\s+/);
  const recoveries = graph.nodes.filter((n) => n.kind === "recovery");
  if (recoveries.length === 0) return null;

  const scored = recoveries.map((n) => {
    const text = (n.title + " " + n.description).toLowerCase();
    const matchCount = keywords.filter((k) => text.includes(k)).length;
    return { node: n, score: matchCount * n.confidence };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.node ?? null;
}

/**
 * BFS path from one node to another following edge kinds.
 */
export function findPath(
  graph: MemoryGraph,
  fromId: string,
  toId: string,
  allowedKinds?: MemoryEdgeKind[]
): PathResult | null {
  const queue: Array<{ id: string; path: string[]; weight: number }> = [
    { id: fromId, path: [fromId], weight: 0 },
  ];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { id, path, weight } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    if (id === toId) {
      const nodes = path.map((nid) => graph.nodes.find((n) => n.id === nid)!).filter(Boolean);
      return { path: nodes, totalWeight: weight };
    }

    for (const edge of graph.adj[id] ?? []) {
      if (allowedKinds && !allowedKinds.includes(edge.kind)) continue;
      if (!visited.has(edge.toId)) {
        queue.push({ id: edge.toId, path: [...path, edge.toId], weight: weight + edge.weight });
      }
    }
  }

  return null;
}

/**
 * Return the top N highest-confidence nodes of each kind — the platform's
 * distilled institutional memory for fast orchestration bootstrapping.
 */
export function getKnowledgeSummary(
  graph: MemoryGraph,
  topN: number = 5
): Record<MemoryNodeKind, MemoryNode[]> {
  const kinds: MemoryNodeKind[] = ["success", "failure", "recovery", "policy", "playbook", "pattern", "lesson", "decision"];
  const summary: Partial<Record<MemoryNodeKind, MemoryNode[]>> = {};

  for (const kind of kinds) {
    summary[kind] = queryNodes(graph, { kind, limit: topN });
  }

  return summary as Record<MemoryNodeKind, MemoryNode[]>;
}

// ── Ingestion helpers ─────────────────────────────────────────────────────

export interface CycleOutcomeInput {
  projectId: string;
  success: boolean;
  passRate: number;
  failureReason?: string;
  recoveryPath?: string[];
  evidenceNodes: EvidenceNode[];
  appliedPolicies?: string[];
  architecturePatterns?: string[];
}

/**
 * Ingest a completed cycle outcome into the memory graph.
 * Automatically creates and links the appropriate nodes:
 *   - success → "success" node
 *   - failure → "failure" node + "recovery" node (if recovered)
 *   - policies applied → "policy" nodes linked to outcome
 *   - architecture patterns → "pattern" nodes
 */
export function ingestCycleOutcome(
  dataRoot: string,
  input: CycleOutcomeInput
): { nodesCreated: number; edgesCreated: number; evidence: EvidenceNode[] } {
  let nodesCreated = 0;
  let edgesCreated = 0;
  const outcomeEvidence: EvidenceNode[] = [];

  if (input.success) {
    const node = upsertMemoryNode(dataRoot, {
      kind: "success",
      title: `Successful cycle — project ${input.projectId}`,
      description: `Pass rate ${(input.passRate * 100).toFixed(1)}%. Evidence: ${input.evidenceNodes.filter(e => e.status === "passed").length} passed nodes.`,
      confidence: Math.min(1, 0.5 + input.passRate * 0.5),
      projectIds: [input.projectId],
      evidence: input.evidenceNodes.slice(0, 5),
      tags: ["success", `project:${input.projectId}`],
      metadata: { passRate: input.passRate },
    });
    nodesCreated++;
    outcomeEvidence.push({
      kind: "self_evaluation_completed",
      status: "passed",
      message: `Memory graph: success node upserted for project ${input.projectId} (confidence: ${node.confidence.toFixed(2)})`,
      timestamp: new Date().toISOString(),
      metadata: { nodeId: node.id, observationCount: node.observationCount },
    });
  } else {
    const failNode = upsertMemoryNode(dataRoot, {
      kind: "failure",
      title: `Failure — ${input.failureReason ?? "unknown cause"}`,
      description: input.failureReason ?? "Cycle failed without explicit reason",
      confidence: 0.70,
      projectIds: [input.projectId],
      evidence: input.evidenceNodes.filter((e) => e.status === "failed").slice(0, 5),
      tags: ["failure", `project:${input.projectId}`],
      metadata: { passRate: input.passRate, failureReason: input.failureReason },
    });
    nodesCreated++;

    if (input.recoveryPath && input.recoveryPath.length > 0) {
      const recNode = upsertMemoryNode(dataRoot, {
        kind: "recovery",
        title: `Recovery: ${input.failureReason ?? "cycle failure"}`,
        description: input.recoveryPath.join(" → "),
        confidence: 0.65,
        projectIds: [input.projectId],
        evidence: input.evidenceNodes.slice(0, 3),
        tags: ["recovery", `project:${input.projectId}`],
        metadata: { steps: input.recoveryPath },
      });
      nodesCreated++;

      const edge = addMemoryEdge(dataRoot, failNode.id, recNode.id, "resolves", "Recovery path documented after failure", 1.0);
      if (edge) edgesCreated++;
    }

    outcomeEvidence.push({
      kind: "self_evaluation_completed",
      status: "passed",
      message: `Memory graph: failure node upserted — reason: ${input.failureReason ?? "unknown"}`,
      timestamp: new Date().toISOString(),
      metadata: { nodeId: failNode.id },
    });
  }

  for (const policy of input.appliedPolicies ?? []) {
    upsertMemoryNode(dataRoot, {
      kind: "policy",
      title: policy,
      description: `Auto-applied governance policy in project ${input.projectId}`,
      confidence: 0.80,
      projectIds: [input.projectId],
      evidence: [],
      tags: ["policy"],
      metadata: {},
    });
    nodesCreated++;
  }

  for (const pattern of input.architecturePatterns ?? []) {
    upsertMemoryNode(dataRoot, {
      kind: "pattern",
      title: pattern,
      description: `Architecture pattern observed in project ${input.projectId}`,
      confidence: 0.70,
      projectIds: [input.projectId],
      evidence: [],
      tags: ["pattern"],
      metadata: {},
    });
    nodesCreated++;
  }

  return { nodesCreated, edgesCreated, evidence: outcomeEvidence };
}
