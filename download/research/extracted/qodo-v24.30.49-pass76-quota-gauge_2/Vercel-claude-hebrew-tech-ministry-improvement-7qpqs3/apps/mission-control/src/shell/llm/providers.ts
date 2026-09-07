/**
 * llm/providers.ts — the browser-side LLM provider catalog.
 *
 * "Bring your own key": the app calls these endpoints directly from the
 * WebView with a key the operator stores on-device. In the Android APK,
 * CapacitorHttp routes fetch through native OkHttp, so CORS never blocks the
 * call. In a plain browser, providers that don't send permissive CORS headers
 * may fail — the `browserCors` hint drives an honest label in the UI.
 *
 * Every provider except Gemini speaks the OpenAI /chat/completions dialect,
 * so one request/parse path covers them; Gemini has its own shape.
 */

export type ProviderId =
  | "openrouter" | "groq" | "openai" | "anthropic"
  | "gemini" | "mistral" | "together" | "deepseek" | "cerebras";

export interface LlmProvider {
  id: ProviderId;
  label: string;
  /** Where the operator creates a key. */
  keysUrl: string;
  /** Placeholder shown in the key field. */
  keyHint: string;
  /** Chat completions endpoint. */
  url: string;
  /** Default model id. */
  model: string;
  /** Request/response shape. Most speak OpenAI; Gemini and Anthropic differ. */
  dialect: "openai" | "gemini" | "anthropic";
  /** Does the provider send browser-usable CORS headers? Drives UI labeling;
   *  in the APK CapacitorHttp bypasses CORS regardless. */
  browserCors: boolean;
  /** Extra static headers (e.g. Anthropic's browser opt-in + version). */
  headers?: Record<string, string>;
  /** Free-tier models exist under this key. */
  hasFree?: boolean;
}

export const PROVIDERS: LlmProvider[] = [
  {
    id: "openrouter", label: "OpenRouter", keysUrl: "https://openrouter.ai/keys",
    keyHint: "sk-or-…", url: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta-llama/llama-3.3-70b-instruct", dialect: "openai", browserCors: true, hasFree: true,
    headers: { "HTTP-Referer": "https://github.com/qodo-v24", "X-Title": "Qodo Mission Control" },
  },
  {
    id: "groq", label: "Groq", keysUrl: "https://console.groq.com/keys",
    keyHint: "gsk_…", url: "https://api.groq.com/openai/v1/chat/completions",
    model: "openai/gpt-oss-20b", dialect: "openai", browserCors: true, hasFree: true,
  },
  {
    id: "gemini", label: "Google Gemini", keysUrl: "https://aistudio.google.com/app/apikey",
    keyHint: "AIza…", url: "https://generativelanguage.googleapis.com/v1beta/models",
    model: "gemini-2.0-flash", dialect: "gemini", browserCors: true, hasFree: true,
  },
  {
    id: "cerebras", label: "Cerebras", keysUrl: "https://cloud.cerebras.ai",
    keyHint: "csk-…", url: "https://api.cerebras.ai/v1/chat/completions",
    model: "llama-3.3-70b", dialect: "openai", browserCors: true, hasFree: true,
  },
  {
    id: "mistral", label: "Mistral", keysUrl: "https://console.mistral.ai/api-keys",
    keyHint: "…", url: "https://api.mistral.ai/v1/chat/completions",
    model: "mistral-small-latest", dialect: "openai", browserCors: true, hasFree: true,
  },
  {
    id: "together", label: "Together AI", keysUrl: "https://api.together.xyz/settings/api-keys",
    keyHint: "…", url: "https://api.together.xyz/v1/chat/completions",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", dialect: "openai", browserCors: true, hasFree: true,
  },
  {
    id: "deepseek", label: "DeepSeek", keysUrl: "https://platform.deepseek.com/api_keys",
    keyHint: "sk-…", url: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat", dialect: "openai", browserCors: true,
  },
  {
    id: "openai", label: "OpenAI", keysUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-…", url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini", dialect: "openai", browserCors: false,
  },
  {
    id: "anthropic", label: "Anthropic", keysUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-…", url: "https://api.anthropic.com/v1/messages",
    model: "claude-3-5-haiku-latest", dialect: "anthropic", browserCors: false,
    headers: { "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
  },
];

export function providerById(id: ProviderId): LlmProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
