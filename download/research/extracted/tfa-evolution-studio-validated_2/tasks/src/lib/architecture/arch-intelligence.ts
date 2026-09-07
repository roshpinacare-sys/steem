/**
 * TFA Evolution Studio v28 — Architecture Intelligence
 *
 * Builds architecture graphs, detects risks, and identifies
 * refactoring candidates from project source trees.
 */

import fs from "fs";
import path from "path";
import type { ArchGraph, ArchNode, ArchEdge, ArchRisk, RefactorCandidate } from "@/lib/types";

export function buildArchitectureGraph(projectId: string, workspaceRoot: string): ArchGraph {
  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];
  const seen = new Set<string>();

  function walk(dir: string, relBase: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = relBase ? path.join(relBase, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const nodeId = `dir:${rel}`;
        if (!seen.has(nodeId)) {
          seen.add(nodeId);
          nodes.push({ id: nodeId, label: entry.name, type: "module" });
        }
        walk(abs, rel);
      } else {
        const ext = path.extname(entry.name);
        const nodeId = `file:${rel}`;
        if (!seen.has(nodeId)) {
          seen.add(nodeId);
          const type = ext === ".tsx" || ext === ".jsx" ? "component" : "module";
          nodes.push({ id: nodeId, label: entry.name, type, metrics: { size: fs.statSync(abs).size } });
        }
      }
    }
  }

  if (fs.existsSync(workspaceRoot)) {
    walk(workspaceRoot, "");
  }

  // Build synthetic import edges from package.json if present
  const pkgPath = path.join(workspaceRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      for (const dep of deps) {
        const depId = `pkg:${dep}`;
        nodes.push({ id: depId, label: dep, type: "package" });
        edges.push({ from: "dir:", to: depId, type: "dependency" });
      }
    } catch {
      // ignore
    }
  }

  return { nodes, edges };
}

export function analyzeRisks(projectId: string, graph: ArchGraph): ArchRisk[] {
  const risks: ArchRisk[] = [];

  // Detect oversized files
  for (const node of graph.nodes) {
    if (node.type === "module" && (node.metrics?.size ?? 0) > 50_000) {
      risks.push({
        id: `risk_${node.id}`,
        severity: "medium",
        category: "complexity",
        message: `Large file: ${node.label} (${node.metrics!.size} bytes)`,
        filePath: node.label,
      });
    }
  }

  // Detect high fan-out (many dependencies)
  const depCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    depCounts.set(edge.from, (depCounts.get(edge.from) || 0) + 1);
  }
  for (const [from, count] of depCounts.entries()) {
    if (count > 20) {
      risks.push({
        id: `risk_coupling_${from}`,
        severity: "high",
        category: "coupling",
        message: `High fan-out: ${from} depends on ${count} modules`,
      });
    }
  }

  // Detect dead-code candidates (nodes with no edges)
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  for (const node of graph.nodes) {
    if (!connected.has(node.id) && node.type === "module") {
      risks.push({
        id: `risk_dead_${node.id}`,
        severity: "low",
        category: "dead-code",
        message: `Potentially unused: ${node.label}`,
        filePath: node.label,
      });
    }
  }

  return risks;
}

export function detectRefactoringCandidates(projectId: string, graph: ArchGraph): RefactorCandidate[] {
  const candidates: RefactorCandidate[] = [];

  for (const node of graph.nodes) {
    if (node.type === "module" && (node.metrics?.size ?? 0) > 30_000) {
      candidates.push({
        id: `ref_${node.id}`,
        filePath: node.label,
        reason: "File exceeds 30KB; consider splitting into smaller modules.",
        estimatedEffort: (node.metrics!.size ?? 0) > 80_000 ? "large" : "medium",
      });
    }
  }

  return candidates.slice(0, 20);
}

export function detectImportCycles(graph: ArchGraph): string[][] {
  const cycles: string[][] = [];
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type === "import") {
      const list = adj.get(edge.from) || [];
      list.push(edge.to);
      adj.set(edge.from, list);
    }
  }
  function dfs(node: string, path: string[], visited: Set<string>) {
    if (visited.has(node)) {
      const idx = path.indexOf(node);
      if (idx !== -1) cycles.push(path.slice(idx));
      return;
    }
    visited.add(node);
    path.push(node);
    for (const next of adj.get(node) || []) {
      dfs(next, path, new Set(visited));
    }
    path.pop();
  }
  for (const node of graph.nodes.map((n) => n.id)) {
    dfs(node, [], new Set());
  }
  return cycles;
}

export function detectBottlenecks(graph: ArchGraph): ArchNode[] {
  const inDegree = new Map<string, number>();
  for (const edge of graph.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }
  const max = Math.max(...Array.from(inDegree.values()), 0);
  return graph.nodes.filter((n) => (inDegree.get(n.id) || 0) > max * 0.8);
}

export function detectDuplication(graph: ArchGraph): { id1: string; id2: string; similarity: number }[] {
  const dups: { id1: string; id2: string; similarity: number }[] = [];
  const modules = graph.nodes.filter((n) => n.type === "module");
  for (let i = 0; i < modules.length; i++) {
    for (let j = i + 1; j < modules.length; j++) {
      const s1 = modules[i].label;
      const s2 = modules[j].label;
      const sim = s1 === s2 ? 1.0 : 0.0;
      if (sim > 0.5) {
        dups.push({ id1: modules[i].id, id2: modules[j].id, similarity: sim });
      }
    }
  }
  return dups;
}
