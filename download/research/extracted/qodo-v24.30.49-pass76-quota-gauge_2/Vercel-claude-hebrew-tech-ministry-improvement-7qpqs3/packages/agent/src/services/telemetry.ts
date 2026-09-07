import { log } from "./logger.js";
import { RedisState, type RedisEnv } from "./redis-state.js";

export interface TelemetryEvent {
  runId: string;
  phase: string;
  provider?: string;
  model?: string;
  tier?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  decision?: string;
  timestamp: string;
}

type TelemetryCircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class Telemetry {
  private state: RedisState;
  private runId: string;
  private consecutiveFailures = 0;
  private circuitState: TelemetryCircuitState = "CLOSED";
  private circuitOpenedAt = 0;
  private readonly resetTimeoutMs = 30_000;

  /**
   * @param runId  Unique identifier for this pipeline run.
   * @param state  Optional pre-constructed RedisState (preferred — uses the
   *               validated env object from cli.ts).
   * @param env    Optional RedisEnv for the fallback path when no state is
   *               supplied.  Avoids the env-sealing gap that arose when
   *               `new RedisState()` (no args) silently read process.env.
   */
  constructor(runId: string, state?: RedisState, env?: RedisEnv) {
    this.runId = runId;
    this.state = state ?? new RedisState(env ?? (process.env as RedisEnv));
  }

  private async safeWrite(event: TelemetryEvent) {
    if (this.circuitState === "OPEN") {
      if (Date.now() - this.circuitOpenedAt < this.resetTimeoutMs) return;
      this.circuitState = "HALF_OPEN";
      log.info("telemetry: circuit breaker attempting recovery probe");
    }

    try {
      await this.state.pushEvent("qodo:v24:telemetry:events", event as unknown as Record<string, unknown>);
      this.consecutiveFailures = 0;
      if (this.circuitState === "HALF_OPEN") {
        this.circuitState = "CLOSED";
        log.info("telemetry: circuit breaker recovered (CLOSED)");
      }
    } catch (e: unknown) {
      this.consecutiveFailures++;
      const msg = e instanceof Error ? e.message : String(e);
      log.warn('telemetry: write failed', { failures: this.consecutiveFailures, error: msg });
      if (this.circuitState === "HALF_OPEN") {
        this.circuitState = "OPEN";
        this.circuitOpenedAt = Date.now();
        log.warn("telemetry: circuit breaker recovery probe failed; remaining OPEN");
      } else if (this.consecutiveFailures >= 5) {
        this.circuitState = "OPEN";
        this.circuitOpenedAt = Date.now();
        log.warn("telemetry: circuit breaker open; telemetry disabled until recovery timeout");
      }
    }
  }

  async push(event: Omit<TelemetryEvent, "runId" | "timestamp">) {
    if (this.circuitState === "OPEN" && Date.now() - this.circuitOpenedAt < this.resetTimeoutMs) return;
    const full: TelemetryEvent = {
      ...event,
      runId: this.runId,
      timestamp: new Date().toISOString(),
    };
    await this.safeWrite(full);
  }

  async tokenUsage(provider: string, model: string, tier: string, usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }) {
    await this.push({
      phase: "ai-call",
      provider,
      model,
      tier,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });
  }

  async decision(phase: string, decision: string, meta?: Record<string, unknown>) {
    await this.push({ phase, decision, ...meta });
  }
}
