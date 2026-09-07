/**
 * llm/client.ts — a browser-side chat client that calls the operator's chosen
 * LLM provider directly with their on-device key. Three request/response
 * dialects (OpenAI, Gemini, Anthropic) behind one `llmChat` call. On the APK,
 * CapacitorHttp routes these through native HTTP so CORS never blocks them.
 */
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import { PROVIDERS, providerById, type LlmProvider, type ProviderId } from "./providers.js";
import { getKey, getModel, getSelected } from "./store.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  providerId?: ProviderId;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmChatResult {
  content: string;
  provider: ProviderId;
  model: string;
}

export class NoLlmError extends Error {
  constructor() { super("No LLM provider configured. Add a key in Settings → AI providers."); this.name = "NoLlmError"; }
}

function resolveProvider(opts: LlmChatOptions): { provider: LlmProvider; key: string; model: string } {
  const id = opts.providerId ?? getSelected();
  if (!id) throw new NoLlmError();
  const provider = providerById(id);
  if (!provider) throw new NoLlmError();
  const key = getKey(id);
  if (!key) throw new NoLlmError();
  const model = opts.model ?? getModel(id) ?? provider.model;
  return { provider, key, model };
}

async function readError(r: Response, label: string): Promise<never> {
  let detail = "";
  try {
    const body = await r.json() as { error?: { message?: string } | string; message?: string };
    detail = typeof body.error === "string" ? body.error
      : body.error?.message ?? body.message ?? "";
  } catch { /* non-JSON */ }
  throw new Error(`${label} ${r.status}${detail ? ` — ${detail}` : ""}`);
}

// ── Dialect: OpenAI /chat/completions ───────────────────────────────────────
async function chatOpenAiDialect(p: LlmProvider, key: string, model: string, messages: ChatMessage[], opts: LlmChatOptions): Promise<string> {
  const r = await fetchWithTimeout(p.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(p.headers ?? {}) },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1024,
      stream: false,
    }),
    signal: opts.signal,
  }, 90_000);
  if (!r.ok) await readError(r, p.label);
  const body = await r.json() as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

// ── Dialect: Google Gemini generateContent ──────────────────────────────────
async function chatGeminiDialect(p: LlmProvider, key: string, model: string, messages: ChatMessage[], opts: LlmChatOptions): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const url = `${p.url}/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { temperature: opts.temperature ?? 0.3, maxOutputTokens: opts.maxTokens ?? 1024 },
    }),
    signal: opts.signal,
  }, 90_000);
  if (!r.ok) await readError(r, p.label);
  const body = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return body.candidates?.[0]?.content?.parts?.map((x) => x.text ?? "").join("") ?? "";
}

// ── Dialect: Anthropic /v1/messages ─────────────────────────────────────────
async function chatAnthropicDialect(p: LlmProvider, key: string, model: string, messages: ChatMessage[], opts: LlmChatOptions): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const msgs = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  const r = await fetchWithTimeout(p.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, ...(p.headers ?? {}) },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.3,
      ...(system ? { system } : {}),
      messages: msgs,
    }),
    signal: opts.signal,
  }, 90_000);
  if (!r.ok) await readError(r, p.label);
  const body = await r.json() as { content?: { type: string; text?: string }[] };
  return (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}

/** Send a chat to the resolved provider and return its text reply. */
export async function llmChat(messages: ChatMessage[], opts: LlmChatOptions = {}): Promise<LlmChatResult> {
  const { provider, key, model } = resolveProvider(opts);
  const content = provider.dialect === "gemini" ? await chatGeminiDialect(provider, key, model, messages, opts)
    : provider.dialect === "anthropic" ? await chatAnthropicDialect(provider, key, model, messages, opts)
    : await chatOpenAiDialect(provider, key, model, messages, opts);
  return { content, provider: provider.id, model };
}

/** Validate a key with a tiny live call. Returns a friendly ok/detail. */
export async function llmVerify(id: ProviderId, key: string): Promise<{ ok: boolean; detail: string }> {
  const provider = providerById(id);
  if (!provider) return { ok: false, detail: "unknown provider" };
  try {
    const content = provider.dialect === "gemini" ? await chatGeminiDialect(provider, key, provider.model, [{ role: "user", content: "ping" }], { maxTokens: 4 })
      : provider.dialect === "anthropic" ? await chatAnthropicDialect(provider, key, provider.model, [{ role: "user", content: "ping" }], { maxTokens: 4 })
      : await chatOpenAiDialect(provider, key, provider.model, [{ role: "user", content: "ping" }], { maxTokens: 4 });
    return { ok: true, detail: content ? "key works" : "connected" };
  } catch (e: unknown) {
    return { ok: false, detail: e instanceof Error ? e.message : "verification failed" };
  }
}

export { PROVIDERS };
