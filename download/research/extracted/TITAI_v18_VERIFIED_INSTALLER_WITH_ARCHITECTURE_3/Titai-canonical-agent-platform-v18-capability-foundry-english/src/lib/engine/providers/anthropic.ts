import type {
  ChatRequest,
  ChatResult,
  ProviderAdapter,
  ToolCall,
  GatewayEvent,
} from "../types";

/**
 * Anthropic Messages API adapter. System messages are hoisted to the top-level
 * `system` field; tool_use blocks map to normalized tool calls.
 */

function splitMessages(req: ChatRequest) {
  const system = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const messages = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        return {
          role: "user" as const,
          content: [
            {
              type: "tool_result",
              tool_use_id: m.toolCallId,
              content: m.content,
            },
          ],
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        const blocks: Record<string, unknown>[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments ?? {},
          });
        }
        return { role: "assistant" as const, content: blocks };
      }
      return { role: m.role as "user" | "assistant", content: m.content };
    });

  return { system, messages };
}

async function consumeAnthropicStream(
  response: Response,
  onEvent?: (e: GatewayEvent) => void,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("streaming unsupported");
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  const toolCalls: ToolCall[] = [];
  let current: { id: string; name: string; json: string } | null = null;

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
      if (!data) continue;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const type = json.type as string;
      if (type === "content_block_start") {
        const block = json.content_block as Record<string, unknown>;
        if (block?.type === "tool_use") {
          current = {
            id: block.id as string,
            name: block.name as string,
            json: "",
          };
        }
      } else if (type === "content_block_delta") {
        const delta = json.delta as Record<string, unknown>;
        if (delta?.type === "text_delta" && delta.text) {
          text += delta.text as string;
          onEvent?.({ type: "delta", text: delta.text as string });
        } else if (delta?.type === "input_json_delta" && current) {
          current.json += (delta.partial_json as string) ?? "";
        }
      } else if (type === "content_block_stop") {
        if (current) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(current.json || "{}");
          } catch {
            args = {};
          }
          toolCalls.push({ id: current.id, name: current.name, arguments: args });
          current = null;
        }
      }
    }
  }
  return { text, toolCalls };
}

export const anthropicAdapter: ProviderAdapter = {
  name: "anthropic",
  async chat(req: ChatRequest): Promise<ChatResult> {
    const base = req.baseUrl ?? "https://api.anthropic.com/v1";
    const { system, messages } = splitMessages(req);
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxOutputTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      messages,
      stream: !!req.stream,
    };
    if (system) body.system = system;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const res = await fetch(`${base}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": req.apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        ok: false,
        output: "",
        toolCalls: [],
        error: `anthropic HTTP ${res.status}: ${txt.slice(0, 200)}`,
      };
    }

    if (req.stream) {
      const { text, toolCalls } = await consumeAnthropicStream(res, req.onEvent);
      for (const tc of toolCalls) req.onEvent?.({ type: "tool_call", toolCall: tc });
      req.onEvent?.({ type: "done" });
      return { ok: true, output: text, toolCalls };
    }

    const json = (await res.json()) as Record<string, unknown>;
    const content = (json.content as Array<Record<string, unknown>>) ?? [];
    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of content) {
      if (block.type === "text") text += block.text as string;
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id as string,
          name: block.name as string,
          arguments: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }
    const usage = json.usage as Record<string, number> | undefined;
    return {
      ok: true,
      output: text,
      toolCalls,
      usage: usage
        ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 }
        : undefined,
    };
  },
};
