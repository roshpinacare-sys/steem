/**
 * cost-tracker.ts
 *
 * Tracks token consumption and estimated USD cost for every LLM call made
 * during a single pipeline run. Aggregated totals are written to telemetry
 * at the end of the run so they appear in the Mission Control dashboard.
 *
 * Pricing (as of 2026-07, per 1M tokens, source: groq.com/pricing):
 *   Groq  openai/gpt-oss-20b   : input $0.10 / output $0.50   (current fast tier)
 *   Groq  openai/gpt-oss-120b  : input $0.15 / output $0.75   (current heavy tier)
 *   OpenRouter (blended average) : input $0.50 / output $1.50
 *   HuggingFace Inference API    : free tier (cost = 0)
 *
 * llama-3.1-8b-instant and llama-3.3-70b-versatile were Groq's fast/heavy
 * tiers until Groq deprecated both on 2026-06-17. Their pricing entries are
 * kept below only so historical cost-ledger entries from before the cutover
 * still resolve to a rate instead of falling through to the openrouter
 * default. Do not route new calls to them — see ai-router.ts.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CostEntry {
  provider: string;
  model: string;
  tier: string;
  usage: TokenUsage;
  estimatedUsdCents: number;
  timestamp: number;
}

// USD cents per 1 000 tokens (input, output).
// Values are scaled so that estimatedUsdCents is genuinely in cents.
const PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  // Current (2026-07) Groq tiers — see ai-router.ts GROQ_FAST / GROQ_HEAVY.
  "openai/gpt-oss-20b":     { inputPer1k: 0.010, outputPer1k: 0.050 },
  "openai/gpt-oss-120b":    { inputPer1k: 0.015, outputPer1k: 0.075 },
  // Legacy — deprecated by Groq 2026-06-17. Kept so old cost-ledger rows
  // (from runs before the cutover) still price correctly. Not used for new calls.
  "llama-3.1-8b-instant":   { inputPer1k: 0.005, outputPer1k: 0.008 },
  "llama-3.3-70b-versatile":{ inputPer1k: 0.059, outputPer1k: 0.079 },
  "openrouter":             { inputPer1k: 0.050, outputPer1k: 0.150 },
  "huggingface":            { inputPer1k: 0,     outputPer1k: 0     },
  // A2: free-tier racing providers — no per-token charge on the free plan.
  "together":               { inputPer1k: 0,     outputPer1k: 0     },
  "sambanova":              { inputPer1k: 0,     outputPer1k: 0     },
  // Sovereign local paths — deterministic simulator + on-device Ollama.
  // Genuinely zero marginal cost: nothing is metered, nothing leaves the host.
  "qodo-sovereign":         { inputPer1k: 0,     outputPer1k: 0     },
  "ollama-local":           { inputPer1k: 0,     outputPer1k: 0     },
};

function estimateCents(model: string, usage: TokenUsage): number {
  const key = Object.keys(PRICING).find((k) => model.includes(k)) ?? "openrouter";
  const p = PRICING[key];
  return (
    (usage.promptTokens     / 1000) * p.inputPer1k  +
    (usage.completionTokens / 1000) * p.outputPer1k
  );
}

export class CostTracker {
  private entries: CostEntry[] = [];

  record(
    provider: string,
    model: string,
    tier: string,
    raw: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
  ): void {
    const usage: TokenUsage = {
      promptTokens:     raw.prompt_tokens     ?? 0,
      completionTokens: raw.completion_tokens ?? 0,
      totalTokens:      raw.total_tokens      ?? (raw.prompt_tokens ?? 0) + (raw.completion_tokens ?? 0),
    };
    this.entries.push({
      provider,
      model,
      tier,
      usage,
      estimatedUsdCents: estimateCents(model, usage),
      timestamp: Date.now(),
    });
  }

  totals(): { tokens: TokenUsage; estimatedUsdCents: number; callCount: number } {
    return this.entries.reduce(
      (acc, e) => ({
        tokens: {
          promptTokens:     acc.tokens.promptTokens     + e.usage.promptTokens,
          completionTokens: acc.tokens.completionTokens + e.usage.completionTokens,
          totalTokens:      acc.tokens.totalTokens      + e.usage.totalTokens,
        },
        estimatedUsdCents: acc.estimatedUsdCents + e.estimatedUsdCents,
        callCount: acc.callCount + 1,
      }),
      { tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, estimatedUsdCents: 0, callCount: 0 },
    );
  }

  breakdown(): CostEntry[] {
    return [...this.entries];
  }

  /** Serialise for telemetry event payload. */
  toTelemetryPayload(): Record<string, unknown> {
    const t = this.totals();
    return {
      totalTokens:       t.tokens.totalTokens,
      promptTokens:      t.tokens.promptTokens,
      completionTokens:  t.tokens.completionTokens,
      estimatedUsdCents: parseFloat(t.estimatedUsdCents.toFixed(4)),
      callCount:         t.callCount,
      breakdown:         this.entries.map((e) => ({
        provider: e.provider,
        model:    e.model,
        tier:     e.tier,
        tokens:   e.usage.totalTokens,
        cents:    parseFloat(e.estimatedUsdCents.toFixed(4)),
      })),
    };
  }

  reset(): void {
    this.entries = [];
  }
}
