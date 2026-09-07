import type {
  ChatRequest,
  ChatResult,
  ProviderAdapter,
  ProviderName,
  ToolCall,
  GatewayEvent,
} from "../types";

/**
 * OpenAI Chat Completions adapter. Reused by OpenRouter and Ollama via
 * different baseUrls (both speak the OpenAI wire format).
 */

function toOpenAiMessages(req: ChatRequest) {
  return req.messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments ?? {}),
          },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toOpenAiTools(req: ChatRequest) {
  if (!req.tools?.length) return undefined;
  return req.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export async function consumeOpenAiStream(
  response: Response,
  onEvent?: (e: GatewayEvent) => void,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("streaming unsupported");
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  const toolAcc: Record<
    number,
    { id: string; name: string; args: string }
  > = {};

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const choice = (json.choices as Array<Record<string, unknown>>)?.[0];
      const delta = choice?.delta as Record<string, unknown> | undefined;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        onEvent?.({ type: "delta", text: delta.content });
      }
      const tcs = delta.tool_calls as
        | Array<Record<string, unknown>>
        | undefined;
      if (tcs) {
        for (const tc of tcs) {
          const idx = (tc.index as number) ?? 0;
          toolAcc[idx] ??= { id: "", name: "", args: "" };
          if (tc.id) toolAcc[idx].id = tc.id as string;
          const fn = tc.function as Record<string, unknown> | undefined;
          if (fn?.name) toolAcc[idx].name = fn.name as string;
          if (fn?.arguments) toolAcc[idx].args += fn.arguments as string;
        }
      }
    }
  }

  const toolCalls: ToolCall[] = Object.values(toolAcc)
    .filter((t) => t.name)
    .map((t) => ({
      id: t.id || `call_${t.name}`,
      name: t.name,
      arguments: safeJson(t.args),
    }));
  return { text, toolCalls };
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

export function makeOpenAiAdapter(name: ProviderName): ProviderAdapter {
  return {
    name,
    async chat(req: ChatRequest): Promise<ChatResult> {
      const base = req.baseUrl ?? "https://api.openai.com/v1";
      const body = {
        model: req.model,
        messages: toOpenAiMessages(req),
        tools: toOpenAiTools(req),
        temperature: req.temperature ?? 0.7,
        // `max_tokens` is the param accepted by OpenAI, OpenRouter AND Ollama's
        // OpenAI-compatible endpoint (which both reuse this adapter).
        max_tokens: req.maxOutputTokens ?? 4096,
        stream: !!req.stream,
      };
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (req.apiKey) headers.authorization = `Bearer ${req.apiKey}`;

      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: req.signal,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return {
          ok: false,
          output: "",
          toolCalls: [],
          error: `${name} HTTP ${res.status}: ${txt.slice(0, 200)}`,
        };
      }

      if (req.stream) {
        const { text, toolCalls } = await consumeOpenAiStream(res, req.onEvent);
        for (const tc of toolCalls) req.onEvent?.({ type: "tool_call", toolCall: tc });
        req.onEvent?.({ type: "done" });
        return { ok: true, output: text, toolCalls };
      }

      const json = (await res.json()) as Record<string, unknown>;
      const choice = (json.choices as Array<Record<string, unknown>>)?.[0];
      const msg = choice?.message as Record<string, unknown> | undefined;
      const text = (msg?.content as string) ?? "";
      const rawTools =
        (msg?.tool_calls as Array<Record<string, unknown>>) ?? [];
      const toolCalls: ToolCall[] = rawTools.map((tc) => {
        const fn = tc.function as Record<string, unknown>;
        return {
          id: (tc.id as string) ?? `call_${fn.name}`,
          name: fn.name as string,
          arguments: safeJson((fn.arguments as string) ?? "{}"),
        };
      });
      const usage = json.usage as Record<string, number> | undefined;
      return {
        ok: true,
        output: text,
        toolCalls,
        usage: usage
          ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 }
          : undefined,
      };
    },
  };
}
