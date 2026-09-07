/**
 * health-check.ts — Pre-flight connectivity checks for Qodo V24.
 *
 * Runs before the pipeline starts to detect misconfigured credentials or
 * unreachable services early, producing actionable errors instead of
 * cryptic mid-run failures.
 *
 * Checks:
 *   1. Upstash Redis — PING round-trip
 *   2. GitHub API — authenticated /user call
 *   3. Groq API — list models (fast, no cost)
 *   4. Upstash Vector (optional) — /info endpoint
 *   5. R2 Storage (optional) — HEAD bucket
 */

import { log } from "./logger.js";
import type { QodoEnv } from "./env-validator.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";

export interface HealthStatus {
  service: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface HealthReport {
  allOk: boolean;
  checks: HealthStatus[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkRedis(env: QodoEnv): Promise<HealthStatus> {
  const start = Date.now();
  const url = (env.UPSTASH_REDIS_REST_URLS || env.UPSTASH_REDIS_REST_URL || '').split(',')[0]?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKENS || env.UPSTASH_REDIS_REST_TOKEN || '').split(',')[0]?.trim();
  if (!url || !token) {
    return { service: "redis", ok: false, error: "UPSTASH_REDIS_REST_URL(S) / TOKEN(S) not configured" };
  }
  try {
    const r = await fetchWithTimeout(
      `${url}/ping`,
      { headers: { Authorization: `Bearer ${token}` } },
      10_000,
    );
    const body = await r.json() as { result?: string };
    if (!r.ok || body.result !== "PONG") {
      return { service: "redis", ok: false, error: `unexpected response: ${JSON.stringify(body)}` };
    }
    return { service: "redis", ok: true, latencyMs: Date.now() - start };
  } catch (e: unknown) {
    return { service: "redis", ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkGitHub(env: QodoEnv): Promise<HealthStatus> {
  const start = Date.now();
  try {
    const r = await fetchWithTimeout(
      "https://api.github.com/user",
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      10_000,
    );
    if (!r.ok) {
      const txt = await r.text();
      return { service: "github", ok: false, error: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
    }
    return { service: "github", ok: true, latencyMs: Date.now() - start };
  } catch (e: unknown) {
    return { service: "github", ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkGroq(env: QodoEnv): Promise<HealthStatus> {
  const key = env.GROQ_API_KEY || (env.GROQ_API_KEYS?.split(",")[0]?.trim());
  if (!key) return { service: "groq", ok: false, error: "no GROQ_API_KEY configured" };
  const start = Date.now();
  try {
    const r = await fetchWithTimeout(
      "https://api.groq.com/openai/v1/models",
      { headers: { Authorization: `Bearer ${key}` } },
      10_000,
    );
    if (!r.ok) {
      const txt = await r.text();
      return { service: "groq", ok: false, error: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
    }
    return { service: "groq", ok: true, latencyMs: Date.now() - start };
  } catch (e: unknown) {
    return { service: "groq", ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkVector(env: QodoEnv): Promise<HealthStatus | null> {
  if (!env.UPSTASH_VECTOR_REST_URL || !env.UPSTASH_VECTOR_REST_TOKEN) return null;
  const start = Date.now();
  try {
    const r = await fetchWithTimeout(
      `${env.UPSTASH_VECTOR_REST_URL}/info`,
      { headers: { Authorization: `Bearer ${env.UPSTASH_VECTOR_REST_TOKEN}` } },
      10_000,
    );
    if (!r.ok) {
      return { service: "upstash-vector", ok: false, error: `HTTP ${r.status}` };
    }
    return { service: "upstash-vector", ok: true, latencyMs: Date.now() - start };
  } catch (e: unknown) {
    return { service: "upstash-vector", ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run all health checks concurrently.
 * Required services (redis, github, groq) cause the function to throw on
 * failure when `throwOnFailure` is true (default).
 */
export async function runHealthChecks(env: QodoEnv, throwOnFailure = true): Promise<HealthReport> {
  const wallStart = Date.now();

  const [redis, github, groq, vector] = await Promise.all([
    checkRedis(env),
    checkGitHub(env),
    checkGroq(env),
    checkVector(env),
  ]);

  const checks: HealthStatus[] = [redis, github, groq];
  if (vector) checks.push(vector);

  for (const c of checks) {
    if (c.ok) {
      log.info(`[health] ${c.service} ✓ (${c.latencyMs ?? "?"}ms)`);
    } else {
      log.error(`[health] ${c.service} ✗ — ${c.error}`);
    }
  }

  const required = [redis, github, groq];
  const allOk = required.every((c) => c.ok);

  const report: HealthReport = {
    allOk,
    checks,
    durationMs: Date.now() - wallStart,
  };

  if (!allOk && throwOnFailure) {
    const failed = required.filter((c) => !c.ok).map((c) => `${c.service}: ${c.error}`).join("; ");
    throw new Error(`[health-check] Pre-flight failed — ${failed}`);
  }

  return report;
}
