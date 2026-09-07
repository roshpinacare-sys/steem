import type {
  ChatRequest,
  ChatResult,
  ProviderAdapter,
  ProviderName,
} from "./types";
import { makeOpenAiAdapter } from "./providers/openai";
import { anthropicAdapter } from "./providers/anthropic";
import { googleAdapter } from "./providers/google";
import { simulationAdapter } from "./providers/simulation";
import { assertSafeEgressUrl } from "@/lib/security/egress";

/**
 * Provider-agnostic gateway (ported from V4's llmGateway225). Validates the
 * request, applies a hard timeout, and NEVER throws — failures come back as
 * { ok: false, error }. Tool calls are normalized to { id, name, arguments }.
 */

const DEFAULT_TIMEOUT_MS = 90_000;

function buildAdapters(): Map<ProviderName, ProviderAdapter> {
  const openai = makeOpenAiAdapter("openai");
  const map = new Map<ProviderName, ProviderAdapter>();
  map.set("openai", openai);
  map.set("anthropic", anthropicAdapter);
  map.set("google", googleAdapter);
  map.set("simulation", simulationAdapter);
  // OpenRouter + Ollama speak the OpenAI wire format; only the baseUrl differs.
  map.set("openrouter", { ...makeOpenAiAdapter("openrouter"), name: "openrouter" });
  map.set("ollama", { ...makeOpenAiAdapter("ollama"), name: "ollama" });
  return map;
}

export interface Gateway {
  chat(req: ChatRequest): Promise<ChatResult>;
}

export function createGateway(): Gateway {
  const adapters = buildAdapters();

  return {
    async chat(req: ChatRequest): Promise<ChatResult> {
      const adapter = adapters.get(req.provider);
      if (!adapter) {
        return {
          ok: false,
          output: "",
          toolCalls: [],
          error: `Unknown provider: ${req.provider}`,
        };
      }
      if (!Array.isArray(req.messages) || req.messages.length === 0) {
        return {
          ok: false,
          output: "",
          toolCalls: [],
          error: "messages must be a non-empty array",
        };
      }

      // Default baseUrl for OpenAI-compatible providers.
      let baseUrl = req.baseUrl;
      if (!baseUrl) {
        if (req.provider === "openrouter") baseUrl = "https://openrouter.ai/api/v1";
        if (req.provider === "ollama")
          baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
      }

      if (baseUrl) {
        try {
          baseUrl = (
            await assertSafeEgressUrl(baseUrl, {
              allowHttp: req.provider === "ollama",
              allowPrivate: req.provider === "ollama",
            })
          ).toString().replace(/\/$/, "");
        } catch (err) {
          return {
            ok: false,
            output: "",
            toolCalls: [],
            error: err instanceof Error ? err.message : "Unsafe provider endpoint",
          };
        }
      }

      const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
      const signal = req.signal
        ? AbortSignal.any([req.signal, timeout])
        : timeout;

      try {
        return await adapter.chat({ ...req, baseUrl, signal });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown gateway error";
        req.onEvent?.({ type: "error", error: message });
        return { ok: false, output: "", toolCalls: [], error: message };
      }
    },
  };
}

/** Shared singleton — the gateway is stateless, keys pass per request. */
const globalForGateway = globalThis as unknown as { __titaiGateway?: Gateway };
export const gateway: Gateway =
  globalForGateway.__titaiGateway ?? createGateway();
globalForGateway.__titaiGateway = gateway;
