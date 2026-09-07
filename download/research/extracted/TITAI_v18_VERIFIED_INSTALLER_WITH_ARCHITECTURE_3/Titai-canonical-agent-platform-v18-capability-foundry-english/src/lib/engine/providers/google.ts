import type {
  ChatRequest,
  ChatResult,
  ProviderAdapter,
  ToolCall,
} from "../types";

/**
 * Google Gemini adapter (generateContent). Non-streaming for simplicity; the
 * runner still emits a single delta so the UI shows the text. Tool calls map
 * from functionCall parts.
 */

function toGeminiContents(req: ChatRequest) {
  return req.messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        return {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: m.toolCallId,
                response: { result: m.content },
              },
            },
          ],
        };
      }
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      };
    });
}

export const googleAdapter: ProviderAdapter = {
  name: "google",
  async chat(req: ChatRequest): Promise<ChatResult> {
    const base =
      req.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    const model = req.model || "gemini-2.0-flash";
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const body: Record<string, unknown> = {
      contents: toGeminiContents(req),
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: req.maxOutputTokens ?? 4096,
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (req.tools?.length) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const res = await fetch(
      `${base}/models/${model}:generateContent?key=${req.apiKey ?? ""}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: req.signal,
      },
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        ok: false,
        output: "",
        toolCalls: [],
        error: `google HTTP ${res.status}: ${txt.slice(0, 200)}`,
      };
    }

    const json = (await res.json()) as Record<string, unknown>;
    const candidate = (json.candidates as Array<Record<string, unknown>>)?.[0];
    const parts =
      ((candidate?.content as Record<string, unknown>)?.parts as Array<
        Record<string, unknown>
      >) ?? [];
    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const part of parts) {
      if (typeof part.text === "string") text += part.text;
      if (part.functionCall) {
        const fc = part.functionCall as Record<string, unknown>;
        toolCalls.push({
          id: `call_${fc.name}`,
          name: fc.name as string,
          arguments: (fc.args as Record<string, unknown>) ?? {},
        });
      }
    }
    if (text) req.onEvent?.({ type: "delta", text });
    for (const tc of toolCalls) req.onEvent?.({ type: "tool_call", toolCall: tc });
    req.onEvent?.({ type: "done" });
    return { ok: true, output: text, toolCalls };
  },
};
