import type { GitHubClient } from "../services/github-client.js";
import type { Telemetry } from "../services/telemetry.js";
import type { CoderOutput } from "../schemas/coder-schema.js";

interface ApiEndpoint {
  method: string;
  path: string;
  bodyType?: string;
  responseType?: string;
}

/**
 * Parses newly created API endpoints from a generated patch and synthesizes
 * matching React components with fetch calls, loading states, and error
 * handling. The components are committed to the PR branch.
 */
export async function runUiSynthesizer(
  patch: CoderOutput,
  gh: GitHubClient,
  prNumber: number,
  telemetry?: Telemetry,
): Promise<{ path: string; content: string }[]> {
  const endpoints = extractEndpoints(patch);
  if (!endpoints.length) {
    await telemetry?.decision("ui-synthesizer", "no-endpoints", {});
    return [];
  }

  const components = endpoints.map((ep) => ({
    path: componentPath(ep),
    content: generateComponent(ep),
  }));

  await telemetry?.decision("ui-synthesizer", "components-generated", {
    endpoints: endpoints.length,
    components: components.map((c) => c.path),
  });

  if (components.length) {
    await gh.commitViaGitDB(
      prNumber,
      components,
      "qodo(v24): synthesize UI components for new API endpoints",
    );
  }

  return components;
}

function extractEndpoints(patch: CoderOutput): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const methodRegex = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const zodRegex = /z\.object\(\s*\{([^}]+)\}\s*\)/;

  for (const file of patch.files) {
    if (!/\.(ts|tsx|js|mjs)$/.test(file.path)) continue;
    const matches = file.content.matchAll(methodRegex);
    for (const m of matches) {
      const method = (m[1] as string).toUpperCase();
      const path = m[2] as string;
      const bodyMatch = file.content.match(zodRegex);
      endpoints.push({
        method,
        path,
        bodyType: bodyMatch ? "Record<string, unknown>" : undefined,
        responseType: "unknown",
      });
    }
  }
  return endpoints;
}

function componentPath(ep: ApiEndpoint): string {
  const name = ep.path
    .replace(/^\/api\//, "")
    .replace(/\//g, "-")
    .replace(/:([^/]+)/g, "-$1");
  // Bug 17-C fix: this repo has apps/mission-control, not apps/web.  Committing
  // generated components to a non-existent app path would create the directory
  // structure in the wrong place and break downstream builds.
  return `apps/mission-control/src/components/api-${name}.tsx`;
}

function generateComponent(ep: ApiEndpoint): string {
  const hookName = `use${toPascal(ep.path.replace(/^\/api\//, "").replace(/[:/-]/g, "_"))}`;
  const ComponentName = toPascal(ep.path.replace(/^\/api\//, "").replace(/[:/-]/g, "_")) + "View";

  return `import React, { useState } from "react";

export interface ${ComponentName}Props {
  baseUrl?: string;
}

export function ${hookName}(baseUrl?: string) {
  const [data, setData] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function invoke(body?: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const url = (baseUrl || "") + '${ep.path.replace(/'/g, "\\'")}';
      const res = await fetch(url, {
        method: '${ep.method.replace(/'/g, "\\'")}',
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
      const json = await res.json();
      setData(json);
      return json;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return { data, loading, error, invoke };
}

export function ${ComponentName}(props: ${ComponentName}Props) {
  const { baseUrl } = props;
  const { data, loading, error, invoke } = ${hookName}(baseUrl);
  return (
    <div>
      <button onClick={() => invoke()} disabled={loading}>
        {loading ? "Loading…" : "Call ${ep.method} ${ep.path}"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
`;
}

function toPascal(input: string): string {
  return input
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
