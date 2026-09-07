/**
 * env-validator.ts — Zod-powered environment validation for Qodo V24.
 *
 * Validates all environment variables at startup and produces clear,
 * actionable error messages instead of mysterious runtime failures.
 *
 * Key improvements over the legacy env-schema.ts:
 *  - Zod schema with per-field descriptions and default values
 *  - Enum validation for flag variables (QODO_HIVE_SHARE, QODO_PRIVACY_MODE)
 *  - URL format validation for REST endpoints
 *  - Cross-field constraint: PRIVACY_MODE=strict forces HIVE_SHARE=off
 *  - Returns a fully typed env object — no more `process.env` littered in code
 *  - validateAndCoerce() replaces the old validateEnv() from utils/env-schema.ts
 */

import { z } from "zod";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Schema definition
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // ── Required ──────────────────────────────────────────────────────────────
  GITHUB_TOKEN:             z.string().min(10, "GITHUB_TOKEN must be a valid token"),
  GROQ_API_KEY:             z.string().min(10).optional(),
  UPSTASH_REDIS_REST_URL:   z.string().url("UPSTASH_REDIS_REST_URL must be a valid URL"),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(10, "UPSTASH_REDIS_REST_TOKEN too short"),
  REPO:                     z.string().regex(/^[^/]+\/[^/]+$/, "REPO must be owner/repo format"),
  OBJECTIVE:                z.string().min(3, "OBJECTIVE must be at least 3 characters"),

  // ── LLM keys ─────────────────────────────────────────────────────────────
  GROQ_API_KEYS:     z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  HF_API_KEY:        z.string().optional(),
  // A1: Free-tier racing providers
  GEMINI_API_KEY:    z.string().optional(),
  CEREBRAS_API_KEY:  z.string().optional(),
  MISTRAL_API_KEY:   z.string().optional(),
  // A2: Free-tier racing providers
  TOGETHER_API_KEY:  z.string().optional(),
  SAMBANOVA_API_KEY: z.string().optional(),
  // A3: Additional free-tier racing providers
  FIREWORKS_API_KEY: z.string().optional(),
  DEEPINFRA_API_KEY: z.string().optional(),
  NOVITA_API_KEY:    z.string().optional(),
  /** Cloudflare Account ID — for CF Workers AI REST (separate allotment from Tier-1 V8 binding). */
  CF_ACCOUNT_ID:     z.string().optional(),
  /** Cloudflare API token scoped to Workers AI REST endpoint only. */
  CF_AI_API_TOKEN:   z.string().optional(),

  // ── R2 Storage ────────────────────────────────────────────────────────────
  R2_ACCOUNT_ID:       z.string().optional(),
  R2_ACCESS_KEY_ID:    z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET:           z.string().optional(),

  // ── Vercel ────────────────────────────────────────────────────────────────
  VERCEL_PREVIEW_URL:              z.string().url().optional().or(z.literal("")),
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().optional(),
  VERCEL_TOKEN:                    z.string().optional(),
  VERCEL_PROJECT_ID:               z.string().optional(),
  VERCEL_EDGE_CONFIG_ID:           z.string().optional(),
  VERCEL_PRODUCTION_URL:           z.string().url().optional().or(z.literal("")),

  // ── Upstash multi-Redis + Vector ──────────────────────────────────────────
  UPSTASH_REDIS_REST_URLS:       z.string().optional(),
  UPSTASH_REDIS_REST_TOKENS:     z.string().optional(),
  UPSTASH_REDIS_READ_ONLY_TOKEN: z.string().optional(),
  UPSTASH_VECTOR_REST_URL:       z.string().url().optional().or(z.literal("")),
  UPSTASH_VECTOR_REST_TOKEN:     z.string().optional(),
  UPSTASH_EMBEDDING_REST_URL:    z.string().url().optional().or(z.literal("")),

  // ── Kill switch ─────────────────────────────────────────────────────────
  QODO_HALT:        z.string().optional().default("false"),
  QODO_HALT_REASON: z.string().optional(),

  // ── Behavior flags ────────────────────────────────────────────────────────
  QODO_HIVE_SHARE:   z.enum(["off", "public", "org-private"]).optional().default("off"),
  QODO_PRIVACY_MODE: z.enum(["standard", "strict"]).optional().default("standard"),
  QODO_MENTOR_MODE:  z.enum(["true", "false"]).optional().default("false"),
  QODO_SKILL_ID:     z.string().optional(),
  QODO_TEST_COMMAND: z.string().optional().default("npm test"),

  // ── Sovereign local intelligence (no metered vendor API) ──────────────────
  // QODO_LLM_SIM=true routes every LLM call to the deterministic offline
  // simulator (the `--eval` premium mode); OLLAMA_BASE_URL routes to a local
  // Ollama server. Either one satisfies the "require a provider key" check.
  QODO_LLM_SIM:     z.enum(["true", "false"]).optional().default("false"),
  OLLAMA_BASE_URL:  z.string().optional().default(""),
  OLLAMA_MODEL:     z.string().optional().default(""),
  OLLAMA_API_KEY:   z.string().optional().default(""),

  // ── Integrations ──────────────────────────────────────────────────────────
  SLACK_WEBHOOK_URL:        z.string().url().optional().or(z.literal("")),
  SENTRY_AUTH_TOKEN:        z.string().optional(),
  SENTRY_ORG:               z.string().optional(),
  SENTRY_PROJECT:           z.string().optional(),
  QSTASH_TOKEN:             z.string().optional(),
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
  LINEAR_API_KEY:           z.string().optional(),
  JIRA_BASE_URL:            z.string().url().optional().or(z.literal("")),
  JIRA_TOKEN:               z.string().optional(),
  CODECOV_TOKEN:            z.string().optional(),

  // ── CI / Pipeline context ─────────────────────────────────────────────────
  PR_NUMBER: z.string().regex(/^\d*$/).optional().default(""),
  PR_SHA:    z.string().optional().default(""),
  // ADR-005 resume loop: set by the drain job's workflow_dispatch so the
  // resumed run can write its durable ack key (qodo:trigger:ack:<taskId>) at
  // the first checkpoint. Empty for ordinary manual/CI dispatches.
  TRIGGER_TASK_ID: z.string().optional().default(""),
  TRIGGER_SOURCE:  z.string().optional().default(""),
  // ADR-005 drain-loop tuning (Invariant #12 timing contract). staleMs must
  // exceed the worst-case dispatch→first-checkpoint latency (GitHub Actions
  // queue time + boot + loadState) so a legitimately slow-to-start run is
  // never falsely requeued into a duplicate dispatch; acquireLock is the
  // authoritative dedup backstop. Coerced from strings (env is always string).
  // preprocess maps "" (an unset repo var still injected as empty) → undefined
  // so the default applies instead of Number("")===0 failing .positive().
  QODO_TRIGGER_STALE_MS: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().positive(),
  ).optional().default(30 * 60 * 1000),
  QODO_TRIGGER_MAX_ATTEMPTS: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().positive(),
  ).optional().default(3),
  QODO_TRIGGER_MAX_BATCH: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().positive(),
  ).optional().default(25),
  // When "true", the drain reconciles the processing list (complete acked /
  // requeue stale / dead-letter poison) without dispatching new work — useful
  // for a lightweight janitor tick or manual recovery.
  QODO_TRIGGER_REAP_ONLY:   z.string().optional().default(""),

  // ── Edge + Runtime ────────────────────────────────────────────────────────
  EDGE_FRAGMENT_WORKER_URL: z.string().url().optional().or(z.literal("")),
  NODE_ENV:                 z.enum(["development", "production", "test"]).optional().default("production"),
  QODO_DISPATCH_SECRET:     z.string().optional(),
  QODO_BASE_URL:            z.string().url().optional().or(z.literal("")),
  // B1: GitHub webhook receiver
  GITHUB_WEBHOOK_SECRET:    z.string().optional(),
  QODO_DISPATCH_URL:        z.string().url().optional().or(z.literal("")),

  // T1/T2: Support ticket bridge (Zendesk / Intercom)
  ZENDESK_SUBDOMAIN: z.string().optional(),
  ZENDESK_TOKEN:     z.string().optional(),
  ZENDESK_EMAIL:     z.string().email().optional().or(z.literal("")),
  INTERCOM_ACCESS_TOKEN: z.string().optional(),

  // ── Observability ─────────────────────────────────────────────────────────
  AXIOM_TOKEN:   z.string().optional(),
  AXIOM_DATASET: z.string().optional(),

  // ── Cost alerting ─────────────────────────────────────────────────────────
  // Threshold in USD cents (integer). When the run cost exceeds this value,
  // PrReporter renders a 🚨 Cost Alert banner on the PR comment.
  // Default: 0 (no alert). Example: 50 = $0.50.
  QODO_COST_ALERT_USD_CENTS: z.coerce.number().int().nonnegative().optional().default(0),

  // ── Security API second-sources (Pass 67 / task-36) ──────────────────────
  // All three are opt-in: absent = feature silently disabled.
  /** Snyk free-tier API token. Enables Snyk as a 3rd CVE source in cve-scanner.ts. */
  SNYK_TOKEN:     z.string().optional(),
  /** Socket.dev API key. Enables supply-chain risk scoring in sbom-generator.ts
   *  and license-checker.ts. Basic-auth username; password is always empty. */
  SOCKET_API_KEY: z.string().optional(),
  /** VirusTotal v3 public API key. Enables file-hash reputation in dry-run.ts. */
  VT_API_KEY:     z.string().optional(),
  /** LaunchDarkly server-side SDK key. Enables feature-flag-gated canary rollout (Pass 68). */
  LD_SDK_KEY:     z.string().optional(),
});

export type QodoEnv = z.infer<typeof envSchema>;
export type Env = QodoEnv;

// ---------------------------------------------------------------------------
// Validation + coercion
// ---------------------------------------------------------------------------

let _validated: QodoEnv | null = null;

/**
 * Parse, validate and coerce the current `process.env`.
 * Throws on first parse with a human-readable issue list.
 * Result is cached after the first successful call — safe to call many times.
 */
export function validateAndCoerce(): QodoEnv {
  if (_validated) return _validated;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    const msg = `[env-validator] Environment validation failed:\n${issues}`;
    log.error(msg);
    throw new Error(msg);
  }

  const env = result.data;

  // Cross-field: strict privacy forces hive sharing off
  if (env.QODO_PRIVACY_MODE === "strict" && env.QODO_HIVE_SHARE !== "off") {
    log.warn("[env-validator] QODO_PRIVACY_MODE=strict overrides QODO_HIVE_SHARE → off");
    env.QODO_HIVE_SHARE = "off";
  }

  // Require at least one LLM key. This is fatal: proceeding without a key
  // wastes compute and produces a far worse failure deep inside the pipeline.
  // Exempt the sovereign local paths — the simulator and a local Ollama server
  // ARE the provider, so no external key is needed (or wanted) in that mode.
  const sovereignLocal = env.QODO_LLM_SIM === "true" || !!env.OLLAMA_BASE_URL;
  if (!sovereignLocal &&
      !env.GROQ_API_KEY && !env.GROQ_API_KEYS && !env.OPENROUTER_API_KEY &&
      !env.GEMINI_API_KEY && !env.CEREBRAS_API_KEY && !env.MISTRAL_API_KEY &&
      !env.TOGETHER_API_KEY && !env.SAMBANOVA_API_KEY && !env.HF_API_KEY &&
      !env.FIREWORKS_API_KEY && !env.DEEPINFRA_API_KEY && !env.NOVITA_API_KEY &&
      !(env.CF_ACCOUNT_ID && env.CF_AI_API_TOKEN)) {
    const msg = "[env-validator] No LLM API key found (GROQ_API_KEY, GROQ_API_KEYS, OPENROUTER_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY, TOGETHER_API_KEY, SAMBANOVA_API_KEY, HF_API_KEY, FIREWORKS_API_KEY, DEEPINFRA_API_KEY, NOVITA_API_KEY, CF_ACCOUNT_ID+CF_AI_API_TOKEN). Set at least one provider key.";
    log.error(msg);
    throw new Error(msg);
  }

  _validated = env;
  log.info("[env-validator] Environment validated", { privacyMode: env.QODO_PRIVACY_MODE, hiveShare: env.QODO_HIVE_SHARE });
  return env;
}

/** Reset the cache — only for tests. */
export function _resetEnvCache(): void {
  _validated = null;
}
