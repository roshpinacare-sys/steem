import { describe, expect, it } from "vitest";
import { applyContextBudget } from "@/lib/engine/context-budget";
import type { ChatMessage } from "@/lib/engine/types";

describe("context budgeting", () => {
  it("preserves mandatory policy and objective messages", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "POLICY:" + "a".repeat(1_000) },
      { role: "user", content: "OBJECTIVE:" + "b".repeat(1_000) },
      { role: "assistant", content: "old".repeat(2_000) },
      { role: "tool", toolCallId: "1", content: "old-tool".repeat(1_000) },
      { role: "assistant", content: "latest answer" },
    ];
    const result = applyContextBudget(messages, 3_000);
    expect(result.messages[0].content).toContain("POLICY:");
    expect(result.messages[1].content).toContain("OBJECTIVE:");
    expect(result.messages.at(-1)?.content).toBe("latest answer");
    expect(result.droppedMessages).toBeGreaterThan(0);
  });

  it("keeps complete recent assistant/tool segments when they fit", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "goal" },
      { role: "assistant", content: "call", toolCalls: [{ id: "1", name: "x", arguments: {} }] },
      { role: "tool", toolCallId: "1", content: "result" },
    ];
    const result = applyContextBudget(messages, 5_000);
    expect(result.messages).toHaveLength(4);
    expect(result.droppedMessages).toBe(0);
  });
});
