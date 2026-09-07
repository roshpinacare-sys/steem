import { describe, it, expect, vi, afterEach } from "vitest";
import { createGateway } from "@/lib/engine/gateway";
import { consumeOpenAiStream } from "@/lib/engine/providers/openai";

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

describe("gateway", () => {
  it("returns ok:false for an unknown provider", async () => {
    const g = createGateway();
    const res = await g.chat({
      provider: "nope" as never,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.ok).toBe(false);
  });

  it("returns ok:false for empty messages", async () => {
    const g = createGateway();
    const res = await g.chat({ provider: "openai", messages: [] });
    expect(res.ok).toBe(false);
  });

  it("never throws — network error becomes ok:false", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const g = createGateway();
    const res = await g.chat({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-x",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("boom");
  });

  it("simulation provider runs with no key", async () => {
    const g = createGateway();
    const res = await g.chat({
      provider: "simulation",
      messages: [{ role: "user", content: "research caching" }],
      stream: false,
    });
    expect(res.ok).toBe(true);
    // Planning turn returns JSON steps.
    expect(res.output).toContain("steps");
  });
});

describe("consumeOpenAiStream", () => {
  it("accumulates deltas and tool calls from SSE", async () => {
    const res = sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"calculator","arguments":"{\\"expression\\":\\"1+1\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const deltas: string[] = [];
    const out = await consumeOpenAiStream(res, (e) => {
      if (e.type === "delta") deltas.push(e.text);
    });
    expect(out.text).toBe("Hello");
    expect(deltas.join("")).toBe("Hello");
    expect(out.toolCalls[0].name).toBe("calculator");
    expect(out.toolCalls[0].arguments).toEqual({ expression: "1+1" });
  });
});
