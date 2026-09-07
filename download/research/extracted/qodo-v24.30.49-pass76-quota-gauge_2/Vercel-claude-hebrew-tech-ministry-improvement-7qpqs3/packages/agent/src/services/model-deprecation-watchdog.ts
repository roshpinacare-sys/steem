/**
 * model-deprecation-watchdog.ts — Pass 34 (audit recommendation §7)
 *
 * The brutal audit identified that both Groq model names hardcoded in
 * ai-router.ts were silently deprecated on 2026-06-17, causing every Groq
 * call to fail. The fix (Pass 33) swapped the names, but the root cause —
 * no automated check that configured models are still active — remains.
 *
 * This watchdog queries each provider's model-list endpoint at most once per
 * run and emits a structured warning log if any model in the active router
 * config is absent from the provider's live catalogue. It does NOT throw or
 * block the pipeline (models might still work even if absent from the list
 * endpoint), but the warning is designed to be picked up by an alerting rule
 * on `model-deprecation-warning` events before a production failure occurs.
 *
 * Call checkModelDeprecations(env) once at pipeline startup, after health
 * checks pass. The function is fully async, never throws, and has no side
 * effects beyond logging.
 */

import { log } from "./logger.js";
import type { Env } from "./env-validator.js";

// Models the router currently uses — kept in sync with ai-router.ts.
// When ai-router.ts changes a model name, update this list too.
// Pass 35: added Gemini model (GEMINI_FAST_MODEL = "gemini-1.5-flash-8b").
const ROUTER_MODELS: Array<{ provider: string; modelId: string }> = [
  { provider: "groq",     modelId: "openai/gpt-oss-20b"   },
  { provider: "groq",     modelId: "openai/gpt-oss-120b"  },
  { provider: "cerebras", modelId: "llama3.1-8b"          },
  { provider: "cerebras", modelId: "llama-3.3-70b"        },
  { provider: "mistral",  modelId: "mistral-small-latest" },
  { provider: "mistral",  modelId: "mistral-large-latest" },
  { provider: "gemini",   modelId: "gemini-1.5-flash-8b"  },
];

interface ProviderConfig {
  listUrl: string;
  authHeader: (env: Env) => string | null;
  extractIds: (body: unknown) => string[];
}

// Shared extractor for OpenAI-compatible list responses: { data: [{id},...] }
const openAiExtract = (body: unknown): string[] => {
  const b = body as { data?: Array<{ id: string }> };
  return Array.isArray(b?.data) ? b.data.map((m) => m.id) : [];
};

const PROVIDERS: Record<string, ProviderConfig> = {
  groq: {
    listUrl: "https://api.groq.com/openai/v1/models",
    authHeader: (env) => env.GROQ_API_KEY ? `Bearer ${env.GROQ_API_KEY}` : null,
    extractIds: openAiExtract,
  },
  cerebras: {
    listUrl: "https://api.cerebras.ai/v1/models",
    authHeader: (env) => env.CEREBRAS_API_KEY ? `Bearer ${env.CEREBRAS_API_KEY}` : null,
    extractIds: openAiExtract,
  },
  mistral: {
    listUrl: "https://api.mistral.ai/v1/models",
    authHeader: (env) => env.MISTRAL_API_KEY ? `Bearer ${env.MISTRAL_API_KEY}` : null,
    extractIds: openAiExtract,
  },
  // Pass 35: Gemini uses a different list endpoint and response shape.
  // GET /v1beta/models?key=API_KEY  →  { models: [{ name: "models/gemini-…", … }] }
  // We normalise the name field ("models/gemini-1.5-flash-8b" → "gemini-1.5-flash-8b")
  // so it matches what ai-router.ts stores in GEMINI_FAST_MODEL.
  gemini: {
    listUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    // Gemini authenticates with a ?key= query param, not a Bearer header,
    // which this probe doesn't support — the provider is always skipped
    // (GAP-6; pinned by model-deprecation-watchdog-soft E1-E3). The old
    // expression here was `env.GEMINI_API_KEY ? null : null`, dead code
    // masquerading as a decision.
    authHeader: () => null,
    extractIds: (body: unknown): string[] => {
      const b = body as { models?: Array<{ name: string }> };
      return Array.isArray(b?.models)
        ? b.models.map((m) => m.name.replace(/^models\//, ""))
        : [];
    },
  },
};

// Cache fetched model lists for the lifetime of the process to avoid
// redundant network calls on repeated pipeline invocations in the same worker.
const _cache = new Map<string, Set<string>>();

async function fetchModelIds(
  provider: string,
  config: ProviderConfig,
  env: Env,
  timeoutMs = 5_000,
): Promise<Set<string> | null> {
  if (_cache.has(provider)) return _cache.get(provider)!;

  const auth = config.authHeader(env);
  if (!auth) return null; // provider not configured — skip silently

  try {
    const res = await fetch(config.listUrl, {
      headers: { Authorization: auth, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      log.warn("model-watchdog: model-list fetch failed", { provider, status: res.status });
      return null;
    }
    const body: unknown = await res.json();
    const ids = new Set(config.extractIds(body));
    _cache.set(provider, ids);
    return ids;
  } catch (e) {
    log.warn("model-watchdog: model-list fetch error", {
      provider,
      error: (e as Error)?.message ?? String(e),
    });
    return null;
  }
}

/**
 * Checks that all models in ROUTER_MODELS are present in their provider's
 * live model catalogue. Emits a structured `model-deprecation-warning` log
 * for each missing model so alerting rules can surface it before production
 * failures occur.
 *
 * Never throws — degraded or missing provider responses are logged and
 * skipped so the pipeline is not blocked by a watchdog connectivity issue.
 */
export async function checkModelDeprecations(env: Env): Promise<void> {
  const byProvider = new Map<string, string[]>();
  for (const { provider, modelId } of ROUTER_MODELS) {
    if (!byProvider.has(provider)) byProvider.set(provider, []);
    byProvider.get(provider)!.push(modelId);
  }

  const checks = Array.from(byProvider.entries()).map(async ([provider, modelIds]) => {
    const cfg = PROVIDERS[provider];
    if (!cfg) return; // unknown provider — no list endpoint defined

    const available = await fetchModelIds(provider, cfg, env);
    if (!available) return; // fetch failed or provider unconfigured

    for (const modelId of modelIds) {
      if (!available.has(modelId)) {
        log.warn("model-deprecation-warning", {
          provider,
          modelId,
          message:
            `Model "${modelId}" from provider "${provider}" was NOT found in the live ` +
            `model catalogue. It may have been deprecated. Update GROQ_FAST/GROQ_HEAVY ` +
            `in ai-router.ts before the next pipeline run to avoid 404/400 errors.`,
          availableCount: available.size,
        });
      }
    }
  });

  await Promise.allSettled(checks);
}

/** Exported for testing — clears the in-process model-list cache. */
export function _resetWatchdogCache(): void {
  _cache.clear();
}
