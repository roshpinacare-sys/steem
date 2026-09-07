/**
 * github-dependency-graph.test.ts — Pass 69 / task-37 (GitHub-endpoint half)
 *
 * Tests for the GitHub Dependency Graph SBOM integration:
 *   F1 — fetchGitHubSbom() in integrations/github-dependency-graph.ts
 *   F2 — crossCheckDependencyGraph() in integrations/github-dependency-graph.ts
 *   F3 — annotateGraphWithGitHubSbom() in integrations/github-dependency-graph.ts
 *   DB — design-boundary invariants
 *
 * All external fetch calls are intercepted via vi.stubGlobal('fetch', ...).
 * No real network access occurs.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import {
  fetchGitHubSbom,
  crossCheckDependencyGraph,
  annotateGraphWithGitHubSbom,
  type GitHubSbomResult,
} from '../src/services/integrations/github-dependency-graph.js';
import type { DependencyGraph } from '../src/services/dependency-graph.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const OWNER = 'acme';
const REPO  = 'api';
const TOKEN = 'ghp_test_token';

function makeSbomResponse(packages: Array<{ name: string; versionInfo?: string; licenseConcluded?: string; SPDXID?: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      sbom: {
        name: 'com.github.acme/api',
        packages: [
          // root package (always first in GitHub's response)
          { name: 'acme/api', versionInfo: 'NOASSERTION', SPDXID: 'SPDXRef-DOCUMENT' },
          ...packages,
        ],
      },
    }),
  };
}

function makeLocalGraph(packageNames: string[]): DependencyGraph {
  const nodes: DependencyGraph['nodes'] = {};
  for (const name of packageNames) {
    nodes[name] = { name, version: '1.0.0', dependents: [], dependencies: [], dev: false };
  }
  return { builtAt: new Date().toISOString(), packageCount: packageNames.length, nodes };
}

// ── F1: fetchGitHubSbom ───────────────────────────────────────────────────

describe('F1 — fetchGitHubSbom: no-op conditions', () => {
  beforeEach(() => { delete process.env.QODO_PRIVACY_MODE; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.QODO_PRIVACY_MODE; });

  it('returns null when GITHUB_TOKEN is absent', async () => {
    const result = await fetchGitHubSbom(OWNER, REPO, undefined);
    expect(result).toBeNull();
  });

  it('returns null and skips fetch when QODO_PRIVACY_MODE=strict', async () => {
    process.env.QODO_PRIVACY_MODE = 'strict';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('F1 — fetchGitHubSbom: API error handling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns null on 404 (dependency graph disabled)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    expect(result).toBeNull();
  });

  it('returns null on 403 (token missing scope)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    expect(result).toBeNull();
  });

  it('returns null on 500 (server error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    expect(result).toBeNull();
  });

  it('returns null on network exception (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network timeout'); }));
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    expect(result).toBeNull();
  });
});

describe('F1 — fetchGitHubSbom: successful SBOM parsing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses packages and strips npm: prefix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => makeSbomResponse([
      { name: 'npm:express',      versionInfo: '4.18.2',  licenseConcluded: 'MIT' },
      { name: 'npm:@types/node',  versionInfo: '20.0.0',  licenseConcluded: 'MIT' },
      { name: 'npm:zod',          versionInfo: '3.23.8',  licenseConcluded: 'MIT' },
    ])));
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    expect(result).not.toBeNull();
    expect(result!.packages).toHaveLength(3);
    const names = result!.packages.map((p) => p.name);
    expect(names).toContain('express');
    expect(names).toContain('@types/node');
    expect(names).toContain('zod');
  });

  it('excludes root document package (SPDXRef-DOCUMENT)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => makeSbomResponse([
      { name: 'npm:lodash', versionInfo: '4.17.21', licenseConcluded: 'MIT' },
    ])));
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    expect(result!.packages.every((p) => p.name !== 'acme/api')).toBe(true);
    expect(result!.packages.every((p) => p.name !== 'SPDXRef-DOCUMENT')).toBe(true);
  });

  it('normalizes NOASSERTION version to "unknown"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => makeSbomResponse([
      { name: 'npm:some-pkg', versionInfo: 'NOASSERTION', licenseConcluded: 'MIT' },
    ])));
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    expect(result!.packages[0].version).toBe('unknown');
  });

  it('normalizes NOASSERTION license to null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => makeSbomResponse([
      { name: 'npm:unlicensed-pkg', versionInfo: '1.0.0', licenseConcluded: 'NOASSERTION' },
    ])));
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    expect(result!.packages[0].license).toBeNull();
  });

  it('returns spdxDocumentName from the sbom.name field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => makeSbomResponse([])));
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    expect(result!.spdxDocumentName).toBe('com.github.acme/api');
  });

  it('handles empty packages array gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sbom: { name: 'test', packages: [] } }),
    })));
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    expect(result).not.toBeNull();
    expect(result!.packages).toHaveLength(0);
  });

  it('sends correct GitHub API headers', async () => {
    const fetchSpy = vi.fn(async (..._args: unknown[]) => makeSbomResponse([]));
    vi.stubGlobal('fetch', fetchSpy);
    await fetchGitHubSbom(OWNER, REPO, TOKEN);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/repos/acme/api/dependency-graph/sbom');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect((init.headers as Record<string, string>)['X-GitHub-Api-Version']).toBe('2022-11-28');
  });
});

// ── F2: crossCheckDependencyGraph ────────────────────────────────────────────

describe('F2 — crossCheckDependencyGraph: null SBOM', () => {
  it('returns all local packages as onlyInLocal when SBOM is null', () => {
    const graph = makeLocalGraph(['express', 'lodash', 'zod']);
    const result = crossCheckDependencyGraph(graph, null);
    expect(result.onlyInGitHub).toHaveLength(0);
    expect(result.onlyInLocal).toEqual(['express', 'lodash', 'zod'].sort());
    expect(result.inBoth).toHaveLength(0);
    expect(result.githubTotal).toBe(0);
    expect(result.localTotal).toBe(3);
  });
});

describe('F2 — crossCheckDependencyGraph: overlap analysis', () => {
  const sbom: GitHubSbomResult = {
    packages: [
      { name: 'express', version: '4.18.2', license: 'MIT' },
      { name: 'zod',     version: '3.23.8', license: 'MIT' },
      { name: 'semver',  version: '7.6.3',  license: 'ISC' }, // only in GitHub
    ],
    fetchedAt: new Date().toISOString(),
    spdxDocumentName: 'test',
  };

  it('correctly identifies packages in both sources', () => {
    const graph = makeLocalGraph(['express', 'zod', 'lodash']);
    const result = crossCheckDependencyGraph(graph, sbom);
    expect(result.inBoth.sort()).toEqual(['express', 'zod'].sort());
  });

  it('correctly identifies packages only in GitHub', () => {
    const graph = makeLocalGraph(['express', 'zod', 'lodash']);
    const result = crossCheckDependencyGraph(graph, sbom);
    expect(result.onlyInGitHub).toContain('semver');
    expect(result.onlyInGitHub).not.toContain('express');
  });

  it('correctly identifies packages only in local graph', () => {
    const graph = makeLocalGraph(['express', 'zod', 'lodash']);
    const result = crossCheckDependencyGraph(graph, sbom);
    expect(result.onlyInLocal).toContain('lodash');
    expect(result.onlyInLocal).not.toContain('semver');
  });

  it('reports correct total counts', () => {
    const graph = makeLocalGraph(['express', 'zod', 'lodash']);
    const result = crossCheckDependencyGraph(graph, sbom);
    expect(result.githubTotal).toBe(3);
    expect(result.localTotal).toBe(3);
  });

  it('returns sorted arrays', () => {
    const graph = makeLocalGraph(['zod', 'express', 'lodash']);
    const result = crossCheckDependencyGraph(graph, sbom);
    expect(result.onlyInLocal).toEqual([...result.onlyInLocal].sort());
    expect(result.inBoth).toEqual([...result.inBoth].sort());
  });
});

// ── F3: annotateGraphWithGitHubSbom ──────────────────────────────────────────

describe('F3 — annotateGraphWithGitHubSbom: annotation behavior', () => {
  it('sets githubReported=true for packages present in SBOM', () => {
    const graph = makeLocalGraph(['express', 'lodash']);
    const sbom: GitHubSbomResult = {
      packages: [{ name: 'express', version: '4.18.2', license: 'MIT' }],
      fetchedAt: new Date().toISOString(),
      spdxDocumentName: null,
    };
    const annotated = annotateGraphWithGitHubSbom(graph, sbom);
    const expressNode = annotated.nodes['express'] as unknown as Record<string, unknown>;
    expect(expressNode['githubReported']).toBe(true);
  });

  it('sets githubReported=false for packages absent from SBOM', () => {
    const graph = makeLocalGraph(['express', 'lodash']);
    const sbom: GitHubSbomResult = {
      packages: [{ name: 'express', version: '4.18.2', license: 'MIT' }],
      fetchedAt: new Date().toISOString(),
      spdxDocumentName: null,
    };
    const annotated = annotateGraphWithGitHubSbom(graph, sbom);
    const lodashNode = annotated.nodes['lodash'] as unknown as Record<string, unknown>;
    expect(lodashNode['githubReported']).toBe(false);
  });

  it('returns the same graph reference (in-place mutation)', () => {
    const graph = makeLocalGraph(['express']);
    const sbom: GitHubSbomResult = {
      packages: [{ name: 'express', version: '4.18.2', license: 'MIT' }],
      fetchedAt: new Date().toISOString(),
      spdxDocumentName: null,
    };
    const result = annotateGraphWithGitHubSbom(graph, sbom);
    expect(result).toBe(graph);
  });

  it('returns graph unchanged when SBOM is null', () => {
    const graph = makeLocalGraph(['express', 'lodash']);
    const result = annotateGraphWithGitHubSbom(graph, null);
    expect(result).toBe(graph);
    // No githubReported flags added
    for (const node of Object.values(result.nodes)) {
      expect((node as unknown as Record<string, unknown>)['githubReported']).toBeUndefined();
    }
  });
});

// ── DB: design-boundary invariants ───────────────────────────────────────────

describe('DB — design boundaries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('DB1: fail-open — fetchGitHubSbom never throws on malformed JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('bad json'); },
    })));
    await expect(fetchGitHubSbom(OWNER, REPO, TOKEN)).resolves.toBeNull();
  });

  it('DB2: crossCheckDependencyGraph is deterministic for the same inputs', () => {
    const graph = makeLocalGraph(['a', 'b', 'c']);
    const sbom: GitHubSbomResult = {
      packages: [
        { name: 'a', version: '1.0.0', license: null },
        { name: 'd', version: '1.0.0', license: null },
      ],
      fetchedAt: new Date().toISOString(),
      spdxDocumentName: null,
    };
    const r1 = crossCheckDependencyGraph(graph, sbom);
    const r2 = crossCheckDependencyGraph(graph, sbom);
    expect(r1).toEqual(r2);
  });

  it('DB3: annotateGraphWithGitHubSbom handles empty graph without error', () => {
    const emptyGraph = makeLocalGraph([]);
    const sbom: GitHubSbomResult = {
      packages: [{ name: 'express', version: '4.18.2', license: 'MIT' }],
      fetchedAt: new Date().toISOString(),
      spdxDocumentName: null,
    };
    expect(() => annotateGraphWithGitHubSbom(emptyGraph, sbom)).not.toThrow();
  });

  it('DB4: non-npm ecosystem prefixes are stripped correctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        sbom: {
          name: 'test',
          packages: [
            { name: 'pip:requests',   versionInfo: '2.31.0' },
            { name: 'gem:rails',      versionInfo: '7.0.0' },
            { name: 'npm:express',    versionInfo: '4.18.2' },
            { name: 'bare-name',      versionInfo: '1.0.0' }, // no prefix
          ],
        },
      }),
    })));
    const result = await fetchGitHubSbom(OWNER, REPO, TOKEN);
    const names = result!.packages.map((p) => p.name);
    expect(names).toContain('requests');
    expect(names).toContain('rails');
    expect(names).toContain('express');
    expect(names).toContain('bare-name');
  });
});
