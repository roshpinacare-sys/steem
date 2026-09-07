import Groq from "groq-sdk";
import type { Telemetry } from "./telemetry.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { CostTracker } from "./cost-tracker.js";
import { log } from "./logger.js";
import { withRetry, isHttpRetryable } from "./retry.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import { RedisState, type RedisEnv } from "./redis-state.js";
import {
  hasHeadroom,
  loadQuotaSnapshot,
  recordQuotaFromHeaders,
  markProviderExhausted,
  type QuotaProvider,
} from "./quota-guardian.js";
import {
  isSimEnabled,
  simulateResponse,
  ollamaBaseUrl,
  ollamaModel,
} from "./local/sovereign-llm.js";

// Shared cost tracker for the lifetime of the process (reset per-run by cli.ts)
export const costTracker = new CostTracker();

// Per-provider circuit breakers
const groqBreaker       = new CircuitBreaker({ name: "groq",        failureThreshold: 3, resetTimeoutMs: 60_000 });
const openrouterBreaker = new CircuitBreaker({ name: "openrouter",  failureThreshold: 3, resetTimeoutMs: 60_000 });
// Free-tier OpenRouter racing lane — separate breaker from the paid tier-3
// fallback so a delisted/rate-limited :free model never takes down the
// gpt-4o-mini escape hatch (and vice versa).
const openrouterFreeBreaker = new CircuitBreaker({ name: "openrouter-free", failureThreshold: 3, resetTimeoutMs: 60_000 });
const geminiBreaker     = new CircuitBreaker({ name: "gemini",      failureThreshold: 3, resetTimeoutMs: 60_000 });
const cerebrasBreaker   = new CircuitBreaker({ name: "cerebras",    failureThreshold: 3, resetTimeoutMs: 60_000 });
const mistralBreaker    = new CircuitBreaker({ name: "mistral",     failureThreshold: 3, resetTimeoutMs: 60_000 });
// A2: Additional free-tier racing providers
const togetherBreaker    = new CircuitBreaker({ name: "together",    failureThreshold: 3, resetTimeoutMs: 60_000 });
const sambanovaBreaker   = new CircuitBreaker({ name: "sambanova",   failureThreshold: 3, resetTimeoutMs: 60_000 });
const huggingfaceBreaker = new CircuitBreaker({ name: "huggingface", failureThreshold: 3, resetTimeoutMs: 60_000 });
// A3: Additional free-tier racing providers
const fireworksBreaker    = new CircuitBreaker({ name: "fireworks",       failureThreshold: 3, resetTimeoutMs: 60_000 });
const deepinfraBreaker    = new CircuitBreaker({ name: "deepinfra",       failureThreshold: 3, resetTimeoutMs: 60_000 });
const novitaBreaker       = new CircuitBreaker({ name: "novita",          failureThreshold: 3, resetTimeoutMs: 60_000 });
const cfRestBreaker       = new CircuitBreaker({ name: "cf-workers-ai-rest", failureThreshold: 3, resetTimeoutMs: 86_400_000 });

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type Tier = "fast" | "heavy";

export interface RouterEnv {
  GROQ_API_KEYS?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  // A1: Additional free-tier racing providers
  GEMINI_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  // A2: Additional free-tier racing providers
  TOGETHER_API_KEY?: string;
  SAMBANOVA_API_KEY?: string;
  HF_API_KEY?: string;
  // A3: Additional free-tier racing providers
  FIREWORKS_API_KEY?: string;
  DEEPINFRA_API_KEY?: string;
  NOVITA_API_KEY?: string;
  /** Cloudflare Account ID — required for CF Workers AI REST (separate from Tier-1 binding). */
  CF_ACCOUNT_ID?: string;
  /** Cloudflare API token scoped to Workers AI REST. */
  CF_AI_API_TOKEN?: string;
  // Sovereign local paths (no metered vendor API). See services/local/sovereign-llm.ts.
  /** "true" → deterministic offline simulator answers every call (--eval). */
  QODO_LLM_SIM?: string;
  /** Local Ollama base URL, e.g. http://localhost:11434 (OpenAI-compatible). */
  OLLAMA_BASE_URL?: string;
  /** Ollama model id (default: llama3.1). */
  OLLAMA_MODEL?: string;
  /** Ollama ignores auth, but the OpenAI-compat client always sends a Bearer. */
  OLLAMA_API_KEY?: string;
}

/** Ambient type for the Cloudflare Workers AI binding (env.AI). */
interface CloudflareAI {
  run(model: string, inputs: Record<string, unknown>): Promise<{ response?: string; [k: string]: unknown }>;
}

/** Ambient Cloudflare Worker env injected at runtime (undefined in Node.js). */
declare const _cfEnv: { AI?: CloudflareAI } | undefined;

// Groq deprecated llama-3.1-8b-instant and llama-3.3-70b-versatile on
// 2026-06-17. openai/gpt-oss-20b / openai/gpt-oss-120b are Groq's current
// recommended fast/heavy replacements (console.groq.com/docs/deprecations).
const GROQ_FAST  = "openai/gpt-oss-20b";
const GROQ_HEAVY = "openai/gpt-oss-120b";

// A1: Free-tier racing provider models
const GEMINI_FAST_MODEL   = "gemini-1.5-flash-8b";
const CEREBRAS_FAST_MODEL = "llama3.1-8b";
const MISTRAL_FAST_MODEL  = "mistral-small-latest";

// A2: Free-tier racing provider models
const TOGETHER_FAST_MODEL    = "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free";
const SAMBANOVA_FAST_MODEL   = "Meta-Llama-3.1-8B-Instruct";
const HF_ROUTER_FAST_MODEL   = "meta-llama/Llama-3.1-8B-Instruct:together";

// A3: Additional free-tier racing provider models
// Fireworks AI: free-tier serverless model (no-credit-card trial allotment)
const FIREWORKS_FAST_MODEL   = "accounts/fireworks/models/llama-v3p1-8b-instruct";
// DeepInfra: cheapest/free-trial OpenAI-compatible endpoint
const DEEPINFRA_FAST_MODEL   = "meta-llama/Meta-Llama-3.1-8B-Instruct";
// Novita AI: free-trial credits, OpenAI-compatible
const NOVITA_FAST_MODEL      = "meta-llama/llama-3.1-8b-instruct";
// CF Workers AI REST: plain HTTPS API — separate free daily allotment from Tier-1 V8 binding
const CF_REST_FAST_MODEL     = "@cf/meta/llama-3.1-8b-instruct";

/** CF Workers AI model used for Tier-1 AST summaries. */
const CF_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/** Patterns that indicate a file is cheap to triage (Tier-0 / Tier-1). */
const FAST_PATTERNS = [/readme/i, /package\.json$/i, /\.md$/i, /\.txt$/i, /\.yml$/i, /\.yaml$/i, /\.json$/i];

// ---------------------------------------------------------------------------
// Tier-0: Local WASM classifier (onnxruntime-web)
// ---------------------------------------------------------------------------

/**
 * Tier-0 deterministic classifier. The original ONNX model was never shipped
 * and could not load in any ESM/Worker environment (`__dirname` is undefined
 * and the .onnx asset is absent). The model's entire feature vector is just two
 * scalars (`isDoc`, `lenNorm`), so a simple threshold rule gives the same
 * signal with zero dependencies and zero infra to break.
 */
function tier0Classify(path: string, prompt: string): Tier | null {
  const isDoc = FAST_PATTERNS.some((r) => r.test(path));
  const lenNorm = Math.min(prompt.length / 8192, 1.0);
  if (isDoc || lenNorm < 0.5) return "fast";
  return "heavy";
}

// ---------------------------------------------------------------------------
// Tier-1: Cloudflare Workers AI binding
// ---------------------------------------------------------------------------

/**
 * Run an AST summary via the Cloudflare Workers AI binding (env.AI.run).
 * Returns null when the binding is absent (Node.js / local dev).
 */
async function tier1CfWorkersAI(prompt: string): Promise<string | null> {
  try {
    // Access the CF env injected by the Workers runtime.
    // Cast through unknown to avoid TS7017 on globalThis index in strict mode.
    const g = globalThis as unknown as { _cfEnv?: { AI?: CloudflareAI } };
    const cfEnv: { AI?: CloudflareAI } | undefined = g._cfEnv;

    if (!cfEnv?.AI) return null;

    const result = await cfEnv.AI.run(CF_AI_MODEL, {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });

    return typeof result.response === "string" ? result.response : null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn(`CF Workers AI failed`, { model: CF_AI_MODEL, error: msg });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tier-2: Groq (heavy codegen)
// ---------------------------------------------------------------------------

function parseKeyList(env?: string): string[] {
  if (!env) return [];
  return env.split(",").map((k) => k.trim()).filter(Boolean);
}

const groqIndex = { value: 0 };

function roundRobinPick<T>(items: T[], index: { value: number }): T {
  const item = items[index.value % items.length];
  index.value++;
  return item;
}

async function groqChat(
  model: string,
  prompt: string,
  apiKey: string,
): Promise<{ content: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }> {
  const client = new Groq({ apiKey });
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });
  return {
    content: res.choices[0]?.message?.content ?? "{}",
    usage: res.usage ?? undefined,
  };
}

async function chatWithGroqRotation(
  model: string,
  prompt: string,
  keys: string[],
  index: { value: number },
): Promise<{ content: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }> {
  const startKey = index.value;
  let lastErr: unknown;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = roundRobinPick(keys, index);
    try {
      return await withRetry(() => groqChat(model, prompt, key), {
        maxAttempts: 4,
        baseDelayMs: 500,
        isRetryable: isHttpRetryable,
        name: "groq-chat",
      });
    } catch (e: unknown) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      if (status === 429) {
        log.warn(`Groq key rate-limited; rotating`, { attempt });
        continue;
      }
      throw e;
    }
  }
  index.value = startKey;
  throw lastErr;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider table
//
// Ten of the eleven HTTP chat providers speak the same OpenAI-style
// /chat/completions dialect and differed only in URL, model id, timeout,
// extra headers, error label and (for CF Workers AI REST) response shape.
// They were previously ten near-identical copy-paste functions (~400 lines);
// each is now a one-line wrapper over chatOpenAiCompat() with its variance
// captured in a spec. Gemini keeps a custom function (different request and
// response shape entirely).
// ---------------------------------------------------------------------------

interface OpenAiCompatSpec {
  /** Provider label used in thrown errors: "<label> HTTP <status>". */
  errorLabel: string;
  /** withRetry operation name, e.g. "cerebras-chat". */
  retryName: string;
  url: string;
  /** Model id sent in the body; omit when the model is encoded in the URL. */
  model?: string;
  /** Request timeout. Default: 30 s. */
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  /** Send response_format: json_object. Default: true. */
  responseFormat?: boolean;
  /** Extract content from the parsed body. Default: OpenAI choices shape. */
  parseContent?: (body: unknown) => string;
}

interface ChatResult {
  content: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  headers?: Headers;
}

function parseOpenAiContent(b: unknown): string {
  const body = b as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "{}";
}

async function chatOpenAiCompat(
  spec: OpenAiCompatSpec,
  prompt: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const res = await withRetry(async () => {
    const payload: Record<string, unknown> = {};
    if (spec.model !== undefined) payload.model = spec.model;
    payload.messages = [{ role: "user", content: prompt }];
    if (spec.responseFormat !== false) payload.response_format = { type: "json_object" };
    payload.temperature = 0.2;

    const r = await fetchWithTimeout(
      spec.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(spec.extraHeaders ?? {}),
        },
        body: JSON.stringify(payload),
        signal,
      },
      spec.timeoutMs ?? 30_000,
    );
    if (!r.ok) {
      const err = new Error(`${spec.errorLabel} HTTP ${r.status}`) as Error & { status: number };
      err.status = r.status;
      throw err;
    }
    return { body: (await r.json()) as unknown, headers: r.headers };
  }, { maxAttempts: 4, baseDelayMs: 500, isRetryable: isHttpRetryable, name: spec.retryName });

  const parse = spec.parseContent ?? parseOpenAiContent;
  const usage = (res.body as { usage?: ChatResult["usage"] }).usage ?? undefined;
  return { content: parse(res.body), usage, headers: res.headers };
}

// ── Tier 3: OpenRouter fallback ─────────────────────────────────────────────

const OPENROUTER_SPEC: OpenAiCompatSpec = {
  errorLabel: "OpenRouter",
  retryName: "openrouter-chat",
  url: "https://openrouter.ai/api/v1/chat/completions",
  model: "openai/gpt-4o-mini",
  timeoutMs: 90_000,
  extraHeaders: {
    "HTTP-Referer": "https://github.com/qodo-v24",
    "X-Title": "Qodo V24 Agent",
  },
};

async function chatOpenRouter(prompt: string, apiKey: string): Promise<ChatResult> {
  return chatOpenAiCompat(OPENROUTER_SPEC, prompt, apiKey);
}

// OpenRouter also serves $0 ":free" model variants under the SAME API key.
// That makes a single OPENROUTER_API_KEY contribute a free racing lane in
// addition to its paid tier-3 fallback role. Free variants rotate over time;
// a 404 on a delisted model just opens the breaker and the race continues
// on the other providers.
const OPENROUTER_FREE_SPEC: OpenAiCompatSpec = {
  errorLabel: "OpenRouter-free",
  retryName: "openrouter-free-chat",
  url: "https://openrouter.ai/api/v1/chat/completions",
  model: "meta-llama/llama-3.3-70b-instruct:free",
  extraHeaders: {
    "HTTP-Referer": "https://github.com/qodo-v24",
    "X-Title": "Qodo V24 Agent",
  },
};

async function chatOpenRouterFree(prompt: string, apiKey: string, signal?: AbortSignal): Promise<ChatResult> {
  return chatOpenAiCompat(OPENROUTER_FREE_SPEC, prompt, apiKey, signal);
}

// ── A1: Free-tier racing providers — Gemini, Cerebras, Mistral ──────────────

/** POST to Gemini generateContent REST endpoint (free tier). */
async function chatGemini(
  prompt: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ content: string; headers?: Headers }> {
  const res = await withRetry(async () => {
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FAST_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
        signal,
      },
      30_000,
    );
    if (!r.ok) {
      const err = new Error(`Gemini HTTP ${r.status}`) as Error & { status: number };
      err.status = r.status;
      throw err;
    }
    return {
      body: await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] },
      headers: r.headers,
    };
  }, { maxAttempts: 4, baseDelayMs: 500, isRetryable: isHttpRetryable, name: "gemini-chat" });
  const text = res.body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return { content: text, headers: res.headers };
}

const CEREBRAS_SPEC: OpenAiCompatSpec = {
  errorLabel: "Cerebras",
  retryName: "cerebras-chat",
  url: "https://api.cerebras.ai/v1/chat/completions",
  model: CEREBRAS_FAST_MODEL,
};

/** POST to Cerebras chat completions (free tier, OpenAI-compatible). */
async function chatCerebras(prompt: string, apiKey: string, signal?: AbortSignal): Promise<ChatResult> {
  return chatOpenAiCompat(CEREBRAS_SPEC, prompt, apiKey, signal);
}

const MISTRAL_SPEC: OpenAiCompatSpec = {
  errorLabel: "Mistral",
  retryName: "mistral-chat",
  url: "https://api.mistral.ai/v1/chat/completions",
  model: MISTRAL_FAST_MODEL,
};

/** POST to Mistral chat completions (free tier). */
async function chatMistral(prompt: string, apiKey: string, signal?: AbortSignal): Promise<ChatResult> {
  return chatOpenAiCompat(MISTRAL_SPEC, prompt, apiKey, signal);
}

const TOGETHER_SPEC: OpenAiCompatSpec = {
  errorLabel: "Together",
  retryName: "together-chat",
  url: "https://api.together.xyz/v1/chat/completions",
  model: TOGETHER_FAST_MODEL,
};

/** POST to Together.ai chat completions (free-tier "Turbo Free" models, OpenAI-compatible). */
async function chatTogether(prompt: string, apiKey: string, signal?: AbortSignal): Promise<ChatResult> {
  return chatOpenAiCompat(TOGETHER_SPEC, prompt, apiKey, signal);
}

const SAMBANOVA_SPEC: OpenAiCompatSpec = {
  errorLabel: "SambaNova",
  retryName: "sambanova-chat",
  url: "https://api.sambanova.ai/v1/chat/completions",
  model: SAMBANOVA_FAST_MODEL,
};

/** POST to SambaNova Cloud chat completions (free tier, OpenAI-compatible). */
async function chatSambanova(prompt: string, apiKey: string, signal?: AbortSignal): Promise<ChatResult> {
  return chatOpenAiCompat(SAMBANOVA_SPEC, prompt, apiKey, signal);
}

// ── A3: Additional free-tier racing providers ───────────────────────────────

const FIREWORKS_SPEC: OpenAiCompatSpec = {
  errorLabel: "Fireworks",
  retryName: "fireworks-chat",
  url: "https://api.fireworks.ai/inference/v1/chat/completions",
  model: FIREWORKS_FAST_MODEL,
};

/** POST to Fireworks AI chat completions (free-tier serverless, OpenAI-compatible). */
async function chatFireworks(prompt: string, apiKey: string, signal?: AbortSignal): Promise<ChatResult> {
  return chatOpenAiCompat(FIREWORKS_SPEC, prompt, apiKey, signal);
}

const DEEPINFRA_SPEC: OpenAiCompatSpec = {
  errorLabel: "DeepInfra",
  retryName: "deepinfra-chat",
  url: "https://api.deepinfra.com/v1/openai/chat/completions",
  model: DEEPINFRA_FAST_MODEL,
};

/** POST to DeepInfra chat completions (free-trial credits, OpenAI-compatible). */
async function chatDeepInfra(prompt: string, apiKey: string, signal?: AbortSignal): Promise<ChatResult> {
  return chatOpenAiCompat(DEEPINFRA_SPEC, prompt, apiKey, signal);
}

const NOVITA_SPEC: OpenAiCompatSpec = {
  errorLabel: "Novita",
  retryName: "novita-chat",
  url: "https://api.novita.ai/v3/openai/chat/completions",
  model: NOVITA_FAST_MODEL,
};

/** POST to Novita AI chat completions (free-trial credits, OpenAI-compatible). */
async function chatNovita(prompt: string, apiKey: string, signal?: AbortSignal): Promise<ChatResult> {
  return chatOpenAiCompat(NOVITA_SPEC, prompt, apiKey, signal);
}

/**
 * POST to Cloudflare Workers AI via the plain REST API.
 *
 * This is DISTINCT from the Tier-1 V8 binding (env.AI.run). The REST API
 * uses a separate daily free allotment (10,000 neurons/day on the free plan)
 * and is reachable from any Node.js environment with CF_ACCOUNT_ID +
 * CF_AI_API_TOKEN. When both the Tier-1 binding AND this REST path are
 * configured, each draws from its own quota independently.
 *
 * Endpoint: POST /client/v4/accounts/{accountId}/ai/run/{model}
 * Auth: Bearer token (CF_AI_API_TOKEN) — NOT the same as CLOUDFLARE_API_TOKEN
 * used for Workers deployment.
 */
async function chatCfRestAi(
  prompt: string,
  accountId: string,
  apiToken: string,
  signal?: AbortSignal,
): Promise<ChatResult> {
  return chatOpenAiCompat(
    {
      errorLabel: "CF Workers AI REST",
      retryName: "cf-rest-chat",
      url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_REST_FAST_MODEL}`,
      responseFormat: false,
      // CF AI REST wraps the result: { success: true, result: { response: "..." } }
      parseContent: (b) => (b as { result?: { response?: string } }).result?.response ?? "{}",
    },
    prompt,
    apiToken,
    signal,
  );
}

const HUGGINGFACE_SPEC: OpenAiCompatSpec = {
  errorLabel: "HuggingFace",
  retryName: "huggingface-chat",
  url: "https://router.huggingface.co/v1/chat/completions",
  model: HF_ROUTER_FAST_MODEL,
};

/** POST to the Hugging Face Inference Router (free tier, OpenAI-compatible /v1/chat/completions). */
async function chatHuggingFace(prompt: string, apiKey: string, signal?: AbortSignal): Promise<ChatResult> {
  return chatOpenAiCompat(HUGGINGFACE_SPEC, prompt, apiKey, signal);
}

// ---------------------------------------------------------------------------
// A1: Parallel provider race — fires 2-3 free-tier providers simultaneously,
// returns the first valid JSON response, cancels the rest.
// ---------------------------------------------------------------------------

interface RaceCandidate {
  name: string;
  /** Receives the shared race AbortSignal so losing requests are cancelled. */
  fn: (signal: AbortSignal) => Promise<{ content: string }>;
}

/**
 * Race multiple LLM providers in parallel; return the first valid JSON
 * response.  "Valid" means the response body parses as JSON without error.
 *
 * A shared AbortController is created for the race.  The moment one provider
 * wins, controller.abort() is called so every other in-flight request is
 * cancelled at the network layer via the AbortSignal threaded through
 * fetchWithTimeout.  This eliminates the API-quota and connection drain
 * that previously occurred because losing requests ran to completion even
 * after the race was decided.
 */
async function raceProviders(
  candidates: RaceCandidate[],
  telemetry?: Telemetry,
): Promise<string> {
  const controller = new AbortController();

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let errors  = 0;

    for (const { name, fn } of candidates) {
      fn(controller.signal).then((res) => {
        if (settled) return;
        // Validate: must parse as JSON
        try {
          JSON.parse(res.content);
        } catch {
          errors++;
          if (errors === candidates.length) {
            reject(new Error("[ai-router] all racing providers returned invalid JSON"));
          }
          return;
        }
        settled = true;
        // Cancel every other in-flight request before resolving.
        controller.abort();
        telemetry?.decision("ai-router", "race-winner", { winner: name }).catch(() => {});
        log.info(`ai-router: race winner`, { provider: name });
        resolve(res.content);
      }).catch((e: unknown) => {
        // Ignore AbortError — it is the expected outcome for losing requests.
        if (e instanceof Error && e.name === "AbortError") return;
        errors++;
        if (errors === candidates.length && !settled) {
          reject(new Error("[ai-router] all racing providers failed"));
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// H4: Draft-then-verify — cheap model first, escalate on schema rejection
// ---------------------------------------------------------------------------

/**
 * Attempt `fastFn` first; if the result fails `validate`, escalate to `heavyFn`.
 * This keeps the majority of requests on the cheap tier while guaranteeing
 * schema-valid output when the fast tier produces garbage.
 */
async function draftThenVerify(
  fastFn: () => Promise<string>,
  heavyFn: () => Promise<string>,
  validate: (content: string) => boolean,
  telemetry?: Telemetry,
  path?: string,
): Promise<string> {
  let draft: string;
  try {
    draft = await fastFn();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("ai-router: draft (fast) failed; escalating to heavy", { path, error: msg });
    await telemetry?.decision("ai-router", "draft-escalate-fast-error", { path, error: msg });
    return heavyFn();
  }

  if (validate(draft)) {
    await telemetry?.decision("ai-router", "draft-accepted", { path });
    return draft;
  }

  log.info("ai-router: draft failed validation; escalating to heavy tier", { path });
  await telemetry?.decision("ai-router", "draft-escalate-validation-fail", { path });
  return heavyFn();
}

/** Lightweight JSON validity check used by draft-then-verify. */
function isValidJson(content: string): boolean {
  try { JSON.parse(content); return true; } catch { return false; }
}

/**
 * Stream a Groq completion token-by-token.
 * Yields string chunks as they arrive; the caller accumulates them.
 * Falls back to the non-streaming path when Groq keys are unavailable.
 */
export async function* streamChat(
  path: string,
  tier: Tier,
  prompt: string,
  opts: RouterOptions = {},
): AsyncGenerator<string> {
  const { telemetry, env = process.env as RouterEnv } = opts;
  const groqKeys = parseKeyList(env.GROQ_API_KEYS ?? env.GROQ_API_KEY);

  if (groqKeys.length === 0 || groqBreaker.currentState === "OPEN") {
    // Fall back to non-streaming
    const full = await aiRoute(path, tier, prompt, opts);
    yield full;
    return;
  }

  const apiKey = roundRobinPick(groqKeys, groqIndex);
  const model  = tier === "heavy" ? GROQ_HEAVY : GROQ_FAST;
  const client = new Groq({ apiKey });

  await telemetry?.decision("ai-router", "stream-start", { path, tier, model });

  const stream = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    stream: true,
  });

  let totalTokens = 0;
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      totalTokens += delta.length; // rough char count as proxy until usage arrives
      yield delta;
    }
  }

  await telemetry?.decision("ai-router", "stream-complete", { path, tier, model, approxChars: totalTokens });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a file path into fast / heavy without any network call.
 * Exported so callers (agents) can pre-screen paths before calling aiRoute.
 */
export function classifyFile(path: string): Tier {
  return FAST_PATTERNS.some((r) => r.test(path)) ? "fast" : "heavy";
}

interface RouterOptions {
  telemetry?: Telemetry;
  env?: RouterEnv;
  /** Optional Redis-backed state for quota tracking. If omitted, the router
   *  creates one from env and still fails open when Redis is unconfigured. */
  state?: RedisState;
}

/**
 * 3-Tier serverless edge router optimised for cost and latency:
 *
 *   Tier 0 — Local WASM classifier (onnxruntime-web)
 *            Zero-cost AST triage; returns classification hint, not LLM text.
 *            Falls back silently when WASM is unavailable.
 *
 *   Tier 1 — Cloudflare Workers AI binding (env.AI.run)
 *            Edge-native inference for fast AST summaries; no external API key.
 *            Falls back when running outside a CF Worker context.
 *
 *   Tier 2 — Groq (heavy codegen)
 *            High-throughput LLM for complex code generation tasks.
 *            Uses key rotation + exponential back-off.
 */
export async function aiRoute(
  path: string,
  tier: Tier,
  prompt: string,
  opts: RouterOptions = {},
): Promise<string> {
  const { telemetry, env = process.env as RouterEnv } = opts;
  const state = opts.state ?? new RedisState(process.env as RedisEnv);
  const start = Date.now();

  await telemetry?.decision("ai-router", "tiering_decision", { file: path, tier });

  // ── Sovereign local paths (no metered vendor API) ──────────────────────
  // Checked before every tier so the agent can run at full capability with
  // zero external dependencies. Off by default; enabled explicitly by the
  // owner (--eval sets QODO_LLM_SIM; OLLAMA_BASE_URL opts into local Ollama).
  if (isSimEnabled(env)) {
    const sim = simulateResponse(path, prompt);
    costTracker.record("sovereign-sim", sim.model, tier, sim.usage);
    await telemetry?.tokenUsage("sovereign-sim", sim.model, tier, sim.usage);
    await telemetry?.decision("ai-router", "sovereign-sim-response", {
      file: path,
      tier,
      durationMs: Date.now() - start,
    });
    return sim.content;
  }
  const ollamaUrl = ollamaBaseUrl(env);
  if (ollamaUrl) {
    const model = ollamaModel(env);
    const res = await chatOpenAiCompat(
      {
        errorLabel: "Ollama",
        retryName: "ollama-chat",
        url: `${ollamaUrl}/v1/chat/completions`,
        model,
        timeoutMs: 120_000,
      },
      prompt,
      // Ollama ignores the API key but chatOpenAiCompat always sends a Bearer.
      env.OLLAMA_API_KEY ?? "ollama",
    );
    // Local inference is free; record under the zero-cost sovereign tag.
    costTracker.record("ollama", "ollama-local", tier, res.usage ?? {});
    await telemetry?.decision("ai-router", "sovereign-ollama-response", {
      file: path,
      model,
      tier,
      durationMs: Date.now() - start,
    });
    return res.content;
  }

  // ── Tier 0 & 1: only attempted for "fast" tasks ────────────────────────
  // Heavy tasks (Architect, Reviewer) skip straight to Tier 2 (Groq) to
  // avoid wasting edge inference capacity on complex codegen workloads.
  if (tier === "fast") {
    // ── Tier 0: local WASM classifier ──────────────────────────────────
    const wasmTier = await tier0Classify(path, prompt);
    if (wasmTier !== null) {
      // WASM classification succeeded — log the hint and continue to an LLM
      // tier (classifier only produces a tier label, not the final response).
      await telemetry?.decision("ai-router", "tier0-wasm-classified", { file: path, wasmTier });
      // Override the caller-supplied tier with the WASM verdict.
      tier = wasmTier;
    }

    // ── Tier 1: Cloudflare Workers AI binding ──────────────────────────
    const cfResult = await tier1CfWorkersAI(prompt);
    if (cfResult !== null) {
      await telemetry?.decision("ai-router", "tier1-cf-workers-ai-success", {
        model: CF_AI_MODEL,
        tier,
        durationMs: Date.now() - start,
      });
      return cfResult;
    }
  } else {
    await telemetry?.decision("ai-router", "tier0-tier1-skipped", { file: path, tier, reason: "heavy-task" });
  }

  // ── Tier 2: H4 Draft-then-Verify + A1 Provider Racing ─────────────────
  // For FAST tasks: race Groq-fast vs Gemini vs Cerebras vs Mistral in
  // parallel and take the first valid JSON response (H4: draft tier).
  // For HEAVY tasks: use Groq-heavy only, skip racing (too expensive).
  const groqKeys     = parseKeyList(env.GROQ_API_KEYS ?? env.GROQ_API_KEY);
  const geminiKey    = env.GEMINI_API_KEY;
  const cerebrasKey  = env.CEREBRAS_API_KEY;
  const mistralKey   = env.MISTRAL_API_KEY;
  const openrouterKey = env.OPENROUTER_API_KEY;
  const togetherKey    = env.TOGETHER_API_KEY;
  const sambanovaKey   = env.SAMBANOVA_API_KEY;
  const huggingfaceKey = env.HF_API_KEY;
  // A3
  const fireworksKey   = env.FIREWORKS_API_KEY;
  const deepinfraKey   = env.DEEPINFRA_API_KEY;
  const novitaKey      = env.NOVITA_API_KEY;
  const cfAccountId    = env.CF_ACCOUNT_ID;
  const cfAiApiToken   = env.CF_AI_API_TOKEN;

  // Build the "fast draft" function — races all available fast providers
  const buildFastDraft = async (): Promise<() => Promise<string>> => {
    const raceCandidates: RaceCandidate[] = [];

    const addCandidate = async (
      name: string,
      provider: QuotaProvider,
      fn: (signal?: AbortSignal) => Promise<{ content: string; headers?: Headers }>,
    ) => {
      // Proactive quota check: skip providers that are known to be exhausted.
      const snap = await loadQuotaSnapshot(provider, state);
      if (!hasHeadroom(snap)) {
        log.info("ai-router: skipping exhausted provider", { provider, reason: "quota-guardian" });
        await telemetry?.decision("ai-router", "provider-skipped-quota", { provider });
        return;
      }
      raceCandidates.push({
        name,
        fn: async (signal: AbortSignal) => {
          try {
            const res = await fn(signal);
            if (res.headers) {
              recordQuotaFromHeaders(provider, res.headers, state, telemetry).catch(() => {});
            }
            return res;
          } catch (e: unknown) {
            const status = (e as { status?: number }).status;
            if (status === 429) {
              markProviderExhausted(provider, null, state, telemetry).catch(() => {});
            }
            throw e;
          }
        },
      });
    };

    // Helper for Groq, which does not expose HTTP headers through the SDK.
    const addGroqFastCandidate = () => {
      raceCandidates.push({
        name: "groq-fast",
        fn: async (_signal: AbortSignal) => {
          // The Groq SDK does not accept AbortSignal on the chat.completions
          // API, so cancellation here relies on the SDK request completing
          // naturally or erroring — the signal is accepted for interface
          // compatibility but is not wired to the SDK call.
          try {
            const res = await groqBreaker.call(() =>
              chatWithGroqRotation(GROQ_FAST, prompt, groqKeys, groqIndex),
            );
            if (res.usage) {
              costTracker.record("groq", GROQ_FAST, "fast", res.usage);
              await telemetry?.tokenUsage("groq", GROQ_FAST, "fast", res.usage);
            }
            return { content: res.content };
          } catch (e: unknown) {
            const status = (e as { status?: number }).status;
            if (status === 429) {
              markProviderExhausted("groq", null, state, telemetry).catch(() => {});
            }
            throw e;
          }
        },
      });
    };

    if (groqKeys.length > 0 && groqBreaker.currentState !== "OPEN") {
      addGroqFastCandidate();
    }
    if (geminiKey && geminiBreaker.currentState !== "OPEN") {
      await addCandidate("gemini-flash", "gemini", (signal) => geminiBreaker.call(() => chatGemini(prompt, geminiKey, signal)));
    }
    if (cerebrasKey && cerebrasBreaker.currentState !== "OPEN") {
      await addCandidate("cerebras-fast", "cerebras", (signal) => cerebrasBreaker.call(() => chatCerebras(prompt, cerebrasKey, signal)));
    }
    if (mistralKey && mistralBreaker.currentState !== "OPEN") {
      await addCandidate("mistral-small", "mistral", (signal) => mistralBreaker.call(() => chatMistral(prompt, mistralKey, signal)));
    }
    if (togetherKey && togetherBreaker.currentState !== "OPEN") {
      await addCandidate("together-turbo-free", "together", (signal) => togetherBreaker.call(() => chatTogether(prompt, togetherKey, signal)));
    }
    if (sambanovaKey && sambanovaBreaker.currentState !== "OPEN") {
      await addCandidate("sambanova-llama", "sambanova", (signal) => sambanovaBreaker.call(() => chatSambanova(prompt, sambanovaKey, signal)));
    }
    if (huggingfaceKey && huggingfaceBreaker.currentState !== "OPEN") {
      await addCandidate("hf-router-llama", "huggingface", (signal) => huggingfaceBreaker.call(() => chatHuggingFace(prompt, huggingfaceKey, signal)));
    }
    // A3: Fireworks, DeepInfra, Novita, CF Workers AI REST
    if (fireworksKey && fireworksBreaker.currentState !== "OPEN") {
      await addCandidate("fireworks-llama", "fireworks", (signal) => fireworksBreaker.call(() => chatFireworks(prompt, fireworksKey, signal)));
    }
    if (deepinfraKey && deepinfraBreaker.currentState !== "OPEN") {
      await addCandidate("deepinfra-llama", "deepinfra", (signal) => deepinfraBreaker.call(() => chatDeepInfra(prompt, deepinfraKey, signal)));
    }
    if (novitaKey && novitaBreaker.currentState !== "OPEN") {
      await addCandidate("novita-llama", "novita", (signal) => novitaBreaker.call(() => chatNovita(prompt, novitaKey, signal)));
    }
    if (cfAccountId && cfAiApiToken && cfRestBreaker.currentState !== "OPEN") {
      await addCandidate("cf-workers-ai-rest", "cf-workers-ai-rest", (signal) => cfRestBreaker.call(() => chatCfRestAi(prompt, cfAccountId, cfAiApiToken, signal)));
    }
    if (openrouterKey && openrouterFreeBreaker.currentState !== "OPEN") {
      await addCandidate("openrouter-free", "openrouter", (signal) => openrouterFreeBreaker.call(() => chatOpenRouterFree(prompt, openrouterKey, signal)));
    }

    if (raceCandidates.length === 0) {
      return () => Promise.reject(new Error("[ai-router] no fast providers available"));
    }
    if (raceCandidates.length === 1) {
      // Single candidate: no race needed; use a non-cancelling AbortController
      // so the fn signature (which requires a signal) is satisfied.
      return () => raceCandidates[0].fn(new AbortController().signal).then((r) => r.content);
    }
    return () => raceProviders(raceCandidates, telemetry);
  };

  // Build the "heavy escalation" function — Groq-heavy only
  const buildHeavyEscalation = async (): Promise<() => Promise<string>> => {
    // If Groq-fast is known exhausted, assume heavy is too (same account/key)
    const snap = await loadQuotaSnapshot("groq", state);
    if (!hasHeadroom(snap)) {
      log.info("ai-router: skipping exhausted provider", { provider: "groq-heavy", reason: "quota-guardian" });
      await telemetry?.decision("ai-router", "provider-skipped-quota", { provider: "groq-heavy" });
      return () => Promise.reject(new Error("[ai-router] Groq heavy tier unavailable (quota)"));
    }
    return async () => {
      if (groqKeys.length > 0 && groqBreaker.currentState !== "OPEN") {
        const res = await groqBreaker.call(() =>
          chatWithGroqRotation(GROQ_HEAVY, prompt, groqKeys, groqIndex),
        );
        if (res.usage) {
          costTracker.record("groq", GROQ_HEAVY, "heavy", res.usage);
          await telemetry?.tokenUsage("groq", GROQ_HEAVY, "heavy", res.usage);
        }
        await telemetry?.decision("ai-router", "tier2-groq-heavy-success", {
          durationMs: Date.now() - start,
        });
        return res.content;
      }
      throw new Error("[ai-router] Groq heavy tier unavailable");
    };
  };

  if (tier === "fast") {
    // H4: try fast draft first; escalate to heavy if JSON validation fails
    try {
      const content = await draftThenVerify(
        await buildFastDraft(),
        await buildHeavyEscalation(),
        isValidJson,
        telemetry,
        path,
      );
      await telemetry?.decision("ai-router", "tier2-draft-verify-success", { durationMs: Date.now() - start });
      return content;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("ai-router: draft-then-verify failed", { path, error: msg });
    }
  } else {
    // Heavy tasks: straight to Groq-heavy
    try {
      const content = await (await buildHeavyEscalation())();
      await telemetry?.decision("ai-router", "tier2-groq-success", { model: GROQ_HEAVY, tier, durationMs: Date.now() - start });
      return content;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("Groq heavy tier failed", { path, error: msg });
    }
  }

  // ── Tier 3: OpenRouter fallback ────────────────────────────────────────
  if (openrouterKey && openrouterBreaker.currentState !== "OPEN") {
    try {
      log.info(`routing to OpenRouter (fallback)`, { path });
      const orRes = await openrouterBreaker.call(() =>
        chatOpenRouter(prompt, openrouterKey),
      );
      if (orRes.usage) {
        costTracker.record("openrouter", "openrouter", tier, orRes.usage);
        await telemetry?.tokenUsage("openrouter", "openrouter", tier, orRes.usage);
      }
      if (orRes.headers) {
        recordQuotaFromHeaders("openrouter", orRes.headers, state, telemetry).catch(() => {});
      }
      await telemetry?.decision("ai-router", "tier3-openrouter-success", { tier, durationMs: Date.now() - start });
      return orRes.content;
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      if (status === 429) {
        markProviderExhausted("openrouter", null, state, telemetry).catch(() => {});
      }
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`OpenRouter tier failed`, { path, error: msg });
    }
  }

  await telemetry?.decision("ai-router", "all-tiers-failed", { tier, durationMs: Date.now() - start });
  throw new Error(`[ai-router] all tiers failed for ${path}`);
}
