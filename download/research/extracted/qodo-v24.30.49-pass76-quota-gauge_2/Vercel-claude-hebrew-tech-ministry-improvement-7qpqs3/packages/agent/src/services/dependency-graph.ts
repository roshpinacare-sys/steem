/**
 * dependency-graph.ts — D2: npm dependency graph cache (R2-backed).
 *
 * Builds a compact, queryable dependency graph for the repo's package.json
 * by combining:
 *   - Local package.json parsing (for direct deps)
 *   - npm Registry REST API (for transitive depth-1 deps)
 *
 * The graph is cached in R2 (TTL: 24 h) so repeated pipeline runs don't
 * hammer the registry.  It is used by the blast-radius calculator and the
 * Janitor to identify which files are risky to touch due to wide transitive
 * fan-out.
 *
 * DESIGN INVARIANTS
 * - Never throws; returns an empty graph on any error.
 * - Privacy mode: skips npm registry calls; uses local package.json only.
 * - Cache miss → fetch → store; cache hit → return immediately.
 */

import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import type { R2Storage } from "./r2-storage.js";
import type { Telemetry } from "./telemetry.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DepNode {
  name: string;
  version: string;
  /** Direct dependents of this package within the repo's dependency tree. */
  dependents: string[];
  /** Packages this node directly depends on. */
  dependencies: string[];
  /** Whether this package is a devDependency. */
  dev: boolean;
}

export interface DependencyGraph {
  /** ISO timestamp the graph was built. */
  builtAt: string;
  /** Total count of unique packages in the graph. */
  packageCount: number;
  nodes: Record<string, DepNode>;
}

const EMPTY_GRAPH: DependencyGraph = {
  builtAt: new Date().toISOString(),
  packageCount: 0,
  nodes: {},
};

const CACHE_TTL_S = 24 * 60 * 60; // 24 h
const R2_KEY_PREFIX = "dep-graph/";
const NPM_REGISTRY  = "https://registry.npmjs.org";

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function r2Key(owner: string, repo: string): string {
  return `${R2_KEY_PREFIX}${owner}/${repo}/graph.json`;
}

async function readCache(
  owner: string,
  repo: string,
  storage: R2Storage,
): Promise<DependencyGraph | null> {
  try {
    const raw = await storage.getText(r2Key(owner, repo));
    if (!raw) return null;
    const graph = JSON.parse(raw) as DependencyGraph;
    // Expire after CACHE_TTL_S
    const ageMs = Date.now() - Date.parse(graph.builtAt);
    if (ageMs > CACHE_TTL_S * 1000) return null;
    return graph;
  } catch {
    return null;
  }
}

async function writeCache(
  owner: string,
  repo: string,
  graph: DependencyGraph,
  storage: R2Storage,
): Promise<void> {
  try {
    await storage.putText(r2Key(owner, repo), JSON.stringify(graph));
  } catch (e: unknown) {
    log.warn("dependency-graph: R2 cache write failed (non-fatal)", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// npm Registry fetch
// ---------------------------------------------------------------------------

interface NpmPackage {
  dependencies?:    Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function fetchNpmDeps(name: string, version: string): Promise<{ deps: string[]; devDeps: string[] }> {
  const cleanVersion = version.replace(/^[\^~>=<]/, "");
  try {
    const res = await fetchWithTimeout(
      `${NPM_REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(cleanVersion)}`,
      { headers: { Accept: "application/json" } },
      10_000,
    );
    if (!res.ok) return { deps: [], devDeps: [] };
    const pkg = (await res.json()) as NpmPackage;
    return {
      deps:    Object.keys(pkg.dependencies    ?? {}),
      devDeps: Object.keys(pkg.devDependencies ?? {}),
    };
  } catch {
    return { deps: [], devDeps: [] };
  }
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

async function buildGraph(
  packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  telemetry?: Telemetry,
): Promise<DependencyGraph> {
  const nodes: Record<string, DepNode> = {};

  const directDeps    = Object.entries(packageJson.dependencies    ?? {});
  const directDevDeps = Object.entries(packageJson.devDependencies ?? {});
  const allDirect     = [
    ...directDeps.map(([n, v]) => ({ name: n, version: v, dev: false })),
    ...directDevDeps.map(([n, v]) => ({ name: n, version: v, dev: true })),
  ];

  // Fetch transitive depth-1 deps in parallel (capped at 50 to avoid hammering registry)
  const fetchBatch = allDirect.slice(0, 50);
  const fetched = await Promise.all(
    fetchBatch.map(async ({ name, version, dev }) => {
      const { deps, devDeps } = process.env.QODO_PRIVACY_MODE === "strict"
        ? { deps: [], devDeps: [] }
        : await fetchNpmDeps(name, version);
      return { name, version, dev, deps, devDeps };
    }),
  );

  for (const { name, version, dev, deps, devDeps } of fetched) {
    const allDeps = [...deps, ...devDeps];
    nodes[name] = {
      name,
      version,
      dependents: [],  // filled below
      dependencies: allDeps,
      dev,
    };
  }

  // Build reverse dependents index
  for (const [pkgName, node] of Object.entries(nodes)) {
    for (const dep of node.dependencies) {
      if (!nodes[dep]) {
        nodes[dep] = { name: dep, version: "*", dependents: [], dependencies: [], dev: false };
      }
      if (!nodes[dep].dependents.includes(pkgName)) {
        nodes[dep].dependents.push(pkgName);
      }
    }
  }

  const graph: DependencyGraph = {
    builtAt: new Date().toISOString(),
    packageCount: Object.keys(nodes).length,
    nodes,
  };

  await telemetry?.decision("dependency-graph", "graph-built", {
    packageCount: graph.packageCount,
    directDeps: allDirect.length,
    privacyMode: process.env.QODO_PRIVACY_MODE ?? "standard",
  });

  return graph;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the dependency graph for a repo, using R2 cache when available.
 *
 * @param packageJsonContent  Raw string content of the repo's package.json.
 * @param owner               GitHub repo owner (used as cache key).
 * @param repo                GitHub repo name.
 * @param storage             R2Storage instance (optional; disables caching when absent).
 * @param telemetry           Optional telemetry.
 */
export async function loadDependencyGraph(
  packageJsonContent: string,
  owner: string,
  repo: string,
  storage?: R2Storage,
  telemetry?: Telemetry,
): Promise<DependencyGraph> {
  // Try cache first
  if (storage) {
    const cached = await readCache(owner, repo, storage);
    if (cached) {
      await telemetry?.decision("dependency-graph", "cache-hit", { owner, repo, packageCount: cached.packageCount });
      log.info("dependency-graph: cache hit", { owner, repo, packageCount: cached.packageCount });
      return cached;
    }
  }

  let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonContent) as typeof packageJson;
  } catch (e: unknown) {
    log.warn("dependency-graph: failed to parse package.json", { error: e instanceof Error ? e.message : String(e) });
    return EMPTY_GRAPH;
  }

  const graph = await buildGraph(packageJson, telemetry).catch((e: unknown) => {
    log.warn("dependency-graph: buildGraph failed", { error: e instanceof Error ? e.message : String(e) });
    return EMPTY_GRAPH;
  });

  if (storage) await writeCache(owner, repo, graph, storage);
  return graph;
}

/**
 * Return the fan-out count for a given package name —
 * i.e. how many other packages depend on it.
 * High fan-out → touching this package is riskier.
 */
export function getFanOut(graph: DependencyGraph, packageName: string): number {
  return graph.nodes[packageName]?.dependents.length ?? 0;
}

/**
 * Identify high-fan-out packages (dependents count ≥ threshold).
 * Used by blast-radius to flag risky dependency upgrades.
 */
export function getHighFanOutPackages(graph: DependencyGraph, threshold = 5): DepNode[] {
  return Object.values(graph.nodes).filter((n) => n.dependents.length >= threshold);
}
