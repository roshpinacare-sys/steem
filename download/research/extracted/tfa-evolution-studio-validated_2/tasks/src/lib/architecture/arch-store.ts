/**
 * TFA Evolution Studio v28 — Architecture Store
 *
 * Persists architecture graph snapshots per (project, version) with:
 *   - Full version history index
 *   - Graph drift detection between consecutive snapshots
 *   - Cross-version node churn tracking (added/removed/changed nodes)
 *   - Source-file import graph construction
 *   - Package dependency graph construction
 */

import fs from "fs";
import path from "path";
import { getProjectDir, ensureDir } from "@/lib/paths";
import type { ArchStoreEntry, ArchGraph } from "@/lib/types";

const ARCH_DIR = "architecture";

// ── Path helpers ───────────────────────────────────────────────────────────

function getArchDir(projectId: string): string {
  return ensureDir(path.join(getProjectDir(projectId), ARCH_DIR));
}

function getArchFile(projectId: string, versionId: string): string {
  return path.join(getArchDir(projectId), `${versionId}.json`);
}

function getHistoryFile(projectId: string): string {
  return path.join(getArchDir(projectId), "history.json");
}

function getDriftFile(projectId: string): string {
  return path.join(getArchDir(projectId), "drift.json");
}

// ── History record type ────────────────────────────────────────────────────

interface HistoryRecord {
  versionId: string;
  savedAt: string;
  nodeCount: number;
  edgeCount: number;
}

// ── Drift record type ─────────────────────────────────────────────────────

export interface ArchDriftRecord {
  fromVersionId: string;
  toVersionId: string;
  detectedAt: string;
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: number;
  removedEdges: number;
  churnScore: number; // 0.0–1.0 — higher = more structural change
}

// ── Core persistence ────────────────────────────────────────────────────────

export function saveArchEntry(entry: ArchStoreEntry): void {
  const filePath = getArchFile(entry.projectId, entry.versionId);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));

  const historyFile = getHistoryFile(entry.projectId);
  let history: HistoryRecord[] = [];
  if (fs.existsSync(historyFile)) {
    try { history = JSON.parse(fs.readFileSync(historyFile, "utf-8")); } catch { /* ignore */ }
  }

  // Remove stale entry for same versionId if re-saved, then push fresh record
  const existing = history.findIndex((h) => h.versionId === entry.versionId);
  const graph = entry.archGraph ?? entry.moduleGraph ?? entry.depGraph ?? { nodes: [], edges: [] };
  const record: HistoryRecord = {
    versionId: entry.versionId,
    savedAt: entry.savedAt,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  };
  if (existing !== -1) {
    history[existing] = record;
  } else {
    history.push(record);
  }
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));

  // Compute and persist drift vs. the previous snapshot
  if (history.length >= 2) {
    const prev = history[history.length - 2];
    const prevEntry = loadArchEntry(entry.projectId, prev.versionId);
    if (prevEntry) {
      const prevGraph = prevEntry.archGraph ?? prevEntry.moduleGraph ?? prevEntry.depGraph ?? { nodes: [], edges: [] };
      const drift = computeDrift(prevGraph, graph, prev.versionId, entry.versionId);
      appendDrift(entry.projectId, drift);
    }
  }
}

export function loadArchEntry(projectId: string, versionId: string): ArchStoreEntry | undefined {
  const filePath = getArchFile(projectId, versionId);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ArchStoreEntry;
  } catch {
    return undefined;
  }
}

export function loadLatestArchEntry(projectId: string): ArchStoreEntry | undefined {
  const history = getArchHistory(projectId);
  if (history.length === 0) return undefined;
  const latest = history[history.length - 1];
  return loadArchEntry(projectId, latest.versionId);
}

export function getArchHistory(projectId: string): HistoryRecord[] {
  const historyFile = getHistoryFile(projectId);
  if (!fs.existsSync(historyFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(historyFile, "utf-8")) as HistoryRecord[];
  } catch {
    return [];
  }
}

// ── Drift detection ────────────────────────────────────────────────────────

function computeDrift(
  prev: ArchGraph,
  next: ArchGraph,
  fromVersionId: string,
  toVersionId: string
): ArchDriftRecord {
  const prevNodeIds = new Set(prev.nodes.map((n) => n.id));
  const nextNodeIds = new Set(next.nodes.map((n) => n.id));

  const addedNodes = next.nodes.filter((n) => !prevNodeIds.has(n.id)).map((n) => n.id);
  const removedNodes = prev.nodes.filter((n) => !nextNodeIds.has(n.id)).map((n) => n.id);

  const prevEdgeKeys = new Set(prev.edges.map((e) => `${e.from}→${e.to}`));
  const nextEdgeKeys = new Set(next.edges.map((e) => `${e.from}→${e.to}`));
  const addedEdges = next.edges.filter((e) => !prevEdgeKeys.has(`${e.from}→${e.to}`)).length;
  const removedEdges = prev.edges.filter((e) => !nextEdgeKeys.has(`${e.from}→${e.to}`)).length;

  const totalNodes = Math.max(prevNodeIds.size + nextNodeIds.size, 1);
  const totalEdges = Math.max(prevEdgeKeys.size + nextEdgeKeys.size, 1);
  const churnScore =
    (addedNodes.length + removedNodes.length) / totalNodes * 0.6 +
    (addedEdges + removedEdges) / totalEdges * 0.4;

  return {
    fromVersionId,
    toVersionId,
    detectedAt: new Date().toISOString(),
    addedNodes,
    removedNodes,
    addedEdges,
    removedEdges,
    churnScore: Math.min(1.0, churnScore),
  };
}

function appendDrift(projectId: string, drift: ArchDriftRecord): void {
  const driftFile = getDriftFile(projectId);
  let records: ArchDriftRecord[] = [];
  if (fs.existsSync(driftFile)) {
    try { records = JSON.parse(fs.readFileSync(driftFile, "utf-8")); } catch { /* ignore */ }
  }
  // Deduplicate by (from, to) pair
  const key = `${drift.fromVersionId}→${drift.toVersionId}`;
  const existing = records.findIndex((r) => `${r.fromVersionId}→${r.toVersionId}` === key);
  if (existing !== -1) records[existing] = drift;
  else records.push(drift);
  fs.writeFileSync(driftFile, JSON.stringify(records, null, 2));
}

export function getDriftHistory(projectId: string): ArchDriftRecord[] {
  const driftFile = getDriftFile(projectId);
  if (!fs.existsSync(driftFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(driftFile, "utf-8")) as ArchDriftRecord[];
  } catch {
    return [];
  }
}

export function getHighChurnVersions(
  projectId: string,
  threshold = 0.3
): ArchDriftRecord[] {
  return getDriftHistory(projectId)
    .filter((d) => d.churnScore >= threshold)
    .sort((a, b) => b.churnScore - a.churnScore);
}

// ── Graph builders ─────────────────────────────────────────────────────────

export function buildModuleGraph(_projectId: string, archGraph: ArchGraph): ArchGraph {
  const moduleNodes = archGraph.nodes.filter(
    (n) => n.type === "module" || n.type === "component"
  );
  const moduleIds = new Set(moduleNodes.map((n) => n.id));
  const moduleEdges = archGraph.edges.filter(
    (e) => moduleIds.has(e.from) && moduleIds.has(e.to)
  );
  return { nodes: moduleNodes, edges: moduleEdges };
}

export function buildPackageDependencyGraph(
  _projectId: string,
  workspaceRoot: string
): ArchGraph {
  const pkgPath = path.join(workspaceRoot, "package.json");
  const nodes: ArchGraph["nodes"] = [];
  const edges: ArchGraph["edges"] = [];

  if (!fs.existsSync(pkgPath)) return { nodes, edges };

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const rootId = "pkg:root";
    nodes.push({ id: rootId, label: pkg.name || "root", type: "package" });

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [dep, version] of Object.entries(allDeps)) {
      const depId = `pkg:${dep}`;
      nodes.push({ id: depId, label: `${dep}@${version}`, type: "package" });
      edges.push({ from: rootId, to: depId, type: "dependency" });
    }
  } catch {
    // ignore malformed package.json
  }

  return { nodes, edges };
}

/**
 * Build a source-file import graph by scanning TypeScript/JavaScript files
 * for static import statements. Returns a directed graph of file → imported-file.
 */
export function buildSourceImportGraph(
  sourceRoot: string,
  extensions = [".ts", ".tsx", ".js", ".jsx"]
): ArchGraph {
  const nodes: ArchGraph["nodes"] = [];
  const edges: ArchGraph["edges"] = [];
  const nodeSet = new Set<string>();

  function collectFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFiles(abs));
      } else if (extensions.includes(path.extname(entry.name))) {
        results.push(abs);
      }
    }
    return results;
  }

  const files = collectFiles(sourceRoot);
  const importRe = /^import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/gm;

  for (const file of files) {
    const relFile = path.relative(sourceRoot, file);
    if (!nodeSet.has(relFile)) {
      nodes.push({ id: relFile, label: path.basename(file), type: "module" });
      nodeSet.add(relFile);
    }
    try {
      const content = fs.readFileSync(file, "utf-8");
      let m: RegExpExecArray | null;
      importRe.lastIndex = 0;
      while ((m = importRe.exec(content)) !== null) {
        const imported = m[1];
        if (imported.startsWith(".")) {
          // Relative import — resolve relative to file's directory
          const absImported = path.resolve(path.dirname(file), imported);
          const relImported = path.relative(sourceRoot, absImported);
          if (!nodeSet.has(relImported)) {
            nodes.push({ id: relImported, label: path.basename(imported), type: "module" });
            nodeSet.add(relImported);
          }
          edges.push({ from: relFile, to: relImported, type: "import" });
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return { nodes, edges };
}

// ── Re-export for API route consumers ─────────────────────────────────────
export type { ArchStoreEntry } from "@/lib/types";
