/**
 * github-dependency-graph.ts — Integration: GitHub Dependency Graph SBOM API
 *
 * Fetches the GitHub-native SPDX 2.3 Software Bill of Materials for a repo
 * using the existing GITHUB_TOKEN (no new account or key required).
 *
 * Endpoint: GET /repos/{owner}/{repo}/dependency-graph/sbom
 * Doc: https://docs.github.com/en/rest/dependency-graph/sboms
 *
 * Provides two public capabilities:
 *
 *   1. fetchGitHubSbom()         — raw SPDX package list from GitHub
 *   2. crossCheckDependencyGraph() — surface discrepancies between the
 *      locally-derived npm graph and GitHub's authoritative view
 *
 * Design invariants:
 *   - Never throws; every error path returns an empty/null result.
 *   - Privacy mode (QODO_PRIVACY_MODE=strict): skips external API calls.
 *   - Used as an enrichment source only — never the sole source of truth.
 *
 * Integration with dependency-graph.ts:
 *   enrichGraphWithGitHubSbom() annotates each DepNode with a
 *   `githubReported` flag so blast-radius and confidence-scorer callers
 *   can distinguish packages GitHub considers direct deps from those only
 *   inferred via npm registry calls.
 */

import { log as logger } from '../logger.js';
import { fetchWithTimeout } from '../../utils/fetch-timeout.js';
import type { DependencyGraph, DepNode } from '../dependency-graph.js';

const GH_API_BASE = 'https://api.github.com';
const GH_SBOM_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single package entry extracted from the GitHub SPDX SBOM. */
export interface GitHubSbomPackage {
  /** Normalized package name (npm prefix stripped, e.g. "express" not "npm:express"). */
  name: string;
  /** Version string as reported by GitHub ("1.2.3" or "NOASSERTION"). */
  version: string;
  /** SPDX license expression as concluded by GitHub, or null when absent. */
  license: string | null;
}

/** Top-level result of fetchGitHubSbom(). */
export interface GitHubSbomResult {
  /** All packages found in the SBOM (includes the root package). */
  packages: GitHubSbomPackage[];
  /** ISO timestamp of the API call. */
  fetchedAt: string;
  /** Raw SPDX document name reported by GitHub. */
  spdxDocumentName: string | null;
}

/** Discrepancy between the locally-derived npm graph and GitHub's SBOM. */
export interface DependencyDiscrepancy {
  packageName: string;
  /** Package appears in GitHub SBOM but not in the local npm-derived graph. */
  onlyInGitHub: boolean;
  /** Package appears in the local npm-derived graph but not in GitHub's SBOM. */
  onlyInLocal: boolean;
}

/** Output of crossCheckDependencyGraph(). */
export interface CrossCheckResult {
  /** Packages present only in the GitHub SBOM (possibly transitive deps that
   *  npm didn't fetch, or packages only visible to GitHub's lockfile parser). */
  onlyInGitHub: string[];
  /** Packages present only in the local npm graph (dev deps, private, or
   *  packages GitHub's API skips for private repos on free tier). */
  onlyInLocal: string[];
  /** Packages present in both sources (high-confidence entries). */
  inBoth: string[];
  /** Total packages in the GitHub SBOM (excluding the root package). */
  githubTotal: number;
  /** Total packages in the local npm graph. */
  localTotal: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Raw GitHub SPDX API response shape (only fields we consume). */
interface GhSbomApiResponse {
  sbom?: {
    name?: string;
    packages?: Array<{
      name?: string;
      versionInfo?: string;
      licenseConcluded?: string;
      SPDXID?: string;
    }>;
  };
}

/**
 * Strip the "npm:" ecosystem prefix GitHub adds to SPDX package names.
 * GitHub reports: "npm:express", "npm:@types/node", "npm:lodash"
 * We want:         "express",    "@types/node",     "lodash"
 */
function normalizePackageName(raw: string): string {
  if (raw.startsWith('npm:')) return raw.slice(4);
  // Handle other ecosystem prefixes gracefully (pip:, gem:, etc.)
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0 && colonIdx < 8) return raw.slice(colonIdx + 1);
  return raw;
}

/**
 * Determine whether a SPDX package entry is the root document package
 * (GitHub always includes the repo itself as the first package with
 * SPDXID "SPDXRef-DOCUMENT").
 */
function isRootPackage(pkg: { SPDXID?: string; name?: string }): boolean {
  return pkg.SPDXID === 'SPDXRef-DOCUMENT' || pkg.name === 'NOASSERTION';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the GitHub SPDX SBOM for the given repo.
 *
 * Returns null when:
 *   - QODO_PRIVACY_MODE=strict (no external calls in strict mode)
 *   - githubToken is absent
 *   - The API returns a non-OK status
 *   - A network error occurs
 *
 * @param owner        GitHub repo owner (organization or user).
 * @param repo         GitHub repo name.
 * @param githubToken  GitHub personal access token (contents:read scope required).
 */
export async function fetchGitHubSbom(
  owner: string,
  repo: string,
  githubToken: string | undefined,
): Promise<GitHubSbomResult | null> {
  if (process.env.QODO_PRIVACY_MODE === 'strict') {
    logger.debug('github-dependency-graph: skipping SBOM fetch in strict privacy mode', { owner, repo });
    return null;
  }

  if (!githubToken) {
    logger.debug('github-dependency-graph: GITHUB_TOKEN absent, skipping SBOM fetch', { owner, repo });
    return null;
  }

  const url = `${GH_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dependency-graph/sbom`;

  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'qodo-v24',
        },
      },
      GH_SBOM_TIMEOUT_MS,
    );

    if (res.status === 404) {
      // Dependency graph disabled for this repo or private repo on free tier.
      logger.warn('github-dependency-graph: SBOM endpoint 404 (dependency graph may be disabled)', { owner, repo });
      return null;
    }

    if (res.status === 403) {
      logger.warn('github-dependency-graph: SBOM endpoint 403 (token missing contents:read or dependency graph not enabled)', { owner, repo });
      return null;
    }

    if (!res.ok) {
      logger.warn('github-dependency-graph: SBOM fetch non-OK', { owner, repo, status: res.status });
      return null;
    }

    const data = (await res.json()) as GhSbomApiResponse;
    const rawPackages = data.sbom?.packages ?? [];
    const spdxDocumentName = data.sbom?.name ?? null;

    const packages: GitHubSbomPackage[] = rawPackages
      .filter((p) => !isRootPackage(p) && typeof p.name === 'string' && p.name.length > 0)
      .map((p) => ({
        name: normalizePackageName(p.name!),
        version: p.versionInfo && p.versionInfo !== 'NOASSERTION' ? p.versionInfo : 'unknown',
        license: p.licenseConcluded && p.licenseConcluded !== 'NOASSERTION' ? p.licenseConcluded : null,
      }));

    logger.info('github-dependency-graph: SBOM fetched', { owner, repo, packageCount: packages.length });
    return { packages, fetchedAt: new Date().toISOString(), spdxDocumentName };
  } catch (err) {
    logger.warn('github-dependency-graph: SBOM fetch error (non-fatal)', {
      owner,
      repo,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Cross-check a locally-derived DependencyGraph against GitHub's SBOM.
 *
 * Surfaces:
 *   - Packages GitHub knows about that the local npm graph missed
 *     (e.g. transitive depth > 1, or packages only visible via lockfile)
 *   - Packages in the local graph not reported by GitHub
 *     (e.g. devDependencies GitHub omits, or private/local packages)
 *
 * Returns an empty CrossCheckResult when sbom is null (GitHub fetch was
 * skipped or failed) — callers always receive a valid, usable result.
 *
 * @param localGraph  The DependencyGraph built by dependency-graph.ts.
 * @param sbom        GitHubSbomResult from fetchGitHubSbom(), or null.
 */
export function crossCheckDependencyGraph(
  localGraph: DependencyGraph,
  sbom: GitHubSbomResult | null,
): CrossCheckResult {
  const localNames = new Set(Object.keys(localGraph.nodes));

  if (!sbom) {
    return {
      onlyInGitHub: [],
      onlyInLocal: Array.from(localNames),
      inBoth: [],
      githubTotal: 0,
      localTotal: localNames.size,
    };
  }

  const githubNames = new Set(sbom.packages.map((p) => p.name));

  const onlyInGitHub: string[] = [];
  const onlyInLocal: string[]  = [];
  const inBoth: string[]       = [];

  for (const name of githubNames) {
    if (localNames.has(name)) {
      inBoth.push(name);
    } else {
      onlyInGitHub.push(name);
    }
  }

  for (const name of localNames) {
    if (!githubNames.has(name)) {
      onlyInLocal.push(name);
    }
  }

  return {
    onlyInGitHub: onlyInGitHub.sort(),
    onlyInLocal: onlyInLocal.sort(),
    inBoth: inBoth.sort(),
    githubTotal: githubNames.size,
    localTotal: localNames.size,
  };
}

/**
 * Annotate every DepNode in a DependencyGraph with a `githubReported` flag
 * indicating whether GitHub's SBOM lists that package.
 *
 * This is an in-place mutation — the caller passes in a mutable graph copy.
 * Returns the same graph reference for convenience.
 *
 * When sbom is null (fetch was skipped) all `githubReported` flags are set
 * to undefined so downstream callers can distinguish "not checked" from
 * "checked and not found".
 *
 * @param graph  Mutable DependencyGraph to annotate.
 * @param sbom   GitHubSbomResult, or null if the fetch was skipped/failed.
 */
export function annotateGraphWithGitHubSbom(
  graph: DependencyGraph,
  sbom: GitHubSbomResult | null,
): DependencyGraph {
  if (!sbom) return graph;

  const githubNames = new Set(sbom.packages.map((p) => p.name));
  for (const node of Object.values(graph.nodes)) {
    // DepNode does not define githubReported in its base type; we add it as
    // an extension property. Callers that need it should cast to
    // DepNode & { githubReported?: boolean }.
    (node as DepNode & { githubReported?: boolean }).githubReported = githubNames.has(node.name);
  }
  return graph;
}
