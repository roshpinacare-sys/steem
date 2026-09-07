import type {
  ChatRequest,
  ChatResult,
  ProviderAdapter,
  ToolCall,
} from "../types";
import { pickSimulationScript } from "../fixtures/simulation-scripts";

/**
 * Deterministic, network-free provider. Drives runs from a SimulationScript so
 * the entire app — streaming, tools, approvals, canvas, seed data, tests —
 * works with zero API keys. The runner tells the sim which step + iteration it
 * is on via a control message it appends to the conversation.
 */

interface SimControl {
  step: string;
  iteration: number;
  mode: "plan" | "step";
}

function readControl(req: ChatRequest): SimControl | null {
  const last = [...req.messages]
    .reverse()
    .find((m) => m.role === "user" && m.content.startsWith("__SIM__"));
  if (!last) return null;
  try {
    return JSON.parse(last.content.slice("__SIM__".length)) as SimControl;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const simulationAdapter: ProviderAdapter = {
  name: "simulation",
  async chat(req: ChatRequest): Promise<ChatResult> {
    const script =
      req.simulationScript ?? pickSimulationScript(objectiveOf(req));
    const control = readControl(req);
    const delay = req.simulationDelayMs ?? 0;

    // Planning turn: return the plan as JSON text.
    if (!control || control.mode === "plan") {
      const planJson = JSON.stringify({ steps: script.plan });
      if (req.stream) {
        for (const chunk of chunkText(planJson, 24)) {
          if (req.signal?.aborted) break;
          req.onEvent?.({ type: "delta", text: chunk });
          if (delay) await sleep(delay);
        }
        req.onEvent?.({ type: "done" });
      }
      return {
        ok: true,
        output: planJson,
        toolCalls: [],
        usage: { input: 60, output: 40 },
      };
    }

    // Step turn: emit deltas then optional tool calls or final text.
    const turns = script.stepTurns[control.step] ?? [];
    const turn = turns[Math.min(control.iteration, turns.length - 1)] ?? {
      deltas: ["Working on it."],
      finalText: "Done.",
    };

    if (req.stream) {
      for (const d of turn.deltas) {
        if (req.signal?.aborted) break;
        req.onEvent?.({ type: "delta", text: d });
        if (delay) await sleep(delay);
      }
    }

    const toolCalls: ToolCall[] = turn.toolCalls ?? [];
    if (req.stream) {
      for (const tc of toolCalls) req.onEvent?.({ type: "tool_call", toolCall: tc });
      req.onEvent?.({ type: "done" });
    }

    const output = toolCalls.length ? "" : turn.finalText;
    return {
      ok: true,
      output,
      toolCalls,
      usage: { input: 120, output: 80 },
    };
  },
};

function objectiveOf(req: ChatRequest): string {
  const firstUser = req.messages.find(
    (m) => m.role === "user" && !m.content.startsWith("__SIM__"),
  );
  return firstUser?.content ?? "";
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}
