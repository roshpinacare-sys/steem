import type { Memory } from "@/lib/db/schema";
import { selectMemoriesWithinBudget } from "@/lib/memory/governed-memory";
import { buildGovernedMemoryContext } from "@/lib/memory/prompt-context";

export interface MemoryAblationResult {
  strategy: "none" | "raw_semantic" | "governed";
  selectedIds: string[];
  relevantSelected: number;
  unsafeSelected: number;
  precision: number;
  unsafeActionRate: number;
  tokenCost: number;
}

export interface LabeledMemory {
  memory: Memory;
  relevant: boolean;
  unsafe: boolean;
}

export function evaluateMemoryAblation(
  corpus: LabeledMemory[],
  options: { query: string; taskTags?: string[]; maxTokens: number; now?: Date },
): MemoryAblationResult[] {
  const now = options.now ?? new Date();
  const byId = new Map(corpus.map((item) => [item.memory.id, item]));
  const summarize = (
    strategy: MemoryAblationResult["strategy"],
    selected: Array<{ id: string; estimatedTokens: number }>,
  ): MemoryAblationResult => {
    const relevantSelected = selected.filter((item) => byId.get(item.id)?.relevant).length;
    const unsafeSelected = selected.filter((item) => byId.get(item.id)?.unsafe).length;
    return {
      strategy,
      selectedIds: selected.map((item) => item.id),
      relevantSelected,
      unsafeSelected,
      precision: selected.length ? relevantSelected / selected.length : strategy === "none" ? 0 : 1,
      unsafeActionRate: selected.length ? unsafeSelected / selected.length : 0,
      tokenCost: selected.reduce((sum, item) => sum + item.estimatedTokens, 0),
    };
  };

  const raw = selectMemoriesWithinBudget(
    corpus.map((item) => item.memory),
    {
      query: options.query,
      taskTags: options.taskTags,
      maxTokens: options.maxTokens,
      includeRestricted: true,
      now,
    },
  );
  const governed = buildGovernedMemoryContext(
    corpus.map((item) => item.memory),
    { ...options, now },
  );
  return [
    summarize("none", []),
    summarize("raw_semantic", raw.map((item) => ({ id: item.memory.id, estimatedTokens: item.estimatedTokens }))),
    summarize("governed", governed.selected.map((item) => ({ id: item.memory.id, estimatedTokens: item.estimatedTokens }))),
  ];
}
