/**
 * canary.ts — Vercel preview deployment and canary traffic routing.
 *
 * Provides helpers used by the pipeline canary phase:
 *   - deployPreview()            — deploy a commit SHA to a Vercel preview
 *   - promoteToProduction()      — promote the preview to production
 *   - routeTrafficToCanary()     — route 5% edge traffic to the preview
 *   - rollbackCanary()           — remove the edge-config routing entry
 *
 * Pass 68 extension — LaunchDarkly feature-flag gate:
 *   - routeTrafficWithFeatureFlag() — evaluate an LD flag before routing;
 *     skip routing (and return a skip result) when the flag is disabled.
 *     Falls back to unconditional routing when LD_SDK_KEY is absent so that
 *     callers that have not configured LaunchDarkly continue working unchanged.
 *
 * Env vars are read lazily inside each function rather than at module-init
 * time, so tests that set process.env after import still work correctly and
 * there is no risk of stale captures when the module is first loaded.
 */
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import { log as logger } from "./logger.js";
import { isCanaryEnabled } from "./integrations/launchdarkly.js";
import type { FlagEvalResult } from "./integrations/launchdarkly.js";

export interface VercelEnv {
  VERCEL_TOKEN?: string;
  VERCEL_PROJECT_ID?: string;
  VERCEL_EDGE_CONFIG_ID?: string;
  /** LaunchDarkly server-side SDK key (Pass 68). */
  LD_SDK_KEY?: string;
}

const EDGE_CONFIG_KEY = "qodo_canary";

async function vercelFetch(token: string, path: string, init: RequestInit) {
  const url = `https://api.vercel.com${path}`;
  const res = await fetchWithTimeout(
    url,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    },
    60_000,
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vercel API ${init.method || "GET"} ${path} failed ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

export async function deployPreview(
  commitSha: string,
  env: VercelEnv = process.env as VercelEnv,
): Promise<{ url: string; id: string }> {
  const token = env.VERCEL_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    throw new Error("VERCEL_TOKEN and VERCEL_PROJECT_ID are required for canary deployments");
  }
  const body = {
    name: projectId,
    project: projectId,
    target: "preview",
    gitSource: { type: "github", ref: commitSha, sha: commitSha },
  };
  const data = await vercelFetch(token, "/v13/deployments", { method: "POST", body: JSON.stringify(body) });
  return { url: data.url || `https://${data.id}.vercel.app`, id: data.id };
}

export async function promoteToProduction(
  commitSha: string,
  env: VercelEnv = process.env as VercelEnv,
): Promise<{ url: string; id: string }> {
  const token = env.VERCEL_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    throw new Error("VERCEL_TOKEN and VERCEL_PROJECT_ID are required for promotion");
  }
  const body = {
    name: projectId,
    project: projectId,
    target: "production",
    gitSource: { type: "github", ref: commitSha, sha: commitSha },
  };
  const data = await vercelFetch(token, "/v13/deployments", { method: "POST", body: JSON.stringify(body) });
  return { url: data.url || `https://${data.id}.vercel.app`, id: data.id };
}

export async function routeTrafficToCanary(
  previewUrl: string,
  env: VercelEnv = process.env as VercelEnv,
) {
  const token = env.VERCEL_TOKEN;
  const edgeConfigId = env.VERCEL_EDGE_CONFIG_ID;
  // Both credentials are required — guard explicitly so the error identifies
  // the missing variable rather than producing a silent "401 Unauthorized"
  // from an empty-string Bearer token sent to the Vercel API.
  if (!token) {
    throw new Error("VERCEL_TOKEN is required for canary traffic routing");
  }
  if (!edgeConfigId) {
    throw new Error("VERCEL_EDGE_CONFIG_ID is required for canary traffic routing");
  }
  const value = { url: previewUrl, weight: 5 };
  const body = {
    items: [{ operation: "upsert", key: EDGE_CONFIG_KEY, value }],
  };
  await vercelFetch(token, `/v1/edge-config/${edgeConfigId}/items`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function rollbackCanary(env: VercelEnv = process.env as VercelEnv) {
  const token = env.VERCEL_TOKEN;
  const edgeConfigId = env.VERCEL_EDGE_CONFIG_ID;
  // Guard both credentials — missing token produced a silent 401 instead of
  // a clear error; missing edgeConfigId means there is nothing to roll back.
  if (!token || !edgeConfigId) return;
  const body = {
    items: [{ operation: "delete", key: EDGE_CONFIG_KEY }],
  };
  await vercelFetch(token, `/v1/edge-config/${edgeConfigId}/items`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Pass 68: LaunchDarkly feature-flag-gated canary routing
// ---------------------------------------------------------------------------

export type CanaryRoutingOutcome = "routed" | "skipped-by-flag";

export interface CanaryRoutingResult {
  outcome: CanaryRoutingOutcome;
  /** Present when LD was queried (source = 'launchdarkly'). */
  flagEval?: FlagEvalResult;
  previewUrl: string;
}

/**
 * Route canary traffic after checking a LaunchDarkly feature flag.
 *
 * Behavior matrix:
 *
 * | LD_SDK_KEY set | Flag value | Outcome                              |
 * |---------------|-----------|--------------------------------------|
 * | No            | N/A       | routed (backward-compat default)     |
 * | Yes           | true      | routed                               |
 * | Yes           | false     | skipped-by-flag (no edge routing)    |
 * | Yes           | error/404 | routed (fail-open: LD cannot block)  |
 *
 * When the outcome is `"skipped-by-flag"`, no Vercel Edge Config entry is
 * written and no traffic is shifted — the caller should treat this as a
 * deliberate hold, not an error.
 *
 * @param previewUrl  The Vercel preview URL to route to
 * @param flagKey     LaunchDarkly flag key controlling this canary
 * @param context     Owner/repo/sha for deterministic flag evaluation
 * @param env         Environment variable source
 */
export async function routeTrafficWithFeatureFlag(
  previewUrl: string,
  flagKey: string,
  context: { owner: string; repo: string; sha: string },
  env: VercelEnv = process.env as VercelEnv,
): Promise<CanaryRoutingResult> {
  // If LD is not configured, fall through to unconditional routing
  if (!env.LD_SDK_KEY) {
    logger.debug('LD_SDK_KEY absent; routing canary traffic unconditionally', { flagKey });
    await routeTrafficToCanary(previewUrl, env);
    return { outcome: "routed", previewUrl };
  }

  // Evaluate the flag (fail-open: defaultValue = true means LD outage → proceed)
  const flagEval = await isCanaryEnabled(flagKey, context, env as Record<string, string | undefined>);

  if (!flagEval.value) {
    logger.info('Canary traffic routing SKIPPED — feature flag disabled', {
      flagKey,
      variation: flagEval.variation,
      reason: flagEval.reason,
      source: flagEval.source,
    });
    return { outcome: "skipped-by-flag", flagEval, previewUrl };
  }

  // Flag enabled (or LD returned default=true due to error) — route normally
  logger.info('Canary traffic routing PROCEEDING — feature flag enabled', {
    flagKey,
    source: flagEval.source,
  });
  await routeTrafficToCanary(previewUrl, env);
  return { outcome: "routed", flagEval, previewUrl };
}
