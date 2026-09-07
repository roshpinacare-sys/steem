/**
 * TFA Evolution Studio v28 — Architecture Intelligence
 *
 * Higher-order analysis layer over arch-store snapshots:
 *   - Detects structural hotspots (high in-degree nodes)
 *   - Identifies isolated modules (no edges)
 *   - Flags circular dependency chains
 *   - Produces a summary report for a given project/version
 */

import type { ArchStoreEntry, ArchGraph } from "@/lib/types";
import { loadArchEntry, loadLatestArchEntry, getDriftHistory } from "./../../lib/architecture/arch-store";

export interface ArchHotspot {
  nodeId: string;
  label: string;
  inDegree: number;
}

export interface ArchIntelligenceReport {
  projectId: string;
  versionId: string;
  generatedAt: string;
  nodeCount: number;
  edgeCount: number;
  hotspots: ArchHotspot[];
  isolatedModules: string[];
  hasCycles: boolean;
  driftChurnScore: number | null; // null if no prior snapshot
  summary: string;
}

// ── Hotspot detection ──────────────────────────────────────────────────────

function detectHotspots(graph: ArchGraph, topN = 5): ArchHotspot[] {
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) inDegree.set(node.id, 0);
  for (const edge of graph.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  return graph.nodes
    .map((n) => ({ nodeId: n.id, label: n.label, inDegree: inDegree.get(n.id) ?? 0 }))
    .filter((h) => h.inDegree > 0)
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, topN);
}

// ── Isolated module detection ──────────────────────────────────────────────

function detectIsolatedModules(graph: ArchGraph): string[] {
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  return graph.nodes.filter((n) => !connected.has(n.id)).map((n) => n.id);
}

// ── Cycle detection (DFS) ─────────────────────────────────────────────────

function hasCycles(graph: ArchGraph): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (dfs(neighbor)) return true;
    }
    inStack.delete(nodeId);
    return false;
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id) && dfs(node.id)) return true;
  }
  return false;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function analyzeArchEntry(entry: ArchStoreEntry): ArchIntelligenceReport {
  const { projectId, versionId } = entry;
  const graph = entry.archGraph ?? entry.moduleGraph ?? entry.depGraph ?? { nodes: [], edges: [] };
  const hotspots = detectHotspots(graph);
  const isolatedModules = detectIsolatedModules(graph);
  const cycles = hasCycles(graph);

  // Most recent drift score for this project
  const driftHistory = getDriftHistory(projectId);
  const latestDrift = driftHistory.length > 0 ? driftHistory[driftHistory.length - 1] : null;
  const driftChurnScore = latestDrift ? latestDrift.churnScore : null;

  const summary = [
    `${graph.nodes.length} nodes, ${graph.edges.length} edges.`,
    hotspots.length > 0 ? `Top hotspot: ${hotspots[0].label} (in-degree ${hotspots[0].inDegree}).` : "No hotspots.",
    isolatedModules.length > 0 ? `${isolatedModules.length} isolated module(s).` : "No isolated modules.",
    cycles ? "⚠ Cyclic dependencies detected." : "No cycles detected.",
    driftChurnScore !== null ? `Drift churn score vs previous snapshot: ${(driftChurnScore * 100).toFixed(1)}%.` : "No prior snapshot for drift comparison.",
  ].join(" ");

  return {
    projectId,
    versionId,
    generatedAt: new Date().toISOString(),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    hotspots,
    isolatedModules,
    hasCycles: cycles,
    driftChurnScore,
    summary,
  };
}

export function analyzeLatestArch(projectId: string): ArchIntelligenceReport | undefined {
  const entry = loadLatestArchEntry(projectId);
  if (!entry) return undefined;
  return analyzeArchEntry(entry);
}

export function analyzeArchVersion(
  projectId: string,
  versionId: string
): ArchIntelligenceReport | undefined {
  const entry = loadArchEntry(projectId, versionId);
  if (!entry) return undefined;
  return analyzeArchEntry(entry);
}
