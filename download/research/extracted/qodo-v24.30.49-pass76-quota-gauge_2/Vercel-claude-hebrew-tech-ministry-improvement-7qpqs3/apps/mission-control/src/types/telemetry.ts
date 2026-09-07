/**
 * Shared telemetry types for the Mission Control UI.
 * (Formerly declared in hooks/useTelemetry.ts; the hook itself was an
 * unused thin wrapper — components consume useTelemetryCtx directly.)
 */
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
  // Decision-specific metadata; phases may attach arbitrary context keys.
  [key: string]: unknown;
}

export interface UseTelemetry {
  events: TelemetryEvent[];
  tiering: TelemetryEvent[];
  recentRuns: string[];
  currentRunId: string | null;
  currentPhase: string | null;
  loading: boolean;
  error: string | null;
  /** Epoch ms of the last successful telemetry fetch (null = never). */
  lastSyncAt: number | null;
  refresh: () => Promise<void>;
}
